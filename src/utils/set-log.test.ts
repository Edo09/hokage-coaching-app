/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { WorkoutSetLog } from "@/src/types/database";
import { saveSetLog, type SetInput } from "@/src/utils/set-log";

const SET = { user_id: "u1", program_exercise_id: "ex1", week_number: 2, set_index: 1 };

function log(over: Partial<WorkoutSetLog>): WorkoutSetLog {
  return {
    id: "old",
    user_id: "u1",
    program_exercise_id: "ex1",
    week_number: 2,
    date: "2026-09-30",
    set_index: 1,
    weight_kg: null,
    reps: null,
    rir: null,
    created_at: "2026-09-30T09:00:00.000Z",
    ...over,
  };
}

/** Saves one after another, each on the logs the last one left — what the
    hook does by reading the fresh cache. Stamps get ids n1, n2, … */
function saveAll(logs: WorkoutSetLog[], saves: [typeof SET, SetInput][]): WorkoutSetLog[] {
  saves.forEach(([set, input], i) => {
    logs = saveSetLog(logs, set, input, {
      id: `n${i + 1}`,
      date: "2026-10-01",
      now: `2026-10-01T10:00:0${i}.000Z`,
    }).logs;
  });
  return logs;
}

describe("saveSetLog", () => {
  it("a weight save, then a reps save, leave the set one row with both", () => {
    const first = saveSetLog([], SET, { weight_kg: 40, reps: null }, {
      id: "n1",
      date: "2026-10-01",
      now: "2026-10-01T10:00:00.000Z",
    });
    const second = saveSetLog(first.logs, SET, { weight_kg: 40, reps: 15 }, {
      id: "n2",
      date: "2026-10-01",
      now: "2026-10-01T10:00:00.400Z",
    });
    const want: WorkoutSetLog = {
      id: "n1",
      user_id: "u1",
      program_exercise_id: "ex1",
      week_number: 2,
      date: "2026-10-01",
      set_index: 1,
      weight_kg: 40,
      reps: 15,
      rir: null,
      created_at: "2026-10-01T10:00:00.000Z",
    };
    assert.deepEqual(second.logs, [want]);
    // The row the hook queues for the server: same id, so the upsert updates.
    assert.deepEqual(second.row, want);
  });

  it("three sets of 40×15, each weight then reps, leave three rows", () => {
    const set = (i: number) => ({ ...SET, set_index: i });
    const logs = saveAll([], [
      [set(1), { weight_kg: 40, reps: null }],
      [set(1), { weight_kg: 40, reps: 15 }],
      [set(2), { weight_kg: 40, reps: null }],
      [set(2), { weight_kg: 40, reps: 15 }],
      [set(3), { weight_kg: 40, reps: null }],
      [set(3), { weight_kg: 40, reps: 15 }],
    ]);
    assert.deepEqual(
      logs.map((s) => [s.id, s.set_index, s.weight_kg, s.reps]),
      [
        ["n1", 1, 40, 15],
        ["n3", 2, 40, 15],
        ["n5", 3, 40, 15],
      ],
    );
  });

  it("keeps a field the save leaves out, and clears one it sends as null", () => {
    const logged = [log({ weight_kg: 40, reps: 15, rir: 2 })];
    const kept = saveAll(logged, [[SET, { reps: 12 }]]);
    assert.deepEqual(
      kept.map((s) => [s.id, s.weight_kg, s.reps, s.rir]),
      [["old", 40, 12, 2]],
    );
    const cleared = saveAll(logged, [[SET, { weight_kg: null, reps: 15 }]]);
    assert.deepEqual(
      cleared.map((s) => [s.id, s.weight_kg, s.reps, s.rir]),
      [["old", null, 15, 2]],
    );
  });

  it("leaves other sets, exercises and weeks alone, and adds the new set's row", () => {
    const others = [
      log({ id: "set2", set_index: 2, weight_kg: 50 }),
      log({ id: "otherEx", program_exercise_id: "ex2", weight_kg: 60 }),
      log({ id: "week1", week_number: 1, weight_kg: 35 }),
    ];
    const logs = saveAll(others, [[SET, { weight_kg: 42.5, reps: 10 }]]);
    assert.deepEqual(logs, [
      ...others,
      {
        id: "n1",
        user_id: "u1",
        program_exercise_id: "ex1",
        week_number: 2,
        date: "2026-10-01",
        set_index: 1,
        weight_kg: 42.5,
        reps: 10,
        rir: null,
        created_at: "2026-10-01T10:00:00.000Z",
      },
    ]);
  });
});
