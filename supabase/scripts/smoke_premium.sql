-- ==========================================================================
-- Smoke test for the Premium subscriptions server stage:
--   supabase/migrations/20261123120000_premium_access.sql
--   supabase/migrations/20261123130000_premium_requests_and_locks.sql
--
-- Run it after the migrations. It acts as the server, as two clients and as
-- the coach (as the `authenticated` / `service_role` roles where privileges
-- and RLS matter), checks each rule with assert, and ends with
--
--   ERROR:  SMOKE OK: premium; nothing was saved
--
-- which rolls everything back: no row is kept and no push leaves (pg_net only
-- sends what a committed transaction queued). Any other error names the rule
-- that failed.
--
-- It borrows two clients and wipes their subscription and membership rows
-- until the rollback, and flips premium_settings.enforced by hand to test
-- both positions of the switch.
-- ==========================================================================

-- Session-local helpers; they go away with the rollback.
create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create function pg_temp.act_as_server() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;

create function pg_temp.act_as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- The SQLSTATE a statement raises under the current role, or null if it ran.
create function pg_temp.sqlstate_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlstate;
end $$;

-- Rows the current role sees in a table.
create function pg_temp.rows_in(p_table text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from ' || p_table into n;
  return n;
end $$;

-- The message a statement raises under the current role, or null if it ran.
create function pg_temp.message_of(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end $$;

-- How many rows a statement changed under the current role (RLS filters
-- silently, so a blocked update or delete shows as 0).
create function pg_temp.rows_affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- One insert into each of the five logging tables, keyed by n so they never collide.
create function pg_temp.writes(p_user uuid, p_meal uuid, p_pe uuid, n int) returns text[] language sql as $$
  select array[
    format('insert into public.program_exercise_completions (user_id, program_exercise_id, week_number) values (%L, %L, %s)',
           p_user, p_pe, n),
    format('insert into public.workout_set_logs (user_id, program_exercise_id, week_number, set_index) values (%L, %L, %s, %s)',
           p_user, p_pe, n, n),
    format('insert into public.supplement_intake_logs (user_id, taken_on, supplement_name) values (%L, current_date - %s, %L)',
           p_user, n, 'smoke: ' || n),
    format('insert into public.meals (user_id, name, meal_type) values (%L, %L, %L)', p_user, 'smoke ' || n, 'snack'),
    format('insert into public.meal_items (meal_id, user_id, name) values (%L, %L, %L)', p_meal, p_user, 'smoke ' || n)
  ]
$$;

create function pg_temp.set_sub(p_user uuid, p_premium boolean, p_until timestamptz)
returns void language sql as $$
  insert into public.subscriptions
    (user_id, product_id, store, environment, status, is_premium, will_renew, access_until, last_synced_at)
  values
    (p_user, 'smoke_monthly', 'app_store', 'sandbox',
     case when p_premium then 'active' else 'expired' end, p_premium, p_premium, p_until, now())
  on conflict (user_id) do update
    set status = excluded.status, is_premium = excluded.is_premium, will_renew = excluded.will_renew,
        access_until = excluded.access_until, last_synced_at = excluded.last_synced_at;
$$;

create function pg_temp.set_membership(p_client uuid, p_status text, p_expires date)
returns void language sql as $$
  delete from public.memberships where client_id = p_client;
  insert into public.memberships (client_id, status, started_at, expires_at)
  values (p_client, p_status, current_date - 60, p_expires);
$$;

do $$
declare
  v_coach  uuid;
  v_client uuid;
  v_other  uuid;
  v_today  date := public.coach_local_date();
  v_j      jsonb;
  v_n      bigint;
  v_s      text;
  v_patch  jsonb;
  v_prog   uuid := gen_random_uuid();
  v_nut    uuid := gen_random_uuid();
  v_sup    uuid := gen_random_uuid();
  r        public.subscriptions%rowtype;
  v_has    boolean;
  v_src    text;
  v_coached boolean;
  v_id     uuid;
  v_id2    uuid;
  v_p2     uuid := gen_random_uuid();
  v_n2     uuid := gen_random_uuid();
  v_s2     uuid := gen_random_uuid();
  v_day    uuid := gen_random_uuid();
  v_pm     uuid := gen_random_uuid();
  v_opt    uuid := gen_random_uuid();
  v_meal   uuid := gen_random_uuid();
  v_pe     uuid := gen_random_uuid();
  v_t      text;
  v_stmt   text;
  v_locked text[] := array['programs', 'program_weeks', 'program_days', 'program_exercises',
                           'nutrition_plans', 'nutrition_plan_meals', 'nutrition_plan_options',
                           'nutrition_plan_option_items', 'nutrition_plan_targets',
                           'supplement_plans', 'supplement_plan_items'];
  v_history text[] := array['program_exercise_completions', 'workout_set_logs', 'supplement_intake_logs',
                            'meals', 'meal_items', 'body_measurements'];
begin
  select id into v_coach from public.profiles where role = 'coach' limit 1;
  assert v_coach is not null, 'there is no coach to act as';
  select id into v_client from public.profiles where role = 'user' order by created_at, id limit 1;
  select id into v_other  from public.profiles where role = 'user' and id <> v_client order by created_at, id limit 1;
  assert v_client is not null and v_other is not null, 'there are not two clients to borrow';

  -- A clean slate for the two clients; the rollback gives everything back.
  delete from public.subscriptions where user_id in (v_client, v_other);
  delete from public.memberships   where client_id in (v_client, v_other);

  -- ---- 1. The switch: off by default, and while off nobody is locked --------

  assert (select column_default from information_schema.columns
           where table_schema = 'public' and table_name = 'premium_settings' and column_name = 'enforced') = 'false',
    '1: the switch is off by default';
  assert (select count(*) from public.premium_settings) = 1, '1: the switch has one row';
  update public.premium_settings set enforced = false;

  perform pg_temp.act_as(v_client);
  assert public.has_premium_access(), '1: off: a client with nothing has access';
  assert public.premium_content_access(), '1: off: and may write';
  assert pg_temp.sqlstate_of('select * from public.premium_settings') = '42501',
    '1: premium_settings is not readable by a client';
  assert pg_temp.sqlstate_of('select * from public.revenuecat_events') = '42501',
    '1: revenuecat_events is not readable by a client';
  assert pg_temp.sqlstate_of('select public.premium_source_for(auth.uid())') = '42501',
    '1: premium_source_for is server-only';
  assert pg_temp.sqlstate_of('select public.premium_access_for(auth.uid())') = '42501',
    '1: premium_access_for is server-only';
  assert pg_temp.sqlstate_of('select public.premium_content_access_for(auth.uid())') = '42501',
    '1: premium_content_access_for is server-only';
  assert pg_temp.sqlstate_of('select public.is_being_coached(auth.uid())') = '42501',
    '1: is_being_coached is server-only';
  perform pg_temp.act_as_owner();

  -- ---- 2. The rule, switch on -------------------------------------------------

  update public.premium_settings set enforced = true;
  assert not public.premium_access_for(v_client), '2: nothing: no access';
  assert public.premium_source_for(v_client) is null, '2: nothing: no source';
  assert public.premium_access_for(v_coach) and public.premium_source_for(v_coach) = 'coach',
    '2: the coach always has access';

  perform pg_temp.set_sub(v_client, true, now() + interval '10 days');
  assert public.premium_access_for(v_client) and public.premium_source_for(v_client) = 'subscription',
    '2: a live subscription grants access';
  perform pg_temp.set_sub(v_client, true, now() - interval '1 minute');
  assert not public.premium_access_for(v_client),
    '2: a subscription past its end grants nothing, so a lost expiry event cannot keep access open';
  perform pg_temp.set_sub(v_client, false, now() + interval '10 days');
  assert not public.premium_access_for(v_client), '2: is_premium = false closes access at once';
  delete from public.subscriptions where user_id = v_client;

  perform pg_temp.set_membership(v_client, 'active', null);
  assert public.premium_access_for(v_client) and public.premium_source_for(v_client) = 'membership',
    '2: an open-ended active membership grants access';
  perform pg_temp.set_membership(v_client, 'active', v_today);
  assert public.premium_access_for(v_client), '2: a membership ending today still grants access';
  perform pg_temp.set_membership(v_client, 'active', v_today - 1);
  assert not public.premium_access_for(v_client), '2: a membership that ended yesterday does not';
  foreach v_s in array array['paused', 'expired', 'cancelled'] loop
    perform pg_temp.set_membership(v_client, v_s, null);
    assert not public.premium_access_for(v_client), format('2: a %s membership grants nothing', v_s);
  end loop;

  perform pg_temp.set_membership(v_client, 'active', null);
  perform pg_temp.set_sub(v_client, true, now() + interval '10 days');
  assert public.premium_source_for(v_client) = 'subscription',
    '2: a subscription is named as the source before a membership';
  delete from public.subscriptions where user_id = v_client;
  delete from public.memberships where client_id = v_client;

  -- ---- 3. Content and logging stay open for 72 hours after access ends -----------------------

  perform pg_temp.set_sub(v_client, true, now() - interval '71 hours');
  assert not public.premium_access_for(v_client) and public.premium_content_access_for(v_client),
    '3: 71 h after the end: no access, but the 72-hour grace is still open';
  perform pg_temp.set_sub(v_client, true, now() - interval '73 hours');
  assert not public.premium_content_access_for(v_client), '3: 73 h after the end: the grace is over';

  -- A refund (is_premium false) counts its grace from the sync that revoked it,
  -- not from the end of the paid period.
  perform pg_temp.set_sub(v_client, false, now() + interval '10 days');
  update public.subscriptions set last_synced_at = now() - interval '80 hours' where user_id = v_client;
  assert not public.premium_content_access_for(v_client), '3: a refund synced 80 h ago has no grace left';
  update public.subscriptions set last_synced_at = now() - interval '1 hour' where user_id = v_client;
  assert public.premium_content_access_for(v_client), '3: a refund synced an hour ago still has its grace';
  delete from public.subscriptions where user_id = v_client;

  perform pg_temp.set_membership(v_client, 'active', v_today - 3);
  assert public.premium_content_access_for(v_client) and not public.premium_access_for(v_client),
    '3: a membership that ended 3 days ago: the grace is still open';
  perform pg_temp.set_membership(v_client, 'active', v_today - 4);
  assert not public.premium_content_access_for(v_client), '3: ended 4 days ago: the grace is over';
  perform pg_temp.set_membership(v_client, 'paused', v_today + 30);
  assert not public.premium_content_access_for(v_client), '3: a paused membership gets no grace';
  delete from public.memberships where client_id = v_client;

  -- ---- 4. The writers (server only) ---------------------------------------------

  assert has_table_privilege('service_role', 'public.subscriptions', 'select')
     and has_table_privilege('service_role', 'public.subscriptions', 'insert')
     and has_table_privilege('service_role', 'public.subscriptions', 'update'),
    '4: the service role is granted subscriptions';
  assert has_table_privilege('service_role', 'public.revenuecat_events', 'select')
     and has_table_privilege('service_role', 'public.revenuecat_events', 'insert')
     and has_table_privilege('service_role', 'public.revenuecat_events', 'update'),
    '4: the service role is granted revenuecat_events';
  assert has_table_privilege('service_role', 'public.premium_settings', 'select'),
    '4: the service role is granted premium_settings';

  perform pg_temp.act_as_server();
  assert public.record_revenuecat_event('smoke-evt-1', 'RENEWAL', v_client::text, now(),
           '{"event":{"id":"smoke-evt-1"}}'::jsonb) = 'new', '4: a first event is new';
  assert public.record_revenuecat_event('smoke-evt-1', 'RENEWAL', v_client::text, now(), '{}'::jsonb) = 'repeat_retry',
    '4: a repeat before it was handled runs again';
  perform public.finish_revenuecat_event('smoke-evt-1', 'synced');
  assert public.record_revenuecat_event('smoke-evt-1', 'RENEWAL', v_client::text, now(), '{}'::jsonb) = 'repeat_done',
    '4: a repeat after it was synced is skipped';
  assert (select payload -> 'event' ->> 'id' from public.revenuecat_events where event_id = 'smoke-evt-1') = 'smoke-evt-1',
    '4: the first payload is the one kept';

  assert public.record_revenuecat_event('smoke-evt-2', 'RENEWAL', v_client::text, now(), '{}'::jsonb) = 'new';
  perform public.finish_revenuecat_event('smoke-evt-2', 'failed', 'boom');
  assert (select error from public.revenuecat_events where event_id = 'smoke-evt-2') = 'boom',
    '4: a failure keeps its reason';
  assert public.record_revenuecat_event('smoke-evt-2', 'RENEWAL', v_client::text, now(), '{}'::jsonb) = 'repeat_retry',
    '4: a failed event is run again when it is retried';
  foreach v_s in array array['ignored', 'unknown_user'] loop
    assert public.record_revenuecat_event('smoke-evt-' || v_s, 'TEST', null, now(), '{}'::jsonb) = 'new';
    perform public.finish_revenuecat_event('smoke-evt-' || v_s, v_s);
    assert public.record_revenuecat_event('smoke-evt-' || v_s, 'TEST', null, now(), '{}'::jsonb) = 'repeat_done',
      format('4: a %s event is not run again', v_s);
  end loop;

  v_patch := jsonb_build_object(
    'product_id', 'smoke_monthly', 'store', 'app_store', 'environment', 'sandbox', 'status', 'active',
    'is_premium', true, 'will_renew', true,
    'started_at', now() - interval '5 days', 'current_period_started_at', now() - interval '1 day',
    'expires_at', now() + interval '29 days', 'grace_expires_at', null,
    'access_until', now() + interval '29 days', 'rc_app_user_id', v_other::text);

  assert public.apply_subscription_snapshot(v_other, v_patch, now() - interval '1 hour', 'smoke-evt-1',
           now() - interval '90 minutes') = 'applied', '4: a first snapshot is applied';
  select * into r from public.subscriptions where user_id = v_other;
  assert r.product_id = 'smoke_monthly' and r.store = 'app_store' and r.environment = 'sandbox'
     and r.status = 'active' and r.is_premium and r.will_renew and r.rc_app_user_id = v_other::text,
    '4: the snapshot is stored';
  assert r.last_synced_at = now() - interval '1 hour', '4: last_synced_at is the fetch time, not now()';
  assert r.last_event_id = 'smoke-evt-1' and r.last_event_at = now() - interval '90 minutes',
    '4: the event that triggered it is remembered';

  assert public.apply_subscription_snapshot(v_other,
           v_patch || jsonb_build_object('status', 'expired', 'is_premium', false),
           now() - interval '2 hours') = 'stale', '4: an older fetch is stale';
  assert (select status from public.subscriptions where user_id = v_other) = 'active',
    '4: and an older fetch changes nothing';
  assert public.apply_subscription_snapshot(v_other,
           v_patch || jsonb_build_object('status', 'cancelled', 'will_renew', false), now()) = 'applied',
    '4: a newer fetch is applied';
  assert (select status from public.subscriptions where user_id = v_other) = 'cancelled'
     and not (select will_renew from public.subscriptions where user_id = v_other),
    '4: and replaces the state';
  assert public.apply_subscription_snapshot(v_other, v_patch, now()) = 'applied',
    '4: a fetch at the same moment as the stored one is applied (not older)';

  assert public.apply_subscription_snapshot(v_other,
           jsonb_build_object('product_id', null, 'store', null, 'environment', 'production', 'status', 'expired',
             'is_premium', false, 'will_renew', false, 'access_until', now(), 'rc_app_user_id', v_other::text),
           now() + interval '1 second') = 'applied', '4: a snapshot with no product still updates an existing row';
  select * into r from public.subscriptions where user_id = v_other;
  assert r.product_id = 'smoke_monthly' and r.store = 'app_store' and r.status = 'expired' and not r.is_premium,
    '4: and keeps the stored product and store';

  assert public.apply_subscription_snapshot(v_client,
           jsonb_build_object('product_id', null, 'store', null, 'environment', 'production', 'status', 'expired',
             'is_premium', false, 'will_renew', false, 'access_until', now(), 'rc_app_user_id', v_client::text),
           now()) = 'skipped', '4: a snapshot with no product and no row is skipped';
  assert not exists (select 1 from public.subscriptions where user_id = v_client), '4: and writes no row';

  assert public.apply_subscription_snapshot(v_other, v_patch || jsonb_build_object('access_until', 'infinity'),
           now() + interval '2 seconds') = 'applied', '4: an open-ended access is accepted';
  assert (select access_until from public.subscriptions where user_id = v_other) = 'infinity'::timestamptz,
    '4: and stored as infinity';
  assert public.apply_subscription_snapshot(gen_random_uuid(), v_patch, now()) = 'skipped',
    '4: a user with no profile is skipped';

  perform pg_temp.act_as(v_client);
  assert pg_temp.sqlstate_of(format('select public.record_revenuecat_event(%L, %L, %L, now(), %L::jsonb)',
           'x', 'x', 'x', '{}')) = '42501', '4: a client cannot record events';
  assert pg_temp.sqlstate_of(format('select public.finish_revenuecat_event(%L, %L)', 'smoke-evt-1', 'synced')) = '42501',
    '4: a client cannot finish events';
  assert pg_temp.sqlstate_of(format('select public.apply_subscription_snapshot(%L::uuid, %L::jsonb, now())',
           v_client, '{}')) = '42501', '4: a client cannot apply a snapshot';
  perform pg_temp.act_as_owner();
  delete from public.subscriptions where user_id in (v_client, v_other);

  -- ---- 5. Who reads and writes subscriptions ------------------------------------

  perform pg_temp.set_sub(v_client, true, now() + interval '10 days');
  perform pg_temp.set_sub(v_other, true, now() + interval '10 days');
  perform pg_temp.act_as(v_client);
  assert pg_temp.rows_in('public.subscriptions') = 1, '5: a client reads only their own row';
  assert (select user_id from public.subscriptions) = v_client, '5: and it is theirs';
  assert pg_temp.sqlstate_of(format(
    'insert into public.subscriptions (user_id, product_id, store, environment, status, is_premium, will_renew, access_until) '
    || 'values (%L, ''x'', ''x'', ''sandbox'', ''active'', true, true, now())', v_client)) = '42501',
    '5: a client cannot insert a subscription';
  assert pg_temp.sqlstate_of('update public.subscriptions set is_premium = true') = '42501',
    '5: a client cannot update a subscription';
  assert pg_temp.sqlstate_of('delete from public.subscriptions') = '42501',
    '5: a client cannot delete a subscription';
  perform pg_temp.act_as(v_coach);
  assert pg_temp.rows_in('public.subscriptions') >= 2, '5: the coach reads every row';
  assert pg_temp.sqlstate_of('update public.subscriptions set is_premium = false') = '42501',
    '5: not even the coach writes through the API';
  perform pg_temp.act_as_owner();
  assert not has_table_privilege('anon', 'public.subscriptions', 'select'), '5: anon reads nothing';
  assert (select count(*) from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public'
             and tablename in ('subscriptions', 'memberships')) = 2,
    '5: subscriptions and memberships are on the realtime publication';
  delete from public.subscriptions where user_id in (v_client, v_other);

  -- ---- 6. What the app and the panel are told -----------------------------------

  assert public.get_my_access() is null, '6: signed out: nothing is returned';

  update public.premium_settings set enforced = false;
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert not (v_j ->> 'enforced')::boolean and (v_j ->> 'has_access')::boolean and v_j ->> 'source' = 'open',
    '6: switch off: open access';
  assert v_j -> 'subscription' = 'null'::jsonb and v_j -> 'membership' = 'null'::jsonb,
    '6: and no subscription or membership to show';

  perform pg_temp.act_as_owner();
  update public.premium_settings set enforced = true;
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert (v_j ->> 'enforced')::boolean and not (v_j ->> 'has_access')::boolean and v_j ->> 'source' is null,
    '6: switch on, nothing: no access';

  perform pg_temp.act_as_owner();
  perform pg_temp.set_sub(v_client, true, now() + interval '10 days');
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert (v_j ->> 'has_access')::boolean and v_j ->> 'source' = 'subscription', '6: a subscription is the source';
  assert v_j -> 'subscription' ->> 'status' = 'active' and (v_j -> 'subscription' ->> 'will_renew')::boolean
     and v_j -> 'subscription' ->> 'store' = 'app_store' and v_j -> 'subscription' ->> 'product_id' = 'smoke_monthly',
    '6: and the subscription is described';

  perform pg_temp.act_as_owner();
  update public.subscriptions set status = 'cancelled', will_renew = false where user_id = v_client;
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert (v_j ->> 'has_access')::boolean and v_j -> 'subscription' ->> 'status' = 'cancelled'
     and not (v_j -> 'subscription' ->> 'will_renew')::boolean,
    '6: cancelled but still running: access, and the app can tell it is cancelled';

  perform pg_temp.act_as_owner();
  delete from public.subscriptions where user_id = v_client;
  perform pg_temp.set_membership(v_client, 'active', null);
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert (v_j ->> 'has_access')::boolean and v_j ->> 'source' = 'membership'
     and v_j -> 'membership' ->> 'status' = 'active', '6: a membership is the source';

  -- The content flags say whether something is assigned; never what.
  perform pg_temp.act_as_owner();
  delete from public.memberships where client_id = v_client;
  update public.programs set status = 'archived' where user_id = v_client and status = 'active';
  update public.nutrition_plans set status = 'archived' where user_id = v_client and status = 'active';
  update public.supplement_plans set status = 'archived' where user_id = v_client and status = 'active';
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert not (v_j ->> 'has_program')::boolean and not (v_j ->> 'has_nutrition_plan')::boolean
     and not (v_j ->> 'has_supplement_plan')::boolean, '6: nothing assigned: all three flags are false';

  perform pg_temp.act_as_owner();
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_prog, v_client, v_coach, 'smoke: programa', 4, v_today, 'active');
  insert into public.nutrition_plans (id, user_id, assigned_by, name, status)
  values (v_nut, v_client, v_coach, 'smoke: nutrición', 'active');
  insert into public.supplement_plans (id, user_id, assigned_by, name, status)
  values (v_sup, v_client, v_coach, 'smoke: suplementos', 'active');
  perform pg_temp.act_as(v_client);
  v_j := public.get_my_access();
  assert (v_j ->> 'has_program')::boolean and (v_j ->> 'has_nutrition_plan')::boolean
     and (v_j ->> 'has_supplement_plan')::boolean and not (v_j ->> 'has_access')::boolean,
    '6: assigned content shows in the flags even when there is no access';

  -- The panel's list.
  assert pg_temp.sqlstate_of('select * from public.coach_client_access()') = '42501',
    '6: a client cannot list everyone''s access';
  perform pg_temp.act_as_owner();
  perform pg_temp.set_membership(v_client, 'active', null);
  perform pg_temp.act_as(v_coach);
  assert (select count(*) from public.coach_client_access()) = (select count(*) from public.profiles where role = 'user'),
    '6: the coach gets one row per client';
  select has_access, source, being_coached into v_has, v_src, v_coached
    from public.coach_client_access() where client_id = v_client;
  assert v_has and v_src = 'membership' and v_coached, '6: a client with a membership: access, being coached';
  select has_access, source, being_coached into v_has, v_src, v_coached
    from public.coach_client_access() where client_id = v_other;
  assert not v_has and v_src is null and not v_coached, '6: a client with nothing: no access, not coached';

  -- Who counts as «being coached»: today's rule while the switch is off, real access once on.
  perform pg_temp.act_as_owner();
  update public.premium_settings set enforced = false;
  delete from public.memberships where client_id = v_client;
  assert public.is_being_coached(v_client), '6: off: no membership row counts as being coached';
  foreach v_s in array array['active', 'paused', 'expired', 'cancelled'] loop
    perform pg_temp.set_membership(v_client, v_s, null);
    assert public.is_being_coached(v_client) = (v_s = 'active'),
      format('6: off: a %s membership follows the old rule', v_s);
  end loop;
  perform pg_temp.set_membership(v_client, 'active', v_today - 30);
  assert public.is_being_coached(v_client), '6: off: an active membership past its date still counts (the old rule read the status only)';
  update public.premium_settings set enforced = true;
  assert not public.is_being_coached(v_client), '6: on: an active membership past its date no longer counts';
  perform pg_temp.set_membership(v_client, 'active', null);
  assert public.is_being_coached(v_client), '6: on: an open-ended active membership counts';
  delete from public.memberships where client_id = v_client;
  assert not public.is_being_coached(v_client), '6: on: a client with nothing is not coached';
  perform pg_temp.set_sub(v_client, true, now() + interval '10 days');
  assert public.is_being_coached(v_client), '6: on: a live subscription counts';

  -- ---- 7. Requests --------------------------------------------------------------

  update public.premium_settings set enforced = true;
  update public.programs set status = 'archived' where user_id in (v_client, v_other) and status = 'active';
  update public.nutrition_plans set status = 'archived' where user_id in (v_client, v_other) and status = 'active';
  update public.supplement_plans set status = 'archived' where user_id in (v_client, v_other) and status = 'active';
  delete from public.subscriptions where user_id in (v_client, v_other);
  delete from public.memberships where client_id in (v_client, v_other);
  delete from public.content_requests where user_id in (v_client, v_other);
  delete from public.coach_notifications where client_id in (v_client, v_other) and kind = 'content_requested';

  assert pg_temp.message_of('select public.request_content(''program'')') = 'premium_required',
    '7: signed out: refused';
  perform pg_temp.act_as(v_coach);
  assert pg_temp.message_of('select public.request_content(''program'')') = 'premium_required',
    '7: the coach does not request';
  perform pg_temp.act_as(v_client);
  assert pg_temp.message_of('select public.request_content(''program'')') = 'premium_required',
    '7: a client without access is refused';
  assert pg_temp.sqlstate_of('select public.request_content(''program'')') = '42501',
    '7: with an insufficient-privilege code';

  perform pg_temp.act_as_owner();
  perform pg_temp.set_membership(v_client, 'active', null);
  perform pg_temp.act_as(v_client);
  v_id := (public.request_content('program', 'quiero ganar músculo')).id;
  assert (select kind from public.content_requests where id = v_id) = 'program'
     and (select status from public.content_requests where id = v_id) = 'pending'
     and (select note from public.content_requests where id = v_id) = 'quiero ganar músculo',
    '7: a client with access gets a pending request, with the note';
  assert (public.request_content('program', 'otra nota')).id = v_id,
    '7: asking again while one is pending returns that one';
  assert (select note from public.content_requests where id = v_id) = 'quiero ganar músculo',
    '7: and keeps its note';
  v_id2 := (public.request_content('nutrition_plan', repeat('x', 500))).id;
  assert v_id2 <> v_id, '7: the other kind is a request of its own (a 500-character note is fine)';
  assert pg_temp.message_of('select public.request_content(''yoga'')') = 'invalid_kind', '7: an unknown kind is refused';
  assert pg_temp.message_of(format('select public.request_content(%L, %L)', 'program', repeat('x', 501))) = 'note_too_long',
    '7: a 501-character note is refused';

  perform pg_temp.act_as_owner();
  assert (select count(*) from public.coach_notifications
           where client_id = v_client and kind = 'content_requested') = 2, '7: one notice per request, not per call';
  assert exists (select 1 from public.coach_notifications n
                  where n.dedupe_key = 'content_requested:' || v_id and n.client_id = v_client
                    and n.data ->> 'kind' = 'program' and n.data ->> 'request_id' = v_id::text
                    and n.data ->> 'note' = 'quiero ganar músculo'),
    '7: the notice names the request, its kind and its note';
  insert into public.content_requests (user_id, kind) values (v_other, 'nutrition_plan');

  perform pg_temp.act_as(v_client);
  assert pg_temp.sqlstate_of(format('insert into public.content_requests (user_id, kind) values (%L, %L)', v_client, 'program')) = '42501',
    '7: a client cannot insert a request directly';
  assert pg_temp.sqlstate_of('delete from public.content_requests') = '42501', '7: a client cannot delete a request';
  assert pg_temp.rows_affected('update public.content_requests set status = ''fulfilled''') = 0,
    '7: a client cannot resolve a request';
  assert pg_temp.rows_in('public.content_requests') = 2, '7: a client reads only their own requests';

  perform pg_temp.act_as(v_coach);
  assert pg_temp.rows_in('public.content_requests') >= 3, '7: the coach reads every request';
  assert pg_temp.rows_affected(format(
    'update public.content_requests set status = ''dismissed'', resolved_at = now(), resolved_by = %L where id = %L',
    v_coach, v_id)) = 1, '7: the coach dismisses a request';
  perform pg_temp.act_as(v_client);
  assert (public.request_content('program', 'otra vez')).id <> v_id, '7: after a dismissal the client can ask again';

  perform pg_temp.act_as_owner();
  perform pg_temp.set_membership(v_other, 'active', null);
  delete from public.content_requests where user_id = v_other;
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (gen_random_uuid(), v_other, v_coach, 'smoke: otro programa', 4, v_today, 'active');
  perform pg_temp.act_as(v_other);
  assert pg_temp.message_of('select public.request_content(''program'')') = 'already_assigned',
    '7: with an active program already assigned, a request is refused';

  -- ---- 8. The assignment fulfils the request ------------------------------------

  perform pg_temp.act_as_owner();
  delete from public.content_requests where user_id = v_client;
  perform pg_temp.act_as(v_client);
  v_id  := (public.request_content('program')).id;
  v_id2 := (public.request_content('nutrition_plan')).id;

  perform pg_temp.act_as(v_coach);
  insert into public.programs (id, name, duration_weeks, start_date, status, is_template)
  values (gen_random_uuid(), 'smoke: plantilla', 4, v_today, 'active', true);
  insert into public.supplement_plans (id, user_id, assigned_by, name, status)
  values (v_s2, v_client, v_coach, 'smoke: suplementos', 'active');
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (gen_random_uuid(), v_other, v_coach, 'smoke: de otro', 4, v_today, 'active');
  perform pg_temp.act_as_owner();
  assert (select count(*) from public.content_requests where user_id = v_client and status = 'pending') = 2,
    '8: a template, a supplement plan and another client''s program fulfil nothing';

  perform pg_temp.act_as(v_coach);
  insert into public.programs (id, user_id, assigned_by, name, duration_weeks, start_date, status)
  values (v_p2, v_client, v_coach, 'smoke: programa', 4, v_today, 'active');
  perform pg_temp.act_as_owner();
  assert (select status from public.content_requests where id = v_id) = 'fulfilled'
     and (select resolved_at from public.content_requests where id = v_id) is not null,
    '8: assigning a program fulfils the program request';
  assert (select status from public.content_requests where id = v_id2) = 'pending',
    '8: and leaves the nutrition request alone';

  perform pg_temp.act_as(v_coach);
  insert into public.nutrition_plans (id, user_id, assigned_by, name, status)
  values (v_n2, v_client, v_coach, 'smoke: nutrición', 'archived');
  perform pg_temp.act_as_owner();
  assert (select status from public.content_requests where id = v_id2) = 'pending',
    '8: an archived plan fulfils nothing';
  perform pg_temp.act_as(v_coach);
  update public.nutrition_plans set status = 'active' where id = v_n2;
  perform pg_temp.act_as_owner();
  assert (select status from public.content_requests where id = v_id2) = 'fulfilled',
    '8: a plan becoming active fulfils the nutrition request';

  perform pg_temp.set_membership(v_client, 'active', null);
  perform pg_temp.act_as(v_client);
  assert pg_temp.message_of('select public.request_content(''program'')') = 'already_assigned', '8: now a program request is refused';
  assert pg_temp.message_of('select public.request_content(''nutrition_plan'')') = 'already_assigned',
    '8: and so is a nutrition request';

  -- ---- 9. The lock on reads -----------------------------------------------------

  perform pg_temp.act_as_owner();
  insert into public.program_weeks (program_id, week_number) values (v_p2, 1);
  insert into public.program_days (id, program_id, day_index) values (v_day, v_p2, 1);
  insert into public.program_exercises (id, program_day_id, custom_name) values (v_pe, v_day, 'smoke: sentadilla');
  insert into public.nutrition_plan_targets (plan_id, day_type) values (v_n2, 'both');
  insert into public.nutrition_plan_meals (id, plan_id, slot_index) values (v_pm, v_n2, 1);
  insert into public.nutrition_plan_options (id, plan_meal_id) values (v_opt, v_pm);
  insert into public.nutrition_plan_option_items (option_id, name) values (v_opt, 'smoke: arroz');
  insert into public.supplement_plan_items (plan_id, name) values (v_s2, 'smoke: creatina');
  -- History the client made while they had access.
  insert into public.program_exercise_completions (user_id, week_number) values (v_client, 1);
  insert into public.workout_set_logs (user_id, week_number, set_index) values (v_client, 1, 1);
  insert into public.supplement_intake_logs (user_id, taken_on, supplement_name) values (v_client, v_today, 'smoke: creatina');
  insert into public.meals (id, user_id, name, meal_type) values (v_meal, v_client, 'smoke', 'lunch');
  insert into public.meal_items (meal_id, user_id, name) values (v_meal, v_client, 'smoke: arroz');
  insert into public.body_measurements (user_id, measured_on) values (v_client, v_today)
  on conflict do nothing;

  perform pg_temp.act_as(v_client);
  foreach v_t in array v_locked loop
    assert pg_temp.rows_in('public.' || v_t) > 0, format('9: with access the client reads %s', v_t);
  end loop;

  perform pg_temp.act_as_owner();
  delete from public.memberships where client_id = v_client;
  perform pg_temp.act_as(v_client);
  foreach v_t in array v_locked loop
    assert pg_temp.rows_in('public.' || v_t) = 0, format('9: without access %s is hidden', v_t);
  end loop;
  assert (public.get_my_access() ->> 'has_program')::boolean
     and (public.get_my_access() ->> 'has_nutrition_plan')::boolean
     and (public.get_my_access() ->> 'has_supplement_plan')::boolean,
    '9: the locked client is still told that something is assigned (a flag, never the content)';
  foreach v_t in array v_history loop
    assert pg_temp.rows_in('public.' || v_t) > 0, format('9: without access the client still reads their %s history', v_t);
  end loop;

  perform pg_temp.act_as(v_coach);
  foreach v_t in array v_locked loop
    assert pg_temp.rows_in('public.' || v_t) > 0, format('9: the coach still reads %s', v_t);
  end loop;

  -- ---- 10. The 72-hour grace, then the lock on writes and reads ----------------------

  perform pg_temp.act_as_owner();
  perform pg_temp.set_membership(v_client, 'active', v_today - 2);
  perform pg_temp.act_as(v_client);
  assert not (public.get_my_access() ->> 'has_access')::boolean,
    '10: inside the grace the app is still told there is no access (it shows the locked state)';
  foreach v_t in array v_locked loop
    assert pg_temp.rows_in('public.' || v_t) > 0, format('10: inside the grace %s is still readable', v_t);
  end loop;
  foreach v_stmt in array pg_temp.writes(v_client, v_meal, v_pe, 2) loop
    assert pg_temp.sqlstate_of(v_stmt) is null, format('10: inside the grace, this is accepted: %s (got: %s)', left(v_stmt, 70), pg_temp.message_of(v_stmt));
  end loop;

  perform pg_temp.act_as_owner();
  perform pg_temp.set_membership(v_client, 'active', v_today - 5);
  perform pg_temp.act_as(v_client);
  foreach v_t in array v_locked loop
    assert pg_temp.rows_in('public.' || v_t) = 0, format('10: after the grace %s is hidden', v_t);
  end loop;
  foreach v_stmt in array pg_temp.writes(v_client, v_meal, v_pe, 3) loop
    assert pg_temp.sqlstate_of(v_stmt) = '42501', format('10: after the grace, this is refused: %s (got: %s)', left(v_stmt, 70), coalesce(pg_temp.message_of(v_stmt), 'it ran'));
  end loop;
  assert pg_temp.rows_affected('update public.supplement_intake_logs set supplement_name = supplement_name') = 0,
    '10: after the grace, an update is blocked';
  assert pg_temp.rows_affected('update public.workout_set_logs set week_number = week_number') = 0,
    '10: on the set logs too';
  assert pg_temp.rows_affected('delete from public.program_exercise_completions') = 0,
    '10: and a delete is blocked';
  assert pg_temp.rows_affected('delete from public.meal_items') = 0, '10: on the meal items too';
  assert pg_temp.sqlstate_of(format('insert into public.body_measurements (user_id, measured_on) values (%L, %L)',
           v_client, v_today - 9)) is null, '10: weight and measurements are never locked';
  assert pg_temp.rows_affected('update public.profiles set display_name = display_name where id = auth.uid()') = 1,
    '10: nor is the profile';

  perform pg_temp.act_as_owner();
  perform pg_temp.set_membership(v_client, 'active', null);
  perform pg_temp.act_as(v_client);
  assert pg_temp.rows_affected('update public.supplement_intake_logs set supplement_name = supplement_name') > 0,
    '10: with access again, updates work';
  assert pg_temp.rows_affected('delete from public.program_exercise_completions') > 0, '10: and so do deletes';

  -- ---- 11. Dark: with the switch off nobody is locked -----------------------------------

  perform pg_temp.act_as_owner();
  update public.premium_settings set enforced = false;
  delete from public.memberships where client_id = v_client;
  perform pg_temp.act_as(v_client);
  foreach v_t in array v_locked loop
    assert pg_temp.rows_in('public.' || v_t) > 0, format('11: off: a client with nothing still reads %s', v_t);
  end loop;
  foreach v_stmt in array pg_temp.writes(v_client, v_meal, v_pe, 4) loop
    assert pg_temp.sqlstate_of(v_stmt) is null, format('11: off: this write is accepted: %s (got: %s)', left(v_stmt, 70), pg_temp.message_of(v_stmt));
  end loop;
  perform pg_temp.act_as_owner();
  assert position('is_being_coached' in pg_get_functiondef('public.create_coach_daily_notices'::regproc)) > 0
     and position('memberships' in pg_get_functiondef('public.create_coach_daily_notices'::regproc)) = 0,
    '11: the daily notices ask is_being_coached, not the memberships table';
  assert position('is_being_coached' in pg_get_functiondef('public.send_block_ending_pushes'::regproc)) > 0
     and position('memberships' in pg_get_functiondef('public.send_block_ending_pushes'::regproc)) = 0,
    '11: and so do the block-ending pushes';

  raise exception 'SMOKE OK: premium; nothing was saved';
end $$;
