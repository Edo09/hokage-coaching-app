# The Hokage Coaching App

Private, coach-branded mobile app (iOS + Android, Expo) for the clients of one
coach. The coach runs everything from the companion web panel
([`hokage-web-panel`](https://github.com/Edo09/hokage-web-panel)); clients see
their program, nutrition and supplement plans, log sets and meals, and follow
their progress here. UI in Spanish (English available).

See `CLAUDE.md` for the product context (white-label, single coach) and
`docs/ADMIN_WEB_DB_CONNECTION.md` for the data/security model.

## Stack

Expo (expo-router, dev client) · React Native · NativeWind / gluestack-ui ·
TanStack Query (persisted, with an offline outbox) · Supabase (Postgres + RLS,
Auth, Storage, Edge Functions) · i18next.

## Run it

```bash
npm install
cp .env.example .env   # fill in the values
npm start              # Metro for the dev client (npm run android / ios to build one)
```

There is no sign-up: sign in with an account created by the coach in the panel.
iPhone testing without a paid Apple account: `docs/IOS-LOCAL-TESTING.md`.

## Backend

- **Supabase project** `rzgwkwxskrovxnnymxqo` (shared with the web panel).
- **Schema:** `supabase/migrations` is the source of truth, applied in order in
  the SQL editor. `supabase/scripts` holds one-off scripts that are not part of a rebuild.
- **Edge Functions** (`supabase/functions`): `create-client`,
  `reset-client-password` and `generate-program` (AI program drafts), called by
  the panel. Deploy and configure them as in `docs/ADMIN_WEB_DB_CONNECTION.md`
  §6.1 and §6.3 (they need the `ALLOWED_ORIGINS` secret; `generate-program` also
  needs `GEMINI_API_KEY` and/or `GROQ_API_KEY`).
- **App AI** (meal estimates from a name or photo, the weekly progress insight)
  goes through the `ai-complete` Edge Function, which holds the same
  `GEMINI_API_KEY` / `GROQ_API_KEY` secrets and caps each user at 30 requests/hour
  and 100/day (failed model calls are refunded). The app has no model keys.
  Apply migrations `20260926140000_ai_request_quota.sql` and
  `20260928120000_ai_quota_refund.sql`, then deploy it as in
  `docs/ADMIN_WEB_DB_CONNECTION.md` §6.4.
- **Auth:** "Allow new users to sign up" stays **off**.

## Builds & stores

EAS profiles are in `eas.json` (`development`, `preview`, `production`). Set the
`.env.example` variables in the EAS environments before building.

```bash
eas build --profile production --platform all
eas submit --platform ios   # / android
```

Store identifiers are in `app.json` (`ios.bundleIdentifier`, `android.package`).
The Expo `slug` is still the legacy `habbito`: it is tied to the linked EAS
project (`extra.eas.projectId`), so rename it only together with that project,
e.g. when moving the app to the coach's own Expo account.

Store listings need the privacy policy URL (`EXPO_PUBLIC_PRIVACY_POLICY_URL`,
served by the panel at `/privacidad.html`).
