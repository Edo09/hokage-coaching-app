import type {
  ProgramDayWithExercises,
  ProgramExercise,
  ProgramWithDetails,
  WorkoutSetLog,
} from "@/src/types/database";
import { weekLock, weekOpensOn } from "@/src/utils/program";

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
