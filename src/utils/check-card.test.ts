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
import { checkHighlight, nextDay, nextExercise } from "@/src/utils/check-card";

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
