-- ==========================================================================
-- Coach Nutrition Plans: carb-cycled protocols (see docs/COACH-NUTRITION-SPEC.md).
-- Represents what a coach hands a client today as a PDF — meal slots, rotation
-- options within each slot, food items whose visibility depends on the DAY TYPE
-- (training vs rest), and a macro target table per day type.
--
-- Shape mirrors the programs graph one tier deeper, because the source document
-- has one:
--
--   nutrition_plans           <- programs           (user_id null => template)
--     nutrition_plan_targets  <- program_weeks      (macro targets per day type)
--     nutrition_plan_meals    <- program_days       (Desayuno, Almuerzo, ...)
--       nutrition_plan_options                      ("Opción 1", "Día 1-2")
--         ..._option_items    <- program_exercises  (food + quantity, NO macros)
--
-- day_type lives on the ITEM, not the option: "Almuerzo Día 1-2" is one option
-- holding arroz (training only) + pollo (both), so the same row shows two foods
-- on a training day and one on a rest day. That IS the carb cycling.
--
-- The coach prescribes WHAT to eat, never its macros. Macros are measured, not
-- prescribed: the client photographs the plate and the AI estimator fills
-- meal_items. The only numbers a coach enters are the plan-level TARGETS in
-- nutrition_plan_targets, which is what the measured intake is compared against.
--
-- Templates use the same convention as programs: a template is a plan row with
-- user_id IS NULL and is_template = true; assigning deep-copies the graph, so
-- editing the library never mutates a client's running phase.
--
-- Read-only to clients apart from the diary write-back (see meal_items.
-- plan_option_id at the bottom). Reuses the single-coach model from
-- 20260707120000_coaching_platform (is_coach(), client-self-scoped).
--
-- Additive, idempotent, drift-safe. Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/_/sql  (the user applies SQL there,
-- not via `supabase db push`).
-- ==========================================================================

begin;

-- 1) nutrition_plans — the protocol -----------------------------------------
--    user_id is NULLABLE: null means this row is a library template, which is
--    also why it can never leak to a client (the app fetches user_id = me).
create table if not exists public.nutrition_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,           -- client; null => template
  assigned_by uuid references public.profiles(id) on delete set null,      -- coach
  source text not null default 'coach' check (source in ('coach')),
  name text not null,
  description text,
  focus text,                              -- e.g. "Ciclado de carbohidratos"
  -- A nutrition phase is often open-ended, unlike a training block: null means
  -- "runs until replaced" and the client sees no week counter.
  duration_weeks int check (duration_weeks between 1 and 52),
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active','completed','archived')),
  -- false collapses the client UI to a single day type and the plan to one
  -- 'both' target row (a protocol without carb cycling).
  day_cycling boolean not null default true,
  notes text,
  is_template boolean not null default false,
  -- Provenance of an assigned copy. ON DELETE SET NULL: deleting a template must
  -- never cascade into a client's assigned plan.
  template_id uuid references public.nutrition_plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A template has no client; an assigned plan must have one.
  constraint nutrition_plans_template_shape check (
    (is_template and user_id is null) or (not is_template and user_id is not null)
  )
);
create index if not exists idx_nutrition_plans_user     on public.nutrition_plans(user_id);
create index if not exists idx_nutrition_plans_assigned on public.nutrition_plans(assigned_by);
create index if not exists idx_nutrition_plans_template on public.nutrition_plans(template_id);
create index if not exists idx_nutrition_plans_is_template
  on public.nutrition_plans(is_template) where is_template;

-- 2) nutrition_plan_targets — the macro table per day type ------------------
--    'both' is the single row used when day_cycling is false.
create table if not exists public.nutrition_plan_targets (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  day_type text not null check (day_type in ('both','training','rest')),
  kcal_min int check (kcal_min between 0 and 20000),
  kcal_max int check (kcal_max between 0 and 20000),
  protein_min_g numeric check (protein_min_g >= 0),
  protein_max_g numeric check (protein_max_g >= 0),
  carbs_min_g numeric check (carbs_min_g >= 0),
  carbs_max_g numeric check (carbs_max_g >= 0),
  fat_min_g numeric check (fat_min_g >= 0),
  fat_max_g numeric check (fat_max_g >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (plan_id, day_type),
  -- If both bounds are given, keep them ordered.
  constraint nutrition_target_kcal_order    check (kcal_min      is null or kcal_max      is null or kcal_min      <= kcal_max),
  constraint nutrition_target_protein_order check (protein_min_g is null or protein_max_g is null or protein_min_g <= protein_max_g),
  constraint nutrition_target_carbs_order   check (carbs_min_g   is null or carbs_max_g   is null or carbs_min_g   <= carbs_max_g),
  constraint nutrition_target_fat_order     check (fat_min_g     is null or fat_max_g     is null or fat_min_g     <= fat_max_g)
);
create index if not exists idx_nutrition_targets_plan on public.nutrition_plan_targets(plan_id);

-- 3) nutrition_plan_meals — the slots ---------------------------------------
--    meal_type carries six values, but meals.meal_type only allows four;
--    pre_workout/post_workout collapse to 'snack' on diary write-back (see
--    mealTypeToDiarySlot in src/utils/nutrition-plan.ts).
--    applies_to gates the whole slot: "POST-ENTRENAMIENTO (SOLO DÍAS DE
--    ENTRENAMIENTO)" is applies_to = 'training', and its notes carry the rest-day
--    substitution the client still needs to read.
create table if not exists public.nutrition_plan_meals (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.nutrition_plans(id) on delete cascade,
  slot_index int not null,                 -- 1..N, the order of the day
  label text,                              -- e.g. "Post-entrenamiento"
  meal_type text not null default 'snack' check (meal_type in
    ('breakfast','lunch','dinner','snack','pre_workout','post_workout')),
  time_hint text,                          -- e.g. "30-45 min antes de entrenar"
  applies_to text not null default 'both' check (applies_to in ('both','training','rest')),
  is_optional boolean not null default false,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (plan_id, slot_index)
);
create index if not exists idx_nutrition_meals_plan on public.nutrition_plan_meals(plan_id);

-- 4) nutrition_plan_options — the rotation tier -----------------------------
--    "Opción 1 / 2 / 3" or "Día 1-2 / Día 3-4". The client picks one.
create table if not exists public.nutrition_plan_options (
  id uuid primary key default gen_random_uuid(),
  plan_meal_id uuid not null references public.nutrition_plan_meals(id) on delete cascade,
  label text,                              -- e.g. "Día 1-2"
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_nutrition_options_meal on public.nutrition_plan_options(plan_meal_id);

-- 5) nutrition_plan_option_items — the leaf ---------------------------------
--    ONE free-text field for the food, plus the day type it survives on. No
--    quantity/amount/unit columns and no macro columns: the coach names the
--    food, and everything numeric about it is measured later from the client's
--    photo by the AI estimator (src/services/ai-nutrition.ts).
--
--    name being free text means a coach who WANTS to state a portion just types
--    it ("Arroz 110 g") — the column does not care, and no UI forces the issue.
--    A structured quantity would have forced it on every row.
--
--    Plan-level macro TARGETS still exist (nutrition_plan_targets above) — that
--    is what the measured intake gets compared against.
create table if not exists public.nutrition_plan_option_items (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.nutrition_plan_options(id) on delete cascade,
  name text not null,
  day_type text not null default 'both' check (day_type in ('both','training','rest')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_nutrition_items_option on public.nutrition_plan_option_items(option_id);

-- 6) Diary provenance --------------------------------------------------------
--    When a client taps "Registrar en mi diario", the resulting meal_items carry
--    the option they came from — that link is the whole adherence signal.
--
--    Deliberately NOT setting meals.assigned_by on those rows: the client is the
--    author and must stay able to correct the portion they actually ate. The
--    restrictive policies in 20260707120000_coaching_platform (99-107) would
--    otherwise make their own diary read-only to them.
alter table public.meal_items
  add column if not exists plan_option_id uuid
    references public.nutrition_plan_options(id) on delete set null;
create index if not exists idx_meal_items_plan_option
  on public.meal_items(plan_option_id) where plan_option_id is not null;

-- 7) start_date may not be in the past (API writers only) -------------------
--    Mirrors guard_program_start_date: templates are exempt (their start_date is
--    meaningless boilerplate), and direct DB / SQL-editor seeds (auth.uid() null)
--    plus the service role are exempt so fixtures can set any date.
create or replace function public.guard_nutrition_plan_start_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_template then
    return new;
  end if;
  if new.start_date < current_date
     and (tg_op = 'INSERT' or new.start_date is distinct from old.start_date)
     and auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'nutrition plan start_date cannot be in the past';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_nutrition_plan_start_date on public.nutrition_plans;
create trigger trg_guard_nutrition_plan_start_date
  before insert or update on public.nutrition_plans
  for each row execute function public.guard_nutrition_plan_start_date();

-- 8) One active plan per client ---------------------------------------------
--    The app fetches the single active plan (status='active' limit 1), so a
--    second active row would be silently hidden. Setting one active demotes the
--    client's others — activating the next phase just retires the previous one,
--    with no hard failure. Templates are exempt: for them 'active' means library
--    shelf-state, and their null user_id can never match the demotion filter.
create or replace function public.enforce_single_active_nutrition_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and new.user_id is not null then
    update public.nutrition_plans
       set status = 'archived', updated_at = now()
     where user_id = new.user_id
       and id <> new.id
       and status = 'active';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_single_active_nutrition_plan on public.nutrition_plans;
create trigger trg_enforce_single_active_nutrition_plan
  before insert or update of status on public.nutrition_plans
  for each row when (new.status = 'active')
  execute function public.enforce_single_active_nutrition_plan();

-- Backstop, enforced by the engine. Templates (null user_id) are excluded.
create unique index if not exists uniq_one_active_nutrition_plan_per_user
  on public.nutrition_plans (user_id)
  where status = 'active' and user_id is not null;

-- 9) RLS ---------------------------------------------------------------------
alter table public.nutrition_plans             enable row level security;
alter table public.nutrition_plan_targets      enable row level security;
alter table public.nutrition_plan_meals        enable row level security;
alter table public.nutrition_plan_options      enable row level security;
alter table public.nutrition_plan_option_items enable row level security;

-- Coach: full access to everything (single-coach model).
drop policy if exists "coach all nutrition_plans" on public.nutrition_plans;
create policy "coach all nutrition_plans" on public.nutrition_plans for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach all nutrition_plan_targets" on public.nutrition_plan_targets;
create policy "coach all nutrition_plan_targets" on public.nutrition_plan_targets for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach all nutrition_plan_meals" on public.nutrition_plan_meals;
create policy "coach all nutrition_plan_meals" on public.nutrition_plan_meals for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach all nutrition_plan_options" on public.nutrition_plan_options;
create policy "coach all nutrition_plan_options" on public.nutrition_plan_options for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach all nutrition_plan_option_items" on public.nutrition_plan_option_items;
create policy "coach all nutrition_plan_option_items" on public.nutrition_plan_option_items for all
  using (public.is_coach()) with check (public.is_coach());

-- Client: read-only on their own plan (no insert/update/delete). Children scope
-- through their parent; a template's null user_id never equals auth.uid(), so
-- the library is invisible to clients by construction.
drop policy if exists "client reads own nutrition_plans" on public.nutrition_plans;
create policy "client reads own nutrition_plans" on public.nutrition_plans for select
  using (user_id = auth.uid());
drop policy if exists "client reads own nutrition_plan_targets" on public.nutrition_plan_targets;
create policy "client reads own nutrition_plan_targets" on public.nutrition_plan_targets for select
  using (exists (select 1 from public.nutrition_plans p
                 where p.id = plan_id and p.user_id = auth.uid()));
drop policy if exists "client reads own nutrition_plan_meals" on public.nutrition_plan_meals;
create policy "client reads own nutrition_plan_meals" on public.nutrition_plan_meals for select
  using (exists (select 1 from public.nutrition_plans p
                 where p.id = plan_id and p.user_id = auth.uid()));
drop policy if exists "client reads own nutrition_plan_options" on public.nutrition_plan_options;
create policy "client reads own nutrition_plan_options" on public.nutrition_plan_options for select
  using (exists (select 1 from public.nutrition_plan_meals m
                 join public.nutrition_plans p on p.id = m.plan_id
                 where m.id = plan_meal_id and p.user_id = auth.uid()));
drop policy if exists "client reads own nutrition_plan_option_items" on public.nutrition_plan_option_items;
create policy "client reads own nutrition_plan_option_items" on public.nutrition_plan_option_items for select
  using (exists (select 1 from public.nutrition_plan_options o
                 join public.nutrition_plan_meals m on m.id = o.plan_meal_id
                 join public.nutrition_plans p on p.id = m.plan_id
                 where o.id = option_id and p.user_id = auth.uid()));

-- 10) Grants -----------------------------------------------------------------
grant select, insert, update, delete on public.nutrition_plans             to authenticated;
grant select, insert, update, delete on public.nutrition_plan_targets      to authenticated;
grant select, insert, update, delete on public.nutrition_plan_meals        to authenticated;
grant select, insert, update, delete on public.nutrition_plan_options      to authenticated;
grant select, insert, update, delete on public.nutrition_plan_option_items to authenticated;

-- 11) save_nutrition_plan — the whole graph in one transaction ---------------
--     p_client_id NULL means "save a template", exactly as save_coach_program
--     does. Editing replaces the child graph wholesale (delete + reinsert), so a
--     partially-saved plan is impossible.
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
  v_plan_id     uuid;
  v_meal        jsonb;
  v_meal_id     uuid;
  v_option      jsonb;
  v_option_id   uuid;
  v_is_template boolean := p_client_id is null;
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
       -- For a TEMPLATE, status means library shelf-state: 'active' = available
       -- to assign, 'archived' = retired (templates are never deleted). It can
       -- never collide with the one-active-per-CLIENT rule, since that index and
       -- trigger both ignore rows with a null user_id.
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

    -- Options and items cascade from meals; targets are their own branch.
    delete from public.nutrition_plan_meals   where plan_id = v_plan_id;
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

    for v_option in select * from jsonb_array_elements(coalesce(v_meal->'options', '[]'::jsonb))
    loop
      insert into public.nutrition_plan_options (plan_meal_id, label, notes, sort_order)
      values (v_meal_id,
          nullif(v_option->>'label', ''),
          nullif(v_option->>'notes', ''),
          coalesce((v_option->>'sort_order')::int, 0))
      returning id into v_option_id;

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

  return v_plan_id;
end;
$$;

revoke all     on function public.save_nutrition_plan(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant  execute on function public.save_nutrition_plan(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- 12) Assign a template to a client: deep-copy the whole graph ---------------
--     The copy is a snapshot (later template edits don't touch it) and becomes
--     the client's ACTIVE plan — the single-active trigger auto-archives
--     whatever they were on before.
create or replace function public.assign_nutrition_plan_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date default current_date
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id    uuid;
  v_meal      record;
  v_meal_id   uuid;
  v_option    record;
  v_option_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may assign nutrition plans' using errcode = '42501';
  end if;

  if not exists (select 1 from public.nutrition_plans
                  where id = p_template_id and is_template) then
    raise exception 'Nutrition template % not found', p_template_id using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.nutrition_plans
              where id = p_template_id and is_template and status <> 'active') then
    raise exception 'Nutrition template % is archived — restore it before assigning', p_template_id;
  end if;

  insert into public.nutrition_plans
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, day_cycling, notes, is_template, template_id)
  select p_client_id, auth.uid(), 'coach', t.name, t.description, t.focus,
         t.duration_weeks, coalesce(p_start_date, current_date), 'active',
         t.day_cycling, t.notes, false, t.id
    from public.nutrition_plans t
   where t.id = p_template_id
  returning id into v_new_id;

  insert into public.nutrition_plan_targets
    (plan_id, day_type, kcal_min, kcal_max, protein_min_g, protein_max_g,
     carbs_min_g, carbs_max_g, fat_min_g, fat_max_g, notes)
  select v_new_id, t.day_type, t.kcal_min, t.kcal_max, t.protein_min_g, t.protein_max_g,
         t.carbs_min_g, t.carbs_max_g, t.fat_min_g, t.fat_max_g, t.notes
    from public.nutrition_plan_targets t
   where t.plan_id = p_template_id;

  for v_meal in
    select * from public.nutrition_plan_meals
     where plan_id = p_template_id order by sort_order, slot_index
  loop
    insert into public.nutrition_plan_meals
      (plan_id, slot_index, label, meal_type, time_hint, applies_to, is_optional,
       notes, sort_order)
    values (v_new_id, v_meal.slot_index, v_meal.label, v_meal.meal_type, v_meal.time_hint,
            v_meal.applies_to, v_meal.is_optional, v_meal.notes, v_meal.sort_order)
    returning id into v_meal_id;

    for v_option in
      select * from public.nutrition_plan_options
       where plan_meal_id = v_meal.id order by sort_order
    loop
      insert into public.nutrition_plan_options (plan_meal_id, label, notes, sort_order)
      values (v_meal_id, v_option.label, v_option.notes, v_option.sort_order)
      returning id into v_option_id;

      insert into public.nutrition_plan_option_items
        (option_id, name, day_type, sort_order)
      select v_option_id, i.name, i.day_type, i.sort_order
        from public.nutrition_plan_option_items i
       where i.option_id = v_option.id;
    end loop;
  end loop;

  return v_new_id;
end;
$$;

revoke all     on function public.assign_nutrition_plan_template(uuid, uuid, date) from public;
grant  execute on function public.assign_nutrition_plan_template(uuid, uuid, date) to authenticated;

-- 13) Promote a client's one-off plan into a reusable template ---------------
--     The mirror of assign_nutrition_plan_template: copies the graph back out
--     into an ownerless library entry. The source plan is left untouched apart
--     from claiming its provenance.
create or replace function public.save_nutrition_plan_as_template(
  p_plan_id uuid,
  p_name    text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id    uuid;
  v_meal      record;
  v_meal_id   uuid;
  v_option    record;
  v_option_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage nutrition plans' using errcode = '42501';
  end if;

  if not exists (select 1 from public.nutrition_plans where id = p_plan_id) then
    raise exception 'Nutrition plan % not found', p_plan_id using errcode = 'no_data_found';
  end if;

  insert into public.nutrition_plans
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, day_cycling, notes, is_template, template_id)
  select null, auth.uid(), 'coach',
         coalesce(nullif(btrim(p_name), ''), p.name),
         p.description, p.focus, p.duration_weeks,
         current_date, 'active',
         p.day_cycling, p.notes, true, null
    from public.nutrition_plans p
   where p.id = p_plan_id
  returning id into v_new_id;

  insert into public.nutrition_plan_targets
    (plan_id, day_type, kcal_min, kcal_max, protein_min_g, protein_max_g,
     carbs_min_g, carbs_max_g, fat_min_g, fat_max_g, notes)
  select v_new_id, t.day_type, t.kcal_min, t.kcal_max, t.protein_min_g, t.protein_max_g,
         t.carbs_min_g, t.carbs_max_g, t.fat_min_g, t.fat_max_g, t.notes
    from public.nutrition_plan_targets t
   where t.plan_id = p_plan_id;

  for v_meal in
    select * from public.nutrition_plan_meals
     where plan_id = p_plan_id order by sort_order, slot_index
  loop
    insert into public.nutrition_plan_meals
      (plan_id, slot_index, label, meal_type, time_hint, applies_to, is_optional,
       notes, sort_order)
    values (v_new_id, v_meal.slot_index, v_meal.label, v_meal.meal_type, v_meal.time_hint,
            v_meal.applies_to, v_meal.is_optional, v_meal.notes, v_meal.sort_order)
    returning id into v_meal_id;

    for v_option in
      select * from public.nutrition_plan_options
       where plan_meal_id = v_meal.id order by sort_order
    loop
      insert into public.nutrition_plan_options (plan_meal_id, label, notes, sort_order)
      values (v_meal_id, v_option.label, v_option.notes, v_option.sort_order)
      returning id into v_option_id;

      insert into public.nutrition_plan_option_items
        (option_id, name, day_type, sort_order)
      select v_option_id, i.name, i.day_type, i.sort_order
        from public.nutrition_plan_option_items i
       where i.option_id = v_option.id;
    end loop;
  end loop;

  -- Claim the source plan for the new template. Without this the client who
  -- inspired the template wouldn't appear under "Clientes asignados" — they ARE
  -- running it, so the library should say so. Only ever fills a null.
  update public.nutrition_plans
     set template_id = v_new_id, updated_at = now()
   where id = p_plan_id
     and template_id is null
     and not is_template;

  return v_new_id;
end;
$$;

revoke all     on function public.save_nutrition_plan_as_template(uuid, text) from public;
grant  execute on function public.save_nutrition_plan_as_template(uuid, text) to authenticated;

commit;

-- Verify:
--   select count(*) from public.nutrition_plans where is_template;   -- library size
--   select name, user_id, template_id, status from public.nutrition_plans
--     order by created_at desc limit 5;
--   -- a plan's full graph:
--   select m.slot_index, m.label, o.label, i.name, i.quantity, i.day_type
--     from public.nutrition_plan_meals m
--     join public.nutrition_plan_options o on o.plan_meal_id = m.id
--     join public.nutrition_plan_option_items i on i.option_id = o.id
--    where m.plan_id = '<plan-id>'
--    order by m.slot_index, o.sort_order, i.sort_order;
