import type {
  DayType,
  MealType,
  NutritionPlanMeal,
  NutritionPlanOption,
  NutritionPlanOptionItem,
  NutritionPlanTarget,
  NutritionPlanWithDetails,
  PlanMealType,
  ProgramWithDetails,
  SupplementPlanItem,
  SupplementTiming,
} from "@/src/types/database";
import { dateKeyToDate, toDateKey } from "@/src/utils/dates";

/** The two real kinds of day. 'both' is a filter value, never a resolved day. */
export type ResolvedDay = Exclude<DayType, "both">;

const WEEKDAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * Is today a training day? Read from the client's ACTIVE PROGRAM rather than
 * asking them: program_days already pin the split to weekdays, so the nutrition
 * plan can follow the training calendar for free.
 *
 * Falls back to "rest" when there's no program, or when the program exists but
 * pins no weekdays at all (a block not tied to the calendar) — in that case the
 * manual toggle is the only signal, and rest is the safer default to show.
 */
export function resolveDayType(
  program: ProgramWithDetails | null,
  dateKey: string = toDateKey(),
): ResolvedDay {
  if (program == null) return "rest";
  const weekday = WEEKDAY_KEYS[dateKeyToDate(dateKey).getDay()];
  return program.program_days.some((d) => d.weekday === weekday)
    ? "training"
    : "rest";
}

/** True when a row tagged `tag` is visible on `day`. */
export function appliesOn(tag: DayType, day: ResolvedDay): boolean {
  return tag === "both" || tag === day;
}

/** The foods of an option that survive `day`. */
export function visibleItems(
  option: NutritionPlanOption,
  day: ResolvedDay,
): NutritionPlanOptionItem[] {
  return option.nutrition_plan_option_items.filter((i) =>
    appliesOn(i.day_type, day),
  );
}

/**
 * Slots to render for `day`. A slot gated OFF today is still returned when it
 * carries a note — that note is where the substitution instruction lives ("en
 * días de descanso, sustituir por 1 scoop"), so dropping the slot silently
 * would lose it. Callers check `appliesOn(meal.applies_to, day)` to decide
 * between showing options and showing the note.
 */
export function visibleMeals(
  plan: NutritionPlanWithDetails,
  day: ResolvedDay,
): NutritionPlanMeal[] {
  if (!plan.day_cycling) return plan.nutrition_plan_meals;
  return plan.nutrition_plan_meals.filter(
    (m) => appliesOn(m.applies_to, day) || m.notes != null,
  );
}

/** The macro target row for `day`, or null when the coach set none. */
export function targetFor(
  plan: NutritionPlanWithDetails,
  day: ResolvedDay,
): NutritionPlanTarget | null {
  const wanted: DayType = plan.day_cycling ? day : "both";
  return (
    plan.nutrition_plan_targets.find((t) => t.day_type === wanted) ??
    plan.nutrition_plan_targets[0] ??
    null
  );
}

/** "150" + "155" -> "150–155"; equal bounds collapse; one-sided is allowed. */
export function formatRange(
  a: number | null,
  b: number | null,
): string | null {
  if (a != null && b != null) return a === b ? String(a) : `${a}–${b}`;
  if (a != null) return String(a);
  if (b != null) return String(b);
  return null;
}

/**
 * A plan slot's type collapsed to one the DIARY accepts. meals.meal_type allows
 * only four values, so the two workout-relative slots fold into 'snack' — the
 * nearest honest bucket.
 */
export function mealTypeToDiarySlot(t: PlanMealType): MealType {
  return t === "pre_workout" || t === "post_workout" ? "snack" : t;
}

/** Supplements visible on `day`, in the coach's own order. */
export function visibleSupplements(
  items: SupplementPlanItem[],
  day: ResolvedDay,
): SupplementPlanItem[] {
  return items.filter((i) => appliesOn(i.applies_to, day));
}

/** Day order — this is what turns supplement rows into the schedule table. */
export const TIMING_ORDER: SupplementTiming[] = [
  "wake",
  "breakfast",
  "pre_workout",
  "intra_workout",
  "post_workout",
  "lunch",
  "dinner",
  "bedtime",
  "any",
];

/**
 * The "horario de suplementación" table, derived rather than stored: group the
 * stack by when it's taken, in day order. Empty slots are dropped.
 */
export function supplementSchedule(
  items: SupplementPlanItem[],
): { slot: SupplementTiming; items: SupplementPlanItem[] }[] {
  return TIMING_ORDER.map((slot) => ({
    slot,
    items: items.filter((i) => i.timing_slot === slot),
  })).filter((g) => g.items.length > 0);
}
