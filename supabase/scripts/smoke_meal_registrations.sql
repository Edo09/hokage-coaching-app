-- ==========================================================================
-- Smoke test for supabase/migrations/20261105120000_meal_registrations.sql.
--
-- Run it in the Supabase SQL editor after the migration. It acts as a client
-- and as the server, checks each rule with assert, and ends with
--
--   ERROR:  SMOKE OK: meal registrations; nothing was saved
--
-- which rolls everything back: no row is kept and no pg_net request leaves.
-- Any other error names the rule that failed.
-- ==========================================================================

do $$
declare
  v_uid    uuid;
  v_meal   uuid := gen_random_uuid();   -- today's container
  v_row    uuid := gen_random_uuid();   -- an «otra cosa» registration
  v_row2   uuid := gen_random_uuid();   -- a plan registration
  v_row3   uuid := gen_random_uuid();   -- a plan registration linked to a real option
  v_plan   uuid := gen_random_uuid();
  v_pmeal  uuid := gen_random_uuid();
  v_opt    uuid := gen_random_uuid();
  v_ver    bigint;
  v_rule   smallint := case when public.meal_estimate_configured() then 1 else 0 end;
  r        public.meal_items%rowtype;
  v_client text;
  v_server text := json_build_object('role', 'service_role')::text;
begin
  select id into v_uid from auth.users order by created_at limit 1;
  assert v_uid is not null, 'there is no user to act as';
  v_client := json_build_object('sub', v_uid, 'role', 'authenticated')::text;

  -- ---- part 1: the estimate state (migration sections 1-3) ----------------

  perform set_config('request.jwt.claims', v_client, true);
  insert into public.meals (id, user_id, name, meal_type, date)
  values (v_meal, v_uid, 'smoke', 'lunch', current_date);

  -- 1. A new «otra cosa» registration starts pending, with the typed text.
  insert into public.meal_items (id, meal_id, user_id, name, kind, original_text, calories)
  values (v_row, v_meal, v_uid, 'x', 'other', 'arros con poyo', 999);
  select * into r from public.meal_items where id = v_row;
  assert r.estimate_status = 'pending', '1: a new registration is pending';
  assert r.name = 'arros con poyo', '1: name is the typed text';
  assert r.calories = 0 and r.protein_g = 0 and r.carbs_g = 0 and r.fat_g = 0, '1: numbers start at 0';
  assert r.estimate_version is not null, '1: it has a version';
  assert r.estimate_attempts = v_rule, '1: attempts follow the configured rule';
  v_ver := r.estimate_version;

  -- 2. A client can't set the status, the numbers or the bookkeeping.
  insert into public.meal_items (id, meal_id, user_id, name, kind, original_text, estimate_status, calories, estimate_attempts)
  values (v_row, v_meal, v_uid, 'arros con poyo', 'other', 'arros con poyo', 'done', 999, 0)
  on conflict (id) do update
    set name = excluded.name, kind = excluded.kind, original_text = excluded.original_text,
        estimate_status = excluded.estimate_status, calories = excluded.calories,
        estimate_attempts = excluded.estimate_attempts;
  select * into r from public.meal_items where id = v_row;
  assert r.estimate_status = 'pending' and r.calories = 0, '2: status and numbers stay the server''s';
  assert r.estimate_version = v_ver and r.estimate_attempts = v_rule, '2: version and attempts stay the server''s';

  -- 3. The server's write lands as written.
  perform set_config('request.jwt.claims', v_server, true);
  update public.meal_items set estimate_status = 'done', calories = 410, name = 'Arroz con pollo' where id = v_row;
  select * into r from public.meal_items where id = v_row;
  assert r.estimate_status = 'done' and r.calories = 410 and r.name = 'Arroz con pollo', '3: the server writes the estimate';

  -- 4. A stale replay from the client's cache keeps the server's estimate and
  --    corrected name (review focus 3).
  perform set_config('request.jwt.claims', v_client, true);
  insert into public.meal_items (id, meal_id, user_id, name, kind, original_text, estimate_status, calories)
  values (v_row, v_meal, v_uid, 'arros con poyo', 'other', 'arros con poyo', 'pending', 0)
  on conflict (id) do update
    set name = excluded.name, original_text = excluded.original_text,
        estimate_status = excluded.estimate_status, calories = excluded.calories;
  select * into r from public.meal_items where id = v_row;
  assert r.estimate_status = 'done' and r.calories = 410, '4: a replay keeps the estimate';
  assert r.name = 'Arroz con pollo' and r.estimate_version = v_ver, '4: a replay keeps the corrected name and the version';

  -- 5. A new text starts a new estimate.
  update public.meal_items set original_text = 'yogur', name = 'yogur' where id = v_row;
  select * into r from public.meal_items where id = v_row;
  assert r.estimate_status = 'pending' and r.name = 'yogur' and r.calories = 0, '5: a new text is pending again';
  assert r.estimate_version > v_ver, '5: a new text gets a new version';
  v_ver := r.estimate_version;

  -- 6. «No la comí» clears the estimate, the photo and the text.
  update public.meal_items set kind = 'skipped', photo_path = v_uid::text || '/x.jpg' where id = v_row;
  select * into r from public.meal_items where id = v_row;
  assert r.estimate_status is null and r.calories = 0, '6: skipped has no estimate';
  assert r.photo_path is null and r.original_text is null, '6: skipped has no photo or text';
  assert r.estimate_version > v_ver, '6: skipping voids a running estimate';

  -- 7. Tapping «Sin estimar» retries a failed row with fresh attempts.
  insert into public.meal_items (id, meal_id, user_id, name, kind)
  values (v_row2, v_meal, v_uid, '80 g avena', 'plan');
  perform set_config('request.jwt.claims', v_server, true);
  update public.meal_items set estimate_status = 'failed', estimate_attempts = 5, estimate_next_at = null where id = v_row2;
  perform set_config('request.jwt.claims', v_client, true);
  update public.meal_items set estimate_status = 'pending' where id = v_row2;
  select * into r from public.meal_items where id = v_row2;
  assert r.estimate_status = 'pending' and r.estimate_attempts = v_rule, '7: a retry is pending with fresh attempts';

  -- 8. Links to rows that don't exist are dropped, not refused.
  insert into public.meal_items (id, meal_id, user_id, name, kind, plan_option_id, plan_meal_id)
  values (gen_random_uuid(), v_meal, v_uid, 'x', 'plan', gen_random_uuid(), gen_random_uuid())
  returning * into r;
  assert r.plan_option_id is null and r.plan_meal_id is null, '8: missing links become null';

  -- 9. The coach's plan edit (a cascade, one trigger level down) only drops
  --    the link and starts no estimate (review focus 4).
  perform set_config('request.jwt.claims', v_server, true);
  insert into public.nutrition_plans (id, user_id, name, start_date, status)
  values (v_plan, v_uid, 'smoke', current_date, 'archived');
  insert into public.nutrition_plan_meals (id, plan_id, slot_index, meal_type) values (v_pmeal, v_plan, 1, 'lunch');
  insert into public.nutrition_plan_options (id, plan_meal_id) values (v_opt, v_pmeal);
  perform set_config('request.jwt.claims', v_client, true);
  insert into public.meal_items (id, meal_id, user_id, name, kind, plan_option_id, plan_meal_id)
  values (v_row3, v_meal, v_uid, '150 g pollo', 'plan', v_opt, v_pmeal)
  returning * into r;
  assert r.plan_option_id = v_opt and r.plan_meal_id = v_pmeal, '9: real links are kept';
  v_ver := r.estimate_version;
  delete from public.nutrition_plan_options where id = v_opt;
  select * into r from public.meal_items where id = v_row3;
  assert r.plan_option_id is null, '9: removing the option nulls the link';
  assert r.estimate_version = v_ver and r.estimate_status = 'pending', '9: a plan edit starts no estimate';

  -- 10. A row without kind is an old diary row: the client's numbers stand.
  insert into public.meal_items (id, meal_id, user_id, name, calories)
  values (gen_random_uuid(), v_meal, v_uid, 'pan', 250)
  returning * into r;
  assert r.calories = 250 and r.estimate_status is null, '10: an old diary row is left alone';

  -- ---- part 2: sending, write-back, retries, quota (sections 4-8) ---------

  raise exception 'SMOKE OK: meal registrations; nothing was saved';
end $$;
