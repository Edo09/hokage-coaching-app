-- ==========================================================================
-- Premium access: the switch, the subscription tables and the one rule.
-- (docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md)
--
-- «Does this person have access to the coach's programs and plans?» is
-- answered here once, in SQL, for the app, the panel and the RLS policies
-- alike. Three things can grant it: the coach role, a store subscription
-- (written only by the revenuecat-webhook / sync-subscription functions
-- through the writers below) and a coach-set membership.
--
-- It ships DARK. premium_settings.enforced starts false, and while it is false
-- has_premium_access() and premium_content_access() are true for everyone and
-- is_being_coached() is the old membership rule, so applying this file
-- changes nothing for any user. Going live is one statement, after the app
-- with a paywall is installed and the stores are set up:
--
--   update public.premium_settings set enforced = true, updated_at = now();
--
-- (and the same with false to go back).
--
-- What is here:
--   premium_settings     the switch (one row)
--   subscriptions        one row per user: the current store subscription
--   revenuecat_events    every webhook delivery, once (idempotency + audit)
--   premium_source_for   the rule: 'coach' | 'subscription' | 'membership' | null
--   premium_access_for / premium_content_access_for / is_being_coached
--                        the rule with the switch applied (server only); the
--                        content one adds the 72-hour grace the lock uses
--   has_premium_access / premium_content_access
--                        the same for the caller: the first is what the app
--                        and request_content ask, the second what the lock
--                        policies call
--   get_my_access        what the app is told, in one row
--   coach_client_access  what the panel is told, one row per client
--   record_revenuecat_event / finish_revenuecat_event / apply_subscription_snapshot
--                        the writers (service role only)
--
-- Tables are granted one by one (the project does not grant wholesale):
-- service_role included, anon and authenticated only what they need.
--
-- Idempotent. Run with `supabase db query --remote=<ref> --yes -f <this file>`
-- or in the SQL editor. supabase/scripts/smoke_premium.sql checks it.
-- ==========================================================================

begin;

-- 1) The switch ------------------------------------------------------------------
create table if not exists public.premium_settings (
  id         boolean primary key default true check (id),
  enforced   boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.premium_settings (id) values (true) on conflict (id) do nothing;

alter table public.premium_settings enable row level security;
revoke all on public.premium_settings from anon, authenticated;
grant select on public.premium_settings to service_role;

-- 2) subscriptions: the current state, one row per user -------------------------------
-- cancelled = auto-renew is off but the paid period has not ended (still has
-- access); expired = access has ended. access_until is the end of the paid
-- period or of the grace period, whichever is later, 'infinity' for an
-- open-ended grant.
create table if not exists public.subscriptions (
  user_id                   uuid primary key references public.profiles(id) on delete cascade,
  product_id                text not null,
  store                     text not null,
  environment               text not null check (environment in ('production', 'sandbox')),
  status                    text not null check (status in ('active', 'cancelled', 'billing_issue', 'expired')),
  is_premium                boolean not null default false,
  will_renew                boolean not null default false,
  started_at                timestamptz,
  current_period_started_at timestamptz,
  expires_at                timestamptz,
  grace_expires_at          timestamptz,
  access_until              timestamptz not null default now(),
  rc_app_user_id            text,
  last_event_id             text,
  last_event_at             timestamptz,
  last_synced_at            timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
drop policy if exists "user reads own subscription" on public.subscriptions;
create policy "user reads own subscription" on public.subscriptions for select
  using (user_id = (select auth.uid()));
drop policy if exists "coach reads subscriptions" on public.subscriptions;
create policy "coach reads subscriptions" on public.subscriptions for select
  using (public.is_coach());

revoke all on public.subscriptions from anon, authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert, update on public.subscriptions to service_role;

-- 3) revenuecat_events: every delivery once --------------------------------------------
create table if not exists public.revenuecat_events (
  event_id    text primary key,
  event_type  text not null,
  app_user_id text,
  event_at    timestamptz,
  payload     jsonb not null,
  received_at timestamptz not null default now(),
  outcome     text not null default 'received'
              check (outcome in ('received', 'synced', 'ignored', 'unknown_user', 'failed')),
  error       text
);

alter table public.revenuecat_events enable row level security;
revoke all on public.revenuecat_events from anon, authenticated;
grant select, insert, update on public.revenuecat_events to service_role;

-- 4) The rule -------------------------------------------------------------------------
create or replace function public.premium_enforced()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enforced from public.premium_settings s where s.id), false)
$$;

-- Who grants access to this user, the switch ignored. The one place the rule
-- is written. A membership counts while its status is active and its date
-- (the coach's calendar day) has not passed.
create or replace function public.premium_source_for(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.profiles p
                  where p.id = p_user and p.role = 'coach') then 'coach'
    when exists (select 1 from public.subscriptions s
                  where s.user_id = p_user and s.is_premium and s.access_until > now()) then 'subscription'
    when exists (select 1 from public.memberships m
                  where m.client_id = p_user and m.status = 'active'
                    and (m.expires_at is null or m.expires_at >= public.coach_local_date())) then 'membership'
  end
$$;

create or replace function public.premium_access_for(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not public.premium_enforced() or public.premium_source_for(p_user) is not null
$$;

-- What the lock uses, not premium_access_for: the coach's content and the
-- client's logging stay open for 72 hours after access ends. What a client
-- logged offline just before an expiry still syncs just after it; a renewal
-- the store processes late does not flicker the program away; and the
-- triggers that stamp a check-off or a set read the program as the client, so
-- the write grace needs the read grace. A revoked subscription
-- (is_premium = false) counts its hours from the sync that revoked it; a
-- lapsed membership gets 3 calendar days. The app still shows the locked
-- state the moment access ends (get_my_access says has_access = false).
create or replace function public.premium_content_access_for(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.premium_access_for(p_user)
      or exists (select 1 from public.subscriptions s
                  where s.user_id = p_user
                    and (case when s.is_premium then s.access_until
                              else least(s.access_until, s.last_synced_at) end)
                        > now() - interval '72 hours')
      or exists (select 1 from public.memberships m
                  where m.client_id = p_user and m.status = 'active'
                    and m.expires_at >= public.coach_local_date() - 3)
$$;

-- «Being coached», for the coach's daily notices, the block-ending pushes and
-- the panel's rules. While the switch is off this is exactly the rule they
-- have always used (no membership row, or an active one); once on, it is
-- access.
create or replace function public.is_being_coached(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.premium_enforced() then public.premium_source_for(p_user) is not null
    else not exists (select 1 from public.memberships m
                      where m.client_id = p_user and m.status <> 'active')
  end
$$;

-- What the lock policies call for the signed-in user. (select …) in a policy
-- lets Postgres evaluate it once per statement.
create or replace function public.has_premium_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.premium_access_for(auth.uid())
$$;

create or replace function public.premium_content_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.premium_content_access_for(auth.uid())
$$;

-- 5) What the app and the panel are told ------------------------------------------------
-- One row for the app. The has_* flags say whether an active program / plan is
-- assigned, so a locked screen can say «Renovar» instead of «Solicitar»; they
-- never carry the content.
create or replace function public.get_my_access()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_enforced boolean := public.premium_enforced();
  v_source   text;
begin
  if v_uid is null then
    return null;
  end if;
  v_source := public.premium_source_for(v_uid);
  return jsonb_build_object(
    'enforced',   v_enforced,
    'has_access', (not v_enforced) or v_source is not null,
    'source',     case when v_source is not null then v_source
                       when not v_enforced then 'open' end,
    'subscription', (select jsonb_build_object(
        'status', s.status, 'store', s.store, 'product_id', s.product_id,
        'environment', s.environment, 'is_premium', s.is_premium, 'will_renew', s.will_renew,
        'started_at', s.started_at, 'current_period_started_at', s.current_period_started_at,
        'expires_at', s.expires_at, 'grace_expires_at', s.grace_expires_at,
        'access_until', s.access_until, 'last_synced_at', s.last_synced_at)
      from public.subscriptions s where s.user_id = v_uid),
    'membership', (select jsonb_build_object('status', m.status, 'expires_at', m.expires_at)
      from public.memberships m where m.client_id = v_uid),
    'has_program', exists (select 1 from public.programs p
      where p.user_id = v_uid and p.status = 'active' and not p.is_template),
    'has_nutrition_plan', exists (select 1 from public.nutrition_plans p
      where p.user_id = v_uid and p.status = 'active' and not p.is_template),
    'has_supplement_plan', exists (select 1 from public.supplement_plans p
      where p.user_id = v_uid and p.status = 'active' and not p.is_template)
  );
end;
$$;

-- One row per client for the panel's lists, badges and attention rules, so
-- they read the rule instead of copying it. Coach only.
create or replace function public.coach_client_access()
returns table (client_id uuid, has_access boolean, source text, being_coached boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_coach() then
    raise exception 'coach only' using errcode = '42501';
  end if;
  return query
    select p.id,
           public.premium_access_for(p.id),
           public.premium_source_for(p.id),
           public.is_being_coached(p.id)
      from public.profiles p
     where p.role = 'user';
end;
$$;

-- 6) The writers: the Edge Functions only (service role) ----------------------------------
-- Records a webhook delivery. 'new' (first time), 'repeat_done' (already
-- handled: skip) or 'repeat_retry' (seen but never finished: run it again,
-- which is what a retry after a failure is).
create or replace function public.record_revenuecat_event(
  p_event_id text, p_event_type text, p_app_user_id text, p_event_at timestamptz, p_payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_outcome text;
begin
  insert into public.revenuecat_events (event_id, event_type, app_user_id, event_at, payload)
  values (p_event_id, p_event_type, p_app_user_id, p_event_at, p_payload)
  on conflict (event_id) do nothing;
  if found then
    return 'new';
  end if;
  select e.outcome into v_outcome from public.revenuecat_events e where e.event_id = p_event_id;
  return case when v_outcome in ('synced', 'ignored', 'unknown_user')
              then 'repeat_done' else 'repeat_retry' end;
end;
$$;

create or replace function public.finish_revenuecat_event(
  p_event_id text, p_outcome text, p_error text default null)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.revenuecat_events set outcome = p_outcome, error = p_error where event_id = p_event_id
$$;

-- Writes what RevenueCat's REST API said about one user (the patch the
-- function computed: product_id, store, environment, status, is_premium,
-- will_renew, started_at, current_period_started_at, expires_at,
-- grace_expires_at, access_until, rc_app_user_id). Returns 'applied', 'stale'
-- (a newer fetch is already stored: the older answer must not overwrite it) or
-- 'skipped' (no such profile, or nothing to record for a user who never had a
-- subscription). last_synced_at is the fetch time, not now(), so two
-- overlapping syncs cannot leave the older answer.
create or replace function public.apply_subscription_snapshot(
  p_user uuid, p_patch jsonb, p_fetched_at timestamptz,
  p_event_id text default null, p_event_at timestamptz default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- A patch with no product or store (the customer has nothing now) keeps the
  -- stored ones. Resolved before the insert: NOT NULL is checked on the row
  -- proposed for insertion, before ON CONFLICT decides to update instead.
  v_product text := coalesce(nullif(p_patch ->> 'product_id', ''),
                             (select s.product_id from public.subscriptions s where s.user_id = p_user));
  v_store   text := coalesce(nullif(p_patch ->> 'store', ''),
                             (select s.store from public.subscriptions s where s.user_id = p_user));
begin
  if not exists (select 1 from public.profiles where id = p_user) then
    return 'skipped';
  end if;
  if v_product is null or v_store is null then
    return 'skipped';
  end if;

  insert into public.subscriptions as s (
    user_id, product_id, store, environment, status, is_premium, will_renew,
    started_at, current_period_started_at, expires_at, grace_expires_at, access_until,
    rc_app_user_id, last_event_id, last_event_at, last_synced_at, updated_at)
  values (
    p_user, v_product, v_store, p_patch ->> 'environment', p_patch ->> 'status',
    (p_patch ->> 'is_premium')::boolean, (p_patch ->> 'will_renew')::boolean,
    (p_patch ->> 'started_at')::timestamptz, (p_patch ->> 'current_period_started_at')::timestamptz,
    (p_patch ->> 'expires_at')::timestamptz, (p_patch ->> 'grace_expires_at')::timestamptz,
    coalesce((p_patch ->> 'access_until')::timestamptz, now()),
    p_patch ->> 'rc_app_user_id', p_event_id, p_event_at, p_fetched_at, now())
  on conflict (user_id) do update set
    product_id                = coalesce(excluded.product_id, s.product_id),
    store                     = coalesce(excluded.store, s.store),
    environment               = excluded.environment,
    status                    = excluded.status,
    is_premium                = excluded.is_premium,
    will_renew                = excluded.will_renew,
    started_at                = coalesce(excluded.started_at, s.started_at),
    current_period_started_at = coalesce(excluded.current_period_started_at, s.current_period_started_at),
    expires_at                = coalesce(excluded.expires_at, s.expires_at),
    grace_expires_at          = excluded.grace_expires_at,
    access_until              = excluded.access_until,
    rc_app_user_id            = coalesce(excluded.rc_app_user_id, s.rc_app_user_id),
    last_event_id             = coalesce(excluded.last_event_id, s.last_event_id),
    last_event_at             = coalesce(excluded.last_event_at, s.last_event_at),
    last_synced_at            = excluded.last_synced_at,
    updated_at                = now()
  where s.last_synced_at <= p_fetched_at;

  return case when found then 'applied' else 'stale' end;
end;
$$;

-- 7) Who may call what ---------------------------------------------------------------------
-- Functions are executable by everyone unless revoked.
revoke all on function public.premium_enforced()                    from public, anon, authenticated;
revoke all on function public.premium_source_for(uuid)              from public, anon, authenticated;
revoke all on function public.premium_access_for(uuid)              from public, anon, authenticated;
revoke all on function public.premium_content_access_for(uuid)        from public, anon, authenticated;
revoke all on function public.is_being_coached(uuid)                from public, anon, authenticated;
revoke all on function public.record_revenuecat_event(text, text, text, timestamptz, jsonb)
                                                                    from public, anon, authenticated;
revoke all on function public.finish_revenuecat_event(text, text, text)
                                                                    from public, anon, authenticated;
revoke all on function public.apply_subscription_snapshot(uuid, jsonb, timestamptz, text, timestamptz)
                                                                    from public, anon, authenticated;
grant execute on function public.record_revenuecat_event(text, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.finish_revenuecat_event(text, text, text)                    to service_role;
grant execute on function public.apply_subscription_snapshot(uuid, jsonb, timestamptz, text, timestamptz)
                                                                                              to service_role;

-- The lock policies call these as the signed-in role, so they must be executable.
revoke all on function public.has_premium_access()   from public;
revoke all on function public.premium_content_access() from public;
grant execute on function public.has_premium_access()   to anon, authenticated;
grant execute on function public.premium_content_access() to anon, authenticated;

revoke all on function public.get_my_access()        from public, anon;
revoke all on function public.coach_client_access()  from public, anon;
grant execute on function public.get_my_access()        to authenticated;
grant execute on function public.coach_client_access()  to authenticated;

-- 8) Realtime: the app hears a change to its own subscription or membership at
-- once (RLS applies: only the row's owner receives it) ----------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['subscriptions', 'memberships'] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

commit;
