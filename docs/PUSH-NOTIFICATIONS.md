# Push notifications

When the coach assigns something, the client's phones get a push with its
name, and tapping it opens the tab where it is:

| Assigned            | Push                                     | Opens     |
|---------------------|------------------------------------------|-----------|
| Program             | **«Tienes un nuevo programa»**           | Programa  |
| Nutrition plan      | **«Tienes un nuevo plan de nutrición»**  | Nutrición |
| Supplement plan     | **«Tienes un nuevo plan de suplementos»**| Nutrición |

The body is «*name* ya está en tu pestaña Programa / Nutrición.»

## How it works

- **Database**: one trigger per table, `trg_notify_program_assigned` on
  `programs` (`supabase/migrations/20261023150000_program_assigned_push.sql`),
  `trg_notify_nutrition_plan_assigned` on `nutrition_plans` and
  `trg_notify_supplement_plan_assigned` on `supplement_plans`
  (`20261024120000_plan_assigned_push.sql`). Each fires when a client's
  program or plan becomes active: saved new from the panel, a template
  assigned, or an older one switched back on. `send_client_push` sends one
  request to Expo's push API through `pg_net`, to every token in
  `push_tokens` for that client. `program_assignment_pushes`,
  `nutrition_plan_assignment_pushes` and `supplement_plan_assignment_pushes`
  remember what was handled, so edits and re-activations never notify again.
  A client with no phone registered is recorded and nothing is sent. A push
  that fails never blocks the save.
- **App**: `usePushToken` (`src/hooks/use-push-token.ts`) registers the
  phone's Expo push token through `register_push_token` once notifications
  are allowed, and sign-out deletes it (`src/lib/push.ts`). The foreground
  handler and the tap that opens the tab (`data.url`) are the reminders' own
  (`src/lib/rest-alert.ts`, `src/hooks/use-reminder-taps.ts`); the kinds are
  in `src/utils/push.ts`. Android channel: «Tu coach».

The texts are Spanish and live in the trigger functions.

## Setup only the account owner can do

Pushes need a development or store build (EAS). Expo Go can't receive them.

**Android (FCM V1)**

1. *Done.* The Firebase project `hokage-4eed7` has the Android app
   `com.edo09.hokagecoaching`. Its `google-services.json` is not in git: EAS
   builds get it from the `GOOGLE_SERVICES_JSON` file variable (set in the
   development, preview and production environments), which `app.config.js`
   hands to `expo.android.googleServicesFile`. For a local prebuild, keep the
   downloaded file at the repo root (git-ignored). To replace it:
   `eas env:set --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility sensitive --environment development --environment preview --environment production`.
2. *Done.* A key for
   `firebase-adminsdk-fbsvc@hokage-4eed7.iam.gserviceaccount.com` (Firebase →
   Project settings → Service accounts → Generate new private key) is on EAS:
   expo.dev → project `habbito` → Project settings → Credentials → Android →
   `com.edo09.hokagecoaching` → FCM V1 service account key (or
   `eas credentials` → Android → Google Service Account → FCM V1). Never
   commit it: it is a real secret, unlike `google-services.json`.
   The project's Google Cloud organization blocks key creation
   (`iam.managed.disableServiceAccountKeyCreation`). To make a key: Cloud
   console → IAM → Organization policies, on project `hokage-4eed7`, set that
   policy to not enforced (override the parent), generate the key, then set
   it back to inherit. Keys already made keep working.
3. *Done.* Verified in Oct 2026: the preview build from `fb9fd33` showed
   «Tienes un nuevo programa» on an Android phone. Android builds older than
   that have no Firebase config and never get a token.

Without step 1, Android can't get a push token: the app carries on without
one. Without step 2, the token exists but Expo can't deliver to it.

**iOS (APNs)**

1. `eas credentials` → iOS → Push Notifications: let EAS create a push key
   (needs the Apple Developer account).
2. Build again (`eas build -p ios`).

Keep Expo's "Enhanced Security for Push Notifications" off (expo.dev →
project settings): the trigger sends without an Expo access token.

## Checking it

1. Install the build, sign in as a client, allow notifications.
   `select user_id, platform, updated_at from public.push_tokens;` shows the
   phone.
2. Assign that client a program in the panel. The phone shows the push.
3. What was sent and what Expo answered:

   ```sql
   select * from public.program_assignment_pushes order by created_at desc limit 5;
   -- nutrition_plan_assignment_pushes / supplement_plan_assignment_pushes for plans
   select id, status_code, content from net._http_response order by id desc limit 5;
   ```

   `{"status":"ok"}` per phone is a delivered ticket. `DeviceNotRegistered`
   means the token is stale (the app was uninstalled). pg_net keeps responses
   for 6 hours.
