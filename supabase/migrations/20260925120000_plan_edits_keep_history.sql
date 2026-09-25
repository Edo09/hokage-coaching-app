-- ==========================================================================
-- Editing an assigned program or nutrition plan must never destroy the
-- client's history.
--
-- THE BUG: save_coach_program and save_nutrition_plan updated a plan by
-- deleting every child row and inserting fresh copies. For programs that
-- cascaded program_days -> program_exercises -> workout_set_logs +
-- program_exercise_completions, so a coach who opened a running block in the
-- panel and pressed "Guardar" -- even to fix a typo -- permanently erased every
-- set and check-off the client had logged against it. For nutrition the diary
-- rows survived (meal_items.plan_option_id is ON DELETE SET NULL) but every
-- save unlinked them, silently resetting plan adherence.
--
-- THE FIX, in two layers:
--   1) Both RPCs now save BY ID. Rows the panel sends back with their id are
--      updated in place, rows without one are inserted, and only rows the
--      coach actually removed are deleted. Ids stay stable across edits, so
--      logs, completions and diary links stay attached -- and the app's cached
--      program (and its offline outbox) keeps pointing at live rows.
--   2) A removed prescription no longer takes history with it. The two log
--      tables now DETACH (ON DELETE SET NULL) instead of cascading, and every
--      log carries a snapshot of the exercise name (+ laterality for sets),
--      stamped on insert, so a detached log still reads correctly.
--
-- Swapping one catalog lift for a DIFFERENT catalog lift on an existing row is
-- treated as remove + add, not an in-place edit: the sets already logged were
-- a different lift and must not be relabelled as the new one. Anything else
-- keeps the row -- editing a custom_name, fixing it to the catalog spelling,
-- or promoting a custom movement into the catalog.
--
-- The snapshot is server-owned: API clients can neither write it by hand nor
-- detach a log themselves, and a new log must point at a prescription in the
-- writer's own program (see section 1).
--
-- CONTRACT: same signatures as before. `id` on a program day/exercise or a
-- nutrition meal/option is OPTIONAL. A row without one, or with an id that
-- does not belong to the plan being saved, is inserted as new. An older panel
-- build that sends no ids therefore still works; it just can't keep row
-- identity (and layer 2 still keeps the client's history).
--
-- Additive, idempotent, drift-safe. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

-- 1) Logs keep their own label ------------------------------------------------
alter table public.workout_set_logs
  add column if not exists exercise_name text,
  add column if not exists is_unilateral boolean;
alter table public.program_exercise_completions
  add column if not exists exercise_name text;

comment on column public.workout_set_logs.exercise_name is
  'Exercise name when the set was logged (stamped by trigger). Keeps the log readable after its prescription row is removed.';
comment on column public.workout_set_logs.is_unilateral is
  'Laterality when the set was logged (stamped by trigger) -- volume counts unilateral sets x2.';
comment on column public.program_exercise_completions.exercise_name is
  'Exercise name when the check-off was made (stamped by trigger). Keeps it readable after its prescription row is removed.';

-- Backfill what already exists -- only from a prescription in the log owner's
-- OWN program, so the backfill (which runs as the table owner, outside RLS)
-- can never copy another client's prescription name into someone's log.
update public.workout_set_logs l
   set exercise_name = coalesce(e.name, pe.custom_name),
       is_unilateral = pe.is_unilateral
  from public.program_exercises pe
  join public.program_days d on d.id = pe.program_day_id
  join public.programs p on p.id = d.program_id
  left join public.exercises e on e.id = pe.exercise_id
 where pe.id = l.program_exercise_id
   and p.user_id = l.user_id
   and l.exercise_name is null;

update public.program_exercise_completions c
   set exercise_name = coalesce(e.name, pe.custom_name)
  from public.program_exercises pe
  join public.program_days d on d.id = pe.program_day_id
  join public.programs p on p.id = d.program_id
  left join public.exercises e on e.id = pe.exercise_id
 where pe.id = c.program_exercise_id
   and p.user_id = c.user_id
   and c.exercise_name is null;

-- The snapshot is server-owned. Stamped on insert (and if a log is ever
-- re-pointed); SECURITY INVOKER on purpose, so the lookup runs under the
-- writer's RLS. For an API write (auth.uid() set, issued directly -- depth 1,
-- as opposed to the FK's own ON DELETE SET NULL, which runs one trigger level
-- down, or the SQL editor / service role, which have no auth.uid()):
--   * the log must point at a prescription the writer can read -- the column
--     is nullable only so the FK can DETACH a log, never so a client can
--     create or re-point free-floating "history" (this also closes the old
--     gap where a client could log against another client's prescription);
--   * the snapshot columns can't be rewritten by hand.
create or replace function public.stamp_set_log_snapshot()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_api_write boolean := auth.uid() is not null and pg_trigger_depth() = 1;
begin
  if v_api_write and new.program_exercise_id is null
     and (tg_op = 'INSERT' or old.program_exercise_id is not null) then
    raise exception 'program_exercise_id is required' using errcode = '23502';
  end if;

  if new.program_exercise_id is not null
     and (tg_op = 'INSERT' or new.program_exercise_id is distinct from old.program_exercise_id) then
    select coalesce(e.name, pe.custom_name), pe.is_unilateral
      into new.exercise_name, new.is_unilateral
      from public.program_exercises pe
      left join public.exercises e on e.id = pe.exercise_id
     where pe.id = new.program_exercise_id;
    if not found and v_api_write then
      raise exception 'program exercise % is not in your program', new.program_exercise_id
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and v_api_write then
    new.exercise_name := old.exercise_name;
    new.is_unilateral := old.is_unilateral;
  end if;
  return new;
end;
$$;

create or replace function public.stamp_completion_snapshot()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_api_write boolean := auth.uid() is not null and pg_trigger_depth() = 1;
begin
  if v_api_write and new.program_exercise_id is null
     and (tg_op = 'INSERT' or old.program_exercise_id is not null) then
    raise exception 'program_exercise_id is required' using errcode = '23502';
  end if;

  if new.program_exercise_id is not null
     and (tg_op = 'INSERT' or new.program_exercise_id is distinct from old.program_exercise_id) then
    select coalesce(e.name, pe.custom_name)
      into new.exercise_name
      from public.program_exercises pe
      left join public.exercises e on e.id = pe.exercise_id
     where pe.id = new.program_exercise_id;
    if not found and v_api_write then
      raise exception 'program exercise % is not in your program', new.program_exercise_id
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and v_api_write then
    new.exercise_name := old.exercise_name;
  end if;
  return new;
end;
$$;

-- Every UPDATE, not just UPDATE OF program_exercise_id: the snapshot columns
-- need the same protection when they are the only thing being written.
drop trigger if exists trg_stamp_set_log_snapshot on public.workout_set_logs;
create trigger trg_stamp_set_log_snapshot
  before insert or update on public.workout_set_logs
  for each row execute function public.stamp_set_log_snapshot();

drop trigger if exists trg_stamp_completion_snapshot on public.program_exercise_completions;
create trigger trg_stamp_completion_snapshot
  before insert or update on public.program_exercise_completions
  for each row execute function public.stamp_completion_snapshot();

-- Detach instead of cascade. Referential actions bypass RLS, so the coach's
-- RPC can null these out without holding any write policy on client logs --
-- exactly as the old cascade could delete them.
alter table public.workout_set_logs
  alter column program_exercise_id drop not null;
alter table public.workout_set_logs
  drop constraint if exists workout_set_logs_program_exercise_id_fkey;
alter table public.workout_set_logs
  add constraint workout_set_logs_program_exercise_id_fkey
  foreign key (program_exercise_id) references public.program_exercises(id) on delete set null;

alter table public.program_exercise_completions
  alter column program_exercise_id drop not null;
alter table public.program_exercise_completions
  drop constraint if exists program_exercise_completions_program_exercise_id_fkey;
alter table public.program_exercise_completions
  add constraint program_exercise_completions_program_exercise_id_fkey
  foreign key (program_exercise_id) references public.program_exercises(id) on delete set null;
-- unique (user_id, program_exercise_id, week_number) stays: detached rows carry
-- a null id, and nulls are distinct, so they never collide with live ones.

-- 2) save_coach_program: save by id -------------------------------------------
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
       start_date, status, progression_rule, tempo_default, notes, is_template)
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
            sort_order       = coalesce((v_ex->>'sort_order')::int, 0)
         where id = v_ex_id;
      else
        insert into public.program_exercises
          (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
           rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order)
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
            coalesce((v_ex->>'sort_order')::int, 0))
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

-- 3) save_nutrition_plan: save by id ------------------------------------------
--    Meals and options keep their ids (options are what meal_items link to);
--    targets and option items have no dependents and are still replaced.
create or replace function public.save_nutrition_plan(
  p_plan_id   uuid,
  p_client_id uuid,   -- NULL => template
  p_header    jsonb,
  p_targets   jsonb,
  p_meals     jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_plan_id      uuid;
  v_is_template  boolean := p_client_id is null;
  v_meal         jsonb;
  v_meal_id      uuid;
  v_option       jsonb;
  v_option_id    uuid;
  v_keep_meals   uuid[] := '{}';
  v_keep_options uuid[] := '{}';
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage nutrition plans' using errcode = '42501';
  end if;

  if p_plan_id is null then
    insert into public.nutrition_plans
      (user_id, assigned_by, source, name, description, focus, duration_weeks,
       start_date, status, day_cycling, notes, is_template)
    values
      (p_client_id, auth.uid(), 'coach',
       p_header->>'name',
       nullif(p_header->>'description', ''),
       nullif(p_header->>'focus', ''),
       nullif(p_header->>'duration_weeks', '')::int,
       coalesce((p_header->>'start_date')::date, current_date),
       coalesce(nullif(p_header->>'status', ''), 'active'),
       coalesce((p_header->>'day_cycling')::boolean, true),
       nullif(p_header->>'notes', ''),
       v_is_template)
    returning id into v_plan_id;
  else
    update public.nutrition_plans set
       name           = p_header->>'name',
       description    = nullif(p_header->>'description', ''),
       focus          = nullif(p_header->>'focus', ''),
       duration_weeks = nullif(p_header->>'duration_weeks', '')::int,
       start_date     = coalesce((p_header->>'start_date')::date, start_date),
       status         = case when is_template then status
                             else coalesce(nullif(p_header->>'status', ''), 'active') end,
       day_cycling    = coalesce((p_header->>'day_cycling')::boolean, day_cycling),
       notes          = nullif(p_header->>'notes', ''),
       updated_at     = now()
     where id = p_plan_id
    returning id into v_plan_id;

    if v_plan_id is null then
      raise exception 'Nutrition plan % not found', p_plan_id using errcode = 'no_data_found';
    end if;

    -- Same parking trick as programs: unique (plan_id, slot_index) is checked
    -- row by row, so reordering slots in place needs the old values out of
    -- the way first.
    update public.nutrition_plan_meals m
       set slot_index = -r.rn
      from (select id, row_number() over (order by slot_index, id) as rn
              from public.nutrition_plan_meals
             where plan_id = v_plan_id) r
     where m.id = r.id;

    delete from public.nutrition_plan_targets where plan_id = v_plan_id;
  end if;

  insert into public.nutrition_plan_targets
    (plan_id, day_type, kcal_min, kcal_max, protein_min_g, protein_max_g,
     carbs_min_g, carbs_max_g, fat_min_g, fat_max_g, notes)
  select v_plan_id,
      coalesce(nullif(t->>'day_type', ''), 'both'),
      nullif(t->>'kcal_min', '')::int,
      nullif(t->>'kcal_max', '')::int,
      nullif(t->>'protein_min_g', '')::numeric,
      nullif(t->>'protein_max_g', '')::numeric,
      nullif(t->>'carbs_min_g', '')::numeric,
      nullif(t->>'carbs_max_g', '')::numeric,
      nullif(t->>'fat_min_g', '')::numeric,
      nullif(t->>'fat_max_g', '')::numeric,
      nullif(t->>'notes', '')
  from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) as t;

  for v_meal in select * from jsonb_array_elements(coalesce(p_meals, '[]'::jsonb))
  loop
    v_meal_id := nullif(v_meal->>'id', '')::uuid;
    if v_meal_id is not null and not (v_meal_id = any(v_keep_meals)) then
      update public.nutrition_plan_meals set
          slot_index  = (v_meal->>'slot_index')::int,
          label       = nullif(v_meal->>'label', ''),
          meal_type   = coalesce(nullif(v_meal->>'meal_type', ''), 'snack'),
          time_hint   = nullif(v_meal->>'time_hint', ''),
          applies_to  = coalesce(nullif(v_meal->>'applies_to', ''), 'both'),
          is_optional = coalesce((v_meal->>'is_optional')::boolean, false),
          notes       = nullif(v_meal->>'notes', ''),
          sort_order  = coalesce((v_meal->>'sort_order')::int, 0)
       where id = v_meal_id
         and plan_id = v_plan_id
      returning id into v_meal_id;
    else
      v_meal_id := null;
    end if;

    if v_meal_id is null then
      insert into public.nutrition_plan_meals
        (plan_id, slot_index, label, meal_type, time_hint, applies_to, is_optional,
         notes, sort_order)
      values (v_plan_id,
          (v_meal->>'slot_index')::int,
          nullif(v_meal->>'label', ''),
          coalesce(nullif(v_meal->>'meal_type', ''), 'snack'),
          nullif(v_meal->>'time_hint', ''),
          coalesce(nullif(v_meal->>'applies_to', ''), 'both'),
          coalesce((v_meal->>'is_optional')::boolean, false),
          nullif(v_meal->>'notes', ''),
          coalesce((v_meal->>'sort_order')::int, 0))
      returning id into v_meal_id;
    end if;
    v_keep_meals := v_keep_meals || v_meal_id;

    for v_option in select * from jsonb_array_elements(coalesce(v_meal->'options', '[]'::jsonb))
    loop
      -- An option may move to another slot of the same plan and keep its id
      -- (and with it every diary entry registered from it).
      v_option_id := nullif(v_option->>'id', '')::uuid;
      if v_option_id is not null and not (v_option_id = any(v_keep_options)) then
        update public.nutrition_plan_options o set
            plan_meal_id = v_meal_id,
            label        = nullif(v_option->>'label', ''),
            notes        = nullif(v_option->>'notes', ''),
            sort_order   = coalesce((v_option->>'sort_order')::int, 0)
          from public.nutrition_plan_meals m
         where o.id = v_option_id
           and m.id = o.plan_meal_id
           and m.plan_id = v_plan_id
        returning o.id into v_option_id;
      else
        v_option_id := null;
      end if;

      if v_option_id is null then
        insert into public.nutrition_plan_options (plan_meal_id, label, notes, sort_order)
        values (v_meal_id,
            nullif(v_option->>'label', ''),
            nullif(v_option->>'notes', ''),
            coalesce((v_option->>'sort_order')::int, 0))
        returning id into v_option_id;
      else
        delete from public.nutrition_plan_option_items where option_id = v_option_id;
      end if;
      v_keep_options := v_keep_options || v_option_id;

      insert into public.nutrition_plan_option_items
        (option_id, name, day_type, sort_order)
      select v_option_id,
          i->>'name',
          coalesce(nullif(i->>'day_type', ''), 'both'),
          coalesce((i->>'sort_order')::int, 0)
      from jsonb_array_elements(coalesce(v_option->'items', '[]'::jsonb)) as i
      where coalesce(btrim(i->>'name'), '') <> '';
    end loop;
  end loop;

  -- Removals: only what the coach deleted. A diary entry registered from a
  -- removed option keeps its food and macros; only its plan link clears.
  delete from public.nutrition_plan_options o
   using public.nutrition_plan_meals m
   where m.id = o.plan_meal_id
     and m.plan_id = v_plan_id
     and not (o.id = any(v_keep_options));

  delete from public.nutrition_plan_meals
   where plan_id = v_plan_id
     and not (id = any(v_keep_meals));

  return v_plan_id;
end;
$$;

revoke all     on function public.save_nutrition_plan(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant  execute on function public.save_nutrition_plan(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

commit;

-- Verify:
--   -- expect exercise_name/is_unilateral present and program_exercise_id nullable:
--   select table_name, column_name, is_nullable from information_schema.columns
--    where table_name in ('workout_set_logs', 'program_exercise_completions')
--      and column_name in ('program_exercise_id', 'exercise_name', 'is_unilateral');
--   -- expect confdeltype = 'n' (SET NULL) on both:
--   select conname, confdeltype from pg_constraint
--    where conname in ('workout_set_logs_program_exercise_id_fkey',
--                      'program_exercise_completions_program_exercise_id_fkey');
