-- ==========================================================================
-- estimate-meal may read the registration it estimates.
--
-- The function reads the meal_items row with the service role
-- (supabase/functions/estimate-meal/estimate.ts). meal_items predates these
-- migrations and was only ever granted to the client roles, so that read
-- failed with «42501: permission denied for table meal_items» (seen in
-- meal_estimate_errors on 2026-11-06) and no estimate could land. Its writes
-- go through the security definer functions of
-- 20261105120000_meal_registrations.sql, so reading is all it needs.
--
-- Idempotent. Run with psql or in the SQL editor.
-- ==========================================================================

grant select on table public.meal_items to service_role;

-- Verify:
--   select has_table_privilege('service_role', 'public.meal_items', 'select');  -- t
--   Then run supabase/scripts/smoke_meal_registrations.sql (expects «SMOKE OK»).
