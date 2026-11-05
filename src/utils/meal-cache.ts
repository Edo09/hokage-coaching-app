import type { Meal, MealItem, MealWithItems } from "@/src/types/database";

// Edits to the persisted meals cache (qk.meals) that registrations make
// optimistically, before the outbox syncs them. Pure, so `npm test` covers
// it (meal-cache.test.ts).

/** Puts `item` in its container, adding the container (first, newest) when
 *  the cache doesn't have it yet. A changed row replaces its old copy, even
 *  in another container. */
export function upsertItemInCache(meals: MealWithItems[], container: Meal, item: MealItem): MealWithItems[] {
  const base = meals.some((m) => m.id === container.id) ? meals : [{ ...container, meal_items: [] }, ...meals];
  return base.map((m) => {
    const without = m.meal_items.filter((i) => i.id !== item.id);
    if (m.id === item.meal_id) return { ...m, meal_items: [...without, item] };
    return without.length === m.meal_items.length ? m : { ...m, meal_items: without };
  });
}

/** A row as Realtime or a plain select sends it. The numbers are numeric in
 *  Postgres and may arrive as strings. */
export function normalizeMealItem(row: Record<string, unknown>): MealItem {
  const num = (v: unknown) => (v == null ? v : Number(v));
  return {
    ...(row as unknown as MealItem),
    calories: Number(row.calories ?? 0),
    protein_g: Number(row.protein_g ?? 0),
    carbs_g: Number(row.carbs_g ?? 0),
    fat_g: Number(row.fat_g ?? 0),
    estimate_version: num(row.estimate_version) as number | null | undefined,
    estimate_attempts: num(row.estimate_attempts) as number | null | undefined,
  };
}

/** Replaces a row the cache already shows (an estimate landed). null when its
 *  container isn't cached: the caller refetches instead. */
export function patchItemInCache(meals: MealWithItems[], row: MealItem): MealWithItems[] | null {
  if (!meals.some((m) => m.id === row.meal_id)) return null;
  return meals.map((m) => {
    const without = m.meal_items.filter((i) => i.id !== row.id);
    if (m.id === row.meal_id) return { ...m, meal_items: [...without, row] };
    return without.length === m.meal_items.length ? m : { ...m, meal_items: without };
  });
}

/** How far ahead a pending row's next try may be and still be re-read: past
 *  the server's 3-minute lease (set on every client write and send), short of
 *  a 15-minute quota wait (migration 20261105120000). */
const RECHECK_WINDOW_MS = 4 * 60_000;

/** Today's rows worth re-reading while the app waits for their estimate:
 *  pending, and not in a long wait. */
export function pendingRecheckIds(todays: MealWithItems[], now: Date): string[] {
  const soon = now.getTime() + RECHECK_WINDOW_MS;
  return todays
    .flatMap((m) => m.meal_items)
    .filter(
      (i) =>
        (i.kind === "plan" || i.kind === "other") &&
        i.estimate_status === "pending" &&
        (i.estimate_next_at == null || Date.parse(i.estimate_next_at) <= soon),
    )
    .map((i) => i.id);
}

/** Removes a row. Its container stays, even when empty: every reader ignores
 *  empty containers, and deleting one could cascade to another device's row. */
export function removeItemFromCache(meals: MealWithItems[], itemId: string): MealWithItems[] {
  return meals.map((m) =>
    m.meal_items.some((i) => i.id === itemId) ? { ...m, meal_items: m.meal_items.filter((i) => i.id !== itemId) } : m,
  );
}
