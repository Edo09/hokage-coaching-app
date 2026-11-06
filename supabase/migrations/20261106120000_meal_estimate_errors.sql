-- ==========================================================================
-- Why meal estimates fail, where a query can read it.
--
-- estimate-meal (20261105120000_meal_registrations.sql) logged a failure only
-- in the Edge Function's logs, which only the dashboard shows. It now also
-- records each one here, through log_meal_estimate_error(), so
--
--   select created_at, meal_item_id, attempt, error
--     from public.meal_estimate_errors order by id desc limit 20;
--
-- says why an estimate failed, and why a row shows «Sin estimar». Only the
-- function writes it (service role); the app and the panel never read it.
-- Reasons older than 30 days go as new ones arrive.
--
-- Additive and idempotent. Run with psql or in the SQL editor. Until it
-- exists, estimate-meal logs a warning and goes on as before.
-- ==========================================================================

begin;

create table if not exists public.meal_estimate_errors (
  id           bigint generated always as identity primary key,
  meal_item_id uuid not null,  -- no foreign key: the reason outlives an undo
  user_id      uuid,
  version      bigint,         -- the estimate version the failed call was for
  attempt      smallint,       -- the row's attempt count when it failed
  error        text not null,
  created_at   timestamptz not null default now()
);

-- Server-only: row level security with no policies, and no client grants.
alter table public.meal_estimate_errors enable row level security;
revoke all on table public.meal_estimate_errors from public, anon, authenticated;

create index if not exists idx_meal_estimate_errors_created
  on public.meal_estimate_errors(created_at);
create index if not exists idx_meal_estimate_errors_item
  on public.meal_estimate_errors(meal_item_id);

-- One failure, with the row's owner and attempt as they are now (the row may
-- be gone already). The text is cut to 1000 characters and is never empty.
create or replace function public.log_meal_estimate_error(p_id uuid, p_version bigint, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user    uuid;
  v_attempt smallint;
begin
  select user_id, estimate_attempts into v_user, v_attempt
    from public.meal_items where id = p_id;
  insert into public.meal_estimate_errors (meal_item_id, user_id, version, attempt, error)
  values (p_id, v_user, p_version, v_attempt, left(coalesce(nullif(btrim(p_error), ''), 'unknown'), 1000));
  delete from public.meal_estimate_errors where created_at < now() - interval '30 days';
end;
$$;

revoke all on function public.log_meal_estimate_error(uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.log_meal_estimate_error(uuid, bigint, text) to service_role;

-- PostgREST: pick up the new function (sent on commit).
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select relrowsecurity from pg_class where oid = 'public.meal_estimate_errors'::regclass;  -- t
--   select has_function_privilege('service_role', 'public.log_meal_estimate_error(uuid,bigint,text)', 'execute'),
--          has_function_privilege('authenticated', 'public.log_meal_estimate_error(uuid,bigint,text)', 'execute'),
--          has_table_privilege('authenticated', 'public.meal_estimate_errors', 'select');           -- t, f, f
--   Then run supabase/scripts/smoke_meal_registrations.sql (expects «SMOKE OK»).
