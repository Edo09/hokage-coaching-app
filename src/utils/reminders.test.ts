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
