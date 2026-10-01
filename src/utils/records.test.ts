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
