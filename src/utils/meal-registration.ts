// Meal registrations: what the client says they ate for each of today's plan
// meals. Pure, so `npm test` covers it (see meal-registration.test.ts).

import { uuidV5 } from "@/src/lib/ids";
import type {
  Meal,
  MealItem,
  MealType,
  MealWithItems,
  NutritionPlanMeal,
  NutritionPlanOption,
  NutritionPlanOptionItem,
  NutritionPlanWithDetails,
  PlanMealType,
} from "@/src/types/database";
import { appliesOn, mealTypeToDiarySlot, type ResolvedDay, visibleItems } from "@/src/utils/nutrition-plan";

// Fixed forever: changing it would give every registration a new id.
export const REGISTRATION_NAMESPACE = "3f6d1c9e-8a2b-4e57-b0c4-9d2e7f1a6b38";

/** One registration per client, date and plan meal: every device and every
 *  repeated save derives the same id, so the last write updates one row. */
export function registrationId(userId: string, dateKey: string, planMealId: string): string {
  return uuidV5(`registration:${userId}:${dateKey}:${planMealId}`, REGISTRATION_NAMESPACE);
}

/** The day's container for a diary type, the same on every device. */
export function containerId(userId: string, dateKey: string, mealType: MealType): string {
  return uuidV5(`container:${userId}:${dateKey}:${mealType}`, REGISTRATION_NAMESPACE);
}

/** One plan meal as the tab shows it today. */
export type TodayMeal = {
  meal: NutritionPlanMeal;
  /** The day type lets it apply today. */
  applies: boolean;
  registration: MealItem | null;
  /** The options with at least one food today. */
  options: NutritionPlanOption[];
  /** Doesn't apply today and isn't registered, but has a note: a «No aplica hoy» row. */
  noteOnly: boolean;
};

/** The containers of one day. Callers pass the day-reactive key (useToday). */
export function mealsOnDate(meals: MealWithItems[], dateKey: string): MealWithItems[] {
  return meals.filter((m) => m.date === dateKey);
}

/** Today's registration of each plan meal; the newest wins if an old offline
 *  duplicate exists (both still count in the totals). */
export function registrationsByPlanMeal(todays: MealWithItems[]): Map<string, MealItem> {
  const map = new Map<string, MealItem>();
  for (const m of todays) {
    for (const item of m.meal_items) {
      if (item.plan_meal_id == null) continue;
      const prev = map.get(item.plan_meal_id);
      if (prev == null || item.created_at > prev.created_at) map.set(item.plan_meal_id, item);
    }
  }
  return map;
}

/** An option's foods for the day. A plan that doesn't cycle shows them all. */
export function optionFoods(option: NutritionPlanOption, day: ResolvedDay, cycling: boolean): NutritionPlanOptionItem[] {
  return cycling ? visibleItems(option, day) : option.nutrition_plan_option_items;
}

/** What a plan registration stores as its name, and what the AI estimates. */
export function optionFoodsText(option: NutritionPlanOption, day: ResolvedDay, cycling: boolean): string {
  return optionFoods(option, day, cycling)
    .map((f) => f.name.trim())
    .filter((n) => n !== "")
    .join(" · ");
}

/** The meals listed today, in plan order: those that apply, those already
 *  registered (even if the day type now hides them), and note rows. */
export function todayMeals(
  plan: NutritionPlanWithDetails,
  day: ResolvedDay,
  registrations: Map<string, MealItem>,
): TodayMeal[] {
  const cycling = plan.day_cycling;
  const out: TodayMeal[] = [];
  for (const meal of plan.nutrition_plan_meals) {
    const applies = !cycling || appliesOn(meal.applies_to, day);
    const registration = registrations.get(meal.id) ?? null;
    const hasNote = meal.notes != null && meal.notes.trim() !== "";
    const noteOnly = !applies && registration == null && hasNote;
    if (!applies && registration == null && !noteOnly) continue;
    const options = meal.nutrition_plan_options.filter((o) => optionFoods(o, day, cycling).length > 0);
    out.push({ meal, applies, registration, options, noteOnly });
  }
  return out;
}

function inCount(m: TodayMeal): boolean {
  return !m.noteOnly && ((m.applies && !m.meal.is_optional) || m.registration != null);
}

/** «N de M»: M is the required meals that apply today plus every registered
 *  meal; N is the registered ones («No la comí» included). */
export function doneCount(meals: TodayMeal[]): { done: number; total: number } {
  const counted = meals.filter(inCount);
  return { done: counted.filter((m) => m.registration != null).length, total: counted.length };
}

/** «Siguiente»: the first required, unregistered meal that applies today
 *  after the registered meal that comes last in plan order, else the first
 *  such meal from the top. Never by the clock. */
export function nextMealId(meals: TodayMeal[]): string | null {
  const isCandidate = (m: TodayMeal) => m.applies && !m.meal.is_optional && m.registration == null && !m.noteOnly;
  let lastRegistered = -1;
  meals.forEach((m, i) => {
    if (m.registration != null) lastRegistered = i;
  });
  const next = meals.find((m, i) => i > lastRegistered && isCandidate(m)) ?? meals.find(isCandidate);
  return next?.meal.id ?? null;
}

export function capitalizeFirst(s: string): string {
  return s.length === 0 ? s : s[0].toLocaleUpperCase() + s.slice(1);
}

/** The coach's label, or the type's name capitalised («Desayuno»). */
export function mealDisplayName(
  meal: Pick<NutritionPlanMeal, "label" | "meal_type">,
  typeName: (t: PlanMealType) => string,
): string {
  const label = meal.label?.trim();
  return label ? label : capitalizeFirst(typeName(meal.meal_type));
}

/** The coach's label, or «Opción N» by position. */
export function optionLabel(option: NutritionPlanOption, index: number, fallback: (n: number) => string): string {
  const label = option.label?.trim();
  return label ? label : fallback(index + 1);
}

export type RegistrationChoice =
  | { kind: "plan"; option: NutritionPlanOption; foodsText: string }
  /** The «Del plan» row: the registered option is gone; keep the stored foods. */
  | { kind: "plan-kept" }
  | { kind: "other"; text: string }
  | { kind: "skipped" };

/** The day's container for a diary type, as the outbox inserts it (a plain
 *  Meal: an extra key would make PostgREST refuse the write). */
export function buildContainer(a: {
  userId: string;
  dateKey: string;
  mealType: MealType;
  name: string;
  now: string;
}): Meal {
  return {
    id: containerId(a.userId, a.dateKey, a.mealType),
    user_id: a.userId,
    name: a.name,
    meal_type: a.mealType,
    date: a.dateKey,
    assigned_by: null,
    created_at: a.now,
    updated_at: a.now,
  };
}

/** The row a registration writes. The server owns the estimate: new or
 *  changed content goes as pending with its numbers at 0, and the version,
 *  attempts and next try are never sent. A re-save of unchanged content keeps
 *  the estimate it has, as the server does (spec «Changing or undoing»); a
 *  failed one goes as pending, which the server takes as a retry. */
export function buildRegistrationRow(a: {
  userId: string;
  dateKey: string;
  meal: NutritionPlanMeal;
  displayName: string;
  choice: RegistrationChoice;
  photoPath: string | null;
  previous: MealItem | null;
  now: string;
}): MealItem {
  const row = freshRow(a);
  const prev = a.previous;
  if (prev == null || prev.estimate_status === "failed" || !sameContent(row, prev)) return row;
  return {
    ...row,
    estimate_status: prev.estimate_status ?? row.estimate_status,
    calories: prev.calories,
    protein_g: prev.protein_g,
    carbs_g: prev.carbs_g,
    fat_g: prev.fat_g,
  };
}

/** The spec's «content», what an estimate is made from: the foods and the
 *  photo of a plan registration, the original text and the photo of «otra
 *  cosa», the kind alone of «No la comí». */
function sameContent(row: MealItem, prev: MealItem): boolean {
  if (row.kind !== prev.kind) return false;
  if (row.kind === "skipped") return true;
  if ((row.photo_path ?? null) !== (prev.photo_path ?? null)) return false;
  return row.kind === "plan" ? row.name === prev.name : row.original_text === prev.original_text;
}

function freshRow(a: Parameters<typeof buildRegistrationRow>[0]): MealItem {
  const base = {
    id: registrationId(a.userId, a.dateKey, a.meal.id),
    meal_id: containerId(a.userId, a.dateKey, mealTypeToDiarySlot(a.meal.meal_type)),
    user_id: a.userId,
    plan_meal_id: a.meal.id,
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    portion: null,
    created_at: a.previous?.created_at ?? a.now,
  };
  switch (a.choice.kind) {
    case "plan":
      return {
        ...base,
        kind: "plan",
        plan_option_id: a.choice.option.id,
        name: a.choice.foodsText,
        original_text: null,
        estimate_status: "pending",
        photo_path: a.photoPath,
      };
    case "plan-kept":
      return {
        ...base,
        kind: "plan",
        plan_option_id: a.previous?.plan_option_id ?? null,
        name: a.previous?.name ?? a.displayName,
        original_text: null,
        estimate_status: "pending",
        photo_path: a.photoPath,
      };
    case "other": {
      const text = a.choice.text.trim();
      // The sheet shows the AI's correction; text left as shown is the same
      // meal, so it keeps the original the server corrected.
      const prev = a.previous;
      const unchanged = prev?.kind === "other" && text === (prev.name ?? "").trim();
      return {
        ...base,
        kind: "other",
        plan_option_id: null,
        name: unchanged ? prev.name : text,
        original_text: unchanged ? (prev.original_text ?? text) : text,
        estimate_status: "pending",
        photo_path: a.photoPath,
      };
    }
    case "skipped":
      return {
        ...base,
        kind: "skipped",
        plan_option_id: null,
        name: a.displayName,
        original_text: null,
        estimate_status: null,
        photo_path: null,
      };
  }
}
