-- ==========================================================================
-- Coach Supplement Plans (see docs/COACH-NUTRITION-SPEC.md).
--
-- The second half of the coach's nutrition document, kept as a SEPARATE
-- assignable plan: a coach swaps diets far more often than they swap supplement
-- stacks, so binding the two would force a rebuild every phase.
--
-- Flatter than the nutrition graph — a plan is just a tiered list:
--
--   supplement_plans          <- nutrition_plans  (user_id null => template)
--     supplement_plan_items                       (name, tier, dose, timing)
--
-- The source document's closing "RECOMENDACIONES DE HORARIO DE SUPLEMENTACION"
-- table is NOT stored: it is a `group by timing_slot` over these rows. That
-- falls out for free — Cafeína and Citrulina both sit at timing_slot
-- 'pre_workout' with applies_to 'training', so they collapse into one
-- "Pre-entreno (30-45 min)" line and drop off entirely on a rest day.
--
-- Same conventions as 20260807120000_nutrition_plans: templates via a null
-- user_id, deep-copy on assign, one active plan per client, coach-writes /
-- client-reads RLS from 20260707120000_coaching_platform.
--
-- Additive, idempotent, drift-safe. Run in the Supabase SQL editor:
-- https://supabase.com/dashboard/project/_/sql  (the user applies SQL there,
-- not via `supabase db push`).
-- ==========================================================================

begin;

-- 1) supplement_plans — the stack --------------------------------------------
create table if not exists public.supplement_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,           -- client; null => template
  assigned_by uuid references public.profiles(id) on delete set null,      -- coach
  source text not null default 'coach' check (source in ('coach')),
  name text not null,
  description text,
  start_date date not null default current_date,
  status text not null default 'active' check (status in ('active','completed','archived')),
  notes text,
  is_template boolean not null default false,
  template_id uuid references public.supplement_plans(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplement_plans_template_shape check (
    (is_template and user_id is null) or (not is_template and user_id is not null)
  )
);
create index if not exists idx_supplement_plans_user     on public.supplement_plans(user_id);
create index if not exists idx_supplement_plans_assigned on public.supplement_plans(assigned_by);
create index if not exists idx_supplement_plans_template on public.supplement_plans(template_id);
create index if not exists idx_supplement_plans_is_template
  on public.supplement_plans(is_template) where is_template;

-- 2) supplement_plan_items ---------------------------------------------------
--    tier mirrors the document's three sections: A. base (obligatorios),
--    B. conditional (según tolerancia), C. optional (menor prioridad).
--    timing_slot is the enum the schedule table groups by; timing_note keeps the
--    coach's own phrasing ("Cualquier horario fijo, preferible post-entreno").
create table if not exists public.supplement_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.supplement_plans(id) on delete cascade,
  name text not null,                      -- e.g. "Creatina Monohidrato"
  tier text not null default 'base' check (tier in ('base','conditional','optional')),
  dose text,                               -- e.g. "5 g al día"
  timing_slot text not null default 'any' check (timing_slot in
    ('wake','breakfast','pre_workout','intra_workout','post_workout',
     'lunch','dinner','bedtime','any')),
  timing_note text,
  purpose text,                            -- e.g. "Mejorar fuerza y volumen muscular"
  notes text,                              -- e.g. "No requiere fase de carga"
  applies_to text not null default 'both' check (applies_to in ('both','training','rest')),
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_supplement_items_plan on public.supplement_plan_items(plan_id);

-- 3) start_date may not be in the past (API writers only) -------------------
--    Mirrors guard_nutrition_plan_start_date exactly.
create or replace function public.guard_supplement_plan_start_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.is_template then
    return new;
  end if;
  if new.start_date < current_date
     and (tg_op = 'INSERT' or new.start_date is distinct from old.start_date)
     and auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'supplement plan start_date cannot be in the past';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_supplement_plan_start_date on public.supplement_plans;
create trigger trg_guard_supplement_plan_start_date
  before insert or update on public.supplement_plans
  for each row execute function public.guard_supplement_plan_start_date();

-- 4) One active plan per client ---------------------------------------------
create or replace function public.enforce_single_active_supplement_plan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'active' and new.user_id is not null then
    update public.supplement_plans
       set status = 'archived', updated_at = now()
     where user_id = new.user_id
       and id <> new.id
       and status = 'active';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_enforce_single_active_supplement_plan on public.supplement_plans;
create trigger trg_enforce_single_active_supplement_plan
  before insert or update of status on public.supplement_plans
  for each row when (new.status = 'active')
  execute function public.enforce_single_active_supplement_plan();

create unique index if not exists uniq_one_active_supplement_plan_per_user
  on public.supplement_plans (user_id)
  where status = 'active' and user_id is not null;

-- 5) RLS ---------------------------------------------------------------------
alter table public.supplement_plans      enable row level security;
alter table public.supplement_plan_items enable row level security;

drop policy if exists "coach all supplement_plans" on public.supplement_plans;
create policy "coach all supplement_plans" on public.supplement_plans for all
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach all supplement_plan_items" on public.supplement_plan_items;
create policy "coach all supplement_plan_items" on public.supplement_plan_items for all
  using (public.is_coach()) with check (public.is_coach());

drop policy if exists "client reads own supplement_plans" on public.supplement_plans;
create policy "client reads own supplement_plans" on public.supplement_plans for select
  using (user_id = auth.uid());
drop policy if exists "client reads own supplement_plan_items" on public.supplement_plan_items;
create policy "client reads own supplement_plan_items" on public.supplement_plan_items for select
  using (exists (select 1 from public.supplement_plans p
                 where p.id = plan_id and p.user_id = auth.uid()));

-- 6) Grants ------------------------------------------------------------------
grant select, insert, update, delete on public.supplement_plans      to authenticated;
grant select, insert, update, delete on public.supplement_plan_items to authenticated;

-- 7) save_supplement_plan ----------------------------------------------------
--    p_client_id NULL means "save a template".
create or replace function public.save_supplement_plan(
  p_plan_id   uuid,
  p_client_id uuid,   -- NULL => template
  p_header    jsonb,
  p_items     jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_plan_id     uuid;
  v_is_template boolean := p_client_id is null;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage supplement plans' using errcode = '42501';
  end if;

  if p_plan_id is null then
    insert into public.supplement_plans
      (user_id, assigned_by, source, name, description, start_date, status, notes, is_template)
    values
      (p_client_id, auth.uid(), 'coach',
       p_header->>'name',
       nullif(p_header->>'description', ''),
       coalesce((p_header->>'start_date')::date, current_date),
       coalesce(nullif(p_header->>'status', ''), 'active'),
       nullif(p_header->>'notes', ''),
       v_is_template)
    returning id into v_plan_id;
  else
    update public.supplement_plans set
       name        = p_header->>'name',
       description = nullif(p_header->>'description', ''),
       start_date  = coalesce((p_header->>'start_date')::date, start_date),
       status      = case when is_template then status
                          else coalesce(nullif(p_header->>'status', ''), 'active') end,
       notes       = nullif(p_header->>'notes', ''),
       updated_at  = now()
     where id = p_plan_id
    returning id into v_plan_id;

    if v_plan_id is null then
      raise exception 'Supplement plan % not found', p_plan_id using errcode = 'no_data_found';
    end if;

    delete from public.supplement_plan_items where plan_id = v_plan_id;
  end if;

  insert into public.supplement_plan_items
    (plan_id, name, tier, dose, timing_slot, timing_note, purpose, notes,
     applies_to, sort_order)
  select v_plan_id,
      s->>'name',
      coalesce(nullif(s->>'tier', ''), 'base'),
      nullif(s->>'dose', ''),
      coalesce(nullif(s->>'timing_slot', ''), 'any'),
      nullif(s->>'timing_note', ''),
      nullif(s->>'purpose', ''),
      nullif(s->>'notes', ''),
      coalesce(nullif(s->>'applies_to', ''), 'both'),
      coalesce((s->>'sort_order')::int, 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as s
  where coalesce(btrim(s->>'name'), '') <> '';

  return v_plan_id;
end;
$$;

revoke all     on function public.save_supplement_plan(uuid, uuid, jsonb, jsonb) from public;
grant  execute on function public.save_supplement_plan(uuid, uuid, jsonb, jsonb) to authenticated;

-- 8) Assign a template to a client -------------------------------------------
create or replace function public.assign_supplement_plan_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date default current_date
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may assign supplement plans' using errcode = '42501';
  end if;

  if not exists (select 1 from public.supplement_plans
                  where id = p_template_id and is_template) then
    raise exception 'Supplement template % not found', p_template_id using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.supplement_plans
              where id = p_template_id and is_template and status <> 'active') then
    raise exception 'Supplement template % is archived — restore it before assigning', p_template_id;
  end if;

  insert into public.supplement_plans
    (user_id, assigned_by, source, name, description, start_date, status, notes,
     is_template, template_id)
  select p_client_id, auth.uid(), 'coach', t.name, t.description,
         coalesce(p_start_date, current_date), 'active', t.notes, false, t.id
    from public.supplement_plans t
   where t.id = p_template_id
  returning id into v_new_id;

  insert into public.supplement_plan_items
    (plan_id, name, tier, dose, timing_slot, timing_note, purpose, notes,
     applies_to, sort_order)
  select v_new_id, i.name, i.tier, i.dose, i.timing_slot, i.timing_note, i.purpose,
         i.notes, i.applies_to, i.sort_order
    from public.supplement_plan_items i
   where i.plan_id = p_template_id;

  return v_new_id;
end;
$$;

revoke all     on function public.assign_supplement_plan_template(uuid, uuid, date) from public;
grant  execute on function public.assign_supplement_plan_template(uuid, uuid, date) to authenticated;

-- 9) Promote a client's one-off plan into a reusable template -----------------
create or replace function public.save_supplement_plan_as_template(
  p_plan_id uuid,
  p_name    text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage supplement plans' using errcode = '42501';
  end if;

  if not exists (select 1 from public.supplement_plans where id = p_plan_id) then
    raise exception 'Supplement plan % not found', p_plan_id using errcode = 'no_data_found';
  end if;

  insert into public.supplement_plans
    (user_id, assigned_by, source, name, description, start_date, status, notes,
     is_template, template_id)
  select null, auth.uid(), 'coach',
         coalesce(nullif(btrim(p_name), ''), p.name),
         p.description, current_date, 'active', p.notes, true, null
    from public.supplement_plans p
   where p.id = p_plan_id
  returning id into v_new_id;

  insert into public.supplement_plan_items
    (plan_id, name, tier, dose, timing_slot, timing_note, purpose, notes,
     applies_to, sort_order)
  select v_new_id, i.name, i.tier, i.dose, i.timing_slot, i.timing_note, i.purpose,
         i.notes, i.applies_to, i.sort_order
    from public.supplement_plan_items i
   where i.plan_id = p_plan_id;

  -- Claim the source plan for the new template (only ever fills a null), so the
  -- client who inspired it shows under "Clientes asignados".
  update public.supplement_plans
     set template_id = v_new_id, updated_at = now()
   where id = p_plan_id
     and template_id is null
     and not is_template;

  return v_new_id;
end;
$$;

revoke all     on function public.save_supplement_plan_as_template(uuid, text) from public;
grant  execute on function public.save_supplement_plan_as_template(uuid, text) to authenticated;

commit;

-- Verify:
--   select count(*) from public.supplement_plans where is_template;  -- library size
--   -- the schedule table the PDF ends with, derived:
--   select timing_slot, string_agg(name || coalesce(' — ' || dose, ''), ' + '
--                                  order by sort_order) as stack
--     from public.supplement_plan_items
--    where plan_id = '<plan-id>' and applies_to in ('both','training')
--    group by timing_slot;
