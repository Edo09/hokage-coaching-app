-- ==========================================================================
-- reset-client-password may read the profile it resets.
--
-- Before it changes a password, the function reads the target's role with the
-- service role (supabase/functions/reset-client-password/index.ts), so a
-- coach account can never be reset. profiles predates these migrations and
-- was only ever granted to the client roles (supabase-schema.sql), so that
-- read failed with «42501: permission denied for table profiles» and the
-- panel's «Restablecer contraseña» failed every time (seen 2026-11-07). Same
-- gap as meal_items (20261106130000_meal_items_service_role_read.sql).
-- Reading is all it needs: the password itself changes through the Auth admin
-- API, not this table.
--
-- create-client's display_name update after createUser also runs as the
-- service role and still fails silently without an UPDATE grant. It is
-- redundant (handle_new_user already sets display_name from the same
-- metadata), so it is not granted here.
--
-- Idempotent. Run with psql or in the SQL editor.
-- ==========================================================================

grant select on table public.profiles to service_role;

-- Verify:
--   select has_table_privilege('service_role', 'public.profiles', 'select');  -- t
