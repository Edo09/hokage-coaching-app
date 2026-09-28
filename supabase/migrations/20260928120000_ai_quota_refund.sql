-- ==========================================================================
-- AI quota: give a request back when the model call fails.
--
-- take_ai_quota() (20260926140000) records a request BEFORE ai-complete calls
-- the model, so concurrent calls can't overshoot the limit. Without a refund,
-- a provider outage or a missing key still burned the user's allowance (the
-- app's photo→name fallback and the insight retry doubled it), locking users
-- out for up to a day after the outage was fixed. ai-complete now calls
-- refund_ai_quota() whenever the model call fails.
--
-- Removes the caller's newest request from the last 10 minutes — the one this
-- call just took (a concurrent call's row is interchangeable: only the count
-- matters). Returns whether a row was removed.
--
-- Requires 20260926140000_ai_request_quota.sql. Idempotent. Run in the
-- Supabase SQL editor.
-- ==========================================================================

begin;

create or replace function public.refund_ai_quota()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id  bigint;
begin
  if v_uid is null then
    return false;
  end if;

  select id into v_id
    from public.ai_requests
   where user_id = v_uid
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

revoke all     on function public.refund_ai_quota() from public, anon;
grant  execute on function public.refund_ai_quota() to authenticated;

commit;

-- Verify:
--   select proname from pg_proc where proname in ('take_ai_quota', 'refund_ai_quota');  -- 2 rows
