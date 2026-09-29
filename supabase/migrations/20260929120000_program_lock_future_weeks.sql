-- ==========================================================================
-- "Solo semana actual": the coach can lock a program's future weeks.
--
-- programs.lock_future_weeks -- when true, the client can only complete the
-- trainings of the current week (7-day blocks from start_date, the week the
-- app marks "Actual") and of past weeks, and nothing before start_date.
-- Future weeks stay visible, view only. Default false = today's behaviour, so
-- every existing program stays unlocked.
--
-- Enforced by the app only: the database never rejects a write. No RLS
-- change -- clients can only read programs, so they can't switch it off, and
-- the coach already has full access.
--
-- save_coach_program, assign_program_template and save_program_as_template
-- are redefined verbatim from 20260926130000 with the flag added, so saving
-- (programs and templates), assigning and promoting keep it:
--   * save_coach_program reads p_header->>'lock_future_weeks'. A header
--     without the key saves a new program unlocked and leaves an existing
--     one as it was, so an older panel build keeps working.
--   * assign_program_template gains p_lock_future_weeks (default null = copy
--     the template's value). The old (uuid, uuid, date) signature is dropped
--     first: two overloads would leave PostgREST unable to choose. Callers
--     that pass only the first three arguments still work.
--   * save_program_as_template copies the flag into the new template.
--
-- Additive and idempotent. Run in the Supabase SQL editor BEFORE deploying a
-- panel build that sends p_lock_future_weeks.
-- ==========================================================================

begin;

-- 1) column -------------------------------------------------------------------
alter table public.programs
  add column if not exists lock_future_weeks boolean not null default false;

comment on column public.programs.lock_future_weeks is
  '"Solo semana actual": true = the client can only complete the current week (7-day blocks from start_date) and past weeks, nothing before start_date. Enforced by the app, not the database.';

-- 2) functions that write or copy programs --------------------------------------
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
  v_program_id      uuid;
  v_is_template     boolean := p_client_id is null;
  v_day             jsonb;
  v_day_id          uuid;
  v_ex              jsonb;
  v_ex_id           uuid;
  v_exercise_id     uuid;
  v_old_exercise_id uuid;
  v_keep_days       uuid[] := '{}';
  v_keep_ex         uuid[] := '{}';
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage programs' using errcode = '42501';
  end if;

  if p_program_id is null then
    insert into public.programs
      (user_id, assigned_by, source, name, description, focus, duration_weeks,
       start_date, status, progression_rule, tempo_default, notes, is_template,
       lock_future_weeks)
    values
      (p_client_id, auth.uid(), 'coach',
       p_header->>'name',
       nullif(p_header->>'description', ''),
       nullif(p_header->>'focus', ''),
       coalesce((p_header->>'duration_weeks')::int, 1),
       coalesce((p_header->>'start_date')::date, current_date),
       -- For a TEMPLATE, status means library shelf-state: 'active' = available
       -- to assign, 'archived' = retired. It can never collide with the
       -- one-active-per-CLIENT rule, since that index and trigger both ignore
       -- rows with a null user_id.
       coalesce(nullif(p_header->>'status', ''), 'active'),
       nullif(p_header->>'progression_rule', ''),
       nullif(p_header->>'tempo_default', ''),
       nullif(p_header->>'notes', ''),
       v_is_template,
       -- lock_future_weeks: a header without the key saves it unlocked.
       coalesce((p_header->>'lock_future_weeks')::boolean, false))
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
       -- lock_future_weeks: a header without the key keeps the stored value.
       lock_future_weeks = coalesce((p_header->>'lock_future_weeks')::boolean, lock_future_weeks),
       updated_at       = now()
     where id = p_program_id
    returning id into v_program_id;

    if v_program_id is null then
      raise exception 'Program % not found', p_program_id using errcode = 'no_data_found';
    end if;

    -- Park the existing days on negative day_index values so the in-place
    -- updates below can reorder days: unique (program_id, day_index) is not
    -- deferrable, so it is checked row by row and a swap would collide.
    update public.program_days d
       set day_index = -r.rn
      from (select id, row_number() over (order by day_index, id) as rn
              from public.program_days
             where program_id = v_program_id) r
     where d.id = r.id;
  end if;

  for v_day in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    -- Reuse the day only if it belongs to THIS program and no earlier element
    -- of the payload already claimed it (a duplicated id becomes a new day).
    v_day_id := nullif(v_day->>'id', '')::uuid;
    if v_day_id is not null and not (v_day_id = any(v_keep_days)) then
      update public.program_days set
          day_index  = (v_day->>'day_index')::int,
          label      = nullif(v_day->>'label', ''),
          weekday    = nullif(v_day->>'weekday', ''),
          sort_order = coalesce((v_day->>'sort_order')::int, 0)
       where id = v_day_id
         and program_id = v_program_id
      returning id into v_day_id;
    else
      v_day_id := null;
    end if;

    if v_day_id is null then
      insert into public.program_days (program_id, day_index, label, weekday, sort_order)
      values (v_program_id,
          (v_day->>'day_index')::int,
          nullif(v_day->>'label', ''),
          nullif(v_day->>'weekday', ''),
          coalesce((v_day->>'sort_order')::int, 0))
      returning id into v_day_id;
    end if;
    v_keep_days := v_keep_days || v_day_id;

    for v_ex in select * from jsonb_array_elements(coalesce(v_day->'exercises', '[]'::jsonb))
    loop
      v_ex_id       := nullif(v_ex->>'id', '')::uuid;
      v_exercise_id := nullif(v_ex->>'exercise_id', '')::uuid;

      if v_ex_id is not null and not (v_ex_id = any(v_keep_ex)) then
        -- It must belong to this program (any of its days -- moving a row to
        -- another day keeps its history) and still be the same movement.
        select pe.exercise_id into v_old_exercise_id
          from public.program_exercises pe
          join public.program_days d on d.id = pe.program_day_id
         where pe.id = v_ex_id
           and d.program_id = v_program_id;
        -- Only catalog lift A -> catalog lift B is a swap. custom <-> catalog
        -- is the same movement being named better (a typo fixed to the
        -- catalog spelling, a custom movement promoted into the catalog).
        if not found
           or (v_old_exercise_id is not null and v_exercise_id is not null
               and v_old_exercise_id <> v_exercise_id) then
          -- Swapped lift (or a foreign id): insert fresh; the old row, if it
          -- is ours, falls out with the removals below and its logs detach.
          v_ex_id := null;
        end if;
      else
        v_ex_id := null;
      end if;

      if v_ex_id is not null then
        update public.program_exercises set
            program_day_id   = v_day_id,
            exercise_id      = v_exercise_id,
            custom_name      = nullif(v_ex->>'custom_name', ''),
            sets             = coalesce((v_ex->>'sets')::int, 3),
            rep_min          = nullif(v_ex->>'rep_min', '')::int,
            rep_max          = nullif(v_ex->>'rep_max', '')::int,
            is_unilateral    = coalesce((v_ex->>'is_unilateral')::boolean, false),
            rir_min          = nullif(v_ex->>'rir_min', '')::int,
            rir_max          = nullif(v_ex->>'rir_max', '')::int,
            load_pct_1rm     = nullif(v_ex->>'load_pct_1rm', '')::int,
            load_qualitative = nullif(v_ex->>'load_qualitative', ''),
            tempo            = nullif(v_ex->>'tempo', ''),
            rest_seconds     = nullif(v_ex->>'rest_seconds', '')::int,
            notes            = nullif(v_ex->>'notes', ''),
            sort_order       = coalesce((v_ex->>'sort_order')::int, 0),
            superset_group   = nullif(v_ex->>'superset_group', ''),
            week_overrides   = coalesce(v_ex->'week_overrides', '{}'::jsonb)
         where id = v_ex_id;
      else
        insert into public.program_exercises
          (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
           rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order,
           superset_group, week_overrides)
        values (v_day_id,
            v_exercise_id,
            nullif(v_ex->>'custom_name', ''),
            coalesce((v_ex->>'sets')::int, 3),
            nullif(v_ex->>'rep_min', '')::int,
            nullif(v_ex->>'rep_max', '')::int,
            coalesce((v_ex->>'is_unilateral')::boolean, false),
            nullif(v_ex->>'rir_min', '')::int,
            nullif(v_ex->>'rir_max', '')::int,
            nullif(v_ex->>'load_pct_1rm', '')::int,
            nullif(v_ex->>'load_qualitative', ''),
            nullif(v_ex->>'tempo', ''),
            nullif(v_ex->>'rest_seconds', '')::int,
            nullif(v_ex->>'notes', ''),
            coalesce((v_ex->>'sort_order')::int, 0),
            nullif(v_ex->>'superset_group', ''),
            coalesce(v_ex->'week_overrides', '{}'::jsonb))
        returning id into v_ex_id;
      end if;
      v_keep_ex := v_keep_ex || v_ex_id;
    end loop;
  end loop;

  -- Removals: only what the coach actually deleted. Their logs survive,
  -- detached (section 1). No-ops for a brand-new program.
  delete from public.program_exercises pe
   using public.program_days d
   where d.id = pe.program_day_id
     and d.program_id = v_program_id
     and not (pe.id = any(v_keep_ex));

  delete from public.program_days
   where program_id = v_program_id
     and not (id = any(v_keep_days));

  -- Weeks have no dependents (logs store week_number, not a key), so a plain
  -- replace is still safe here.
  delete from public.program_weeks where program_id = v_program_id;

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

revoke all     on function public.save_coach_program(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant  execute on function public.save_coach_program(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- A 4th parameter makes a NEW overload next to the old one, and PostgREST
-- can't choose between two. Drop the old signature first (a no-op on re-run).
drop function if exists public.assign_program_template(uuid, uuid, date);

create or replace function public.assign_program_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date default current_date,
  -- The assign dialog's "Solo semana actual"; null = the template's own value.
  p_lock_future_weeks boolean default null
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
     is_template, template_id, lock_future_weeks)
  select p_client_id, auth.uid(), 'coach', t.name, t.description, t.focus,
         t.duration_weeks, coalesce(p_start_date, current_date), 'active',
         t.progression_rule, t.tempo_default, t.notes, false, t.id,
         -- lock_future_weeks: the dialog's choice, else the template's.
         coalesce(p_lock_future_weeks, t.lock_future_weeks)
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
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order,
       superset_group, week_overrides)
    select v_day_id, e.exercise_id, e.custom_name, e.sets, e.rep_min, e.rep_max, e.is_unilateral,
           e.rir_min, e.rir_max, e.load_pct_1rm, e.load_qualitative, e.tempo, e.rest_seconds,
           e.notes, e.sort_order, e.superset_group, e.week_overrides
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

revoke all     on function public.assign_program_template(uuid, uuid, date, boolean) from public;
grant  execute on function public.assign_program_template(uuid, uuid, date, boolean) to authenticated;

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
     is_template, template_id, lock_future_weeks)
  select null, auth.uid(), 'coach',
         coalesce(nullif(btrim(p_name), ''), p.name),
         p.description, p.focus, p.duration_weeks,
         current_date, 'active',
         p.progression_rule, p.tempo_default, p.notes,
         true, null,
         -- lock_future_weeks: the template keeps the program's setting.
         p.lock_future_weeks
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
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order,
       superset_group, week_overrides)
    select v_day_id, e.exercise_id, e.custom_name, e.sets, e.rep_min, e.rep_max, e.is_unilateral,
           e.rir_min, e.rir_max, e.load_pct_1rm, e.load_qualitative, e.tempo, e.rest_seconds,
           e.notes, e.sort_order, e.superset_group, e.week_overrides
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

-- 3) PostgREST: pick up the new column and signature (sent on commit) -----------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'programs'
--      and column_name = 'lock_future_weeks';                -- 1 row: boolean | NO | false
--   select count(*) from public.programs where lock_future_weeks;  -- 0 right after the first run
--   select pg_get_function_identity_arguments(oid) from pg_proc
--    where proname = 'assign_program_template' and pronamespace = 'public'::regnamespace;
--     -- 1 row: p_template_id uuid, p_client_id uuid, p_start_date date, p_lock_future_weeks boolean
--   select proname, prosrc like '%lock_future_weeks%' from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('save_coach_program', 'assign_program_template', 'save_program_as_template');
--     -- 3 rows, all true
--   select has_function_privilege('authenticated',
--          'public.assign_program_template(uuid, uuid, date, boolean)', 'execute');  -- true
