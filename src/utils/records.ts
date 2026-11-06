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

/**
 * Whether a set, as it is logged (set `setIndex` of `exerciseId` in `week`),
 * is a new record that very moment: the record cue. Weighed like
 * exerciseRecord, by estimated 1RM against the same lift's history from this
 * week or earlier (this exercise's own week aside, so the first week only
 * sets a baseline), and it must also beat this exercise's other sets this
 * week, so each improvement counts once. Its own row is being replaced and
 * doesn't count, and saving the same numbers again (each field saves on
 * blur) is no new moment.
 */
export function isNewRecordSet(input: {
  exerciseId: string;
  week: number;
  setIndex: number;
  set: { weight_kg: number | null; reps: number | null };
  logs: WorkoutSetLog[];
  nameOf: (programExerciseId: string) => string | null;
}): boolean {
  const { exerciseId, week, setIndex, set, logs, nameOf } = input;
  if (set.weight_kg == null || set.reps == null || set.weight_kg <= 0 || set.reps <= 0) return false;
  const name = norm(nameOf(exerciseId) ?? "");
  if (name === "") return false;

  const thisWeek = (s: WorkoutSetLog) => s.program_exercise_id === exerciseId && s.week_number === week;
  const own = logs.find((s) => thisWeek(s) && s.set_index === setIndex);
  if (own != null && own.weight_kg === set.weight_kg && own.reps === set.reps) return false;

  const before = bestSet(
    logs.filter(
      (s) =>
        s.program_exercise_id != null &&
        s.week_number <= week &&
        !thisWeek(s) &&
        norm(nameOf(s.program_exercise_id) ?? "") === name,
    ),
  );
  if (before == null) return false;
  const top = bestSet([before, ...logs.filter((s) => thisWeek(s) && s.set_index !== setIndex)]);
  return top == null || e1rm(set.weight_kg, set.reps) > e1rm(top.weight_kg, top.reps);
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
