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

/** Removes a row. Its container stays, even when empty: every reader ignores
 *  empty containers, and deleting one could cascade to another device's row. */
export function removeItemFromCache(meals: MealWithItems[], itemId: string): MealWithItems[] {
  return meals.map((m) =>
    m.meal_items.some((i) => i.id === itemId) ? { ...m, meal_items: m.meal_items.filter((i) => i.id !== itemId) } : m,
  );
}
