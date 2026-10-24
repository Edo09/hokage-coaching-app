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

1. In the [Firebase console](https://console.firebase.google.com), create a
   project (or use one) and add an Android app with package
   `com.edo09.hokagecoaching`. Download `google-services.json` to the repo
   root and add `"googleServicesFile": "./google-services.json"` under
   `expo.android` in `app.json`.
2. Firebase → Project settings → Service accounts → Generate new private
   key. Upload that JSON to EAS: `eas credentials` → Android → Google Service
   Account → FCM V1 (or expo.dev → the project → Credentials).
3. Build again (`eas build -p android --profile development`).

Until step 1 is done, Android can't get a push token: the app carries on
without one.

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
