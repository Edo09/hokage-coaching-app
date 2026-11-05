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
  v_row4   uuid := gen_random_uuid();   -- undone, then registered again
  v_ver    bigint;
  v_v1     bigint;
  v_v2     bigint;
  v_rule   smallint := case when public.meal_estimate_configured() then 1 else 0 end;
  r        public.meal_items%rowtype;
  v_client text;
  v_server text := json_build_object('role', 'service_role')::text;
begin
  -- Any account with a profile: meals point at auth.users, plans at profiles.
  select p.id into v_uid from public.profiles p join auth.users u on u.id = p.id limit 1;
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

  -- 11. An answer meant for an undone registration never lands on the row
  --     registered again under the same id (review focus 5).
  perform set_config('request.jwt.claims', v_client, true);
  insert into public.meal_items (id, meal_id, user_id, name, kind, original_text)
  values (v_row4, v_meal, v_uid, 'arros con poyo', 'other', 'arros con poyo')
  returning estimate_version into v_v1;
  delete from public.meal_items where id = v_row4;
  insert into public.meal_items (id, meal_id, user_id, name, kind, original_text)
  values (v_row4, v_meal, v_uid, 'yogur', 'other', 'yogur')
  returning estimate_version into v_v2;
  assert v_v2 > v_v1, '11: a re-insert gets a newer version';
  perform set_config('request.jwt.claims', v_server, true);
  assert not public.finish_meal_estimate(v_row4, v_v1, 410, 30, 55, 10, 'Arroz con pollo'), '11: an old answer is refused';
  select * into r from public.meal_items where id = v_row4;
  assert r.estimate_status = 'pending' and r.name = 'yogur', '11: the refused answer changed nothing';
  assert public.finish_meal_estimate(v_row4, v_v2, 180, 10, 25, 4, 'Yogur'), '11: the current answer lands';
  select * into r from public.meal_items where id = v_row4;
  assert r.estimate_status = 'done' and r.calories = 180 and r.name = 'Yogur', '11: done, with its numbers and name';
  assert r.estimate_next_at is null, '11: a finished estimate has no next try';

  -- 12. A failed call backs off, then fails for good after the last attempt.
  update public.meal_items set estimate_attempts = 2 where id = v_row2;
  select estimate_version into v_ver from public.meal_items where id = v_row2;
  assert public.fail_meal_estimate(v_row2, v_ver), '12: a failure is recorded';
  select * into r from public.meal_items where id = v_row2;
  assert r.estimate_status = 'pending', '12: it stays pending while attempts remain';
  assert r.estimate_next_at = now() + interval '5 minutes', '12: after attempt 2 the next try is 5 minutes away';
  update public.meal_items set estimate_attempts = 5 where id = v_row2;
  assert public.fail_meal_estimate(v_row2, v_ver), '12: the last failure is recorded';
  select * into r from public.meal_items where id = v_row2;
  assert r.estimate_status = 'failed' and r.estimate_next_at is null, '12: after attempt 5 it is failed';

  -- 13. A quota wait gives the attempt back and looks again in 15 minutes.
  update public.meal_items set estimate_status = 'pending', estimate_attempts = 1 where id = v_row2;
  assert public.defer_meal_estimate(v_row2, v_ver), '13: the wait is recorded';
  select * into r from public.meal_items where id = v_row2;
  assert r.estimate_attempts = 0, '13: a quota wait is not an attempt';
  assert r.estimate_next_at = now() + interval '15 minutes', '13: the next try is 15 minutes away';

  -- 14. Clients can't run the server's functions; take_ai_quota() stays theirs.
  assert not has_function_privilege('authenticated', 'public.take_ai_quota_for(uuid)', 'execute'), '14: take_ai_quota_for is server-only';
  assert not has_function_privilege('authenticated', 'public.refund_ai_quota_for(uuid)', 'execute'), '14: refund_ai_quota_for is server-only';
  assert not has_function_privilege('authenticated', 'public.refund_ai_quota()', 'execute'), '14: clients can no longer refund';
  assert not has_function_privilege('authenticated', 'public.finish_meal_estimate(uuid,bigint,integer,numeric,numeric,numeric,text)', 'execute'), '14: finish is server-only';
  assert not has_function_privilege('authenticated', 'public.fail_meal_estimate(uuid,bigint)', 'execute'), '14: fail is server-only';
  assert not has_function_privilege('authenticated', 'public.defer_meal_estimate(uuid,bigint)', 'execute'), '14: defer is server-only';
  assert not has_function_privilege('authenticated', 'public.send_meal_estimate(uuid,bigint)', 'execute'), '14: send is server-only';
  assert not has_function_privilege('authenticated', 'public.resend_meal_estimates()', 'execute'), '14: resend is server-only';
  assert not has_function_privilege('authenticated', 'public.retry_failed_meal_estimates()', 'execute'), '14: the daily retry is server-only';
  assert not has_function_privilege('anon', 'public.finish_meal_estimate(uuid,bigint,integer,numeric,numeric,numeric,text)', 'execute'), '14: anon can''t finish';
  assert has_function_privilege('authenticated', 'public.take_ai_quota()', 'execute'), '14: take_ai_quota stays callable';
  assert has_function_privilege('service_role', 'public.take_ai_quota_for(uuid)', 'execute'), '14: the function can take quota';

  -- 15. Both jobs are scheduled, and the app hears meal_items over Realtime.
  assert (select count(*) from cron.job
           where jobname in ('meal-estimates-resend', 'meal-estimates-daily-retry')) = 2, '15: both cron jobs exist';
  assert exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public'
                    and tablename = 'meal_items'), '15: meal_items is on supabase_realtime';

  raise exception 'SMOKE OK: meal registrations; nothing was saved';
end $$;
