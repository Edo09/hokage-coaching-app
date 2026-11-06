# Push notifications

The client's phones get a push when the coach assigns or changes something,
and before a block ends. Tapping one opens the tab where it is:

| When                                        | Push                                            | Opens     |
|---------------------------------------------|-------------------------------------------------|-----------|
| A program is assigned                       | **«Tienes un nuevo programa»**                  | Programa  |
| A nutrition plan is assigned                | **«Tienes un nuevo plan de nutrición»**         | Nutrición |
| A supplement plan is assigned               | **«Tienes un nuevo plan de suplementos»**       | Nutrición |
| The coach edits the active program          | **«Tu coach actualizó tu programa»**            | Programa  |
| The coach edits the active nutrition plan   | **«Tu coach actualizó tu plan de nutrición»**   | Nutrición |
| The coach edits the active supplement plan  | **«Tu coach actualizó tu plan de suplementos»** | Nutrición |
| 3 days before a block's last day            | **«Tu bloque termina el viernes»**              | Programa  |

The bodies: «*name* ya está en tu pestaña Programa / Nutrición.» (assigned),
«*name* tiene cambios. Míralos en tu pestaña Programa / Nutrición.» (edited),
«*name* termina el viernes 13. Aprovecha estos días para completar lo que te
falte.» (block ending).

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
- **Edits** (`20261106140000_plan_update_and_block_end_pushes.sql`):
  `trg_notify_program_updated`, `trg_notify_nutrition_plan_updated` and
  `trg_notify_supplement_plan_updated` fire when the coach writes a plan
  that is active before and after; the panel's save functions rewrite the
  plan's row on every save. At most one push per plan every 30 minutes
  (`plan_update_pushes` keeps the last), and none in the 30 minutes after
  its «Tienes un nuevo …». Nothing for an activation (the «nuevo» push says
  it), an archive, the template claim of «Guardar como plantilla», a write
  that changes nothing, or one with no coach signed in (a script, a
  migration, a cron job).
- **Block ending** (same migration): the `pg_cron` job
  `client-block-ending-push` runs `send_block_ending_pushes()` daily at
  13:00 UTC, 09:00 for the coach (`coach_local_date()`). It announces the
  active programs of 2 weeks or more whose last day is 3 days away; a day
  the job missed is made up until the eve. `program_ending_pushes` keeps it
  to once per block and end date, so a block the coach moves or extends is
  announced again before its new end.
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

*Not done yet* (left for later in Oct 2026): until it is, iPhones get no
push, and the app carries on without one.

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
4. Edit that client's active program in the panel and save: «Tu coach
   actualizó tu programa» (a second save within 30 minutes sends nothing).
   `select * from public.plan_update_pushes order by sent_at desc limit 5;`
5. The block pass, now instead of at 09:00:
   `select public.send_block_ending_pushes();` then
   `select * from public.program_ending_pushes order by created_at desc limit 5;`

`supabase/scripts/smoke_plan_pushes.sql` checks the edit and block rules in
one rolled-back run (it ends with «SMOKE OK: plan pushes; nothing was saved»).

## On the phone, without a push

The app's own alerts, for comparison. Sounds and the rest's vibrations follow
the client's choice in Ajustes (sonido y vibración, solo vibración, solo
sonido); the haptics that belong to a screen (a record's and a finished
day's success haptic, the superset taps) always play. Which sound plays at
each moment is the coach's pick in the panel (Configuración → «Sonidos de la
app», `app_sound_settings`); «Rest over» is also the notification's sound,
on an Android channel per sound set (`src/utils/sound-sets.ts`).

| When                                         | What                                                 | Where in the code                     |
|----------------------------------------------|------------------------------------------------------|---------------------------------------|
| A rest starts                                | Short buzz and/or cue                                | `src/lib/rest-alert.ts`               |
| 10 seconds of rest left (app open)           | Two light taps and/or a soft ping                    | `src/providers/rest-timer-provider.tsx` |
| A rest ends                                  | Buzz and/or chime; a notification if the app is away | `src/lib/rest-alert.ts`               |
| A logged set beats the client's best         | Success haptic and a short fanfare                   | `src/components/program/exercise-session-host.tsx` |
| A day is completed                           | Success haptic and a celebration chord               | `src/components/program/day-complete-modal.tsx` |
| «Superserie: sin descanso» on the card       | Two light taps                                       | `src/components/program/check-card.tsx` |
| An exercise clock has run 30 minutes         | Notification «¿Sigues con …?» (pause/finish cancels) | `src/lib/clock-reminder.ts`           |
| Training day, inactivity, week opened        | Local reminders                                      | `src/lib/reminders.ts`                |
