-- ==========================================================================
-- P0 ACCEPTANCE FIXTURE — reproduces "Nutrición y suplementación fase 2.pdf"
-- in the Coach Nutrition schema (docs/COACH-NUTRITION-SPEC.md, Phase 1 exit
-- criterion).
--
-- Proves the schema is lossless before any UI exists: run it, then read the
-- plans back and compare to the source document.
--
-- Requires:
--   * 20260807120000_nutrition_plans.sql applied
--   * 20260807120100_supplement_plans.sql applied
--   * exactly one profile with role='coach'
--
-- Seeds TEMPLATES (user_id null), not client assignments — so it needs no test
-- client, and the coach can assign it from the panel like any other library
-- entry. Idempotent: it DELETES any prior copy of these two named templates
-- first, so re-running gives a clean reproduction. Run in the Supabase SQL
-- editor (auth.uid() is null there, so the past-date guard is exempt anyway).
--
-- ---------------------------------------------------------------------------
-- ONE READING DECISION, worth the coach's review:
--
--    THE TABLE COLUMNS. The source lays each meal out as
--      | ROTACIÓN | CONTENIDO (Días de Entrenamiento) | CONTENIDO (Días de Descanso) |
--    but the two content columns are not two alternative meals — they are the
--    parts of one meal, split by whether that part survives a rest day. So
--    "Almuerzo · Día 1-2 | 110 g arroz | 5 oz pechuga de pollo" is modelled as
--    ONE option holding two items: rice (day_type 'training') and chicken
--    (day_type 'both'). Read literally the other way, a training-day lunch
--    would be rice with no protein, which is not a thing anyone prescribes.
--
-- Foods below are bare NAMES — no portions, no macros. The coach names the
-- meal; everything numeric is measured from the client's photo by the AI
-- estimator. The only numbers here are the plan-level targets from the
-- document's page 2 ("DISTRIBUCION APROXIMADA"), which is what measured intake
-- gets compared against.
--
-- NOTE this makes the fixture a faithful reproduction of the source's STRUCTURE
-- but not of its portion text: the PDF says "110 g arroz", this seeds "Arroz".
-- `name` is free text, so a coach who wants the portion stated just types
-- "Arroz 110 g" — nothing in the schema or UI prevents it.
-- ==========================================================================

do $$
declare
  v_coach uuid;
  v_plan  uuid;
  v_meal  uuid;
  v_opt   uuid;
begin
  select id into v_coach from public.profiles where role = 'coach' order by created_at limit 1;
  if v_coach is null then
    raise exception 'No coach profile found — set one profile to role=''coach'' first';
  end if;

  -- ======================================================================
  -- A) NUTRITION TEMPLATE
  -- ======================================================================
  delete from public.nutrition_plans
   where is_template and name = 'Protocolo Nutricional Fase 2';

  insert into public.nutrition_plans
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, day_cycling, notes, is_template)
  values
    (null, v_coach, 'coach',
     'Protocolo Nutricional Fase 2',
     'Protocolo de fase 2 con ciclado de carbohidratos: los carbohidratos aparecen '
     || 'en los días de entrenamiento y se retiran en los días de descanso; la '
     || 'proteína se mantiene constante.',
     'Ciclado de carbohidratos',
     null,                       -- open-ended phase, no week counter
     current_date, 'active', true,
     'En días de descanso se elimina la comida post-entrenamiento o se sustituye '
     || 'por 1 scoop de proteína sola con agua.',
     true)
  returning id into v_plan;

  -- Macro targets — the document's page 2 "DISTRIBUCION APROXIMADA". The only
  -- numbers the coach enters anywhere in a nutrition plan.
  insert into public.nutrition_plan_targets
    (plan_id, day_type, kcal_min, kcal_max, protein_min_g, protein_max_g,
     carbs_min_g, carbs_max_g, fat_min_g, fat_max_g)
  values
    (v_plan, 'training', 2100, 2150, 150, 155, 220, 225, 55, 55),
    (v_plan, 'rest',     1750, 1800, 150, 155, 155, 160, 55, 55);

  -- 1. DESAYUNO -----------------------------------------------------------
  insert into public.nutrition_plan_meals
    (plan_id, slot_index, label, meal_type, applies_to, is_optional, sort_order)
  values (v_plan, 1, 'Desayuno', 'breakfast', 'both', false, 0)
  returning id into v_meal;

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 1', 0) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Huevo entero', 'both',     0),
    (v_opt, 'Claras de huevo', 'both',     1),
    (v_opt, 'Piña', 'training', 2);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 2', 1) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Proteína whey', 'both',     0),
    (v_opt, 'Avena', 'training', 1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 3', 2) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Proteína whey', 'both', 0),
    (v_opt, 'Mantequilla de almendras', 'both', 1);

  -- 2. ALMUERZO -----------------------------------------------------------
  --    Rotation is by day of the week, not by preference.
  insert into public.nutrition_plan_meals
    (plan_id, slot_index, label, meal_type, applies_to, is_optional, sort_order)
  values (v_plan, 2, 'Almuerzo', 'lunch', 'both', false, 1)
  returning id into v_meal;

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 1-2', 0) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Arroz', 'training', 0),
    (v_opt, 'Pechuga de pollo', 'both',     1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 3-4', 1) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Arroz', 'training', 0),
    (v_opt, 'Pescado blanco', 'both',     1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 5-6', 2) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Quinoa', 'training', 0),
    (v_opt, 'Carne magra de cerdo', 'both',     1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 7', 3) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Arroz', 'training', 0),
    (v_opt, 'Pechuga de pavo', 'both',     1);

  -- 3. POST-ENTRENAMIENTO (solo días de entrenamiento) --------------------
  --    applies_to gates the whole slot; the note carries the rest-day
  --    substitution the client still needs to read.
  insert into public.nutrition_plan_meals
    (plan_id, slot_index, label, meal_type, applies_to, is_optional, notes, sort_order)
  values (v_plan, 3, 'Post-entrenamiento', 'post_workout', 'training', false,
          'En días de descanso, eliminar esta comida o sustituir por 1 scoop de '
          || 'proteína sola con agua.', 2)
  returning id into v_meal;

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 1', 0) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values (v_opt, 'Proteína whey', 'both', 0);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 2', 1) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values (v_opt, 'Proteína whey', 'both', 0);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 3', 2) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values (v_opt, 'Proteína whey', 'both', 0);

  -- 4. CENA ---------------------------------------------------------------
  insert into public.nutrition_plan_meals
    (plan_id, slot_index, label, meal_type, applies_to, is_optional, sort_order)
  values (v_plan, 4, 'Cena', 'dinner', 'both', false, 3)
  returning id into v_meal;

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 1-2', 0) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Steak', 'both', 0),
    (v_opt, 'Vegetales verdes', 'both', 1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 3-4', 1) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Carne molida 95%', 'both',     0),
    (v_opt, 'Plátano maduro', 'training', 1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 5-6', 2) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Pechuga de pavo', 'both', 0),
    (v_opt, 'Espárragos', 'both', 1);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Día 7', 3) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Pescado blanco', 'both', 0),
    (v_opt, 'Vegetales verdes', 'both', 1);

  -- 5. MERIENDA OPCIONAL (igual para ambos días) --------------------------
  insert into public.nutrition_plan_meals
    (plan_id, slot_index, label, meal_type, applies_to, is_optional, sort_order)
  values (v_plan, 5, 'Merienda opcional', 'snack', 'both', true, 4)
  returning id into v_meal;

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 1', 0) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values (v_opt, 'Proteína', 'both', 0);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 2', 1) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values (v_opt, 'Proteína', 'both', 0);

  insert into public.nutrition_plan_options (plan_meal_id, label, sort_order)
  values (v_meal, 'Opción 3', 2) returning id into v_opt;
  insert into public.nutrition_plan_option_items
    (option_id, name, day_type, sort_order)
  values
    (v_opt, 'Yogur griego', 'both', 0),
    (v_opt, 'Proteína', 'both', 1);

  -- ======================================================================
  -- B) SUPPLEMENT TEMPLATE
  -- ======================================================================
  delete from public.supplement_plans
   where is_template and name = 'Suplementación Fase 2';

  insert into public.supplement_plans
    (user_id, assigned_by, source, name, description, start_date, status, notes, is_template)
  values
    (null, v_coach, 'coach',
     'Suplementación Fase 2',
     'Orientada a optimizar rendimiento, recuperación y composición corporal '
     || 'dentro del protocolo nutricional de fase 2.',
     current_date, 'active',
     'Cuando se habla de "un servicio" se refiere a la cantidad que indica el '
     || 'frasco por servicio.',
     true)
  returning id into v_plan;

  insert into public.supplement_plan_items
    (plan_id, name, tier, dose, timing_slot, timing_note, purpose, notes, applies_to, sort_order)
  values
    -- A. BASE (obligatorios / recomendados firmemente)
    (v_plan, 'Proteína Whey', 'base',
     '1 scoop (aprox. 25-30 g) en cada comida que lo indique el protocolo',
     'post_workout', 'Desayuno (opciones 2 y 3), post-entreno y merienda opcional',
     'Alcanzar los 150-155 g de proteína diarios sin exceso de calorías',
     'Aislada o concentrada de calidad.', 'both', 0),

    (v_plan, 'Creatina Monohidrato', 'base', '5 g al día',
     'post_workout',
     'Cualquier horario fijo (preferible post-entreno o con alguna comida con carbohidratos)',
     'Mejorar fuerza, rendimiento en series cortas y volumen muscular',
     'No requiere fase de carga; mantener dosis diaria constante.', 'both', 1),

    -- NOTE: the source takes Omega 3 with BOTH main meals, but timing_slot holds
    -- one value. Filed as 'lunch' with the full phrasing in timing_note, so the
    -- derived schedule shows it once rather than inventing a duplicate row.
    -- See the open question in docs/COACH-NUTRITION-SPEC.md.
    (v_plan, 'Omega 3 (EPA/DHA)', 'base', '2-3 g al día (EPA+DHA combinados)',
     'lunch', 'Con las comidas principales (almuerzo y cena)',
     'Reducir inflamación, apoyar salud articular y cardiovascular',
     null, 'both', 2),

    -- B. CONDICIONALES (según tolerancia y preferencia)
    (v_plan, 'Cafeína / Pre-entreno', 'conditional', '150-250 mg de cafeína',
     'pre_workout', '30-45 minutos antes del entrenamiento',
     'Aumentar energía, enfoque y rendimiento',
     'Evitar después de las 4 pm. Si usas pre-entreno comercial, revisar que no '
     || 'tenga carbohidratos o calorías adicionales.', 'training', 3),

    (v_plan, 'Citrulina Malato', 'conditional', '6-8 g antes de entrenar',
     'pre_workout', '30-45 minutos pre-entreno (puede combinarse con cafeína)',
     'Mejorar bomba muscular y retrasar fatiga', null, 'training', 4),

    (v_plan, 'ZMA (Zinc, Magnesio, Vitamina B6)', 'conditional',
     'Según etiqueta del producto (generalmente 3 cápsulas antes de dormir)',
     'bedtime', '30-60 minutos antes de acostarse, en ayunas',
     'Mejorar calidad del sueño y recuperación hormonal (testosterona)',
     null, 'both', 5),

    (v_plan, 'Vitamina D3 + K2', 'conditional',
     '2000-4000 UI de D3 + 90-180 mcg de K2 al día',
     'breakfast',
     'Con la comida que tenga más grasas (ej. desayuno opción 3 o cena con steak)',
     'Salud ósea, función inmune y metabolismo hormonal', null, 'both', 6),

    (v_plan, 'Electrolitos (Sodio, Potasio, Magnesio)', 'conditional',
     'Según necesidad (especialmente si sudas mucho o usas cafeína)',
     'intra_workout', 'Pueden añadirse al agua durante el entrenamiento',
     'Mantener hidratación y prevenir calambres', null, 'training', 7),

    -- C. OPCIONALES (menor prioridad)
    (v_plan, 'Glutamina', 'optional', '5-10 g al día',
     'bedtime', 'Post-entreno o antes de dormir',
     'Recuperación intestinal e inmune',
     'No esencial si ya consumes whey.', 'both', 8),

    (v_plan, 'Beta-Alanina', 'optional', '3-5 g al día',
     'any', null, null,
     'Tomar en dosis divididas para evitar hormigueo.', 'both', 9);

  raise notice 'Seeded: Protocolo Nutricional Fase 2 + Suplementación Fase 2 (templates)';
end $$;

-- ==========================================================================
-- Verify — read the plans back and compare against the source PDF.
-- ==========================================================================

-- 1) The whole meal graph, in reading order:
--   select m.slot_index, m.label as comida, m.applies_to, o.label as opcion,
--          i.name, i.day_type
--     from public.nutrition_plan_meals m
--     join public.nutrition_plan_options o on o.plan_meal_id = m.id
--     join public.nutrition_plan_option_items i on i.option_id = o.id
--    where m.plan_id = (select id from public.nutrition_plans
--                        where is_template and name = 'Protocolo Nutricional Fase 2')
--    order by m.slot_index, o.sort_order, i.sort_order;

-- 2) What a TRAINING day looks like vs. a REST day — the carb cycling, proven.
--    Swap 'training' for 'rest' and the carb rows drop out along with the
--    post-workout slot.
--   select m.label as comida, o.label as opcion, i.name
--     from public.nutrition_plan_meals m
--     join public.nutrition_plan_options o on o.plan_meal_id = m.id and o.sort_order = 0
--     join public.nutrition_plan_option_items i on i.option_id = o.id
--    where m.plan_id = (select id from public.nutrition_plans
--                        where is_template and name = 'Protocolo Nutricional Fase 2')
--      and m.applies_to in ('both','training')
--      and i.day_type  in ('both','training')
--    order by m.slot_index, i.sort_order;

-- 3) The macro targets:
--   select day_type, kcal_min, kcal_max, protein_min_g, protein_max_g,
--          carbs_min_g, carbs_max_g, fat_min_g, fat_max_g
--     from public.nutrition_plan_targets
--    where plan_id = (select id from public.nutrition_plans
--                      where is_template and name = 'Protocolo Nutricional Fase 2');

-- 4) The supplement schedule table the PDF ends with, derived not stored:
--   select timing_slot,
--          string_agg(name || coalesce(' — ' || dose, ''), ' + ' order by sort_order) as stack
--     from public.supplement_plan_items
--    where plan_id = (select id from public.supplement_plans
--                      where is_template and name = 'Suplementación Fase 2')
--      and applies_to in ('both','training')
--    group by timing_slot;
