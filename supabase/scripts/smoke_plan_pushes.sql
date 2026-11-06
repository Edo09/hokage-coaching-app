-- ==========================================================================
-- Smoke test for
-- supabase/migrations/20261106140000_plan_update_and_block_end_pushes.sql.
--
-- Run it after the migration. It acts as the coach and as the server, checks
-- each rule with assert, and ends with
--
--   ERROR:  SMOKE OK: plan pushes; nothing was saved
--
-- which rolls everything back: no row is kept and no push leaves (pg_net
-- only sends what a committed transaction queued). Any other error names the
-- rule that failed.
--
-- It borrows a client (one whose membership is active, or who has none) and
-- gives them a made-up phone, so every push has somewhere to go. The plans it
-- makes for them demote their real ones only until the rollback.
--
-- Whether a push went is read off the bookkeeping: plan_update_pushes.devices
-- is set to -1 before a write that must not send, and a push would reset it.
-- ==========================================================================

do $$
declare
  v_coach  uuid;
  v_client uuid;
  v_prog   uuid := gen_random_uuid();
  v_nut    uuid := gen_random_uuid();
  v_sup    uuid := gen_random_uuid();
  v_tpl    uuid := gen_random_uuid();   -- a template, for the claim
  v_new    uuid := gen_random_uuid();   -- assigned a moment ago
  v_block  uuid := gen_random_uuid();   -- 4 weeks, ends in 3 days
  v_short  uuid := gen_random_uuid();   -- 1 week, ends in 3 days
  v_later  uuid := gen_random_uuid();   -- 4 weeks, ends in 5 days
  v_today  date := public.coach_local_date();
  v_as_coach  text;
  v_as_server text := json_build_object('role', 'service_role')::text;
  v_n      int;
  u        public.plan_update_pushes%rowtype;
begin
  select id into v_coach from public.profiles where role = 'coach' limit 1;
  assert v_coach is not null, 'there is no coach to act as';
  select p.id into v_client
    from public.profiles p
    left join public.memberships m on m.client_id = p.id
   where p.role is distinct from 'coach'
     and (m.client_id is null or m.status = 'active')
   limit 1;
  assert v_client is not null, 'there is no client to act for';
  v_as_coach := json_build_object('sub', v_coach, 'role', 'authenticated')::text;

  insert into public.push_tokens (token, user_id, platform)
  values ('ExponentPushToken[smoke-plan-pushes]', v_client, 'android')
  on conflict (token) do update set user_id = excluded.user_id;

  -- ---- part 1: «Tu coach actualizó tu …» ------------------------------------

  perform set_config('request.jwt.claims', v_as_coach, true);

  -- Three live plans, assigned an hour ago: their «nuevo» push is old news.
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_prog, v_client, v_coach, 'smoke: programa', 4, v_today, 'active');
  insert into public.nutrition_plans (id, user_id, assigned_by, name, status)
  values (v_nut, v_client, v_coach, 'smoke: nutrición', 'active');
  insert into public.supplement_plans (id, user_id, assigned_by, name, status)
  values (v_sup, v_client, v_coach, 'smoke: suplementos', 'active');
  update public.program_assignment_pushes
     set created_at = now() - interval '1 hour' where program_id = v_prog;
  update public.nutrition_plan_assignment_pushes
     set created_at = now() - interval '1 hour' where plan_id = v_nut;
  update public.supplement_plan_assignment_pushes
     set created_at = now() - interval '1 hour' where plan_id = v_sup;

  -- 1. The coach saves a change to each: one push per plan, to the phone.
  update public.programs set notes = 'smoke 1', updated_at = now() where id = v_prog;
  update public.nutrition_plans set notes = 'smoke 1', updated_at = now() where id = v_nut;
  update public.supplement_plans set notes = 'smoke 1', updated_at = now() where id = v_sup;
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices >= 1 and u.user_id = v_client, '1: a program edit sends a push';
  select * into u from public.plan_update_pushes where kind = 'nutrition' and plan_id = v_nut;
  assert u.devices >= 1, '1: a nutrition plan edit sends a push';
  select * into u from public.plan_update_pushes where kind = 'supplement' and plan_id = v_sup;
  assert u.devices >= 1, '1: a supplement plan edit sends a push';

  -- 2. Another save within 30 minutes rides on that push.
  update public.plan_update_pushes set devices = -1 where kind = 'program' and plan_id = v_prog;
  update public.programs set notes = 'smoke 2', updated_at = now() where id = v_prog;
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices = -1, '2: a second save within 30 minutes sends nothing';

  -- 3. Past the 30 minutes, the next save sends again.
  update public.plan_update_pushes
     set sent_at = now() - interval '31 minutes' where kind = 'program' and plan_id = v_prog;
  update public.programs set notes = 'smoke 3', updated_at = now() where id = v_prog;
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices >= 1 and u.sent_at = now(), '3: a save after 30 minutes sends again';

  -- 4. Not news (each with the 30 minutes long gone, so only the rule stops it).
  update public.plan_update_pushes
     set devices = -1, sent_at = now() - interval '1 hour' where kind = 'program' and plan_id = v_prog;

  -- 4a. The template claim save_program_as_template writes.
  insert into public.programs (id, user_id, assigned_by, name, is_template, status)
  values (v_tpl, null, v_coach, 'smoke: plantilla', true, 'active');
  update public.programs set template_id = v_tpl, updated_at = now() where id = v_prog;
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices = -1, '4a: the template claim sends nothing';

  -- 4b. A write that changes nothing.
  update public.programs set notes = notes where id = v_prog;
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices = -1, '4b: a write that changes nothing sends nothing';

  -- 4c. No coach signed in (a script, a migration, a cron job).
  perform set_config('request.jwt.claims', v_as_server, true);
  update public.programs set notes = 'smoke 4c', updated_at = now() where id = v_prog;
  perform set_config('request.jwt.claims', '', true);
  update public.programs set notes = 'smoke 4c again', updated_at = now() where id = v_prog;
  perform set_config('request.jwt.claims', v_as_coach, true);
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices = -1, '4c: a write with no coach signed in sends nothing';

  -- 4d. Archiving it (the client loses it; no «actualizó»).
  update public.programs set status = 'archived', updated_at = now() where id = v_prog;
  select * into u from public.plan_update_pushes where kind = 'program' and plan_id = v_prog;
  assert u.devices = -1, '4d: archiving sends nothing';

  -- 5. A plan assigned a moment ago: its «nuevo» push already said it.
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_new, v_client, v_coach, 'smoke: recién asignado', 4, v_today, 'active');
  assert exists (select 1 from public.program_assignment_pushes where program_id = v_new),
    '5: the new program got its «nuevo» push';
  update public.programs set notes = 'smoke 5', updated_at = now() where id = v_new;
  assert not exists (select 1 from public.plan_update_pushes where kind = 'program' and plan_id = v_new),
    '5: an edit right after assigning sends nothing';

  -- ---- part 2: «Tu bloque termina el …» ---------------------------------------

  -- From here on as the server: the blocks below started weeks ago, and a
  -- coach may not start a program in the past (guard_program_start_date).
  perform set_config('request.jwt.claims', v_as_server, true);

  -- 6. A 4-week block whose last day is 3 days away: announced, to the phone.
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_block, v_client, v_coach, 'smoke: bloque', 4, v_today + 3 - 27, 'active');
  v_n := public.send_block_ending_pushes();
  assert v_n >= 1, '6: the daily pass announces a block';
  assert exists (select 1 from public.program_ending_pushes
                  where program_id = v_block and end_date = v_today + 3
                    and user_id = v_client and devices >= 1),
    '6: the block 3 days from its end is announced';

  -- 7. Once: the next pass the same day announces nothing.
  assert public.send_block_ending_pushes() = 0, '7: a block is announced once';

  -- 8. Moved by the coach to end in 2 days: announced again, for the new end.
  update public.programs set start_date = start_date - 1 where id = v_block;
  assert public.send_block_ending_pushes() = 1, '8: a new end is announced again';
  assert exists (select 1 from public.program_ending_pushes
                  where program_id = v_block and end_date = v_today + 2),
    '8: the new end has its row';

  -- 9. Not announced: a one-week program, and a block ending in 5 days.
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_short, v_client, v_coach, 'smoke: una semana', 1, v_today + 3 - 6, 'active');
  perform public.send_block_ending_pushes();
  assert not exists (select 1 from public.program_ending_pushes where program_id = v_short),
    '9: a one-week program is no block';
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_later, v_client, v_coach, 'smoke: termina en 5', 4, v_today + 5 - 27, 'active');
  perform public.send_block_ending_pushes();
  assert not exists (select 1 from public.program_ending_pushes where program_id = v_later),
    '9: 5 days before the end is too early';

  -- ---- part 3: who can reach it ------------------------------------------------

  -- 10. Server-only, and the job runs it daily at 13:00 UTC (09:00 for the coach).
  assert not has_function_privilege('authenticated', 'public.send_block_ending_pushes()', 'execute'),
    '10: clients can''t send block pushes';
  assert not has_function_privilege('anon', 'public.send_block_ending_pushes()', 'execute'),
    '10: anon can''t send block pushes';
  assert not has_function_privilege('authenticated', 'public.notify_plan_updated()', 'execute'),
    '10: clients can''t call the trigger function';
  assert not has_table_privilege('authenticated', 'public.plan_update_pushes', 'select'),
    '10: clients can''t read update pushes';
  assert not has_table_privilege('authenticated', 'public.program_ending_pushes', 'select'),
    '10: clients can''t read block pushes';
  assert exists (select 1 from cron.job
                  where jobname = 'client-block-ending-push'
                    and schedule = '0 13 * * *'
                    and command = 'select public.send_block_ending_pushes()'),
    '10: the daily job is scheduled';

  raise exception 'SMOKE OK: plan pushes; nothing was saved';
end $$;
