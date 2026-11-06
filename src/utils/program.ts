import type {
  LoadQualitative,
  ProgramExercise,
  ProgramWeek,
  ProgramWithDetails,
} from "@/src/types/database";
import { addDays, dateKeyToDate, toDateKey } from "@/src/utils/dates";

// Pure helpers for rendering a coach program (docs/COACH-PROGRAMS-SPEC.md,
// Phase 2). No data fetching, no React — kept testable and reused by the hook.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Auto current week from the start date: weeks elapsed since start, 1-based,
    clamped to [1, duration]. Before start → week 1 (a "starts on" note is the
    caller's job); after the block → the last week. */
export function currentWeekOf(
  startDate: string,
  durationWeeks: number,
  now: Date = new Date(),
): number {
  // Noon to noon, rounded: a DST change in between makes the gap a whole
  // number of days ± 1h, and flooring midnight gaps came out a day short
  // after a 23-hour day, opening the week a day late.
  const start = dateKeyToDate(startDate);
  const today = dateKeyToDate(toDateKey(now));
  const elapsedDays = Math.round((today.getTime() - start.getTime()) / DAY_MS);
  const week = Math.floor(elapsedDays / 7) + 1;
  return Math.min(Math.max(week, 1), Math.max(1, durationWeeks));
}

/** True when today is before the program's start date. */
export function isBeforeStart(startDate: string, now: Date = new Date()): boolean {
  return toDateKey(now) < startDate;
}

/** True when today is past the program's final day (start + weeks·7). */
export function isAfterEnd(
  startDate: string,
  durationWeeks: number,
  now: Date = new Date(),
): boolean {
  const lastDay = addDays(startDate, durationWeeks * 7 - 1);
  return toDateKey(now) > lastDay;
}

/** Why a week is view only under "Solo semana actual": the program hasn't
    started, or the week hasn't opened yet. `opensOn` is "YYYY-MM-DD". */
export type WeekLock = { kind: "start" | "week"; opensOn: string };

/** The day a week begins: the start date plus 7·(week − 1) days. */
export function weekOpensOn(startDate: string, week: number): string {
  return addDays(startDate, (week - 1) * 7);
}

/** Null when the client may log the week, else why not. Only programs with
    lock_future_weeks lock anything: before the start date the whole program
    is view only, then each week opens on its date (weekOpensOn) and stays
    open, so missed trainings can be caught up. After the block every week is
    open, since currentWeekOf stays on the last one. */
export function weekLock(
  program: Pick<ProgramWithDetails, "lock_future_weeks" | "start_date" | "duration_weeks">,
  week: number,
  now: Date = new Date(),
): WeekLock | null {
  // `!== true`: a program cached before the column existed has no flag.
  if (program.lock_future_weeks !== true) return null;
  if (isBeforeStart(program.start_date, now)) {
    return { kind: "start", opensOn: program.start_date };
  }
  if (week > currentWeekOf(program.start_date, program.duration_weeks, now)) {
    return { kind: "week", opensOn: weekOpensOn(program.start_date, week) };
  }
  return null;
}

export function weekByNumber(
  program: ProgramWithDetails,
  weekNumber: number,
): ProgramWeek | null {
  return program.program_weeks.find((w) => w.week_number === weekNumber) ?? null;
}

/** The effective prescription for an exercise IN a given week: the base row,
    with the week's global modulation applied (deload set-override; the week's
    RIR/%load win when the base row doesn't pin its own). */
export type EffectivePrescription = {
  name: string;
  hasCatalog: boolean;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  isUnilateral: boolean;
  rirMin: number | null;
  rirMax: number | null;
  loadPct: number | null;
  loadPctIsRange: boolean;
  loadPctMax: number | null;
  loadQualitative: LoadQualitative | null;
  tempo: string | null;
  restSeconds: number | null;
  notes: string | null;
  /** True when the coach set this exercise's own values for the week. */
  weekAdjusted: boolean;
};

export function effectivePrescription(
  ex: ProgramExercise,
  week: ProgramWeek | null,
  // Week being viewed. Needed on its own because a program may have no
  // program_weeks row for it while the exercise still overrides that week.
  weekNumber: number | null = week?.week_number ?? null,
  /** The program's tempo_default, for an exercise that sets no tempo. */
  tempoDefault: string | null = null,
): EffectivePrescription {
  // The week's global %load is shown ONCE in the week summary, not on every
  // row: a row shows only the exercise's OWN load (its pinned %1RM or
  // qualitative tag), matching how the PDFs annotate individual lifts ("60%
  // 1RM", "moderado"). RIR is different: the client follows it set by set, so
  // every exercise carries one, its own or else the week's. The week
  // modulates the set count (deload); an exercise's own override for that
  // week (week_overrides) wins over all of it.
  const o = weekNumber != null ? (ex.week_overrides?.[String(weekNumber)] ?? null) : null;
  const pick = <T,>(v: T | undefined, base: T): T => (v !== undefined && v !== null ? v : base);
  const ownRir = ex.rir_min != null || ex.rir_max != null;

  return {
    name: ex.exercise?.name ?? ex.custom_name ?? "—",
    hasCatalog: ex.exercise != null,
    sets: pick(o?.sets, week?.sets_override ?? ex.sets),
    repMin: pick(o?.rep_min, ex.rep_min),
    repMax: pick(o?.rep_max, ex.rep_max),
    isUnilateral: ex.is_unilateral,
    rirMin: pick(o?.rir_min, ownRir ? ex.rir_min : (week?.rir_min ?? null)),
    rirMax: pick(o?.rir_max, ownRir ? ex.rir_max : (week?.rir_max ?? null)),
    loadPct: pick(o?.load_pct_1rm, ex.load_pct_1rm),
    loadPctIsRange: false,
    loadPctMax: null,
    loadQualitative: ex.load_qualitative,
    tempo: ex.tempo?.trim() || tempoDefault?.trim() || null,
    restSeconds: ex.rest_seconds,
    notes: ex.notes,
    weekAdjusted: o != null && Object.keys(o).length > 0,
  };
}

/** "6–8", "12", or "—". */
export function formatReps(repMin: number | null, repMax: number | null): string {
  if (repMin == null && repMax == null) return "—";
  if (repMin != null && repMax != null) {
    return repMin === repMax ? String(repMin) : `${repMin}–${repMax}`;
  }
  return String(repMin ?? repMax);
}

/** "60%", "65–70%", or null. */
export function formatLoadPct(p: EffectivePrescription): string | null {
  if (p.loadPct == null) return null;
  if (p.loadPctIsRange && p.loadPctMax != null) return `${p.loadPct}–${p.loadPctMax}%`;
  return `${p.loadPct}%`;
}

/** A tempo's four phases in seconds (lowering, pause at the bottom, lifting,
 *  pause at the top), each a number or "X" for explosive. */
export type TempoPhases = [string, string, string, string];

const TEMPO_PHASE = /^(\d{1,2}|X)$/;

/** "3-1-2-0" as its four phases. Also reads "3120", "3 1 2 0", "3/1/2/0" and
 *  a lowercase x; null for a tempo written any other way (old free text),
 *  which is then shown as written. */
export function parseTempo(text: string | null): TempoPhases | null {
  const flat = (text ?? "").trim().toUpperCase();
  const parts = /^[\dX]{4}$/.test(flat) ? flat.split("") : flat.split(/[\s\-–—/.,]+/);
  return parts.length === 4 && parts.every((x) => TEMPO_PHASE.test(x)) ? (parts as TempoPhases) : null;
}

/** "RIR 2", "RIR 2–3", or null. */
export function formatRir(p: EffectivePrescription): string | null {
  if (p.rirMin == null && p.rirMax == null) return null;
  if (p.rirMin != null && p.rirMax != null) {
    return p.rirMin === p.rirMax ? `RIR ${p.rirMin}` : `RIR ${p.rirMin}–${p.rirMax}`;
  }
  return `RIR ${p.rirMin ?? p.rirMax}`;
}
