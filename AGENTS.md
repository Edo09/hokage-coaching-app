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
| Accounts       | Created by the coach or client sign-up     | Users sign up themselves             |
| Supabase       | Own project `rzgwkwxskrovxnnymxqo`         | Own, separate project                |

What this means when working here:

- Do not add Zyron branding, Zyron-only features (routine templates for many
  coaches, `profiles.app` scoping) or multi-coach logic.
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
- Clients can register themselves in the app (email/password). On 2026-11-07
  the hosted Supabase Auth setting “Allow new users to sign up” was switched
  on, and “Confirm email” is off, so a new account signs in at once, unverified.
  `handle_new_user` creates its profile (name from the form) with
  `role = 'user'` and `account_type = 'coached'`, so the new client shows up in
  the panel's client list. The coach may also create clients through the
  `create-client` Edge Function. Forgotten passwords are reset by
  `reset-client-password` (it hands out an `Hkg-` temporary password; no email
  is sent). Both functions only answer browser origins listed in the
  `ALLOWED_ORIGINS` function secret.
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
- Premium subscriptions (RevenueCat): clients pay in the app for the right to
  ask the coach for a program or nutrition plan and to use what is assigned.
  Applied 2026-11-23, **dark**: the one switch `premium_settings.enforced` is
  `false`, so nobody is locked and nothing changed for any user; going live is
  `update public.premium_settings set enforced = true` (checklist in
  `docs/ADMIN_WEB_DB_CONNECTION.md` §6.7). One rule in SQL
  (`premium_source_for` / `has_premium_access()`): the coach role, an active
  store subscription (`subscriptions`, written only by the `revenuecat-webhook`
  and `sync-subscription` Edge Functions, which re-read the customer from
  RevenueCat's REST API and never trust the payload) or an active coach-set
  `memberships` row. With the switch on, a client without access cannot read the
  coach's content or log against it (restrictive RLS, after a 72-hour grace),
  cannot ask for a program or plan (`request_content`, rows in
  `content_requests`, bell kind `content_requested`), and the daily coach
  notices and block-ending pushes skip them. The function secrets
  `REVENUECAT_WEBHOOK_SECRET` and `REVENUECAT_API_KEY` are not set yet (no
  RevenueCat project). The app part is built (2026-11-23: `usePremiumAccess`
  over `get_my_access()`, the `/paywall` route, the request sheet, the empty,
  pending and locked states of the training and nutrition tabs and Home, a
  Settings card, reminders that follow access; `react-native-purchases` behind
  `src/lib/purchases.ts`, native only), but **no purchase has run on a device**:
  it needs a development build and the RevenueCat project, with
  `EXPO_PUBLIC_REVENUECAT_IOS_KEY` / `_ANDROID_KEY` per EAS environment (a Test
  Store `test_…` key only in `development`). A subscription that is active and
  set to renew is not locked at its period end (the app counts it for 72 h more
  and, if the renewal has not arrived five minutes after the end, asks
  `sync-subscription`); while the switch is off a client without a program or
  plan can still ask for one (`requestsEnabledWhileOpen: true` in
  `use-content-gate.ts`: release builds hid the button until the panel part
  below existed, so deploy the panel before that app build). The panel part is
  built (2026-11-24,
  `hokage-web-panel`: requests in the Dashboard, the bell and the client page,
  «Solicitud» and «Sin acceso» in the lists, the store subscription beside the
  membership, «Dar acceso ahora»; no server change, and while the switch is off
  it looks and counts as before: `docs/ADMIN_WEB_DB_CONNECTION.md` §6.7).
  Design: `docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md`.
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
