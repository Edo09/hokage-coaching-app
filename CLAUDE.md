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
  `create-client` Edge Function, and forgotten passwords are reset only by
  `reset-client-password` (both hand out `Hkg-` temp passwords; no email is
  sent). Both only answer browser origins listed in the `ALLOWED_ORIGINS`
  function secret.
- Push notifications: database triggers on `programs`, `nutrition_plans` and
  `supplement_plans` send «Tienes un nuevo programa / plan de nutrición /
  plan de suplementos» when one is assigned, and «Tu coach actualizó tu …»
  when the coach edits an active one (at most one per plan every 30 min); a
  daily `pg_cron` job (`send_block_ending_pushes`) sends «Tu bloque termina
  el …» 3 days before a block's last day. All go through `pg_net` to Expo's
  push API for the tokens in `push_tokens` (no Edge Function). See
  `docs/PUSH-NOTIFICATIONS.md`.
- Coach notices (the bell in the panel): the database writes rows in
  `coach_notifications`: a trigger when a client completes a training day,
  and a daily `pg_cron` job (`create_coach_daily_notices`) for clients idle
  for 4/7 days and blocks ending or ended. The panel reads them over Realtime.
  The coach's time zone is in `coach_local_date()`. See
  `supabase/migrations/20261024130000_coach_notifications.sql`.
- Workout sounds: in the panel's Ajustes («Sonidos de la app») the coach
  picks, per moment (rest start, 10 s left, rest over, new record, day
  complete), a sound set built into the app or an upload of their own. The
  choice is the one row of `app_sound_settings`; uploads are converted in the
  browser to the app's WAV and live in the public `app-sounds` bucket
  (`custom/<moment>-<time>.wav`). The app reads the row on open, downloads the
  uploads, and keeps both offline. Built-in sets are in `assets/sounds`
  (`src/utils/sound-sets.ts`) and the panel's `public/sounds`: a new one takes
  a new build. The «rest over» notification can only use built-in sounds, so
  with an upload it plays the classic one (the upload plays in the app).
- Meal estimates: triggers on `meal_items` post new or changed registrations
  through `pg_net` to the `estimate-meal` Edge Function (deployed with
  `--no-verify-jwt`; it checks `ESTIMATE_MEAL_SECRET`, which Vault also holds
  as `estimate_meal_secret`, with the URL as `estimate_meal_url`). `pg_cron`
  re-sends lost calls and retries failures, and each failure's reason goes to
  `meal_estimate_errors` (server-only: read it with SQL). See
  `docs/ADMIN_WEB_DB_CONNECTION.md` §6.6.
- Schema source of truth: `supabase/migrations`. Migrations here do not reach
  Zyron's database (and vice versa).
- `supabase/scripts/convert_shared_db_to_hokage_only.sql` was a one-off, already
  applied (Sept 2026) when Zyron moved to its own project. Do not run it again
  as part of a rebuild.

## Git workflow

- Work directly on the default branch (`main`); never create or switch branches.
- Commit and push finished changes to `origin/main`. Do not open PRs unless asked.
- `CLAUDE.md` and `AGENTS.md` hold the same instructions (Claude Code reads one,
  other agents the other): change both in the same commit.
