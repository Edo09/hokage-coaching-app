# Check-off celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every exercise check-off answers with a small card that never blocks the screen (the day's progress, one true highlight, «Siguiente», «Descanso», «Deshacer»), and the day-complete modal points to the next day and lets the client tell the coach on WhatsApp, with the spec's three fixes (the sheet closes before the modal, no replay, the Programa tab's day order).

**Architecture:** The rules are pure modules in `src/utils/` (the record rule moved out of the day modal, the next exercise / next day / highlight picks, what a check-off shows, the WhatsApp summary), each with node:test tests. Two small module stores in `src/lib/` (`checkCard`: the card on screen, the 8-second burst, the days celebrated this session; `programFocus`: a day for the Programa tab to open) are read through `useSyncExternalStore`. `useCheckFeedback` decides card or modal before each row or «Terminar» write; `CheckCardHost` (mounted once in the tabs layout) renders the card; `CelebrationProvider.celebrateDay` is the single gate that opens the day modal.

**Tech Stack:** Expo SDK 57, React Native 0.86, expo-router, Reanimated through `src/lib/motion.tsx`, NativeWind through `src/tw`, react-i18next (`src/i18n/es.ts`, `en.ts`), TanStack Query, node:test (`npm test`, Node 25 type stripping).

**Spec:** docs/superpowers/specs/2026-10-01-check-celebration-design.md (where the spec leaves something open, each task lists what it decides under **Decisions**)

## Global Constraints

- Work directly on `main`: never create or switch branches, never open a PR.
- Preflight every task with `git status --short`; run `git pull --rebase` only when that prints nothing (a clean tree), and stop and ask if the task's own files already show changes.
- Every user-facing string goes in both `src/i18n/es.ts` and `src/i18n/en.ts`, word for word from the spec's Copy table (`checkCard.*`, `dayDone.*`, `_one`/`_other` plurals where it says); no hard-coded strings.
- App only: no migration, Edge Function, RLS, web panel or native dependency change; nothing needs a new dev client.
- Free programs and the «Solo semana actual» lock behave exactly as today: `weekLock`/`lockOf` are untouched, nothing writes to or shows a card on a locked week.
- Motion only through `src/lib/motion.tsx` (`enter`, `exit`, `Swap`, `PressableScale`, `DUR`, `EASE_OUT`), and nothing slides under reanimated's `useReducedMotion()`.
- The card adds no haptic of its own; «Terminar» loses the toast's Success haptic with the toast.
- White-label: no brand or Zyron copy; the coach appears only as `useCoach().coach.display_name`; colours come from `useColors()` and theme classes.
- Gate for every task: `npm test` ends with `ℹ fail 0`, `npx tsc --noEmit` prints nothing, `npm run lint` ends with exactly `✖ 3 problems (0 errors, 3 warnings)` (the baseline, all in `src/i18n/index.ts`).
- Commit at the end of each task: `git add` only that task's files, check `git diff --cached --name-only` lists exactly them, and end the message with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; pushing `main` after a task is fine (there are no push steps).
- Match every edit on its quoted text, which occurs exactly once (the files are CRLF in the working tree; match line by line), never on line numbers; another plan (`docs/superpowers/plans/2026-09-29-local-reminders.md`) may have landed first and moved lines, so re-read the file, and if a find text doesn't occur exactly once, stop and ask. Never depend on that plan's code.
- Never type credentials: the user signs in on the web build (`.claude/launch.json` "web", port 8081) and on the phone.

## Review Focus

1. The card overlapping the rest bar or the session bar (the offsets are hard-coded: 81 px and 66 px; Android font metrics may differ) → the card always sits about 8 px above whichever bars show and never covers them. Owner: Task 4 (`CheckCardHost`); checked in Task 5 Step 14 check 10 (web, four bar states) and Task 9 Step 4 check 4 (phone, largest font).
2. Auto-close against touch: a finger or mouse held on the card, released outside it, or a drag that starts on «Siguiente» → the card stays while held, closes about 5 s after release, a short drag snaps back and opens nothing. Owner: Task 4 (`CheckCardFrame`); checked in Task 5 Step 14 checks 3–4 and Task 9 Step 4 check 5.
3. Quick checks across two days, and a day finished inside a burst → «2 hechos» whose «Deshacer» unchecks both; a day finished inside a burst shows only the modal with no card under it, and the next check is a plain card. Owner: Task 3 (`noteCheck` tests: the window, a re-check, `dismiss()` ending the burst) and Task 5 (the hook and the provider); checked in Task 5 Step 14 checks 16, 18, 20 and 21.
4. «Ir al Día n» when the Programa tab has never mounted, the target is next week, or the target day was collapsed by hand → Programa opens on that week with that day open and its header near the top, and coming back to the tab later doesn't replay it. Owner: Task 7 (`programFocus` tests, the tab's consumer) and Task 8 (the trigger); checked in Task 8 Step 16 checks 3–4 and Task 9 Step 5 check 2.
5. «Contarle a {coach}» with a coach without a WhatsApp number, a phone without WhatsApp, or no connection → no button without a number; otherwise wa.me opens (in the browser as a fallback), the modal stays, nothing throws. Owner: Task 8 (`whatsappLink` tests: null without digits; `Linking.openURL(...).catch`); checked in Task 8 Step 16 checks 6–7 and Task 9 Step 5 check 4.

---

### Task 1: Shared record rule (src/utils/records.ts) used by the day modal

**Files:**
- Create: `src/utils/records.ts`
- Test: `src/utils/records.test.ts`
- Modify: `src/components/program/day-complete-modal.tsx` (line numbers at `30d3b92`):
  - the `@/src/utils/progress` import (line 37);
  - everything from `type DayRecord` (line 381) to the end of the file (line 467): the private `DayRecord`, `WeightedSet`, `isWeighted` and `bestSet`, and `daySummary`.

**Interfaces:**
- Consumes (existing, pure):
  - `e1rm(weightKg: number, reps: number): number` from `src/utils/progress.ts:706` (Epley: `weightKg * (1 + reps / 30)`).
  - `effectivePrescription(ex, week, weekNumber?).name` from `src/utils/program.ts:107`, which is `ex.exercise?.name ?? ex.custom_name ?? "—"` whatever the week.
  - Types `WorkoutSetLog`, `ProgramDayWithExercises` and `ProgramWithDetails` from `src/types/database.ts`.
- Produces (`src/utils/records.ts`, exactly):
  - `export type WeightedSet = WorkoutSetLog & { weight_kg: number; reps: number };`
  - `export function isWeighted(s: WorkoutSetLog): s is WeightedSet`. This is a type predicate: it returns a boolean and also narrows the type.
  - `export function bestSet(sets: WorkoutSetLog[]): WeightedSet | null`. It skips sets that are not weighted, so callers no longer filter first.
  - `export function exerciseRecord(input: { exerciseId: string; week: number; logs: WorkoutSetLog[]; nameOf: (programExerciseId: string) => string | null }): { weight: number; reps: number } | null`. The weight is in kg. `nameOf` may return raw names, because `exerciseRecord` trims and lowercases them itself.
  - `export function exerciseNames(program: ProgramWithDetails): (programExerciseId: string) => string | null`: the `nameOf` both callers pass (catalog name, else the exercise's own name; `""` for an exercise with neither, null for an id the program doesn't have).
  - `export function dayRecordLogs(day: ProgramDayWithExercises, exerciseId: string, week: number, setLogs: WorkoutSetLog[]): WorkoutSetLog[]`: the logs a record of `exerciseId` in `day` is weighed against. The day modal and the check card (Task 4) both hand these to `exerciseRecord`, so they agree.
  - `export type DayRecord = { name: string; weightKg: number; reps: number };`
  - `export function dayRecords(program: ProgramWithDetails, day: ProgramDayWithExercises, week: number, setLogs: WorkoutSetLog[]): DayRecord[]`. `daySummary` now returns this as its `records`.

The rule moves unchanged; it is what the modal does at `30d3b92`:
- **Weighted set**: `weight_kg` and `reps` are both non-null and above 0.
- **Best set**: the highest Epley e1rm. On an equal e1rm the heavier set wins, and on a full tie the first one wins.
- **Record** for exercise X in week W:
  - X's best set in W must beat, strictly by e1rm, the best of every other weighted log whose exercise has the same name (trimmed, lowercased) with `week_number <= W`.
  - X's own logs in W never count as "before".
  - Logs with `program_exercise_id = null`, and exercises whose name is empty or unknown, never count.
  - With nothing to beat there is no record: a first-ever log is a baseline.
- **The same session** (`dayRecordLogs`): the day's other exercises logged in week W are left out before `exerciseRecord` sees the logs. Two rows of the same lift in one day are one session, never records over each other.
  - This is what `daySummary` does today (`!(dayIds.has(...) && s.week_number === week)`).
  - `dayRecords` and the check card both filter through `dayRecordLogs`; `exerciseRecord` on unfiltered logs would count the other row, and a test pins that difference.
- `DAY_CASES` in the test has expected values captured by running the pre-move `daySummary` record code (copied verbatim from `day-complete-modal.tsx` lines 381–457) on the same fixtures. The modal's output must not change.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/records.ts src/utils/records.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "import { e1rm, muscleGroupForBodyPart }" -e "^type DayRecord" -e "^const isWeighted" -e "^function bestSet" -e "^function daySummary" -- src/components/program/day-complete-modal.tsx
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- The grep prints five lines, at 37, 381, 385, 389 and 412 at `30d3b92`. If the numbers moved but each line appears once, go on.
- If the first command prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.

- [ ] **Step 2: Write the failing tests**

Create `src/utils/records.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import {
  bestSet,
  dayRecordLogs,
  dayRecords,
  exerciseNames,
  exerciseRecord,
  isWeighted,
} from "@/src/utils/records";

/** A program exercise named through the catalog, or by a custom name. */
function ex(id: string, name: string | null, catalog = false): ProgramExercise {
  return {
    id,
    program_day_id: "",
    exercise_id: catalog ? `cat-${id}` : null,
    custom_name: catalog ? null : name,
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
    sort_order: 0,
    created_at: "",
    exercise:
      catalog && name != null
        ? {
            id: `cat-${id}`,
            name,
            video_url: null,
            body_part_id: null,
            instructions_en: null,
            instructions_es: null,
            created_at: "",
            updated_at: "",
          }
        : null,
  };
}

function day(id: string, exercises: ProgramExercise[]): ProgramDayWithExercises {
  return {
    id,
    program_id: "p",
    day_index: 1,
    label: null,
    weekday: null,
    sort_order: 0,
    created_at: "",
    program_exercises: exercises,
  };
}

let logCount = 0;
function log(
  exerciseId: string | null,
  week: number,
  weight: number | null,
  reps: number | null,
  setIndex = 1,
): WorkoutSetLog {
  logCount += 1;
  return {
    id: `log-${logCount}`,
    user_id: "u",
    program_exercise_id: exerciseId,
    week_number: week,
    date: "2026-09-07",
    set_index: setIndex,
    weight_kg: weight,
    reps,
    rir: null,
    created_at: "",
  };
}

// Day 1 has the same lift on two rows (squatA, squatB); day 2 has bench's
// lift again under another spelling, and two exercises without a name.
const PUSH = day("push", [
  ex("bench", "Press banca", true),
  ex("dips", "Fondos"),
  ex("squatA", "Sentadilla"),
  ex("squatB", "SENTADILLA"),
]);
const PULL = day("pull", [
  ex("benchAlt", " press BANCA "),
  ex("row", "Remo"),
  ex("noName", ""),
  ex("nullName", null),
]);
const PROGRAM: ProgramWithDetails = {
  id: "p",
  user_id: "u",
  assigned_by: null,
  source: "coach",
  name: "Bloque",
  description: null,
  focus: null,
  duration_weeks: 4,
  start_date: "2026-09-07",
  status: "active",
  lock_future_weeks: false,
  progression_rule: null,
  tempo_default: null,
  notes: null,
  created_at: "",
  updated_at: "",
  program_days: [PUSH, PULL],
  program_weeks: [],
};

const NAMES = new Map<string, string>([
  ["bench", "Press banca"],
  ["benchAlt", " press BANCA "],
  ["squatA", "Sentadilla"],
  ["squatB", "SENTADILLA"],
]);
const nameOf = (id: string) => NAMES.get(id) ?? null;

describe("isWeighted", () => {
  it("is true only with a weight and reps above zero", () => {
    assert.equal(isWeighted(log("bench", 1, 60, 8)), true);
    assert.equal(isWeighted(log("bench", 1, null, 8)), false);
    assert.equal(isWeighted(log("bench", 1, 60, null)), false);
    assert.equal(isWeighted(log("bench", 1, 0, 8)), false);
    assert.equal(isWeighted(log("bench", 1, 60, 0)), false);
  });
});

describe("bestSet", () => {
  it("is null when no set has a weight and reps", () => {
    assert.equal(bestSet([]), null);
    assert.equal(bestSet([log("bench", 1, null, 12), log("bench", 1, 0, 20)]), null);
  });

  it("picks the highest estimated 1RM, skipping sets without both", () => {
    const top = log("bench", 1, 100, 5, 2); // e1rm 116.7
    const sets = [log("bench", 1, 90, 8, 1), top, log("bench", 1, null, 30, 3)]; // 90×8: 114
    assert.equal(bestSet(sets), top);
  });

  it("takes the heavier set on a tie", () => {
    const heavy = log("bench", 1, 60, 10, 2); // e1rm 80
    assert.equal(bestSet([log("bench", 1, 50, 18, 1), heavy]), heavy); // 50×18: 80
    assert.equal(bestSet([heavy, log("bench", 1, 50, 18, 1)]), heavy);
  });
});

describe("exerciseRecord", () => {
  it("is a record when the week's best set beats every earlier one", () => {
    const logs = [log("bench", 1, 60, 8), log("bench", 2, 62.5, 8), log("bench", 2, 60, 8, 2)];
    assert.deepEqual(exerciseRecord({ exerciseId: "bench", week: 2, logs, nameOf }), {
      weight: 62.5,
      reps: 8,
    });
  });

  it("is null for a first-ever log (a baseline)", () => {
    const logs = [log("bench", 2, 60, 8), log("bench", 2, 62.5, 8, 2)];
    assert.equal(exerciseRecord({ exerciseId: "bench", week: 2, logs, nameOf }), null);
  });

  it("is null without a weighted set this week", () => {
    const logs = [log("bench", 1, 60, 8), log("bench", 2, null, 12)];
    assert.equal(exerciseRecord({ exerciseId: "bench", week: 2, logs, nameOf }), null);
  });

  it("compares names trimmed and in any case", () => {
    const logs = [log("benchAlt", 1, 65, 8), log("bench", 2, 62.5, 8)]; // 82.3 vs 79.2
    assert.equal(exerciseRecord({ exerciseId: "bench", week: 2, logs, nameOf }), null);
  });

  it("on unfiltered logs, counts another row of the same lift in the same week", () => {
    // Callers filter through dayRecordLogs first, which leaves that row out.
    const logs = [log("squatA", 1, 100, 5), log("squatB", 1, 110, 5)];
    assert.deepEqual(exerciseRecord({ exerciseId: "squatB", week: 1, logs, nameOf }), {
      weight: 110,
      reps: 5,
    });
  });

  it("is null when nameOf doesn't know the exercise", () => {
    const logs = [log("row", 1, 50, 8), log("row", 2, 60, 8)];
    assert.equal(exerciseRecord({ exerciseId: "row", week: 2, logs, nameOf }), null);
  });

  it("ignores logs of exercises nameOf doesn't know, and detached logs", () => {
    const logs = [
      log("row", 1, 100, 8),
      log(null, 1, 100, 8),
      log("bench", 1, 60, 8),
      log("bench", 2, 62.5, 8),
    ];
    assert.deepEqual(exerciseRecord({ exerciseId: "bench", week: 2, logs, nameOf }), {
      weight: 62.5,
      reps: 8,
    });
  });
});

describe("exerciseNames", () => {
  it("names an exercise by its catalog name, else its own; null for an id it doesn't have", () => {
    const names = exerciseNames(PROGRAM);
    assert.equal(names("bench"), "Press banca");
    assert.equal(names("dips"), "Fondos");
    assert.equal(names("nullName"), "");
    assert.equal(names("gone"), null);
  });
});

describe("dayRecordLogs", () => {
  it("leaves out only the day's other exercises logged this week", () => {
    const logs = [
      log("squatA", 1, 100, 5), // the day's other row, an earlier week: kept
      log("squatA", 2, 100, 5), // the day's other row, this week: left out
      log("squatB", 2, 110, 5), // the exercise itself: kept
      log("benchAlt", 2, 60, 8), // another day, this week: kept
      log(null, 2, 80, 5), // a detached log: kept (exerciseRecord ignores it)
    ];
    assert.deepEqual(dayRecordLogs(PUSH, "squatB", 2, logs), [logs[0], logs[2], logs[3], logs[4]]);
  });

  it("makes the check card agree with the day modal on two rows of one lift", () => {
    const logs = [log("squatA", 1, 100, 5), log("squatB", 1, 110, 5)];
    assert.equal(
      exerciseRecord({ exerciseId: "squatB", week: 1, logs: dayRecordLogs(PUSH, "squatB", 1, logs), nameOf }),
      null,
    );
    assert.deepEqual(dayRecords(PROGRAM, PUSH, 1, logs), []);
  });
});

// Expected values captured from daySummary's record logic in
// day-complete-modal.tsx before it moved here: the modal must not change.
const DAY_CASES: {
  name: string;
  day: ProgramDayWithExercises;
  week: number;
  logs: WorkoutSetLog[];
  expected: { name: string; weightKg: number; reps: number }[];
}[] = [
  {
    name: "a first-ever log is a baseline, not a record",
    day: PUSH,
    week: 1,
    logs: [log("bench", 1, 60, 8)],
    expected: [],
  },
  {
    name: "beating an earlier week is a record",
    day: PUSH,
    week: 2,
    logs: [log("bench", 1, 60, 8), log("bench", 2, 62.5, 8)],
    expected: [{ name: "Press banca", weightKg: 62.5, reps: 8 }],
  },
  {
    name: "matching the best is not a record",
    day: PUSH,
    week: 2,
    logs: [log("bench", 1, 60, 8), log("bench", 2, 60, 8)],
    expected: [],
  },
  {
    name: "the record is the best set by e1rm, the heavier on a tie",
    day: PUSH,
    week: 2,
    logs: [log("bench", 1, 55, 10), log("bench", 2, 50, 18, 1), log("bench", 2, 60, 10, 2)],
    expected: [{ name: "Press banca", weightKg: 60, reps: 10 }],
  },
  {
    name: "the same lift on another day, spelled differently, is what to beat",
    day: PUSH,
    week: 2,
    logs: [log("benchAlt", 1, 65, 8), log("bench", 2, 62.5, 8)],
    expected: [],
  },
  {
    name: "another day of the same week counts as before",
    day: PUSH,
    week: 2,
    logs: [log("benchAlt", 2, 60, 8), log("bench", 2, 62.5, 8)],
    expected: [{ name: "Press banca", weightKg: 62.5, reps: 8 }],
  },
  {
    name: "later weeks are not before",
    day: PUSH,
    week: 2,
    logs: [log("bench", 1, 60, 8), log("bench", 3, 100, 8), log("bench", 2, 62.5, 8)],
    expected: [{ name: "Press banca", weightKg: 62.5, reps: 8 }],
  },
  {
    name: "sets without a weight and reps never count",
    day: PUSH,
    week: 2,
    logs: [
      log("bench", 1, 0, 20),
      log("bench", 1, null, 10, 2),
      log("bench", 1, 40, null, 3),
      log("bench", 2, 20, 10),
    ],
    expected: [],
  },
  {
    name: "a detached log never counts",
    day: PUSH,
    week: 2,
    logs: [log(null, 1, 100, 8), log("bench", 1, 60, 8), log("bench", 2, 62.5, 8)],
    expected: [{ name: "Press banca", weightKg: 62.5, reps: 8 }],
  },
  {
    name: "two rows of the same lift in one day are not records over each other",
    day: PUSH,
    week: 1,
    logs: [log("squatA", 1, 100, 5), log("squatB", 1, 110, 5)],
    expected: [],
  },
  {
    name: "the same lift from an earlier week of the day counts",
    day: PUSH,
    week: 2,
    logs: [log("squatA", 1, 100, 5), log("squatB", 2, 105, 5)],
    expected: [{ name: "SENTADILLA", weightKg: 105, reps: 5 }],
  },
  {
    name: "several records come in the day's order",
    day: PUSH,
    week: 2,
    logs: [log("dips", 1, 20, 8), log("bench", 1, 60, 8), log("dips", 2, 25, 8), log("bench", 2, 62.5, 8)],
    expected: [
      { name: "Press banca", weightKg: 62.5, reps: 8 },
      { name: "Fondos", weightKg: 25, reps: 8 },
    ],
  },
  {
    name: "an exercise without a name never has a record",
    day: PULL,
    week: 2,
    logs: [log("noName", 1, 50, 5), log("noName", 2, 60, 5), log("nullName", 1, 50, 5), log("nullName", 2, 60, 5)],
    expected: [],
  },
];

describe("dayRecords (the day-complete modal)", () => {
  for (const c of DAY_CASES) {
    it(c.name, () => {
      assert.deepEqual(dayRecords(PROGRAM, c.day, c.week, c.logs), c.expected);
    });
  }
});
```

- [ ] **Step 3: Run the tests and check that they fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/records.test.ts`

Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …records.test.ts`, then `ℹ tests 1`, `ℹ fail 1`. The module doesn't exist yet.

- [ ] **Step 4: Write the module**

Create `src/utils/records.ts`:

```ts
import type {
  ProgramDayWithExercises,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { effectivePrescription } from "@/src/utils/program";
import { e1rm } from "@/src/utils/progress";

// Personal records from logged sets: one rule for the day-complete modal and
// the check card. Pure, no React, so `npm test` covers it.

export type WeightedSet = WorkoutSetLog & { weight_kg: number; reps: number };

/** A set with a weight and reps above zero: the only kind a record counts. */
export function isWeighted(s: WorkoutSetLog): s is WeightedSet {
  return s.weight_kg != null && s.reps != null && s.weight_kg > 0 && s.reps > 0;
}

/** Strongest weighted set by estimated 1RM, heavier weight breaking ties.
    Sets without a weight and reps are ignored; null when none has both. */
export function bestSet(sets: WorkoutSetLog[]): WeightedSet | null {
  let best: WeightedSet | null = null;
  for (const s of sets) {
    if (!isWeighted(s)) continue;
    if (
      best == null ||
      e1rm(s.weight_kg, s.reps) > e1rm(best.weight_kg, best.reps) ||
      (e1rm(s.weight_kg, s.reps) === e1rm(best.weight_kg, best.reps) && s.weight_kg > best.weight_kg)
    ) {
      best = s;
    }
  }
  return best;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * A new record for one exercise in one week, or null. The week's best set
 * (bestSet) has to beat every other weighted log of an exercise with the
 * same name (trimmed, any case: the same lift on another day counts) from
 * this week or earlier ones, this exercise's own sets this week aside. With
 * nothing to beat there is no record: a first-ever log sets a baseline.
 * `nameOf` gives a program exercise's name, null for one it doesn't know.
 */
export function exerciseRecord(input: {
  exerciseId: string;
  week: number;
  logs: WorkoutSetLog[];
  nameOf: (programExerciseId: string) => string | null;
}): { weight: number; reps: number } | null {
  const { exerciseId, week, logs, nameOf } = input;
  const name = norm(nameOf(exerciseId) ?? "");
  if (name === "") return null;
  const best = bestSet(
    logs.filter((s) => s.program_exercise_id === exerciseId && s.week_number === week),
  );
  if (best == null) return null;
  const before = bestSet(
    logs.filter(
      (s) =>
        s.program_exercise_id != null &&
        s.week_number <= week &&
        !(s.program_exercise_id === exerciseId && s.week_number === week) &&
        norm(nameOf(s.program_exercise_id) ?? "") === name,
    ),
  );
  if (before == null || e1rm(best.weight_kg, best.reps) <= e1rm(before.weight_kg, before.reps)) {
    return null;
  }
  return { weight: best.weight_kg, reps: best.reps };
}

/** Program exercise names by id, for exerciseRecord's `nameOf`: the catalog
    name, else the exercise's own ("" with neither); null for an id the
    program doesn't have. */
export function exerciseNames(program: ProgramWithDetails): (programExerciseId: string) => string | null {
  const names = new Map<string, string>();
  for (const d of program.program_days) {
    for (const e of d.program_exercises) names.set(e.id, e.exercise?.name ?? e.custom_name ?? "");
  }
  return (id) => names.get(id) ?? null;
}

/**
 * The logs a record of `exerciseId` in `day` is weighed against: the day's
 * other exercises logged this week are left out (two rows of the same lift
 * in one day are one session, not a record over each other). The day modal
 * and the check card both hand these to exerciseRecord, so they agree.
 */
export function dayRecordLogs(
  day: ProgramDayWithExercises,
  exerciseId: string,
  week: number,
  setLogs: WorkoutSetLog[],
): WorkoutSetLog[] {
  const dayIds = new Set(day.program_exercises.map((e) => e.id));
  return setLogs.filter(
    (s) =>
      s.program_exercise_id === exerciseId ||
      !(s.program_exercise_id != null && dayIds.has(s.program_exercise_id) && s.week_number === week),
  );
}

export type DayRecord = { name: string; weightKg: number; reps: number };

/** The day-complete modal's records, in the day's order: exerciseRecord for
    each exercise of the day, on dayRecordLogs. */
export function dayRecords(
  program: ProgramWithDetails,
  day: ProgramDayWithExercises,
  week: number,
  setLogs: WorkoutSetLog[],
): DayRecord[] {
  const nameOf = exerciseNames(program);
  const records: DayRecord[] = [];
  for (const ex of day.program_exercises) {
    const record = exerciseRecord({
      exerciseId: ex.id,
      week,
      logs: dayRecordLogs(day, ex.id, week, setLogs),
      nameOf,
    });
    if (record != null) {
      const name = effectivePrescription(ex, null, week).name;
      records.push({ name, weightKg: record.weight, reps: record.reps });
    }
  }
  return records;
}
```

- [ ] **Step 5: Run the tests and check that they pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/records.test.ts`

Expected: `ℹ tests 27`, `ℹ suites 6`, `ℹ pass 27`, `ℹ fail 0`.

- [ ] **Step 6: Point the modal's import at the shared module**

In `src/components/program/day-complete-modal.tsx`, find (once, line 37):

```ts
import { e1rm, muscleGroupForBodyPart } from "@/src/utils/progress";
```

Replace with:

```ts
import { muscleGroupForBodyPart } from "@/src/utils/progress";
import { dayRecords } from "@/src/utils/records";
```

- [ ] **Step 7: Replace the modal's private record code and `daySummary`**

In `src/components/program/day-complete-modal.tsx`, find everything from `type DayRecord` (line 381) to the end of the file (line 467); the working tree is CRLF, so match it line by line:

```ts
type DayRecord = { name: string; weightKg: number; reps: number };

type WeightedSet = WorkoutSetLog & { weight_kg: number; reps: number };

const isWeighted = (s: WorkoutSetLog): s is WeightedSet =>
  s.weight_kg != null && s.reps != null && s.weight_kg > 0 && s.reps > 0;

/** Strongest set by estimated 1RM, heavier weight breaking ties. */
function bestSet(sets: WeightedSet[]): WeightedSet | null {
  let best: WeightedSet | null = null;
  for (const s of sets) {
    if (
      best == null ||
      e1rm(s.weight_kg, s.reps) > e1rm(best.weight_kg, best.reps) ||
      (e1rm(s.weight_kg, s.reps) === e1rm(best.weight_kg, best.reps) && s.weight_kg > best.weight_kg)
    ) {
      best = s;
    }
  }
  return best;
}

/**
 * What the client did on this day this week. Sets: the logged ones, or the
 * prescribed count for an exercise checked off with nothing logged (the same
 * rule as the muscle map). Volume: logged weight × reps, unilateral work
 * counted per side. A record needs something to beat: the day's best set of
 * an exercise against every other logged set of that exercise (by name,
 * other days and earlier weeks), so a first-ever log sets a baseline, not a
 * record.
 */
function daySummary(
  program: ProgramWithDetails,
  day: ProgramDayWithExercises,
  weekRow: ProgramWeek | null,
  week: number,
  setLogs: WorkoutSetLog[],
) {
  const norm = (s: string) => s.trim().toLowerCase();
  const nameById = new Map<string, string>();
  for (const d of program.program_days) {
    for (const e of d.program_exercises) nameById.set(e.id, norm(e.exercise?.name ?? e.custom_name ?? ""));
  }
  const dayIds = new Set(day.program_exercises.map((e) => e.id));

  let sets = 0;
  let volumeKg = 0;
  const records: DayRecord[] = [];
  const trained = new Set<DrawnGroup>();

  for (const ex of day.program_exercises) {
    const p = effectivePrescription(ex, weekRow, week);
    const mine = setLogs.filter((s) => s.program_exercise_id === ex.id && s.week_number === week);
    sets += mine.length > 0 ? mine.length : p.sets;
    for (const s of mine) {
      if (s.weight_kg != null && s.reps != null) volumeKg += s.weight_kg * s.reps * (p.isUnilateral ? 2 : 1);
    }
    const group = muscleGroupForBodyPart(ex.exercise?.body_part?.name);
    if (group !== "other") trained.add(group);

    const name = nameById.get(ex.id);
    const best = bestSet(mine.filter(isWeighted));
    if (best == null || name == null || name === "") continue;
    const before = bestSet(
      setLogs.filter(
        (s): s is WeightedSet =>
          isWeighted(s) &&
          s.program_exercise_id != null &&
          nameById.get(s.program_exercise_id) === name &&
          s.week_number <= week &&
          !(dayIds.has(s.program_exercise_id) && s.week_number === week),
      ),
    );
    if (before != null && e1rm(best.weight_kg, best.reps) > e1rm(before.weight_kg, before.reps)) {
      records.push({ name: p.name, weightKg: best.weight_kg, reps: best.reps });
    }
  }

  return {
    exercises: day.program_exercises.length,
    sets,
    volumeKg: Math.round(volumeKg),
    records,
    // In the drawing's order, so the caption reads top to bottom.
    groups: (Object.keys(GROUP_SLUGS) as DrawnGroup[]).filter((g) => trained.has(g)),
  };
}
```

Replace with:

```ts
/**
 * What the client did on this day this week. Sets: the logged ones, or the
 * prescribed count for an exercise checked off with nothing logged (the same
 * rule as the muscle map). Volume: logged weight × reps, unilateral work
 * counted per side. Records: dayRecords (src/utils/records.ts, the rule the
 * check card shares), so a first-ever log sets a baseline, not a record.
 */
function daySummary(
  program: ProgramWithDetails,
  day: ProgramDayWithExercises,
  weekRow: ProgramWeek | null,
  week: number,
  setLogs: WorkoutSetLog[],
) {
  let sets = 0;
  let volumeKg = 0;
  const trained = new Set<DrawnGroup>();

  for (const ex of day.program_exercises) {
    const p = effectivePrescription(ex, weekRow, week);
    const mine = setLogs.filter((s) => s.program_exercise_id === ex.id && s.week_number === week);
    sets += mine.length > 0 ? mine.length : p.sets;
    for (const s of mine) {
      if (s.weight_kg != null && s.reps != null) volumeKg += s.weight_kg * s.reps * (p.isUnilateral ? 2 : 1);
    }
    const group = muscleGroupForBodyPart(ex.exercise?.body_part?.name);
    if (group !== "other") trained.add(group);
  }

  return {
    exercises: day.program_exercises.length,
    sets,
    volumeKg: Math.round(volumeKg),
    records: dayRecords(program, day, week, setLogs),
    // In the drawing's order, so the caption reads top to bottom.
    groups: (Object.keys(GROUP_SLUGS) as DrawnGroup[]).filter((g) => trained.has(g)),
  };
}
```

The blank line before `type DayRecord`, which ends `dayTitle`, stays. Sets, volume and the muscle groups are computed exactly as before; only the records now come from `dayRecords`. `WorkoutSetLog`, `ProgramWeek` and `effectivePrescription` are still used, so keep their imports.

- [ ] **Step 8: Run every test, the type check and lint**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint
```

Expected:
- `npm test`: `ℹ fail 0`. At `30d3b92` it is `ℹ tests 61` (34 before + 27); it is higher if another plan's tests have landed.
- `tsc`: no output.
- Lint: the baseline exactly, `✖ 3 problems (0 errors, 3 warnings)`, all in `src/i18n/index.ts`.
- `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "e1rm" -e "isWeighted" -e "bestSet" -- src/components/program/day-complete-modal.tsx` prints nothing.

- [ ] **Step 9: Check the modal on the web build**

1. Start the preview with `.claude/launch.json` → `"web"` (port 8081).
2. Ask the user to sign in with a test client that has an active program. Ask before logging anything on a real client's account.
3. On the Programa tab, open an exercise of the current week that has a logged set in an earlier week.
4. Log one set heavier than that week's best, then check every exercise of the day.

Expected:
- «Sellado» shows «Nuevo récord» with that exercise and its weight × reps, as before this task.
- A day whose sets are all first-ever logs shows no record card.
- Stats, muscle map and the week line are unchanged.

- [ ] **Step 10: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/records.ts src/utils/records.test.ts src/components/program/day-complete-modal.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "refactor(program): move the day modal's record rule to src/utils/records" -m "isWeighted, bestSet and the record check leave day-complete-modal.tsx so the check card can share them: exerciseRecord (one exercise in one week), dayRecordLogs (the same-session filter both callers apply, so the card and the modal agree), exerciseNames and dayRecords (the modal's list, which daySummary now returns). The modal's records are unchanged: node:test fixtures whose expected values come from the old daySummary." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those three files. If it lists anything else, unstage it with `git restore --staged <path>` before committing.

---


### Task 2: nextExercise, checkHighlight, nextDay (src/utils/check-card.ts)

**Files:**
- Create: `src/utils/check-card.ts`
- Test: `src/utils/check-card.test.ts`

**Interfaces:**
- Consumes (existing, pure):
  - `weekLock(program, week, now): WeekLock | null` (`src/utils/program.ts:61`). It returns non-null only for `lock_future_weeks` programs: before the start date, or for a week after the current one.
  - `weekOpensOn(startDate, week): string` (`src/utils/program.ts:52`), a `"YYYY-MM-DD"` date.
  - Types `ProgramDayWithExercises`, `ProgramExercise` (`superset_group?: string | null`), `ProgramWithDetails` and `WorkoutSetLog` from `src/types/database.ts`.
  - Nothing from Task 1. `checkHighlight` takes the record as an input; the caller computes it with `exerciseRecord`.
- Produces (`src/utils/check-card.ts`, exactly):
  - `export type NextExercise = { exercise: ProgramExercise; slot: string | null };`
  - `export function nextExercise(day: ProgramDayWithExercises, currentId: string, isDone: (exerciseId: string) => boolean): NextExercise | null`
  - `export type CheckHighlight = { kind: "record"; weight: number; reps: number } | { kind: "moreKg"; kg: number; week: number } | { kind: "moreReps"; reps: number; week: number } | { kind: "allSets"; done: number; total: number };` (weights and `kg` in kg)
  - `export function checkHighlight(input: { sets: WorkoutSetLog[]; previous: { week: number; sets: WorkoutSetLog[] } | null; prescribedSets: number; isDeload: boolean; record: { weight: number; reps: number } | null }): CheckHighlight | null`
  - `export type NextDay = { kind: "day"; day: ProgramDayWithExercises; week: number; sameWeek: boolean } | { kind: "locked"; week: number; opensOn: string } | { kind: "blockDone" };`
  - `export function nextDay(program: ProgramWithDetails, dayId: string, week: number, isDone: (exerciseId: string, week: number) => boolean, now?: Date): NextDay` (`now` defaults to `new Date()`)
  - The spec's Design section writes `nextExercise(day, currentId, week, isDone)`; this plan's fixed signature has no `week`: callers pass `(id) => logging.isDone(id, week)`.

**Decisions** (the spec leaves these open):
- The slot label also shows when the next exercise starts a new superset («Ahora B1: …»), not only mid-round.
- With the week done, the next-week target is that week's first *unfinished* day (its first day when the client already did them all), so a client who trained ahead isn't sent back.
- `nextDay` works inside the week it is given: finishing a day of a past week points at that past week's next unfinished day.

Rules (spec, "Content" and "Part 2"):

**`nextExercise`**
- Supersets are grouped exactly as `program-view.tsx:309-329` draws them:
  - consecutive rows of `day.program_exercises` (already in `sort_order`) with the same non-null `superset_group`;
  - a letter on one row alone, or the same letter on rows that aren't adjacent, is not a superset.
- Pick order:
  1. Inside a superset, the round's next unchecked partner: the partners after the current row, then the ones before it.
  2. Then the next unchecked row after the current one.
  3. Then the first unchecked row before it.
- Never the current row, even when `isDone` still says it's unchecked (a check not yet written). Null when nothing is left, or when `currentId` is no longer in the day.
- `slot` is `letter + 1-based position in its run` ("A2") whenever the picked row is in a superset, including the first row of a new one ("B1"); null for a straight set.

**`checkHighlight`**: first match wins.
- **Nothing logged → null.** A set counts as logged when it has a weight or reps, the set logger's rule (`program-set-logger.tsx:130-133`).
- **`record`** given → `record`.
- **Better than last time** (not on a deload week, and only with `previous`):
  - compare the top sets: the heaviest set with reps > 0, more reps breaking ties, no weight counting as 0 kg;
  - more weight → `moreKg` with the difference rounded to 0.1 kg;
  - the same weight and more reps → `moreReps`;
  - a step back never shows.
- **`prescribedSets > 0` and logged ≥ prescribed** → `allSets` with `done` = the logged count, which can exceed `total`.
- Otherwise null.

**`nextDay`**
- **Order**: `program.program_days` as fetched (`sort_order`, the Programa tab's order), skipping days without exercises. A day is unfinished when any of its exercises is not `isDone(id, week)`.
- **Same week**: the next unfinished day after `dayId`, then the first unfinished one before it → `{ kind: "day", week, sameWeek: true }`. Never `dayId` itself.
- **Week done**:
  - after the last week (`week >= duration_weeks`) → `blockDone`;
  - else, if `weekLock(program, week + 1, now)` is non-null → `{ kind: "locked", week: week + 1, opensOn: weekOpensOn(start_date, week + 1) }`. That is the week's own date, as the modal's `nextWeekOpens` line uses it today;
  - else → the first unfinished day of week + 1, or its first day when the client already did them all, as `{ kind: "day", week: week + 1, sameWeek: false }`.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/check-card.ts src/utils/check-card.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "superset_group?: string | null" -e "lock_future_weeks: boolean" -- src/types/database.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "export function weekOpensOn" -e "export function weekLock" -- src/utils/program.ts
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.
- The greps print `database.ts:201` and `:238`, and `program.ts:52` and `:61` at `30d3b92`. The line numbers may differ.

- [ ] **Step 2: Write the failing tests for `nextExercise`**

Create `src/utils/check-card.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProgramDayWithExercises, ProgramExercise } from "@/src/types/database";
import { nextExercise } from "@/src/utils/check-card";

/** A program exercise; `group` is its superset letter. */
function ex(id: string, group: string | null = null): ProgramExercise {
  return {
    id,
    program_day_id: "",
    exercise_id: null,
    custom_name: id,
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
    sort_order: 0,
    created_at: "",
    superset_group: group,
  };
}

function day(id: string, exercises: ProgramExercise[], dayIndex = 1): ProgramDayWithExercises {
  return {
    id,
    program_id: "p",
    day_index: dayIndex,
    label: null,
    weekday: null,
    sort_order: 0,
    created_at: "",
    program_exercises: exercises,
  };
}

/** Done for the listed exercise ids (nextExercise ignores the week). */
const doneIds = (...ids: string[]) => (id: string) => ids.includes(id);

describe("nextExercise", () => {
  const plain = day("d", [ex("a"), ex("b"), ex("c"), ex("d")]);

  it("goes to the next exercise in order", () => {
    assert.deepEqual(nextExercise(plain, "a", doneIds()), { exercise: plain.program_exercises[1], slot: null });
  });

  it("skips the ones already checked", () => {
    assert.equal(nextExercise(plain, "a", doneIds("b"))?.exercise.id, "c");
  });

  it("goes back to the first one skipped earlier when nothing is left after", () => {
    assert.equal(nextExercise(plain, "d", doneIds("a"))?.exercise.id, "b");
    assert.equal(nextExercise(plain, "c", doneIds("d"))?.exercise.id, "a");
  });

  it("is null when everything else is done", () => {
    assert.equal(nextExercise(plain, "d", doneIds("a", "b", "c")), null);
  });

  it("is never the current exercise, even before its check lands", () => {
    assert.equal(nextExercise(plain, "a", doneIds("b", "c", "d")), null);
  });

  it("is null when the current exercise is no longer in the day", () => {
    assert.equal(nextExercise(plain, "gone", doneIds()), null);
  });

  describe("in a superset of 2", () => {
    const d = day("d", [ex("x"), ex("a1", "A"), ex("a2", "A"), ex("y")]);

    it("goes to the partner, labelled with its slot", () => {
      assert.deepEqual(nextExercise(d, "a1", doneIds()), { exercise: d.program_exercises[2], slot: "A2" });
    });

    it("goes back to an unchecked partner before leaving the round", () => {
      assert.deepEqual(nextExercise(d, "a2", doneIds()), { exercise: d.program_exercises[1], slot: "A1" });
    });

    it("leaves the superset once the partner is done", () => {
      assert.deepEqual(nextExercise(d, "a2", doneIds("a1")), { exercise: d.program_exercises[3], slot: null });
    });
  });

  describe("in a superset of 3", () => {
    const d = day("d", [ex("b1", "B"), ex("b2", "B"), ex("b3", "B"), ex("z")]);

    it("goes round the partners in order", () => {
      assert.equal(nextExercise(d, "b1", doneIds())?.slot, "B2");
      assert.equal(nextExercise(d, "b2", doneIds())?.slot, "B3");
      assert.equal(nextExercise(d, "b3", doneIds())?.slot, "B1");
    });

    it("skips a partner already checked", () => {
      assert.deepEqual(nextExercise(d, "b1", doneIds("b2")), { exercise: d.program_exercises[2], slot: "B3" });
      assert.deepEqual(nextExercise(d, "b3", doneIds("b1")), { exercise: d.program_exercises[1], slot: "B2" });
    });

    it("leaves the superset once every partner is done", () => {
      assert.deepEqual(nextExercise(d, "b2", doneIds("b1", "b3")), { exercise: d.program_exercises[3], slot: null });
    });
  });

  it("labels the slot when the next exercise starts a superset", () => {
    const d = day("d", [ex("x"), ex("a1", "A"), ex("a2", "A"), ex("b1", "B"), ex("b2", "B")]);
    assert.equal(nextExercise(d, "x", doneIds())?.slot, "A1");
    assert.deepEqual(nextExercise(d, "a2", doneIds("a1")), { exercise: d.program_exercises[3], slot: "B1" });
  });

  it("groups only consecutive rows, as the Programa tab does", () => {
    const d = day("d", [ex("a", "A"), ex("x"), ex("a-again", "A")]);
    assert.deepEqual(nextExercise(d, "a", doneIds()), { exercise: d.program_exercises[1], slot: null });
    assert.deepEqual(nextExercise(d, "x", doneIds()), { exercise: d.program_exercises[2], slot: null });
  });

  it("treats a letter on one row alone as a straight set", () => {
    const d = day("d", [ex("x"), ex("lone", "C"), ex("y")]);
    assert.deepEqual(nextExercise(d, "x", doneIds()), { exercise: d.program_exercises[1], slot: null });
    assert.equal(nextExercise(d, "lone", doneIds())?.exercise.id, "y");
  });
});
```

- [ ] **Step 3: Run them and check that they fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-card.test.ts`

Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …check-card.test.ts`, `ℹ fail 1`.

- [ ] **Step 4: Write the module with `nextExercise`**

Create `src/utils/check-card.ts`:

```ts
import type { ProgramDayWithExercises, ProgramExercise } from "@/src/types/database";

// What the check card and the day-complete modal offer next, and the card's
// one highlight (docs/superpowers/specs/2026-10-01-check-celebration-design.md).
// Pure: no React, no clock unless passed in.

/** The exercise the card's «Siguiente» opens. `slot` ("A2") when it is a
    row of a superset, for «Ahora A2: …»; null for a straight set. */
export type NextExercise = { exercise: ProgramExercise; slot: string | null };

/** Each row's superset, as the Programa tab draws them: consecutive rows
    sharing a letter. A letter on one row alone is a straight set (null). */
function supersetRuns(rows: ProgramExercise[]): ({ start: number; end: number } | null)[] {
  const runs: ({ start: number; end: number } | null)[] = rows.map(() => null);
  let start = 0;
  while (start < rows.length) {
    const group = rows[start].superset_group ?? null;
    let end = start + 1;
    while (group != null && end < rows.length && (rows[end].superset_group ?? null) === group) end++;
    if (end - start > 1) for (let i = start; i < end; i++) runs[i] = { start, end };
    start = end;
  }
  return runs;
}

/**
 * The next exercise after `currentId` in its day: inside a superset the next
 * unchecked partner of the round (wrapping to the ones before it), then the
 * next unchecked exercise after this one, then the first unchecked one
 * before it (skipped earlier). Never the current one; null when nothing is
 * left or the current one is no longer in the day.
 */
export function nextExercise(
  day: ProgramDayWithExercises,
  currentId: string,
  isDone: (exerciseId: string) => boolean,
): NextExercise | null {
  const rows = day.program_exercises;
  const at = rows.findIndex((e) => e.id === currentId);
  if (at < 0) return null;
  const runs = supersetRuns(rows);
  const open = (i: number) => !isDone(rows[i].id);
  const pick = (i: number): NextExercise => {
    const run = runs[i];
    const slot = run != null ? `${rows[i].superset_group}${i - run.start + 1}` : null;
    return { exercise: rows[i], slot };
  };

  const run = runs[at];
  if (run != null) {
    const size = run.end - run.start;
    for (let k = 1; k < size; k++) {
      const i = run.start + ((at - run.start + k) % size);
      if (open(i)) return pick(i);
    }
  }
  for (let i = at + 1; i < rows.length; i++) if (open(i)) return pick(i);
  for (let i = 0; i < at; i++) if (open(i)) return pick(i);
  return null;
}
```

- [ ] **Step 5: Run the tests and check that they pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-card.test.ts`

Expected: `ℹ tests 15`, `ℹ suites 3`, `ℹ pass 15`, `ℹ fail 0`.

- [ ] **Step 6: Write the failing tests for `checkHighlight`**

In `src/utils/check-card.test.ts`, find:

```ts
import type { ProgramDayWithExercises, ProgramExercise } from "@/src/types/database";
import { nextExercise } from "@/src/utils/check-card";
```

Replace with:

```ts
import type { ProgramDayWithExercises, ProgramExercise, WorkoutSetLog } from "@/src/types/database";
import { checkHighlight, nextExercise } from "@/src/utils/check-card";
```

Append to the end of `src/utils/check-card.test.ts`, after a blank line:

```ts
function set(weight: number | null, reps: number | null, setIndex = 1): WorkoutSetLog {
  return {
    id: `s-${setIndex}-${weight}-${reps}`,
    user_id: "u",
    program_exercise_id: "e",
    week_number: 3,
    date: "2026-10-19",
    set_index: setIndex,
    weight_kg: weight,
    reps,
    rir: null,
    created_at: "",
  };
}

describe("checkHighlight", () => {
  const base = { sets: [], previous: null, prescribedSets: 3, isDeload: false, record: null };

  it("is null when nothing was logged", () => {
    assert.equal(checkHighlight(base), null);
    assert.equal(checkHighlight({ ...base, prescribedSets: 1, sets: [set(null, null)] }), null);
    assert.equal(checkHighlight({ ...base, record: { weight: 100, reps: 5 } }), null);
  });

  it("shows a record first", () => {
    assert.deepEqual(
      checkHighlight({
        ...base,
        sets: [set(62.5, 8, 1), set(62.5, 8, 2), set(62.5, 8, 3)],
        previous: { week: 2, sets: [set(60, 8)] },
        record: { weight: 62.5, reps: 8 },
      }),
      { kind: "record", weight: 62.5, reps: 8 },
    );
  });

  it("shows more weight on the top set than the last week logged", () => {
    assert.deepEqual(
      checkHighlight({
        ...base,
        sets: [set(62.5, 8, 1), set(62.5, 7, 2)],
        previous: { week: 2, sets: [set(60, 8, 1), set(60, 8, 2)] },
      }),
      { kind: "moreKg", kg: 2.5, week: 2 },
    );
  });

  it("rounds the extra weight to 0.1 kg", () => {
    assert.deepEqual(
      checkHighlight({ ...base, sets: [set(61.2, 8)], previous: { week: 1, sets: [set(59, 8)] } }),
      { kind: "moreKg", kg: 2.2, week: 1 },
    );
  });

  it("shows more reps at the same top weight", () => {
    assert.deepEqual(
      checkHighlight({
        ...base,
        sets: [set(60, 8, 1), set(60, 9, 2)],
        previous: { week: 2, sets: [set(60, 8, 1), set(60, 7, 2)] },
      }),
      { kind: "moreReps", reps: 1, week: 2 },
    );
  });

  it("compares the heaviest sets, not lighter ones", () => {
    assert.equal(
      checkHighlight({
        ...base,
        sets: [set(50, 12, 1), set(70, 5, 2)],
        previous: { week: 2, sets: [set(50, 10, 1), set(70, 5, 2)] },
      }),
      null,
    );
  });

  it("compares bodyweight sets on reps", () => {
    assert.deepEqual(
      checkHighlight({ ...base, sets: [set(null, 12)], previous: { week: 1, sets: [set(null, 10)] } }),
      { kind: "moreReps", reps: 2, week: 1 },
    );
    assert.deepEqual(
      checkHighlight({ ...base, sets: [set(0, 12)], previous: { week: 1, sets: [set(null, 10)] } }),
      { kind: "moreReps", reps: 2, week: 1 },
    );
  });

  it("never shows a step back", () => {
    // Less weight: no comparison; every set logged still shows.
    assert.deepEqual(
      checkHighlight({
        ...base,
        sets: [set(57.5, 10, 1), set(57.5, 10, 2), set(57.5, 10, 3)],
        previous: { week: 2, sets: [set(60, 8)] },
      }),
      { kind: "allSets", done: 3, total: 3 },
    );
    // Fewer reps at the same weight.
    assert.equal(
      checkHighlight({ ...base, sets: [set(60, 7)], previous: { week: 2, sets: [set(60, 8)] } }),
      null,
    );
  });

  it("makes no comparison on a deload week", () => {
    const previous = { week: 3, sets: [set(60, 8)] };
    assert.equal(checkHighlight({ ...base, isDeload: true, sets: [set(62.5, 8)], previous }), null);
    assert.deepEqual(
      checkHighlight({
        ...base,
        isDeload: true,
        sets: [set(62.5, 8, 1), set(62.5, 8, 2), set(62.5, 8, 3)],
        previous,
      }),
      { kind: "allSets", done: 3, total: 3 },
    );
  });

  it("still shows a record on a deload week", () => {
    assert.deepEqual(
      checkHighlight({ ...base, isDeload: true, sets: [set(100, 5)], record: { weight: 100, reps: 5 } }),
      { kind: "record", weight: 100, reps: 5 },
    );
  });

  it("ignores a last week logged without reps", () => {
    assert.equal(
      checkHighlight({ ...base, sets: [set(62.5, 8)], previous: { week: 2, sets: [set(60, null)] } }),
      null,
    );
  });

  it("shows every prescribed set logged", () => {
    assert.deepEqual(
      checkHighlight({ ...base, sets: [set(60, 8, 1), set(60, 8, 2), set(60, 8, 3)] }),
      { kind: "allSets", done: 3, total: 3 },
    );
  });

  it("counts a set with only reps or only a weight as logged", () => {
    assert.deepEqual(
      checkHighlight({ ...base, sets: [set(null, 10, 1), set(40, null, 2), set(40, 10, 3)] }),
      { kind: "allSets", done: 3, total: 3 },
    );
  });

  it("counts sets logged past the prescription", () => {
    assert.deepEqual(
      checkHighlight({ ...base, sets: [set(60, 8, 1), set(60, 8, 2), set(60, 8, 3), set(60, 6, 4)] }),
      { kind: "allSets", done: 4, total: 3 },
    );
  });

  it("is null with sets still to log, or no prescribed sets", () => {
    assert.equal(checkHighlight({ ...base, sets: [set(60, 8, 1), set(60, 8, 2)] }), null);
    assert.equal(checkHighlight({ ...base, prescribedSets: 0, sets: [set(60, 8)] }), null);
  });
});
```

- [ ] **Step 7: Run them and check that they fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-card.test.ts`

Expected: FAIL with `SyntaxError: The requested module '@/src/utils/check-card' does not provide an export named 'checkHighlight'`, `ℹ fail 1`.

- [ ] **Step 8: Add `checkHighlight`**

In `src/utils/check-card.ts`, find:

```ts
import type { ProgramDayWithExercises, ProgramExercise } from "@/src/types/database";
```

Replace with:

```ts
import type { ProgramDayWithExercises, ProgramExercise, WorkoutSetLog } from "@/src/types/database";
```

Append to the end of `src/utils/check-card.ts`, after a blank line:

```ts
/** The card's one highlight (weights in kg). */
export type CheckHighlight =
  | { kind: "record"; weight: number; reps: number }
  | { kind: "moreKg"; kg: number; week: number }
  | { kind: "moreReps"; reps: number; week: number }
  | { kind: "allSets"; done: number; total: number };

/** A set counts as logged once it holds a weight or reps (as the set logger shows it). */
const isLogged = (s: WorkoutSetLog) => s.weight_kg != null || s.reps != null;

/** The heaviest set with reps, more reps breaking ties. No weight is 0 kg
    (bodyweight), so a bodyweight exercise still compares on reps. */
function topSet(sets: WorkoutSetLog[]): { weight: number; reps: number } | null {
  let top: { weight: number; reps: number } | null = null;
  for (const s of sets) {
    if (s.reps == null || s.reps <= 0) continue;
    const weight = s.weight_kg ?? 0;
    if (top == null || weight > top.weight || (weight === top.weight && s.reps > top.reps)) {
      top = { weight, reps: s.reps };
    }
  }
  return top;
}

/**
 * What the card celebrates about a checked exercise's sets this week, first
 * match wins: a record (`record`, from exerciseRecord); more weight on the
 * top set than the last week logged (`previous`), else more reps at the same
 * top weight, never on a deload week; every prescribed set logged. Null
 * when nothing was logged or nothing is true. Never a step back.
 */
export function checkHighlight(input: {
  sets: WorkoutSetLog[];
  previous: { week: number; sets: WorkoutSetLog[] } | null;
  prescribedSets: number;
  isDeload: boolean;
  record: { weight: number; reps: number } | null;
}): CheckHighlight | null {
  const logged = input.sets.filter(isLogged);
  if (logged.length === 0) return null;
  if (input.record != null) {
    return { kind: "record", weight: input.record.weight, reps: input.record.reps };
  }
  if (!input.isDeload && input.previous != null) {
    const now = topSet(logged);
    const then = topSet(input.previous.sets);
    if (now != null && then != null) {
      if (now.weight > then.weight) {
        // Weights are stored to 0.1 kg; round away float noise (61.2 − 59).
        const kg = Math.round((now.weight - then.weight) * 10) / 10;
        return { kind: "moreKg", kg, week: input.previous.week };
      }
      if (now.weight === then.weight && now.reps > then.reps) {
        return { kind: "moreReps", reps: now.reps - then.reps, week: input.previous.week };
      }
    }
  }
  if (input.prescribedSets > 0 && logged.length >= input.prescribedSets) {
    return { kind: "allSets", done: logged.length, total: input.prescribedSets };
  }
  return null;
}
```

- [ ] **Step 9: Run the tests and check that they pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-card.test.ts`

Expected: `ℹ tests 30`, `ℹ suites 4`, `ℹ pass 30`, `ℹ fail 0`.

- [ ] **Step 10: Write the failing tests for `nextDay`**

In `src/utils/check-card.test.ts`, find:

```ts
import type { ProgramDayWithExercises, ProgramExercise, WorkoutSetLog } from "@/src/types/database";
import { checkHighlight, nextExercise } from "@/src/utils/check-card";
```

Replace with:

```ts
import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { checkHighlight, nextDay, nextExercise } from "@/src/utils/check-card";
```

Append to the end of `src/utils/check-card.test.ts`, after a blank line:

```ts
function program(
  days: ProgramDayWithExercises[],
  opts: { lock?: boolean; startDate?: string; weeks?: number } = {},
): ProgramWithDetails {
  return {
    id: "p",
    user_id: "u",
    assigned_by: null,
    source: "coach",
    name: "Bloque",
    description: null,
    focus: null,
    duration_weeks: opts.weeks ?? 4,
    start_date: opts.startDate ?? "2026-10-05",
    status: "active",
    lock_future_weeks: opts.lock ?? false,
    progression_rule: null,
    tempo_default: null,
    notes: null,
    created_at: "",
    updated_at: "",
    program_days: days,
    program_weeks: [],
  };
}

/** A local clock time on a "YYYY-MM-DD" day. */
function at(key: string, hours = 12): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, hours);
}

/** Done for every exercise of the listed days in the listed weeks; `also`
    adds single "exerciseId@week" entries. */
function doneDays(entries: [ProgramDayWithExercises, number][], also: string[] = []) {
  return (id: string, week: number) =>
    also.includes(`${id}@${week}`) ||
    entries.some(([d, w]) => w === week && d.program_exercises.some((e) => e.id === id));
}

describe("nextDay", () => {
  const d1 = day("d1", [ex("a1"), ex("a2")], 1);
  const rest = day("rest", [], 2);
  const d2 = day("d2", [ex("b1")], 3);
  const d3 = day("d3", [ex("c1"), ex("c2")], 4);
  const p = program([d1, rest, d2, d3]);

  it("goes to the next unfinished day after this one", () => {
    assert.deepEqual(nextDay(p, "d1", 1, doneDays([[d1, 1]])), { kind: "day", day: d2, week: 1, sameWeek: true });
  });

  it("skips days already done, and a partly done day is unfinished", () => {
    assert.deepEqual(nextDay(p, "d1", 1, doneDays([[d1, 1], [d2, 1]], ["c1@1"])), {
      kind: "day",
      day: d3,
      week: 1,
      sameWeek: true,
    });
  });

  it("wraps to a day skipped earlier in the week", () => {
    assert.deepEqual(nextDay(p, "d3", 1, doneDays([[d2, 1], [d3, 1]])), {
      kind: "day",
      day: d1,
      week: 1,
      sameWeek: true,
    });
  });

  it("follows the Programa tab's order, not day_index", () => {
    // Fetched by sort_order: day_index 2, 1, 3. After the second row comes
    // the third (day_index 3), not day_index 2.
    const x = day("x", [ex("x1")], 2);
    const y = day("y", [ex("y1")], 1);
    const z = day("z", [ex("z1")], 3);
    assert.deepEqual(nextDay(program([x, y, z]), "y", 1, doneDays([[y, 1]])), {
      kind: "day",
      day: z,
      week: 1,
      sameWeek: true,
    });
  });

  it("never offers the day just finished, even before its check lands", () => {
    // Only a1 is still unchecked in week 1: the day being finished.
    const isDone = doneDays([[d2, 1], [d3, 1]], ["a2@1"]);
    assert.deepEqual(nextDay(p, "d1", 1, isDone), { kind: "day", day: d1, week: 2, sameWeek: false });
  });

  it("goes to the next week's first day once this week is done", () => {
    assert.deepEqual(nextDay(p, "d3", 1, doneDays([[d1, 1], [d2, 1], [d3, 1]])), {
      kind: "day",
      day: d1,
      week: 2,
      sameWeek: false,
    });
  });

  it("starts the next week at its first unfinished day", () => {
    assert.deepEqual(nextDay(p, "d3", 1, doneDays([[d1, 1], [d2, 1], [d3, 1], [d1, 2]])), {
      kind: "day",
      day: d2,
      week: 2,
      sameWeek: false,
    });
  });

  it("skips days without exercises", () => {
    const first = program([rest, d1, d2]);
    // Every day of week 2 done too: still a training day, not the empty one.
    const isDone = doneDays([[d1, 1], [d2, 1], [d1, 2], [d2, 2]]);
    assert.deepEqual(nextDay(first, "d2", 1, isDone), { kind: "day", day: d1, week: 2, sameWeek: false });
    assert.deepEqual(nextDay(first, "d1", 1, doneDays([[d1, 1]])), {
      kind: "day",
      day: d2,
      week: 1,
      sameWeek: true,
    });
    // Nothing to train at all: nothing comes next.
    assert.deepEqual(nextDay(program([rest]), "rest", 1, doneDays([])), { kind: "blockDone" });
  });

  it("says when a locked next week opens (Solo semana actual)", () => {
    const locked = program([d1, d2], { lock: true, startDate: "2026-10-05" });
    const isDone = doneDays([[d1, 1], [d2, 1]]);
    assert.deepEqual(nextDay(locked, "d2", 1, isDone, at("2026-10-07")), {
      kind: "locked",
      week: 2,
      opensOn: "2026-10-12",
    });
    // Once the week has opened it is the next training.
    assert.deepEqual(nextDay(locked, "d2", 1, isDone, at("2026-10-12", 0)), {
      kind: "day",
      day: d1,
      week: 2,
      sameWeek: false,
    });
  });

  it("doesn't lock the next week when the program doesn't lock weeks", () => {
    const open = program([d1, d2], { lock: false, startDate: "2026-10-05" });
    assert.deepEqual(nextDay(open, "d2", 1, doneDays([[d1, 1], [d2, 1]]), at("2026-10-07")), {
      kind: "day",
      day: d1,
      week: 2,
      sameWeek: false,
    });
  });

  it("ends the block after the last week", () => {
    assert.deepEqual(nextDay(p, "d3", 4, doneDays([[d1, 4], [d2, 4], [d3, 4]])), { kind: "blockDone" });
  });

  it("still points inside the last week while a day of it is left", () => {
    assert.deepEqual(nextDay(p, "d1", 4, doneDays([[d1, 4], [d3, 4]])), {
      kind: "day",
      day: d2,
      week: 4,
      sameWeek: true,
    });
  });
});
```

- [ ] **Step 11: Run them and check that they fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-card.test.ts`

Expected: FAIL with `SyntaxError: The requested module '@/src/utils/check-card' does not provide an export named 'nextDay'`, `ℹ fail 1`.

- [ ] **Step 12: Add `nextDay`**

In `src/utils/check-card.ts`, find:

```ts
import type { ProgramDayWithExercises, ProgramExercise, WorkoutSetLog } from "@/src/types/database";
```

Replace with:

```ts
import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { weekLock, weekOpensOn } from "@/src/utils/program";
```

Append to the end of `src/utils/check-card.ts`, after a blank line:

```ts
/** Where the day-complete modal points next. */
export type NextDay =
  | { kind: "day"; day: ProgramDayWithExercises; week: number; sameWeek: boolean }
  | { kind: "locked"; week: number; opensOn: string }
  | { kind: "blockDone" };

/**
 * The next training after finishing `dayId` in `week`, in the Programa
 * tab's order (program.program_days as fetched, by sort_order; days without
 * exercises never count): the next unfinished day after this one, then the
 * first unfinished one before it. With the week done, the next week's first
 * unfinished day (its first day when the client already did them all),
 * unless "Solo semana actual" still locks it (then when it opens: the week's
 * own date, as the modal says it); after the last week, the block is done.
 */
export function nextDay(
  program: ProgramWithDetails,
  dayId: string,
  week: number,
  isDone: (exerciseId: string, week: number) => boolean,
  now: Date = new Date(),
): NextDay {
  const days = program.program_days.filter((d) => d.program_exercises.length > 0);
  const pending = (d: ProgramDayWithExercises, w: number) =>
    d.program_exercises.some((e) => !isDone(e.id, w));

  const at = days.findIndex((d) => d.id === dayId);
  const others = at < 0 ? days : [...days.slice(at + 1), ...days.slice(0, at)];
  const same = others.find((d) => pending(d, week));
  if (same != null) return { kind: "day", day: same, week, sameWeek: true };

  if (week >= program.duration_weeks) return { kind: "blockDone" };
  const next = week + 1;
  if (weekLock(program, next, now) != null) {
    return { kind: "locked", week: next, opensOn: weekOpensOn(program.start_date, next) };
  }
  const first = days.find((d) => pending(d, next)) ?? days[0];
  if (first == null) return { kind: "blockDone" };
  return { kind: "day", day: first, week: next, sameWeek: false };
}
```

- [ ] **Step 13: Run the tests and check that they pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-card.test.ts`

Expected: `ℹ tests 42`, `ℹ suites 5`, `ℹ pass 42`, `ℹ fail 0`.

Then run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: `ℹ fail 0`. At `30d3b92` plus Task 1 it is `ℹ tests 103` (61 + 42); it is higher if another plan's tests have landed.

- [ ] **Step 14: Type check and lint**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint
```

Expected:
- `tsc`: no output.
- Lint: the baseline exactly, `✖ 3 problems (0 errors, 3 warnings)`, all in `src/i18n/index.ts`.

- [ ] **Step 15: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/check-card.ts src/utils/check-card.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): next exercise, next day and check highlight helpers" -m "Pure helpers for the check card and the day modal: nextExercise (the superset round first, then the next unchecked row, then a skipped earlier one; A2-style slots), checkHighlight (record, then +kg or +reps vs the last week logged, then all sets; never a step back, no comparison on a deload week) and nextDay (the Programa tab's order, wrapping to skipped days, then the next week, the Solo semana actual lock, the block's end). node:test." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those two files. If it lists anything else, unstage it with `git restore --staged <path>` before committing.

---

### Task 3: Card store (src/lib/check-card.ts), with the 8-second batch and celebrated days tested

**Files:**
- Create: `src/lib/check-card.ts`
- Test: `src/lib/check-card.test.ts`

**Interfaces:**
- Consumes: `useSyncExternalStore` from `react`. Nothing from other tasks.
- Produces (`src/lib/check-card.ts`):
  - `export type CheckCardState = { kind: "single"; exerciseId: string; dayId: string; week: number; seconds: number | null; undoOnly: boolean } | { kind: "batch"; items: { exerciseId: string; week: number }[] } | { kind: "dayAgain"; dayId: string; week: number; exerciseId: string }`
  - `export const BATCH_WINDOW_MS = 8000` (an addition; only the tests read it).
  - `export const checkCard`:
    - `show(s)`: puts the card up, replacing any card already up (cards never stack).
    - `dismiss(opts?: { keepRun?: boolean })`: takes the card down. Plain `dismiss()`, the fixed interface, also ends the burst of quick checks. `{ keepRun: true }` (an addition) keeps the burst; only the card's own timer and the swipe use it (Task 4).
    - `get()`, `subscribe(l)`.
    - `noteCheck(exerciseId, week, nowMs)`: when the previous noted check came 8 s or less before `nowMs` and the burst then holds two or more different checks, the store puts up `{ kind: "batch", items }` itself (in order, no duplicates) and returns `"batch"`. Otherwise it leaves the card alone and returns `"single"`, so the caller calls `show(...)`. More than 8 s after the previous check, a new burst starts.
    - `markCelebrated(dayId, week)` / `wasCelebrated(dayId, week)`: held in memory for this app session.
  - `export function useCheckCard(): CheckCardState | null`

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/lib/check-card.ts src/lib/check-card.test.ts
```

Expected:
- The second command prints nothing, and neither file exists yet. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.

Read `src/lib/exercise-session.ts` and `src/lib/alert-mode.ts`: this store follows their pattern (module state, a listener set, `useSyncExternalStore`).

- [ ] **Step 2: Write the failing test**

Create `src/lib/check-card.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { BATCH_WINDOW_MS, checkCard, type CheckCardState } from "@/src/lib/check-card";

const single = (exerciseId: string, week = 2): CheckCardState => ({
  kind: "single",
  exerciseId,
  dayId: "day-1",
  week,
  seconds: null,
  undoOnly: false,
});

// The store is one module-wide card: every test starts with none up and no
// burst of checks going (dismiss() ends the burst too).
beforeEach(() => checkCard.dismiss());

describe("checkCard: show, replace, dismiss", () => {
  it("has no card up to begin with", () => {
    assert.equal(checkCard.get(), null);
  });

  it("shows a card and tells its listeners", () => {
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    const card = single("bench");
    checkCard.show(card);
    unsubscribe();
    assert.equal(checkCard.get(), card);
    assert.equal(calls, 1);
  });

  it("replaces the card that's up: cards never stack", () => {
    checkCard.show(single("bench"));
    const next = single("row");
    checkCard.show(next);
    assert.equal(checkCard.get(), next);
  });

  it("takes the card down", () => {
    checkCard.show(single("bench"));
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    checkCard.dismiss();
    unsubscribe();
    assert.equal(checkCard.get(), null);
    assert.equal(calls, 1);
  });

  it("doesn't notify for a dismiss with nothing up", () => {
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    checkCard.dismiss();
    unsubscribe();
    assert.equal(calls, 0);
  });

  it("stops notifying once unsubscribed", () => {
    let calls = 0;
    const unsubscribe = checkCard.subscribe(() => calls++);
    unsubscribe();
    checkCard.show(single("bench"));
    assert.equal(calls, 0);
  });
});

describe("checkCard.noteCheck: checks in quick succession", () => {
  it("is 8 seconds", () => {
    assert.equal(BATCH_WINDOW_MS, 8000);
  });

  it("calls a first check single and leaves the card to the caller", () => {
    assert.equal(checkCard.noteCheck("bench", 2, 1_000), "single");
    assert.equal(checkCard.get(), null);
  });

  it("collapses a second check within 8 s into a batch card with both", () => {
    checkCard.noteCheck("bench", 2, 1_000);
    checkCard.show(single("bench"));
    assert.equal(checkCard.noteCheck("row", 2, 4_000), "batch");
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "bench", week: 2 },
        { exerciseId: "row", week: 2 },
      ],
    });
  });

  it("counts exactly 8 s as within the window", () => {
    checkCard.noteCheck("bench", 2, 1_000);
    assert.equal(checkCard.noteCheck("row", 2, 9_000), "batch");
  });

  it("measures the window from the check before, not the first", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.noteCheck("row", 2, 6_000);
    assert.equal(checkCard.noteCheck("curl", 2, 12_000), "batch");
    const card = checkCard.get();
    assert.equal(card?.kind, "batch");
    assert.deepEqual(
      card?.kind === "batch" ? card.items.map((i) => i.exerciseId) : null,
      ["bench", "row", "curl"],
    );
  });

  it("starts over after more than 8 s", () => {
    checkCard.noteCheck("bench", 2, 0);
    assert.equal(checkCard.noteCheck("row", 2, 8_001), "single");
    assert.equal(checkCard.noteCheck("curl", 2, 9_000), "batch");
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "row", week: 2 },
        { exerciseId: "curl", week: 2 },
      ],
    });
  });

  it("lists an exercise checked twice in a burst once", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.noteCheck("row", 2, 1_000);
    checkCard.noteCheck("bench", 2, 2_000);
    const card = checkCard.get();
    assert.equal(card?.kind === "batch" ? card.items.length : null, 2);
  });

  it("keeps a re-check of the burst's only exercise single", () => {
    // Checked, unchecked without ending the burst (the card had closed by
    // itself), checked again: one check, not «1 hechos».
    checkCard.noteCheck("bench", 2, 0);
    assert.equal(checkCard.noteCheck("bench", 2, 3_000), "single");
    assert.equal(checkCard.get(), null);
    assert.equal(checkCard.noteCheck("row", 2, 6_000), "batch");
  });

  it("counts the same exercise in two weeks as two checks", () => {
    checkCard.noteCheck("bench", 1, 0);
    checkCard.noteCheck("bench", 2, 1_000);
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "bench", week: 1 },
        { exerciseId: "bench", week: 2 },
      ],
    });
  });

  it("ends the burst on dismiss(): the next check is single again", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.noteCheck("row", 2, 1_000);
    checkCard.dismiss();
    assert.equal(checkCard.noteCheck("curl", 2, 2_000), "single");
  });

  it("keeps the burst going through dismiss({ keepRun: true })", () => {
    checkCard.noteCheck("bench", 2, 0);
    checkCard.show(single("bench"));
    checkCard.dismiss({ keepRun: true });
    assert.equal(checkCard.get(), null);
    assert.equal(checkCard.noteCheck("row", 2, 6_000), "batch");
    assert.deepEqual(checkCard.get(), {
      kind: "batch",
      items: [
        { exerciseId: "bench", week: 2 },
        { exerciseId: "row", week: 2 },
      ],
    });
  });
});

describe("checkCard: days celebrated this session", () => {
  it("knows no day before one is marked", () => {
    assert.equal(checkCard.wasCelebrated("day-a", 1), false);
  });

  it("remembers a marked day for that week only", () => {
    checkCard.markCelebrated("day-b", 3);
    assert.equal(checkCard.wasCelebrated("day-b", 3), true);
    assert.equal(checkCard.wasCelebrated("day-b", 4), false);
    assert.equal(checkCard.wasCelebrated("day-c", 3), false);
  });

  it("keeps it through the card coming and going", () => {
    checkCard.markCelebrated("day-d", 1);
    checkCard.show(single("bench"));
    checkCard.dismiss();
    assert.equal(checkCard.wasCelebrated("day-d", 1), true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/lib/check-card.test.ts`

Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …check-card.test.ts`, then `ℹ tests 1`, `ℹ fail 1`. The module doesn't exist yet.

- [ ] **Step 4: Write the store**

Create `src/lib/check-card.ts`:

```ts
import { useSyncExternalStore } from "react";

/**
 * The card that answers a check-off: which one is up, if any. One at a time,
 * so a new check replaces the card instead of stacking a second one. The
 * host (`CheckCardHost`, mounted in the tabs layout) renders it and closes it
 * after a few seconds.
 *
 * Also the session's memory around it:
 *   - the burst of checks going on: a check within 8 s of the one before is
 *     logging after the fact, and the card collapses to a count of them;
 *   - the days whose day-complete modal already played, so re-checking a
 *     day's last exercise doesn't replay it.
 * Memory only: an app restart starts clean.
 */

export type CheckCardState =
  | {
      kind: "single";
      exerciseId: string;
      dayId: string;
      week: number;
      /** Time on its clock when «Terminar» checked it; null for a plain check. */
      seconds: number | null;
      /** Nothing but «Deshacer»: a past week, or another exercise's clock is running. */
      undoOnly: boolean;
    }
  | { kind: "batch"; items: { exerciseId: string; week: number }[] }
  | { kind: "dayAgain"; dayId: string; week: number; exerciseId: string };

/** Checks this close to the one before (ms) are one burst. */
export const BATCH_WINDOW_MS = 8000;

type Item = { exerciseId: string; week: number };

let state: CheckCardState | null = null;
/** The burst going on: its checks, and when the last one came. */
let run: { items: Item[]; lastMs: number } | null = null;
const celebrated = new Set<string>();
const listeners = new Set<() => void>();

function commit(next: CheckCardState | null) {
  state = next;
  listeners.forEach((listener) => listener());
}

const dayKey = (dayId: string, week: number) => `${dayId}|${week}`;

export const checkCard = {
  /** Put a card up, replacing the one that's up. */
  show(s: CheckCardState) {
    commit(s);
  },

  /**
   * Take the card down, and end the burst of checks (Deshacer, Siguiente, a
   * sheet opening, the day modal). The card closing by itself, or swiped
   * away, passes `keepRun`: the next quick check still collapses into the
   * count.
   */
  dismiss(opts?: { keepRun?: boolean }) {
    if (opts?.keepRun !== true) run = null;
    if (state != null) commit(null);
  },

  get(): CheckCardState | null {
    return state;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /**
   * Count a check-off. Within 8 s of the check before, it joins the burst,
   * and once the burst holds two checks the card becomes the batch («3
   * hechos»): "batch", and the card is already up. Otherwise "single": the
   * caller puts up the card it wants.
   */
  noteCheck(exerciseId: string, week: number, nowMs: number): "single" | "batch" {
    const item = { exerciseId, week };
    if (run != null && nowMs - run.lastMs <= BATCH_WINDOW_MS) {
      const known = run.items.some((i) => i.exerciseId === exerciseId && i.week === week);
      run = { items: known ? run.items : [...run.items, item], lastMs: nowMs };
      // The burst's only exercise checked again (unchecked meanwhile): one
      // check, not «1 hechos».
      if (run.items.length < 2) return "single";
      commit({ kind: "batch", items: run.items });
      return "batch";
    }
    run = { items: [item], lastMs: nowMs };
    return "single";
  },

  /** The day-complete modal played for this day and week. */
  markCelebrated(dayId: string, week: number) {
    celebrated.add(dayKey(dayId, week));
  },

  wasCelebrated(dayId: string, week: number): boolean {
    return celebrated.has(dayKey(dayId, week));
  },
};

export function useCheckCard(): CheckCardState | null {
  return useSyncExternalStore(checkCard.subscribe, checkCard.get, checkCard.get);
}
```

- [ ] **Step 5: Run the tests and the static checks**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/lib/check-card.test.ts 2>&1 | grep -E "^ℹ (tests|suites|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint 2>&1 | tail -2
```

Expected:
- The file run: `ℹ tests 20`, `ℹ suites 3`, `ℹ pass 20`, `ℹ fail 0`.
- `npm test`: `ℹ fail 0`; at `30d3b92` plus Tasks 1–2 it is `ℹ tests 123` (103 + 20), higher if another plan's tests have landed.
- `tsc` prints nothing.
- Lint ends with `✖ 3 problems (0 errors, 3 warnings)` (the baseline, all in `src/i18n/index.ts`).

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/lib/check-card.ts src/lib/check-card.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): check-off card store (8-second batch, celebrated days)" -m "src/lib/check-card.ts holds the one check card on screen (a new check replaces it), the burst of quick checks that collapses it into «n hechos» (8 s from the check before; plain dismiss ends the burst, the card's own timer keeps it) and the days whose day modal already played this session. node:test." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly `src/lib/check-card.test.ts` and `src/lib/check-card.ts`. If it lists anything else, unstage it with `git restore --staged <path>` before committing.

---

### Task 4: The card and its host (src/components/program/check-card.tsx), and the card's copy

**Files:**
- Create: `src/components/program/check-card.tsx`
- Test: `src/i18n/check-card.test.ts`
- Modify: `app/(tabs)/_layout.tsx` (line numbers at `30d3b92`):
  - the import at line 9, `import { ExerciseSessionHost } …`;
  - the mount right after line 153, `<RestTimerBar bottom={74} />`.
  - The local-reminders plan edits line 5, lines 12–13, line 59 and the `ExerciseSessionHost` … `</View>` block (lines 154–156). None of those lines is touched here, so the two plans apply in either order.
- Modify: `src/i18n/es.ts` and `src/i18n/en.ts`: a new top-level `checkCard` section, inserted before `  // Meals` / `  meals: {` (lines 362–363 at `30d3b92`). Task 8 inserts its `dayDone` section at the same anchor; each insert re-emits it.

**Interfaces:**
- Consumes:
  - Task 1, from `@/src/utils/records`: `exerciseRecord({ exerciseId, week, logs, nameOf })`, `dayRecordLogs(day, exerciseId, week, setLogs)` and `exerciseNames(program)`. The card passes the same logs and names the day modal uses, so a record on the card is a record in «Sellado».
  - Task 2, from `@/src/utils/check-card`: `nextExercise(day, currentId, isDone)` → `{ exercise, slot } | null`; `checkHighlight({ sets, previous, prescribedSets, isDeload, record })` → `CheckHighlight | null`; `type CheckHighlight`. Weights are in kg (`record.weight`, and `moreKg.kg`, a difference); the card converts them to the user's unit with `kgToUnit1`.
  - Task 3, from `@/src/lib/check-card`: `checkCard`, `useCheckCard`, `type CheckCardState`.
  - Existing:
    - `useProgram()` → `{ program }`;
    - `useProgramLogging(program)` → `{ isDone, dayProgress, setsFor, previousSetsFor, setLogs, setCompletion }`;
    - `useExerciseSession()` → `{ sheet, active }`, and `exerciseSession.open(id, week)`;
    - `useRestTimer()` → `{ running, start }`, and `formatClock(s)`;
    - `effectivePrescription`, `weekByNumber`; `kgToUnit1`, `useWeightUnit`;
    - `enter`, `exit`, `Swap`, `PressableScale`, `DUR`, `EASE_OUT` from `src/lib/motion.tsx`; `useReducedMotion`, `useSharedValue`, `useAnimatedStyle`, `withTiming` from reanimated;
    - `PanResponder` from react-native (the app has no gesture-handler root, so the swipe uses PanResponder).
- Produces:
  - `export function CheckCardHost({ bottom }: { bottom: number })`, mounted once in `app/(tabs)/_layout.tsx` with `bottom={74}` (the tab bar's height).
    - It sits 81 px higher while the rest bar shows (`REST_BAR_H`, copied from `exercise-session-host.tsx`), and 66 px higher again while the exercise-in-progress bar shows (its 58 px card plus its 8 px margin, measured on web).
    - It takes the card down when any exercise sheet opens, when the card's exercise or day is no longer in the program (the coach edited it), and when the tabs unmount.
    - The card's view has `testID="check-card"` (`data-testid` on web), for the web checks.
  - The 13 `checkCard.*` keys, es and en, exactly as in the spec's Copy table, including `checkCard.sheetNext` (Task 6) and `next`/`nextSuperset` (Tasks 4 and 6).
  - Card behaviour:
    - It closes itself 5 s after it last changed, with `dismiss({ keepRun: true })`. A finger or mouse button held on the card holds it there; letting go gives it the full 5 s again.
    - A downward drag of more than 40 px, or a flick faster than 0.5 px/ms, closes it (also `keepRun`). A shorter drag snaps back.
    - «Siguiente» calls `dismiss()`, then `exerciseSession.open(next, week)`. It starts nothing.
    - «Descanso» calls `useRestTimer().start(restSeconds, name)`. The card stays up, and the button hides because a rest is running.
    - «Deshacer» calls `dismiss()`, then `setCompletion(false)`: for the one exercise (single, dayAgain) or for every item, one after another (batch).
    - A batch card shows `items.length`. No haptic anywhere on the card. Under reduced motion there is no slide.

**Decisions** (the spec leaves these open):
- Letting go of the card restarts the full 5 s rather than resuming what was left.
- «Descanso» doesn't close the card, so «Siguiente» stays one tap away.
- A deload week is no baseline for «+… vs semana w» either: when the last week logged before this one was a deload week, the card makes no comparison (the highlight falls through to «n de n series»). Drop the two `prev`/`previous` lines in `SingleCard` and pass `previousSetsFor(...)` straight through if the owner prefers the literal reading.
- «n de n series» counts every logged set, so it can read «4 de 3 series» when the client logged more than prescribed.
- `CheckCardHost` calls `useProgram()`, which opens one more `programs` realtime channel, as `ExerciseSessionHost` already does (channel names are unique, so this is harmless).

Nothing shows the card until Task 5 wires the triggers, so this task ends with static checks; Task 5 Step 14 checks the card on the web build.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/components/program/check-card.tsx src/i18n/check-card.test.ts "app/(tabs)/_layout.tsx" src/i18n/es.ts src/i18n/en.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "export function dayRecordLogs" -e "export function exerciseNames" -e "export function exerciseRecord" -e "export function nextExercise" -e "export function checkHighlight" -e "export const checkCard" -- src/utils/records.ts src/utils/check-card.ts src/lib/check-card.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "checkCard: {" -- src/i18n/es.ts src/i18n/en.ts
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.
- The first grep prints six lines (Tasks 1–3 are in). If one is missing, stop: its task comes first.
- The last grep prints nothing and exits with status 1: there is no `checkCard` section yet. That is expected.

Read in full: `src/components/program/rest-timer-bar.tsx`, `src/components/program/exercise-session-host.tsx` (for `REST_BAR_H` and when its bar shows) and `src/lib/motion.tsx`.

- [ ] **Step 2: Write the failing copy test**

Create `src/i18n/check-card.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The check card's copy: the spec's Copy table
// (docs/superpowers/specs/2026-10-01-check-celebration-design.md, checkCard.*)
// word for word. [key, es, en].
const COPY: [string, string, string][] = [
  ["progress", "{{done}}/{{total}}", "{{done}}/{{total}}"],
  ["time", "en {{time}}", "in {{time}}"],
  ["record", "Récord: {{weight}} × {{reps}}", "Record: {{weight}} × {{reps}}"],
  ["moreKg", "+{{kg}} vs semana {{w}}", "+{{kg}} vs week {{w}}"],
  ["moreReps", "+{{reps}} reps vs semana {{w}}", "+{{reps}} reps vs week {{w}}"],
  ["allSets", "{{done}} de {{total}} series", "{{done}} of {{total}} sets"],
  ["next", "Siguiente: {{name}}", "Next: {{name}}"],
  ["nextSuperset", "Ahora {{slot}}: {{name}}", "Now {{slot}}: {{name}}"],
  ["rest", "Descanso {{time}}", "Rest {{time}}"],
  ["undo", "Deshacer", "Undo"],
  ["batch", "{{count}} hechos", "{{count}} done"],
  ["dayAgain", "Día {{n}} completo", "Day {{n}} complete"],
  ["sheetNext", "Siguiente →", "Next →"],
];

describe("checkCard copy", () => {
  it("es has exactly these keys and texts", () => {
    assert.deepEqual({ ...es.checkCard }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly these keys and texts", () => {
    assert.deepEqual({ ...en.checkCard }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/i18n/check-card.test.ts`

Expected: `ℹ tests 2`, `ℹ suites 1`, `ℹ pass 0`, `ℹ fail 2`, each with `AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal`: there is no `checkCard` section yet.

- [ ] **Step 4: Add the Spanish copy**

In `src/i18n/es.ts`, find:

```ts
  // Meals
  meals: {
```

Replace with:

```ts
  // Check-off card
  checkCard: {
    progress: "{{done}}/{{total}}",
    time: "en {{time}}",
    record: "Récord: {{weight}} × {{reps}}",
    moreKg: "+{{kg}} vs semana {{w}}",
    moreReps: "+{{reps}} reps vs semana {{w}}",
    allSets: "{{done}} de {{total}} series",
    next: "Siguiente: {{name}}",
    nextSuperset: "Ahora {{slot}}: {{name}}",
    rest: "Descanso {{time}}",
    undo: "Deshacer",
    batch: "{{count}} hechos",
    dayAgain: "Día {{n}} completo",
    sheetNext: "Siguiente →",
  },

  // Meals
  meals: {
```

- [ ] **Step 5: Add the English copy**

In `src/i18n/en.ts`, find:

```ts
  // Meals
  meals: {
```

Replace with:

```ts
  // Check-off card
  checkCard: {
    progress: "{{done}}/{{total}}",
    time: "in {{time}}",
    record: "Record: {{weight}} × {{reps}}",
    moreKg: "+{{kg}} vs week {{w}}",
    moreReps: "+{{reps}} reps vs week {{w}}",
    allSets: "{{done}} of {{total}} sets",
    next: "Next: {{name}}",
    nextSuperset: "Now {{slot}}: {{name}}",
    rest: "Rest {{time}}",
    undo: "Undo",
    batch: "{{count}} done",
    dayAgain: "Day {{n}} complete",
    sheetNext: "Next →",
  },

  // Meals
  meals: {
```

- [ ] **Step 6: Run the copy test again**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/i18n/check-card.test.ts`

Expected: `ℹ tests 2`, `ℹ suites 1`, `ℹ pass 2`, `ℹ fail 0`.

- [ ] **Step 7: Create the card and its host**

Create `src/components/program/check-card.tsx`:

```tsx
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { PanResponder } from "react-native";
import {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { useProgram } from "@/src/hooks/use-program";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { checkCard, type CheckCardState, useCheckCard } from "@/src/lib/check-card";
import { exerciseSession, useExerciseSession } from "@/src/lib/exercise-session";
import { DUR, EASE_OUT, enter, exit, PressableScale, Swap } from "@/src/lib/motion";
import { kgToUnit1, useWeightUnit } from "@/src/lib/weight-unit";
import { formatClock, useRestTimer } from "@/src/providers/rest-timer-provider";
import { useColors } from "@/src/theme/colors";
import { Pressable, Text, View } from "@/src/tw";
import { AnimatedView } from "@/src/tw/animated";
import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWithDetails,
} from "@/src/types/database";
import { checkHighlight, type CheckHighlight, nextExercise } from "@/src/utils/check-card";
import { effectivePrescription, weekByNumber } from "@/src/utils/program";
import { dayRecordLogs, exerciseNames, exerciseRecord } from "@/src/utils/records";

/** The floating rest bar's footprint (REST_BAR_H in exercise-session-host.tsx). */
const REST_BAR_H = 81;
/** The exercise-in-progress bar's footprint: its card (a 36px button, py-2.5
    and a 1px border: 58) + its 8px bottom margin. */
const SESSION_BAR_H = 66;
/** How long a card stays up with no finger on it. */
const AUTO_CLOSE_MS = 5000;
/** A drag down this far (px), or a flick this fast (px/ms), swipes it away. */
const SWIPE_CLOSE_PX = 40;
const SWIPE_CLOSE_VY = 0.5;

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** An exercise of the program and the day it's in; null once the coach removed it. */
function locate(
  program: ProgramWithDetails,
  exerciseId: string,
): { exercise: ProgramExercise; day: ProgramDayWithExercises } | null {
  for (const day of program.program_days) {
    const exercise = day.program_exercises.find((e) => e.id === exerciseId);
    if (exercise != null) return { exercise, day };
  }
  return null;
}

/** Whether the program still has what the card is about (the coach may edit meanwhile). */
function renderable(card: CheckCardState, program: ProgramWithDetails): boolean {
  if (card.kind === "single") return locate(program, card.exerciseId) != null;
  if (card.kind === "dayAgain") return program.program_days.some((d) => d.id === card.dayId);
  return card.items.length > 0;
}

/** What the card is about: a new one swaps its content in; the batch growing doesn't. */
function contentKey(card: CheckCardState): string {
  if (card.kind === "batch") return "batch";
  if (card.kind === "dayAgain") return `day|${card.dayId}|${card.week}`;
  return `${card.exerciseId}|${card.week}`;
}

/**
 * The card that answers a check-off (`@/src/lib/check-card`): rendered once,
 * in the tabs layout, so it floats over whichever tab the check came from.
 * Clear of the tab bar (`bottom`), and above the rest bar and the
 * exercise-in-progress bar when they show. No backdrop: the screen stays
 * usable underneath.
 */
export function CheckCardHost({ bottom }: { bottom: number }) {
  const card = useCheckCard();
  const session = useExerciseSession();
  const rest = useRestTimer();
  const { program } = useProgram();

  // An exercise sheet opening covers the card: take it down. And none is
  // left behind for the next sign-in when the tabs unmount.
  useEffect(() => {
    if (session.sheet != null) checkCard.dismiss();
  }, [session.sheet]);
  useEffect(() => () => checkCard.dismiss(), []);

  // A card the program no longer has (the coach removed the exercise or the
  // day) renders nothing: drop it, so it can't come back or join a batch.
  const stale = card != null && program != null && !renderable(card, program);
  useEffect(() => {
    if (stale) checkCard.dismiss();
  }, [stale]);

  // The same condition ExerciseSessionHost shows its bar on.
  const sessionBar =
    session.sheet == null &&
    session.active != null &&
    program != null &&
    locate(program, session.active.exerciseId) != null;
  const offset = bottom + (rest.running ? REST_BAR_H : 0) + (sessionBar ? SESSION_BAR_H : 0);

  return (
    <View
      pointerEvents="box-none"
      style={{ position: "absolute", left: 0, right: 0, bottom: offset, zIndex: 50 }}
    >
      {card != null && program != null && renderable(card, program) && (
        <CheckCardFrame card={card} program={program} />
      )}
    </View>
  );
}

/**
 * Slides up, closes by itself after ~5 s or with a swipe down. A finger on
 * the card holds it (letting go gives it the full time again); a new check
 * restarts the time. No haptic: the check already gave one.
 */
function CheckCardFrame({ card, program }: { card: CheckCardState; program: ProgramWithDetails }) {
  const reduced = useReducedMotion();
  const [touching, setTouching] = useState(false);
  const drag = useSharedValue(0);

  useEffect(() => {
    if (touching) return;
    const id = setTimeout(() => checkCard.dismiss({ keepRun: true }), AUTO_CLOSE_MS);
    return () => clearTimeout(id);
  }, [card, touching]);

  // Vertical drags only, so taps still reach the buttons; a drag that starts
  // on a button takes over from it.
  const pan = useMemo(() => {
    const settle = () =>
      drag.set(reduced ? 0 : withTiming(0, { duration: DUR.fast, easing: EASE_OUT }));
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && g.dy > Math.abs(g.dx),
      onPanResponderMove: (_, g) => drag.set(Math.max(0, g.dy)),
      onPanResponderRelease: (_, g) => {
        if (g.dy > SWIPE_CLOSE_PX || g.vy > SWIPE_CLOSE_VY) checkCard.dismiss({ keepRun: true });
        else settle();
      },
      onPanResponderTerminate: settle,
    });
  }, [drag, reduced]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));

  const hold = () => setTouching(true);
  const release = () => setTouching(false);

  return (
    // Entrance and exit on their own view: the drag owns the inner one's transform.
    <AnimatedView entering={reduced ? undefined : enter()} exiting={reduced ? undefined : exit()}>
      <AnimatedView
        {...pan.panHandlers}
        testID="check-card"
        style={dragStyle}
        // Touch for phones, pointer for a mouse on web.
        onTouchStart={hold}
        onTouchEnd={release}
        onTouchCancel={release}
        onPointerDown={hold}
        onPointerUp={release}
        onPointerLeave={release}
        accessibilityLiveRegion="polite"
        className="mx-3 mb-2 overflow-hidden rounded-2xl border border-border bg-surface px-3 py-3"
      >
        <Swap id={contentKey(card)}>
          {card.kind === "single" ? (
            <SingleCard card={card} program={program} />
          ) : card.kind === "batch" ? (
            <BatchCard items={card.items} program={program} />
          ) : (
            <DayAgainCard card={card} program={program} />
          )}
        </Swap>
      </AnimatedView>
    </AnimatedView>
  );
}

/**
 * One exercise checked: its name, the day's progress, one highlight when
 * there's something true to say, then what's next. A past week, or another
 * exercise's clock running, gets only «Deshacer» (`undoOnly`).
 */
function SingleCard({
  card,
  program,
}: {
  card: Extract<CheckCardState, { kind: "single" }>;
  program: ProgramWithDetails;
}) {
  const { t } = useTranslation();
  const colors = useColors();
  const rest = useRestTimer();
  const logging = useProgramLogging(program);
  const found = locate(program, card.exerciseId);
  if (found == null) return null;

  const { exercise, day } = found;
  const { week, undoOnly } = card;
  const weekRow = weekByNumber(program, week);
  const p = effectivePrescription(exercise, weekRow, week);
  const isDone = (id: string) => logging.isDone(id, week);
  const progress = logging.dayProgress(day, week);

  // A deload week is no baseline either: beating it says nothing.
  const prev = logging.previousSetsFor(exercise.id, week);
  const previous = prev != null && weekByNumber(program, prev.week)?.is_deload === true ? null : prev;

  const highlight = undoOnly
    ? null
    : checkHighlight({
        sets: logging.setsFor(exercise.id, week),
        previous,
        prescribedSets: p.sets,
        isDeload: weekRow?.is_deload === true,
        // The day modal's rule on the day modal's logs, so the two agree.
        record: exerciseRecord({
          exerciseId: exercise.id,
          week,
          logs: dayRecordLogs(day, exercise.id, week, logging.setLogs),
          nameOf: exerciseNames(program),
        }),
      });

  const next = undoOnly ? null : nextExercise(day, exercise.id, isDone);
  const nextName = next != null ? effectivePrescription(next.exercise, weekRow, week).name : null;
  const nextLabel =
    next == null
      ? null
      : next.slot != null
        ? t("checkCard.nextSuperset", { slot: next.slot, name: nextName })
        : t("checkCard.next", { name: nextName });
  // Mid-superset the partner comes first; the rest is after the round.
  const partnerNext =
    next != null &&
    next.slot != null &&
    exercise.superset_group != null &&
    next.exercise.superset_group === exercise.superset_group;
  const restSeconds = p.restSeconds ?? 0;
  const showRest = !undoOnly && restSeconds > 0 && !rest.running && !partnerNext;

  const undo = () => {
    checkCard.dismiss();
    void logging.setCompletion(exercise.id, week, false);
  };
  // Opens the next exercise and starts nothing (no clock, no rest).
  const openNext = () => {
    if (next == null) return;
    checkCard.dismiss();
    exerciseSession.open(next.exercise.id, week);
  };

  return (
    <View className="gap-2.5">
      <CardHeader title={p.name} onUndo={undo} />

      {/* The day so far: one segment per exercise, in the day's order. */}
      <View className="flex-row items-center gap-2 pl-[34px]">
        <View className="flex-1 flex-row gap-1">
          {day.program_exercises.map((e) => (
            <View
              key={e.id}
              className="h-1.5 flex-1"
              style={{
                backgroundColor: isDone(e.id) ? colors.success : colors.border,
                transform: [{ skewX: "-8deg" }],
              }}
            />
          ))}
        </View>
        <Text className="text-[12px] font-bold text-content-secondary" style={TABULAR}>
          {t("checkCard.progress", { done: progress.done, total: progress.total })}
        </Text>
        {card.seconds != null && card.seconds > 0 && (
          <Text className="text-[12px] text-content-tertiary" style={TABULAR}>
            {t("checkCard.time", { time: formatClock(card.seconds) })}
          </Text>
        )}
      </View>

      {highlight != null && <HighlightLine highlight={highlight} />}

      {(nextLabel != null || showRest) && (
        <View className="flex-row items-center gap-2">
          {nextLabel != null && <NextButton label={nextLabel} onPress={openNext} />}
          {showRest && (
            <Pressable
              onPress={() => rest.start(restSeconds, p.name)}
              accessibilityRole="button"
              accessibilityLabel={t("program.restStart", { seconds: restSeconds, name: p.name })}
              hitSlop={6}
              className="flex-row items-center gap-1.5 rounded-lg border px-3 py-2"
              style={{ borderColor: colors.border }}
            >
              <Ionicons name="play-circle" size={17} color={colors.brandSecondary} />
              <Text className="text-[13px] font-bold text-brand-secondary" style={TABULAR}>
                {t("checkCard.rest", { time: formatClock(restSeconds) })}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

/** Checks in quick succession (logging after the fact): just the count. */
function BatchCard({
  items,
  program,
}: {
  items: { exerciseId: string; week: number }[];
  program: ProgramWithDetails;
}) {
  const { t } = useTranslation();
  const logging = useProgramLogging(program);
  const undo = () => {
    checkCard.dismiss();
    // One at a time, like the day's mark-all.
    void (async () => {
      for (const item of items) await logging.setCompletion(item.exerciseId, item.week, false);
    })();
  };
  return <CardHeader title={t("checkCard.batch", { count: items.length })} onUndo={undo} />;
}

/** A day's last exercise re-checked after its celebration already played. */
function DayAgainCard({
  card,
  program,
}: {
  card: Extract<CheckCardState, { kind: "dayAgain" }>;
  program: ProgramWithDetails;
}) {
  const { t } = useTranslation();
  const logging = useProgramLogging(program);
  const day = program.program_days.find((d) => d.id === card.dayId);
  if (day == null) return null;
  const undo = () => {
    checkCard.dismiss();
    void logging.setCompletion(card.exerciseId, card.week, false);
  };
  return <CardHeader title={t("checkCard.dayAgain", { n: day.day_index })} onUndo={undo} />;
}

/** The check, what was done, and «Deshacer», which every card has. */
function CardHeader({ title, onUndo }: { title: string; onUndo: () => void }) {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="h-6 w-6 items-center justify-center rounded-full bg-success">
        <Ionicons name="checkmark" size={15} color={colors.white} />
      </View>
      <Text className="min-w-0 flex-1 text-[14px] font-semibold text-content-primary" numberOfLines={1}>
        {title}
      </Text>
      <Pressable
        onPress={onUndo}
        accessibilityRole="button"
        hitSlop={8}
        className="flex-row items-center gap-1 rounded-lg px-2 py-1.5"
      >
        <Ionicons name="arrow-undo" size={14} color={colors.contentSecondary} />
        <Text className="text-[12px] font-semibold text-content-secondary">{t("checkCard.undo")}</Text>
      </Pressable>
    </View>
  );
}

/** Record, better than last time, or all sets done; never a negative comparison. */
function HighlightLine({ highlight }: { highlight: CheckHighlight }) {
  const { t } = useTranslation();
  const colors = useColors();
  const unit = useWeightUnit();
  const record = highlight.kind === "record";
  const text =
    highlight.kind === "record"
      ? t("checkCard.record", {
          weight: `${kgToUnit1(highlight.weight, unit)} ${unit}`,
          reps: highlight.reps,
        })
      : highlight.kind === "moreKg"
        ? t("checkCard.moreKg", { kg: `${kgToUnit1(highlight.kg, unit)} ${unit}`, w: highlight.week })
        : highlight.kind === "moreReps"
          ? t("checkCard.moreReps", { reps: highlight.reps, w: highlight.week })
          : t("checkCard.allSets", { done: highlight.done, total: highlight.total });
  return (
    <View
      className="ml-[34px] flex-row items-center gap-1.5 self-start rounded-lg px-2.5 py-1"
      style={{ backgroundColor: record ? colors.brandAccentSoft : colors.successSoft }}
    >
      <Ionicons
        name={record ? "trophy" : highlight.kind === "allSets" ? "checkmark-done" : "trending-up"}
        size={14}
        color={record ? colors.brandAccent : colors.success}
      />
      <Text
        className={record ? "text-[13px] font-bold text-brand-accent" : "text-[13px] font-bold text-success"}
        style={TABULAR}
      >
        {text}
      </Text>
    </View>
  );
}

/** «Siguiente»: the poster's red skewed block, one line however long the name. */
function NextButton({ label, onPress }: { label: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" className="min-w-0 flex-1">
      {/* Skew on a nested view: PressableScale's press style owns `transform`. */}
      <View className="bg-brand-primary px-3.5 py-2.5" style={{ transform: [{ skewX: "-10deg" }] }}>
        <View
          className="flex-row items-center justify-center gap-1.5"
          style={{ transform: [{ skewX: "10deg" }] }}
        >
          <Text
            className="shrink text-[12px] font-extrabold uppercase text-white"
            style={{ letterSpacing: 1.2 }}
            numberOfLines={1}
          >
            {label}
          </Text>
          <Ionicons name="arrow-forward" size={14} color={colors.white} />
        </View>
      </View>
    </PressableScale>
  );
}
```

- [ ] **Step 8: Mount the host in the tabs layout**

In `app/(tabs)/_layout.tsx`, find:

```tsx
import { ExerciseSessionHost } from "@/src/components/program/exercise-session-host";
```

Replace with:

```tsx
import { CheckCardHost } from "@/src/components/program/check-card";
import { ExerciseSessionHost } from "@/src/components/program/exercise-session-host";
```

In `app/(tabs)/_layout.tsx`, find (the file indents this JSX by four spaces; keep it that way):

```tsx
    <RestTimerBar bottom={74} />
```

Replace with:

```tsx
    <RestTimerBar bottom={74} />
    {/* The card that answers a check-off, above both bars when they show. */}
    <CheckCardHost bottom={74} />
```

- [ ] **Step 9: Static checks**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint 2>&1 | tail -2
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
```

Expected:
- `npm test`: `ℹ fail 0`; at `30d3b92` plus Tasks 1–3 it is `ℹ tests 125` (123 + 2), higher if another plan's tests have landed.
- `tsc` prints nothing.
- Lint ends with `✖ 3 problems (0 errors, 3 warnings)`, the baseline (all three in `src/i18n/index.ts`).
- `git status --short` prints exactly these five lines:

```
 M app/(tabs)/_layout.tsx
 M src/i18n/en.ts
 M src/i18n/es.ts
?? src/components/program/check-card.tsx
?? src/i18n/check-card.test.ts
```

- [ ] **Step 10: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/components/program/check-card.tsx src/i18n/check-card.test.ts "app/(tabs)/_layout.tsx" src/i18n/es.ts src/i18n/en.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): check-off card above the tab bar (next, rest, undo, highlight)" -m "CheckCardHost, mounted in the tabs layout, renders the checkCard store's card above the tab bar, the rest bar and the session bar: the exercise and the day's segments, one true highlight (the day modal's record rule, more than the last non-deload week, all sets), «Siguiente» (opens the next exercise, superset partner first, starts nothing), «Descanso» and «Deshacer»; a batch card and «Día n completo». Closes after 5 s (held while touched) or with a swipe; no haptic; no slide under reduced motion. Copy: checkCard.* in es and en, pinned by a node:test." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly `app/(tabs)/_layout.tsx`, `src/components/program/check-card.tsx`, `src/i18n/check-card.test.ts`, `src/i18n/en.ts` and `src/i18n/es.ts`.

---

### Task 5: The triggers: useCheckFeedback on the Programa row, the home card row and «Terminar»; the provider as the one gate for the day modal

**Files:**
- Create: `src/utils/check-feedback.ts` (pure: what a check-off shows)
- Test: `src/utils/check-feedback.test.ts`
- Modify: `src/lib/exercise-session.ts`: one method after `finishedSeconds` (lines 168–171 at `30d3b92`)
- Create: `src/hooks/use-check-feedback.ts`
- Modify: `src/components/program/program-view.tsx`: the hooks import (line 9); after `const openExercise` (line 55); the `<DayCard` props in `ProgramView` (line 175); `DayCard`'s destructure and prop type (lines 214 and 224); the row's `onToggleDone` (lines 335–337)
- Modify: `src/components/program/program-home-card.tsx`: the hooks import (line 9); after `const logging` (line 55); the row's `onToggleDone` (lines 226–228)
- Modify: `src/components/program/exercise-session-host.tsx`: the imports (lines 7–8); the host's first lines (41–44); after `const logging` (47–48); `finish` (96–109)
- Modify: `src/i18n/es.ts` and `src/i18n/en.ts`: delete `program.sessionFinished` (line 353 in both)
- Modify: `src/providers/celebration-provider.tsx`: the imports (line 3) and `celebrateDay` (lines 21–32)

Line numbers are as at `30d3b92`; earlier tasks shifted some of them, so match every edit on its quoted text.

**Interfaces:**
- Consumes:
  - Task 3, from `src/lib/check-card.ts`: `checkCard.noteCheck(exerciseId, week, nowMs): "single" | "batch"` (on `"batch"` the «n hechos» card is already up), `checkCard.wasCelebrated` / `markCelebrated`, `checkCard.show`, `checkCard.dismiss()`, `checkCard.get()`, `type CheckCardState`.
  - Task 4: `CheckCardHost` mounted in `app/(tabs)/_layout.tsx` (the web checks need it).
  - Existing: `useProgramLogging(program)` → `{ lockOf, isDone, completesDay, setCompletion }`; `useToday()` (`src/lib/today.ts`); `currentWeekOf(startDate, durationWeeks, now)` (`src/utils/program.ts`); `exerciseSession.finish(exerciseId, week): number`, `exerciseSession.hide()` and the store's `active`.
  - `setCompletion` calls `celebration.celebrateDay(...)` synchronously, before its first `await`, when the write completes the day (`use-program-logging.ts:150-158`). So anything that must know "was this day celebrated already?" reads `checkCard.wasCelebrated` before calling `setCompletion`.
- Produces:
  - `src/utils/check-feedback.ts`:
    - `export type CheckedItem = { exerciseId: string; week: number }`
    - `export type CheckFeedback = { kind: "dayModal" } | { kind: "dayAgain" } | { kind: "card"; collapse: boolean; undoOnly: boolean }`
    - `export function checkFeedback(input: { finishesDay: boolean; celebrated: boolean; batch: boolean; pastWeek: boolean; otherInProgress: boolean }): CheckFeedback`
    - `export function cardIncludes(card: CheckCardState | null, item: CheckedItem): boolean`
  - `exerciseSession.inProgressElsewhere(exerciseId: string, week: number): boolean`: true when another exercise is the one in progress (the one in the session bar, running or paused).
  - `src/hooks/use-check-feedback.ts`: `export function useCheckFeedback(program: ProgramWithDetails | null): { toggleFromRow(exerciseId: string, week: number): void; afterFinish(exerciseId: string, week: number, seconds: number, finishesDay: boolean): void }` (the fixed interface). Both write through `logging.setCompletion`.
  - `DayCard` (private to `program-view.tsx`) gets a required `onToggleExercise: (exercise: ProgramExercise) => void`.
  - `CelebrationProvider.celebrateDay` becomes the one place that opens the day modal:
    - a day and week already celebrated this app session (or whose modal is about to open) gets nothing: no modal, no hold;
    - otherwise it takes any check card down (`checkCard.dismiss()`), closes an open exercise sheet (`exerciseSession.hide()`, Fix 1: «Marcar hecho» no longer leaves the sheet under the stamp), and opens the modal 450 ms later as today, marking the day celebrated (`checkCard.markCelebrated`) as it opens.
  - `program.sessionFinished` is gone from both copy files: the card replaces its toast.

What a check-off shows, decided before the write (the spec's "When it shows" table):

| Check-off | Shows |
|---|---|
| Finishes the day, not celebrated yet this session | Only the day modal (any card on screen goes) |
| Finishes the day, already celebrated this session | Card `dayAgain` («Día {{n}} completo» · «Deshacer»); the provider shows no modal |
| A row check within 8 s of the previous check | The «n hechos» card `noteCheck` put up |
| A week before the current one (`week < currentWeekOf(...)`) | Card `single` with `undoOnly: true` |
| Another exercise in progress (`exerciseSession.inProgressElsewhere`) | Card `single` with `undoOnly: true` |
| Otherwise | Card `single`; `seconds` is «Terminar»'s time, null from a row |
| Unchecking from a row | Nothing (a card still showing that exercise goes) |
| Locked week («Solo semana actual») | Nothing, and no write |
| The mark-all pill, the sheet's «Marcar hecho» | Not through the hook: no card; the modal when the day completes (the provider decides) |

**Decisions** (the spec leaves these open):
- "Another exercise's clock is running" counts the exercise in the session bar, running or paused (both show the bar). Banked clocks (an exercise started, then left for another) don't count: nothing shows them outside their own sheet, and one can sit for days. To count them too, add `|| Object.keys(state.banked).some((k) => k !== sessionKey(exerciseId, week))` to `inProgressElsewhere`.
- Every check-off is noted for the 8-second burst, «Terminar» too, but only row checks show the collapsed card: «Terminar» keeps its own card with its time.
- Re-completing an already celebrated day with the mark-all pill shows nothing (no modal, no card).
- A celebration is marked when its modal opens, not when the day completes: if another day completes within the 450 ms beat (two mark-all pills in a row), the first modal never shows, and re-checking that day later still plays it.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/utils/check-feedback.ts src/utils/check-feedback.test.ts src/lib/exercise-session.ts src/hooks/use-check-feedback.ts src/components/program/program-view.tsx src/components/program/program-home-card.tsx src/components/program/exercise-session-host.tsx src/i18n/es.ts src/i18n/en.ts src/providers/celebration-provider.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "export type CheckCardState" -e "export const checkCard" -e "noteCheck(" -e "wasCelebrated(" -- src/lib/check-card.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "CheckCardHost" -- "app/(tabs)/_layout.tsx"
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.
- The first grep prints the four `src/lib/check-card.ts` lines and the second at least one `CheckCardHost` line. If either prints nothing, stop: Task 3 or Task 4 isn't done.

Read in full: `src/lib/check-card.ts`, `src/lib/exercise-session.ts`, `src/hooks/use-program-logging.ts` (don't edit it), `src/components/program/program-view.tsx`, `src/components/program/program-home-card.tsx`, `src/components/program/exercise-session-host.tsx` and `src/providers/celebration-provider.tsx`.

- [ ] **Step 2: Write the failing test**

Create `src/utils/check-feedback.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CheckCardState } from "@/src/lib/check-card";
import { cardIncludes, checkFeedback } from "@/src/utils/check-feedback";

// A plain check: not the day's last, not in a quick run, the current week,
// no other exercise in progress.
const PLAIN = {
  finishesDay: false,
  celebrated: false,
  batch: false,
  pastWeek: false,
  otherInProgress: false,
};

const item = (exerciseId: string, week = 2) => ({ exerciseId, week });

const single = (exerciseId: string, week = 2): CheckCardState => ({
  kind: "single",
  exerciseId,
  dayId: "day-1",
  week,
  seconds: null,
  undoOnly: false,
});

describe("checkFeedback", () => {
  it("shows the full card for a check that doesn't finish the day", () => {
    assert.deepEqual(checkFeedback(PLAIN), { kind: "card", collapse: false, undoOnly: false });
  });

  it("leaves the day's last check to the day modal", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, finishesDay: true }), { kind: "dayModal" });
  });

  it("doesn't replay a day already celebrated: a «Día n completo» card instead", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, finishesDay: true, celebrated: true }), {
      kind: "dayAgain",
    });
  });

  it("lets finishing the day win over a quick run, a past week and another clock", () => {
    const all = { ...PLAIN, finishesDay: true, batch: true, pastWeek: true, otherInProgress: true };
    assert.deepEqual(checkFeedback(all), { kind: "dayModal" });
    assert.deepEqual(checkFeedback({ ...all, celebrated: true }), { kind: "dayAgain" });
  });

  it("ignores an earlier celebration when the check doesn't finish the day", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, celebrated: true }), {
      kind: "card",
      collapse: false,
      undoOnly: false,
    });
  });

  it("keeps the collapsed card for a check in a quick run", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, batch: true }), {
      kind: "card",
      collapse: true,
      undoOnly: false,
    });
  });

  it("offers only «Deshacer» on a past week", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, pastWeek: true }), {
      kind: "card",
      collapse: false,
      undoOnly: true,
    });
  });

  it("offers only «Deshacer» while another exercise is in progress", () => {
    assert.deepEqual(checkFeedback({ ...PLAIN, otherInProgress: true }), {
      kind: "card",
      collapse: false,
      undoOnly: true,
    });
  });
});

describe("cardIncludes", () => {
  it("is false with no card", () => {
    assert.equal(cardIncludes(null, item("a")), false);
  });

  it("matches a single card on exercise and week", () => {
    assert.equal(cardIncludes(single("a"), item("a")), true);
    assert.equal(cardIncludes(single("a"), item("b")), false);
    assert.equal(cardIncludes(single("a", 1), item("a", 2)), false);
  });

  it("looks through a collapsed card's exercises", () => {
    const card: CheckCardState = { kind: "batch", items: [item("a"), item("b")] };
    assert.equal(cardIncludes(card, item("b")), true);
    assert.equal(cardIncludes(card, item("c")), false);
  });

  it("matches a «Día n completo» card on its exercise", () => {
    const card: CheckCardState = { kind: "dayAgain", dayId: "day-1", week: 2, exerciseId: "a" };
    assert.equal(cardIncludes(card, item("a")), true);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-feedback.test.ts`

Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …check-feedback.test.ts` (the module doesn't exist yet), then `ℹ tests 1`, `ℹ fail 1`. Node's type stripping erases the `import type` of `CheckCardState`, so the test never loads the store or React.

- [ ] **Step 4: Write the pure module**

Create `src/utils/check-feedback.ts`:

```ts
import type { CheckCardState } from "@/src/lib/check-card";

// What checking an exercise off shows, decided before the write: the check
// card, only the day-complete modal, or a small «Día n completo» card (the
// "When it shows" table in docs/superpowers/specs/2026-10-01-check-celebration-design.md).
// Pure, so it is unit tested; src/hooks/use-check-feedback.ts gathers the
// facts and acts on the answer.

/** One exercise in one week: what a card's «Deshacer» unchecks. */
export type CheckedItem = { exerciseId: string; week: number };

export type CheckFeedback =
  /** The day's last check: the day-complete modal is the moment, no card. */
  | { kind: "dayModal" }
  /** The day's last check again, for a day already celebrated this app
      session: no replay, a small «Día n completo» card. */
  | { kind: "dayAgain" }
  /** The card. `collapse`: part of a quick run of checks, whose «n hechos»
      card checkCard.noteCheck already put up: it stays. `undoOnly`: only
      «Deshacer» on it. */
  | { kind: "card"; collapse: boolean; undoOnly: boolean };

export function checkFeedback(input: {
  /** Checking it off finishes its day for the week (completesDay, read before the write). */
  finishesDay: boolean;
  /** That day and week was already celebrated this app session. */
  celebrated: boolean;
  /** Right after the previous check (checkCard.noteCheck said "batch"). */
  batch: boolean;
  /** A week before the current one: logging after the fact. */
  pastWeek: boolean;
  /** Another exercise is in progress: «Siguiente» would juggle two. */
  otherInProgress: boolean;
}): CheckFeedback {
  if (input.finishesDay) return input.celebrated ? { kind: "dayAgain" } : { kind: "dayModal" };
  return {
    kind: "card",
    collapse: input.batch,
    undoOnly: input.pastWeek || input.otherInProgress,
  };
}

const same = (a: CheckedItem, b: CheckedItem) => a.exerciseId === b.exerciseId && a.week === b.week;

/** Whether the card on screen stands for this exercise and week. */
export function cardIncludes(card: CheckCardState | null, item: CheckedItem): boolean {
  if (card == null) return false;
  if (card.kind === "batch") return card.items.some((i) => same(i, item));
  return same({ exerciseId: card.exerciseId, week: card.week }, item);
}
```

- [ ] **Step 5: Run the test again**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/check-feedback.test.ts`

Expected: `ℹ tests 12`, `ℹ suites 2`, `ℹ pass 12`, `ℹ fail 0`.

- [ ] **Step 6: Let the session store say whether another exercise is in progress**

In `src/lib/exercise-session.ts`, find:

```ts
  /** Seconds a finished exercise took, or null if it wasn't timed. */
  finishedSeconds(exerciseId: string, week: number): number | null {
    return state.finished[sessionKey(exerciseId, week)] ?? null;
  },
};
```

Replace with:

```ts
  /** Seconds a finished exercise took, or null if it wasn't timed. */
  finishedSeconds(exerciseId: string, week: number): number | null {
    return state.finished[sessionKey(exerciseId, week)] ?? null;
  },

  /** Whether an exercise other than this one is in progress (running or
      paused: the one in the bar). Read as an exercise is checked off: its
      card then offers only «Deshacer», since «Siguiente» would juggle two. */
  inProgressElsewhere(exerciseId: string, week: number): boolean {
    const a = state.active;
    return a != null && (a.exerciseId !== exerciseId || a.week !== week);
  },
};
```

It reads the live store when called: the hook below doesn't need `useExerciseSession()` (which would re-render the Programa tab and the home card on every sheet open and close), and «Terminar» reads it after `finish` has dropped its own exercise.

- [ ] **Step 7: Write the hook**

Create `src/hooks/use-check-feedback.ts`:

```ts
import { useProgramLogging } from "@/src/hooks/use-program-logging";
import { checkCard } from "@/src/lib/check-card";
import { exerciseSession } from "@/src/lib/exercise-session";
import { useToday } from "@/src/lib/today";
import type { ProgramDayWithExercises, ProgramWithDetails } from "@/src/types/database";
import { cardIncludes, checkFeedback } from "@/src/utils/check-feedback";
import { currentWeekOf } from "@/src/utils/program";

function findDay(program: ProgramWithDetails | null, exerciseId: string): ProgramDayWithExercises | null {
  return program?.program_days.find((d) => d.program_exercises.some((e) => e.id === exerciseId)) ?? null;
}

/**
 * Checking one exercise off from a row (the Programa tab, the home card) or
 * with «Terminar»: decides what it brings before writing it (the check card,
 * a «Deshacer»-only card, the collapsed «n hechos» card, «Día n completo», or
 * only the day-complete modal; see src/utils/check-feedback.ts), then writes
 * it. Unchecking from a row stays quiet. The day's mark-all pill and the
 * sheet's «Marcar hecho» don't come through here: they never show the card.
 */
export function useCheckFeedback(program: ProgramWithDetails | null): {
  toggleFromRow(exerciseId: string, week: number): void;
  afterFinish(exerciseId: string, week: number, seconds: number, finishesDay: boolean): void;
} {
  const logging = useProgramLogging(program);
  // The fresh day (src/lib/today), as on the Programa tab: an earlier week is
  // logging after the fact.
  const today = useToday();
  const currentWeek =
    program != null ? currentWeekOf(program.start_date, program.duration_weeks, today) : 1;

  const check = (
    exerciseId: string,
    week: number,
    seconds: number | null,
    finishesDay: boolean,
    fromRow: boolean,
  ) => {
    const day = findDay(program, exerciseId);
    // Every check-off is noted: one right after it joins the burst, and from
    // two checks on the store puts the «n hechos» card up itself.
    const quick = checkCard.noteCheck(exerciseId, week, Date.now()) === "batch";
    const shown = checkFeedback({
      finishesDay,
      // Read before the write: setCompletion sets off celebrateDay at once.
      celebrated: day != null && checkCard.wasCelebrated(day.id, week),
      // Only row checks run together: «Terminar» keeps its own card and time.
      batch: fromRow && quick,
      pastWeek: week < currentWeek,
      otherInProgress: exerciseSession.inProgressElsewhere(exerciseId, week),
    });
    if (day == null || shown.kind === "dayModal") {
      // The day-complete modal is the moment: no card under it (dismiss also
      // ends the burst, so the next check is a plain card).
      checkCard.dismiss();
    } else if (shown.kind === "dayAgain") {
      checkCard.show({ kind: "dayAgain", dayId: day.id, week, exerciseId });
    } else if (!shown.collapse) {
      checkCard.show({ kind: "single", exerciseId, dayId: day.id, week, seconds, undoOnly: shown.undoOnly });
    }
    void logging.setCompletion(exerciseId, week, true);
  };

  return {
    toggleFromRow(exerciseId, week) {
      // "Solo semana actual": the circle is disabled on a week that isn't
      // open, and nothing shows if a press gets through anyway.
      if (logging.lockOf(week) != null) return;
      if (logging.isDone(exerciseId, week)) {
        // Quiet, but a card still showing this check-off goes with it.
        if (cardIncludes(checkCard.get(), { exerciseId, week })) checkCard.dismiss();
        void logging.setCompletion(exerciseId, week, false);
        return;
      }
      check(exerciseId, week, null, logging.completesDay(exerciseId, week), true);
    },
    afterFinish(exerciseId, week, seconds, finishesDay) {
      if (logging.lockOf(week) != null) return;
      check(exerciseId, week, seconds > 0 ? seconds : null, finishesDay, false);
    },
  };
}
```

The module stores (`checkCard`, `exerciseSession`) are read only inside the two handlers, never during render, so the React Compiler can't memoize a stale answer.

- [ ] **Step 8: Programa tab rows**

In `src/components/program/program-view.tsx`, find:

```tsx
import { useProgramLogging } from "@/src/hooks/use-program-logging";
```

Replace with:

```tsx
import { useCheckFeedback } from "@/src/hooks/use-check-feedback";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
```

In `src/components/program/program-view.tsx`, find:

```tsx
  const openExercise = (ex: ProgramExercise) => exerciseSession.open(ex.id, selectedWeek);
```

Replace with:

```tsx
  const openExercise = (ex: ProgramExercise) => exerciseSession.open(ex.id, selectedWeek);
  // A row's circle: a check-off gets its card (or the day modal), an uncheck
  // stays quiet. The day's mark-all pill doesn't come this way: no card.
  const feedback = useCheckFeedback(program);
  const toggleExercise = (ex: ProgramExercise) => feedback.toggleFromRow(ex.id, selectedWeek);
```

In `src/components/program/program-view.tsx`, find (in the `<DayCard` element of `ProgramView`):

```tsx
            onOpenExercise={openExercise}
```

Replace with:

```tsx
            onOpenExercise={openExercise}
            onToggleExercise={toggleExercise}
```

In `src/components/program/program-view.tsx`, find (`DayCard`'s destructure):

```tsx
  onOpenExercise,
  onPlayVideo,
```

Replace with:

```tsx
  onOpenExercise,
  onToggleExercise,
  onPlayVideo,
```

In `src/components/program/program-view.tsx`, find (`DayCard`'s prop type):

```tsx
  onOpenExercise: (exercise: ProgramExercise) => void;
```

Replace with:

```tsx
  onOpenExercise: (exercise: ProgramExercise) => void;
  /** A row's circle: check it off, or uncheck it (useCheckFeedback). */
  onToggleExercise: (exercise: ProgramExercise) => void;
```

In `src/components/program/program-view.tsx`, find:

```tsx
              onToggleDone={() =>
                logging.setCompletion(ex.id, selectedWeek, !logging.isDone(ex.id, selectedWeek))
              }
```

Replace with:

```tsx
              onToggleDone={() => onToggleExercise(ex)}
```

The day's x/n pill (`logging.setDayCompletion(day, selectedWeek, !allDone)`) stays as it is: no card, and the day modal when the day becomes complete. The `locked` prop and `logging.lockOf(selectedWeek)` are untouched.

- [ ] **Step 9: Home card rows**

In `src/components/program/program-home-card.tsx`, find:

```tsx
import { useProgramLogging } from "@/src/hooks/use-program-logging";
```

Replace with:

```tsx
import { useCheckFeedback } from "@/src/hooks/use-check-feedback";
import { useProgramLogging } from "@/src/hooks/use-program-logging";
```

In `src/components/program/program-home-card.tsx`, find:

```tsx
  const logging = useProgramLogging(program);
```

Replace with:

```tsx
  const logging = useProgramLogging(program);
  // A row's circle: a check-off gets its card (or the day modal), same as
  // the Programa tab's rows.
  const feedback = useCheckFeedback(program);
```

In `src/components/program/program-home-card.tsx`, find:

```tsx
                    onToggleDone={() =>
                      logging.setCompletion(ex.id, displayWeek, !logging.isDone(ex.id, displayWeek))
                    }
```

Replace with:

```tsx
                    onToggleDone={() => feedback.toggleFromRow(ex.id, displayWeek)}
```

- [ ] **Step 10: «Terminar» through the hook, in place of the toast**

In `src/components/program/exercise-session-host.tsx`, find:

```tsx
import { useToast } from "@/src/components/ui";
import { useAuth } from "@/src/hooks/use-auth";
```

Replace with:

```tsx
import { useAuth } from "@/src/hooks/use-auth";
import { useCheckFeedback } from "@/src/hooks/use-check-feedback";
```

In `src/components/program/exercise-session-host.tsx`, find:

```tsx
export function ExerciseSessionHost({ tabBarHeight }: { tabBarHeight: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { user } = useAuth();
```

Replace with:

```tsx
export function ExerciseSessionHost({ tabBarHeight }: { tabBarHeight: number }) {
  const { user } = useAuth();
```

`useTranslation` stays imported: `ExerciseSessionBar` further down uses it.

In `src/components/program/exercise-session-host.tsx`, find:

```tsx
  const logging = useProgramLogging(program);
  const rest = useRestTimer();
```

Replace with:

```tsx
  const logging = useProgramLogging(program);
  const feedback = useCheckFeedback(program);
  const rest = useRestTimer();
```

In `src/components/program/exercise-session-host.tsx`, find:

```tsx
  const finish = () => {
    if (sheet == null || sheetExercise == null || sheetLock != null) return;
    const name = effectivePrescription(sheetExercise, weekByNumber(program!, sheet.week), sheet.week).name;
    // The day's last exercise brings the day-complete stamp; no toast under it.
    const finishesDay = logging.completesDay(sheet.exerciseId, sheet.week);
    const seconds = exerciseSession.finish(sheet.exerciseId, sheet.week);
    void logging.setCompletion(sheet.exerciseId, sheet.week, true);
    if (!finishesDay && seconds > 0) {
      toast.show({
        type: "success",
        message: t("program.sessionFinished", { name, time: formatClock(seconds) }),
      });
    }
  };
```

Replace with:

```tsx
  // «Terminar»: the clock stops and keeps its time (closing the sheet), then
  // the check-off shows its card with that time («en 3:12»), or only the
  // day-complete stamp when it was the day's last (read before the write).
  const finish = () => {
    if (sheet == null || sheetExercise == null || sheetLock != null) return;
    const finishesDay = logging.completesDay(sheet.exerciseId, sheet.week);
    const seconds = exerciseSession.finish(sheet.exerciseId, sheet.week);
    feedback.afterFinish(sheet.exerciseId, sheet.week, seconds, finishesDay);
  };
```

`exerciseSession.finish` still stores the seconds (the day modal adds them up) and closes the sheet; `afterFinish` now writes the completion. The toast's Success haptic goes with the toast, so «Terminar» gives one vibration (DoneButton's). `effectivePrescription`, `weekByNumber` and `formatClock` are still used further down.

- [ ] **Step 11: Delete the toast's copy**

In `src/i18n/es.ts`, find:

```ts
    sessionOpen: "Volver a {{name}}",
    sessionFinished: "{{name}} terminado en {{time}}",
```

Replace with:

```ts
    sessionOpen: "Volver a {{name}}",
```

In `src/i18n/en.ts`, find:

```ts
    sessionOpen: "Back to {{name}}",
    sessionFinished: "{{name}} done in {{time}}",
```

Replace with:

```ts
    sessionOpen: "Back to {{name}}",
```

Then run:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "sessionFinished" -- src app
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "useToast" -e "toast" -- src/components/program/exercise-session-host.tsx
```

Expected: both print nothing (and exit with status 1).

- [ ] **Step 12: The provider: one gate for the day modal**

In `src/providers/celebration-provider.tsx`, find:

```tsx
import { DayCompleteModal } from "@/src/components/program/day-complete-modal";
```

Replace with:

```tsx
import { DayCompleteModal } from "@/src/components/program/day-complete-modal";
import { checkCard } from "@/src/lib/check-card";
import { exerciseSession } from "@/src/lib/exercise-session";
```

In `src/providers/celebration-provider.tsx`, find:

```tsx
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const celebrateDay = useCallback((next: DayCelebration) => {
    setHolding({ dayId: next.dayId, week: next.week });
    // A beat before covering the screen: the last check-off's own burst gets
    // to land, and an exercise sheet that closed on it gets to slide away.
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setShown((prev) => ({ day: next, id: (prev?.id ?? 0) + 1 }));
      setVisible(true);
    }, 450);
  }, []);
```

Replace with:

```tsx
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The day and week whose modal is about to open (the beat below).
  const pending = useRef<string | null>(null);

  const celebrateDay = useCallback((next: DayCelebration) => {
    // Once per day and week per app session, and this is the one place that
    // decides it. Re-checking a celebrated day's last exercise doesn't replay
    // the stamp: the check card says «Día n completo» instead (its hook reads
    // the same flag before writing), and the mark-all pill shows nothing.
    const key = `${next.dayId}|${next.week}`;
    if (checkCard.wasCelebrated(next.dayId, next.week) || pending.current === key) return;
    // Nothing under the stamp: no check card (a row checked a few seconds
    // before the day's pill), and an exercise sheet still open on the day
    // («Marcar hecho») closes first, so the stamp lands on the screen.
    checkCard.dismiss();
    exerciseSession.hide();
    setHolding({ dayId: next.dayId, week: next.week });
    // A beat before covering the screen: the last check-off's own burst gets
    // to land, and an exercise sheet that closed on it gets to slide away.
    if (timer.current != null) clearTimeout(timer.current);
    pending.current = key;
    timer.current = setTimeout(() => {
      pending.current = null;
      // Marked as it opens: a celebration cut short by another day finishing
      // within the beat (two mark-all pills) can still play later.
      checkCard.markCelebrated(next.dayId, next.week);
      setShown((prev) => ({ day: next, id: (prev?.id ?? 0) + 1 }));
      setVisible(true);
    }, 450);
  }, []);
```

- [ ] **Step 13: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | grep -E "^ℹ (tests|suites|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint 2>&1 | tail -2
```

Expected:
- `npm test`: `ℹ fail 0`; at `30d3b92` plus Tasks 1–4 it is `ℹ tests 137` (125 + 12), higher if another plan's tests have landed.
- `tsc` prints nothing.
- Lint ends with `✖ 3 problems (0 errors, 3 warnings)` (the baseline, all in `src/i18n/index.ts`).

- [ ] **Step 14: Check the card and its triggers on the web build**

Setup:
- Start the web build in the Browser pane: `preview_start` with name `web` (`.claude/launch.json`, port 8081), and set the viewport to 375×812 (`resize_window`, preset `mobile`).
- USER STEP: ask the user to sign in with a test client account that has an active program (at least two days of three or more exercises, one superset if possible, prescribed rests, the coach's WhatsApp number set). Never type credentials yourself, and ask before checking things off on a real client's account.
- Work on the Programa tab (`http://localhost:8081/routines`) on the week marked «Actual» unless a check says otherwise. To reset, uncheck rows with their circles (silent).
- Reload the page (F5) before every check that expects the day modal: that clears the session's celebrated days.
- Wait about 10 s between numbered checks, so one check's 8-second window doesn't run into the next.

The card (Task 4):
1. **Single card.** Check an unchecked exercise that isn't the day's last unchecked one. The card slides up just above the tab bar, with no backdrop: the list behind still scrolls and taps. It shows: a green check, the exercise name on one line (truncated if long) and «Deshacer»; one skewed segment per exercise of the day, green for the checked ones, and the count («2/5»); «SIGUIENTE: <next unchecked exercise>» on the red block; «Descanso m:ss» when the exercise has a prescribed rest. No toast appears.
2. **Auto-close.** Leave it: it closes by itself after about 5 s.
3. **Hold (Review Focus 2).** Check another exercise, then run this with `javascript_tool` (or ask the user to hold the mouse on the card's empty area for 8 s and let go):

```js
const q = () => document.querySelector('[data-testid="check-card"]');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const el = q();
el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
await wait(8000);
const held = q() != null;
el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
await wait(3000);
const after3s = q() != null;
await wait(3000);
({ held, after3s, after6s: q() != null })
```

Expected: `{ held: true, after3s: true, after6s: false }`. Repeat with the mouse leaving the card while held, in place of letting go on it: replace the `pointerup` line with `el.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, relatedTarget: document.body }));` (React fires `onPointerLeave` from `pointerout`). The same result. If either snippet doesn't reach the card's handlers, ask the user to do it by hand: hold the mouse on the card's empty area for 8 s and let go (or drag off the card and let go outside); the card closes about 5 s later.
4. **Swipe (Review Focus 2).** Check another exercise. `left_click_drag` from the card's empty area 60 px down: it closes at once. On a new card, drag 15 px: it snaps back. On a new card, start the 15 px drag on «Siguiente»: no sheet opens, the card snaps back, and it still closes about 5 s later.
5. **Siguiente.** Tap it: the card closes and that exercise's sheet opens. Nothing starts: no exercise clock, no rest bar. Close the sheet with its ✕ («Cerrar»): no exercise-in-progress bar appears.
6. **Descanso.** On a new card, tap «Descanso»: the rest bar appears above the tab bar with the exercise's name; the card moves up above it, «Descanso» disappears and «Siguiente» stays. Skip the rest with its ✕ («Saltar descanso»): the card drops back above the tab bar, and at no moment does it overlap the bar.
7. **Deshacer.** On a new card, tap «Deshacer»: the card closes and that row's check clears.
8. **Superset.** If the day has a superset (rows joined by the red left bar), check the first row of the round: «AHORA A2: <partner>» and no «Descanso».
9. **Highlight.** Open an exercise, log every prescribed set («Registrar series»), close the sheet and check the row: one pill, «3 de 3 series», or the record / «+… vs semana w» line when the logged sets beat earlier ones. An exercise with no sets logged shows no pill.
10. **Above the bars (Review Focus 1).** Look at the card in four states: no bar; a rest running (tap «Descanso»); an exercise in progress (open another exercise, «Empezar», then hide the sheet with its chevron, and check a different row); both. Each time `zoom` on the bottom 300 px: the card's bottom edge sits about 8 px above the top edge of the bar below it, the same gap as between the bars, and nothing overlaps. With the session bar showing, `javascript_tool`:

```js
const card = document.querySelector('[data-testid="check-card"]').getBoundingClientRect();
const bar = document.querySelector('[aria-label^="Volver a"]').getBoundingClientRect();
Math.round(bar.top - card.bottom)
```

Expected: 6 to 10. Afterwards quit the exercise from its sheet («Salir»; accept the browser's confirm if the clock passed 10 s).
11. **Tab switch.** With a card up, switch to Inicio: the card stays on screen and closes on time.
12. **Sheet opening.** With a card up, tap a row to open its sheet: when the sheet closes, the card is gone.
13. **Themes.** Switch the theme in Ajustes, light then dark: the card follows (surface, border and text colours, the red block, the green check).

The triggers (this task):
14. **Uncheck.** Uncheck a row: nothing appears. Check it again and, while its card shows, uncheck it: the card closes.
15. **8-second collapse.** Check two unchecked rows less than 8 s apart: the card reads «2 hechos» with only «Deshacer». A third check within 8 s: «3 hechos». «Deshacer» clears all of them and closes the card.
16. **Two days in one burst (Review Focus 3).** Check one row of a day, then within 3 s one row of another day: «2 hechos». «Deshacer» unchecks both, and no day modal opens.
17. **Day's last.** Reload, check every row of a day but one, wait 10 s, then check the last one: no card for it, and the day modal opens about half a second later. Close it with «Listo».
18. **Day's last inside a burst (Review Focus 3).** Reload, leave two rows of a day unchecked, check one and within 3 s the other: only the modal, with no card under it. After «Listo», check a row of another day: a plain card (not «n hechos»).
19. **Day again.** Uncheck that last row and check it again: the card reads «Día {n} completo» with «Deshacer», and the modal doesn't open again. Uncheck the row and finish the day with its «x/x» pill: no modal and no card.
20. **Pill after a row check.** Reload. On a day with two unchecked rows, check one row (its card shows) and within 5 s tap the day's pill: the card goes as the modal comes.
21. **Two pills in a row (optional, needs two quick taps: one `browser_batch` with two `left_click`s).** Reload, leave one row unchecked on each of two days, then tap the first day's pill and the second's within about 0.4 s: one modal, for the second day. After «Listo», uncheck the first day's last row and check it again: the first day's modal opens (not «Día n completo»).
22. **Past week** (only when «Actual» is week 2 or later). Select an earlier week, check a row in a day with at least two unchecked rows: a card with only «Deshacer» (no «Siguiente», no «Descanso»). Uncheck it again.
23. **Another exercise in progress.** Open an unchecked exercise, «Empezar», hide the sheet (chevron): the session bar shows. Check a different row (not the last unchecked one of its day): a card with only «Deshacer», above the session bar. Clean up: tap the bar, «Salir» (accept the confirm).
24. **Locked week** (only with «Solo semana actual» on and a week after «Actual»). Select that week: the circles show a lock, pressing does nothing, and no card appears.
25. **Home card.** On Inicio (`http://localhost:8081/`), check a row on the program card that isn't the day's last: the same card. Uncheck it: nothing.
26. **«Terminar».** Open an unchecked exercise that isn't the day's last, «Empezar», wait about 5 s, «Terminar»: the sheet closes; the card shows with the time («en 0:05» or so); no «… terminado en …» toast at the top.
27. **«Terminar» on the day's last.** Reload, leave one exercise of a day unchecked, open it, «Empezar», «Terminar»: no card, no toast, only the day modal.
28. **«Marcar hecho» on the day's last (Fix 1).** Reload, leave one exercise of a day unchecked, open it and tap «Marcar hecho»: the sheet slides away, then the day modal opens with no sheet behind it.
29. **English.** Switch the language to English: «Next: …», «Rest 1:30», «Undo», «2 done», «Day n complete».
30. **Console.** `read_console_messages` with `onlyErrors: true` shows nothing new from these screens.

Undo what the checks changed (uncheck the rows, quit any exercise in progress) so the account is as it was. Stop the preview.

- [ ] **Step 15: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/utils/check-feedback.ts src/utils/check-feedback.test.ts src/lib/exercise-session.ts src/hooks/use-check-feedback.ts src/components/program/program-view.tsx src/components/program/program-home-card.tsx src/components/program/exercise-session-host.tsx src/i18n/es.ts src/i18n/en.ts src/providers/celebration-provider.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): check card on row checks and on Terminar; one gate for the day modal" -m "useCheckFeedback decides before the write what a check-off shows: the card, a Deshacer-only card on a past week or while another exercise is in progress, the collapsed «n hechos» card for quick runs, «Día n completo» for a day already celebrated, or only the day modal. The Programa and home card rows and the session host's Terminar go through it; Terminar's toast is replaced by the card with the time. CelebrationProvider.celebrateDay is now the one place that opens the day modal: once per day and week per session, with no card under it and the exercise sheet closed first. The decision is pure (src/utils/check-feedback.ts) and unit tested." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those ten files.

---

### Task 6: The sheet: «Siguiente →» in the done state, and «Marcar hecho»'s burst before the sheet closes

**Files:**
- Modify: `src/components/program/program-exercise-modal.tsx` (line numbers at `30d3b92`): the types import (line 30); `Props` after `onQuit` (lines 71–72); the component's doc comment (line 84); the destructure (lines 103–105); after `const clock` (line 164); the done branch (lines 387–393); «Marcar hecho» (lines 399–400)
- Modify: `src/components/program/exercise-session-host.tsx` (as Task 5 leaves it): the types import; a `findDay` helper after `findExercise`; `sheetNext` after `finish`; two props on `<ProgramExerciseModal`

**Interfaces:**
- Consumes:
  - Task 2, from `src/utils/check-card.ts`: `type NextExercise = { exercise: ProgramExercise; slot: string | null }` and `nextExercise(day, currentId, isDone: (exerciseId) => boolean): NextExercise | null`.
  - Task 4's copy, es and en: `checkCard.sheetNext` («Siguiente →» / «Next →»), `checkCard.next` («Siguiente: {{name}}»), `checkCard.nextSuperset` («Ahora {{slot}}: {{name}}»).
  - Task 5: the `feedback.afterFinish(...)` line in the host (an anchor) and the provider closing the sheet before the day modal (Fix 1).
  - Existing: `exerciseSession.open(exerciseId, week)`; `logging.completesDay`; the sheet's `DoneButton` with `settleMs` and `FINISH_SETTLE_MS` (320 ms).
- Produces: `ProgramExerciseModal` takes two new required props (the host is its only caller):
  - `next: NextExercise | null`: the day's next exercise to do, offered as «Siguiente →» in the done state;
  - `onNext: () => void`: opens `next` in the sheet without starting anything.

Behaviour:
- **Done state**: «Hecho» (unchecks, as today) plus «Siguiente →» when `nextExercise` finds one: the same target the card picks (a superset's partner first, then the next unchecked exercise, then a skipped earlier one). It opens that exercise's sheet scrolled to the top, with «Empezar»; nothing starts. The sheet never shows the check card.
- **«Marcar hecho»** keeps calling `logging.setCompletion` directly (no card). When it finishes the day, its burst plays first (the same 320 ms settle as «Terminar»); then the write sets off `celebrateDay`, which closes the sheet (Task 5) and opens the day modal 450 ms later on an empty screen. For a day already celebrated this session the sheet stays open and flips to «Hecho».
- **Locked weeks**: unchanged. The lock note replaces the done and start buttons, so neither new button can show.
- **Banked time** (an exercise started earlier, «Continuar (m:ss)»): «Marcar hecho» closes the sheet as today (the host's sync effect finishes the clock once the check lands), so «Siguiente →» isn't seen there.

**Decisions** (the spec leaves these open):
- The sheet's «Siguiente →» also shows on a past week and while another exercise is in progress (where the card offers only «Deshacer»): the client opened this sheet on purpose, and the spec only fixes which exercise it targets.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/components/program/program-exercise-modal.tsx src/components/program/exercise-session-host.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "export function nextExercise" -e "export type NextExercise" -- src/utils/check-card.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "sheetNext:" -e "nextSuperset:" -- src/i18n/es.ts src/i18n/en.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "feedback.afterFinish" -- src/components/program/exercise-session-host.tsx
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.
- The greps print two lines from `src/utils/check-card.ts`, four from the copy files and one `feedback.afterFinish` line. If one prints nothing, stop: the task that adds it isn't done.

Read both files in full.

- [ ] **Step 2: The sheet's new props**

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
```

Replace with:

```tsx
import type { ProgramExercise, ProgramWeek } from "@/src/types/database";
import type { NextExercise } from "@/src/utils/check-card";
```

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
  /** Leave without marking done; the time is dropped. */
  onQuit: () => void;
```

Replace with:

```tsx
  /** Leave without marking done; the time is dropped. */
  onQuit: () => void;
  /** The day's next exercise to do, offered as «Siguiente →» once this one
      is done; null hides it. */
  next: NextExercise | null;
  /** Open `next` in this sheet. Starts nothing. */
  onNext: () => void;
```

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
  onQuit,
  onPlay,
}: Props) {
```

Replace with:

```tsx
  onQuit,
  next,
  onNext,
  onPlay,
}: Props) {
```

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
 *  - done: review, with the done toggle.
```

Replace with:

```tsx
 *  - done: review, with the done toggle and «Siguiente →» to the day's
 *    next exercise.
```

`tsc` fails on the host until Step 4 passes the new props.

- [ ] **Step 3: «Siguiente →» and «Marcar hecho»'s settle in the sheet**

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
  const clock = formatClock(Math.floor(elapsedMs / 1000));
```

Replace with:

```tsx
  const clock = formatClock(Math.floor(elapsedMs / 1000));

  // «Marcar hecho» on the day's last exercise: its burst plays before the
  // write, since the day-complete stamp closes the sheet (as on «Terminar»).
  const finishesDay = exercise != null && logging.completesDay(exercise.id, weekNumber);
  const nextName = next != null ? effectivePrescription(next.exercise, week, weekNumber).name : null;
  // The next exercise opens at the top of its sheet (its demo), not scrolled
  // down to where this one's sets were.
  const goNext = () => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    onNext();
  };
```

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
                  ) : done ? (
                    <DoneButton
                      done
                      onPress={() => void logging.setCompletion(exercise.id, weekNumber, false)}
                      className="flex-1"
                    />
                  ) : (
```

Replace with:

```tsx
                  ) : done ? (
                    <>
                      <DoneButton
                        done
                        onPress={() => void logging.setCompletion(exercise.id, weekNumber, false)}
                        className="flex-1"
                      />
                      {/* The day's next one (a superset's partner first):
                          opens it here and starts nothing. */}
                      {next != null && nextName != null && (
                        <PressableScale
                          scaleTo={0.98}
                          haptic
                          onPress={goNext}
                          accessibilityRole="button"
                          accessibilityLabel={
                            next.slot != null
                              ? t("checkCard.nextSuperset", { slot: next.slot, name: nextName })
                              : t("checkCard.next", { name: nextName })
                          }
                          className="flex-[2] flex-row items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3.5"
                        >
                          <Text className="text-base font-bold text-white">{t("checkCard.sheetNext")}</Text>
                        </PressableScale>
                      )}
                    </>
                  ) : (
```

The pair mirrors the not-started row, where «Marcar hecho» (`flex-1`) sits beside the red «Empezar» (`flex-[2]`). With nothing left in the day, «Hecho» stays full width as today.

In `src/components/program/program-exercise-modal.tsx`, find:

```tsx
                        label={t("program.markDoneShort")}
                        onPress={() => void logging.setCompletion(exercise.id, weekNumber, true)}
```

Replace with:

```tsx
                        label={t("program.markDoneShort")}
                        settleMs={finishesDay ? FINISH_SETTLE_MS : 0}
                        onPress={() => void logging.setCompletion(exercise.id, weekNumber, true)}
```

`finishesDay` is read during render from `logging`, which is reactive, so it is safe with the React Compiler.

- [ ] **Step 4: The host passes the sheet's next exercise**

In `src/components/program/exercise-session-host.tsx`, find:

```tsx
import type { ProgramExercise, ProgramWithDetails } from "@/src/types/database";
```

Replace with:

```tsx
import type { ProgramDayWithExercises, ProgramExercise, ProgramWithDetails } from "@/src/types/database";
import { nextExercise } from "@/src/utils/check-card";
```

In `src/components/program/exercise-session-host.tsx`, find (the end of `findExercise`):

```tsx
    if (ex != null) return ex;
  }
  return null;
}
```

Replace with:

```tsx
    if (ex != null) return ex;
  }
  return null;
}

function findDay(program: ProgramWithDetails | null, exerciseId: string): ProgramDayWithExercises | null {
  return program?.program_days.find((d) => d.program_exercises.some((e) => e.id === exerciseId)) ?? null;
}
```

In `src/components/program/exercise-session-host.tsx`, find (the end of `finish`, as Task 5 left it):

```tsx
    feedback.afterFinish(sheet.exerciseId, sheet.week, seconds, finishesDay);
  };
```

Replace with:

```tsx
    feedback.afterFinish(sheet.exerciseId, sheet.week, seconds, finishesDay);
  };

  // The done sheet's «Siguiente →»: the day's next exercise to do, the same
  // one the check card offers.
  const sheetDay = sheet != null ? findDay(program, sheet.exerciseId) : null;
  const sheetNext =
    sheet != null && sheetDay != null
      ? nextExercise(sheetDay, sheet.exerciseId, (id) => isDone(id, sheet.week))
      : null;
```

In `src/components/program/exercise-session-host.tsx`, find:

```tsx
        onQuit={() => sheet != null && exerciseSession.quit(sheet.exerciseId, sheet.week)}
```

Replace with:

```tsx
        onQuit={() => sheet != null && exerciseSession.quit(sheet.exerciseId, sheet.week)}
        next={sheetNext}
        onNext={() =>
          sheet != null && sheetNext != null && exerciseSession.open(sheetNext.exercise.id, sheet.week)
        }
```

`isDone` is the `const { isDone } = logging;` the host already destructures for its sync effect.

- [ ] **Step 5: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint 2>&1 | tail -2
```

Expected:
- `npm test`: `ℹ fail 0`, the same count as after Task 5 (`ℹ tests 137` at `30d3b92` plus Tasks 1–5, higher if another plan's tests have landed).
- `tsc` prints nothing.
- Lint ends with `✖ 3 problems (0 errors, 3 warnings)` (the baseline, all in `src/i18n/index.ts`).

- [ ] **Step 6: Check it on the web build**

Same setup as Task 5 Step 14: `preview_start` with name `web`, viewport 375×812; USER STEP, the user signs in; Programa tab, week «Actual»; reload before any check that expects the day modal.

1. Open an unchecked exercise that isn't the day's last and tap «Marcar hecho»: the sheet stays open and its buttons become «Hecho» and «Siguiente →». No check card appears.
2. Scroll the sheet down, then tap «Siguiente →»: the sheet shows the next unchecked exercise from its top (demo first), with «Empezar». No clock, session bar or rest starts.
3. Superset (only when the day has one): «Marcar hecho» on its first exercise, then «Siguiente →»: the partner opens (A1 → A2). The button's accessibility label (`read_page`) read before tapping is «Ahora A2: {name}».
4. With every other exercise of the day checked, open a checked one: only «Hecho», full width.
5. «Hecho»: it unchecks (as today), and no card appears.
6. Fix 1: reload, leave one exercise of a day unchecked, open it and tap «Marcar hecho». In order: the burst plays; the sheet slides away; the day modal opens with no sheet behind it. «Listo» closes the modal onto the Programa tab.
7. No replay: uncheck that exercise from its row, open it, tap «Marcar hecho»: the sheet stays and flips to «Hecho»; no day modal, no card.
8. Locked week (only with «Solo semana actual» and a week after «Actual»): open an exercise of that week: the lock note shows, with no «Marcar hecho», «Hecho» or «Siguiente →».
9. Console: `read_console_messages` with `onlyErrors: true` shows nothing new.

Undo what the checks changed. Stop the preview.

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/components/program/program-exercise-modal.tsx src/components/program/exercise-session-host.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): Siguiente in the done sheet; Marcar hecho's burst before the day modal" -m "The exercise sheet's done state offers «Siguiente →», the same next exercise the check card picks (superset partner first), and opens it without starting anything. «Marcar hecho» on the day's last exercise lets its burst play before the write; the celebration provider then closes the sheet and opens the day modal on an empty screen." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those two files.

---

### Task 7: Programa focus (src/lib/program-focus.ts), consumed by the Programa tab

**Files:**
- Create: `src/lib/program-focus.ts`
- Test: `src/lib/program-focus.test.ts`
- Modify: `src/tw/index.tsx` (the `ViewProps` type, lines 36–39 at `30d3b92`)
- Modify: `src/components/program/program-view.tsx`
- Modify: `app/(tabs)/routines/index.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks (this task can move anywhere before Task 8). Existing code only: `useProgram()` (`setViewWeek`, `autoWeek`) from `src/hooks/use-program.ts`; `Screen`'s `scrollRef` prop (`src/components/ui/screen.tsx`); `logging.dayProgress` (`src/hooks/use-program-logging.ts`).
- Produces:
  - `src/lib/program-focus.ts`:
    - `export type ProgramFocus = { week: number; dayId: string }`
    - `export const programFocus: { request(f: ProgramFocus): void; take(): ProgramFocus | null; subscribe(l: () => void): () => void }`
    - `export function useProgramFocus(): ProgramFocus | null`
    - Each request is stored as a new object. Only the latest one waits, and `take()` hands it over once.
  - `ProgramView` gets two new optional props: `focus?: ProgramFocus | null` (when it gets a new object, that day opens and the screen scrolls to it) and `scrollRef?: React.RefObject<RNScrollView | null>`.
  - The tw `View` (`@/src/tw`) types `ref` (React 19's ref-as-prop, as the tw `ScrollView` already does).
  - The Programa tab consumes a request once its program is on screen: `setViewWeek(week)` (null for the current week, like the week picker), the day opens (a manual collapse is dropped; a finished day is pinned open) and its card scrolls into view.

**Decisions** (the spec leaves these open):
- The scroll measures the day with `measureLayout` 300 ms after the focus is applied, not with offsets saved from `onLayout`: on web `onLayout` fires only when a view changes size, so a day pushed down by another one would keep a stale y.

Match each edit on its quoted text: Task 5 already edited `program-view.tsx` (the hooks import, after `const openExercise`, the `<DayCard` props, `DayCard`'s destructure and prop type, the row's `onToggleDone`); none of those lines is an anchor here.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/lib/program-focus.ts src/lib/program-focus.test.ts src/tw/index.tsx src/components/program/program-view.tsx "app/(tabs)/routines/index.tsx"
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.

Read in full: `src/components/program/program-view.tsx`, `app/(tabs)/routines/index.tsx`, `src/tw/index.tsx`, `src/components/ui/screen.tsx`, `src/hooks/use-program.ts` and `src/lib/exercise-session.ts` (the module-store pattern copied below).

- [ ] **Step 2: Write the failing test**

Create `src/lib/program-focus.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { programFocus } from "@/src/lib/program-focus";

describe("programFocus", () => {
  // One store for the whole module: start every test with nothing pending.
  beforeEach(() => {
    programFocus.take();
  });

  it("has nothing to take before a request", () => {
    assert.equal(programFocus.take(), null);
  });

  it("hands a request over once", () => {
    programFocus.request({ week: 2, dayId: "day-3" });
    assert.deepEqual(programFocus.take(), { week: 2, dayId: "day-3" });
    assert.equal(programFocus.take(), null);
  });

  it("keeps only the latest request that nobody took", () => {
    programFocus.request({ week: 2, dayId: "day-3" });
    programFocus.request({ week: 3, dayId: "day-1" });
    assert.deepEqual(programFocus.take(), { week: 3, dayId: "day-1" });
    assert.equal(programFocus.take(), null);
  });

  it("tells subscribers about a request and about it being taken", () => {
    let calls = 0;
    const unsubscribe = programFocus.subscribe(() => {
      calls += 1;
    });
    programFocus.request({ week: 1, dayId: "day-2" });
    assert.equal(calls, 1);
    programFocus.take();
    assert.equal(calls, 2);
    // Nothing pending: nothing changed, nobody is told.
    programFocus.take();
    assert.equal(calls, 2);
    unsubscribe();
    programFocus.request({ week: 1, dayId: "day-2" });
    assert.equal(calls, 2);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/lib/program-focus.test.ts`

Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …program-focus.test.ts` (the module doesn't exist yet), then `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 4: Write the store**

Create `src/lib/program-focus.ts`:

```ts
import { useSyncExternalStore } from "react";

/**
 * A request for the Programa tab to show one day: its week selected, the day
 * open and scrolled into view. The day-complete modal's «Ir al Día n» asks,
 * then navigates to the tab; the tab takes the request once its program is
 * on screen, so one made before the tab ever mounted waits for it.
 *
 * Only the latest request counts, and it's handed over once: a tab that
 * mounts later doesn't replay an old one.
 */

export type ProgramFocus = { week: number; dayId: string };

let pending: ProgramFocus | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export const programFocus = {
  /** Ask the Programa tab to show this week and day. Replaces any request
      still waiting. */
  request(focus: ProgramFocus) {
    pending = { week: focus.week, dayId: focus.dayId };
    emit();
  },

  /** The waiting request, now handed over (null when there's none). */
  take(): ProgramFocus | null {
    const focus = pending;
    if (focus != null) {
      pending = null;
      emit();
    }
    return focus;
  },

  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

const getPending = () => pending;

/** The request waiting for the Programa tab, or null. A new object for every
    request, so asking for the same day twice still counts twice. */
export function useProgramFocus(): ProgramFocus | null {
  return useSyncExternalStore(programFocus.subscribe, getPending, getPending);
}
```

- [ ] **Step 5: Run the test again**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/lib/program-focus.test.ts`

Expected: `ℹ tests 4`, `ℹ suites 1`, `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 6: Let the tw View take a ref**

`ProgramView` measures two of its own views. React 19 passes `ref` as an ordinary prop, and `useCssElement` already forwards it to the RN view, as it does for the tw `ScrollView`. Only the type is missing.

In `src/tw/index.tsx`, find:

```tsx
export type ViewProps = React.ComponentProps<typeof RNView> & {
  className?: string;
};
```

Replace with:

```tsx
export type ViewProps = React.ComponentProps<typeof RNView> & {
  className?: string;
  // React 19 ref-as-prop; forwarded through useCssElement to RNView
  ref?: React.Ref<RNView>;
};
```

- [ ] **Step 7: ProgramView: imports, constants, props**

In `src/components/program/program-view.tsx`, find:

```tsx
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
```

Replace with:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScrollView as RNScrollView, View as RNView } from "react-native";
```

In `src/components/program/program-view.tsx`, find:

```tsx
import { PressableScale, Reveal, Swap } from "@/src/lib/motion";
```

Replace with:

```tsx
import { PressableScale, Reveal, Swap } from "@/src/lib/motion";
import type { ProgramFocus } from "@/src/lib/program-focus";
```

In `src/components/program/program-view.tsx`, find:

```tsx
const TABULAR = { fontVariant: ["tabular-nums" as const] };

type Props = {
```

Replace with:

```tsx
const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** «Ir al Día n»: time for the asked-for week to swap in and lay out before
    measuring where its day is. */
const FOCUS_SCROLL_DELAY_MS = 300;
/** Room left above a focused day's header row, so its card's top shows. */
const FOCUS_CONTEXT = 24;

type Props = {
```

In `src/components/program/program-view.tsx`, find:

```tsx
  notStarted: boolean;
};
```

Replace with:

```tsx
  notStarted: boolean;
  /** A day to show (src/lib/program-focus, taken by the routines screen): it
      opens, and the screen scrolls to it. A new object for every request. */
  focus?: ProgramFocus | null;
  /** The screen's scroll view, to scroll to `focus`. */
  scrollRef?: React.RefObject<RNScrollView | null>;
};
```

In `src/components/program/program-view.tsx`, find:

```tsx
  onSelectWeek,
  notStarted,
}: Props) {
```

Replace with:

```tsx
  onSelectWeek,
  notStarted,
  focus = null,
  scrollRef,
}: Props) {
```

- [ ] **Step 8: ProgramView: open the focused day and scroll to it**

In `src/components/program/program-view.tsx`, find:

```tsx
  const [pins, setPins] = useState<Record<string, boolean>>({});
```

Replace with:

```tsx
  const [pins, setPins] = useState<Record<string, boolean>>({});

  // «Ir al Día n» (the day-complete modal): open the day asked for. An
  // unfinished day opens on its own, so a manual collapse is dropped; a
  // finished one is pinned open. Adjusted while rendering, like Swap, so the
  // day is already open when its week swaps in.
  const [focusSeen, setFocusSeen] = useState<ProgramFocus | null>(null);
  if (focus != null && focus !== focusSeen) {
    setFocusSeen(focus);
    const key = `${focus.dayId}:${focus.week}`;
    const day = program.program_days.find((d) => d.id === focus.dayId);
    const progress = day != null ? logging.dayProgress(day, focus.week) : null;
    const finished = progress != null && progress.total > 0 && progress.done === progress.total;
    setPins(({ [key]: _pin, ...rest }) => (finished ? { ...rest, [key]: false } : rest));
  }

  // Then scroll it into view. Measured once the week has swapped in, not
  // kept from onLayout: on web onLayout only reports size changes, so a day
  // pushed down by another one opening above it would keep a stale y.
  const rootRef = useRef<RNView>(null);
  const rootY = useRef(0);
  const focusedHeader = useRef<RNView>(null);
  useEffect(() => {
    if (focus == null || scrollRef == null) return;
    const timer = setTimeout(() => {
      const header = focusedHeader.current;
      const root = rootRef.current;
      const scroll = scrollRef.current;
      if (header == null || root == null || scroll == null) return;
      header.measureLayout(
        root,
        (_x, y) => scroll.scrollTo({ y: Math.max(0, rootY.current + y - FOCUS_CONTEXT), animated: true }),
        () => {},
      );
    }, FOCUS_SCROLL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [focus, scrollRef]);
```

In `src/components/program/program-view.tsx`, find:

```tsx
  return (
    <View className="gap-3">
      {/* Header */}
```

Replace with:

```tsx
  return (
    <View
      ref={rootRef}
      // Where the program starts in the scroll content: the screen's top
      // padding, since nothing sits above it.
      onLayout={(e) => {
        rootY.current = e.nativeEvent.layout.y;
      }}
      className="gap-3"
    >
      {/* Header */}
```

The closing `</View>` of the root stays where it is.

- [ ] **Step 9: ProgramView: give the focused day's header the ref**

In `src/components/program/program-view.tsx`, find (in the days map):

```tsx
            key={day.id}
            day={day}
```

Replace with:

```tsx
            key={day.id}
            day={day}
            headerRef={day.id === focus?.dayId ? focusedHeader : undefined}
```

In `src/components/program/program-view.tsx`, find:

```tsx
function DayCard({
  day,
```

Replace with:

```tsx
function DayCard({
  day,
  headerRef,
```

In `src/components/program/program-view.tsx`, find:

```tsx
}: {
  day: ProgramDayWithExercises;
```

Replace with:

```tsx
}: {
  day: ProgramDayWithExercises;
  /** On the day the screen scrolls to («Ir al Día n»): its header row. */
  headerRef?: React.Ref<RNView>;
```

In `src/components/program/program-view.tsx`, find:

```tsx
      <View className="flex-row items-start gap-2 pb-1">
```

Replace with:

```tsx
      <View ref={headerRef} className="flex-row items-start gap-2 pb-1">
```

- [ ] **Step 10: The routines screen takes the request**

The request is applied while rendering, with the "adjust state on a change" pattern this codebase already uses in `Swap` and `profile.tsx`: a `setState` inside an effect would fail `react-hooks/set-state-in-effect`. The effect only clears the store.

In `app/(tabs)/routines/index.tsx`, find:

```tsx
import React from "react";
import { useTranslation } from "react-i18next";
```

Replace with:

```tsx
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ScrollView as RNScrollView } from "react-native";
```

In `app/(tabs)/routines/index.tsx`, find:

```tsx
import { useArrival } from "@/src/lib/motion";
```

Replace with:

```tsx
import { useArrival } from "@/src/lib/motion";
import { type ProgramFocus, programFocus, useProgramFocus } from "@/src/lib/program-focus";
```

In `app/(tabs)/routines/index.tsx`, find:

```tsx
  useRefreshOnFocus(refresh);
  const arrive = useArrival(loading && program == null);
```

Replace with:

```tsx
  useRefreshOnFocus(refresh);
  const arrive = useArrival(loading && program == null);
  const scrollRef = useRef<RNScrollView>(null);

  // «Ir al Día n» (the day-complete modal) asks for a week and a day: select
  // the week here (null for the current one, like the week picker), and
  // ProgramView opens the day and scrolls to it. Waits for the program, so a
  // request made before this tab ever mounted still lands.
  const requested = useProgramFocus();
  const [focus, setFocus] = useState<ProgramFocus | null>(null);
  if (requested != null && program != null && requested !== focus) {
    setFocus(requested);
    setViewWeek(requested.week === autoWeek ? null : requested.week);
  }
  // Handed over: coming back to the tab later doesn't replay it.
  useEffect(() => {
    if (focus != null) programFocus.take();
  }, [focus]);
```

In `app/(tabs)/routines/index.tsx`, find:

```tsx
        <Screen
          entering={arrive}
          onRefresh={refresh}
          contentContainerClassName="p-4 gap-3 pb-24"
        >
          <ProgramView
            program={program}
            week={week}
            selectedWeek={selectedWeek}
            autoWeek={autoWeek}
            onSelectWeek={setViewWeek}
            notStarted={notStarted}
          />
```

Replace with:

```tsx
        <Screen
          entering={arrive}
          onRefresh={refresh}
          scrollRef={scrollRef}
          contentContainerClassName="p-4 gap-3 pb-24"
        >
          <ProgramView
            program={program}
            week={week}
            selectedWeek={selectedWeek}
            autoWeek={autoWeek}
            onSelectWeek={setViewWeek}
            notStarted={notStarted}
            focus={focus}
            scrollRef={scrollRef}
          />
```

- [ ] **Step 11: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint 2>&1 | tail -2
```

Expected:
- `npm test`: `ℹ fail 0`; at `30d3b92` plus Tasks 1–6 it is `ℹ tests 141` (137 + 4), higher if another plan's tests have landed.
- `tsc` prints nothing.
- Lint ends with `✖ 3 problems (0 errors, 3 warnings)` (the baseline, all in `src/i18n/index.ts`).

- [ ] **Step 12: Regression check on the web build**

Start the `.claude/launch.json` "web" configuration (port 8081); USER STEP: the user signs in as a client with an active program. On the Programa tab:
- the program renders as before;
- the week picker still switches weeks;
- tapping a day header still collapses and reopens it;
- pull-to-refresh still works;
- checking a row still shows the check card (Task 5).

The browser console shows no new errors. Nothing calls `programFocus.request` yet; Task 8 adds the trigger and its end-to-end check. Stop the preview.

- [ ] **Step 13: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/lib/program-focus.ts src/lib/program-focus.test.ts src/tw/index.tsx src/components/program/program-view.tsx "app/(tabs)/routines/index.tsx"
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): Programa tab opens a requested day and scrolls to it" -m "src/lib/program-focus.ts is a small store the day-complete modal will use for «Ir al Día n»: the routines screen takes the request once its program is on screen and selects the week, and ProgramView opens the day (drops a manual collapse, or pins a finished day open) and scrolls its card into view, measured with measureLayout after the week swaps in. The tw View now types React 19's ref prop." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those five paths.

---

### Task 8: Day modal: next day and preview, «Ir al Día n» / «Ir a la semana w», «Contarle a {coach}», «Listo»

**Files:**
- Create: `src/i18n/day-done.test.ts`
- Create: `src/utils/day-share.ts`
- Test: `src/utils/day-share.test.ts`
- Modify: `src/i18n/es.ts` (a new `dayDone` section before `// Meals`; remove the three unused `program.dayDoneNext*` keys)
- Modify: `src/i18n/en.ts` (the same)
- Modify: `src/components/program/day-complete-modal.tsx`

**Interfaces:**
- Consumes:
  - Task 2: `nextDay(program, dayId, week, isDone, now?)` → `{ kind: "day"; day; week; sameWeek } | { kind: "locked"; week; opensOn } | { kind: "blockDone" }`, where `opensOn` is the locked week's own opening date (`"YYYY-MM-DD"`, as today's `nextWeekOpens` line uses it).
  - Task 5: `CelebrationProvider.celebrateDay` is already the one gate (once per day and week per session, card dismissed, sheet closed first). This task doesn't touch the provider.
  - Task 7: `programFocus.request({ week, dayId })`.
  - Existing: `useCoach()` → `{ coach: { display_name, whatsapp, … } | null }`; the modal's `daySummary(...)` → `{ exercises, sets, records: { name, weightKg, reps }[], … }` (Task 1 kept its shape); `useToday()`; the imperative `router` from expo-router (the modal is mounted above the router, in `CelebrationProvider`); `Button` (`variant="secondary" | "ghost"`, `size="sm"`, `icon`) and `SkewButton` from `@/src/components/ui`.
- Produces:
  - Copy: `dayDone.*` in es and en: the spec's Copy table (`goDay`, `goWeek`, `preview_one`/`preview_other`, `tellCoach`, `whatsappSummary`) plus the keys for cases the table doesn't cover (below).
  - `src/utils/day-share.ts`:
    - `export type DayShare = { n: number; label: string | null; exercises: number; sets: number; minutes: number | null; record: { name: string; weight: number; unit: string; reps: number } | null }`
    - `export function dayShareText(t: TFunction, day: DayShare): string`
    - `export function whatsappLink(phone: string | null | undefined, text: string): string | null`

**Decisions** (the spec leaves these open):
- Extra `dayDone` keys: `previewBare_one`/`_other` and `whatsappSummaryBare` for a day with neither label nor weekday (like the old `program.dayDoneNextBare`); `tellCoachBare` («Contarle a tu coach») for a coach with no display name; `summaryExercises_*`, `summarySets_*`, `summaryMinutes` and `summaryRecord` for the pieces of `{{stats}}`. `summaryRecord` carries `{{unit}}` (as `program.dayDoneRecordLine` does), so the message reads «100 kg × 5».
- With nowhere to go (the next week still locked, or the block over), «Listo» stays the red main button, as today; otherwise it is a quiet ghost button under «Ir al…» and WhatsApp.
- «Contarle a {coach}» uses the coach's `display_name`, trimmed; the modal stays open after WhatsApp opens.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/i18n/day-done.test.ts src/utils/day-share.ts src/utils/day-share.test.ts src/i18n/es.ts src/i18n/en.ts src/components/program/day-complete-modal.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "export function nextDay" -- src/utils/check-card.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "wasCelebrated" -- src/providers/celebration-provider.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "export const programFocus" -- src/lib/program-focus.ts
```

Expected:
- The second command prints nothing. Otherwise stop and ask.
- If the first command prints nothing too, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`.
- The three greps print one line each. If one prints nothing, its task (2, 5 or 7) hasn't landed: stop and ask.

Read in full: `src/components/program/day-complete-modal.tsx`, `src/providers/celebration-provider.tsx`, `src/components/coach-section.tsx` (the wa.me pattern), `src/components/ui/skew-button.tsx`, `src/components/ui/button.tsx` and the `nextDay` part of `src/utils/check-card.ts`.

- [ ] **Step 2: Write the failing copy test**

The table holds the spec's Copy table (`dayDone.*`) word for word, and the extra keys listed under **Decisions**.

Create `src/i18n/day-done.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";

// The day-complete modal's copy: the spec's Copy table
// (docs/superpowers/specs/2026-10-01-check-celebration-design.md, dayDone.*)
// word for word, plus the fallbacks for a day with no label or weekday and a
// coach with no name, and the pieces of the WhatsApp summary. [key, es, en].
const COPY: [string, string, string][] = [
  ["goDay", "Ir al Día {{n}}", "Go to Day {{n}}"],
  ["goWeek", "Ir a la semana {{w}}", "Go to week {{w}}"],
  [
    "preview_one",
    "Día {{n}} · {{label}} · {{count}} ejercicio",
    "Day {{n}} · {{label}} · {{count}} exercise",
  ],
  [
    "preview_other",
    "Día {{n}} · {{label}} · {{count}} ejercicios",
    "Day {{n}} · {{label}} · {{count}} exercises",
  ],
  ["previewBare_one", "Día {{n}} · {{count}} ejercicio", "Day {{n}} · {{count}} exercise"],
  ["previewBare_other", "Día {{n}} · {{count}} ejercicios", "Day {{n}} · {{count}} exercises"],
  ["tellCoach", "Contarle a {{coach}}", "Tell {{coach}}"],
  ["tellCoachBare", "Contarle a tu coach", "Tell your coach"],
  [
    "whatsappSummary",
    "¡Terminé el Día {{n}} ({{label}})! {{stats}}",
    "I finished Day {{n}} ({{label}})! {{stats}}",
  ],
  ["whatsappSummaryBare", "¡Terminé el Día {{n}}! {{stats}}", "I finished Day {{n}}! {{stats}}"],
  ["summaryExercises_one", "{{count}} ejercicio", "{{count}} exercise"],
  ["summaryExercises_other", "{{count}} ejercicios", "{{count}} exercises"],
  ["summarySets_one", "{{count}} serie", "{{count}} set"],
  ["summarySets_other", "{{count}} series", "{{count}} sets"],
  ["summaryMinutes", "{{minutes}} min", "{{minutes}} min"],
  [
    "summaryRecord",
    "Récord en {{name}}: {{weight}} {{unit}} × {{reps}}",
    "Record on {{name}}: {{weight}} {{unit}} × {{reps}}",
  ],
];

describe("dayDone copy", () => {
  it("es has exactly these keys and texts", () => {
    assert.deepEqual({ ...es.dayDone }, Object.fromEntries(COPY.map(([key, text]) => [key, text])));
  });

  it("en has exactly these keys and texts", () => {
    assert.deepEqual({ ...en.dayDone }, Object.fromEntries(COPY.map(([key, , text]) => [key, text])));
  });
});

// Rendered like the app renders it: an i18next instance of its own, set up
// like src/i18n/index.ts (which also reads AsyncStorage, so it can't load
// under Node). The _one/_other suffixes are i18next's default plural format.
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

describe("dayDone copy, rendered", () => {
  it("es: the preview counts one exercise, or more", () => {
    const t = i18n.getFixedT("es");
    assert.equal(t("dayDone.preview", { n: 3, label: "Pierna", count: 1 }), "Día 3 · Pierna · 1 ejercicio");
    assert.equal(t("dayDone.preview", { n: 3, label: "Pierna", count: 5 }), "Día 3 · Pierna · 5 ejercicios");
    assert.equal(t("dayDone.previewBare", { n: 3, count: 5 }), "Día 3 · 5 ejercicios");
  });

  it("en: the preview counts one exercise, or more", () => {
    const t = i18n.getFixedT("en");
    assert.equal(t("dayDone.preview", { n: 3, label: "Legs", count: 1 }), "Day 3 · Legs · 1 exercise");
    assert.equal(t("dayDone.preview", { n: 3, label: "Legs", count: 5 }), "Day 3 · Legs · 5 exercises");
    assert.equal(t("dayDone.previewBare", { n: 3, count: 1 }), "Day 3 · 1 exercise");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/i18n/day-done.test.ts`

Expected: `ℹ tests 4`, `ℹ suites 2`, `ℹ pass 0`, `ℹ fail 4`, each failing with `AssertionError [ERR_ASSERTION]`: there is no `dayDone` section yet, and `t` returns the key itself.

- [ ] **Step 4: Add the Spanish copy**

In `src/i18n/es.ts`, find:

```ts
  // Meals
  meals: {
```

Replace with:

```ts
  // Día completado (el sello): a dónde seguir y contarle al coach
  dayDone: {
    goDay: "Ir al Día {{n}}",
    goWeek: "Ir a la semana {{w}}",
    // Plurales de i18next: t("dayDone.preview", { n, label, count }) elige
    // _one o _other según count.
    preview_one: "Día {{n}} · {{label}} · {{count}} ejercicio",
    preview_other: "Día {{n}} · {{label}} · {{count}} ejercicios",
    previewBare_one: "Día {{n}} · {{count}} ejercicio",
    previewBare_other: "Día {{n}} · {{count}} ejercicios",
    tellCoach: "Contarle a {{coach}}",
    tellCoachBare: "Contarle a tu coach",
    whatsappSummary: "¡Terminé el Día {{n}} ({{label}})! {{stats}}",
    whatsappSummaryBare: "¡Terminé el Día {{n}}! {{stats}}",
    summaryExercises_one: "{{count}} ejercicio",
    summaryExercises_other: "{{count}} ejercicios",
    summarySets_one: "{{count}} serie",
    summarySets_other: "{{count}} series",
    summaryMinutes: "{{minutes}} min",
    summaryRecord: "Récord en {{name}}: {{weight}} {{unit}} × {{reps}}",
  },

  // Meals
  meals: {
```

- [ ] **Step 5: Add the English copy**

In `src/i18n/en.ts`, find:

```ts
  // Meals
  meals: {
```

Replace with:

```ts
  // Day complete (the seal): where to go next, and telling the coach
  dayDone: {
    goDay: "Go to Day {{n}}",
    goWeek: "Go to week {{w}}",
    // i18next plurals: t("dayDone.preview", { n, label, count }) picks _one
    // or _other by count.
    preview_one: "Day {{n}} · {{label}} · {{count}} exercise",
    preview_other: "Day {{n}} · {{label}} · {{count}} exercises",
    previewBare_one: "Day {{n}} · {{count}} exercise",
    previewBare_other: "Day {{n}} · {{count}} exercises",
    tellCoach: "Tell {{coach}}",
    tellCoachBare: "Tell your coach",
    whatsappSummary: "I finished Day {{n}} ({{label}})! {{stats}}",
    whatsappSummaryBare: "I finished Day {{n}}! {{stats}}",
    summaryExercises_one: "{{count}} exercise",
    summaryExercises_other: "{{count}} exercises",
    summarySets_one: "{{count}} set",
    summarySets_other: "{{count}} sets",
    summaryMinutes: "{{minutes}} min",
    summaryRecord: "Record on {{name}}: {{weight}} {{unit}} × {{reps}}",
  },

  // Meals
  meals: {
```

- [ ] **Step 6: Run the copy test again**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/i18n/day-done.test.ts`

Expected: `ℹ tests 4`, `ℹ suites 2`, `ℹ pass 4`, `ℹ fail 0`.

- [ ] **Step 7: Write the failing WhatsApp-summary test**

Create `src/utils/day-share.test.ts`:

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import { createInstance } from "i18next";
import assert from "node:assert/strict";
import { before, describe, it } from "node:test";

import en from "@/src/i18n/en";
import es from "@/src/i18n/es";
import { type DayShare, dayShareText, whatsappLink } from "@/src/utils/day-share";

// The app's real copy, in an i18next instance of its own set up like
// src/i18n/index.ts (that module also reads AsyncStorage, which can't load
// under Node).
const i18n = createInstance();

before(async () => {
  await i18n.init({
    resources: { es: { translation: es }, en: { translation: en } },
    lng: "es",
    fallbackLng: "es",
    interpolation: { escapeValue: false },
  });
});

const LEG_DAY: DayShare = {
  n: 3,
  label: "Pierna",
  exercises: 5,
  sets: 18,
  minutes: null,
  record: null,
};

describe("dayShareText", () => {
  it("says what was done: the exercises and the sets", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), LEG_DAY),
      "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series",
    );
  });

  it("adds the minutes and the record only when there are any", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), {
        ...LEG_DAY,
        minutes: 42,
        record: { name: "Sentadilla", weight: 100, unit: "kg", reps: 5 },
      }),
      "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series · 42 min · Récord en Sentadilla: 100 kg × 5",
    );
    assert.equal(
      dayShareText(i18n.getFixedT("es"), {
        ...LEG_DAY,
        record: { name: "Sentadilla", weight: 100, unit: "kg", reps: 5 },
      }),
      "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series · Récord en Sentadilla: 100 kg × 5",
    );
  });

  it("counts one exercise and one set in the singular", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), { ...LEG_DAY, exercises: 1, sets: 1 }),
      "¡Terminé el Día 3 (Pierna)! 1 ejercicio · 1 serie",
    );
  });

  it("leaves the parentheses out for a day with no label", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("es"), { ...LEG_DAY, label: null }),
      "¡Terminé el Día 3! 5 ejercicios · 18 series",
    );
  });

  it("speaks English too", () => {
    assert.equal(
      dayShareText(i18n.getFixedT("en"), {
        ...LEG_DAY,
        label: "Legs",
        minutes: 42,
        record: { name: "Squat", weight: 225, unit: "lb", reps: 5 },
      }),
      "I finished Day 3 (Legs)! 5 exercises · 18 sets · 42 min · Record on Squat: 225 lb × 5",
    );
  });
});

describe("whatsappLink", () => {
  it("keeps only the number's digits and types the message in", () => {
    const text = "¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series";
    const url = whatsappLink("+1 (809) 555-1234", text);
    assert.ok(url != null);
    assert.ok(url.startsWith("https://wa.me/18095551234?text="));
    assert.equal(decodeURIComponent(url.slice(url.indexOf("?text=") + 6)), text);
  });

  it("is null without a number", () => {
    assert.equal(whatsappLink(null, "hola"), null);
    assert.equal(whatsappLink(undefined, "hola"), null);
    assert.equal(whatsappLink("", "hola"), null);
    assert.equal(whatsappLink(" - ", "hola"), null);
  });
});
```

- [ ] **Step 8: Run it and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/day-share.test.ts`

Expected: FAIL with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …day-share.test.ts` (the module doesn't exist yet), then `ℹ tests 1`, `ℹ fail 1`.

- [ ] **Step 9: Write the summary helper**

Create `src/utils/day-share.ts`:

```ts
import type { TFunction } from "i18next";

// The day-complete modal's «Contarle a {coach}»: the finished day's summary,
// typed into a WhatsApp chat with the coach. Pure (the caller passes `t`), so
// it runs under `npm test`.

/** What the message says about the finished day. */
export type DayShare = {
  /** The day's number (day_index). */
  n: number;
  /** Its label, or its weekday; null when it has neither. */
  label: string | null;
  exercises: number;
  /** The day modal's count: logged sets, or the prescribed ones when none were. */
  sets: number;
  /** Minutes on the exercise clock; null when nothing was timed. */
  minutes: number | null;
  /** The day's first new record, in the client's unit; null when none. */
  record: { name: string; weight: number; unit: string; reps: number } | null;
};

/** «¡Terminé el Día 3 (Pierna)! 5 ejercicios · 18 series · 42 min · Récord en
    Sentadilla: 100 kg × 5». The minutes and the record only when there are
    any. */
export function dayShareText(t: TFunction, day: DayShare): string {
  const stats = [
    t("dayDone.summaryExercises", { count: day.exercises }),
    t("dayDone.summarySets", { count: day.sets }),
  ];
  if (day.minutes != null) stats.push(t("dayDone.summaryMinutes", { minutes: day.minutes }));
  if (day.record != null) stats.push(t("dayDone.summaryRecord", { ...day.record }));
  return day.label != null
    ? t("dayDone.whatsappSummary", { n: day.n, label: day.label, stats: stats.join(" · ") })
    : t("dayDone.whatsappSummaryBare", { n: day.n, stats: stats.join(" · ") });
}

/** A wa.me chat with this number, the message typed in (the coach section's
    link). Any formatting in the number is dropped; null without digits. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const digits = (phone ?? "").replace(/[^0-9]/g, "");
  return digits === "" ? null : `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
```

- [ ] **Step 10: Run it again**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && node --import ./scripts/test-register.mjs --test src/utils/day-share.test.ts`

Expected: `ℹ tests 7`, `ℹ suites 2`, `ℹ pass 7`, `ℹ fail 0`.

- [ ] **Step 11: Modal: imports**

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import * as Haptics from "expo-haptics";
```

Replace with (the modal sits above the router, so it uses the imperative `router`):

```tsx
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
```

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import { Modal } from "react-native";
```

Replace with:

```tsx
import { Linking, Modal } from "react-native";
```

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import { Burst, CapsLabel, Card, PosterText, SkewButton } from "@/src/components/ui";
```

Replace with:

```tsx
import { Burst, Button, CapsLabel, Card, PosterText, SkewButton } from "@/src/components/ui";
```

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import { useAuth } from "@/src/hooks/use-auth";
```

Replace with:

```tsx
import { useAuth } from "@/src/hooks/use-auth";
import { useCoach } from "@/src/hooks/use-coach";
```

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import { DUR, EASE_IN, EASE_OUT } from "@/src/lib/motion";
```

Replace with:

```tsx
import { DUR, EASE_IN, EASE_OUT } from "@/src/lib/motion";
import { programFocus } from "@/src/lib/program-focus";
import { useToday } from "@/src/lib/today";
```

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import { formatShortDate } from "@/src/utils/dates";
```

Replace with:

```tsx
import { nextDay } from "@/src/utils/check-card";
import { formatShortDate } from "@/src/utils/dates";
```

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
import { dayLabel } from "@/src/utils/day-label";
```

Replace with:

```tsx
import { dayLabel } from "@/src/utils/day-label";
import { dayShareText, whatsappLink } from "@/src/utils/day-share";
```

In `src/components/program/day-complete-modal.tsx`, find (`weekOpensOn` is no longer used):

```tsx
import { effectivePrescription, weekByNumber, weekOpensOn } from "@/src/utils/program";
```

Replace with:

```tsx
import { effectivePrescription, weekByNumber } from "@/src/utils/program";
```

- [ ] **Step 12: Modal: the next day, the summary, the two actions**

In `src/components/program/day-complete-modal.tsx`, find (the hooks go before the early `return null`):

```tsx
  const logging = useProgramLogging(program);
  const reduced = useReducedMotion();
```

Replace with:

```tsx
  const logging = useProgramLogging(program);
  const reduced = useReducedMotion();
  const today = useToday();
  const { coach } = useCoach();
```

The old next-day pick (the first unfinished day by `day_index`) gives way to `nextDay`, which follows the Programa tab's order and the week lock (Fix 3).

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
  const doneCount = doneFlags.filter(Boolean).length;
  const next = days.find((_, i) => !doneFlags[i]) ?? null;
  const nextTitle = next != null ? dayTitle(next, t) : null;
  // "Solo semana actual": with the week done and the next one still closed,
  // say when it opens instead of pointing at it. Its own opening date, not
  // the lock's (before the start, the lock only knows the start date).
  // Always false for free programs.
  const nextWeekLocked = week < program.duration_weeks && logging.lockOf(week + 1) != null;
  const nextLine =
    next != null
      ? nextTitle != null
        ? t("program.dayDoneNext", { n: next.day_index, label: nextTitle })
        : t("program.dayDoneNextBare", { n: next.day_index })
      : week < program.duration_weeks
        ? nextWeekLocked
          ? t("program.nextWeekOpens", {
              n: week + 1,
              date: formatShortDate(weekOpensOn(program.start_date, week + 1), i18n.language),
            })
          : t("program.dayDoneNextWeek", { n: week + 1 })
        : t("program.dayDoneBlock");

  const record = summary.records[0] ?? null;
```

Replace with:

```tsx
  const doneCount = doneFlags.filter(Boolean).length;

  // Where to go next, in the Programa tab's order: the next unfinished day
  // of this week (or one skipped earlier), else the next week's first day.
  // A next week still closed ("Solo semana actual") gets the day it opens
  // instead of a button; after the last week, the end of the block.
  const next = nextDay(program, dayId, week, logging.isDone, today);
  const nextTitle = next.kind === "day" ? dayTitle(next.day, t) : null;
  const nextLine =
    next.kind === "day"
      ? t(nextTitle != null ? "dayDone.preview" : "dayDone.previewBare", {
          n: next.day.day_index,
          label: nextTitle,
          count: next.day.program_exercises.length,
        })
      : next.kind === "locked"
        ? t("program.nextWeekOpens", { n: next.week, date: formatShortDate(next.opensOn, i18n.language) })
        : t("program.dayDoneBlock");

  const record = summary.records[0] ?? null;

  // «Contarle a {coach}»: the day's summary typed into a WhatsApp chat with
  // the coach, like the coach section's link. Only when the coach has a number.
  const shareUrl = whatsappLink(
    coach?.whatsapp,
    dayShareText(t, {
      n: day.day_index,
      label: title,
      exercises: summary.exercises,
      sets: summary.sets,
      minutes: trainedSeconds > 0 ? Math.max(1, Math.round(trainedSeconds / 60)) : null,
      record:
        record != null
          ? { name: record.name, weight: kgToUnit1(record.weightKg, unit), unit, reps: record.reps }
          : null,
    }),
  );
  const coachName = coach?.display_name?.trim() || null;

  // «Ir al Día n» / «Ir a la semana w»: the Programa tab shows that week with
  // the day open (src/lib/program-focus). It opens no exercise.
  const goNext = () => {
    if (next.kind !== "day") return;
    onClose();
    programFocus.request({ week: next.week, dayId: next.day.id });
    router.navigate("/(tabs)/routines");
  };
  const tellCoach = () => {
    if (shareUrl != null) Linking.openURL(shareUrl).catch(() => {});
  };
```

The `{nextLine}` text under the week bar stays where it is: for a next day it now shows the preview right above the buttons.

- [ ] **Step 13: Modal: the buttons**

The main SkewButton («Ir al Día n» or «Ir a la semana w»), the secondary WhatsApp `Button`, and a quiet ghost «Listo». With nowhere to go (the next week still closed, or the block over), «Listo» stays the red main button, as today.

In `src/components/program/day-complete-modal.tsx`, find:

```tsx
              <SkewButton onPress={onClose} className="mt-1">
                {t("program.dayDoneCta")}
              </SkewButton>
```

Replace with:

```tsx
              {/* Where to go from here. With nowhere to go (the next week
                  still closed, the block over), «Listo» is the main button. */}
              <View className="mt-1 gap-2">
                {next.kind === "day" ? (
                  <SkewButton onPress={goNext}>
                    {next.sameWeek
                      ? t("dayDone.goDay", { n: next.day.day_index })
                      : t("dayDone.goWeek", { w: next.week })}
                  </SkewButton>
                ) : (
                  <SkewButton onPress={onClose}>{t("program.dayDoneCta")}</SkewButton>
                )}
                {shareUrl != null && (
                  <Button variant="secondary" icon="logo-whatsapp" onPress={tellCoach}>
                    {coachName != null
                      ? t("dayDone.tellCoach", { coach: coachName })
                      : t("dayDone.tellCoachBare")}
                  </Button>
                )}
                {next.kind === "day" && (
                  <Button variant="ghost" size="sm" onPress={onClose}>
                    {t("program.dayDoneCta")}
                  </Button>
                )}
              </View>
```

- [ ] **Step 14: Remove the old next-day keys**

Only the old modal code used them; `program.nextWeekOpens` and `program.dayDoneBlock` stay (the home card uses the first).

In `src/i18n/es.ts`, find:

```ts
    dayDoneNext: "Siguiente: día {{n}}, {{label}}",
    dayDoneNextBare: "Siguiente: día {{n}}",
    dayDoneNextWeek: "Siguiente: semana {{n}}",
    dayDoneBlock: "Terminaste el bloque.",
```

Replace with:

```ts
    dayDoneBlock: "Terminaste el bloque.",
```

In `src/i18n/en.ts`, find:

```ts
    dayDoneNext: "Next: day {{n}}, {{label}}",
    dayDoneNextBare: "Next: day {{n}}",
    dayDoneNextWeek: "Next: week {{n}}",
    dayDoneBlock: "You finished the block.",
```

Replace with:

```ts
    dayDoneBlock: "You finished the block.",
```

Then run:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app grep -n -e "dayDoneNext" -e "weekOpensOn" -- src/components/program/day-complete-modal.tsx src/i18n/es.ts src/i18n/en.ts
```

Expected: prints nothing (and exits with status 1).

- [ ] **Step 15: Gate**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test 2>&1 | grep -E "^ℹ (tests|pass|fail)"
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint 2>&1 | tail -2
```

Expected:
- `npm test`: `ℹ fail 0`; at `30d3b92` plus Tasks 1–7 it is `ℹ tests 152` (141 + 11), higher if another plan's tests have landed.
- `tsc` prints nothing.
- Lint ends with `✖ 3 problems (0 errors, 3 warnings)` (the baseline, all in `src/i18n/index.ts`).

- [ ] **Step 16: Check it on the web build**

Start the `.claude/launch.json` "web" configuration (port 8081), viewport 375×812. USER STEP: the user signs in as a client whose active program has at least three days in the current week; the coach's profile should have a WhatsApp number. The days already celebrated live in memory: reload the page to celebrate a day again, and use a fresh day or week for each check. Keep the console open: no new errors.

1. **Same week.** On Programa, check every exercise of Day 1 from the rows. About half a second after the last check «Sellado» opens. Under the week bar: «Día 2 · {label} · {n} ejercicios»; then «IR AL DÍA 2», «Contarle a {coach's name}» and a red-text «Listo». Tap «IR AL DÍA 2»: the modal closes, the same week stays selected, Day 1 collapses and Day 2 is open; the page scrolls so Day 2's card top sits just under the top edge.
2. **Skipped day.** Leave Day 2 unchecked, then finish every later day of the week: the modal's preview and button name Day 2 (it wraps back to the skipped day).
3. **From Inicio, Programa never opened (Review Focus 4).** Reload the page on Inicio (`http://localhost:8081/`) without opening Programa, finish the home card's day there, and tap «Ir al Día n»: the app switches to Programa on that week, with that day open and its header near the top of the screen. With `javascript_tool` (put the day's number in place of 2):

```js
[...document.querySelectorAll("div")]
  .filter((el) => el.childElementCount === 0 && el.textContent === "DÍA 2" && el.getBoundingClientRect().height > 0)
  .map((el) => Math.round(el.getBoundingClientRect().top))
```

Expected: one value, between 0 and 80 (the day's «DÍA n» label, just under the top edge). Switch to Inicio and back: the page doesn't scroll again.
4. **Next week (Review Focus 4).** Collapse the target day by hand first if it is open, then finish the last unfinished day of the week: the button reads «IR A LA SEMANA {w+1}» and the preview names the first unfinished day of week w+1. Tapping it selects week w+1 in the week picker, with that day open and scrolled to.
5. **Locked or last week** (if such a program is available). Next week locked under «Solo semana actual»: the line reads «La semana {w+1} se abre el {date}», there is no «Ir a…» button, and «LISTO» is the red button. Last week: «Terminaste el bloque.» and «LISTO».
6. **WhatsApp (Review Focus 5).** Tap «Contarle a {coach}»: a new tab opens `https://wa.me/<digits>?text=…`; the decoded text is «¡Terminé el Día n ({label})! {x} ejercicios · {y} series», plus « · {m} min» only if one of the day's exercises was finished with «Terminar», and « · Récord en {name}: {weight} {unit} × {reps}» only when the modal shows a record. The modal stays open.
7. **No WhatsApp number (Review Focus 5).** With a coach whose `whatsapp` is empty (a test coach profile; never edit a real coach's profile without asking): no «Contarle a…» button, and «Ir al…» and «Listo» still lay out cleanly. With DevTools offline (or the network blocked), tapping «Contarle a…» does no harm: no unhandled rejection in the console.
8. **No replay (Task 5).** On a day just celebrated, uncheck its last exercise and check it again: no modal, and the card reads «Día n completo» with «Deshacer». Uncheck the whole day with the «x/x» pill and tap it again: no modal and no card.
9. **English.** Switch to English in Ajustes and celebrate a fresh day: «Day n · {label} · n exercises», «GO TO DAY n» or «GO TO WEEK n», «Tell {coach}», «Done».

Undo what the checks changed. Stop the preview.

- [ ] **Step 17: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/i18n/day-done.test.ts src/utils/day-share.ts src/utils/day-share.test.ts src/i18n/es.ts src/i18n/en.ts src/components/program/day-complete-modal.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): day modal goes to the next day and tells the coach" -m "«Sellado» picks the next day with nextDay (the Programa tab's order, wrapping to a skipped day, then the next week, or when a locked week opens), previews it, and offers «Ir al Día n» / «Ir a la semana w» (Programa focus), «Contarle a {coach}» (wa.me with the day's summary: exercises, sets, minutes and the record only when present) and a quiet «Listo». Copy: dayDone.* in es and en with _one/_other plurals; the unused program.dayDoneNext* keys go." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: the `diff --cached` lists exactly those six paths.

---

### Task 9: Device check on an Android phone (user steps)

**Files:** none. This task changes no file and makes no commit.

**Interfaces:** Consumes everything Tasks 1–8 built; produces nothing.

The spec's Verification asks for each row of the "When it shows" table, the card's buttons, the day modal and the three fixes on the phone. Tasks 5, 6 and 8 checked them on the web build; this pass repeats them where web can't tell: real touches, Android font metrics under the bars, haptics, the WhatsApp app, Android back and the system's reduced-motion setting. Every step after Step 1 is a USER STEP: ask the user to do it on their phone and report what they see; never type credentials.

- [ ] **Step 1: Build the release APK**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && CI=1 npx expo prebuild --platform android
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app/android && export JAVA_HOME="C:/Users/Signos/android-toolchain/jdk-17" ANDROID_HOME="C:/Users/Signos/android-toolchain/sdk" && cmd.exe //c ".\\gradlew.bat :app:assembleRelease -PreactNativeArchitectures=arm64-v8a"
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
```

Expected:
- Both `git status --short` print nothing (`android/` is git-ignored).
- Gradle ends with `BUILD SUCCESSFUL` (about 9 minutes from scratch, a few minutes for a JS-only rebuild) and writes `android/app/build/outputs/apk/release/app-release.apk`.
- The APK is signed with the debug key: it can't install over an EAS build. The user uninstalls an EAS build first.

Alternatively, the user runs their existing dev client against `npm start`; nothing here needs a native rebuild.

- [ ] **Step 2: Install and sign in (USER STEP)**

The user installs the APK, opens the app and signs in with a test client account that has an active program: at least two days of three or more exercises, one superset, prescribed rests, sets logged in an earlier week, and the coach's WhatsApp number set. Ask before using a real client's account, and undo the test checks at the end.

- [ ] **Step 3: Each row of the "When it shows" table (USER STEP)**

| # | Do | Expected |
|---|---|---|
| 1 | On Programa, check a row that isn't the day's last; then the same on the Inicio card | The card slides up above the tab bar: name, the day's segments and «n/total», «SIGUIENTE: …», «Descanso m:ss». One vibration (the checkbox's), none from the card. It closes after about 5 s |
| 2 | Open an exercise that isn't the day's last, «Empezar», wait 10 s, «Terminar» | One vibration; the sheet closes; the card shows «en 0:10» or so; no toast at the top |
| 3 | Check the last unchecked row of a day | No card; only «Sellado», about half a second later |
| 4 | Uncheck a row | Nothing |
| 5 | Finish a day with its «x/x» pill | No card; «Sellado» |
| 6 | In a sheet, «Marcar hecho» on an exercise that isn't the day's last | No card; the sheet shows «Hecho» and «Siguiente →» |
| 7 | Check two rows within 3 s, then a third | «2 hechos», then «3 hechos», only «Deshacer»; «Deshacer» clears all three |
| 8 | On an earlier week (when «Actual» is week 2 or later), check a row | A card with only «Deshacer» |
| 9 | On a locked week («Solo semana actual»), press a circle | A lock; nothing happens; no card |
| 10 | Uncheck a celebrated day's last exercise and check it again | No «Sellado»; the card reads «Día n completo» with «Deshacer» |
| 11 | Settings › Accessibility › "Remove animations" on, then check a row; turn it off afterwards | The card appears without sliding; «Sellado» opens straight in its final state |

- [ ] **Step 4: The card's buttons and touch (USER STEP)**

1. **Siguiente across a superset.** Check the first row of a superset: «AHORA A2: …» and no «Descanso»; tap it: the partner's sheet opens and nothing starts (no clock, no rest bar).
2. **Descanso.** On a card, tap «Descanso»: the rest bar appears and the card moves above it (about the same gap as between the bars), «Descanso» disappears, «Siguiente» stays.
3. **Deshacer.** It unchecks the row and closes the card.
4. **Above the bars (Review Focus 1).** With a rest running and an exercise in progress (start one, hide its sheet), check another row: the card sits above both bars, nothing overlaps or clips, at the normal and the largest system font size.
5. **Hold and swipe (Review Focus 2).** Hold a finger on the card for 8 s: it stays; let go: it closes about 5 s later. Swipe it down: it goes at once. A short drag snaps back. A drag that starts on «Siguiente» opens nothing.
6. **Another exercise in progress.** With an exercise in the session bar, check a different row: a card with only «Deshacer», above the bar.

- [ ] **Step 5: The day modal (USER STEP)**

1. **Preview and buttons.** Finish a day: «Día n · {label} · n ejercicios», «IR AL DÍA n», «Contarle a {coach}», «Listo».
2. **«Ir al Día n» from Programa and from Inicio (Review Focus 4).** From each, tap it: Programa shows that week with that day open, its header near the top. Kill and reopen the app, finish a day on Inicio before ever opening Programa, and tap it: the same.
3. **«Ir a la semana w».** Finish the week's last day: the button reads «IR A LA SEMANA w»; tapping it shows week w with its first unfinished day open. On a locked next week: «La semana w se abre el …», no «Ir a…» button, a red «LISTO».
4. **WhatsApp (Review Focus 5).** «Contarle a {coach}» opens the WhatsApp app on the coach's chat with «¡Terminé el Día n ({label})! … ejercicios · … series» typed in (plus « · m min» and the record when there are any). Back in the app, the modal is still there. With WhatsApp uninstalled or disabled, wa.me opens in the browser and the app doesn't crash. In airplane mode the tap does no harm.
5. **Android back.** With «Sellado» open, press back: it closes, and no exercise sheet is left behind.

- [ ] **Step 6: The three fixes (USER STEP)**

1. **Fix 1.** Open the day's last unchecked exercise and tap «Marcar hecho»: its burst plays, the sheet slides away, then «Sellado» opens on an empty screen.
2. **Fix 2.** Uncheck and re-check that day's last exercise: no replay (the card says «Día n completo»).
3. **Fix 3.** On a program whose days are reordered in the panel (when one is available), finish a day: the modal's next day follows the Programa tab's order, and a day skipped earlier in the week comes back once the later ones are done.

- [ ] **Step 7: Wrap up**

Ask the user to undo the test checks (uncheck the rows; quit any exercise in progress). Then:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
```

Expected: prints nothing; there is nothing to commit. Report any step whose result differed, with the step number, to the owner before calling the feature done.
