-- ==========================================================================
-- Meal registrations: the client's plan meals, estimated on the server.
--
-- The app's Nutrición tab no longer keeps a free-form diary. For each of
-- today's plan meals the client registers what they ate: the plan option,
-- «otra cosa» (typed), or «No la comí». A registration is one meal_items row
-- in the day's meals container, as diary entries were, so the coach panel,
-- Inicio and Progreso keep reading the same tables. Design:
-- docs/superpowers/specs/2026-11-05-nutrition-meal-registration-design.md.
--
-- New meal_items columns (the app and the panel read these names):
--   plan_meal_id       the plan meal the row registers (on delete set null)
--   kind               'plan' | 'other' | 'skipped'; null = an old diary row,
--                      which old app builds keep writing and nothing here
--                      ever touches
--   original_text      «otra cosa» exactly as the client typed it; name gets
--                      the spelling-corrected text once the estimate lands
--   estimate_status    'pending' | 'done' | 'failed'; null on old diary rows
--                      and on «No la comí»
--   estimate_version, estimate_attempts, estimate_next_at
--                      server bookkeeping, see meal_items_estimate_state()
--
-- Who may change what. A client write is one made with the client's JWT,
-- directly: auth.uid() set and pg_trigger_depth() = 1 (as in
-- stamp_set_log_snapshot). The server owns the estimate: whatever a client
-- sends for the status, the numbers, the version, the attempts or the next
-- try is replaced, except a failed row marked pending again (a retry).
-- Writes by estimate-meal (service role), pg_cron, the SQL editor and
-- cascades (the coach's plan save nulls links one trigger level down) pass
-- through untouched.
--
-- Sending. AFTER triggers post {id, version} through pg_net to the
-- estimate-meal Edge Function, with the secret from Supabase Vault
-- (estimate_meal_url, estimate_meal_secret, both set by hand); a pg_cron job
-- re-sends lost calls and a daily one retries recent failures. The function
-- writes back through service-role-only RPCs, and only while the row's
-- version still matches. No trigger here ever fails the client's write: the
-- app's outbox drops any write the database rejects.
--
-- Additive and idempotent. Run in the Supabase SQL editor after deploying
-- estimate-meal and setting its secrets (docs/ADMIN_WEB_DB_CONNECTION.md §6.6).
-- ==========================================================================

begin;

-- 1) Columns, version sequence, indexes -------------------------------------------
alter table public.meal_items
  add column if not exists plan_meal_id uuid references public.nutrition_plan_meals(id) on delete set null,
  add column if not exists kind text check (kind in ('plan', 'other', 'skipped')),
  add column if not exists original_text text,
  add column if not exists estimate_status text check (estimate_status in ('pending', 'done', 'failed')),
  add column if not exists estimate_version bigint,
  add column if not exists estimate_attempts smallint not null default 0,
  add column if not exists estimate_next_at timestamptz;

-- One global sequence, not a per-row counter: a row re-inserted under the
-- same id after an undo never reuses a version an earlier answer carries.
create sequence if not exists public.meal_estimate_version_seq;
revoke all on sequence public.meal_estimate_version_seq from public, anon, authenticated;

create index if not exists idx_meal_items_plan_meal
  on public.meal_items(plan_meal_id) where plan_meal_id is not null;
create index if not exists idx_meal_items_estimate_due
  on public.meal_items(estimate_next_at) where estimate_status = 'pending';
create index if not exists idx_meal_items_estimate_failed
  on public.meal_items(created_at) where estimate_status = 'failed';

-- 2) Vault check and dangling links ------------------------------------------------
-- Whether estimate-meal can be called: both secrets are in Vault. Never raises.
create or replace function public.meal_estimate_configured()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (select 1 from vault.decrypted_secrets where name = 'estimate_meal_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'estimate_meal_secret');
exception when others then
  return false;
end;
$$;

revoke all on function public.meal_estimate_configured() from public, anon, authenticated;

-- A registration queued offline can arrive after the coach removed its option
-- or meal. The foreign key would refuse it, and the outbox would drop it, so
-- the link is dropped instead. The check takes the lock the foreign key would
-- (for key share): it waits for a coach's save that is deleting the row, then
-- sees it gone. Links are checked only when they change, so the cron's and the
-- function's updates take no plan locks.
create or replace function public.meal_items_drop_missing_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.plan_option_id is not null
       and (tg_op = 'INSERT' or new.plan_option_id is distinct from old.plan_option_id) then
      perform 1 from public.nutrition_plan_options where id = new.plan_option_id for key share;
      if not found then
        new.plan_option_id := null;
      end if;
    end if;
    if new.plan_meal_id is not null
       and (tg_op = 'INSERT' or new.plan_meal_id is distinct from old.plan_meal_id) then
      perform 1 from public.nutrition_plan_meals where id = new.plan_meal_id for key share;
      if not found then
        new.plan_meal_id := null;
      end if;
    end if;
  exception when others then
    raise warning 'meal_items %: link check skipped: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.meal_items_drop_missing_links() from public, anon, authenticated;

drop trigger if exists trg_meal_items_10_links on public.meal_items;
create trigger trg_meal_items_10_links
  before insert or update of plan_option_id, plan_meal_id on public.meal_items
  for each row
  execute function public.meal_items_drop_missing_links();

-- 3) The estimate state ---------------------------------------------------------------
-- The app writes whole rows from its cache, which can be stale, so for a
-- client write this trigger decides the server-owned columns itself:
--   * content is name + photo for a plan row, original_text + photo for
--     «otra cosa», the kind alone for «No la comí»; a kind change is content;
--   * a new or changed plan / «otra cosa» row starts a send: pending, numbers
--     0, a new version, and (with Vault set) attempt 1 with the next try one
--     3-minute lease ahead — the AFTER trigger then posts it;
--   * a failed row marked pending again is a retry, handled the same way;
--   * anything else keeps the server's status, numbers and corrected name,
--     so a replayed write never re-runs a finished estimate.
create or replace function public.meal_items_estimate_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  boolean := auth.uid() is not null and pg_trigger_depth() = 1;
  v_content boolean;
  v_retry   boolean;
begin
  if not v_client or new.kind is null then
    return new;
  end if;

  begin
    if tg_op = 'UPDATE' then
      new.estimate_version  := old.estimate_version;
      new.estimate_attempts := old.estimate_attempts;
      new.estimate_next_at  := old.estimate_next_at;
    else
      new.estimate_version  := null;
      new.estimate_attempts := 0;
      new.estimate_next_at  := null;
    end if;

    if new.kind = 'skipped' then
      new.estimate_status := null;
      new.calories := 0;
      new.protein_g := 0;
      new.carbs_g := 0;
      new.fat_g := 0;
      new.photo_path := null;
      new.original_text := null;
      if tg_op = 'INSERT' or old.kind is distinct from 'skipped' then
        new.estimate_version := nextval('public.meal_estimate_version_seq');
      end if;
      return new;
    end if;

    if new.kind = 'other' then
      if tg_op = 'INSERT' or old.kind is distinct from 'other'
         or new.original_text is distinct from old.original_text then
        new.original_text := coalesce(new.original_text, new.name);
        new.name := new.original_text;
      else
        new.name := old.name;            -- keep the server's correction
      end if;
    end if;

    v_content := tg_op = 'INSERT'
              or new.kind is distinct from old.kind
              or new.photo_path is distinct from old.photo_path
              or (new.kind = 'plan' and new.name is distinct from old.name)
              or (new.kind = 'other' and new.original_text is distinct from old.original_text);
    v_retry := tg_op = 'UPDATE' and old.estimate_status = 'failed' and new.estimate_status = 'pending';

    if v_content or v_retry then
      new.estimate_status := 'pending';
      new.calories := 0;
      new.protein_g := 0;
      new.carbs_g := 0;
      new.fat_g := 0;
      new.estimate_version := nextval('public.meal_estimate_version_seq');
      if public.meal_estimate_configured() then
        new.estimate_attempts := 1;
        new.estimate_next_at := now() + interval '3 minutes';
      else
        new.estimate_attempts := 0;
        new.estimate_next_at := now();
      end if;
    else
      new.estimate_status := old.estimate_status;
      new.calories := old.calories;
      new.protein_g := old.protein_g;
      new.carbs_g := old.carbs_g;
      new.fat_g := old.fat_g;
    end if;
  exception when others then
    raise warning 'meal_items %: estimate state not applied: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.meal_items_estimate_state() from public, anon, authenticated;

drop trigger if exists trg_meal_items_20_estimate on public.meal_items;
create trigger trg_meal_items_20_estimate
  before insert or update on public.meal_items
  for each row
  execute function public.meal_items_estimate_state();

-- 4) Sending -----------------------------------------------------------------------
-- The one place that posts to estimate-meal: {id, version} with the secret in
-- a header. The URL and the secret come from Vault, set by hand; without them
-- nothing is sent and the row waits for the cron. pg_net sends only once the
-- transaction commits. Never raises.
create or replace function public.send_meal_estimate(p_id uuid, p_version bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'estimate_meal_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'estimate_meal_secret';
  if v_url is null or v_secret is null then
    return false;
  end if;
  perform net.http_post(
    url                  := v_url,
    body                 := jsonb_build_object('id', p_id, 'version', p_version),
    headers              := jsonb_build_object('Content-Type', 'application/json',
                                               'x-estimate-secret', v_secret),
    timeout_milliseconds := 10000);
  return true;
exception when others then
  raise warning 'meal estimate % not sent: %', p_id, sqlerrm;
  return false;
end;
$$;

revoke all on function public.send_meal_estimate(uuid, bigint) from public, anon, authenticated;

-- Posts exactly when meal_items_estimate_state() started a send for a client
-- write: it bumped the version and, with Vault set, counted attempt 1. Server
-- writes post nothing from here (auth.uid() is null for them); the cron sends
-- its own. Never updates the row.
create or replace function public.meal_items_send_estimate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_meal_estimate(new.id, new.estimate_version);
  return null;
end;
$$;

revoke all on function public.meal_items_send_estimate() from public, anon, authenticated;

drop trigger if exists trg_meal_items_30_send_ins on public.meal_items;
create trigger trg_meal_items_30_send_ins
  after insert on public.meal_items
  for each row
  when (new.kind in ('plan', 'other') and new.estimate_status = 'pending'
        and new.estimate_attempts > 0 and auth.uid() is not null)
  execute function public.meal_items_send_estimate();

drop trigger if exists trg_meal_items_30_send_upd on public.meal_items;
create trigger trg_meal_items_30_send_upd
  after update on public.meal_items
  for each row
  when (new.kind in ('plan', 'other') and new.estimate_status = 'pending'
        and new.estimate_attempts > 0 and auth.uid() is not null
        and new.estimate_version is distinct from old.estimate_version)
  execute function public.meal_items_send_estimate();

-- 5) Write-back, for estimate-meal (service role only) --------------------------------
-- Each acts only while the row is still pending and still the version the call
-- was sent for; otherwise the answer is stale and changes nothing.
create or replace function public.finish_meal_estimate(
  p_id uuid,
  p_version bigint,
  p_calories integer,
  p_protein_g numeric,
  p_carbs_g numeric,
  p_fat_g numeric,
  p_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meal_items
     set calories = p_calories,
         protein_g = p_protein_g,
         carbs_g = p_carbs_g,
         fat_g = p_fat_g,
         name = coalesce(p_name, name),
         estimate_status = 'done',
         estimate_next_at = null
   where id = p_id and estimate_version = p_version and estimate_status = 'pending';
  return found;
end;
$$;

-- The attempt was counted when the call was sent, so a failure only schedules
-- the next try (1, 5, 15, then 60 minutes) or, after attempt 5, fails for good.
create or replace function public.fail_meal_estimate(p_id uuid, p_version bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meal_items
     set estimate_status = case when estimate_attempts >= 5 then 'failed' else 'pending' end,
         estimate_next_at = case
           when estimate_attempts >= 5 then null
           when estimate_attempts <= 1 then now() + interval '1 minute'
           when estimate_attempts = 2 then now() + interval '5 minutes'
           when estimate_attempts = 3 then now() + interval '15 minutes'
           else now() + interval '60 minutes'
         end
   where id = p_id and estimate_version = p_version and estimate_status = 'pending';
  return found;
end;
$$;

-- The client's AI quota is used up: give the attempt back and look again in
-- 15 minutes. It never fails for that reason.
create or replace function public.defer_meal_estimate(p_id uuid, p_version bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.meal_items
     set estimate_attempts = greatest(estimate_attempts - 1, 0),
         estimate_next_at = now() + interval '15 minutes'
   where id = p_id and estimate_version = p_version and estimate_status = 'pending';
  return found;
end;
$$;

revoke all on function public.finish_meal_estimate(uuid, bigint, integer, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.fail_meal_estimate(uuid, bigint) from public, anon, authenticated;
revoke all on function public.defer_meal_estimate(uuid, bigint) from public, anon, authenticated;
grant execute on function public.finish_meal_estimate(uuid, bigint, integer, numeric, numeric, numeric, text) to service_role;
grant execute on function public.fail_meal_estimate(uuid, bigint) to service_role;
grant execute on function public.defer_meal_estimate(uuid, bigint) to service_role;

-- 6) Retries -------------------------------------------------------------------------
-- Every 2 minutes: re-send what is due, whatever its date. Each send moves the
-- row's next try one 3-minute lease ahead and counts the attempt in the same
-- update, so a call still running is never sent twice and a lost one goes out
-- again once its lease runs out. Rows that used every attempt fail for good.
create or replace function public.resend_meal_estimates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r   record;
  v_n integer := 0;
begin
  if not public.meal_estimate_configured() then
    return 0;
  end if;

  update public.meal_items
     set estimate_status = 'failed', estimate_next_at = null
   where estimate_status = 'pending' and kind in ('plan', 'other')
     and estimate_attempts >= 5 and estimate_next_at <= now();

  for r in
    with due as (
      select id
        from public.meal_items
       where estimate_status = 'pending' and kind in ('plan', 'other')
         and estimate_attempts < 5
         and (estimate_next_at is null or estimate_next_at <= now())
       order by estimate_next_at nulls first
       limit 50
       for update skip locked
    )
    update public.meal_items m
       set estimate_attempts = m.estimate_attempts + 1,
           estimate_next_at = now() + interval '3 minutes',
           estimate_version = coalesce(m.estimate_version, nextval('public.meal_estimate_version_seq'))
      from due
     where m.id = due.id
    returning m.id, m.estimate_version
  loop
    if public.send_meal_estimate(r.id, r.estimate_version) then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- Once a day: each failed estimate from the last 7 days gets one more try
-- (attempt 5), so an outage heals without the client tapping «Sin estimar».
create or replace function public.retry_failed_meal_estimates()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  update public.meal_items
     set estimate_status = 'pending', estimate_attempts = 4, estimate_next_at = now()
   where estimate_status = 'failed' and kind in ('plan', 'other')
     and created_at > now() - interval '7 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.resend_meal_estimates() from public, anon, authenticated;
revoke all on function public.retry_failed_meal_estimates() from public, anon, authenticated;

-- cron.schedule with a job name replaces that job, so this is safe to re-run.
create extension if not exists pg_cron;
select cron.schedule('meal-estimates-resend', '*/2 * * * *', 'select public.resend_meal_estimates()');
select cron.schedule('meal-estimates-daily-retry', '0 11 * * *', 'select public.retry_failed_meal_estimates()');

-- 7) The client's AI quota, for the server ---------------------------------------------
-- take_ai_quota() and refund_ai_quota() act for auth.uid(), the caller. The
-- server estimates a meal for a client, so these take the client. Same table,
-- limits and lock key: ai-complete and estimate-meal share one allowance of
-- 30 per hour and 100 per day, and wait for each other.
create or replace function public.take_ai_quota_for(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last_hour int;
  v_last_day  int;
begin
  if p_user_id is null then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('ai_quota:' || p_user_id::text));

  delete from public.ai_requests
   where user_id = p_user_id and created_at < now() - interval '1 day';

  select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into v_last_hour, v_last_day
    from public.ai_requests
   where user_id = p_user_id;

  if v_last_hour >= 30 or v_last_day >= 100 then
    return false;
  end if;

  insert into public.ai_requests (user_id) values (p_user_id);
  return true;
end;
$$;

create or replace function public.refund_ai_quota_for(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if p_user_id is null then
    return false;
  end if;

  select id into v_id
    from public.ai_requests
   where user_id = p_user_id
     and created_at > now() - interval '10 minutes'
   order by created_at desc, id desc
   limit 1;

  if v_id is null then
    return false;
  end if;

  delete from public.ai_requests where id = v_id;
  return true;
end;
$$;

-- ai-complete calls take_ai_quota() with the caller's JWT, so it keeps its
-- grant to authenticated; it now shares the code above.
create or replace function public.take_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.take_ai_quota_for(auth.uid());
end;
$$;

-- A client could call refund_ai_quota() after each request and never run
-- out; ai-complete now refunds through refund_ai_quota_for() instead.
revoke all on function public.refund_ai_quota() from public, anon, authenticated;
revoke all on function public.take_ai_quota_for(uuid) from public, anon, authenticated;
revoke all on function public.refund_ai_quota_for(uuid) from public, anon, authenticated;
grant execute on function public.take_ai_quota_for(uuid) to service_role;
grant execute on function public.refund_ai_quota_for(uuid) to service_role;

-- 8) Realtime: the app hears its estimates land (RLS applies: own rows) ------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'meal_items'
  ) then
    alter publication supabase_realtime add table public.meal_items;
  end if;
end $$;

-- 9) PostgREST: pick up the new columns and functions (sent on commit) -------------------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select tgname from pg_trigger
--    where tgrelid = 'public.meal_items'::regclass and tgname like 'trg_meal_items_%';      -- 4 rows
--   select jobname, schedule from cron.job
--    where jobname in ('meal-estimates-resend', 'meal-estimates-daily-retry');               -- 2 rows
--   select proname from pg_proc
--    where proname in ('meal_estimate_configured', 'meal_items_drop_missing_links',
--                      'meal_items_estimate_state', 'send_meal_estimate', 'meal_items_send_estimate',
--                      'finish_meal_estimate', 'fail_meal_estimate', 'defer_meal_estimate',
--                      'resend_meal_estimates', 'retry_failed_meal_estimates',
--                      'take_ai_quota_for', 'refund_ai_quota_for', 'take_ai_quota')
--      and prosrc like '%' || chr(65533) || '%';                                              -- 0 rows
--   select public.meal_estimate_configured();                                                 -- true once Vault is set
--   select id, status_code, content from net._http_response order by id desc limit 5;
--   select status, return_message from cron.job_run_details order by start_time desc limit 5;
--   Then run supabase/scripts/smoke_meal_registrations.sql (expects «SMOKE OK»).
