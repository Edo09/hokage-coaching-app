-- ==========================================================================
-- Solo app coexistence on the SHARED database.
--
-- The users-only ("solo") app is a separate codebase but points at THIS same
-- Supabase project. Both apps' users live in one `profiles` table, so a solo
-- self-serve signup would otherwise appear in the coach's client list (which
-- lists every profile with role = 'user'). This flag separates them:
--   'coached' — created / managed by the coach via the Admin Web Panel
--   'solo'    — self-registered in the users-only app
--
-- The coach panel lists only 'coached'. The solo app self-tags its own profile
-- 'solo' right after signup (RLS self-update). Adding the NOT NULL column with a
-- default backfills every existing row to 'coached' in one shot — no data step.
--
-- Additive, idempotent. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

alter table public.profiles
  add column if not exists account_type text not null default 'coached'
    check (account_type in ('coached', 'solo'));

comment on column public.profiles.account_type is
  'coached = coach-managed (admin panel); solo = self-serve users-only app. Panel lists only coached; solo app self-tags after signup.';

commit;
