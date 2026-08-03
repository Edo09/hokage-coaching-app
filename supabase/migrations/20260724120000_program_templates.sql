-- ==========================================================================
-- Program TEMPLATES (reusable blueprints) + assignment provenance.
--
-- Until now every program was authored per client. A coach who runs the same
-- 5-week block with ten clients had to rebuild it ten times. This adds a
-- template library:
--
--   * a TEMPLATE is a programs row with user_id IS NULL and is_template = true
--     (no client, no start date meaning, never visible to any client);
--   * ASSIGNING deep-copies the whole graph (days → exercises + weeks) into a
--     new per-client program row, stamped with template_id so the panel can
--     answer "which clients are on this program?";
--   * editing a template therefore NEVER mutates a client's running block —
--     the copy is a snapshot, which is what a periodized block needs.
--
-- Client-facing behaviour is unchanged: the app fetches
-- (user_id = me AND status = 'active'), and templates have a null user_id, so
-- they can't leak into any client's app. The one-active-per-client rule and its
-- auto-archive trigger keep working exactly as before.
--
-- Additive, idempotent, drift-safe. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

-- 1) Columns -----------------------------------------------------------------
alter table public.programs
  add column if not exists is_template boolean not null default false;

-- Provenance of an assigned copy. ON DELETE SET NULL: deleting a template must
-- never cascade into a client's assigned program.
alter table public.programs
  add column if not exists template_id uuid references public.programs(id) on delete set null;

-- Templates have no client.
alter table public.programs alter column user_id drop not null;

create index if not exists idx_programs_template on public.programs(template_id);
create index if not exists idx_programs_is_template on public.programs(is_template) where is_template;

-- A template has no client; an assigned program must have one.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'programs_template_shape') then
    alter table public.programs add constraint programs_template_shape check (
      (is_template and user_id is null) or (not is_template and user_id is not null)
    );
  end if;
end $$;

-- 2) One-active-per-client index must ignore templates ------------------------
--    (NULLs are already distinct in a unique index, but be explicit.)
drop index if exists public.uniq_one_active_program_per_user;
create unique index if not exists uniq_one_active_program_per_user
  on public.programs (user_id)
  where status = 'active' and user_id is not null;

-- 3) start_date guard must not apply to templates -----------------------------
--    A template's start_date is meaningless boilerplate; only real assignments
--    are held to "cannot start in the past".
create or replace function public.guard_program_start_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_template then
    return new;
  end if;
  if new.start_date < current_date
     and (tg_op = 'INSERT' or new.start_date is distinct from old.start_date)
     and auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'program start_date cannot be in the past';
  end if;
  return new;
end;
$$;

-- 4) save_coach_program: p_client_id NULL now means "save a template" ---------
--    Same signature, so this is a plain replace. Everything else is unchanged.
create or replace function public.save_coach_program(
  p_program_id uuid,
  p_client_id  uuid,   -- NULL => template
  p_header     jsonb,
  p_days       jsonb,
  p_weeks      jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_program_id  uuid;
  v_day         jsonb;
  v_day_id      uuid;
  v_is_template boolean := p_client_id is null;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage programs' using errcode = '42501';
  end if;

  if p_program_id is null then
    insert into public.programs
      (user_id, assigned_by, source, name, description, focus, duration_weeks,
       start_date, status, progression_rule, tempo_default, notes, is_template)
    values
      (p_client_id, auth.uid(), 'coach',
       p_header->>'name',
       nullif(p_header->>'description', ''),
       nullif(p_header->>'focus', ''),
       coalesce((p_header->>'duration_weeks')::int, 1),
       coalesce((p_header->>'start_date')::date, current_date),
       -- For a TEMPLATE, status means library shelf-state: 'active' = available
       -- to assign, 'archived' = retired (templates are never deleted). It can
       -- never collide with the one-active-per-CLIENT rule, since that index and
       -- trigger both ignore rows with a null user_id.
       coalesce(nullif(p_header->>'status', ''), 'active'),
       nullif(p_header->>'progression_rule', ''),
       nullif(p_header->>'tempo_default', ''),
       nullif(p_header->>'notes', ''),
       v_is_template)
    returning id into v_program_id;
  else
    update public.programs set
       name             = p_header->>'name',
       description      = nullif(p_header->>'description', ''),
       focus            = nullif(p_header->>'focus', ''),
       duration_weeks   = coalesce((p_header->>'duration_weeks')::int, 1),
       start_date       = coalesce((p_header->>'start_date')::date, start_date),
       status           = case when is_template then status
                               else coalesce(nullif(p_header->>'status', ''), 'active') end,
       progression_rule = nullif(p_header->>'progression_rule', ''),
       tempo_default    = nullif(p_header->>'tempo_default', ''),
       notes            = nullif(p_header->>'notes', ''),
       updated_at       = now()
     where id = p_program_id
    returning id into v_program_id;

    if v_program_id is null then
      raise exception 'Program % not found', p_program_id using errcode = 'no_data_found';
    end if;

    delete from public.program_days  where program_id = v_program_id;
    delete from public.program_weeks where program_id = v_program_id;
  end if;

  for v_day in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    insert into public.program_days (program_id, day_index, label, weekday, sort_order)
    values (v_program_id,
        (v_day->>'day_index')::int,
        nullif(v_day->>'label', ''),
        nullif(v_day->>'weekday', ''),
        coalesce((v_day->>'sort_order')::int, 0))
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order)
    select v_day_id,
        nullif(e->>'exercise_id', '')::uuid,
        nullif(e->>'custom_name', ''),
        coalesce((e->>'sets')::int, 3),
        nullif(e->>'rep_min', '')::int,
        nullif(e->>'rep_max', '')::int,
        coalesce((e->>'is_unilateral')::boolean, false),
        nullif(e->>'rir_min', '')::int,
        nullif(e->>'rir_max', '')::int,
        nullif(e->>'load_pct_1rm', '')::int,
        nullif(e->>'load_qualitative', ''),
        nullif(e->>'tempo', ''),
        nullif(e->>'rest_seconds', '')::int,
        nullif(e->>'notes', ''),
        coalesce((e->>'sort_order')::int, 0)
    from jsonb_array_elements(coalesce(v_day->'exercises', '[]'::jsonb)) as e;
  end loop;

  insert into public.program_weeks
    (program_id, week_number, label, rir_min, rir_max, load_pct_min, load_pct_max,
     is_deload, sets_override, notes)
  select v_program_id,
      (w->>'week_number')::int,
      nullif(w->>'label', ''),
      nullif(w->>'rir_min', '')::int,
      nullif(w->>'rir_max', '')::int,
      nullif(w->>'load_pct_min', '')::int,
      nullif(w->>'load_pct_max', '')::int,
      coalesce((w->>'is_deload')::boolean, false),
      nullif(w->>'sets_override', '')::int,
      nullif(w->>'notes', '')
  from jsonb_array_elements(coalesce(p_weeks, '[]'::jsonb)) as w;

  return v_program_id;
end;
$$;

-- 5) Assign a template to a client: deep-copy the whole graph ------------------
--    The copy is a snapshot (later template edits don't touch it) and becomes
--    the client's ACTIVE program — the single-active trigger auto-archives
--    whatever they were on before.
create or replace function public.assign_program_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date default current_date
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
  v_day    record;
  v_day_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may assign programs' using errcode = '42501';
  end if;

  if not exists (select 1 from public.programs
                  where id = p_template_id and is_template) then
    raise exception 'Template % not found', p_template_id using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.programs
              where id = p_template_id and is_template and status <> 'active') then
    raise exception 'Template % is archived — restore it before assigning', p_template_id;
  end if;

  insert into public.programs
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, progression_rule, tempo_default, notes,
     is_template, template_id)
  select p_client_id, auth.uid(), 'coach', t.name, t.description, t.focus,
         t.duration_weeks, coalesce(p_start_date, current_date), 'active',
         t.progression_rule, t.tempo_default, t.notes, false, t.id
    from public.programs t
   where t.id = p_template_id
  returning id into v_new_id;

  for v_day in
    select * from public.program_days where program_id = p_template_id order by sort_order, day_index
  loop
    insert into public.program_days (program_id, day_index, label, weekday, sort_order)
    values (v_new_id, v_day.day_index, v_day.label, v_day.weekday, v_day.sort_order)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order)
    select v_day_id, e.exercise_id, e.custom_name, e.sets, e.rep_min, e.rep_max, e.is_unilateral,
           e.rir_min, e.rir_max, e.load_pct_1rm, e.load_qualitative, e.tempo, e.rest_seconds,
           e.notes, e.sort_order
      from public.program_exercises e
     where e.program_day_id = v_day.id;
  end loop;

  insert into public.program_weeks
    (program_id, week_number, label, rir_min, rir_max, load_pct_min, load_pct_max,
     is_deload, sets_override, notes)
  select v_new_id, w.week_number, w.label, w.rir_min, w.rir_max, w.load_pct_min,
         w.load_pct_max, w.is_deload, w.sets_override, w.notes
    from public.program_weeks w
   where w.program_id = p_template_id;

  return v_new_id;
end;
$$;

revoke all     on function public.assign_program_template(uuid, uuid, date) from public;
grant  execute on function public.assign_program_template(uuid, uuid, date) to authenticated;

-- 6) Promote a client's one-off program into a reusable template --------------
--    The mirror of assign_program_template: copies the graph back out into an
--    ownerless library entry, so a block built for one client can be reused.
--    The source program is left untouched.
create or replace function public.save_program_as_template(
  p_program_id uuid,
  p_name       text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
  v_day    record;
  v_day_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage programs' using errcode = '42501';
  end if;

  if not exists (select 1 from public.programs where id = p_program_id) then
    raise exception 'Program % not found', p_program_id using errcode = 'no_data_found';
  end if;

  insert into public.programs
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, progression_rule, tempo_default, notes,
     is_template, template_id)
  select null, auth.uid(), 'coach',
         coalesce(nullif(btrim(p_name), ''), p.name),
         p.description, p.focus, p.duration_weeks,
         current_date, 'active',
         p.progression_rule, p.tempo_default, p.notes,
         true, null
    from public.programs p
   where p.id = p_program_id
  returning id into v_new_id;

  for v_day in
    select * from public.program_days where program_id = p_program_id order by sort_order, day_index
  loop
    insert into public.program_days (program_id, day_index, label, weekday, sort_order)
    values (v_new_id, v_day.day_index, v_day.label, v_day.weekday, v_day.sort_order)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order)
    select v_day_id, e.exercise_id, e.custom_name, e.sets, e.rep_min, e.rep_max, e.is_unilateral,
           e.rir_min, e.rir_max, e.load_pct_1rm, e.load_qualitative, e.tempo, e.rest_seconds,
           e.notes, e.sort_order
      from public.program_exercises e
     where e.program_day_id = v_day.id;
  end loop;

  insert into public.program_weeks
    (program_id, week_number, label, rir_min, rir_max, load_pct_min, load_pct_max,
     is_deload, sets_override, notes)
  select v_new_id, w.week_number, w.label, w.rir_min, w.rir_max, w.load_pct_min,
         w.load_pct_max, w.is_deload, w.sets_override, w.notes
    from public.program_weeks w
   where w.program_id = p_program_id;

  -- Claim the source program for the new template. Without this the client who
  -- inspired the template wouldn't appear under "Clientes asignados" — they ARE
  -- running it, so the library should say so. Only ever fills a null.
  update public.programs
     set template_id = v_new_id, updated_at = now()
   where id = p_program_id
     and template_id is null
     and not is_template;

  return v_new_id;
end;
$$;

revoke all     on function public.save_program_as_template(uuid, text) from public;
grant  execute on function public.save_program_as_template(uuid, text) to authenticated;

commit;

-- Verify:
--   select count(*) from public.programs where is_template;            -- library size
--   select name, user_id, template_id from public.programs order by created_at desc limit 5;
