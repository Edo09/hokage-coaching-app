-- ==========================================================================
-- Per-user quota for the ai-complete Edge Function (the app's AI: meal
-- estimates from a name or a photo, the weekly progress insight).
--
-- The model keys live only in the function, but any signed-in client can
-- still call it; this caps what one account can spend. One row = one
-- accepted request. The function calls take_ai_quota() with the caller's
-- JWT before every model call and answers 429 when it returns false.
--
-- ai_requests has RLS on and no policies: clients cannot read, forge or
-- delete rows. Only take_ai_quota() (security definer) touches it, always
-- for auth.uid(), and it prunes that user's rows older than a day. A client
-- calling it directly only uses up their own quota.
--
-- Limits: 30 requests per hour, 100 per day, per user. To change them,
-- replace the function with new constants.
--
-- Additive, idempotent. Run in the Supabase SQL editor before deploying
-- ai-complete (the function refuses every request until this exists).
-- ==========================================================================

begin;

create table if not exists public.ai_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists idx_ai_requests_user_created
  on public.ai_requests(user_id, created_at);

alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from anon, authenticated;

create or replace function public.take_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_last_hour int;
  v_last_day  int;
begin
  if v_uid is null then
    return false;
  end if;

  -- One user's concurrent calls take turns, so a burst can't overshoot.
  perform pg_advisory_xact_lock(hashtext('ai_quota:' || v_uid::text));

  delete from public.ai_requests
   where user_id = v_uid and created_at < now() - interval '1 day';

  select count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into v_last_hour, v_last_day
    from public.ai_requests
   where user_id = v_uid;

  if v_last_hour >= 30 or v_last_day >= 100 then
    return false;
  end if;

  insert into public.ai_requests (user_id) values (v_uid);
  return true;
end;
$$;

revoke all     on function public.take_ai_quota() from public, anon;
grant  execute on function public.take_ai_quota() to authenticated;

commit;
