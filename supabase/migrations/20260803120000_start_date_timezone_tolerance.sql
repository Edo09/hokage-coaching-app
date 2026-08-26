-- ==========================================================================
-- Fix: creating a program failed every evening.
--
-- The panel builds the default start_date from the BROWSER's local date, but
-- guard_program_start_date compares it against `current_date`, which on
-- Supabase is UTC. West of UTC (the coach is at UTC-4) the browser is still on
-- "today" while Postgres has already rolled over to tomorrow — so from ~20:00
-- local onwards a brand-new program was rejected with
-- "program start_date cannot be in the past", while the identical action
-- succeeded in the morning.
--
-- The guard exists to stop a coach BACK-DATING a block, not to police
-- timezones, so give it a one-day tolerance. That absorbs every UTC offset
-- (max ±14h) while still rejecting a genuinely back-dated start.
--
-- Idempotent (create or replace). Run in the Supabase SQL editor.
-- ==========================================================================

begin;

create or replace function public.guard_program_start_date()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Templates carry a placeholder start_date; only real assignments are held
  -- to "cannot start in the past".
  if new.is_template then
    return new;
  end if;

  if new.start_date < current_date - 1
     and (tg_op = 'INSERT' or new.start_date is distinct from old.start_date)
     and auth.uid() is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'program start_date cannot be in the past';
  end if;
  return new;
end;
$$;

commit;

-- Confirm the timezone gap this fixes:
--   select current_setting('TimeZone') as db_tz, current_date, now();
