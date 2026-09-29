# Local reminders: push notifications, piece 1

Date: 2026-09-29 · Status: design approved, spec awaiting review ·
Repo: `hokage-coaching-app` (app only; no server, database or panel change)

## Context

The coach requires push notifications (`docs/PRD_Plataforma_Fitness.md`:
«Recepción de recordatorios y notificaciones push»). The work is split in
three pieces, each with its own spec:

1. **Local reminders** (this spec). The phone schedules them from data it
   already has. No server, no Apple/Firebase/Expo push credentials.
2. Remote push foundation and notifications sent from the panel (new
   program, new plan, membership renewed, message from the coach).
3. A daily server job for membership reminders.

Setting up the store and push accounts under the coach's ownership runs in
parallel and does not block this piece.

Today the only notification is the rest-timer alert (`src/lib/rest-alert.ts`),
a local notification scheduled when a rest starts. Its global foreground
handler hides every notification while the app is open, and permission is
first requested mid-workout, when the first rest starts.

This piece depends on the "Solo semana actual" plan
(`docs/superpowers/specs/2026-09-29-solo-semana-actual-design.md`): it uses
its `weekLock` / `weekOpensOn` helpers and its `node:test` harness
(`npm test`). Build it after that plan.

## Decisions (from the product owner)

1. **Three reminders**, all local:
   - **Training day**: on the client's profile training days, at the
     reminder hour. **On** by default.
   - **Inactivity**: 4 and 7 days after the last training. **Off** by
     default.
   - **Week opened**: «Tu semana 3 ya está disponible», only for "Solo
     semana actual" programs. **Off** by default.
2. **Training days** are the client's profile days (`profiles.available_days`,
   values `Mon`…`Sun`). The client picks them in onboarding and the coach can
   edit them in the panel. Program-day weekdays are not used.
3. **Permission** is asked at the **end of onboarding**, with a short
   explanation first. If the client declines, **Ajustes → Notificaciones**
   offers a button to turn notifications on.
4. **Reminder hour**: one hour for all reminders, default **8:00**,
   changeable in Ajustes.
5. **Scheduling**: one notification per date for the next 14 days, rebuilt
   whenever something relevant changes. There are no repeating triggers and
   no background jobs.

## Reminder rules

All rules use the phone's local date and the active program (`useProgram`).
"Logged training" means a completion row or a set log with weight or reps
for the active program's exercises.

**No reminders at all** when any of these holds: notifications are not
granted, there is no active program, or the platform is web. A date gets no
reminder when it is before the program's `start_date`, after its last day
(`start_date + 7·duration_weeks − 1`), or when the membership doesn't cover
it. The membership covers a date unless its status is `paused`, `expired` or
`cancelled`, or `expires_at` is before that date. A client with no
membership row is covered.

**Training day** (for each date D from today to today + 13):

- D's weekday is in `available_days`. If `available_days` is empty or null,
  there are no training reminders, and Ajustes shows a hint to pick training
  days in Perfil.
- w is the program week of D (`currentWeekOf(start_date, duration_weeks, D)`).
- The training named is the first day of week w, in the same order the home
  card uses (`day_index`), that still has unchecked exercises in the current
  log. If week w has no pending training, D gets no reminder.
- For today: skip if the reminder time has already passed or the client has
  already logged training today.
- Title «Hoy toca {{label}}», body «{{n}} ejercicios · Semana {{w}}».
  `label` is the day's label, else its weekday name, else «Día {{n}}», the
  same fallback the home card uses.

**Inactivity** (off by default):

- The base is the later of the last logged training date and `start_date`.
- Reminders at base + 4 days and base + 7 days, at the reminder hour. Each
  one fires only if it is still in the future, its date passes the
  general rules above (program dates, membership), and the program week of
  that date still has a pending training. So a client who finished the
  current week and is waiting for a locked week to open is not nudged.
  Nothing after the 7-day one. Any new log moves the base, so the count
  restarts.
- Title «Han pasado {{days}} días sin entrenar», body «{{label}} te espera».
  `label` is the first pending training of that date's week (same pick as
  the training reminder).

**Week opened** (off by default, only when `lock_future_weeks` is on):

- For each week w ≥ 2 whose `weekOpensOn(start_date, w)` falls between now
  and today + 13, at the reminder hour.
- Title «Tu semana {{w}} ya está disponible», body «{{label}} · {{n}}
  ejercicios» (the first training of week w).
- If a training reminder falls on the same date, they merge into **one**
  notification: the week-opened title with the training body.

Together these stay well under iOS's 64 pending local notifications: at most
14 training, 2 inactivity and 2 week-opened, plus the rest alert.

## Design

**Pure planner: `src/utils/reminders.ts`.** It has no React, no Expo and no
I/O, and is unit tested. It turns the inputs (program with days and
exercises, log, `available_days`, membership, preferences, now) into a list
of planned reminders: `{ id, fireAt: Date, kind: 'training' | 'inactivity'
| 'week', params }`. `id` is stable per date and kind, for example
`reminder-2026-10-06-training`. Text comes from i18n keys plus `params`, so
the planner stays language-free.

**Preferences: `src/lib/reminder-prefs.ts`.** A device-level store in
AsyncStorage, the same pattern as `src/lib/alert-mode.ts`:
`{ training: true, inactivity: false, weekOpened: false, hour: 8 }`,
exposed as `useReminderPrefs()` and `setReminderPrefs(patch)`. Reminders
belong to the phone, like the rest-alert mode.

**Scheduler: `src/lib/reminders.ts`.** `syncReminders(plan, t)`:

- cancels every scheduled notification whose identifier starts with
  `reminder-`, and never touches the rest alert;
- schedules each planned reminder with a DATE trigger on the new Android
  channel `reminders`, with `data: { kind: 'reminder', url: '/(tabs)/routines' }`;
- does nothing on web.

It also exports `cancelReminders()`.

**When the plan is rebuilt: `src/hooks/use-reminder-sync.ts`,** mounted once
in the tabs layout. It rebuilds, debounced by about 1 s, when any of these
happen:

- the app returns to the foreground;
- the program, program log, profile (`available_days`) or membership data
  changes;
- the preferences or the app language change;
- notification permission is granted.

**Permission: `src/lib/notification-permission.ts`.**

- `getPermissionStatus()`: `granted`, `undetermined` or `denied`.
- `requestPermission()`: shows the phone's prompt.
- `openNotificationSettings()`: `Linking.openSettings()`.

The rest timer's existing mid-workout request stays as it is, for clients
who skipped.

**Onboarding.** A new **last step** in `app/(onboarding)/index.tsx`,
**before** the profile is saved. Once onboarding is marked complete,
`AuthGate` (`app/_layout.tsx`) moves the client to the tabs, so the screen
can't come after saving.

- Title «¿Te avisamos los días de entreno?», text about reminders on their
  training days.
- «Activar» shows the phone's prompt, then finishes onboarding.
- «Ahora no» finishes onboarding without asking.
- "Skip onboarding" (`handleSkip`) doesn't show this step; the client can
  turn notifications on later in Ajustes.
- On web the step is hidden.

**Ajustes → Notificaciones card** (`app/(tabs)/settings.tsx`, next to
`RestAlertCard`; hidden on web):

- A status row, «Activadas» or «Desactivadas», with a button when they're
  off:
  - `undetermined`: «Activar notificaciones» shows the phone's prompt;
  - `denied`: «Abrir ajustes del teléfono» calls `openNotificationSettings()`.
- The status is re-read when the app returns to the foreground, so it
  updates after the client comes back from the phone's settings.
- Three switches: «Días de entreno», «Si llevo días sin entrenar»,
  «Cuando se abre una semana». The last one is shown only when the active
  program has "Solo semana actual" on.
- The reminder hour, as a picker of whole hours from 5:00 to 22:00.
- The hint about training days when `available_days` is empty.

**Foreground and channels (`src/lib/rest-alert.ts`).**

- The handler keeps hiding rest alerts while the app is open, but shows
  notifications whose `data.kind === 'reminder'`.
- A new Android channel `reminders`, «Recordatorios», at default importance,
  is created at startup next to the rest channel. Clients can mute reminders
  without muting the rest alert. A channel's settings are fixed once it is
  created, but there are no real users yet, so they can still be adjusted
  before release.

**Taps.** Tapping a reminder opens the Programa tab. Handle it with
`addNotificationResponseReceivedListener` while the app is running, and
`getLastNotificationResponse` for a cold start. Navigate only after
`AuthGate` has resolved to the tabs, otherwise the gate overrides it.

**Sign-out.** Call `cancelReminders()` in the auth provider's `SIGNED_OUT`
handler, next to `clearOutbox()`, so the next person on that phone gets no
reminders meant for someone else.

## Copy (both `src/i18n/es.ts` and `en.ts`, new `reminders` section)

| Key | es | en |
|---|---|---|
| `trainingTitle` | Hoy toca {{label}} | Today: {{label}} |
| `trainingBody` | {{n}} ejercicios · Semana {{w}} | {{n}} exercises · Week {{w}} |
| `inactivityTitle` | Han pasado {{days}} días sin entrenar | It's been {{days}} days since you trained |
| `inactivityBody` | {{label}} te espera | {{label}} is waiting for you |
| `weekTitle` | Tu semana {{w}} ya está disponible | Week {{w}} is now open |
| `weekBody` | {{label}} · {{n}} ejercicios | {{label}} · {{n}} exercises |
| `onboardingTitle` | ¿Te avisamos los días de entreno? | Want reminders on your training days? |
| `onboardingText` | Te recordamos qué te toca entrenar en tus días de entreno. Puedes cambiarlo cuando quieras en Ajustes. | We'll remind you what to train on your training days. You can change this anytime in Settings. |
| `enable` | Activar | Turn on |
| `notNow` | Ahora no | Not now |
| `cardTitle` | Notificaciones | Notifications |
| `statusOn` | Activadas | On |
| `statusOff` | Desactivadas | Off |
| `enableButton` | Activar notificaciones | Turn on notifications |
| `openSettings` | Abrir ajustes del teléfono | Open phone settings |
| `prefTraining` | Días de entreno | Training days |
| `prefInactivity` | Si llevo días sin entrenar | When I haven't trained in a while |
| `prefWeek` | Cuando se abre una semana | When a new week opens |
| `hour` | Hora del recordatorio | Reminder time |
| `noDaysHint` | Elige tus días de entreno en Perfil para recibir recordatorios. | Pick your training days in Profile to get reminders. |
| `channelName` | Recordatorios | Reminders |

## Edge cases

- **Time zones and midnight.** Rebuilding on foreground keeps the 14-day
  window current. A client who doesn't open the app for 14 days stops
  getting training reminders after the window runs out. That's accepted:
  the inactivity reminders, which fire within 7 days, are the re-engagement
  path.
- **Coach edits** (program, days, membership) reach the phone the next time
  the app is opened or realtime refreshes the program. A reminder already
  scheduled may name a training that changed since. That's accepted for
  local reminders; piece 2 covers coach-triggered pushes.
- **Several phones with the same account:** each phone schedules its own
  reminders from its own preferences.
- **Permission revoked** in the phone's settings: the next rebuild finds no
  permission and schedules nothing; Ajustes shows «Desactivadas».
- **Language change:** rebuilds, so scheduled texts follow the new language.

## Verification

- `npm test`: the planner's unit tests cover:
  - training days only on profile days, and none when the list is empty;
  - the first pending training of the week, and no reminder when the week is
    done;
  - skipping today when already trained or when the time has passed;
  - no reminders before the start, after the end, or while the membership
    doesn't cover the date;
  - inactivity at +4 and +7 from the right base, and a new log restarting it;
  - week opened only with the lock on, and merged with a training reminder
    on the same date;
  - stable ids;
  - at most 18 reminders.
- `npx tsc --noEmit` and `npm run lint`.
- On a development build on a real phone (local notifications don't run on
  web):
  - the onboarding step with both choices;
  - the Ajustes card in each permission state, including coming back from
    the phone's settings;
  - a reminder set for a few minutes ahead, delivered in the foreground and
    the background;
  - tapping it opens Programa, both while running and from a cold start;
  - the rest alert still hidden in the foreground;
  - sign-out leaves no scheduled reminders.

## Out of scope

Remote push, any server or database change, the coach panel, coach alerts,
web push, and moving accounts to the coach (pieces 2 and 3).
