import type {
  LoadQualitative,
  ProgramExercise,
  ProgramWeek,
  ProgramWithDetails,
} from "@/src/types/database";
import { addDays, toDateKey } from "@/src/utils/dates";

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
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date(`${toDateKey(now)}T00:00:00`);
  const elapsedDays = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
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
): EffectivePrescription {
  // The week's global RIR/%load is shown ONCE in the week summary — don't
  // repeat it on every row. A row shows only the exercise's OWN specifics
  // (its pinned %1RM or qualitative load, and RIR if it pins one), matching
  // how the PDFs annotate individual lifts ("60% 1RM", "moderado", "ligero").
  // The week modulates the set count (deload); an exercise's own override for
  // that week (week_overrides) wins over both.
  const o = weekNumber != null ? (ex.week_overrides?.[String(weekNumber)] ?? null) : null;
  const pick = <T,>(v: T | undefined, base: T): T => (v !== undefined && v !== null ? v : base);

  return {
    name: ex.exercise?.name ?? ex.custom_name ?? "—",
    hasCatalog: ex.exercise != null,
    sets: pick(o?.sets, week?.sets_override ?? ex.sets),
    repMin: pick(o?.rep_min, ex.rep_min),
    repMax: pick(o?.rep_max, ex.rep_max),
    isUnilateral: ex.is_unilateral,
    rirMin: pick(o?.rir_min, ex.rir_min),
    rirMax: pick(o?.rir_max, ex.rir_max),
    loadPct: pick(o?.load_pct_1rm, ex.load_pct_1rm),
    loadPctIsRange: false,
    loadPctMax: null,
    loadQualitative: ex.load_qualitative,
    tempo: ex.tempo ?? null,
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

/** "RIR 2", "RIR 2–3", or null. */
export function formatRir(p: EffectivePrescription): string | null {
  if (p.rirMin == null && p.rirMax == null) return null;
  if (p.rirMin != null && p.rirMax != null) {
    return p.rirMin === p.rirMax ? `RIR ${p.rirMin}` : `RIR ${p.rirMin}–${p.rirMax}`;
  }
  return `RIR ${p.rirMin ?? p.rirMax}`;
}
