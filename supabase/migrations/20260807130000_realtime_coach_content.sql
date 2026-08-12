-- ==========================================================================
-- Realtime for coach-assigned content.
--
-- The problem: a coach edits a program in the admin panel and the client's app
-- keeps showing the old one until they pull to refresh or leave and re-enter
-- the tab. On web there is no pull-to-refresh at all, so it looks stuck.
--
-- This puts the parent rows on the `supabase_realtime` publication so the app
-- can subscribe and invalidate its cache the moment the coach saves.
--
-- WHY ONLY THE PARENTS: every write path touches the parent row.
-- save_coach_program / save_nutrition_plan / save_supplement_plan all set
-- `updated_at = now()` on update, and assign/status/delete change it by
-- definition. Publishing the child tables too (program_exercises,
-- nutrition_plan_option_items, …) would multiply WAL traffic and fire a burst
-- of events for a single save, since those are rewritten row-by-row.
--
-- REPLICA IDENTITY FULL is required for DELETE: without it Postgres only ships
-- the primary key in the old-row image, so a subscription filtered on
-- `user_id=eq.<me>` can never match a delete and the client would keep showing
-- a program that no longer exists. These tables are written a handful of times
-- a week, so the extra WAL is irrelevant here.
--
-- RLS still applies to realtime — a client only ever receives rows their
-- existing "client reads own …" policies already let them SELECT.
--
-- Additive, idempotent, drift-safe. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

-- 1) Full old-row images so DELETE events carry user_id for filtering.
alter table public.programs          replica identity full;
alter table public.nutrition_plans   replica identity full;
alter table public.supplement_plans  replica identity full;

-- 2) Add to the realtime publication, skipping any that are already on it
--    (`alter publication … add table` errors on duplicates, so guard each).
do $$
declare
  t text;
begin
  foreach t in array array['programs', 'nutrition_plans', 'supplement_plans']
  loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
      -- RAISE takes a single % per argument (unlike format's %I/%s).
      raise notice 'added % to supabase_realtime', t;
    end if;
  end loop;
end $$;

commit;

-- Verify — expect three rows:
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and schemaname = 'public'
--      and tablename in ('programs','nutrition_plans','supplement_plans')
--    order by tablename;
