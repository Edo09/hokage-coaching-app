// The Counting rules, in one place: what a meal_items row adds to a day's
// totals, and how a missing estimate shows. The coach panel ports the same
// rules (hokage-web-panel src/lib/mealRegistrations.ts). Pure, so `npm test`
// covers it (meal-counting.test.ts).

import type { MealItem, MealType, MealWithItems } from "@/src/types/database";

/** The diary's four meal types, in day order (meals.meal_type). */
export const DIARY_SLOTS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

/** Why a registration's numbers aren't known yet. */
export type EstimateGap = "pending" | "failed";

/** A row with no kind: written by the old diary, or cached before the update
 *  (the key is then missing, hence ==). */
export function isOldDiaryRow(item: MealItem): boolean {
  return item.kind == null;
}

/** Food the client ate: a plan or «otra cosa» registration, or an old diary
 *  row. «No la comí» is a registration but not food. */
export function isEaten(item: MealItem): boolean {
  return item.kind == null || item.kind === "plan" || item.kind === "other";
}

/** Whether a row's numbers count: an old diary row as written, or a
 *  registration whose estimate is done. Pending and failed add nothing. */
export function countsTowardTotals(item: MealItem): boolean {
  return item.kind == null || item.estimate_status === "done";
}

export function missingEstimate(item: MealItem): EstimateGap | null {
  if (item.kind !== "plan" && item.kind !== "other") return null;
  return item.estimate_status === "pending" || item.estimate_status === "failed" ? item.estimate_status : null;
}

/** One label for several rows: «Calculando…» while any is pending, otherwise
 *  «Sin estimar» while any has failed. */
export function combinedEstimateState(items: MealItem[]): EstimateGap | null {
  let failed = false;
  for (const item of items) {
    const gap = missingEstimate(item);
    if (gap === "pending") return "pending";
    if (gap === "failed") failed = true;
  }
  return failed ? "failed" : null;
}

export function itemsOf(meals: MealWithItems[]): MealItem[] {
  return meals.flatMap((m) => m.meal_items);
}

export type FuelSlot = { slot: MealType; meals: number; kcal: number; gap: EstimateGap | null; skippedOnly: boolean };

/** Inicio's «Combustible de Hoy»: one row per diary type that has rows today.
 *  It counts meals, not foods, and keeps a type whose rows are all skipped. */
export function fuelSlots(todays: MealWithItems[]): FuelSlot[] {
  const out: FuelSlot[] = [];
  for (const slot of DIARY_SLOTS) {
    const items = itemsOf(todays.filter((m) => m.meal_type === slot));
    if (items.length === 0) continue;
    out.push({
      slot,
      meals: items.filter(isEaten).length,
      kcal: items.reduce((sum, i) => (countsTowardTotals(i) ? sum + i.calories : sum), 0),
      gap: combinedEstimateState(items),
      skippedOnly: items.every((i) => i.kind === "skipped"),
    });
  }
  return out;
}

export type HoyStatus = { kind: "remaining"; n: number } | { kind: "inRange" } | { kind: "over"; n: number };

/** The Hoy card's word on the kcal target: «N restantes» counts to the
 *  minimum, «En tu rango» inside the range, «N de más» above the maximum.
 *  With only a maximum, it counts down to it. */
export function hoyStatus(kcal: number, min: number | null, max: number | null): HoyStatus | null {
  if (min != null) {
    if (kcal < min) return { kind: "remaining", n: min - kcal };
    if (max == null || kcal <= max) return { kind: "inRange" };
    return { kind: "over", n: kcal - max };
  }
  if (max == null) return null;
  if (kcal < max) return { kind: "remaining", n: max - kcal };
  if (kcal === max) return { kind: "inRange" };
  return { kind: "over", n: kcal - max };
}

/** The Hoy card's top accent: kcal over the top of the range, 0..1. */
export function hoyAccent(kcal: number, min: number | null, max: number | null): number {
  const top = max ?? min;
  if (top == null || top <= 0) return 0;
  return Math.min(1, Math.max(0, kcal / top));
}

/** A day counts as logged in Progreso only with at least one meal eaten and
 *  no estimate still missing; a day of only skipped meals doesn't count. */
export function isLoggedDay(items: MealItem[]): boolean {
  return items.some(isEaten) && !items.some((i) => missingEstimate(i) != null);
}
