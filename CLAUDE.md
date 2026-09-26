# Hokage Coaching App

## Product context

Hokage is a **private, white-label app sold to one specific coach (the buyer)**.
The coach owns the brand; the app is customized for them. It is not a general
product and never shows another brand.

It has a sibling product, **Zyron** (repo `Edo09/zenfit`), which is a general
fitness app under the Zyron brand only, with an admin web panel where many
coaches manage their users. The two share history and much of the code, but
they are separate products:

|                | Hokage (this repo)                         | Zyron (`zenfit`)                     |
|----------------|--------------------------------------------|--------------------------------------|
| Owner / brand  | The buying coach's brand (white-label)     | Zyron brand only                     |
| Coaches        | One coach per deployment                   | Many coaches                         |
| Accounts       | Created by the coach (`create-client`)     | Users sign up themselves             |
| Supabase       | Own project `rzgwkwxskrovxnnymxqo`         | Own, separate project                |

What this means when working here:

- Do not add Zyron branding, Zyron-only features (routine templates for many
  coaches, self-serve sign-up, `profiles.app` scoping) or multi-coach logic.
- Branding (name, icon, splash, colors, store identifiers, copy) belongs to the
  coach: keep it easy to change in one place rather than hard-coded.
- Leftover names from earlier projects ("habbito", "zenfit") are not the brand.

## Infrastructure

- Mobile app (Expo) and the coach web panel (`hokage-web-panel`, Vite SPA) both
  talk to Supabase project `rzgwkwxskrovxnnymxqo` with the anon key; RLS is the
  security boundary and the coach is the profile with `role = 'coach'`
  (`is_coach()`). See `docs/ADMIN_WEB_DB_CONNECTION.md`.
- App env: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` (EAS). Panel env:
  `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- Auth sign-ups are OFF; client accounts are created only by the
  `create-client` Edge Function (`Hkg-` temp passwords).
- Schema source of truth: `supabase/migrations`. Migrations here do not reach
  Zyron's database (and vice versa).
- `supabase/scripts/convert_shared_db_to_hokage_only.sql` was a one-off, already
  applied (Sept 2026) when Zyron moved to its own project. Do not run it again
  as part of a rebuild.
