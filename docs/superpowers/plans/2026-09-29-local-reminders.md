# Local reminders (push notifications, piece 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client's phone schedules its own local reminders for the next 14 days (training days, on by default; inactivity after 4 and 7 days; week opened for "Solo semana actual" programs), at most one per date, asks for notification permission at the end of onboarding, and lets the client manage them, and their training days, in Ajustes → Notificaciones, with no server, database or panel change.

**Architecture:** A pure planner (`src/utils/reminders.ts`) turns the active program, its log, the profile's training days, the membership, the device's preferences and "now" into at most one dated reminder per date (14 at most) with stable ids (`reminder-YYYY-MM-DD-<kind>`), and a scheduler (`src/lib/reminders.ts`) replaces every `reminder-*` notification with one DATE trigger each on its own Android channel. A sync hook mounted once in the tabs layout rebuilds the plan, debounced 1 s, whenever an input changes, but only once a pure gate (`reminderSyncAction`) says every input has loaded. Onboarding gets a last permission step («Ahora no» also turns the training reminder off; «Omitir» is hidden there), Ajustes a Notificaciones card with the switches, the hour and a training-days picker that saves `profiles.available_days`, and the app's single foreground handler shows reminders while still hiding rest alerts.

**Tech Stack:** Expo SDK 57 with expo-notifications ~57.0.21 (already installed), expo-router, React Native 0.86 with the React Compiler, TanStack Query (persisted), AsyncStorage, i18next; tests with `node:test` on Node 25 type stripping through the "Solo semana actual" harness (`npm test`).

**Spec:** docs/superpowers/specs/2026-09-29-local-reminders-design.md

**Precondition:** the "Solo semana actual" plan (docs/superpowers/plans/2026-09-29-solo-semana-actual.md) is fully implemented (npm test exists; weekLock/weekOpensOn/useToday exist) — Task 0 checks this and stops otherwise. This plan was replayed on a copy of `6f5632b` with that plan's app Tasks 1–7 applied as written (the result matched `main` at `d46e2c3` file for file): every find text below matched exactly once, and the counts quoted are what that replay printed.

## Global Constraints

- Repo and branch: app repo `C:\Users\Signos\Documents\edwin\hokage-coaching-app` only; work directly on `main`, never create or switch branches, open no PR.
- Preflight at the start of every task: if `git status --short -- <task files>` lists anything, stop and ask; if the whole tree is clean, `git pull --rebase` first; if other files are dirty, neither pull nor stash.
- Order: Task 0, then Tasks 1 → 8 in order (Task 5 needs Tasks 1–4; Tasks 6 and 7 need Tasks 3 and 4).
- App only: no migration, database, Edge Function, panel, server push, `app.json`, config plugin or native change; the existing development build keeps working (expo-notifications is already installed).
- White-label (CLAUDE.md): no Zyron branding, self-serve sign-up or multi-coach logic, no brand or app name in new code or copy; manual commands read the Android package id from `app.json` (`expo.android.package`).
- Pure modules (`src/utils/reminders.ts`, `reminder-prefs.ts`, `notification-permission.ts`, `reminder-sync.ts`, `training-days.ts`) import no React, React Native, Expo, AsyncStorage or i18n, and take types only through `import type`, because the tests run them under Node.
- Only notifications whose id starts with `REMINDER_ID_PREFIX` (`"reminder-"`, spelled once in `src/utils/reminders.ts`, re-exported by `src/lib/reminders.ts`) are ever cancelled; never call `cancelAllScheduledNotificationsAsync`.
- Rest alert behaviour unchanged: its channels, scheduling, permission request and foreground hiding stay as they are, and `setNotificationHandler` stays the only handler, in `src/lib/rest-alert.ts`.
- Web no-ops: every function in `src/lib/reminders.ts` and `src/lib/notification-permission.ts` does nothing there (the status reads `"denied"`), and the Notificaciones card, the onboarding step and the tabs' `Reminders` component check `Platform.OS === "web"` before any notification hook runs.
- Dates are the phone's local dates (`toDateKey`, `dateKeyToDate`, `addDays` from `src/utils/dates.ts`, never `toISOString().slice(0, 10)`); fire times are built from calendar fields (`new Date(y, m − 1, d, hour)`), never by adding milliseconds.
- Copy goes in BOTH `src/i18n/es.ts` and `src/i18n/en.ts`, new `reminders` section with exactly the spec's Copy table (25 keys, texts word for word, pinned by `src/i18n/reminders.test.ts`); no hard-coded user-facing strings.
  - `trainingBody` and `weekBody` are i18next plural keys (`_one`/`_other`, chosen by `count`). The app already uses that suffix style (`common.pendingChanges_one`, `program.exercisesCount_one`), with i18next 26.0.5 and no `compatibilityJSON` in `src/i18n/index.ts`, so its default v4 plural format applies. On the phone i18next uses `Intl.PluralRules` if the engine has it; otherwise, for `"es"`/`"en"` (no region), i18next 26 silently uses its built-in rule (1 → `_one`, else `_other`), which gives the same forms. The existing `_one` keys rely on the same path. The planner's params therefore carry `count` (not `n`), and the scheduler renders `t("reminders.trainingBody", { label, count, w })`.
  - The day-number fallback is the new `reminders.dayN` («Día {{n}}» / «Day {{n}}»), not the home card's all-caps eyebrow `program.dayN` («DÍA {{n}}»).
  - The Ajustes day chips reuse the existing `progress.dayLetters` («L,M,X,J,V,S,D» / «M,T,W,T,F,S,S», the Progress tab's Monday-first letters) and read each chip's full name from `daysLong.*` for screen readers. Onboarding's own chips use the three-letter `days.*` («Lun» / «Mon»), which the spec's «L M X J V S D» doesn't match.
- Preferences: defaults `{ training: true, inactivity: false, weekOpened: false, hour: 8 }`, hour picker 5:00–22:00, stored per device in AsyncStorage key `app_reminder_prefs` and kept across sign-outs; scheduled reminders are cancelled on `SIGNED_OUT`.
- Training days (spec Decision 2): the Ajustes chips change only `profiles.available_days`, through `useProfile(user.id).updateProfile`, the same local-first write onboarding makes. It writes the cache first, then queues an upsert in the outbox (`src/lib/outbox.ts` collapses consecutive profile edits into one op, but never into the op it is sending, Task 7 Step 9), so it also works offline. The list is written as `"Mon"` … `"Sun"` in Monday-first order, like the panel's `OverviewTab` (onboarding keeps tap order; every reader goes through `dayNameToIndex`, so order doesn't matter to them). `days_per_week` is never written.
- Onboarding: `handleSkip` itself is unchanged, but «Omitir» is hidden on the new reminders step, since skipping doesn't save the profile. «Ahora no» calls `setReminderPrefs({ training: false })` before the save, because Android 12 and older grant notifications without a prompt. The rest timer's own mid-workout permission request is unchanged.
- Interpretation, «Activar»: it calls `setReminderPrefs({ training: true })` before the prompt. The spec only says it shows the prompt. But the preferences are per device and survive sign-outs, so without this an earlier client's "off" on the same phone, or a failed «Ahora no» save just before, would leave a client who tapped «Activar» with no training reminders.
- Anchors: match every edit on its quoted text, not its line number (line numbers are as at `64ab056` and before the task's own earlier steps; the previous plan also edits `src/i18n/es.ts`/`en.ts`, in their `program` section); several files are CRLF in the working tree while the anchors are shown with LF, which the Edit tool matches either way.
- Shell: commands are written for Git Bash (the Bash tool), like the previous plan: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && <cmd>` in one call; Git Bash does not pass `TZ` to node.exe, so the planner tests pin their own zones; a harmless `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) … async.c` may follow a node run on Windows.
- Gate for every task: `npm test` ends with `ℹ fail 0`; `npx tsc --noEmit` prints nothing; `npx eslint <the task's files>` prints nothing; `npm run lint` ends with `✖ 3 problems (0 errors, 3 warnings)` (the baseline: three `import/no-named-as-default-member` warnings in `src/i18n/index.ts`).
- Never commit `src/hooks/use-reminder-debug.ts`; it exists only during Task 8.
- Commits: `git add` explicit paths only (quote paths with parentheses); `git diff --cached --name-only` must list exactly the task's files; every message is several `-m` paragraphs ending with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push: no push steps in the tasks; pushing `main` to `origin/main` after each finished task is fine (CLAUDE.md; CI only deploys `supabase/functions/**`).
- Git paths: every command uses the forward-slash path `C:/Users/Signos/Documents/edwin/hokage-coaching-app`, as the previous plan does (Git Bash eats unquoted backslashes; it works in PowerShell too).
- Interpretation, today: today's training reminder is skipped when its hour has passed OR the client already logged training today (a completion on today's local date, or a set with weight or reps).
- Interpretation, week opened: it names week w's first pending training and is skipped when week w has nothing pending (differs from "the first training" only if the lock was switched on after checks were made).
- Interpretation, inactivity: bound to the 14-day window (Decision 5); a log dated after today counts as today.
- Interpretation, one per date (spec, "At most one reminder per date"):
  - An inactivity reminder wins its date. The training or week-opened reminder planned for that date, merged or not, is dropped.
  - Otherwise a week opening on a training date merges into one notification. It keeps id `reminder-<date>-week` and kind `"week"`, with `reminders.weekTitle` + `reminders.trainingBody` and the training's params `{ label, count, w }`.
  - So the plan never holds two reminders for one local date, and never more than 14.
- Additions beyond the fixed interfaces, none changing a fixed name or signature:
  - in the planner, `REMINDER_ID_PREFIX`;
  - pure `src/utils/reminder-prefs.ts`, `src/utils/notification-permission.ts` (defines `PermissionStatus`, re-exported by `src/lib/notification-permission.ts`), `src/utils/reminder-sync.ts` and `src/utils/training-days.ts` (`TRAINING_DAY_VALUES`, `trainingDayIndexes`, `toggleTrainingDay`);
  - `reminderPrefsReady()`/`useReminderPrefsReady()`;
  - `REMINDER_KIND`, `REMINDER_URL`, `isReminderData` and `reminderGeneration` in `src/lib/reminders.ts`;
  - `programDayName` in `src/utils/day-label.ts`;
  - `error` in `useMembership()` and `useProfile()`;
  - `src/components/settings-row.tsx`.
- Taps: `router.push(data.url)` only when `data.url` is a `/(tabs)/…` route, else `REMINDER_URL` (a payload's URL is not trusted as a route).

## Review Focus

1. Data not loaded yet, or failed with nothing cached (fresh sign-in, flaky network, persisted cache still restoring) → the sync keeps what is scheduled instead of cancelling everything ("no program") or scheduling for an ended membership ("covered"); owner Task 5 (`sourceState`/`reminderSyncAction`), pinned by Task 5 Step 2 ("waits while any source is loading or failed with nothing cached").
2. Stored preferences not read yet at launch → nothing is scheduled from the defaults (08:00, training on) for a client who changed them; owner Tasks 3 and 5 (`useReminderPrefsReady` + the gate), pinned by Task 5 Step 2 ("waits for the stored preferences") and Task 8 Step 6 check 5.
3. Permission reports from different phones (Android ≤ 12 granted by default, Android 13+ after one or two "no", iOS provisional, a read or prompt that throws) → the right button shows and the app never asks for a prompt the phone won't show; owner Task 3 (`toPermissionStatus`/`requestPermissionStatus`), pinned by Task 3 Step 6.
4. Log times near midnight or dated after today (another phone, a wrong clock) → they count on the phone's local date and the inactivity base never passes today, in UTC−4, Madrid and a US DST change; owner Tasks 1–2, pinned by Task 1 Step 2 ("counts on the phone's date") and Task 2 Step 2 ("a check late in the evening…", "a log dated after today…").
5. Sign-out while a rebuild is still debouncing → the previous client's plan is not scheduled after the sign-out cancel; owner Task 4 (`reminderGeneration`, bumped by `cancelReminders`) and Task 5 (the hook re-checks it), pinned by Task 8 Step 8 check 3 (USER STEP on a phone).
6. Several reminders on one date (inactivity + training, inactivity + a week opening, week opening + training) → exactly one notification that date, inactivity first; owner Task 2 (`onePerDate`), pinned by Task 2 Step 2 ("planReminders: one per date" and the "everything on" sweep).
7. The Ajustes day chips tapped quickly, offline, or over a list with legacy spellings (`"monday"`, `"Thursday"`) → each tap builds on the previous one (read from the query cache, not the render), a tap during an in-flight upsert is queued behind it instead of merged into it, the list is saved as `"Mon"` … `"Sun"` in Monday-first order, only `available_days` is written (queued in the outbox when offline), and the reminders rebuild; owner Task 7 (`toggleTrainingDay`, the card and the outbox fix in Step 9), pinned by Task 7 Step 2 (the helper's tests) and Task 8 Step 8 check 1 ("Training days", USER STEP on a phone).

---

### Task 0: Preconditions and baseline

**Files:** none (read-only).

**Interfaces:**
- Consumes the "Solo semana actual" plan:
  - `Program.lock_future_weeks: boolean` in `src/types/database.ts`;
  - `weekOpensOn(startDate, week)`, `weekLock(program, week, now)` and a DST-safe `currentWeekOf` in `src/utils/program.ts`;
  - `useToday(): Date` in `src/lib/today.ts`;
  - the `npm test` script and `scripts/test-register.mjs`, `scripts/test-resolve.mjs` and `scripts/test-stubs/react-native.mjs`.
- Produces: the recorded baseline every later gate compares against.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app branch --show-current
```

Expected: the second command prints `main`.
- If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.
- If it lists files, don't pull or stash. Note them: no task below may touch them.

- [ ] **Step 2: Check that the previous plan is in**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && git grep -n -e "lock_future_weeks: boolean" -e "export function weekOpensOn" -e "export function useToday" -e "\"test\":" -- src/types/database.ts src/utils/program.ts src/lib/today.ts package.json && ls scripts/test-register.mjs scripts/test-resolve.mjs scripts/test-stubs/react-native.mjs
```

Expected: exactly four hits (line numbers may differ), then the three script paths:

```
package.json:…:    "test": "node --import ./scripts/test-register.mjs --test \"src/**/*.test.ts\""
src/lib/today.ts:…:export function useToday(): Date {
src/types/database.ts:…:  lock_future_weeks: boolean;
src/utils/program.ts:…:export function weekOpensOn(startDate: string, week: number): string {
scripts/test-register.mjs
scripts/test-resolve.mjs
scripts/test-stubs/react-native.mjs
```

If anything is missing, stop: this plan builds on that one.

- [ ] **Step 3: Record the baseline**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 31`, `ℹ suites 9`, `ℹ pass 31` and `ℹ fail 0` (the previous plan's tests), then its `cancelled`/`skipped`/`todo`/`duration_ms` lines;
- `tsc` prints nothing;
- the lint run ends with `✖ 3 problems (0 errors, 3 warnings)`.

If the counts differ, write down what you see and use it as the baseline for every later gate. Each task below adds its own tests on top: after Task 7 the full run is `ℹ tests 200`, `ℹ suites 41`.

- [ ] **Step 4: Nothing to commit**

Run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short`. Expected: the same output as in Step 1. This task changes no file.

---

### Task 1: Planner: training reminders and the general rules

**Files:**
- Create: `src/utils/reminders.ts` (the pure planner: types, defaults and `planReminders`; after this task it plans training-day reminders only)
- Test: `src/utils/reminders.test.ts`

**Interfaces:**
- Consumes (all existing and pure):
  - `src/utils/program.ts`: `currentWeekOf(startDate, durationWeeks, now)`, `isBeforeStart(startDate, now)` and `isAfterEnd(startDate, durationWeeks, now)`.
  - `src/utils/dates.ts`: `toDateKey(d)`, `dateKeyToDate(key)` (noon-anchored local date) and `addDays(key, delta)`.
  - `src/utils/progress.ts`:
    - `dayNameToIndex(value)`: "Mon" … "Sun" → 0 … 6, the mapping the dashboard already uses for `profiles.available_days`. Onboarding stores those values from `DAY_VALUES`, and so does the panel.
    - `dowIndex(date)`: 0 = Monday … 6 = Sunday.
  - `src/types/database.ts`:
    - `ProgramWithDetails`, including `lock_future_weeks`;
    - `ProgramDayWithExercises`;
    - `ProgramExerciseCompletion`, whose `completed_at` is an ISO timestamp;
    - `WorkoutSetLog`, whose `date` is a local `YYYY-MM-DD` key stamped by `logSet`;
    - `Membership`, with `status: "active" | "expired" | "paused" | "cancelled"` and `expires_at: string | null`.
- Produces (`src/utils/reminders.ts`, exactly):
  - `export type ReminderKind = "training" | "inactivity" | "week";`
  - `export type ReminderPrefs = { training: boolean; inactivity: boolean; weekOpened: boolean; hour: number };`
  - `export const DEFAULT_REMINDER_PREFS: ReminderPrefs = { training: true, inactivity: false, weekOpened: false, hour: 8 };`
  - `export type PlannedReminder = { id: string; fireAt: Date; kind: ReminderKind; titleKey: string; bodyKey: string; params: Record<string, string | number> };`
  - `export type ReminderInput = { program: ProgramWithDetails | null; completions: ProgramExerciseCompletion[]; setLogs: WorkoutSetLog[]; availableDays: string[] | null; membership: Pick<Membership, "status" | "expires_at"> | null; prefs: ReminderPrefs; now: Date; labelOf: (day: ProgramDayWithExercises) => string };`
  - `export const REMINDER_ID_PREFIX = "reminder-";`
  - `export function planReminders(input: ReminderInput): PlannedReminder[]`, sorted by `fireAt` (ties by `id`).
  - A training reminder has:
    - `id`: `reminder-YYYY-MM-DD-training`; `kind`: `"training"`;
    - `titleKey`: `"reminders.trainingTitle"`; `bodyKey`: `"reminders.trainingBody"`;
    - `params`: `{ label, count, w }`, where `label` is `labelOf(day)`, `count` is the number of exercises in that day (named `count` so i18next picks `trainingBody_one` or `trainingBody_other`, Task 4), and `w` is the program week of the date.

Rules implemented here (spec, "Reminder rules"):
- **No reminder at all** when `program` is null, its status isn't `"active"`, or `prefs.training` is off. Task 2 adds the other two kinds. Permission and web are the caller's checks (Task 5).
- **Dates:** today … today + 13 on the phone's calendar, only on the weekdays in `available_days`. None when that list is null or empty.
- **General rules for every date:**
  - not before `start_date`;
  - not after `start_date + 7·duration_weeks − 1`;
  - covered by the membership. A membership covers a date unless its status is `paused`, `expired` or `cancelled`, or its `expires_at` is before the date. The `expires_at` day itself is covered, and a client with no membership row is covered.
- **The training named** is the first day of the date's program week, in `day_index` order, that still has an unchecked exercise.
  - This is the home card's order and pending test (`dayProgress(d, w).done < total`), and days without exercises never count.
  - If nothing in that week is pending, the date gets no reminder.
- **Today** is skipped once `hour`:00 has passed, or when the client already logged training today:
  - a completion whose `completed_at` falls on today's local date, or
  - a set log dated today with a weight or reps.

  Only rows for the active program's exercises count, because the log cache is per user.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/reminders.ts src/utils/reminders.test.ts
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.

- [ ] **Step 2: Write the failing tests**

Create `src/utils/reminders.test.ts`. Every suite runs in three pinned time zones, the way the previous plan's `src/utils/program.test.ts` does it:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramExerciseCompletion,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import {
  DEFAULT_REMINDER_PREFS,
  planReminders,
  type PlannedReminder,
  type ReminderInput,
  type ReminderPrefs,
} from "@/src/utils/reminders";

// Run a suite's tests in a fixed time zone, so results don't depend on the
// machine's. Node re-reads TZ when process.env.TZ is assigned (Windows too;
// Git Bash drops a TZ set on the command line, so it has to be set here).
function inTimeZone(tz: string) {
  let saved: string | undefined;
  before(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  after(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

// Every suite runs in three zones: the coach's (UTC-4, no DST), one east of
// UTC with a DST change inside the program (Madrid, 10-25) and one with a DST
// change inside the sweep at the end (New York, 11-01). A check late at night
// or just after midnight falls on another UTC date in one of the first two.
const ZONES = ["America/Santo_Domingo", "Europe/Madrid", "America/New_York"];

/** Registers `body`'s tests once per zone. */
function inEachZone(name: string, body: () => void) {
  for (const tz of ZONES) {
    describe(`${name} (${tz})`, () => {
      inTimeZone(tz);
      body();
    });
  }
}

// Calendar used throughout (October 2026): the program starts Mon 10-05 and
// runs 4 weeks, so its last day is Sun 11-01. Week 2 opens Mon 10-12, week 3
// Mon 10-19, week 4 Mon 10-26. "Now" defaults to Tue 10-06 07:00 local, so
// the 14-day window is Tue 10-06 … Mon 10-19.

/** Local wall-clock time on a date key. */
function at(dateKey: string, hour: number, minute = 0): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute);
}

function exercise(id: string, dayId: string, sortOrder: number): ProgramExercise {
  return {
    id,
    program_day_id: dayId,
    exercise_id: null,
    custom_name: `Ejercicio ${id}`,
    sets: 3,
    rep_min: 8,
    rep_max: 10,
    is_unilateral: false,
    rir_min: null,
    rir_max: null,
    load_pct_1rm: null,
    load_qualitative: null,
    tempo: null,
    rest_seconds: 90,
    notes: null,
    sort_order: sortOrder,
    created_at: "2026-09-20T12:00:00.000Z",
  };
}

function programDay(
  id: string,
  dayIndex: number,
  sortOrder: number,
  label: string | null,
  weekday: string | null,
  exerciseIds: string[],
): ProgramDayWithExercises {
  return {
    id,
    program_id: "prog-1",
    day_index: dayIndex,
    label,
    weekday,
    sort_order: sortOrder,
    created_at: "2026-09-20T12:00:00.000Z",
    program_exercises: exerciseIds.map((exId, i) => exercise(exId, id, i)),
  };
}

// The days are listed out of day_index order on purpose: the planner must
// follow day_index (the home card's order), not array position. Day 2 has no
// exercises, so it is never the training to name.
function makeProgram(overrides: Partial<ProgramWithDetails> = {}): ProgramWithDetails {
  return {
    id: "prog-1",
    user_id: "client-1",
    assigned_by: "coach-1",
    source: "coach",
    name: "Bloque de fuerza",
    description: null,
    focus: null,
    duration_weeks: 4,
    start_date: "2026-10-05",
    status: "active",
    progression_rule: null,
    tempo_default: null,
    notes: null,
    lock_future_weeks: false,
    created_at: "2026-09-20T12:00:00.000Z",
    updated_at: "2026-09-20T12:00:00.000Z",
    program_days: [
      programDay("day-b", 3, 0, null, "wednesday", ["b1", "b2"]),
      programDay("day-a", 1, 1, "Pierna", null, ["a1", "a2", "a3"]),
      programDay("day-empty", 2, 2, "Movilidad", null, []),
      programDay("day-c", 4, 3, null, null, ["c1", "c2"]),
    ],
    program_weeks: [],
    ...overrides,
  };
}

const DAY_A = ["a1", "a2", "a3"];
const DAY_B = ["b1", "b2"];
const DAY_C = ["c1", "c2"];

let seq = 0;

/** Completion checks for these exercises in `week`, made at `when`. */
function checks(exerciseIds: string[], week: number, when: Date): ProgramExerciseCompletion[] {
  return exerciseIds.map((exId) => ({
    id: `cmp-${++seq}`,
    user_id: "client-1",
    program_exercise_id: exId,
    week_number: week,
    completed_at: when.toISOString(),
    created_at: when.toISOString(),
  }));
}

/** One logged set, dated like useProgramLogging().logSet does (local key). */
function setLog(
  exerciseId: string | null,
  week: number,
  date: string,
  values: Partial<Pick<WorkoutSetLog, "weight_kg" | "reps" | "rir">>,
): WorkoutSetLog {
  return {
    id: `set-${++seq}`,
    user_id: "client-1",
    program_exercise_id: exerciseId,
    week_number: week,
    date,
    set_index: 0,
    weight_kg: values.weight_kg ?? null,
    reps: values.reps ?? null,
    rir: values.rir ?? null,
    created_at: `${date}T12:00:00.000Z`,
  };
}

const MON_WED_FRI = ["Mon", "Wed", "Fri"];
const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function prefs(patch: Partial<ReminderPrefs>): ReminderPrefs {
  return { ...DEFAULT_REMINDER_PREFS, ...patch };
}

function plan(overrides: Partial<ReminderInput> = {}): PlannedReminder[] {
  return planReminders({
    program: makeProgram(),
    completions: [],
    setLogs: [],
    availableDays: MON_WED_FRI,
    membership: null,
    prefs: DEFAULT_REMINDER_PREFS,
    now: at("2026-10-06", 7),
    labelOf: (d) => d.label ?? d.weekday ?? `Día ${d.day_index}`,
    ...overrides,
  });
}

const ids = (list: PlannedReminder[]) => list.map((r) => r.id);
const byId = (list: PlannedReminder[], id: string) => list.find((r) => r.id === id);

inEachZone("planReminders: global rules", () => {
  it("defaults: training reminders on at 8:00, the other two off", () => {
    assert.deepEqual(DEFAULT_REMINDER_PREFS, {
      training: true,
      inactivity: false,
      weekOpened: false,
      hour: 8,
    });
  });

  it("no active program: nothing", () => {
    assert.deepEqual(plan({ program: null }), []);
    assert.deepEqual(plan({ program: makeProgram({ status: "completed" }) }), []);
  });

  it("training off (and the others off): nothing", () => {
    assert.deepEqual(plan({ prefs: prefs({ training: false }) }), []);
  });

  it("no reminders before the program starts", () => {
    const list = plan({ program: makeProgram({ start_date: "2026-10-12" }) });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-12-training",
      "reminder-2026-10-14-training",
      "reminder-2026-10-16-training",
      "reminder-2026-10-19-training",
    ]);
  });

  it("no reminders after the program's last day", () => {
    // Starts Mon 09-28, 2 weeks: the last day is Sun 10-11.
    const list = plan({ program: makeProgram({ start_date: "2026-09-28", duration_weeks: 2 }) });
    assert.deepEqual(ids(list), ["reminder-2026-10-07-training", "reminder-2026-10-09-training"]);
    assert.equal(list[0].params.w, 2);
  });

  it("membership: paused, expired or cancelled cover nothing", () => {
    for (const status of ["paused", "expired", "cancelled"] as const) {
      assert.deepEqual(plan({ membership: { status, expires_at: null } }), [], status);
    }
  });

  it("membership: covers up to and including expires_at; no row or no date covers all", () => {
    const list = plan({ membership: { status: "active", expires_at: "2026-10-12" } });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-07-training",
      "reminder-2026-10-09-training",
      "reminder-2026-10-12-training",
    ]);
    assert.equal(plan({ membership: { status: "active", expires_at: null } }).length, 6);
    assert.equal(plan({ membership: null }).length, 6);
  });

  it("ids are stable per date and kind, unique, and carry the reminder- prefix", () => {
    const early = plan({ now: at("2026-10-06", 7) });
    const later = plan({ now: at("2026-10-06", 7, 30) });
    assert.deepEqual(ids(later), ids(early));
    assert.equal(new Set(ids(early)).size, early.length);
    for (const id of ids(early)) {
      assert.match(id, /^reminder-\d{4}-\d{2}-\d{2}-(training|inactivity|week)$/);
    }
  });
});

inEachZone("planReminders: training day", () => {
  it("only on the profile's weekdays, today … today + 13, at 8:00", () => {
    const list = plan();
    assert.deepEqual(ids(list), [
      "reminder-2026-10-07-training",
      "reminder-2026-10-09-training",
      "reminder-2026-10-12-training",
      "reminder-2026-10-14-training",
      "reminder-2026-10-16-training",
      "reminder-2026-10-19-training",
    ]);
    assert.equal(list[0].fireAt.getTime(), at("2026-10-07", 8).getTime());
    assert.ok(list.every((r) => r.kind === "training"));
  });

  it("every day of the window when all seven days are picked", () => {
    const list = plan({ availableDays: ALL_DAYS });
    assert.equal(list.length, 14);
    assert.equal(list[0].id, "reminder-2026-10-06-training");
    assert.equal(list[13].id, "reminder-2026-10-19-training");
  });

  it("none when the profile has no training days", () => {
    assert.deepEqual(plan({ availableDays: null }), []);
    assert.deepEqual(plan({ availableDays: [] }), []);
  });

  it("names the week's first pending day in day_index order", () => {
    const list = plan();
    const wed = byId(list, "reminder-2026-10-07-training")!;
    assert.equal(wed.titleKey, "reminders.trainingTitle");
    assert.equal(wed.bodyKey, "reminders.trainingBody");
    assert.deepEqual(wed.params, { label: "Pierna", count: 3, w: 1 });
    assert.deepEqual(byId(list, "reminder-2026-10-12-training")!.params, {
      label: "Pierna",
      count: 3,
      w: 2,
    });
  });

  it("count is the named day's exercises, so a one-exercise day reads singular", () => {
    const oneExercise = makeProgram({
      program_days: [programDay("day-solo", 1, 0, "Core", null, ["s1"])],
    });
    const list = plan({ program: oneExercise });
    assert.deepEqual(byId(list, "reminder-2026-10-07-training")!.params, {
      label: "Core",
      count: 1,
      w: 1,
    });
  });

  it("a partly checked day is still the one to name", () => {
    const list = plan({ completions: checks(["a1"], 1, at("2026-10-05", 18)) });
    assert.equal(byId(list, "reminder-2026-10-07-training")!.params.label, "Pierna");
  });

  it("a finished day moves on to the next one, skipping days without exercises", () => {
    const list = plan({ completions: checks(DAY_A, 1, at("2026-10-05", 18)) });
    assert.deepEqual(byId(list, "reminder-2026-10-07-training")!.params, {
      label: "wednesday",
      count: 2,
      w: 1,
    });
    // Week 2 has its own checks: nothing done there yet.
    assert.equal(byId(list, "reminder-2026-10-12-training")!.params.label, "Pierna");

    const twoDone = plan({
      completions: checks([...DAY_A, ...DAY_B], 1, at("2026-10-05", 18)),
    });
    assert.equal(byId(twoDone, "reminder-2026-10-07-training")!.params.label, "Día 4");
  });

  it("no reminder on a date whose week has nothing pending", () => {
    const list = plan({
      completions: checks([...DAY_A, ...DAY_B, ...DAY_C], 1, at("2026-10-05", 18)),
    });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-12-training",
      "reminder-2026-10-14-training",
      "reminder-2026-10-16-training",
      "reminder-2026-10-19-training",
    ]);
  });

  it("rows of another program's exercises are ignored", () => {
    const list = plan({
      now: at("2026-10-07", 7),
      completions: checks(["old-1", "old-2"], 1, at("2026-10-07", 6)),
      setLogs: [setLog("old-1", 1, "2026-10-07", { weight_kg: 60, reps: 8 })],
    });
    assert.equal(list[0].id, "reminder-2026-10-07-training");
    assert.equal(list[0].params.label, "Pierna");
  });

  it("today: kept while the hour is ahead, skipped once it has passed", () => {
    assert.equal(plan({ now: at("2026-10-07", 7, 59) })[0].id, "reminder-2026-10-07-training");
    assert.equal(plan({ now: at("2026-10-07", 8) })[0].id, "reminder-2026-10-09-training");
    assert.equal(plan({ now: at("2026-10-07", 12) })[0].id, "reminder-2026-10-09-training");
  });

  it("today: skipped once the client has logged training today", () => {
    const now = at("2026-10-07", 7);

    const checked = plan({ now, completions: checks(["a1"], 1, at("2026-10-07", 6, 45)) });
    assert.equal(checked[0].id, "reminder-2026-10-09-training");
    // The day was only partly done, so it is still Friday's training.
    assert.equal(checked[0].params.label, "Pierna");

    const withReps = plan({ now, setLogs: [setLog("a1", 1, "2026-10-07", { reps: 10 })] });
    assert.equal(withReps[0].id, "reminder-2026-10-09-training");

    const withWeight = plan({ now, setLogs: [setLog("a1", 1, "2026-10-07", { weight_kg: 40 })] });
    assert.equal(withWeight[0].id, "reminder-2026-10-09-training");
  });

  it("today: a set with only RIR, or a check from yesterday, is not training today", () => {
    const now = at("2026-10-07", 7);
    const rirOnly = plan({ now, setLogs: [setLog("a1", 1, "2026-10-07", { rir: 2 })] });
    assert.equal(rirOnly[0].id, "reminder-2026-10-07-training");

    const yesterday = plan({ now, completions: checks(["a1"], 1, at("2026-10-06", 19)) });
    assert.equal(yesterday[0].id, "reminder-2026-10-07-training");
  });

  it("today: a check counts on the phone's date, not the UTC one", () => {
    const now = at("2026-10-07", 7);
    // 23:30 last night is already 10-07 in UTC west of Greenwich: not today.
    const lateLastNight = plan({ now, completions: checks(["a1"], 1, at("2026-10-06", 23, 30)) });
    assert.equal(lateLastNight[0].id, "reminder-2026-10-07-training");
    // 00:30 today is still 10-06 in UTC east of Greenwich: today all the same.
    const justAfterMidnight = plan({ now, completions: checks(["a1"], 1, at("2026-10-07", 0, 30)) });
    assert.equal(justAfterMidnight[0].id, "reminder-2026-10-09-training");
  });

  it("the reminder hour applies to every reminder, today included", () => {
    const list = plan({ prefs: prefs({ hour: 18 }), now: at("2026-10-07", 17) });
    assert.equal(list[0].id, "reminder-2026-10-07-training");
    assert.ok(list.every((r) => r.fireAt.getHours() === 18 && r.fireAt.getMinutes() === 0));
  });
});
```

- [ ] **Step 3: Run the tests and watch them fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/reminders.test.ts
```

Expected: the file fails to load, because the resolver finds no `src/utils/reminders.ts` and Node falls back to looking for a package:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …\src\utils\reminders.test.ts
…
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

- [ ] **Step 4: Write the planner**

Create `src/utils/reminders.ts`:

```ts
import type {
  Membership,
  ProgramDayWithExercises,
  ProgramExerciseCompletion,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { addDays, dateKeyToDate, toDateKey } from "@/src/utils/dates";
import { currentWeekOf, isAfterEnd, isBeforeStart } from "@/src/utils/program";
import { dayNameToIndex, dowIndex } from "@/src/utils/progress";

// Pure planner behind the local reminders (docs/superpowers/specs/
// 2026-09-29-local-reminders-design.md). No React, no Expo, no I/O — kept
// testable (reminders.test.ts). It turns what the phone already has into the
// notifications to schedule; src/lib/reminders.ts renders each one with
// t(titleKey, params) / t(bodyKey, params), so the plan is language-free.
// Permission and platform (web) are the caller's checks, not the planner's.

export type ReminderKind = "training" | "inactivity" | "week";

/** Device-level preferences (src/lib/reminder-prefs.ts). `hour` is the local
    hour (0–23) every reminder fires at. */
export type ReminderPrefs = {
  training: boolean;
  inactivity: boolean;
  weekOpened: boolean;
  hour: number;
};

export const DEFAULT_REMINDER_PREFS: ReminderPrefs = {
  training: true,
  inactivity: false,
  weekOpened: false,
  hour: 8,
};

export type PlannedReminder = {
  /** Stable per date and kind ("reminder-2026-10-06-training"), so a rebuild
      replaces a reminder instead of duplicating it. */
  id: string;
  fireAt: Date;
  kind: ReminderKind;
  /** i18n keys in the `reminders` section, rendered with `params`. */
  titleKey: string;
  bodyKey: string;
  params: Record<string, string | number>;
};

export type ReminderInput = {
  program: ProgramWithDetails | null;
  completions: ProgramExerciseCompletion[];
  setLogs: WorkoutSetLog[];
  /** profiles.available_days: "Mon" … "Sun". */
  availableDays: string[] | null;
  membership: Pick<Membership, "status" | "expires_at"> | null;
  prefs: ReminderPrefs;
  now: Date;
  /** A day's display name: its label, else its weekday name, else its number
      («Día n», reminders.dayN). Injected so the planner needs no t(); the
      app passes programDayName (src/utils/day-label.ts). */
  labelOf: (day: ProgramDayWithExercises) => string;
};

/** Days planned ahead, today included: today … today + 13. */
const WINDOW_DAYS = 14;

/** Every reminder id starts with this. The scheduler (src/lib/reminders.ts)
    re-exports it and cancels by it, so this is the one place it is spelled. */
export const REMINDER_ID_PREFIX = "reminder-";

/** Membership states that stop every reminder, whatever the dates say. */
const UNCOVERED: ReadonlySet<Membership["status"]> = new Set([
  "paused",
  "expired",
  "cancelled",
]);

function reminderId(dateKey: string, kind: ReminderKind): string {
  return `${REMINDER_ID_PREFIX}${dateKey}-${kind}`;
}

/** `hour`:00 local time on a date key. Built from the calendar fields, so a
    DST change can't shift it the way adding hours to midnight would. */
function atHour(dateKey: string, hour: number): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}

function isAhead(fireAt: Date, now: Date): boolean {
  return fireAt.getTime() > now.getTime();
}

/** The program week a date falls in (1-based; the date is inside the program). */
function weekOfDate(program: ProgramWithDetails, dateKey: string): number {
  return currentWeekOf(program.start_date, program.duration_weeks, dateKeyToDate(dateKey));
}

/** The general rules every reminder date must pass: inside the program
    (start_date … start + 7·weeks − 1) and covered by the membership. The
    membership covers a date unless it is paused/expired/cancelled or
    expires_at is before that date; no membership row covers everything. */
function dateAllowed(
  program: ProgramWithDetails,
  membership: ReminderInput["membership"],
  dateKey: string,
): boolean {
  const at = dateKeyToDate(dateKey);
  if (isBeforeStart(program.start_date, at)) return false;
  if (isAfterEnd(program.start_date, program.duration_weeks, at)) return false;
  if (membership == null) return true;
  if (UNCOVERED.has(membership.status)) return false;
  return membership.expires_at == null || membership.expires_at >= dateKey;
}

/** What the planner reads from the program log. */
type LogView = {
  /** `${exerciseId}:${week}` of every checked exercise. */
  done: Set<string>;
  /** Local dates ("YYYY-MM-DD") with logged training: a completion check, or
      a set with weight or reps. */
  trainedOn: Set<string>;
};

/** Scoped to THIS program's exercises: the log cache is per user, so rows of
    a previous program (or detached ones, program_exercise_id null) can
    linger until the refetch lands. */
function readLog(
  program: ProgramWithDetails,
  completions: ProgramExerciseCompletion[],
  setLogs: WorkoutSetLog[],
): LogView {
  const exIds = new Set(
    program.program_days.flatMap((d) => d.program_exercises.map((e) => e.id)),
  );
  const done = new Set<string>();
  const trainedOn = new Set<string>();
  for (const c of completions) {
    if (c.program_exercise_id == null || !exIds.has(c.program_exercise_id)) continue;
    done.add(`${c.program_exercise_id}:${c.week_number}`);
    // completed_at is a UTC timestamp; the day that counts is the phone's.
    trainedOn.add(toDateKey(new Date(c.completed_at)));
  }
  for (const s of setLogs) {
    if (s.program_exercise_id == null || !exIds.has(s.program_exercise_id)) continue;
    if (s.weight_kg == null && s.reps == null) continue;
    // Already a local date key (logSet stamps toDateKey()).
    trainedOn.add(s.date);
  }
  return { done, trainedOn };
}

/** The training to name for a week: the first day in day_index order (the
    home card's order) that still has an unchecked exercise. A day without
    exercises has nothing to check, so it never counts. null = nothing
    pending that week. */
function firstPending(
  program: ProgramWithDetails,
  log: LogView,
  week: number,
): ProgramDayWithExercises | null {
  const days = [...program.program_days].sort((a, b) => a.day_index - b.day_index);
  return (
    days.find((d) => d.program_exercises.some((e) => !log.done.has(`${e.id}:${week}`))) ??
    null
  );
}

/** Training day: each date of the window on one of the profile's weekdays
    whose program week still has a pending training. Today only while the
    hour is still ahead and nothing has been logged today. */
function planTraining(
  input: ReminderInput,
  program: ProgramWithDetails,
  log: LogView,
): PlannedReminder[] {
  const { availableDays, membership, prefs, now, labelOf } = input;
  if (!prefs.training) return [];
  // "Mon" … "Sun" → Monday-based index, the same mapping as the dashboard.
  const weekdays = new Set(
    (availableDays ?? []).map(dayNameToIndex).filter((i) => i >= 0),
  );
  if (weekdays.size === 0) return [];

  const today = toDateKey(now);
  const out: PlannedReminder[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const date = addDays(today, i);
    if (!weekdays.has(dowIndex(dateKeyToDate(date)))) continue;
    if (!dateAllowed(program, membership, date)) continue;
    const fireAt = atHour(date, prefs.hour);
    if (!isAhead(fireAt, now)) continue;
    if (date === today && log.trainedOn.has(today)) continue;
    const week = weekOfDate(program, date);
    const day = firstPending(program, log, week);
    if (day == null) continue;
    out.push({
      id: reminderId(date, "training"),
      fireAt,
      kind: "training",
      titleKey: "reminders.trainingTitle",
      bodyKey: "reminders.trainingBody",
      // `count` picks the plural form (trainingBody_one / _other).
      params: { label: labelOf(day), count: day.program_exercises.length, w: week },
    });
  }
  return out;
}

/** Soonest first; same instant → by id, so the order is deterministic. */
function sortPlan(list: PlannedReminder[]): PlannedReminder[] {
  return [...list].sort(
    (a, b) => a.fireAt.getTime() - b.fireAt.getTime() || a.id.localeCompare(b.id),
  );
}

/** Every reminder to schedule, soonest first. Empty without an active
    program. */
export function planReminders(input: ReminderInput): PlannedReminder[] {
  const { program } = input;
  if (program == null || program.status !== "active") return [];
  const log = readLog(program, input.completions, input.setLogs);
  return sortPlan(planTraining(input, program, log));
}
```

- [ ] **Step 5: Run the tests and watch them pass**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/reminders.test.ts
```

Expected: `ℹ tests 66`, `ℹ suites 6`, `ℹ pass 66`, `ℹ fail 0` (22 tests in each of the three zones). Node may print a `MODULE_TYPELESS_PACKAGE_JSON` warning; it is harmless.

- [ ] **Step 6: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint src/utils/reminders.ts src/utils/reminders.test.ts && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 97`, `ℹ suites 15`, `ℹ pass 97`, `ℹ fail 0` (the baseline 31 plus this task's 66);
- `tsc` and `eslint` print nothing;
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`, none of them in these files.

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/reminders.ts src/utils/reminders.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(reminders): plan training-day reminders (pure planner)" -m "src/utils/reminders.ts turns the active program, its log, the profile's training days, the membership and the reminder preferences into the local notifications for the next 14 days. No React, Expo or I/O; node:test in three time zones." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those two files.

---

### Task 2: Planner: inactivity, week opened and one reminder per date

**Files:**
- Modify: `src/utils/reminders.ts` (as Task 1 leaves it):
  - the `@/src/utils/program` import at line 9;
  - a new block above the doc comment of `sortPlan` at line 209;
  - the `return` of `planReminders` at line 222.
- Modify: `src/utils/reminders.test.ts` (append at the end)

**Interfaces:**
- Consumes:
  - Task 1's private helpers in `src/utils/reminders.ts`: `WINDOW_DAYS`, `reminderId`, `atHour`, `isAhead`, `weekOfDate`, `dateAllowed`, `LogView`/`readLog` (`trainedOn` holds the local dates with logged training), `firstPending`, `planTraining` and `sortPlan`.
  - Task 1's test helpers: `inEachZone`, `at`, `makeProgram`, `checks`, `setLog`, `prefs`, `plan`, `ids`, `byId`, `DAY_A`/`DAY_B`/`DAY_C`, `ALL_DAYS`, and the `ProgramExerciseCompletion` type import.
  - From the previous plan: `weekOpensOn(startDate, week)`, which is `start_date + 7·(week − 1)`, and `Program.lock_future_weeks`.
- Produces: the same public signatures. `planReminders` now also returns:
  - **Inactivity:**
    - `id`: `reminder-YYYY-MM-DD-inactivity`; `kind`: `"inactivity"`;
    - `titleKey`: `"reminders.inactivityTitle"`; `bodyKey`: `"reminders.inactivityBody"`;
    - `params`: `{ days: 4 | 7, label }`.
  - **Week opened:**
    - `id`: `reminder-YYYY-MM-DD-week`; `kind`: `"week"`;
    - `titleKey`: `"reminders.weekTitle"`; `bodyKey`: `"reminders.weekBody"`;
    - `params`: `{ w, label, count }`, from the first pending training of week w (`count` picks `weekBody_one` or `weekBody_other`).
  - **Merged**, when a week opens on a date that also has a training reminder:
    - `id`: `reminder-YYYY-MM-DD-week`; `kind`: `"week"`;
    - `titleKey`: `"reminders.weekTitle"`; `bodyKey`: `"reminders.trainingBody"`;
    - `params`: the training's `{ label, count, w }`.
    - No `-training` id is left for that date.
  - **One per date:** when an inactivity reminder falls on a date, it is that date's only reminder. The training, week-opened or merged reminder of that date is left out.

Rules implemented here (spec, "Inactivity", "Week opened" and "At most one reminder per date"):
- **Inactivity** (only with `prefs.inactivity`):
  - The base is the later of `start_date` and the last logged training date: a completion's local date, or a set log with a weight or reps, for the active program only. A log dated after today counts as today.
  - Reminders fire at base + 4 and base + 7 days, at `hour`:00. Each one fires only if all of these hold:
    - it is inside today … today + 13;
    - it is still ahead;
    - its date passes the general rules;
    - its date's week has a pending training.
  - Nothing comes after the 7-day one.
- **Week opened** (only with `prefs.weekOpened` and `program.lock_future_weeks`):
  - There is one reminder for each week w ≥ 2 whose `weekOpensOn(start_date, w)` falls in today … today + 13, at `hour`:00.
  - It fires only while still ahead, covered by the membership, and when week w has a pending training.
- **At most one reminder per date:**
  - An inactivity reminder wins its date, and the others that date are dropped.
  - Otherwise a week opening on a training date merges as above.
  - Every reminder lies in today … today + 13, so the plan never holds more than 14. This replaces the old bound of 18 (14 training + 2 week + 2 inactivity).

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/reminders.ts src/utils/reminders.test.ts
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.

- [ ] **Step 2: Write the failing tests**

Append this block to the end of `src/utils/reminders.test.ts`. It starts with a blank line, so one blank line separates it from the last `});`:

```ts

const INACTIVITY_ONLY = prefs({ training: false, inactivity: true });

inEachZone("planReminders: inactivity", () => {
  it("off by default", () => {
    assert.ok(plan().every((r) => r.kind !== "inactivity"));
  });

  it("start date + 4 and + 7 when nothing is logged", () => {
    const list = plan({ prefs: INACTIVITY_ONLY });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-09-inactivity",
      "reminder-2026-10-12-inactivity",
    ]);
    assert.equal(list[0].fireAt.getTime(), at("2026-10-09", 8).getTime());
    assert.equal(list[0].titleKey, "reminders.inactivityTitle");
    assert.equal(list[0].bodyKey, "reminders.inactivityBody");
    assert.deepEqual(list[0].params, { days: 4, label: "Pierna" });
    assert.deepEqual(list[1].params, { days: 7, label: "Pierna" });
  });

  it("counts from the last logged training, and a new log restarts it", () => {
    const completions = checks(["a1"], 1, at("2026-10-06", 6));
    assert.deepEqual(ids(plan({ prefs: INACTIVITY_ONLY, completions })), [
      "reminder-2026-10-10-inactivity",
      "reminder-2026-10-13-inactivity",
    ]);

    const later = plan({
      prefs: INACTIVITY_ONLY,
      now: at("2026-10-08", 20),
      completions,
      setLogs: [setLog("b1", 1, "2026-10-08", { weight_kg: 50, reps: 10 })],
    });
    assert.deepEqual(ids(later), [
      "reminder-2026-10-12-inactivity",
      "reminder-2026-10-15-inactivity",
    ]);
  });

  it("a check late in the evening counts on the phone's date", () => {
    // 23:30 on 10-06 is 10-07 in UTC west of Greenwich; the base is still 10-06.
    const list = plan({
      prefs: INACTIVITY_ONLY,
      completions: checks(["a1"], 1, at("2026-10-06", 23, 30)),
    });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-10-inactivity",
      "reminder-2026-10-13-inactivity",
    ]);
  });

  it("a log dated after today counts as today", () => {
    // A wrong clock on this or another phone: the count starts today, it isn't lost.
    const futureCheck = plan({
      prefs: INACTIVITY_ONLY,
      completions: checks(["a1"], 1, at("2026-12-01", 9)),
    });
    const futureSet = plan({
      prefs: INACTIVITY_ONLY,
      setLogs: [setLog("a1", 1, "2026-10-20", { reps: 8 })],
    });
    for (const list of [futureCheck, futureSet]) {
      assert.deepEqual(ids(list), [
        "reminder-2026-10-10-inactivity",
        "reminder-2026-10-13-inactivity",
      ]);
    }
  });

  it("the base is never before the start date", () => {
    // Checked on 10-01, before the 10-05 start (possible with the lock off).
    const list = plan({
      prefs: INACTIVITY_ONLY,
      completions: checks(["a1"], 1, at("2026-10-01", 18)),
    });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-09-inactivity",
      "reminder-2026-10-12-inactivity",
    ]);
  });

  it("only the ones still ahead, and nothing after the 7-day one", () => {
    // Started Wed 09-30, nothing logged: + 4 (10-04) has passed, + 7 is 10-07.
    const list = plan({
      prefs: INACTIVITY_ONLY,
      program: makeProgram({ start_date: "2026-09-30" }),
    });
    assert.deepEqual(ids(list), ["reminder-2026-10-07-inactivity"]);
  });

  it("only inside the 14-day window", () => {
    // Starts Mon 10-12: + 4 (10-16) and + 7 (10-19) are inside 10-06 … 10-19.
    const inside = plan({
      prefs: INACTIVITY_ONLY,
      program: makeProgram({ start_date: "2026-10-12" }),
    });
    assert.deepEqual(ids(inside), [
      "reminder-2026-10-16-inactivity",
      "reminder-2026-10-19-inactivity",
    ]);
    // Starts Fri 10-16: + 4 is 10-20, past the window; a later rebuild adds them.
    const outside = plan({
      prefs: INACTIVITY_ONLY,
      program: makeProgram({ start_date: "2026-10-16" }),
    });
    assert.deepEqual(outside, []);
  });

  it("not while that date's week has nothing pending", () => {
    // Week 1 (10-05 … 10-11) all done on 10-06: + 4 is 10-10, still week 1.
    const list = plan({
      prefs: INACTIVITY_ONLY,
      completions: checks([...DAY_A, ...DAY_B, ...DAY_C], 1, at("2026-10-06", 6)),
    });
    assert.deepEqual(ids(list), ["reminder-2026-10-13-inactivity"]);
    assert.deepEqual(list[0].params, { days: 7, label: "Pierna" });
  });

  it("program dates and membership apply", () => {
    // A 1-week program ends Sun 10-11, so + 7 (10-12) is after its last day.
    const short = plan({ prefs: INACTIVITY_ONLY, program: makeProgram({ duration_weeks: 1 }) });
    assert.deepEqual(ids(short), ["reminder-2026-10-09-inactivity"]);

    const expiring = plan({
      prefs: INACTIVITY_ONLY,
      membership: { status: "active", expires_at: "2026-10-10" },
    });
    assert.deepEqual(ids(expiring), ["reminder-2026-10-09-inactivity"]);
  });
});

const WEEK_ONLY = prefs({ training: false, weekOpened: true });
const LOCKED = makeProgram({ lock_future_weeks: true });

inEachZone("planReminders: week opened", () => {
  it("only with 'Solo semana actual' on and the preference on", () => {
    assert.deepEqual(plan({ prefs: WEEK_ONLY }), []);
    assert.ok(plan({ program: LOCKED }).every((r) => r.kind !== "week"));
  });

  it("weeks 2+ opening in the window, at the reminder hour", () => {
    const list = plan({ prefs: WEEK_ONLY, program: LOCKED });
    // Week 4 opens 10-26, past the window's last day (10-19).
    assert.deepEqual(ids(list), ["reminder-2026-10-12-week", "reminder-2026-10-19-week"]);
    assert.equal(list[0].fireAt.getTime(), at("2026-10-12", 8).getTime());
    assert.equal(list[0].titleKey, "reminders.weekTitle");
    assert.equal(list[0].bodyKey, "reminders.weekBody");
    assert.deepEqual(list[0].params, { w: 2, label: "Pierna", count: 3 });
    assert.deepEqual(list[1].params, { w: 3, label: "Pierna", count: 3 });
  });

  it("never for week 1", () => {
    // Starts Wed 10-07, inside the window: week 1 opens with the program itself.
    const list = plan({
      prefs: WEEK_ONLY,
      program: makeProgram({ lock_future_weeks: true, start_date: "2026-10-07" }),
    });
    assert.deepEqual(ids(list), ["reminder-2026-10-14-week"]);
  });

  it("today's only while the hour is still ahead", () => {
    assert.equal(
      plan({ prefs: WEEK_ONLY, program: LOCKED, now: at("2026-10-12", 7) })[0].id,
      "reminder-2026-10-12-week",
    );
    assert.equal(
      plan({ prefs: WEEK_ONLY, program: LOCKED, now: at("2026-10-12", 9) })[0].id,
      "reminder-2026-10-19-week",
    );
  });

  it("skipped when that week has nothing pending or the membership ends first", () => {
    // Week 2 already fully checked (the lock was switched on after the checks).
    const done = plan({
      prefs: WEEK_ONLY,
      program: LOCKED,
      completions: checks([...DAY_A, ...DAY_B, ...DAY_C], 2, at("2026-10-05", 18)),
    });
    assert.deepEqual(ids(done), ["reminder-2026-10-19-week"]);

    const expiring = plan({
      prefs: WEEK_ONLY,
      program: LOCKED,
      membership: { status: "active", expires_at: "2026-10-15" },
    });
    assert.deepEqual(ids(expiring), ["reminder-2026-10-12-week"]);
  });

  it("merged with a training reminder on the same date", () => {
    // Mon 10-12 and Mon 10-19 are both training days and week-opening days.
    const list = plan({ prefs: prefs({ weekOpened: true }), program: LOCKED });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-07-training",
      "reminder-2026-10-09-training",
      "reminder-2026-10-12-week",
      "reminder-2026-10-14-training",
      "reminder-2026-10-16-training",
      "reminder-2026-10-19-week",
    ]);
    const merged = byId(list, "reminder-2026-10-12-week")!;
    assert.equal(merged.kind, "week");
    assert.equal(merged.titleKey, "reminders.weekTitle");
    assert.equal(merged.bodyKey, "reminders.trainingBody");
    assert.deepEqual(merged.params, { label: "Pierna", count: 3, w: 2 });
    assert.equal(merged.fireAt.getTime(), at("2026-10-12", 8).getTime());
  });
});

inEachZone("planReminders: one per date", () => {
  it("an inactivity reminder replaces that date's training reminder", () => {
    // Nothing logged: + 4 is Fri 10-09 and + 7 is Mon 10-12, both training days.
    const list = plan({ prefs: prefs({ inactivity: true }) });
    assert.deepEqual(ids(list), [
      "reminder-2026-10-07-training",
      "reminder-2026-10-09-inactivity",
      "reminder-2026-10-12-inactivity",
      "reminder-2026-10-14-training",
      "reminder-2026-10-16-training",
      "reminder-2026-10-19-training",
    ]);
    assert.deepEqual(byId(list, "reminder-2026-10-09-inactivity")!.params, {
      days: 4,
      label: "Pierna",
    });
  });

  it("and the week-opened one, merged with a training reminder or not", () => {
    // Mon 10-12 opens week 2 and is + 7: the inactivity reminder wins it.
    // Mon 10-19 opens week 3 and stays merged with its training reminder.
    const merged = plan({ prefs: prefs({ inactivity: true, weekOpened: true }), program: LOCKED });
    assert.deepEqual(ids(merged), [
      "reminder-2026-10-07-training",
      "reminder-2026-10-09-inactivity",
      "reminder-2026-10-12-inactivity",
      "reminder-2026-10-14-training",
      "reminder-2026-10-16-training",
      "reminder-2026-10-19-week",
    ]);
    assert.equal(byId(merged, "reminder-2026-10-19-week")!.bodyKey, "reminders.trainingBody");

    const alone = plan({
      prefs: prefs({ training: false, inactivity: true, weekOpened: true }),
      program: LOCKED,
    });
    assert.deepEqual(ids(alone), [
      "reminder-2026-10-09-inactivity",
      "reminder-2026-10-12-inactivity",
      "reminder-2026-10-19-week",
    ]);
  });
});

/** A Date's local calendar day, "YYYY-MM-DD". */
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

inEachZone("planReminders: everything on", () => {
  it("at most one reminder per date, all ahead, with unique reminder- ids", () => {
    const everything = prefs({ inactivity: true, weekOpened: true });
    const logs: ProgramExerciseCompletion[][] = [
      [],
      checks([...DAY_A, ...DAY_B], 1, at("2026-10-06", 6)),
    ];
    // Every day from 09-25 (before the start) to 11-06 (after the end).
    for (let i = 0; i <= 42; i++) {
      for (const hour of [0, 7, 8, 23]) {
        const now = new Date(2026, 8, 25 + i, hour);
        for (const completions of logs) {
          const list = plan({
            program: LOCKED,
            availableDays: ALL_DAYS,
            prefs: everything,
            completions,
            now,
          });
          const label = now.toString();
          const dates = list.map((r) => dayKey(r.fireAt));
          assert.equal(new Set(dates).size, list.length, `${label}: ${dates.join(" ")}`);
          assert.ok(list.length <= 14, `${label}: ${list.length}`);
          assert.ok(list.every((r) => r.id === `reminder-${dayKey(r.fireAt)}-${r.kind}`), label);
          assert.ok(list.every((r) => r.fireAt.getTime() > now.getTime()), label);
        }
      }
    }
    // 10-06 07:00: one reminder on each of the 14 days. Inactivity takes
    // 10-09 and 10-12 (week 2 opens there too); 10-19 is week 3's opening
    // merged with its training reminder.
    const full = plan({ program: LOCKED, availableDays: ALL_DAYS, prefs: everything });
    assert.equal(full.length, 14);
    assert.deepEqual(
      full.filter((r) => r.kind !== "training").map((r) => r.id),
      [
        "reminder-2026-10-09-inactivity",
        "reminder-2026-10-12-inactivity",
        "reminder-2026-10-19-week",
      ],
    );
  });
});
```

- [ ] **Step 3: Run the tests and watch the new ones fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/reminders.test.ts
```

Expected: `ℹ tests 123`, `ℹ suites 18`, `ℹ pass 72`, `ℹ fail 51`. That is 17 failures in each zone:
- every `planReminders: inactivity` test except "off by default";
- every `planReminders: week opened` test except "only with 'Solo semana actual' on and the preference on";
- both `planReminders: one per date` tests;
- the `everything on` test: its sweep passes, since training reminders alone are already one per date, but its final list has no inactivity or week reminder.

- [ ] **Step 4: Import `weekOpensOn`**

In `src/utils/reminders.ts`, line 9, replace:

```ts
import { currentWeekOf, isAfterEnd, isBeforeStart } from "@/src/utils/program";
```

with:

```ts
import { currentWeekOf, isAfterEnd, isBeforeStart, weekOpensOn } from "@/src/utils/program";
```

- [ ] **Step 5: Add the inactivity and week-opened planners and the one-per-date rule**

In `src/utils/reminders.ts`, replace the doc comment of `sortPlan` (line 209):

```ts
/** Soonest first; same instant → by id, so the order is deterministic. */
```

with the three new functions followed by that same comment:

```ts
/** Inactivity reminders fire this many days after the base date. */
const INACTIVITY_DAYS = [4, 7] as const;

/** Inactivity: base + 4 and base + 7 days, where the base is the later of
    the last logged training and the start date, so any new log restarts the
    count. A log dated after today (a phone with a wrong clock, another
    device) counts as today. Each fires only inside the 14-day window, while
    still ahead, on an allowed date, and while that date's week has a pending
    training — a client who finished the week and waits for a locked one to
    open isn't nudged. Nothing comes after the 7-day one. */
function planInactivity(
  input: ReminderInput,
  program: ProgramWithDetails,
  log: LogView,
): PlannedReminder[] {
  const { membership, prefs, now, labelOf } = input;
  if (!prefs.inactivity) return [];
  const today = toDateKey(now);
  const lastDay = addDays(today, WINDOW_DAYS - 1);
  let base = program.start_date;
  for (const logged of log.trainedOn) {
    const date = logged > today ? today : logged;
    if (date > base) base = date;
  }

  const out: PlannedReminder[] = [];
  for (const days of INACTIVITY_DAYS) {
    const date = addDays(base, days);
    if (date > lastDay) continue;
    const fireAt = atHour(date, prefs.hour);
    if (!isAhead(fireAt, now)) continue;
    if (!dateAllowed(program, membership, date)) continue;
    const day = firstPending(program, log, weekOfDate(program, date));
    if (day == null) continue;
    out.push({
      id: reminderId(date, "inactivity"),
      fireAt,
      kind: "inactivity",
      titleKey: "reminders.inactivityTitle",
      bodyKey: "reminders.inactivityBody",
      params: { days, label: labelOf(day) },
    });
  }
  return out;
}

/** Week opened: "Solo semana actual" programs only. Each week from 2 on
    whose opening day (weekOpensOn) is in the window, naming that week's
    first pending training. Week 1 opens with the program itself. */
function planWeekOpened(
  input: ReminderInput,
  program: ProgramWithDetails,
  log: LogView,
): PlannedReminder[] {
  const { membership, prefs, now, labelOf } = input;
  if (!prefs.weekOpened || !program.lock_future_weeks) return [];
  const today = toDateKey(now);
  const lastDay = addDays(today, WINDOW_DAYS - 1);

  const out: PlannedReminder[] = [];
  for (let w = 2; w <= program.duration_weeks; w++) {
    const date = weekOpensOn(program.start_date, w);
    if (date < today || date > lastDay) continue;
    if (!dateAllowed(program, membership, date)) continue;
    const fireAt = atHour(date, prefs.hour);
    if (!isAhead(fireAt, now)) continue;
    const day = firstPending(program, log, w);
    if (day == null) continue;
    out.push({
      id: reminderId(date, "week"),
      fireAt,
      kind: "week",
      titleKey: "reminders.weekTitle",
      bodyKey: "reminders.weekBody",
      // `count` picks the plural form (weekBody_one / _other).
      params: { w, label: labelOf(day), count: day.program_exercises.length },
    });
  }
  return out;
}

/** At most one reminder per local date (spec). An inactivity reminder wins
    its date: the client hasn't trained in days, which says more than the
    day's training, so that date's training or week-opened reminder is
    dropped. Otherwise a week opening on a training date becomes ONE
    notification: the week-opened title (and its "week" id) over the training
    body. Both name the same training — the date's week is the week that
    opens. */
function onePerDate(
  training: PlannedReminder[],
  weekOpened: PlannedReminder[],
  inactivity: PlannedReminder[],
): PlannedReminder[] {
  const byDate = new Map<string, PlannedReminder>();
  for (const r of training) byDate.set(toDateKey(r.fireAt), r);
  for (const week of weekOpened) {
    const date = toDateKey(week.fireAt);
    const day = byDate.get(date);
    byDate.set(
      date,
      day == null ? week : { ...day, id: week.id, kind: "week", titleKey: week.titleKey },
    );
  }
  for (const r of inactivity) byDate.set(toDateKey(r.fireAt), r);
  return [...byDate.values()];
}

/** Soonest first; same instant → by id, so the order is deterministic. */
```

- [ ] **Step 6: Wire them into `planReminders`**

In `src/utils/reminders.ts`, inside `planReminders` (line 222), replace:

```ts
  return sortPlan(planTraining(input, program, log));
```

with:

```ts
  return sortPlan(
    onePerDate(
      planTraining(input, program, log),
      planWeekOpened(input, program, log),
      planInactivity(input, program, log),
    ),
  );
```

- [ ] **Step 7: Run the tests and watch them pass**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/reminders.test.ts
```

Expected: `ℹ tests 123`, `ℹ suites 18`, `ℹ pass 123`, `ℹ fail 0`.

- [ ] **Step 8: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint src/utils/reminders.ts src/utils/reminders.test.ts && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 154`, `ℹ suites 27`, `ℹ pass 154`, `ℹ fail 0`;
- `tsc` and `eslint` print nothing;
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`.

- [ ] **Step 9: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/reminders.ts src/utils/reminders.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(reminders): plan inactivity and week-opened reminders, one per date" -m "Inactivity fires 4 and 7 days after the later of the last logged training and the start date, inside the 14-day window and only while that week has a pending training. Week opened (Solo semana actual programs) fires on weekOpensOn for weeks 2+." -m "At most one reminder per date: an inactivity reminder replaces that date's training or week-opened one; otherwise a week opening on a training date merges into one notification. So at most 14." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those two files.

---

### Task 3: Preferences store and notification permission

**Files:**
- Create: `src/utils/reminder-prefs.ts` (pure: parse and patch the stored prefs, and the hour range)
- Test: `src/utils/reminder-prefs.test.ts`
- Create: `src/utils/notification-permission.ts` (pure: the phone's answer mapped to a status)
- Test: `src/utils/notification-permission.test.ts`
- Create: `src/lib/reminder-prefs.ts` (the AsyncStorage store, same pattern as `src/lib/alert-mode.ts`)
- Create: `src/lib/notification-permission.ts`

**Interfaces:**
- Consumes:
  - `ReminderPrefs` and `DEFAULT_REMINDER_PREFS` from `src/utils/reminders.ts` (Task 1);
  - from expo-notifications 57.0.21: `getPermissionsAsync()`, `requestPermissionsAsync()`, and `NotificationPermissionsStatus` (`granted`, `canAskAgain`, `ios?.status`, where `IosAuthorizationStatus.PROVISIONAL = 3`).
- Produces:
  - `src/utils/reminder-prefs.ts`:
    - `REMINDER_HOUR_MIN = 5`, `REMINDER_HOUR_MAX = 22`, and `REMINDER_HOURS: number[]` (5 … 22), for the Ajustes picker;
    - `parseReminderPrefs(raw: string | null): ReminderPrefs`;
    - `applyReminderPrefsPatch(current: ReminderPrefs, patch: Partial<ReminderPrefs>): ReminderPrefs`;
    - `sameReminderPrefs(a: ReminderPrefs, b: ReminderPrefs): boolean`.
  - `src/utils/notification-permission.ts`:
    - `type PermissionStatus = "granted" | "undetermined" | "denied"`;
    - `type PermissionRead = { granted: boolean; canAskAgain: boolean; ios?: { status: number } | null }`;
    - `IOS_PROVISIONAL = 3`;
    - `toPermissionStatus(p: PermissionRead): PermissionStatus`;
    - `readPermissionStatus(read: () => Promise<PermissionRead>): Promise<PermissionStatus>`;
    - `requestPermissionStatus(read: () => Promise<PermissionRead>, request: () => Promise<PermissionRead>): Promise<PermissionStatus>`.
  - `src/lib/reminder-prefs.ts` (AsyncStorage key `"app_reminder_prefs"`):
    - `getReminderPrefs(): ReminderPrefs`;
    - `useReminderPrefs(): ReminderPrefs`;
    - `setReminderPrefs(patch: Partial<ReminderPrefs>): Promise<void>`;
    - `reminderPrefsReady(): boolean` and `useReminderPrefsReady(): boolean`, which are false until the stored value has been read.
  - `src/lib/notification-permission.ts`:
    - `type PermissionStatus`, re-exported;
    - `getPermissionStatus(): Promise<PermissionStatus>`;
    - `requestPermission(): Promise<PermissionStatus>`, which only prompts while the status is `undetermined` and then makes every `usePermissionStatus` re-read;
    - `openNotificationSettings(): Promise<void>` (`Linking.openSettings()`);
    - `usePermissionStatus(): { status: PermissionStatus | null; refresh: () => void }`, which is `null` until the first read and re-reads on AppState `active`.
    - On web every function is a no-op and the status is always `"denied"`.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/reminder-prefs.ts src/utils/reminder-prefs.test.ts src/utils/notification-permission.ts src/utils/notification-permission.test.ts src/lib/reminder-prefs.ts src/lib/notification-permission.ts
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`. Read `src/lib/alert-mode.ts`, the pattern the store follows.

- [ ] **Step 2: Write the failing preferences test**

Create `src/utils/reminder-prefs.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyReminderPrefsPatch,
  parseReminderPrefs,
  REMINDER_HOURS,
  sameReminderPrefs,
} from "@/src/utils/reminder-prefs";
import { DEFAULT_REMINDER_PREFS } from "@/src/utils/reminders";

describe("parseReminderPrefs", () => {
  it("nothing stored gives the defaults", () => {
    assert.deepEqual(parseReminderPrefs(null), {
      training: true,
      inactivity: false,
      weekOpened: false,
      hour: 8,
    });
  });

  it("unreadable JSON gives the defaults", () => {
    assert.deepEqual(parseReminderPrefs("{not json"), DEFAULT_REMINDER_PREFS);
    assert.deepEqual(parseReminderPrefs(""), DEFAULT_REMINDER_PREFS);
  });

  it("JSON that is not an object gives the defaults", () => {
    assert.deepEqual(parseReminderPrefs("null"), DEFAULT_REMINDER_PREFS);
    assert.deepEqual(parseReminderPrefs("42"), DEFAULT_REMINDER_PREFS);
    assert.deepEqual(parseReminderPrefs('"on"'), DEFAULT_REMINDER_PREFS);
  });

  it("a saved value round-trips", () => {
    const saved = { training: false, inactivity: true, weekOpened: true, hour: 19 };
    assert.deepEqual(parseReminderPrefs(JSON.stringify(saved)), saved);
  });

  it("missing fields keep their defaults", () => {
    assert.deepEqual(parseReminderPrefs('{"inactivity":true}'), {
      ...DEFAULT_REMINDER_PREFS,
      inactivity: true,
    });
  });

  it("fields of the wrong type keep their defaults", () => {
    assert.deepEqual(
      parseReminderPrefs('{"training":"no","weekOpened":1,"hour":"9","inactivity":true}'),
      { ...DEFAULT_REMINDER_PREFS, inactivity: true },
    );
  });

  it("an hour outside 5..22 or not whole keeps the default", () => {
    for (const hour of [4, 23, 8.5, -1, null]) {
      assert.equal(parseReminderPrefs(JSON.stringify({ hour })).hour, 8, `hour ${hour}`);
    }
    assert.equal(parseReminderPrefs('{"hour":5}').hour, 5);
    assert.equal(parseReminderPrefs('{"hour":22}').hour, 22);
  });
});

describe("applyReminderPrefsPatch", () => {
  it("applies the patched fields only", () => {
    assert.deepEqual(applyReminderPrefsPatch(DEFAULT_REMINDER_PREFS, { hour: 21 }), {
      ...DEFAULT_REMINDER_PREFS,
      hour: 21,
    });
    assert.deepEqual(
      applyReminderPrefsPatch(DEFAULT_REMINDER_PREFS, { training: false, weekOpened: true }),
      { ...DEFAULT_REMINDER_PREFS, training: false, weekOpened: true },
    );
  });

  it("ignores invalid values", () => {
    const current = { training: false, inactivity: true, weekOpened: false, hour: 7 };
    assert.deepEqual(applyReminderPrefsPatch(current, { hour: 30 }), current);
    assert.deepEqual(applyReminderPrefsPatch(current, { hour: undefined }), current);
    assert.deepEqual(applyReminderPrefsPatch(current, {}), current);
  });
});

describe("sameReminderPrefs", () => {
  it("compares every field", () => {
    assert.equal(sameReminderPrefs(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS }), true);
    assert.equal(sameReminderPrefs(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS, hour: 9 }), false);
    assert.equal(
      sameReminderPrefs(DEFAULT_REMINDER_PREFS, { ...DEFAULT_REMINDER_PREFS, weekOpened: true }),
      false,
    );
  });
});

describe("REMINDER_HOURS", () => {
  it("is every whole hour from 5 to 22", () => {
    assert.equal(REMINDER_HOURS.length, 18);
    assert.equal(REMINDER_HOURS[0], 5);
    assert.equal(REMINDER_HOURS[REMINDER_HOURS.length - 1], 22);
    assert.ok(REMINDER_HOURS.includes(DEFAULT_REMINDER_PREFS.hour));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/reminder-prefs.test.ts
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …\src\utils\reminder-prefs.test.ts`, then `ℹ tests 1`, `ℹ pass 0`, `ℹ fail 1`.

- [ ] **Step 4: Write the pure preference helpers**

Create `src/utils/reminder-prefs.ts`:

```ts
import { DEFAULT_REMINDER_PREFS, type ReminderPrefs } from "@/src/utils/reminders";

// The pure half of the reminder preferences store (src/lib/reminder-prefs.ts):
// reading back what AsyncStorage holds and applying a change. No React, no
// storage, so `npm test` can run it.

/** The reminder hour picker in Ajustes: whole hours from 5:00 to 22:00. */
export const REMINDER_HOUR_MIN = 5;
export const REMINDER_HOUR_MAX = 22;
export const REMINDER_HOURS: number[] = Array.from(
  { length: REMINDER_HOUR_MAX - REMINDER_HOUR_MIN + 1 },
  (_, i) => REMINDER_HOUR_MIN + i,
);

function isReminderHour(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= REMINDER_HOUR_MIN &&
    value <= REMINDER_HOUR_MAX
  );
}

/** `value`'s valid fields over `base`. Field by field, so one bad or missing
    field (an older or newer app version wrote it) keeps the others. */
function mergeValid(base: ReminderPrefs, value: unknown): ReminderPrefs {
  if (value == null || typeof value !== "object") return base;
  const v = value as Record<string, unknown>;
  return {
    training: typeof v.training === "boolean" ? v.training : base.training,
    inactivity: typeof v.inactivity === "boolean" ? v.inactivity : base.inactivity,
    weekOpened: typeof v.weekOpened === "boolean" ? v.weekOpened : base.weekOpened,
    hour: isReminderHour(v.hour) ? v.hour : base.hour,
  };
}

/** The stored JSON → prefs. Nothing stored, unreadable JSON or an invalid
    field falls back to the defaults. */
export function parseReminderPrefs(raw: string | null): ReminderPrefs {
  if (raw == null) return DEFAULT_REMINDER_PREFS;
  try {
    return mergeValid(DEFAULT_REMINDER_PREFS, JSON.parse(raw));
  } catch {
    return DEFAULT_REMINDER_PREFS;
  }
}

/** `current` with the patch's valid fields applied; invalid ones are ignored. */
export function applyReminderPrefsPatch(
  current: ReminderPrefs,
  patch: Partial<ReminderPrefs>,
): ReminderPrefs {
  return mergeValid(current, patch);
}

export function sameReminderPrefs(a: ReminderPrefs, b: ReminderPrefs): boolean {
  return (
    a.training === b.training &&
    a.inactivity === b.inactivity &&
    a.weekOpened === b.weekOpened &&
    a.hour === b.hour
  );
}
```

- [ ] **Step 5: Run it and watch it pass**

Run the same command as Step 3. Expected: `ℹ tests 11`, `ℹ suites 4`, `ℹ pass 11`, `ℹ fail 0`.

- [ ] **Step 6: Write the failing permission test**

Create `src/utils/notification-permission.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  type PermissionRead,
  readPermissionStatus,
  requestPermissionStatus,
  toPermissionStatus,
} from "@/src/utils/notification-permission";

// What getPermissionsAsync reports on each phone state (granted, canAskAgain,
// and on iOS the authorization status: 0 not asked, 1 denied, 2 authorized,
// 3 provisional).
const ANDROID_12_DEFAULT: PermissionRead = { granted: true, canAskAgain: true };
const ANDROID_13_NOT_ASKED: PermissionRead = { granted: false, canAskAgain: true };
const ANDROID_13_ONE_NO: PermissionRead = { granted: false, canAskAgain: true };
const ANDROID_13_TWO_NOS: PermissionRead = { granted: false, canAskAgain: false };
const IOS_NOT_ASKED: PermissionRead = { granted: false, canAskAgain: true, ios: { status: 0 } };
const IOS_DENIED: PermissionRead = { granted: false, canAskAgain: false, ios: { status: 1 } };
const IOS_ALLOWED: PermissionRead = { granted: true, canAskAgain: true, ios: { status: 2 } };
const IOS_PROVISIONAL_READ: PermissionRead = {
  granted: false,
  canAskAgain: true,
  ios: { status: 3 },
};

const fails = () => Promise.reject(new Error("unavailable"));

describe("toPermissionStatus", () => {
  it("granted: allowed, Android 12 and older by default, or iOS provisional", () => {
    assert.equal(toPermissionStatus(ANDROID_12_DEFAULT), "granted");
    assert.equal(toPermissionStatus(IOS_ALLOWED), "granted");
    assert.equal(toPermissionStatus(IOS_PROVISIONAL_READ), "granted");
  });

  it("undetermined while the phone can still prompt, even after a first no", () => {
    assert.equal(toPermissionStatus(ANDROID_13_NOT_ASKED), "undetermined");
    assert.equal(toPermissionStatus(ANDROID_13_ONE_NO), "undetermined");
    assert.equal(toPermissionStatus(IOS_NOT_ASKED), "undetermined");
  });

  it("denied once only the phone's settings can turn it on", () => {
    assert.equal(toPermissionStatus(ANDROID_13_TWO_NOS), "denied");
    assert.equal(toPermissionStatus(IOS_DENIED), "denied");
  });
});

describe("readPermissionStatus", () => {
  it("maps what the phone reports", async () => {
    assert.equal(await readPermissionStatus(async () => IOS_PROVISIONAL_READ), "granted");
    assert.equal(await readPermissionStatus(async () => ANDROID_13_ONE_NO), "undetermined");
  });

  it("a read that throws counts as denied", async () => {
    assert.equal(await readPermissionStatus(fails), "denied");
  });
});

describe("requestPermissionStatus", () => {
  it("never prompts when already granted or denied", async () => {
    let prompts = 0;
    const request = async () => {
      prompts++;
      return IOS_ALLOWED;
    };
    assert.equal(await requestPermissionStatus(async () => ANDROID_12_DEFAULT, request), "granted");
    assert.equal(await requestPermissionStatus(async () => IOS_DENIED, request), "denied");
    assert.equal(prompts, 0);
  });

  it("prompts while it still can, and returns the answer", async () => {
    let prompts = 0;
    const allow = async () => {
      prompts++;
      return IOS_ALLOWED;
    };
    const refuse = async () => {
      prompts++;
      return ANDROID_13_ONE_NO;
    };
    assert.equal(await requestPermissionStatus(async () => IOS_NOT_ASKED, allow), "granted");
    assert.equal(await requestPermissionStatus(async () => ANDROID_13_NOT_ASKED, refuse), "undetermined");
    assert.equal(prompts, 2);
  });

  it("a read or a prompt that throws counts as denied", async () => {
    assert.equal(await requestPermissionStatus(fails, async () => IOS_ALLOWED), "denied");
    assert.equal(await requestPermissionStatus(async () => IOS_NOT_ASKED, fails), "denied");
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/notification-permission.test.ts
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …\src\utils\notification-permission.test.ts`, then `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 8: Write the pure permission mapping**

Create `src/utils/notification-permission.ts`:

```ts
// The pure half of the notification permission (src/lib/notification-permission.ts):
// how the phone's answer maps to what the reminders UI can do about it. No
// Expo, so `npm test` runs it.

/**
 * Three states, named for what the UI can do about them:
 *   granted       reminders can be scheduled;
 *   undetermined  the phone's prompt can still be shown (never asked, or
 *                 Android 13+ after a first "no", where it asks once more);
 *   denied        the phone won't prompt again: only its settings can turn
 *                 notifications on.
 */
export type PermissionStatus = "granted" | "undetermined" | "denied";

/** The fields of expo-notifications' NotificationPermissionsStatus read here. */
export type PermissionRead = {
  granted: boolean;
  canAskAgain: boolean;
  ios?: { status: number } | null;
};

/** iOS provisional authorization (expo-notifications'
    IosAuthorizationStatus.PROVISIONAL): delivered quietly to Notification
    Center, so reminders still arrive. */
export const IOS_PROVISIONAL = 3;

export function toPermissionStatus(p: PermissionRead): PermissionStatus {
  if (p.granted || p.ios?.status === IOS_PROVISIONAL) return "granted";
  return p.canAskAgain ? "undetermined" : "denied";
}

/** `read()`'s answer as a status. A read that fails counts as denied: no
    reminders, and no prompt the phone might refuse to show. */
export async function readPermissionStatus(
  read: () => Promise<PermissionRead>,
): Promise<PermissionStatus> {
  try {
    return toPermissionStatus(await read());
  } catch {
    return "denied";
  }
}

/** Shows the phone's prompt (`request`) only while it can still be shown, and
    returns the outcome. Never prompts when already granted or denied. */
export async function requestPermissionStatus(
  read: () => Promise<PermissionRead>,
  request: () => Promise<PermissionRead>,
): Promise<PermissionStatus> {
  try {
    const current = toPermissionStatus(await read());
    if (current !== "undetermined") return current;
    return toPermissionStatus(await request());
  } catch {
    return "denied";
  }
}
```

- [ ] **Step 9: Run it and watch it pass**

Run the same command as Step 7. Expected: `ℹ tests 8`, `ℹ suites 3`, `ℹ pass 8`, `ℹ fail 0`.

- [ ] **Step 10: Write the preferences store**

Create `src/lib/reminder-prefs.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

import {
  applyReminderPrefsPatch,
  parseReminderPrefs,
  sameReminderPrefs,
} from "@/src/utils/reminder-prefs";
import { DEFAULT_REMINDER_PREFS, type ReminderPrefs } from "@/src/utils/reminders";

// Which local reminders this phone schedules, and at what hour (Ajustes →
// Notificaciones). A per-device choice, like the rest-alert mode: the phone
// schedules the reminders, so the phone keeps the choice. Kept across
// sign-outs for the same reason.

const PREFS_KEY = "app_reminder_prefs";

let prefs: ReminderPrefs = DEFAULT_REMINDER_PREFS;
/** Set by the first change, so a slow restore can't undo it. */
let changed = false;
/** The stored choice has been read (or there was none, or it couldn't be
    read). Until then `prefs` are only the defaults, and a plan built from
    them could schedule 8:00 reminders the client turned off. */
let ready = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

// Restore once at module load; the defaults until it resolves.
void AsyncStorage.getItem(PREFS_KEY)
  .then((stored) => {
    if (changed || stored == null) return;
    const restored = parseReminderPrefs(stored);
    if (!sameReminderPrefs(prefs, restored)) prefs = restored;
  })
  .catch(() => {})
  .finally(() => {
    ready = true;
    emit();
  });

export function getReminderPrefs(): ReminderPrefs {
  return prefs;
}

/** True once the stored preferences have been read (see `ready`). */
export function reminderPrefsReady(): boolean {
  return ready;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useReminderPrefs(): ReminderPrefs {
  return useSyncExternalStore(subscribe, getReminderPrefs, getReminderPrefs);
}

export function useReminderPrefsReady(): boolean {
  return useSyncExternalStore(subscribe, reminderPrefsReady, reminderPrefsReady);
}

/** Merge, apply, persist. Invalid values in the patch are ignored. */
export async function setReminderPrefs(patch: Partial<ReminderPrefs>): Promise<void> {
  changed = true;
  const next = applyReminderPrefsPatch(prefs, patch);
  if (!sameReminderPrefs(prefs, next)) {
    prefs = next;
    emit();
  }
  try {
    await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
    // Non-fatal: the choice still applies for this session
  }
}
```

- [ ] **Step 11: Write the permission module**

Create `src/lib/notification-permission.ts`:

```ts
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

import {
  type PermissionStatus,
  readPermissionStatus,
  requestPermissionStatus,
} from "@/src/utils/notification-permission";

export type { PermissionStatus };

// Notification permission for the local reminders (onboarding's last step and
// Ajustes → Notificaciones). The rest timer still asks on its own the first
// time a rest starts (src/lib/rest-alert.ts), for clients who skipped. What
// each status means, and how the phone's answer maps to it, is in
// src/utils/notification-permission.ts.
// Web has no local notifications: there everything reads "denied" and nothing
// prompts or opens.

const isWeb = Platform.OS === "web";

/** Every mounted usePermissionStatus re-reads when this fires. */
const listeners = new Set<() => void>();

function permissionChanged() {
  listeners.forEach((listener) => listener());
}

export function getPermissionStatus(): Promise<PermissionStatus> {
  if (isWeb) return Promise.resolve("denied");
  return readPermissionStatus(Notifications.getPermissionsAsync);
}

/** Shows the phone's prompt when it still can, and returns the result. Never
    prompts when already granted or denied. */
export async function requestPermission(): Promise<PermissionStatus> {
  if (isWeb) return "denied";
  try {
    return await requestPermissionStatus(
      Notifications.getPermissionsAsync,
      Notifications.requestPermissionsAsync,
    );
  } finally {
    // Android's prompt doesn't always move AppState, so tell the hooks.
    permissionChanged();
  }
}

/** The app's page in the phone's settings, where a denied permission is
    turned back on. */
export async function openNotificationSettings(): Promise<void> {
  if (isWeb) return;
  try {
    await Linking.openSettings();
  } catch {}
}

/**
 * The current status, re-read when the app returns to the foreground (the
 * client may have just changed it in the phone's settings) and after
 * `requestPermission`. `null` until the first read resolves. `refresh`
 * re-reads it in every mounted copy of this hook.
 */
export function usePermissionStatus(): {
  status: PermissionStatus | null;
  refresh: () => void;
} {
  const [status, setStatus] = useState<PermissionStatus | null>(isWeb ? "denied" : null);

  useEffect(() => {
    if (isWeb) return;
    let alive = true;
    const read = () => {
      void getPermissionStatus().then((next) => {
        if (alive) setStatus(next);
      });
    };
    read();
    listeners.add(read);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") read();
    });
    return () => {
      alive = false;
      listeners.delete(read);
      sub.remove();
    };
  }, []);

  return { status, refresh: permissionChanged };
}
```

- [ ] **Step 12: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint src/utils/reminder-prefs.ts src/utils/reminder-prefs.test.ts src/utils/notification-permission.ts src/utils/notification-permission.test.ts src/lib/reminder-prefs.ts src/lib/notification-permission.ts && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 173`, `ℹ suites 34`, `ℹ pass 173`, `ℹ fail 0`;
- `tsc` and `eslint` print nothing;
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`.

Nothing calls the two `src/lib` modules yet. Task 8 exercises them on a phone.

- [ ] **Step 13: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/reminder-prefs.ts src/utils/reminder-prefs.test.ts src/utils/notification-permission.ts src/utils/notification-permission.test.ts src/lib/reminder-prefs.ts src/lib/notification-permission.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(reminders): preference store and notification permission helpers" -m "Device-level reminder preferences in AsyncStorage (app_reminder_prefs), with a ready flag so nothing is planned from the defaults. The permission maps to granted / undetermined / denied (pure, tested: Android 12-, Android 13+ after one or two no, iOS provisional, a read that throws); web always reads denied." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those six files.

---

### Task 4: Copy, scheduler, channel, foreground handler and sign-out cancel

**Files:**
- Test: `src/i18n/reminders.test.ts`
- Modify: `src/i18n/es.ts`, the end of the file after `supplements` (lines 673–675 once the previous plan's four `program.locked…` keys and comment are in; 668–670 at `64ab056`: `timing_any: "Cualquier momento",` / `},` / `} as const;`)
- Modify: `src/i18n/en.ts`, same place (lines 673–675: `timing_any: "Anytime",`)
- Create: `src/lib/reminders.ts`
- Modify: `src/lib/rest-alert.ts`: the import at line 11 and the handler at lines 141–155
- Modify: `app/_layout.tsx`: the imports at lines 13–14 and the module-scope setup at lines 49–52
- Modify: `src/providers/auth-provider.tsx`: the import at line 2 and the `SIGNED_OUT` block at lines 92–94

**Interfaces:**
- Consumes:
  - `PlannedReminder` and `REMINDER_ID_PREFIX` from `src/utils/reminders.ts` (Task 1). `titleKey`/`bodyKey` are full i18n keys, such as `"reminders.trainingTitle"`, and `params` fill their placeholders.
  - From expo-notifications:
    - `setNotificationChannelAsync(id, { name, importance })`;
    - `getAllScheduledNotificationsAsync()` and `cancelScheduledNotificationAsync(id)`;
    - `scheduleNotificationAsync({ identifier, content, trigger: { type: SchedulableTriggerInputTypes.DATE, date, channelId } })`.
- Produces:
  - `src/lib/reminders.ts`:
    - `REMINDER_CHANNEL_ID = "reminders"`, `REMINDER_ID_PREFIX` (re-exported), `REMINDER_KIND = "reminder"` and `REMINDER_URL: Href = "/(tabs)/routines"`;
    - `isReminderData(data): boolean`;
    - `ensureReminderChannel(name: string): Promise<void>` (Android only);
    - `syncReminders(plan: PlannedReminder[], t: TFunction): Promise<void>`;
    - `cancelReminders(): Promise<void>`, which also bumps `reminderGeneration()`;
    - `reminderGeneration(): number`.
    - Everything is a no-op on web.
  - i18n `reminders.*`: exactly the spec's Copy table (25 keys), in both languages:
    - `trainingBody_one`/`_other` and `weekBody_one`/`_other` are rendered through their base keys (`t("reminders.trainingBody", { count, … })`), which is what the planner's `bodyKey` holds;
    - `dayN` is the reminders' own day-number fallback (Task 5);
    - `daysLabel` and `noDaysHint` belong to the Ajustes day chips (Task 7).
  - The foreground handler shows notifications with `data.kind === "reminder"` even while the app is open. Rest alerts behave as before.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/i18n/reminders.test.ts src/i18n/es.ts src/i18n/en.ts src/lib/reminders.ts src/lib/rest-alert.ts app/_layout.tsx src/providers/auth-provider.tsx
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`. Read `src/lib/rest-alert.ts`, `app/_layout.tsx` and `src/providers/auth-provider.tsx` in full.

- [ ] **Step 2: Write the failing copy test**

Create `src/i18n/reminders.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The spec's Copy table (docs/superpowers/specs/2026-09-29-local-reminders-design.md),
// word for word: [key, es, en].
const COPY: [string, string, string][] = [
  ["trainingTitle", "Hoy toca {{label}}", "Today: {{label}}"],
  ["trainingBody_one", "{{count}} ejercicio · Semana {{w}}", "{{count}} exercise · Week {{w}}"],
  ["trainingBody_other", "{{count}} ejercicios · Semana {{w}}", "{{count}} exercises · Week {{w}}"],
  [
    "inactivityTitle",
    "Han pasado {{days}} días sin entrenar",
    "It's been {{days}} days since you trained",
  ],
  ["inactivityBody", "{{label}} te espera", "{{label}} is waiting for you"],
  ["weekTitle", "Tu semana {{w}} ya está disponible", "Week {{w}} is now open"],
  ["weekBody_one", "{{label}} · {{count}} ejercicio", "{{label}} · {{count}} exercise"],
  ["weekBody_other", "{{label}} · {{count}} ejercicios", "{{label}} · {{count}} exercises"],
  ["dayN", "Día {{n}}", "Day {{n}}"],
  ["onboardingTitle", "¿Te avisamos los días de entreno?", "Want reminders on your training days?"],
  [
    "onboardingText",
    "Te recordamos qué te toca entrenar en tus días de entreno. Puedes cambiarlo cuando quieras en Ajustes.",
    "We'll remind you what to train on your training days. You can change this anytime in Settings.",
  ],
  ["enable", "Activar", "Turn on"],
  ["notNow", "Ahora no", "Not now"],
  ["cardTitle", "Notificaciones", "Notifications"],
  ["statusOn", "Activadas", "On"],
  ["statusOff", "Desactivadas", "Off"],
  ["enableButton", "Activar notificaciones", "Turn on notifications"],
  ["openSettings", "Abrir ajustes del teléfono", "Open phone settings"],
  ["prefTraining", "Días de entreno", "Training days"],
  ["prefInactivity", "Si llevo días sin entrenar", "When I haven't trained in a while"],
  ["prefWeek", "Cuando se abre una semana", "When a new week opens"],
  ["hour", "Hora del recordatorio", "Reminder time"],
  [
    "noDaysHint",
    "Elige tus días de entreno para recibir recordatorios.",
    "Pick your training days to get reminders.",
  ],
  ["daysLabel", "Tus días de entreno", "Your training days"],
  ["channelName", "Recordatorios", "Reminders"],
];

describe("reminders copy", () => {
  it("has the Copy table's 25 keys", () => {
    assert.equal(COPY.length, 25);
    assert.equal(new Set(COPY.map(([key]) => key)).size, 25);
  });

  it("es has exactly the Copy table's keys and texts", () => {
    assert.deepEqual({ ...es.reminders }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly the Copy table's keys and texts", () => {
    assert.deepEqual({ ...en.reminders }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });
});

// The app's copy rendered the way src/lib/reminders.ts renders it, in an
// i18next instance of its own set up like src/i18n/index.ts (that module also
// reads AsyncStorage, which can't load under Node). No compatibilityJSON, so
// the _one/_other suffixes are i18next's default plural format.
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

describe("reminders copy, rendered", () => {
  it("es: singular for one exercise, plural for more", () => {
    const t = i18n.getFixedT("es");
    assert.equal(t("reminders.trainingBody", { count: 1, w: 2 }), "1 ejercicio · Semana 2");
    assert.equal(t("reminders.trainingBody", { count: 3, w: 2 }), "3 ejercicios · Semana 2");
    assert.equal(t("reminders.weekBody", { label: "Pierna", count: 1 }), "Pierna · 1 ejercicio");
    assert.equal(t("reminders.weekBody", { label: "Pierna", count: 2 }), "Pierna · 2 ejercicios");
  });

  it("en: singular for one exercise, plural for more", () => {
    const t = i18n.getFixedT("en");
    assert.equal(t("reminders.trainingBody", { count: 1, w: 2 }), "1 exercise · Week 2");
    assert.equal(t("reminders.trainingBody", { count: 4, w: 2 }), "4 exercises · Week 2");
    assert.equal(t("reminders.weekBody", { label: "Legs", count: 1 }), "Legs · 1 exercise");
    assert.equal(t("reminders.weekBody", { label: "Legs", count: 2 }), "Legs · 2 exercises");
  });

  it("the day-number fallback reads «Día n», not the home card's «DÍA n»", () => {
    assert.equal(i18n.getFixedT("es")("reminders.dayN", { n: 2 }), "Día 2");
    assert.equal(i18n.getFixedT("en")("reminders.dayN", { n: 2 }), "Day 2");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/i18n/reminders.test.ts
```

Expected: `ℹ tests 6`, `ℹ suites 2`, `ℹ pass 1`, `ℹ fail 5`. Only "has the Copy table's 25 keys" passes. The other five fail with `AssertionError [ERR_ASSERTION]`, because there is no `reminders` section yet: the two tables differ, and `t` returns the missing key itself (`'reminders.trainingBody' !== '1 ejercicio · Semana 2'`).

- [ ] **Step 4: Add the Spanish copy**

In `src/i18n/es.ts`, at the end of the file, replace:

```ts
    timing_any: "Cualquier momento",
  },
} as const;
```

with:

```ts
    timing_any: "Cualquier momento",
  },

  // Recordatorios locales (notificaciones): día de entreno, inactividad y
  // semana abierta, más su paso en el onboarding y su tarjeta en Ajustes
  reminders: {
    trainingTitle: "Hoy toca {{label}}",
    // Plurales de i18next: t("reminders.trainingBody", { count, w }) elige
    // _one (1 ejercicio) u _other
    trainingBody_one: "{{count}} ejercicio · Semana {{w}}",
    trainingBody_other: "{{count}} ejercicios · Semana {{w}}",
    inactivityTitle: "Han pasado {{days}} días sin entrenar",
    inactivityBody: "{{label}} te espera",
    weekTitle: "Tu semana {{w}} ya está disponible",
    weekBody_one: "{{label}} · {{count}} ejercicio",
    weekBody_other: "{{label}} · {{count}} ejercicios",
    // Día sin nombre ni día de la semana (Inicio usa program.dayN, en mayúsculas)
    dayN: "Día {{n}}",
    onboardingTitle: "¿Te avisamos los días de entreno?",
    onboardingText:
      "Te recordamos qué te toca entrenar en tus días de entreno. Puedes cambiarlo cuando quieras en Ajustes.",
    enable: "Activar",
    notNow: "Ahora no",
    cardTitle: "Notificaciones",
    statusOn: "Activadas",
    statusOff: "Desactivadas",
    enableButton: "Activar notificaciones",
    openSettings: "Abrir ajustes del teléfono",
    prefTraining: "Días de entreno",
    prefInactivity: "Si llevo días sin entrenar",
    prefWeek: "Cuando se abre una semana",
    hour: "Hora del recordatorio",
    noDaysHint: "Elige tus días de entreno para recibir recordatorios.",
    daysLabel: "Tus días de entreno",
    // Nombre del canal de notificaciones en los ajustes de Android
    channelName: "Recordatorios",
  },
} as const;
```

- [ ] **Step 5: Add the English copy**

In `src/i18n/en.ts`, at the end of the file, replace:

```ts
    timing_any: "Anytime",
  },
} as const;
```

with:

```ts
    timing_any: "Anytime",
  },

  // Local reminders (notifications): training day, inactivity and week
  // opened, plus their onboarding step and their Settings card
  reminders: {
    trainingTitle: "Today: {{label}}",
    // i18next plurals: t("reminders.trainingBody", { count, w }) picks _one
    // (1 exercise) or _other
    trainingBody_one: "{{count}} exercise · Week {{w}}",
    trainingBody_other: "{{count}} exercises · Week {{w}}",
    inactivityTitle: "It's been {{days}} days since you trained",
    inactivityBody: "{{label}} is waiting for you",
    weekTitle: "Week {{w}} is now open",
    weekBody_one: "{{label}} · {{count}} exercise",
    weekBody_other: "{{label}} · {{count}} exercises",
    // A day with no label or weekday (Home uses the all-caps program.dayN)
    dayN: "Day {{n}}",
    onboardingTitle: "Want reminders on your training days?",
    onboardingText:
      "We'll remind you what to train on your training days. You can change this anytime in Settings.",
    enable: "Turn on",
    notNow: "Not now",
    cardTitle: "Notifications",
    statusOn: "On",
    statusOff: "Off",
    enableButton: "Turn on notifications",
    openSettings: "Open phone settings",
    prefTraining: "Training days",
    prefInactivity: "When I haven't trained in a while",
    prefWeek: "When a new week opens",
    hour: "Reminder time",
    noDaysHint: "Pick your training days to get reminders.",
    daysLabel: "Your training days",
    // Notification channel name in Android settings
    channelName: "Reminders",
  },
} as const;
```

- [ ] **Step 6: Run the copy test and watch it pass**

Run the same command as Step 3. Expected: `ℹ tests 6`, `ℹ suites 2`, `ℹ pass 6`, `ℹ fail 0`.

- [ ] **Step 7: Write the scheduler**

Create `src/lib/reminders.ts`:

```ts
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import type { TFunction } from "i18next";
import { Platform } from "react-native";

import { type PlannedReminder, REMINDER_ID_PREFIX } from "@/src/utils/reminders";

/**
 * Local reminders (training day, inactivity, week opened): the scheduling
 * half. What to remind and when comes from the pure planner
 * (`@/src/utils/reminders`); this turns that plan into OS notifications, one
 * DATE trigger each. There are no repeating triggers, so every rebuild
 * replaces the whole set (`useReminderSync`).
 *
 * Every reminder's identifier starts with REMINDER_ID_PREFIX (spelled once, in
 * the planner). That is how a rebuild finds and replaces exactly the reminders
 * and never touches the rest-timer alert (`@/src/lib/rest-alert`), whose id
 * expo-notifications generates.
 *
 * Fails soft, like the rest alert: a refused schedule or a missing permission
 * never throws into the screens. No-ops on web, which has no local
 * notifications.
 */

export const REMINDER_CHANNEL_ID = "reminders";
export { REMINDER_ID_PREFIX };
/** `data.kind` on every reminder: the foreground handler shows these, and a
    tap on one opens the Programa tab. */
export const REMINDER_KIND = "reminder";
/** Where tapping a reminder lands. */
export const REMINDER_URL: Href = "/(tabs)/routines";

const isWeb = Platform.OS === "web";

/** True for a notification's `content.data` when it is one of ours. */
export function isReminderData(data: Record<string, unknown> | null | undefined): boolean {
  return data?.kind === REMINDER_KIND;
}

/**
 * Create the Android channel, or rename it: Android keeps a channel's
 * sound and importance once it exists (and the client can change them), but
 * it does take a new name, so calling this again in another language renames
 * it. Default importance: a reminder, not an alarm like the rest alert.
 */
export async function ensureReminderChannel(name: string): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
      name,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  } catch {}
}

/**
 * Cancel and schedule run one at a time. A rebuild that starts while the last
 * one is still cancelling or scheduling would interleave with it and leave
 * duplicates or gaps; and a sign-out cancel must land after a rebuild in flight.
 */
let queue: Promise<void> = Promise.resolve();

function serialized(task: () => Promise<void>): Promise<void> {
  queue = queue.then(task).catch(() => {});
  return queue;
}

async function cancelScheduled(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => n.identifier.startsWith(REMINDER_ID_PREFIX))
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
  );
}

async function replaceScheduled(plan: PlannedReminder[], t: TFunction): Promise<void> {
  await cancelScheduled();
  if (plan.length === 0) return;
  await ensureReminderChannel(t("reminders.channelName"));
  for (const reminder of plan) {
    // The plan was built a moment ago; a time that has passed since would fire
    // at once (or be refused), so it is dropped instead.
    if (reminder.fireAt.getTime() <= Date.now()) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        identifier: reminder.id,
        content: {
          title: t(reminder.titleKey, reminder.params),
          body: t(reminder.bodyKey, reminder.params),
          data: { kind: REMINDER_KIND, url: REMINDER_URL },
          // iOS is silent without it; Android takes the channel's sound.
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.fireAt,
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    } catch {}
  }
}

/**
 * Replace every scheduled reminder with `plan`, texts in `t`'s language.
 * Pass an empty plan to only cancel. The rest alert is never touched.
 */
export function syncReminders(plan: PlannedReminder[], t: TFunction): Promise<void> {
  if (isWeb) return Promise.resolve();
  return serialized(() => replaceScheduled(plan, t));
}

/**
 * Bumped by every cancelReminders(). A rebuild planned before a cancel (the
 * sync hook's debounce still pending when the client signs out) reads it
 * again before scheduling and gives up, so the previous client's plan can't
 * land after the sign-out cancel.
 */
let generation = 0;

export function reminderGeneration(): number {
  return generation;
}

/** Cancel every scheduled reminder (sign-out, permission gone). */
export function cancelReminders(): Promise<void> {
  generation++;
  if (isWeb) return Promise.resolve();
  return serialized(cancelScheduled);
}
```

- [ ] **Step 8: Let the foreground handler show reminders**

In `src/lib/rest-alert.ts`, replace line 11:

```ts
import { alertSounds, alertVibrates, type AlertMode, getAlertMode } from "@/src/lib/alert-mode";
```

with:

```ts
import { alertSounds, alertVibrates, type AlertMode, getAlertMode } from "@/src/lib/alert-mode";
import { isReminderData } from "@/src/lib/reminders";
```

Then, inside `setupRestAlerts()` (lines 141–155), replace:

```ts
  // Foreground finishes are already covered by the chime and the vibration
  // above, so the OS notification would double up. Suppress it rather than
  // skipping the schedule: whether the app is foregrounded at 0:00 is not
  // knowable when the timer starts.
  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const active = AppState.currentState === "active";
      return {
        shouldShowBanner: !active,
        shouldShowList: !active,
        shouldPlaySound: !active,
        shouldSetBadge: false,
      };
    },
  });
```

with:

```ts
  // Foreground rest finishes are already covered by the chime and the
  // vibration above, so the OS notification would double up. Suppress it
  // rather than skipping the schedule: whether the app is foregrounded at 0:00
  // is not knowable when the timer starts. The app's only handler, so it also
  // decides for the local reminders (`@/src/lib/reminders`): those always
  // show, since nothing on screen says what they say.
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      const show =
        isReminderData(notification.request.content.data) ||
        AppState.currentState !== "active";
      return {
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      };
    },
  });
```

- [ ] **Step 9: Create the reminders channel at startup**

In `app/_layout.tsx`, replace lines 13–14:

```tsx
import { persister, PERSIST_MAX_AGE, queryClient } from "@/src/lib/query-client";
import { setupRestAlerts } from "@/src/lib/rest-alert";
```

with:

```tsx
import { persister, PERSIST_MAX_AGE, queryClient } from "@/src/lib/query-client";
import { ensureReminderChannel } from "@/src/lib/reminders";
import { setupRestAlerts } from "@/src/lib/rest-alert";
```

Then replace lines 49–52:

```tsx
// Audio session, Android notification channel and the foreground notification
// handler for the rest timer. Module scope, not an effect: the notification
// handler has to be installed before any scheduled rest can fire.
setupRestAlerts();
```

with:

```tsx
// Audio session, Android notification channel and the foreground notification
// handler for the rest timer (the handler also lets reminders show). Module
// scope, not an effect: the handler has to be installed before any scheduled
// rest or reminder can fire.
setupRestAlerts();
// The reminders' own Android channel («Recordatorios»), so a client can mute
// them without muting the rest alert. Named in the language i18n starts in;
// every rebuild re-applies the name in the current one (src/lib/reminders.ts).
void ensureReminderChannel(i18n.t("reminders.channelName"));
```

`i18n` is already imported (line 6). `i18next.init` with inline resources runs synchronously, so `i18n.t` works at module scope; the rest alert's setup relies on the same.

- [ ] **Step 10: Cancel reminders on sign-out**

In `src/providers/auth-provider.tsx`, replace line 2:

```tsx
import { persister, queryClient } from "@/src/lib/query-client";
```

with:

```tsx
import { persister, queryClient } from "@/src/lib/query-client";
import { cancelReminders } from "@/src/lib/reminders";
```

Then, in the `onAuthStateChange` callback's `SIGNED_OUT` branch (lines 92–94), replace:

```tsx
        // Wipe everything account-scoped so the next sign-in can't see the
        // previous user's cached data or replay their queued writes.
        void clearOutbox();
```

with:

```tsx
        // Wipe everything account-scoped so the next sign-in can't see the
        // previous user's cached data or replay their queued writes, or get
        // reminders built from them.
        void clearOutbox();
        void cancelReminders();
```

- [ ] **Step 11: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint src/i18n/reminders.test.ts src/i18n/es.ts src/i18n/en.ts src/lib/reminders.ts src/lib/rest-alert.ts app/_layout.tsx src/providers/auth-provider.tsx && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 179`, `ℹ suites 36`, `ℹ pass 179`, `ℹ fail 0`;
- `tsc` and `eslint` print nothing;
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`.

Nothing schedules a reminder yet (Task 5 does). The channel, the handler and the sign-out cancel are checked on a phone in Task 8.

- [ ] **Step 12: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/i18n/reminders.test.ts src/i18n/es.ts src/i18n/en.ts src/lib/reminders.ts src/lib/rest-alert.ts app/_layout.tsx src/providers/auth-provider.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(reminders): scheduler, Android channel, foreground display, cancel on sign-out" -m "src/lib/reminders.ts replaces every reminder-* notification with one DATE trigger each on the new reminders channel; the rest alert is never touched. The single foreground handler now shows reminders while still hiding rest alerts. Sign-out cancels them. Copy: the spec's reminders table in es and en, with i18next plural bodies (1 ejercicio / 2 ejercicios) and its own «Día n» fallback." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those seven files.

---

### Task 5: Sync gate, sync and tap hooks

**Files:**
- Create: `src/utils/reminder-sync.ts` (pure: when the sync may act)
- Test: `src/utils/reminder-sync.test.ts`
- Modify: `src/utils/day-label.ts`: the import at line 1, and the end of `dayLabel` at lines 13–14
- Test: `src/utils/day-label.test.ts`
- Modify: `src/hooks/use-membership.ts` (lines 24 and 29) and `src/hooks/use-profile.ts` (lines 24 and 49), to expose `error`
- Create: `src/hooks/use-reminder-sync.ts`
- Create: `src/hooks/use-reminder-taps.ts`
- Modify: `app/(tabs)/_layout.tsx` (line numbers before this task):
  - the `react-native` import at line 5;
  - the hook imports at lines 12–13;
  - a `Reminders` component before `export default function TabsLayout()` at line 59;
  - its mount after `<ExerciseSessionHost tabBarHeight={74} />` at lines 154–156.

**Interfaces:**
- Consumes:
  - From Task 1: `planReminders` and `PlannedReminder`.
  - From Task 3: `useReminderPrefs`, `useReminderPrefsReady`, `usePermissionStatus` and `PermissionStatus`.
  - From Task 4: `syncReminders`, `cancelReminders`, `reminderGeneration`, `isReminderData` and `REMINDER_URL`.
  - `useToday()` from `src/lib/today.ts` (previous plan).
  - Existing:
    - `useAuth()` → `{ user }`;
    - `useProgram()` → `{ program, loading, error }`;
    - `useProgramLogging(program)` → `{ completions, setLogs }`;
    - `useProfile(userId)` → `{ profile, loading }`, where `profile.available_days` is a `string[] | null`;
    - `useMembership()` → `{ membership, loading }`;
    - `qk.programLog(userId)`;
    - `dayLabel(weekday, t)`.
  - From Task 4: `reminders.dayN` («Día {{n}}» / «Day {{n}}»).
  - From expo-notifications:
    - `getLastNotificationResponse()` (synchronous; the Async variant is deprecated);
    - `clearLastNotificationResponse()`;
    - `addNotificationResponseReceivedListener(listener)`;
    - `DEFAULT_ACTION_IDENTIFIER`.
- Produces:
  - `src/utils/reminder-sync.ts`:
    - `type SourceState = "loading" | "failed" | "ready"`;
    - `sourceState({ loading, error, hasData }): SourceState`;
    - `type ReminderSyncAction = "wait" | "cancel" | "plan"`;
    - `type ReminderSyncGate = { signedIn; permission; prefsReady; program; log; profile; membership }`;
    - `reminderSyncAction(g: ReminderSyncGate): ReminderSyncAction`.
  - `programDayName(day: Pick<ProgramDay, "label" | "weekday" | "day_index">, t: TFunction): string`: the label, else the weekday name (the home card's fallback), else «Día n» (`reminders.dayN`).
  - `useMembership()` → `{ membership, loading, error }` and `useProfile(userId)` → `{ profile, loading, error, updateProfile }`. Both additions are additive, so existing callers are unchanged.
  - `useReminderSync(): void` and `useReminderTaps(): void`, mounted once, through a `Reminders` component in `app/(tabs)/_layout.tsx` (not on web).

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/reminder-sync.ts src/utils/reminder-sync.test.ts src/utils/day-label.ts src/utils/day-label.test.ts src/hooks/use-membership.ts src/hooks/use-profile.ts src/hooks/use-reminder-sync.ts src/hooks/use-reminder-taps.ts "app/(tabs)/_layout.tsx"
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`. Read `app/(tabs)/_layout.tsx`, `src/hooks/use-program.ts` and `src/hooks/use-program-logging.ts` in full. Don't edit the last one: the previous plan and another session own it.

- [ ] **Step 2: Write the failing gate test**

Create `src/utils/reminder-sync.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  reminderSyncAction,
  type ReminderSyncGate,
  sourceState,
} from "@/src/utils/reminder-sync";

const READY: ReminderSyncGate = {
  signedIn: true,
  permission: "granted",
  prefsReady: true,
  program: "ready",
  log: "ready",
  profile: "ready",
  membership: "ready",
};

const action = (patch: Partial<ReminderSyncGate>) => reminderSyncAction({ ...READY, ...patch });

describe("sourceState", () => {
  it("data, fresh or cached, is ready even if the last refetch failed", () => {
    assert.equal(sourceState({ loading: false, error: false, hasData: true }), "ready");
    assert.equal(sourceState({ loading: false, error: true, hasData: true }), "ready");
  });

  it("no data yet while the first load runs is loading", () => {
    assert.equal(sourceState({ loading: true, error: false, hasData: false }), "loading");
  });

  it("no data after a failed load is failed, not an empty answer", () => {
    assert.equal(sourceState({ loading: false, error: true, hasData: false }), "failed");
  });

  it("no data after a load that worked is a real none", () => {
    assert.equal(sourceState({ loading: false, error: false, hasData: false }), "ready");
  });
});

describe("reminderSyncAction", () => {
  it("plans once everything is in and notifications are allowed", () => {
    assert.equal(action({}), "plan");
  });

  it("waits while signed out or before the permission is known", () => {
    assert.equal(action({ signedIn: false }), "wait");
    assert.equal(action({ permission: null }), "wait");
  });

  it("cancels without permission, even before the data is in", () => {
    for (const permission of ["undetermined", "denied"] as const) {
      assert.equal(action({ permission }), "cancel", permission);
      assert.equal(action({ permission, prefsReady: false, program: "loading" }), "cancel");
    }
  });

  it("waits for the stored preferences, not the defaults", () => {
    assert.equal(action({ prefsReady: false }), "wait");
  });

  it("waits while any source is loading or failed with nothing cached", () => {
    for (const source of ["program", "log", "profile", "membership"] as const) {
      for (const state of ["loading", "failed"] as const) {
        assert.equal(action({ [source]: state }), "wait", `${source} ${state}`);
      }
    }
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/reminder-sync.test.ts
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …\src\utils\reminder-sync.test.ts`, then `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 4: Write the gate**

Create `src/utils/reminder-sync.ts`:

```ts
import type { PermissionStatus } from "@/src/utils/notification-permission";

// When the reminder sync (src/hooks/use-reminder-sync.ts) may rebuild. Pure,
// so `npm test` pins it: data that hasn't loaded, or failed to load with
// nothing cached, looks exactly like "no program", "no training days" or "no
// membership", and a plan built from it would cancel the reminders (or
// schedule some for a client whose membership ended).

/** One input of the plan: still on its first load, failed with nothing
    cached, or usable (which includes a real "none"). */
export type SourceState = "loading" | "failed" | "ready";

export function sourceState(s: {
  loading: boolean;
  error: boolean;
  hasData: boolean;
}): SourceState {
  // Cached data is usable even when the last refetch failed.
  if (s.hasData) return "ready";
  if (s.loading) return "loading";
  return s.error ? "failed" : "ready";
}

export type ReminderSyncAction = "wait" | "cancel" | "plan";

export type ReminderSyncGate = {
  signedIn: boolean;
  /** null until the first read resolves. */
  permission: PermissionStatus | null;
  /** The stored reminder preferences have been read. */
  prefsReady: boolean;
  program: SourceState;
  log: SourceState;
  profile: SourceState;
  membership: SourceState;
};

/** "wait" keeps whatever is scheduled; "cancel" drops every reminder;
    "plan" rebuilds them from the data. */
export function reminderSyncAction(g: ReminderSyncGate): ReminderSyncAction {
  if (!g.signedIn || g.permission == null) return "wait";
  // Without permission nothing may stay scheduled, whatever the data says.
  if (g.permission !== "granted") return "cancel";
  if (!g.prefsReady) return "wait";
  const sources = [g.program, g.log, g.profile, g.membership];
  return sources.every((s) => s === "ready") ? "plan" : "wait";
}
```

- [ ] **Step 5: Run it and watch it pass**

Run the same command as Step 3. Expected: `ℹ tests 9`, `ℹ suites 2`, `ℹ pass 9`, `ℹ fail 0`.

- [ ] **Step 6: Write the failing day-name test**

Create `src/utils/day-label.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";
import { programDayName } from "@/src/utils/day-label";

// The app's real copy, in an instance of its own (the app's i18n module also
// reads AsyncStorage, which can't load under Node).
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

const day = { label: null, weekday: null, day_index: 2 };

describe("programDayName", () => {
  it("uses the day's label first", () => {
    assert.equal(programDayName({ ...day, label: "Pierna", weekday: "monday" }, i18n.t), "Pierna");
  });

  it("then its weekday, in the app's language", () => {
    assert.equal(programDayName({ ...day, label: "", weekday: "Monday" }, i18n.t), "Lunes");
  });

  it("then «Día n» (reminders.dayN), not the home card's all-caps «DÍA n»", () => {
    assert.equal(programDayName(day, i18n.t), "Día 2");
    assert.equal(programDayName({ ...day, weekday: "  " }, i18n.t), "Día 2");
  });

  it("follows the language", () => {
    const t = i18n.getFixedT("en");
    assert.equal(programDayName({ ...day, weekday: "friday" }, t), "Friday");
    assert.equal(programDayName(day, t), "Day 2");
  });
});
```

- [ ] **Step 7: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/day-label.test.ts
```

Expected: `SyntaxError: The requested module '@/src/utils/day-label' does not provide an export named 'programDayName'`, then `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 8: Add `programDayName`**

In `src/utils/day-label.ts`, replace line 1:

```ts
import type { TFunction } from "i18next";
```

with:

```ts
import type { TFunction } from "i18next";

import type { ProgramDay } from "@/src/types/database";
```

Then replace the end of `dayLabel` (lines 13–14):

```ts
  return t(`daysLong.${key}`, { defaultValue: day });
}
```

with:

```ts
  return t(`daysLong.${key}`, { defaultValue: day });
}

/** A program day's name for text outside the program screens (the local
    reminders): its label, else its weekday, the same pick as the home card's
    day title, else «Día n». That last one is reminders.dayN, in sentence
    case, not the home card's all-caps eyebrow (program.dayN, «DÍA n»). */
export function programDayName(
  day: Pick<ProgramDay, "label" | "weekday" | "day_index">,
  t: TFunction,
): string {
  if (day.label != null && day.label !== "") return day.label;
  return dayLabel(day.weekday, t) ?? t("reminders.dayN", { n: day.day_index });
}
```

- [ ] **Step 9: Run it and watch it pass**

Run the same command as Step 7. Expected: `ℹ tests 4`, `ℹ suites 1`, `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 10: Expose the membership and profile query errors**

The gate needs to tell a failed fetch from a real "none".

In `src/hooks/use-membership.ts`, replace line 24:

```ts
  const { data: membership = null, isPending: loading } = useQuery({
```

with:

```ts
  const {
    data: membership = null,
    isPending: loading,
    isError: error,
  } = useQuery({
```

and line 29:

```ts
  return { membership, loading };
```

with:

```ts
  return { membership, loading, error };
```

In `src/hooks/use-profile.ts`, replace line 24:

```ts
  const { data: profile = null, isPending: loading } = useQuery({
```

with:

```ts
  const { data: profile = null, isPending: loading, isError: error } = useQuery({
```

and line 49:

```ts
  return { profile, loading, updateProfile: updateProfileMutation.mutateAsync };
```

with:

```ts
  return { profile, loading, error, updateProfile: updateProfileMutation.mutateAsync };
```

- [ ] **Step 11: Write the sync hook**

Create `src/hooks/use-reminder-sync.ts`:

```ts
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform } from "react-native";

import { useAuth } from "@/src/hooks/use-auth";
import { useMembership } from "@/src/hooks/use-membership";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { usePermissionStatus } from "@/src/lib/notification-permission";
import { qk } from "@/src/lib/query-keys";
import { useReminderPrefs, useReminderPrefsReady } from "@/src/lib/reminder-prefs";
import { cancelReminders, reminderGeneration, syncReminders } from "@/src/lib/reminders";
import { useToday } from "@/src/lib/today";
import { programDayName } from "@/src/utils/day-label";
import { reminderSyncAction, type SourceState, sourceState } from "@/src/utils/reminder-sync";
import { planReminders, type PlannedReminder } from "@/src/utils/reminders";

/** Quiet time before a rebuild: a check-off, its refetch and the realtime
    event after it land as one rebuild, not three. */
const DEBOUNCE_MS = 1000;

/** Where the program log's query stands. Read from the query cache, so
    useProgramLogging stays as it is: ready once it has rows (fetched or
    restored from the persisted cache), or when the program has no exercises
    to log (the query never runs then). */
function useLogSource(userId: string | undefined, hasExercises: boolean): SourceState {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  const read = useCallback((): SourceState => {
    const state = queryClient.getQueryState(qk.programLog(userId));
    return sourceState({
      loading: state == null || state.status === "pending",
      error: state?.status === "error",
      hasData: !hasExercises || state?.data !== undefined,
    });
  }, [queryClient, userId, hasExercises]);
  return useSyncExternalStore(subscribe, read, read);
}

/**
 * Keeps the phone's scheduled reminders (`@/src/lib/reminders`) in step with
 * the data they are built from. Mounted once, in the tabs layout: only a
 * signed-in, onboarded client gets here.
 *
 * Rebuilds the whole 14-day plan, debounced, when the app returns to the
 * foreground, the day changes, the program, its log, the profile's training
 * days or the membership change, the preferences or the language change, or
 * the permission changes. Without permission it cancels them all instead.
 * While any of that is still loading (or failed with nothing cached) it
 * leaves what's scheduled alone (`reminderSyncAction`). Nothing on web.
 */
export function useReminderSync(): void {
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const { user } = useAuth();
  const { program, loading: programLoading, error: programError } = useProgram();
  const { completions, setLogs } = useProgramLogging(program);
  const { profile, loading: profileLoading, error: profileError } = useProfile(user?.id);
  const {
    membership,
    loading: membershipLoading,
    error: membershipError,
  } = useMembership();
  const hasExercises = program?.program_days.some((d) => d.program_exercises.length > 0) ?? false;
  const logSource = useLogSource(user?.id, hasExercises);
  const availableDays = profile?.available_days ?? null;
  const prefs = useReminderPrefs();
  const prefsReady = useReminderPrefsReady();
  const { status } = usePermissionStatus();
  // Neither is read below: both only make the effect run again. `today`
  // moves at local midnight, `foreground` on every return to the app.
  const today = useToday();
  const [foreground, setForeground] = useState(0);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") setForeground((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const action = reminderSyncAction({
    signedIn: user != null,
    permission: status,
    prefsReady,
    program: sourceState({
      loading: programLoading,
      error: programError,
      hasData: program != null,
    }),
    log: logSource,
    profile: sourceState({
      loading: profileLoading,
      error: profileError,
      hasData: profile != null,
    }),
    membership: sourceState({
      loading: membershipLoading,
      error: membershipError,
      hasData: membership != null,
    }),
  });

  useEffect(() => {
    if (Platform.OS === "web" || action === "wait") return;
    // Read now, checked when the timer fires: a cancel in between (sign-out)
    // makes this rebuild the previous client's.
    const generation = reminderGeneration();
    const timer = setTimeout(() => {
      if (reminderGeneration() !== generation) return;
      if (action === "cancel") {
        void cancelReminders();
        return;
      }
      let plan: PlannedReminder[];
      try {
        plan = planReminders({
          program,
          completions,
          setLogs,
          availableDays,
          membership,
          prefs,
          now: new Date(),
          labelOf: (day) => programDayName(day, t),
        });
      } catch {
        // A planner bug must never take the tabs down; keep what's scheduled.
        return;
      }
      void syncReminders(plan, t);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    action,
    program,
    completions,
    setLogs,
    availableDays,
    membership,
    prefs,
    t,
    language,
    today,
    foreground,
  ]);
}
```

With the React Compiler on (`app.json` `experiments.reactCompiler`), don't read `queryClient.getQueryState(...)` straight in render: the compiler would memoize it on `queryClient` and the key, and it would go stale. `useLogSource` subscribes to the query cache through `useSyncExternalStore` instead.

- [ ] **Step 12: Write the tap hook**

Create `src/hooks/use-reminder-taps.ts`:

```ts
import * as Notifications from "expo-notifications";
import { type Href, router } from "expo-router";
import { useEffect } from "react";
import { Platform } from "react-native";

import { isReminderData, REMINDER_URL } from "@/src/lib/reminders";

/**
 * Taps already acted on, by notification id and delivery time. Module scope:
 * the tabs layout mounts again after a sign-out and sign-in, and the listener
 * and the cold-start read can both report one tap, so without this an old tap
 * would navigate again.
 */
const handled = new Set<string>();

function openReminder(response: Notifications.NotificationResponse | null) {
  if (response == null) return;
  if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const { request, date } = response.notification;
  const data = request.content.data;
  if (!isReminderData(data)) return;
  const key = `${request.identifier}@${date}`;
  if (handled.has(key)) return;
  handled.add(key);
  // Consumed: a JS reload (dev) or a later mount must not replay this tap.
  try {
    Notifications.clearLastNotificationResponse();
  } catch {}
  // data.url (always REMINDER_URL today); only a tab route is followed.
  const url =
    typeof data?.url === "string" && data.url.startsWith("/(tabs)/")
      ? (data.url as Href)
      : REMINDER_URL;
  router.push(url);
}

/** The tap that launched the app, if any. Never throws into the tabs. */
function lastResponse(): Notifications.NotificationResponse | null {
  try {
    return Notifications.getLastNotificationResponse();
  } catch {
    return null;
  }
}

/**
 * Tapping a reminder opens the Programa tab: from a cold start (the tap that
 * launched the app) and while running. Mounted in the tabs layout, so it only
 * navigates once AuthGate has settled on the tabs; any earlier and the gate's
 * own redirect would override it.
 */
export function useReminderTaps(): void {
  useEffect(() => {
    if (Platform.OS === "web") return;
    openReminder(lastResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(openReminder);
    return () => sub.remove();
  }, []);
}
```

- [ ] **Step 13: Mount both hooks in the tabs layout**

In `app/(tabs)/_layout.tsx`, replace line 5:

```tsx
import { View } from "react-native";
```

with:

```tsx
import { Platform, View } from "react-native";
```

Replace lines 12–13:

```tsx
import { useAuth } from "@/src/hooks/use-auth";
import { DUR, EASE_OUT } from "@/src/lib/motion";
```

with:

```tsx
import { useAuth } from "@/src/hooks/use-auth";
import { useReminderSync } from "@/src/hooks/use-reminder-sync";
import { useReminderTaps } from "@/src/hooks/use-reminder-taps";
import { DUR, EASE_OUT } from "@/src/lib/motion";
```

Replace line 59:

```tsx
export default function TabsLayout() {
```

with:

```tsx
// Local reminders: keeps the next 14 days scheduled and opens Programa when
// one is tapped. Here because both need a signed-in, onboarded client, which
// AuthGate has settled on once the tabs mount. Its own component, rendering
// nothing, so the re-renders its data causes (every check-off, every refetch)
// stay off the tab navigator.
function Reminders() {
  useReminderSync();
  useReminderTaps();
  return null;
}

export default function TabsLayout() {
```

Replace lines 154–156 (the file indents this JSX by four spaces; keep it as it is):

```tsx
    {/* The exercise in progress: its sheet, or its bar above the rest bar. */}
    <ExerciseSessionHost tabBarHeight={74} />
    </View>
```

with:

```tsx
    {/* The exercise in progress: its sheet, or its bar above the rest bar. */}
    <ExerciseSessionHost tabBarHeight={74} />
    {/* Web has no local notifications. */}
    {Platform.OS !== "web" && <Reminders />}
    </View>
```

`app/index.tsx` is the loader route, and the tabs mount only after AuthGate's `router.replace("/(tabs)")` (`app/_layout.tsx`). So `Reminders` runs only for a signed-in, onboarded client, and a cold-start tap navigates only after the gate has settled.

- [ ] **Step 14: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint src/utils/reminder-sync.ts src/utils/reminder-sync.test.ts src/utils/day-label.ts src/utils/day-label.test.ts src/hooks/use-membership.ts src/hooks/use-profile.ts src/hooks/use-reminder-sync.ts src/hooks/use-reminder-taps.ts "app/(tabs)/_layout.tsx" && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 192`, `ℹ suites 39`, `ℹ pass 192`, `ℹ fail 0`;
- `tsc` and `eslint` print nothing (the React Compiler rules `react-hooks/set-state-in-effect` and `react-hooks/refs` are active and pass);
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`.

- [ ] **Step 15: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/reminder-sync.ts src/utils/reminder-sync.test.ts src/utils/day-label.ts src/utils/day-label.test.ts src/hooks/use-membership.ts src/hooks/use-profile.ts src/hooks/use-reminder-sync.ts src/hooks/use-reminder-taps.ts "app/(tabs)/_layout.tsx"
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(reminders): keep reminders scheduled and open Programa on tap" -m "useReminderSync rebuilds the 14-day plan (debounced 1 s) on foreground, midnight, program/log/profile/membership, preference, language and permission changes, and only once every input has loaded (reminderSyncAction, tested); a sign-out since the timer started skips the rebuild. useReminderTaps opens Programa from a running app and from a cold start. useMembership and useProfile now also return error." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those nine files.

---

### Task 6: Onboarding permission step

**Files:**
- Modify: `app/(onboarding)/index.tsx`. The anchors were checked against `64ab056`, and the line numbers are the file's before this task (earlier steps shift later lines):
  - line 6, the `react-native` import;
  - line 17, the motion import;
  - line 25, `TOTAL_STEPS`;
  - line 127, the `saving` state;
  - line 263, the first line of the `handleSkip` comment;
  - lines 553–554, `default: return null;` of `renderStep`;
  - lines 565–574, the «Omitir» `Pressable`;
  - lines 598–600, the primary `Button`;
  - line 603, the «Atrás» `Button`.

**Interfaces:**
- Consumes:
  - `requestPermission(): Promise<PermissionStatus>` from `src/lib/notification-permission.ts` (Task 3);
  - `setReminderPrefs(patch): Promise<void>` from `src/lib/reminder-prefs.ts` (Task 3). It applies the patch in memory at once and never throws;
  - the keys `reminders.onboardingTitle`, `reminders.onboardingText`, `reminders.enable` and `reminders.notNow` (Task 4).
- Produces: no exports.
  - On native, onboarding has 6 steps and step index 5 (`REMINDERS_STEP`) is the permission step. On web it keeps 5 steps and the step can't be reached.
  - «Activar» and «Ahora no» both finish through the existing `handleSubmit`.
  - «Activar» first sets `training: true`, because the client just asked for training-day reminders. The preferences are per device and survive sign-outs, so this matters on a phone where an earlier client turned them off, or after a failed «Ahora no» save.
  - «Ahora no» first sets `training: false` (spec). Android 12 and older grant notifications without a prompt, so without it the reminders would still arrive.
  - `handleSkip` is unchanged, so skipping from steps 1–5 never shows the step and never asks. «Omitir» isn't rendered on the reminders step (spec): skipping doesn't save the profile, so it would throw away every answer the client just gave.

**Layout:** on the reminders step the bottom area has three buttons, top to bottom:
- «Activar»: primary, `lg`. It turns the training reminder on, asks, then saves.
- «Ahora no»: secondary, `lg`. It turns the training reminder off and saves without asking.
- «Atrás»: ghost.

The header shows no «Omitir» on this step. A new `enabling` state puts the spinner on «Activar» while the phone's prompt is up and during the save. «Ahora no» and «Atrás» are disabled meanwhile.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- "app/(onboarding)/index.tsx"
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`. Read `app/(onboarding)/index.tsx` in full.

- [ ] **Step 2: Add the imports**

Replace line 6:

```tsx
import { Keyboard } from "react-native";
```

with:

```tsx
import { Keyboard, Platform } from "react-native";
```

Then replace line 17:

```tsx
import { DUR, EASE_OUT, enter, exit, slideEnter } from "@/src/lib/motion";
```

with:

```tsx
import { DUR, EASE_OUT, enter, exit, slideEnter } from "@/src/lib/motion";
import { requestPermission } from "@/src/lib/notification-permission";
import { setReminderPrefs } from "@/src/lib/reminder-prefs";
```

- [ ] **Step 3: Make the step count depend on the platform**

Replace line 25:

```tsx
const TOTAL_STEPS = 5;
```

with:

```tsx
// The last step asks for notification permission, for the local reminders on
// the client's training days. Reminders don't run on web, so there the step
// is left out and the training-plan step stays the last one.
const ASKS_REMINDERS = Platform.OS !== "web";
const REMINDERS_STEP = 5;
const TOTAL_STEPS = ASKS_REMINDERS ? 6 : 5;
```

`ProgressBar` and `handleNext` already read `TOTAL_STEPS`:
- On native, «Siguiente» on the training-plan step (index 4) still runs `validateStep` case 4, then moves to step 5.
- On web, index 4 is still the last step, so its button reads «Comenzar» and calls `handleSubmit`.

- [ ] **Step 4: Add the `enabling` state and the «Activar» and «Ahora no» handlers**

Replace line 127:

```tsx
  const [saving, setSaving] = useState(false);
```

with:

```tsx
  const [saving, setSaving] = useState(false);
  // «Activar» was tapped: its button shows the spinner while the phone's
  // prompt is up and during the save that follows.
  const [enabling, setEnabling] = useState(false);
```

Then replace line 263, the first line of the comment above `handleSkip`:

```tsx
  // Skipping marks onboarding as done with an empty profile; AI features stay
```

with:

```tsx
  // «Activar»: training-day reminders on, the phone's permission prompt, then
  // the same save as «Ahora no». Onboarding finishes whatever the client
  // answers; a "no" can be turned around later in Ajustes → Notificaciones.
  // The preferences are per device, so an earlier client's "off" on this
  // phone (or a failed «Ahora no» save just before) doesn't stay.
  const handleEnableReminders = async () => {
    if (saving || enabling) return;
    setEnabling(true);
    void setReminderPrefs({ training: true });
    try {
      await requestPermission();
    } catch {
      // A prompt that fails only means no reminders; the save still runs
    }
    await handleSubmit();
    setEnabling(false);
  };

  // «Ahora no»: no prompt, and the training-day reminder off. Android 12 and
  // older allow notifications without asking, so without this the client
  // would get them anyway. Ajustes → Notificaciones turns it back on.
  const handleNotNow = async () => {
    if (saving || enabling) return;
    void setReminderPrefs({ training: false });
    await handleSubmit();
  };

  // Skipping marks onboarding as done with an empty profile; AI features stay
```

Don't change `handleSkip` itself. When `handleSubmit` succeeds it calls `router.replace("/(tabs)")`. The `setEnabling(false)` after it only matters when the save fails, because it re-enables the buttons after the error toast. `setReminderPrefs` applies the change in memory synchronously, before its AsyncStorage write, and catches a failed write. So it isn't awaited: the save starts at once, and the tabs' first rebuild already sees the new value.

- [ ] **Step 5: Render the reminders step**

In `renderStep`, replace lines 553–554:

```tsx
      default:
        return null;
```

with:

```tsx
      case REMINDERS_STEP:
        return (
          <View className="gap-6">
            <View className="w-16 h-16 bg-brand-primary-soft rounded-2xl items-center justify-center">
              <Ionicons name="notifications-outline" size={32} color={colors.brandPrimary} />
            </View>
            <View className="gap-1">
              <Text className="text-2xl font-bold text-content-primary">
                {t("reminders.onboardingTitle")}
              </Text>
              <Text className="text-content-tertiary text-base">
                {t("reminders.onboardingText")}
              </Text>
            </View>
          </View>
        );

      default:
        return null;
```

`Ionicons` (line 1) and `colors` (`const colors = useColors();`) are already in scope. `bg-brand-primary-soft` is an existing class (`src/global.css`, and already used in `app/(tabs)/index.tsx`).

- [ ] **Step 6: Swap the bottom buttons on the reminders step**

Replace lines 598–600:

```tsx
        <Button size="lg" onPress={handleNext} loading={saving}>
          {step === TOTAL_STEPS - 1 ? t("common.start") : t("common.next")}
        </Button>
```

with:

```tsx
        {step === REMINDERS_STEP ? (
          <>
            <Button
              size="lg"
              onPress={handleEnableReminders}
              loading={enabling}
              disabled={saving}
            >
              {t("reminders.enable")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onPress={handleNotNow}
              loading={saving && !enabling}
              disabled={enabling}
            >
              {t("reminders.notNow")}
            </Button>
          </>
        ) : (
          <Button size="lg" onPress={handleNext} loading={saving}>
            {step === TOTAL_STEPS - 1 ? t("common.start") : t("common.next")}
          </Button>
        )}
```

- [ ] **Step 7: Hide «Omitir» on the reminders step, and keep «Atrás» still while the prompt is up**

Replace the «Omitir» `Pressable` in the header (lines 565–574):

```tsx
        <Pressable
          accessibilityRole="button"
          onPress={handleSkip}
          disabled={saving}
          hitSlop={8}
        >
          <Text className="text-base font-semibold text-content-tertiary">
            {t("onboarding.skip")}
          </Text>
        </Pressable>
```

with:

```tsx
        {/* Not on the reminders step: skipping doesn't save the profile, so
            there it would throw away every answer the client just gave. */}
        {step !== REMINDERS_STEP && (
          <Pressable
            accessibilityRole="button"
            onPress={handleSkip}
            disabled={saving}
            hitSlop={8}
          >
            <Text className="text-base font-semibold text-content-tertiary">
              {t("onboarding.skip")}
            </Text>
          </Pressable>
        )}
```

The title next to it is `flex-1`, so the header keeps its layout without the link. On web the step index never reaches `REMINDERS_STEP`, so «Omitir» shows on every step there.

Then replace line 603, the «Atrás» button:

```tsx
          <Button variant="ghost" onPress={handleBack} disabled={saving}>
```

with:

```tsx
          <Button variant="ghost" onPress={handleBack} disabled={saving || enabling}>
```

- [ ] **Step 8: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint "app/(onboarding)/index.tsx" && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 192`, `ℹ suites 39`, `ℹ pass 192`, `ℹ fail 0`, as after Task 5 (this task adds no test; the step is a screen, checked in Task 8);
- `tsc` and `eslint` print nothing;
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`.

- [ ] **Step 9: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add "app/(onboarding)/index.tsx"
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(onboarding): ask for notifications on a last step" -m "A new last step (native only) explains the training-day reminders. «Activar» turns the training reminder on, shows the phone's prompt and then saves the profile the same way «Ahora no» does; «Ahora no» turns the training reminder off, since Android 12 and older allow notifications without asking. Web keeps the five steps." -m "«Omitir» is hidden on the new step, where skipping would discard the answers; skipping from an earlier step still saves at once without asking." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly `app/(onboarding)/index.tsx`.

---

### Task 7: Ajustes → Notificaciones card and the training-days chips

**Files:**
- Create: `src/utils/training-days.ts` (pure: read and toggle `profiles.available_days`)
- Test: `src/utils/training-days.test.ts`
- Create: `src/components/settings-row.tsx`. `SettingsRow` moves here from `settings.tsx`, now exported; only its comment changes, to add "notifications".
- Create: `src/components/notifications-card.tsx`
- Modify: `app/(tabs)/settings.tsx` (anchors checked against `64ab056`, which already has the exact-alarms row; the previous plan doesn't touch this file):
  - line 2, the React import;
  - line 7, the `CoachSection` import;
  - lines 21–51, `RowProps` and `SettingsRow` plus the blank line after them;
  - line 242, `<RestAlertCard />`.
- Modify: `src/lib/outbox.ts`: `let flushing` (line 42), the profile collapse in `enqueue` (lines 106–107), and the `try`/`catch` around `execute(op)` in `doFlush` (lines 150–166).

**Interfaces:**
- Consumes:
  - From Task 3:
    - `usePermissionStatus(): { status: PermissionStatus | null; refresh: () => void }`;
    - `requestPermission()` and `openNotificationSettings()`;
    - `useReminderPrefs()`, `setReminderPrefs(patch)` and `REMINDER_HOURS`.
  - `Program.lock_future_weeks: boolean` (previous plan).
  - Existing:
    - `useProgram()` and `useAuth().user`;
    - `useProfile(user?.id)` → `{ profile, updateProfile }`. `updateProfile(updates: Partial<Profile>)` is `mutateAsync` of a local-first upsert. It merges `updates` into the `qk.profile(userId)` cache at once, then `enqueue`s `{ table: "profiles", kind: "upsert", payload: { id, ...updates, updated_at } }`. The outbox merges consecutive profile upserts (after Step 9, never into the one it is sending) and flushes when online. Onboarding and the Progress tab's weight log use the same call;
    - `useQueryClient()` and `qk.profile(userId)`, to read the profile the last tap wrote;
    - `dayNameToIndex(value)` (`"Mon"`/`"monday"`/`"Thursday"` → 0 … 6, else −1) and `DAY_LONG_KEYS` (`"monday"` … `"sunday"`) from `src/utils/progress.ts`;
    - `PressableScale` (`haptic`, and the Pressable props, `className` included) from `@/src/lib/motion`, the base of the kit's `Chip`, and `cn` from `@/src/utils/cn`;
    - `useToast()` from `@/src/components/ui`, and `common.somethingWentWrong`;
    - `progress.dayLetters` («L,M,X,J,V,S,D» / «M,T,W,T,F,S,S») and `daysLong.*`.
  - The UI kit (`@/src/components/ui`): `Button` (variant `secondary`, `icon`, `className`), `Card`, `Chip`, `ExpandChevron`, and `Reveal` from `@/src/lib/motion`.
  - The i18n keys (Task 4): `reminders.cardTitle`, `statusOn`, `statusOff`, `enableButton`, `openSettings`, `prefTraining`, `prefInactivity`, `prefWeek`, `hour`, `daysLabel` and `noDaysHint`.
- Produces:
  - `src/utils/training-days.ts`:
    - `TRAINING_DAY_VALUES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const`;
    - `trainingDayIndexes(days: readonly string[] | null | undefined): Set<number>`;
    - `toggleTrainingDay(days: readonly string[] | null | undefined, index: number): string[]`, which returns the list in Monday-first order.
  - `export function SettingsRow({ icon, label, value, onPress, last }: RowProps)` in `src/components/settings-row.tsx`;
  - `export function NotificationsCard()` in `src/components/notifications-card.tsx`. It returns `null` on web before any hook runs.

**Layout decisions:**
- The card follows `RestAlertCard`: a `Card className="py-0"` with a `SettingsRow` header («Notificaciones · Activadas/Desactivadas») that opens a `Reveal`.
- When notifications are off, the button to turn them on sits right under the header, outside the `Reveal`, so it shows without opening the card. It is «Activar notificaciones» when undetermined and «Abrir ajustes del teléfono» when denied. The exact-alarms row in `RestAlertCard` sits outside its `Reveal` for the same reason.
- The switches are React Native's `Switch` (the repo has no switch component). They stay usable while permission is off: the prefs are per device and apply once permission is granted.
- The hour is a row «Hora del recordatorio · 8:00» that opens a wrap of `Chip`s for 5:00–22:00, written 24-hour `H:00` in both languages.
  - `SelectField` is unused in the app and its actionsheet has no scroll view for 18 rows.
  - `SearchableSelectField` would add a search box for 18 hours.
  - `SegmentedControl` can't hold 18 segments.
- The training days come last, in the spec's order: «Tus días de entreno», then the `noDaysHint` when no day is picked, then one row of seven day chips (L M X J V S D, Monday first).
  - Each chip is a `PressableScale` styled like the kit's `Chip` (filled `bg-brand-primary` when picked, `bg-surface` with a border when not). The kit's `Chip` takes no accessibility label, and one letter is ambiguous in English (T, S), so each chip is a `checkbox` named after its full weekday.
  - The chips share the row equally (`flex-1`, `h-9`, `gap-1.5`, fully rounded). They narrow on a small phone instead of overflowing or wrapping, and widen into short pills on a wide screen.
  - They show only once the profile has loaded. A tap on a profile that isn't loaded would build `available_days` on an empty stand-in.
  - The picker stays usable while permission is off. The days are the client's profile, not just the reminders' input: Progreso's planned days and the coach's panel read them too.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/training-days.ts src/utils/training-days.test.ts src/components/settings-row.tsx src/components/notifications-card.tsx "app/(tabs)/settings.tsx" src/lib/outbox.ts
```

Expected: the second command prints nothing (otherwise stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`. Read `app/(tabs)/settings.tsx`, `src/hooks/use-profile.ts`, `src/lib/outbox.ts` and `src/components/ui/chip.tsx` in full.

- [ ] **Step 2: Write the failing training-days test**

Create `src/utils/training-days.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  toggleTrainingDay,
  TRAINING_DAY_VALUES,
  trainingDayIndexes,
} from "@/src/utils/training-days";

const sorted = (set: Set<number>) => [...set].sort((a, b) => a - b);

describe("trainingDayIndexes", () => {
  it("reads the stored values the way the planner and Progreso do", () => {
    assert.deepEqual(sorted(trainingDayIndexes(["Mon", "Wed", "Fri"])), [0, 2, 4]);
  });

  it("takes other spellings of a weekday, and ignores what isn't one", () => {
    assert.deepEqual(sorted(trainingDayIndexes(["monday", "Thursday", "Lun", ""])), [0, 3]);
  });

  it("null or empty is no days", () => {
    assert.equal(trainingDayIndexes(null).size, 0);
    assert.equal(trainingDayIndexes(undefined).size, 0);
    assert.equal(trainingDayIndexes([]).size, 0);
  });
});

describe("toggleTrainingDay", () => {
  it("the stored values, Monday first", () => {
    assert.deepEqual(TRAINING_DAY_VALUES, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("adds a day in Monday-first order, as the panel stores it", () => {
    assert.deepEqual(toggleTrainingDay(["Fri", "Mon"], 2), ["Mon", "Wed", "Fri"]);
  });

  it("removes a picked day, down to none", () => {
    assert.deepEqual(toggleTrainingDay(["Mon", "Wed"], 0), ["Wed"]);
    assert.deepEqual(toggleTrainingDay(["Wed"], 2), []);
  });

  it("starts from nothing when the profile has no list", () => {
    assert.deepEqual(toggleTrainingDay(null, 6), ["Sun"]);
  });

  it("writes other spellings back as stored values and drops what isn't a weekday", () => {
    assert.deepEqual(toggleTrainingDay(["monday", "Lun"], 1), ["Mon", "Tue"]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/training-days.test.ts
```

Expected: `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …\src\utils\training-days.test.ts`, then `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 4: Write the training-days helpers**

Create `src/utils/training-days.ts`:

```ts
import { dayNameToIndex } from "@/src/utils/progress";

// profiles.available_days, the client's training days: read and toggled by
// the day chips in Ajustes → Notificaciones. Pure, so `npm test` runs it.
// The same field feeds the reminders (src/utils/reminders.ts), Progreso's
// planned days and the coach's panel, so it's written the way onboarding and
// the panel write it.

/** The stored values, Monday first, like onboarding's DAY_VALUES and the
    panel's WEEK_DAYS. */
export const TRAINING_DAY_VALUES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** The weekdays (0 = Monday … 6 = Sunday) the stored list holds, read like
    the planner and Progreso read it (dayNameToIndex): "Mon", "monday" and
    "Monday" are all Monday; anything else is no day. */
export function trainingDayIndexes(days: readonly string[] | null | undefined): Set<number> {
  return new Set((days ?? []).map(dayNameToIndex).filter((i) => i >= 0));
}

/** `days` with weekday `index` switched on or off, written back as the
    stored values in Monday-first order (so the panel, which matches them
    exactly, shows them). */
export function toggleTrainingDay(
  days: readonly string[] | null | undefined,
  index: number,
): string[] {
  const picked = trainingDayIndexes(days);
  if (picked.has(index)) picked.delete(index);
  else picked.add(index);
  return TRAINING_DAY_VALUES.filter((_, i) => picked.has(i));
}
```

- [ ] **Step 5: Run it and watch it pass**

Run the same command as Step 3. Expected: `ℹ tests 8`, `ℹ suites 2`, `ℹ pass 8`, `ℹ fail 0`.

- [ ] **Step 6: Move `SettingsRow` into its own file**

Create `src/components/settings-row.tsx`:

```tsx
import { Ionicons } from "@expo/vector-icons";
import React from "react";

import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";

type RowProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
};

// Tappable preference row: label left, current value + chevron right.
// Tapping cycles a binary setting, or opens a card's options (rest alert,
// notifications, password).
export function SettingsRow({ icon, label, value, onPress, last = false }: RowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className={`flex-row items-center gap-3 py-3.5 ${last ? "" : "border-b border-border"}`}
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-dark">
        <Ionicons name={icon} size={16} color={colors.contentSecondary} />
      </View>
      <Text className="flex-1 text-[15px] font-medium text-content-primary">{label}</Text>
      <Text className="text-sm text-content-tertiary">{value}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.contentMuted} />
    </Pressable>
  );
}
```

- [ ] **Step 7: Use the shared `SettingsRow` in `settings.tsx`**

In `app/(tabs)/settings.tsx`, delete `RowProps` and `SettingsRow` (lines 21–51). Replace:

```tsx
type RowProps = {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  value: string;
  onPress: () => void;
  last?: boolean;
};

// Tappable preference row: label left, current value + chevron right.
// Tapping cycles a binary setting, or opens a card's options (rest alert,
// password).
function SettingsRow({ icon, label, value, onPress, last = false }: RowProps) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      className={`flex-row items-center gap-3 py-3.5 ${last ? "" : "border-b border-border"}`}
    >
      <View className="h-8 w-8 items-center justify-center rounded-lg bg-brand-dark">
        <Ionicons name={icon} size={16} color={colors.contentSecondary} />
      </View>
      <Text className="flex-1 text-[15px] font-medium text-content-primary">{label}</Text>
      <Text className="text-sm text-content-tertiary">{value}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.contentMuted} />
    </Pressable>
  );
}

// Lets a client rotate the temporary password the coach created their
```

with:

```tsx
// Lets a client rotate the temporary password the coach created their
```

`React` is no longer used, so replace line 2:

```tsx
import React, { useState } from "react";
```

with:

```tsx
import { useState } from "react";
```

Then replace line 7:

```tsx
import { CoachSection } from "@/src/components/coach-section";
```

with:

```tsx
import { CoachSection } from "@/src/components/coach-section";
import { NotificationsCard } from "@/src/components/notifications-card";
import { SettingsRow } from "@/src/components/settings-row";
```

Keep the `Ionicons`, `useColors`, `Pressable`, `Text`, `View` and `Linking` imports: `RestAlertCard` (the radio icons and the exact-alarms row) and the privacy row still use them.

- [ ] **Step 8: Create the card**

Create `src/components/notifications-card.tsx`:

```tsx
import { useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Switch } from "react-native";

import { SettingsRow } from "@/src/components/settings-row";
import { Button, Card, Chip, ExpandChevron, useToast } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
import { useProfile } from "@/src/hooks/use-profile";
import { useProgram } from "@/src/hooks/use-program";
import { PressableScale, Reveal } from "@/src/lib/motion";
import {
  openNotificationSettings,
  requestPermission,
  usePermissionStatus,
} from "@/src/lib/notification-permission";
import { qk } from "@/src/lib/query-keys";
import { setReminderPrefs, useReminderPrefs } from "@/src/lib/reminder-prefs";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import type { Profile } from "@/src/types/database";
import { cn } from "@/src/utils/cn";
import { DAY_LONG_KEYS } from "@/src/utils/progress";
import { REMINDER_HOURS } from "@/src/utils/reminder-prefs";
import { toggleTrainingDay, trainingDayIndexes } from "@/src/utils/training-days";

const formatHour = (hour: number) => `${hour}:00`;

// One reminder preference: label left, native switch right.
function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const colors = useColors();
  return (
    <View className="flex-row items-center gap-3 py-2">
      <Text className="flex-1 text-[15px] text-content-primary">{label}</Text>
      <Switch
        value={value}
        onValueChange={(next) => {
          Haptics.selectionAsync().catch(() => {});
          onChange(next);
        }}
        accessibilityLabel={label}
        trackColor={{ false: colors.borderStrong, true: colors.brandPrimary }}
        thumbColor={colors.white}
        ios_backgroundColor={colors.borderStrong}
      />
    </View>
  );
}

// One weekday of the training-days picker: its letter, filled when picked,
// styled like the kit's Chip. That Chip takes no accessibility label, and a
// letter alone is ambiguous (T, S in English), so screen readers get the
// full weekday.
function DayChip({
  letter,
  name,
  selected,
  onPress,
}: {
  letter: string;
  name: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      haptic
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
      className={cn(
        "h-9 flex-1 items-center justify-center rounded-full",
        selected ? "bg-brand-primary" : "border border-border bg-surface",
      )}
    >
      <Text
        className={cn("text-sm font-semibold", selected ? "text-white" : "text-content-tertiary")}
      >
        {letter}
      </Text>
    </PressableScale>
  );
}

// Whether the phone lets the app notify, which local reminders to get (rules
// in `@/src/utils/reminders`), and on which days. The reminder choices are
// per device, like the rest-alert mode; the days are the client's profile.
// `useReminderSync` reschedules as soon as either changes.
function NotificationsCardContent() {
  const { t } = useTranslation();
  const colors = useColors();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile(user?.id);
  const { program } = useProgram();
  const prefs = useReminderPrefs();
  // Re-read when the app comes back to the foreground, so the row updates
  // after the client returns from the phone's settings, and after the prompt.
  const { status } = usePermissionStatus();
  const [open, setOpen] = useState(false);
  const [hourOpen, setHourOpen] = useState(false);

  // The client's training days, read the way the planner reads them.
  const pickedDays = trainingDayIndexes(profile?.available_days);
  const dayLetters = t("progress.dayLetters").split(",");

  // One tap switches one weekday in profiles.available_days, saved the way
  // onboarding saves it: into the cache at once, then through the outbox, so
  // it works offline too. Only that field: days_per_week stays as the client
  // or the coach set it.
  const toggleDay = (index: number) => {
    if (user == null) return;
    // The cache, not this render's profile: a second tap that lands before
    // the re-render builds on the first one.
    const current = queryClient.getQueryData<Profile | null>(qk.profile(user.id)) ?? profile;
    updateProfile({ available_days: toggleTrainingDay(current?.available_days, index) }).catch(
      () => {
        toast.show({ type: "error", message: t("common.somethingWentWrong") });
      },
    );
  };

  const statusLabel =
    status == null ? "" : t(status === "granted" ? "reminders.statusOn" : "reminders.statusOff");

  // Off: the way to turn them on sits right under the row, open or not.
  // requestPermission() makes every usePermissionStatus re-read, so the row and
  // useReminderSync both see the answer.
  const turnOn =
    status === "undetermined" ? (
      <Button
        variant="secondary"
        icon="notifications-outline"
        onPress={() => void requestPermission()}
        className="w-full"
      >
        {t("reminders.enableButton")}
      </Button>
    ) : status === "denied" ? (
      <Button
        variant="secondary"
        icon="settings-outline"
        onPress={() => void openNotificationSettings()}
        className="w-full"
      >
        {t("reminders.openSettings")}
      </Button>
    ) : null;

  return (
    <Card className="py-0">
      <SettingsRow
        icon="notifications-outline"
        label={t("reminders.cardTitle")}
        value={statusLabel}
        onPress={() => {
          setOpen((v) => !v);
          setHourOpen(false);
        }}
        last={!open || turnOn != null}
      />
      {turnOn != null && (
        <View className={`pb-3.5 ${open ? "border-b border-border" : ""}`}>{turnOn}</View>
      )}
      <Reveal open={open}>
        <View className="gap-0.5 pb-3.5 pt-1.5">
          <ToggleRow
            label={t("reminders.prefTraining")}
            value={prefs.training}
            onChange={(training) => void setReminderPrefs({ training })}
          />
          <ToggleRow
            label={t("reminders.prefInactivity")}
            value={prefs.inactivity}
            onChange={(inactivity) => void setReminderPrefs({ inactivity })}
          />
          {/* Only "Solo semana actual" programs have weeks that open later */}
          {program?.lock_future_weeks === true && (
            <ToggleRow
              label={t("reminders.prefWeek")}
              value={prefs.weekOpened}
              onChange={(weekOpened) => void setReminderPrefs({ weekOpened })}
            />
          )}

          <Pressable
            onPress={() => setHourOpen((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded: hourOpen }}
            accessibilityLabel={`${t("reminders.hour")}: ${formatHour(prefs.hour)}`}
            className="flex-row items-center gap-3 py-2.5"
          >
            <Text className="flex-1 text-[15px] text-content-primary">{t("reminders.hour")}</Text>
            <Text className="text-sm text-content-tertiary">{formatHour(prefs.hour)}</Text>
            <ExpandChevron open={hourOpen} size={16} color={colors.contentMuted} />
          </Pressable>
          <Reveal open={hourOpen} className="flex-row flex-wrap gap-2 pb-1.5">
            {REMINDER_HOURS.map((hour) => (
              <Chip
                key={hour}
                label={formatHour(hour)}
                selected={hour === prefs.hour}
                onPress={() => {
                  void setReminderPrefs({ hour });
                  setHourOpen(false);
                }}
              />
            ))}
          </Reveal>

          {/* Training days: only once the profile is in, so a tap never
              builds the list on a stand-in. Same field as onboarding, the
              panel and Progreso's planned days. */}
          {profile != null && (
            <View className="gap-2 pt-2.5">
              <Text className="text-[15px] text-content-primary">{t("reminders.daysLabel")}</Text>
              {pickedDays.size === 0 && (
                <Text className="text-[12px] leading-[17px] text-content-tertiary">
                  {t("reminders.noDaysHint")}
                </Text>
              )}
              <View className="flex-row gap-1.5">
                {DAY_LONG_KEYS.map((key, i) => (
                  <DayChip
                    key={key}
                    letter={dayLetters[i] ?? ""}
                    name={t(`daysLong.${key}`)}
                    selected={pickedDays.has(i)}
                    onPress={() => toggleDay(i)}
                  />
                ))}
              </View>
            </View>
          )}
        </View>
      </Reveal>
    </Card>
  );
}

// Ajustes → Notificaciones. Local reminders don't run on web, so the card is
// left out there.
export function NotificationsCard() {
  if (Platform.OS === "web") return null;
  return <NotificationsCardContent />;
}
```

The web early return sits in a wrapper that has no hooks, so it doesn't break the rules of hooks.

About the day chips:
- `updateProfile`'s mutation writes the cache before its own first `await`. The steps TanStack runs before it are microtasks, and mutations use `networkMode: "always"` (`src/lib/query-client.ts`), so they run offline too. The next tap, a new event, already reads the new list from `getQueryData`, and `useReminderSync` sees `available_days` change and rebuilds. Taps queued offline, or before the flush starts sending, merge into one upsert of `{ id, available_days, updated_at }`. A tap made while that upsert is in flight is queued behind it (Step 9), so no tap is lost.
- It never rejects in practice: `enqueue` only persists the queue. The `.catch` keeps a storage failure from surfacing as an unhandled rejection.
- The chips read `progress.dayLetters`, the Progress tab's Monday-first letters, split on commas the way `hero-card.tsx` does.

- [ ] **Step 9: Keep a profile edit from merging into the op being sent**

Without this, quick taps while online lose every tap after the first. `enqueue` merges a new profile upsert into any profile op still in `queue`, and `doFlush` leaves the op it is sending at `queue[0]` until `execute` returns, then calls `removeOp`. A tap made during that round-trip is merged into a payload that has already gone out, and is deleted with the op. The flush's `invalidateQueries` then refetches the server row, the chip flips back, and the reminders rebuild without that day. After this step that tap becomes its own op behind the one in flight, and the same flush sends it next.

`src/lib/outbox.ts` is CRLF; each find text below occurs exactly once. Make four replacements.

First, replace:

```ts
let flushing: Promise<void> | null = null;
```

with:

```ts
let flushing: Promise<void> | null = null;
/** The op doFlush is sending right now. A profile edit must not merge into
    it: its payload is already on its way, and the op is removed once the
    send returns, so a change merged into it would never reach the server. */
let inFlightOpId: string | null = null;
```

Second, in `enqueue`'s profile collapse, replace:

```ts
        q.kind === "upsert" &&
        q.payload.id === op.payload.id,
```

with:

```ts
        q.kind === "upsert" &&
        q.payload.id === op.payload.id &&
        q.opId !== inFlightOpId,
```

Third, in `doFlush`, replace:

```ts
    try {
      await execute(op);
    } catch (e) {
```

with:

```ts
    inFlightOpId = op.opId;
    try {
      await execute(op);
    } catch (e) {
```

Fourth, replace:

```ts
        (e as { message?: string })?.message ?? e,
      );
    }
    removeOp(op.opId);
```

with:

```ts
        (e as { message?: string })?.message ?? e,
      );
    } finally {
      inFlightOpId = null;
    }
    removeOp(op.opId);
```

The `finally` also runs on the transient-error `return`: that op stays queued and is no longer in flight, so a later edit merges into it again and goes out with its retry. `removeOp` follows `finally` synchronously, so no `enqueue` can land between them.

- [ ] **Step 10: Render the card next to «Aviso del descanso»**

In `app/(tabs)/settings.tsx`, replace line 242:

```tsx
      <RestAlertCard />
```

with:

```tsx
      <RestAlertCard />

      <NotificationsCard />
```

- [ ] **Step 11: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | tail -8 && npx tsc --noEmit && npx eslint src/utils/training-days.ts src/utils/training-days.test.ts "app/(tabs)/settings.tsx" src/components/settings-row.tsx src/components/notifications-card.tsx src/lib/outbox.ts && npm run lint 2>&1 | tail -3
```

Expected:
- `npm test` prints `ℹ tests 200`, `ℹ suites 41`, `ℹ pass 200`, `ℹ fail 0`;
- `tsc` and `eslint` print nothing;
- lint ends with `✖ 3 problems (0 errors, 3 warnings)`.

- [ ] **Step 12: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/training-days.ts src/utils/training-days.test.ts "app/(tabs)/settings.tsx" src/components/settings-row.tsx src/components/notifications-card.tsx src/lib/outbox.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(settings): Notificaciones card for local reminders" -m "Status row with a button to turn notifications on (the phone's prompt, or its settings once denied), a switch per reminder and the reminder hour. Hidden on web. SettingsRow moves to src/components/settings-row.tsx so the card can share it." -m "Training days: seven day chips (L M X J V S D) toggle profiles.available_days through useProfile's local-first update, the path onboarding uses, in Mon..Sun order like the panel; days_per_week is left alone. With no day picked the hint shows above the chips. Pure helpers in src/utils/training-days.ts, tested." -m "A profile edit no longer merges into the outbox op being sent (it was dropped with it), so quick chip taps all reach the server." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those six files.

---

### Task 8: Device check

A dev build on a real phone runs the spec's manual verification list; local notifications don't run on web. Everything marked **USER STEP** needs the user: a phone, their test client's sign-in (never type credentials yourself), and the Supabase dashboard. Ask the user to do it and report what they see.

**Files:**
- Temporary, never committed: `src/hooks/use-reminder-debug.ts`, plus two lines in `app/(tabs)/_layout.tsx` (added in Step 2, removed in Step 10).

**Interfaces:**
- Consumes everything from Tasks 1–7, and `REMINDER_CHANNEL_ID`, `REMINDER_KIND` and `REMINDER_URL` from `src/lib/reminders.ts`.
- Produces: nothing committed, except the Step 7 fallback fix if check 5 fails.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app log --oneline -8
```

Expected: `status` prints nothing, and the log shows the commits of Tasks 1–7. If the tree is clean, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.

- [ ] **Step 2: Add the temporary debug readout**

Create `src/hooks/use-reminder-debug.ts`:

```ts
// TEMPORARY: the device check (Task 8) only. Never commit this file.
import * as Notifications from "expo-notifications";
import { useEffect } from "react";

import { REMINDER_CHANNEL_ID, REMINDER_KIND, REMINDER_URL } from "@/src/lib/reminders";

const TEST_ID = "debug-reminder";
let testScheduled = false;
let last = "";

function when(trigger: unknown): string {
  const value = (trigger as { value?: number; date?: number } | null)?.value;
  const ms = value ?? (trigger as { date?: number } | null)?.date;
  return typeof ms === "number" ? new Date(ms).toString().slice(0, 21) : JSON.stringify(trigger);
}

function print(force = false) {
  void Notifications.getAllScheduledNotificationsAsync().then((all) => {
    const text = all
      .map((n) => `${n.identifier} | ${when(n.trigger)} | ${n.content.title} | ${n.content.body}`)
      .sort()
      .join("\n");
    if (!force && text === last) return;
    last = text;
    console.log(`[reminders] scheduled (${all.length}):\n${text}`);
  });
}

export function useReminderDebug() {
  useEffect(() => {
    // One test reminder a minute out, per app launch. Its id has no
    // "reminder-" prefix, so rebuilds leave it alone; the same id replaces the
    // previous launch's, and it is gone once it has fired.
    if (!testScheduled) {
      testScheduled = true;
      void Notifications.scheduleNotificationAsync({
        identifier: TEST_ID,
        content: {
          title: "Hoy toca Debug",
          body: "3 ejercicios · Semana 1",
          data: { kind: REMINDER_KIND, url: REMINDER_URL },
          sound: "default",
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + 60_000),
          channelId: REMINDER_CHANNEL_ID,
        },
      });
    }
    // Print the scheduled list whenever it changes.
    const timer = setInterval(print, 2000);
    return () => {
      clearInterval(timer);
      // After leaving the tabs (sign-out): what is still scheduled.
      setTimeout(() => print(true), 3000);
    };
  }, []);
}
```

In `app/(tabs)/_layout.tsx`, replace:

```tsx
import { useReminderTaps } from "@/src/hooks/use-reminder-taps";
```

with:

```tsx
import { useReminderDebug } from "@/src/hooks/use-reminder-debug";
import { useReminderTaps } from "@/src/hooks/use-reminder-taps";
```

and:

```tsx
  useReminderTaps();
  return null;
```

with:

```tsx
  useReminderTaps();
  useReminderDebug();
  return null;
```

Run `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`. Expected: no output.

- [ ] **Step 3: Set up the phone (USER STEP)**

1. Read the Android package id from `app.json` (branding belongs to the coach, so don't hard-code it). Each Bash call is a new shell, so every adb command below sets `PKG` first.

   ```bash
   cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && PKG=$(node -p "require('./app.json').expo.android.package") && echo $PKG
   ```

2. Start Metro. This plan adds no native code, so the existing development build works.
   - Android over USB: `adb reverse tcp:8081 tcp:8081`, then `npm start`.
   - iPhone: `npx expo start --dev-client` (LAN).

   Watch the Metro terminal for `[reminders] scheduled (…)`.

3. Android only: in Ajustes → «Aviso del descanso», if the «Alarmas y recordatorios» row shows «Permitir», allow it. Without exact alarms, Android may deliver DATE triggers minutes late, which would spoil the one-minute test reminder.

4. The test client needs all of these:
   - an active program that started today or earlier;
   - at least one exercise on every day;
   - two or more training days (`profiles.available_days`, set in onboarding, in Ajustes → Notificaciones or in the panel's «Plan de entrenamiento»);
   - no membership, or an active one.

5. To rerun onboarding with the same test client (USER STEP), set that client's `profiles.onboarding_completed` to `false` in the Supabase dashboard (project `rzgwkwxskrovxnnymxqo`, Table Editor), then relaunch the app. Only ever do this with a test client.

6. Reset the notification permission to "not asked" before each onboarding run.
   - Android 13+, then relaunch the app:

     ```bash
     cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && PKG=$(node -p "require('./app.json').expo.android.package") && adb shell pm revoke $PKG android.permission.POST_NOTIFICATIONS && adb shell pm clear-permission-flags $PKG android.permission.POST_NOTIFICATIONS user-set user-fixed
     ```

   - iPhone: delete the app and reinstall the development build.

- [ ] **Step 4: Web (step and card hidden) (USER STEP to sign in)**

Run `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run web`, open http://localhost:8081, and have the user sign in as a test client whose onboarding is pending (Step 3.5). Expected:
1. The onboarding progress bar has **5** segments. On «Plan de entrenamiento» (the 5th screen) the button reads «Comenzar», and with a day chosen it lands on Inicio. There is no reminders screen and no browser permission prompt.
2. Ajustes shows, in order: theme/language/unit, «Aviso del descanso», «Cambiar contraseña», the privacy row if set, then the coach section. There is no «Notificaciones» card.
3. The browser console shows no notification errors.

- [ ] **Step 5: Onboarding on the phone (USER STEP)**

Reset the permission and `onboarding_completed` (Step 3), then walk through onboarding.

1. The progress bar has **6** segments. On «Plan de entrenamiento» the primary button now reads «Siguiente».
2. The 6th screen shows, in order:
   - a bell tile;
   - «¿Te avisamos los días de entreno?» and the text «Te recordamos qué te toca entrenar…»;
   - «Activar» (primary), «Ahora no» (outlined) and «Atrás».

   Its header has no «Omitir» link. The five screens before it still have it.
3. «Atrás» returns to «Plan de entrenamiento» with the numbers and day chips intact, and «Siguiente» and «Omitir» come back.
4. **«Activar» → Allow.**
   - The phone's prompt appears and «Activar» shows a spinner. While the prompt is up, «Ahora no» and «Atrás» don't react.
   - After Allow, the app lands on Inicio with the success haptic.
   - Android: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && PKG=$(node -p "require('./app.json').expo.android.package") && adb shell "dumpsys package $PKG | grep POST_NOTIFICATIONS"` shows `granted=true`. iPhone: Settings → the app → Notifications is on.
   - Ajustes → Notificaciones reads «Activadas», and «Días de entreno» is **on**.
5. **Reset, «Activar» → Don't allow.** The app still lands on Inicio, and the permission is not granted.
6. **Reset, «Ahora no».** No prompt appears, the app lands on Inicio, and the permission is still not asked. In Ajustes → Notificaciones, «Días de entreno» is **off** (spec: «Ahora no» turns the training reminder off; on Android 12 and older that is what keeps reminders from arriving).
7. **Reset, «Omitir» on one of the first five screens.** No 6th screen and no prompt appear, the skip toast shows, and the app lands on Inicio.

- [ ] **Step 6: Scheduling (USER STEP)**

First grant the permission (Ajustes → Notificaciones → «Activar notificaciones» → Allow) and switch «Días de entreno» back on, since Step 5 item 6 turned it off. The prefs are then at their defaults (training on, 8:00):

1. **Plan.** About 2 s after the tabs open, Metro prints:
   - one `debug-reminder | … | Hoy toca Debug | 3 ejercicios · Semana 1` line;
   - one `reminder-YYYY-MM-DD-training | <when> | Hoy toca <day name> | <count> ejercicios · Semana <w>` line for each date in the next 14 days that falls on a profile training day and inside the program's dates (`1 ejercicio · Semana <w>` for a one-exercise day). `<when>` is the local fire time, 08:00 on that date. Android prints it as, for example, `Wed Oct 07 2026 08:00`; iOS may print the raw trigger JSON instead;
   - no `-inactivity` or `-week` lines (both are off by default);
   - never two lines with the same date.

   Today is listed only if it is before 08:00 and nothing was logged today. A day with no label and no weekday reads «Hoy toca Día n» (not the home card's «DÍA n»).
2. **Language.** In Ajustes → Idioma, choose English. Within about 3 s a new list prints with `Today: …` and `… exercises · Week …` (`1 exercise · Week …` for a one-exercise day; a day with no label or weekday reads `Today: Day n`). Switch back to Español.
3. **Log.** In Programa, check off every exercise of the day named in the first training line. Within about 3 s the list reprints, and that week's lines name the next pending day, or disappear if the week has nothing pending. Uncheck them to restore the list.
4. **Rest alert untouched.** Start a rest: the list gains one entry with a random UUID id. While it counts down, check an exercise so the reminders are rebuilt; the reprinted list still has the UUID entry. Keep the app open until 0:00: you get only the chime or vibration, and no banner.
5. **Stored preferences win (Review Focus 2).**
   - In Ajustes → Notificaciones, set «Hora del recordatorio» to 19:00. Within about 3 s every `-training` line reads 19:00.
   - Swipe the app away and reopen it. Every list printed from the relaunch on shows 19:00, and none ever shows 08:00.
   - Turn «Días de entreno» off: the `-training` lines disappear. Relaunch: still none.
   - Restore «Días de entreno» on and 8:00.
6. **Inactivity, week opened, one per date (Review Focus 6).**
   - Turn «Si llevo días sin entrenar» on. Up to two `-inactivity` lines appear, dated 4 and 7 days after the last logged training (or the start date), both within the next 14 days. If one of those dates is a training day, its `-training` line is gone: the `-inactivity` line replaces it.
   - If the program has «Solo semana actual» on, turn «Cuando se abre una semana» on. A Monday that opens a week and is a training day shows as `reminder-<date>-week | … | Tu semana <w> ya está disponible | <count> ejercicios · Semana <w>`, with no `-training` line for that date. If that Monday also has an `-inactivity` line, only the `-inactivity` line is there.
   - Every date appears on one line at most.
   - Turn both back off.

- [ ] **Step 7: Delivery and taps (USER STEP)**

1. **Foreground.** Relaunch (press `r` in Metro) and stay in the app. About 1 min later «Hoy toca Debug» arrives while the app is open.
   - iPhone: a banner.
   - Android: the status bar and shade, with sound. There is no heads-up pop-up: the channel has default importance.
2. **Tap while running.** Tap that notification. The app switches to the Programa tab.
3. **Background.** Press `r`, go straight to the home screen, and tap the notification when it arrives (about 1 min). The app opens on Programa.
4. **Android channel.** Settings → Apps → the app → Notifications lists «Recordatorios» next to the rest channel («Descanso …»). Muting «Recordatorios» leaves the rest alert working.
5. **Cold start.**
   - Press `r`, then within 60 s swipe the app away from recents. Don't use Android's "Force stop", which cancels alarms.
   - Tap the notification when it arrives. The app launches, passes the splash and AuthGate, and lands on **Programa**, not Inicio.
   - A new `debug-reminder` for 1 min later appears, because the process restarted; that is expected.
6. **No replay.** Press `r` once more. The app stays on Inicio: the old tap is not replayed.

If check 5 lands on Inicio, the cold-start `router.push` is racing the first tab render. In `src/hooks/use-reminder-taps.ts`, replace:

```ts
    openReminder(lastResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(openReminder);
    return () => sub.remove();
```

with:

```ts
    // Next tick: let the tab navigator mount before navigating inside it.
    const timer = setTimeout(() => openReminder(lastResponse()), 0);
    const sub = Notifications.addNotificationResponseReceivedListener(openReminder);
    return () => {
      clearTimeout(timer);
      sub.remove();
    };
```

Then re-run checks 5–6, run the Task 5 gate command, and commit only that file:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/hooks/use-reminder-taps.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "fix(reminders): open a cold-start reminder tap after the tabs mount" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly that file.

- [ ] **Step 8: Permission and sign-out (USER STEP)**

1. **Ajustes card, each permission state.** Reset the permission (Step 3.6) and relaunch.
   - **Not asked.** The «Notificaciones» row, under «Aviso del descanso», reads «Desactivadas», with «Activar notificaciones» right under it without opening the card. Opening it shows:
     - «Días de entreno» **on**;
     - «Si llevo días sin entrenar» **off**;
     - no «Cuando se abre una semana», unless the program has «Solo semana actual» on;
     - «Hora del recordatorio · 8:00»;
     - «Tus días de entreno» with seven chips, L M X J V S D, the profile's days filled.
   - **Tap «Activar notificaciones» → Allow.** The row reads «Activadas», the button disappears without leaving the screen, and within about 3 s Metro prints the `reminder-` lines.
   - **Denied.** Turn the app's notifications off in the phone's settings and return to the app (Android may restart it).
     - The row reads «Desactivadas» with «Abrir ajustes del teléfono».
     - On Android, if the OS can still ask, the button is «Activar notificaciones» instead.
     - Within about 3 s the printed list has no `reminder-` lines; `debug-reminder` may stay, because it isn't prefixed.
   - **Tap «Abrir ajustes del teléfono».** The app's page in the phone's settings opens. Turn notifications on and switch back. The row reads «Activadas» without navigating, and the `reminder-` lines come back.
   - **Hour.** Tap «Hora del recordatorio»: 18 chips from 5:00 to 22:00 appear, with 8:00 selected. Tap 19:00: the chips collapse and the row reads 19:00, still after a relaunch. Set it back to 8:00.
   - **Training days (Review Focus 7).** Write down the client's current days first, so they can be restored.
     - Tap a filled chip for a weekday that has `-training` lines. It empties with a light haptic, and within about 3 s the reprinted list has no `-training` line on that weekday. Tap it again: it fills and the lines come back.
     - Online, tap two empty chips well under a second apart: both are still filled 5 s later, and after a reload the panel's Resumen shows both days.
     - USER STEP in the panel: the client's Resumen («Plan de entrenamiento») shows the same days after a reload, and its «Días por semana» is unchanged. In the app, Progreso's week dots mark planned days on the picked weekdays.
     - Clear every chip. «Elige tus días de entreno para recibir recordatorios.» shows above the chips, and the reprinted list has no `-training` lines.
     - Pick the days again: the hint is gone and the lines come back.
     - Offline: turn on airplane mode, toggle a day, wait about 3 s, then swipe the app away and reopen it (still offline). The chip keeps its new state. Turn airplane mode off: a few seconds later the panel's Resumen shows the change after a reload. Restore the day.
     - With TalkBack or VoiceOver on, a chip reads its full weekday («Lunes», «Martes»…) and whether it is checked.
     - Restore the days you wrote down.
   - **Theme and language.** In light and dark themes the switch tracks and the day chips read clearly. In English the card reads "Notifications", "On"/"Off", "Training days", "Your training days", and the chips read M T W T F S S.
2. **Sign-out.** Use ⋮ → Cerrar sesión. About 3 s after the login screen shows, Metro prints the list with no `reminder-` lines.
3. **Sign-out while a rebuild is pending (Review Focus 5).**
   - Sign back in, wait for the `reminder-` lines, then check off an exercise and sign out within 1 s.
   - 3 s after the login screen, the printed list has no `reminder-` lines. Wait another 5 s: nothing reappears.

- [ ] **Step 9: Rest alert, background**

Start a rest and press Home. At 0:00 the «Descanso…» notification arrives. Rest-alert delivery is unchanged.

- [ ] **Step 10: Remove the debug readout**

Wait until the last «Hoy toca Debug» has arrived (it is a one-shot 1 min after the last launch, so nothing of it stays scheduled). Then:
- Delete `src/hooks/use-reminder-debug.ts`.
- In `app/(tabs)/_layout.tsx`, remove the `use-reminder-debug` import line and the `useReminderDebug();` line added in Step 2.

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && git status --short && npx tsc --noEmit
```

Expected: `git status --short` prints nothing (or only `src/hooks/use-reminder-taps.ts` if the Step 7 fix was needed and not yet committed), and `tsc` prints nothing.

- [ ] **Step 11: Report to the user**

Report the result of every check in Steps 4–9. Then note:
1. **Decided by the product owner:** the day chips in Ajustes, «Ahora no» turning the training reminder off, «Omitir» hidden on the last step, one reminder per date, the plural bodies and «Día n». Each is implemented as the updated spec says.
2. **Default importance, kept on purpose:** the reminders channel stays at default importance (sound and a shade entry, no heads-up pop-up). A channel's settings are fixed once it exists on a phone, so change it before release if that decision changes.
3. **One interpretation to confirm:** «Activar» also sets `training: true` (Global Constraints, "Interpretation, «Activar»"). The spec only says it shows the prompt.

- [ ] **Step 12: Nothing else to commit**

Run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short`. Expected: it prints nothing. The debug readout was never committed; only the Step 7 fix, if needed, got its own commit.
