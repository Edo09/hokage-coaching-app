-- ==========================================================================
-- Drop nutrition_plan_option_items.quantity.
--
-- The coach names the food and nothing else — no quantity, amount, or unit.
-- Everything numeric about a meal is measured from the client's photo by the AI
-- estimator (src/services/ai-nutrition.ts), never prescribed.
--
-- A coach who WANTS to state a portion still can: name is free text, so
-- "Arroz 110 g" is a legal food name. Keeping a structured quantity column
-- would have forced the decision onto every row of every plan instead.
--
-- Only needed on a database that already applied 20260807120000 in its earlier
-- form. On a fresh database that file no longer creates the column and the drop
-- below is a harmless no-op — both paths converge on the same schema.
--
-- Replaces the three RPCs that referenced the column, so this file is the only
-- thing that needs pasting. Additive, idempotent, drift-safe. Run in the
-- Supabase SQL editor.
-- ==========================================================================

begin;

alter table public.nutrition_plan_option_items drop column if exists quantity;

-- 1) save_nutrition_plan ------------------------------------------------------
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

-- 2) assign_nutrition_plan_template ------------------------------------------
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

-- 3) save_nutrition_plan_as_template -----------------------------------------
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
--   select column_name from information_schema.columns
--    where table_name = 'nutrition_plan_option_items' order by ordinal_position;
--   -- expect: id, option_id, name, day_type, sort_order, created_at
