import type {
  Exercise,
  MealWithItems,
  Profile,
  RoutineExercise,
  RoutineWithExercises,
  WorkoutLog,
} from "@/src/types/database";
import { estimateCaloriesBurned } from "@/src/utils/calories";
import { addDays, dateKeyToDate, toDateKey } from "@/src/utils/dates";

// Pure, synchronous calculations behind the progress dashboard. Everything
// here works on the same offline-first data the rest of the app renders
// (workout_logs store completed exercise NAMES — matching against the
// routine plan / exercise catalog is by normalized name).

export type Periodo = "week" | "month";

// Monday-based day-of-week index (0 = Mon .. 6 = Sun)
export function dowIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

export function mondayOf(key: string): string {
  return addDays(key, -dowIndex(dateKeyToDate(key)));
}

// available_days stores "Mon".."Sun"; routines.day_of_week stores "monday"..
// Normalize both to a Monday-based index via the first three letters.
const DOW_PREFIXES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export function dayNameToIndex(value: string): number {
  return DOW_PREFIXES.indexOf(value.trim().slice(0, 3).toLowerCase());
}

/** i18n keys for full day names, Monday-based (daysLong.*) */
export const DAY_LONG_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function distinctDays(logs: WorkoutLog[], from: string, to: string): Set<string> {
  const days = new Set<string>();
  for (const log of logs) {
    if (log.date >= from && log.date <= to) days.add(log.date);
  }
  return days;
}

/** Sessions done (distinct days with a log) vs plan for the period. */
export function compliance(
  logs: WorkoutLog[],
  daysPerWeek: number,
  periodo: Periodo,
  now = new Date(),
): { done: number; plan: number } {
  const today = toDateKey(now);
  const plan = Math.max(1, daysPerWeek);
  if (periodo === "week") {
    const mon = mondayOf(today);
    return { done: distinctDays(logs, mon, addDays(mon, 6)).size, plan };
  }
  const first = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1, 12));
  const weeksElapsed = Math.max(1, Math.round(now.getDate() / 7));
  return {
    done: distinctDays(logs, first, today).size,
    plan: weeksElapsed * plan,
  };
}

/** Consecutive complete weeks ending current or last week. The in-progress
 *  week keeps the streak alive while the plan is still achievable. */
export function weeklyStreak(
  logs: WorkoutLog[],
  daysPerWeek: number,
  now = new Date(),
): number {
  const plan = Math.max(1, daysPerWeek);
  const today = toDateKey(now);
  const curMon = mondayOf(today);
  const doneInWeek = (mon: string) => distinctDays(logs, mon, addDays(mon, 6)).size;

  let streak = 0;
  let cursor: string;
  const curDone = doneInWeek(curMon);
  if (curDone >= plan) {
    streak = 1;
    cursor = addDays(curMon, -7);
  } else {
    const todayDone = logs.some((l) => l.date === today);
    const remaining = 6 - dowIndex(now) + (todayDone ? 0 : 1);
    if (remaining < plan - curDone) return 0;
    cursor = addDays(curMon, -7);
  }
  // 10-year cap guards against a corrupt log set looping forever
  for (let i = 0; i < 520 && doneInWeek(cursor) >= plan; i++) {
    streak++;
    cursor = addDays(cursor, -7);
  }
  return streak;
}

export type DayDotMode = "done" | "today" | "plan" | "rest";
export type DayDot = { mode: DayDotMode };

/** Mon..Sun hero dots. Future days needed to hit the plan are marked "plan",
 *  preferring the user's declared available_days so dots and the "programada
 *  el sábado" subline agree. */
export function weekDayDots(
  logs: WorkoutLog[],
  daysPerWeek: number,
  availableDays: string[] | null,
  now = new Date(),
): DayDot[] {
  const today = toDateKey(now);
  const mon = mondayOf(today);
  const tIdx = dowIndex(now);
  const done = distinctDays(logs, mon, addDays(mon, 6));

  const modes: DayDotMode[] = [];
  for (let i = 0; i < 7; i++) {
    const key = addDays(mon, i);
    modes.push(done.has(key) ? "done" : i === tIdx ? "today" : "rest");
  }

  // Today (when unlogged) counts as one implicit remaining session
  let needed = Math.max(
    0,
    daysPerWeek - done.size - (modes[tIdx] === "today" ? 1 : 0),
  );
  if (needed > 0) {
    const avail = new Set(
      (availableDays ?? []).map(dayNameToIndex).filter((i) => i >= 0),
    );
    const future: number[] = [];
    for (let i = tIdx + 1; i < 7; i++) future.push(i);
    const ordered = [
      ...future.filter((i) => avail.has(i)),
      ...future.filter((i) => !avail.has(i)),
    ];
    for (const i of ordered) {
      if (needed === 0) break;
      if (modes[i] === "rest") {
        modes[i] = "plan";
        needed--;
      }
    }
  }
  return modes.map((mode) => ({ mode }));
}

export type WeekPill = { n: number; done: number; plan: number; current: boolean };

/** Month view: one pill per (possibly partial) week of the current month. */
export function monthWeekPills(
  logs: WorkoutLog[],
  daysPerWeek: number,
  now = new Date(),
): WeekPill[] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const firstKey = toDateKey(new Date(y, m, 1, 12));
  const lastKey = toDateKey(new Date(y, m + 1, 0, 12));
  const today = toDateKey(now);

  const pills: WeekPill[] = [];
  let mon = mondayOf(firstKey);
  let n = 1;
  while (mon <= lastKey && n <= 6) {
    const weekEnd = addDays(mon, 6);
    const from = mon > firstKey ? mon : firstKey;
    const to = weekEnd < lastKey ? weekEnd : lastKey;
    const daysInside =
      Math.round(
        (dateKeyToDate(to).getTime() - dateKeyToDate(from).getTime()) / 86400000,
      ) + 1;
    pills.push({
      n,
      done: distinctDays(logs, from, to).size,
      plan: Math.max(1, Math.min(daysPerWeek, daysInside)),
      current: today >= mon && today <= weekEnd,
    });
    mon = addDays(mon, 7);
    n++;
  }
  return pills;
}

// ---- Volume (P0: estimated from the routine plan) ----

const norm = (s: string) => s.trim().toLowerCase();

export type PlanIndex = {
  byRoutine: Map<string, Map<string, RoutineExercise>>;
  byName: Map<string, RoutineExercise>;
};

export function buildPlanIndex(routines: RoutineWithExercises[]): PlanIndex {
  const byRoutine = new Map<string, Map<string, RoutineExercise>>();
  const byName = new Map<string, RoutineExercise>();
  for (const routine of routines) {
    const inner = new Map<string, RoutineExercise>();
    for (const re of routine.routine_exercises) {
      const name = re.exercise?.name;
      if (name == null) continue;
      inner.set(norm(name), re);
      if (!byName.has(norm(name))) byName.set(norm(name), re);
    }
    byRoutine.set(routine.id, inner);
  }
  return { byRoutine, byName };
}

function planFor(
  plan: PlanIndex,
  routineId: string | null,
  exerciseName: string,
): RoutineExercise | undefined {
  const key = norm(exerciseName);
  return (
    (routineId != null ? plan.byRoutine.get(routineId)?.get(key) : undefined) ??
    plan.byName.get(key)
  );
}

/** Estimated kg volume: plan sets×reps×weight over completed exercises.
 *  Bodyweight (null weight) exercises are skipped. */
export function estimatedVolume(logs: WorkoutLog[], plan: PlanIndex): number {
  let total = 0;
  for (const log of logs) {
    for (const name of log.completed_exercises ?? []) {
      const re = planFor(plan, log.routine_id, name);
      if (re?.weight_kg != null) total += re.sets * re.reps * re.weight_kg;
    }
  }
  return Math.round(total);
}

/** 8 weekly estimated-volume totals, oldest→newest, ending the current week. */
export function volumeSeries8w(
  logs: WorkoutLog[],
  plan: PlanIndex,
  now = new Date(),
): number[] {
  const curMon = mondayOf(toDateKey(now));
  const series: number[] = [];
  for (let w = 7; w >= 0; w--) {
    const mon = addDays(curMon, -7 * w);
    const end = addDays(mon, 6);
    series.push(
      estimatedVolume(
        logs.filter((l) => l.date >= mon && l.date <= end),
        plan,
      ),
    );
  }
  return series;
}

/** kcal burned across logs via the shared MET estimator. */
export function burnedKcal(logs: WorkoutLog[], profile: Profile | null): number {
  return logs.reduce((sum, log) => sum + estimateCaloriesBurned(log, profile), 0);
}

/** Total minutes trained (log duration, falling back to the profile's usual
 *  session length — same fallback the calorie estimator uses). */
export function trainedMinutes(logs: WorkoutLog[], profile: Profile | null): number {
  return logs.reduce(
    (sum, log) => sum + (log.duration_minutes ?? profile?.session_duration ?? 0),
    0,
  );
}

// ---- Muscle groups ----

export type MuscleGroup =
  | "chest"
  | "back"
  | "shoulders"
  | "arms"
  | "core"
  | "legs"
  | "other";

// bodyparts reference table is English; collapse its 10 values into the 6
// display groups (+ other). Unmatched names also land in "other".
const BODY_PART_TO_GROUP: Record<string, MuscleGroup> = {
  chest: "chest",
  back: "back",
  shoulders: "shoulders",
  "upper arms": "arms",
  "lower arms": "arms",
  waist: "core",
  "upper legs": "legs",
  "lower legs": "legs",
  neck: "other",
  cardio: "other",
};

/** Display group for a raw bodyparts name (any casing); "other" if unknown. */
export function muscleGroupForBodyPart(name: string | null | undefined): MuscleGroup {
  return (name != null ? BODY_PART_TO_GROUP[name.toLowerCase()] : undefined) ?? "other";
}

function groupOf(
  name: string,
  catalogByName: Map<string, Exercise>,
  plan: PlanIndex,
  routineId: string | null,
): { group: MuscleGroup; sets: number } {
  const re = planFor(plan, routineId, name);
  const ex = catalogByName.get(norm(name)) ?? re?.exercise;
  return {
    group: muscleGroupForBodyPart(ex?.body_part?.name),
    sets: re?.sets ?? 3,
  };
}

export type MuscleRow = { group: MuscleGroup; sets: number };

/** Program training in muscle terms: one entry per exercise and date, with
 *  the sets it counts for. Built by programWork(). */
export type ProgramWork = { date: string; name: string; sets: number };

/** An exercise the client checked off in a program week. */
export type CompletionEntry = {
  date: string;
  week: number;
  /** null once the coach removed the prescription (the row survives). */
  programExerciseId: string | null;
  name: string;
  /** Prescribed sets that week: the exercise's own override, else the week's
   *  deload count, else its base sets (utils/program.ts effectivePrescription). */
  sets: number;
};

/**
 * Program work as muscle stimulus. A logged set counts as one set; an
 * exercise checked off without any logged sets counts its prescribed sets.
 * A check-off is matched to its logged sets by prescription + program week
 * (sets can be logged on a different day than the check-off), or by date +
 * name for rows whose prescription the coach has since removed.
 */
export function programWork(setLogs: SetLogEntry[], completions: CompletionEntry[]): ProgramWork[] {
  const byDay = new Map<string, ProgramWork>();
  const logged = new Set<string>();
  const add = (date: string, name: string, sets: number) => {
    const k = `${date}|${norm(name)}`;
    const w = byDay.get(k);
    if (w != null) w.sets += sets;
    else byDay.set(k, { date, name, sets });
  };
  for (const s of setLogs) {
    add(s.date, s.name, 1);
    if (s.programExerciseId != null && s.week != null) logged.add(`pe|${s.programExerciseId}|${s.week}`);
    logged.add(`day|${s.date}|${norm(s.name)}`);
  }
  for (const c of completions) {
    const key =
      c.programExerciseId != null ? `pe|${c.programExerciseId}|${c.week}` : `day|${c.date}|${norm(c.name)}`;
    if (!logged.has(key)) add(c.date, c.name, c.sets);
  }
  return [...byDay.values()];
}

/** Sets per muscle group inside the window, sorted desc, "other" last.
 *  Counts routine logs and, when given, program work. */
export function muscleDistribution(
  logs: WorkoutLog[],
  catalog: Exercise[],
  plan: PlanIndex,
  windowDays: 14 | 30,
  now = new Date(),
  work: ProgramWork[] = [],
): MuscleRow[] {
  const cutoff = addDays(toDateKey(now), -(windowDays - 1));
  const catalogByName = new Map(catalog.map((e) => [norm(e.name), e]));
  const sums = new Map<MuscleGroup, number>();
  for (const log of logs) {
    if (log.date < cutoff) continue;
    for (const name of log.completed_exercises ?? []) {
      const { group, sets } = groupOf(name, catalogByName, plan, log.routine_id);
      sums.set(group, (sums.get(group) ?? 0) + sets);
    }
  }
  for (const w of work) {
    if (w.date < cutoff) continue;
    const group = muscleGroupForBodyPart(catalogByName.get(norm(w.name))?.body_part?.name);
    sums.set(group, (sums.get(group) ?? 0) + w.sets);
  }
  return [...sums.entries()]
    .map(([group, sets]) => ({ group, sets }))
    .sort((a, b) => {
      if (a.group === "other") return 1;
      if (b.group === "other") return -1;
      return b.sets - a.sets;
    });
}

/** A group under a quarter of the busiest one (`max` = the largest sets in
 *  the distribution). Never "other". Shared by the muscles card's bars and
 *  heat map so both flag the same groups. */
export function isWeakGroup(row: MuscleRow, max: number): boolean {
  return row.group !== "other" && row.sets < 0.25 * max;
}

export type MuscleAlert = {
  kind: "recency" | "imbalance";
  group: MuscleGroup;
  days: number;
  /** daysLong.* i18n key of an upcoming routine that covers the group */
  routineDayKey: string | null;
};

/** Single most important flag: a group untrained for >= 10 days (but trained
 *  before), else a group under 25% of the max group's window volume. */
export function muscleAlert(
  dist: MuscleRow[],
  logs: WorkoutLog[],
  catalog: Exercise[],
  plan: PlanIndex,
  routines: RoutineWithExercises[],
  now = new Date(),
  work: ProgramWork[] = [],
): MuscleAlert | null {
  const today = toDateKey(now);
  const catalogByName = new Map(catalog.map((e) => [norm(e.name), e]));

  const lastTrained = new Map<MuscleGroup, string>();
  const trained = (group: MuscleGroup, date: string) => {
    if (group === "other") return;
    const prev = lastTrained.get(group);
    if (prev == null || date > prev) lastTrained.set(group, date);
  };
  for (const log of logs) {
    for (const name of log.completed_exercises ?? []) {
      trained(groupOf(name, catalogByName, plan, log.routine_id).group, log.date);
    }
  }
  for (const w of work) {
    trained(muscleGroupForBodyPart(catalogByName.get(norm(w.name))?.body_part?.name), w.date);
  }

  const daysSince = (date: string) =>
    Math.round(
      (dateKeyToDate(today).getTime() - dateKeyToDate(date).getTime()) / 86400000,
    );

  const routineDayFor = (group: MuscleGroup): string | null => {
    let best: { offset: number; key: string } | null = null;
    for (const routine of routines) {
      if (routine.day_of_week == null) continue;
      const idx = dayNameToIndex(routine.day_of_week);
      if (idx < 0) continue;
      const covers = routine.routine_exercises.some((re) => {
        const bp = re.exercise?.body_part?.name?.toLowerCase();
        return bp != null && BODY_PART_TO_GROUP[bp] === group;
      });
      if (!covers) continue;
      const offset = (idx - dowIndex(now) + 7) % 7;
      if (best == null || offset < best.offset)
        best = { offset, key: DAY_LONG_KEYS[idx] };
    }
    return best?.key ?? null;
  };

  // Recency: pick the longest-neglected group
  let recency: { group: MuscleGroup; days: number } | null = null;
  for (const [group, date] of lastTrained) {
    const days = daysSince(date);
    if (days >= 10 && (recency == null || days > recency.days))
      recency = { group, days };
  }
  if (recency != null) {
    return {
      kind: "recency",
      group: recency.group,
      days: recency.days,
      routineDayKey: routineDayFor(recency.group),
    };
  }

  // Imbalance: any group under a quarter of the leader (never "other")
  const main = dist.filter((r) => r.group !== "other");
  const max = main.reduce((m, r) => Math.max(m, r.sets), 0);
  if (max === 0) return null;
  const weakest = main
    .filter((r) => r.sets < 0.25 * max)
    .sort((a, b) => a.sets - b.sets)[0];
  if (weakest == null) return null;
  const last = lastTrained.get(weakest.group);
  return {
    kind: "imbalance",
    group: weakest.group,
    days: last != null ? daysSince(last) : 0,
    routineDayKey: routineDayFor(weakest.group),
  };
}

// ---- Nutrition ----

export type NutritionDay = { date: string; kcal: number | null };
export type NutritionStats = {
  perDay: NutritionDay[];
  avgKcal: number | null;
  avgProtein: number | null;
  adherentDays: number;
  loggedDays: number;
  macro: { protein: number; carbs: number; fat: number } | null;
};

/** Aggregates over the last `days` days ending today. Days without logged
 *  meals are null (no bar, excluded from averages and adherence). */
export function nutritionStats(
  meals: MealWithItems[],
  goalKcal: number | null,
  days: 7 | 30,
  now = new Date(),
): NutritionStats {
  const today = toDateKey(now);
  const from = addDays(today, -(days - 1));

  const byDate = new Map<string, { kcal: number; p: number; c: number; f: number }>();
  for (const meal of meals) {
    if (meal.date < from || meal.date > today || meal.meal_items.length === 0)
      continue;
    const agg = byDate.get(meal.date) ?? { kcal: 0, p: 0, c: 0, f: 0 };
    for (const item of meal.meal_items) {
      agg.kcal += item.calories;
      agg.p += item.protein_g;
      agg.c += item.carbs_g;
      agg.f += item.fat_g;
    }
    byDate.set(meal.date, agg);
  }

  const perDay: NutritionDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    perDay.push({ date, kcal: byDate.get(date)?.kcal ?? null });
  }

  let kcalSum = 0;
  let proteinSum = 0;
  let carbsSum = 0;
  let fatSum = 0;
  let adherent = 0;
  for (const agg of byDate.values()) {
    kcalSum += agg.kcal;
    proteinSum += agg.p;
    carbsSum += agg.c;
    fatSum += agg.f;
    if (goalKcal != null && Math.abs(agg.kcal - goalKcal) <= 0.1 * goalKcal)
      adherent++;
  }
  const logged = byDate.size;

  const pKcal = proteinSum * 4;
  const cKcal = carbsSum * 4;
  const fKcal = fatSum * 9;
  const macroTotal = pKcal + cKcal + fKcal;

  return {
    perDay,
    avgKcal: logged > 0 ? Math.round(kcalSum / logged) : null,
    avgProtein: logged > 0 ? Math.round(proteinSum / logged) : null,
    adherentDays: adherent,
    loggedDays: logged,
    macro:
      macroTotal > 0
        ? {
            protein: Math.round((pKcal / macroTotal) * 100),
            carbs: Math.round((cKcal / macroTotal) * 100),
            fat: Math.round((fKcal / macroTotal) * 100),
          }
        : null,
  };
}

// ---- Achievements ----

export type AchievementChip =
  | { kind: "streak"; value: number }
  | { kind: "workouts"; value: number }
  | { kind: "tonnage"; value: number };

const WORKOUT_MILESTONES = [100, 50, 25, 10];

export function achievements(
  totalWorkouts: number,
  streakWeeks: number,
  lifetimeVolumeKg: number,
): AchievementChip[] {
  const chips: AchievementChip[] = [];
  if (streakWeeks > 0) chips.push({ kind: "streak", value: streakWeeks });
  const milestone = WORKOUT_MILESTONES.find((m) => totalWorkouts >= m);
  if (milestone != null) chips.push({ kind: "workouts", value: milestone });
  const tonnes = Math.floor(lifetimeVolumeKg / 1000);
  if (tonnes >= 1) chips.push({ kind: "tonnage", value: tonnes });
  return chips;
}

// ---- Rule-based insights (P0 — deterministic, no LLM) ----

export type Insight =
  | { kind: "muscle"; group: MuscleGroup; days: number }
  | { kind: "protein"; avg: number; target: number }
  | { kind: "adherence"; done: number; plan: number }
  | { kind: "encourage" };

export function ruleInsights(input: {
  alert: MuscleAlert | null;
  avgProtein: number | null;
  weightKg: number | null;
  lastWeekDone: number;
  lastWeekPlan: number;
  weekDone: number;
  weekPlan: number;
}): Insight | null {
  if (input.alert != null)
    return { kind: "muscle", group: input.alert.group, days: input.alert.days };
  // (P2: plateau detection slots in here once real sets exist)
  if (
    input.avgProtein != null &&
    input.weightKg != null &&
    input.avgProtein < 1.4 * input.weightKg
  ) {
    return {
      kind: "protein",
      avg: input.avgProtein,
      target: Math.round(1.4 * input.weightKg),
    };
  }
  if (input.lastWeekPlan > 0 && input.lastWeekDone / input.lastWeekPlan < 0.5)
    return { kind: "adherence", done: input.lastWeekDone, plan: input.lastWeekPlan };
  if (input.weekDone === input.weekPlan - 1) return { kind: "encourage" };
  return null;
}

/** P2 — Epley estimated 1RM (exported now so set logging can reuse it). */
export const e1rm = (weightKg: number, reps: number) =>
  weightKg * (1 + reps / 30);

// ---- Real volume & PRs from logged sets (Phase 4) -------------------------
// Powered by workout_set_logs (program set logging). When present, these
// replace the plan-based estimates above so the dashboard shows what the
// client actually lifted.

export type SetLogEntry = {
  date: string;
  weight_kg: number | null;
  reps: number | null;
  name: string;
  isUnilateral: boolean;
  /** Prescription and program week the set was logged against (null when
   *  detached; absent in caches written before these were fetched). */
  programExerciseId?: string | null;
  week?: number | null;
};

/** Real kg volume (Σ weight·reps) for sets logged in [from, to]. Unilateral
 *  work counts both sides. Sets missing weight or reps are skipped. */
export function realVolume(logs: SetLogEntry[], from: string, to: string): number {
  let total = 0;
  for (const s of logs) {
    if (s.date < from || s.date > to) continue;
    if (s.weight_kg != null && s.reps != null) {
      total += s.weight_kg * s.reps * (s.isUnilateral ? 2 : 1);
    }
  }
  return Math.round(total);
}

/** 8 weekly real-volume totals, oldest→newest, ending the current week. */
export function realVolumeSeries8w(
  logs: SetLogEntry[],
  now = new Date(),
): number[] {
  const curMon = mondayOf(toDateKey(now));
  const series: number[] = [];
  for (let w = 7; w >= 0; w--) {
    const mon = addDays(curMon, -7 * w);
    series.push(realVolume(logs, mon, addDays(mon, 6)));
  }
  return series;
}

export type PersonalRecord = {
  name: string;
  weightKg: number;
  reps: number;
  e1rm: number;
};

/** Best set per exercise by estimated 1RM, strongest first. Ties broken by
 *  heavier absolute weight. Only weighted sets qualify. */
export function personalRecords(
  logs: SetLogEntry[],
  limit = 3,
): PersonalRecord[] {
  const best = new Map<string, PersonalRecord>();
  for (const s of logs) {
    if (s.weight_kg == null || s.reps == null || s.weight_kg <= 0) continue;
    const est = e1rm(s.weight_kg, s.reps);
    const prev = best.get(s.name);
    if (
      prev == null ||
      est > prev.e1rm ||
      (est === prev.e1rm && s.weight_kg > prev.weightKg)
    ) {
      best.set(s.name, {
        name: s.name,
        weightKg: s.weight_kg,
        reps: s.reps,
        e1rm: Math.round(est),
      });
    }
  }
  return [...best.values()].sort((a, b) => b.e1rm - a.e1rm).slice(0, limit);
}

// ---- Weight (P1 — powered by body_measurements once migration A runs) ----

export type BodyMeasurementPoint = { measured_on: string; weight_kg: number };

export type WeightStats = {
  hasData: boolean;
  current: number | null;
  /** 7-day rolling avg now vs ~30 days ago; null when history is too short */
  delta30: number | null;
  bmi: number | null;
  /** weekly averages, oldest→newest, up to 8 points (weeks without data skipped) */
  series: { week: number; kg: number }[];
};

export function weightStats(
  measurements: BodyMeasurementPoint[],
  profile: Profile | null,
  now = new Date(),
): WeightStats {
  const today = toDateKey(now);
  const rows = measurements
    .filter((m) => m.weight_kg != null)
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on));

  const avgIn = (from: string, to: string): number | null => {
    const inRange = rows.filter((m) => m.measured_on >= from && m.measured_on <= to);
    if (inRange.length === 0) return null;
    return inRange.reduce((s, m) => s + m.weight_kg, 0) / inRange.length;
  };

  const current =
    rows.length > 0 ? rows[rows.length - 1].weight_kg : profile?.weight_kg ?? null;
  const recent = avgIn(addDays(today, -6), today) ?? current;
  const past = avgIn(addDays(today, -36), addDays(today, -24));
  const delta30 = recent != null && past != null ? recent - past : null;

  const series: { week: number; kg: number }[] = [];
  const curMon = mondayOf(today);
  for (let w = 7; w >= 0; w--) {
    const mon = addDays(curMon, -7 * w);
    const avg = avgIn(mon, addDays(mon, 6));
    if (avg != null) series.push({ week: 7 - w, kg: avg });
  }

  const h = profile?.height_cm;
  const bmi =
    current != null && h != null && h > 0
      ? current / Math.pow(h / 100, 2)
      : null;

  return { hasData: rows.length > 0, current, delta30, bmi, series };
}

// ---- Misc helpers ----

/** Distinct-day count of the previous ISO week (for the adherence rule). */
export function lastWeekCompliance(
  logs: WorkoutLog[],
  daysPerWeek: number,
  now = new Date(),
): { done: number; plan: number } {
  const mon = addDays(mondayOf(toDateKey(now)), -7);
  return {
    done: distinctDays(logs, mon, addDays(mon, 6)).size,
    plan: Math.max(1, daysPerWeek),
  };
}

/** Best complete month (excludes the current one): distinct training days. */
export function bestMonth(
  logs: WorkoutLog[],
  now = new Date(),
): { year: number; month: number; done: number } | null {
  const currentPrefix = toDateKey(now).slice(0, 7);
  const byMonth = new Map<string, Set<string>>();
  for (const log of logs) {
    const prefix = log.date.slice(0, 7);
    if (prefix === currentPrefix) continue;
    const set = byMonth.get(prefix) ?? new Set<string>();
    set.add(log.date);
    byMonth.set(prefix, set);
  }
  let best: { prefix: string; done: number } | null = null;
  for (const [prefix, set] of byMonth) {
    if (best == null || set.size > best.done) best = { prefix, done: set.size };
  }
  if (best == null) return null;
  const [y, m] = best.prefix.split("-").map(Number);
  return { year: y, month: m - 1, done: best.done };
}

/** "2 h 55 m" / "45 m" */
export function formatMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.round(totalMinutes % 60);
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}
