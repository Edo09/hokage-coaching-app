import type { WorkoutSetLog } from "@/src/types/database";

/** One save from the set logger. A field left out keeps what the set already
    logged; null clears it. */
export type SetInput = {
  weight_kg?: number | null;
  reps?: number | null;
  rir?: number | null;
};

/** Which set: one row per (exercise, week, set) for the user. */
export type SetKey = Pick<
  WorkoutSetLog,
  "user_id" | "program_exercise_id" | "week_number" | "set_index"
>;

/** What the save writes on: a new row's id and created_at, and the day. */
export type SetStamp = { id: string; date: string; now: string };

function merged<T>(input: T | undefined, logged: T | null | undefined): T | null {
  return input !== undefined ? input : (logged ?? null);
}

/**
 * Upsert one set's actuals into `logs`: the set's row, if it has one, keeps
 * its id and created_at and takes the input over its values; otherwise the
 * set gets a new row. Returns the logs after the save and the row to queue.
 * Callers pass the fresh cache, so a reps save right after a weight save
 * lands on the row the weight save made instead of logging the set twice.
 */
export function saveSetLog(
  logs: WorkoutSetLog[],
  set: SetKey,
  input: SetInput,
  stamp: SetStamp,
): { logs: WorkoutSetLog[]; row: WorkoutSetLog } {
  const existing = logs.find(
    (s) =>
      s.program_exercise_id === set.program_exercise_id &&
      s.week_number === set.week_number &&
      s.set_index === set.set_index,
  );
  const row: WorkoutSetLog = {
    id: existing?.id ?? stamp.id,
    user_id: set.user_id,
    program_exercise_id: set.program_exercise_id,
    week_number: set.week_number,
    date: stamp.date,
    set_index: set.set_index,
    weight_kg: merged(input.weight_kg, existing?.weight_kg),
    reps: merged(input.reps, existing?.reps),
    rir: merged(input.rir, existing?.rir),
    created_at: existing?.created_at ?? stamp.now,
  };
  return {
    logs: existing != null ? logs.map((s) => (s === existing ? row : s)) : [...logs, row],
    row,
  };
}
