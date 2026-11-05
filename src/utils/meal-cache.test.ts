/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Meal, MealItem, MealWithItems } from "@/src/types/database";
import { removeItemFromCache, upsertItemInCache } from "@/src/utils/meal-cache";

function item(over: Partial<MealItem> = {}): MealItem {
  return {
    id: "i",
    meal_id: "c",
    user_id: "u1",
    name: "x",
    calories: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    portion: null,
    photo_path: null,
    plan_option_id: null,
    created_at: "2026-11-05T08:00:00Z",
    ...over,
  };
}
function plainMeal(id: string): Meal {
  return {
    id,
    user_id: "u1",
    name: id,
    meal_type: "lunch",
    date: "2026-11-05",
    assigned_by: null,
    created_at: "2026-11-05T08:00:00Z",
    updated_at: "2026-11-05T08:00:00Z",
  };
}
function meal(id: string, items: MealItem[]): MealWithItems {
  return { ...plainMeal(id), meal_items: items };
}
const shape = (ms: MealWithItems[]) => ms.map((m) => [m.id, m.meal_items.map((i) => i.id)]);

describe("meal cache edits", () => {
  it("prepends a new container, moves the item, keeps containers on removal", () => {
    let ms = upsertItemInCache([meal("c1", [])], plainMeal("c2"), item({ id: "r", meal_id: "c2" }));
    assert.deepEqual(shape(ms), [["c2", ["r"]], ["c1", []]]);
    ms = upsertItemInCache(ms, meal("c1", []), item({ id: "r", meal_id: "c1" }));
    assert.deepEqual(shape(ms), [["c2", []], ["c1", ["r"]]]);
    ms = removeItemFromCache(ms, "r");
    assert.deepEqual(
      ms.map((m) => [m.id, m.meal_items.length]),
      [["c2", 0], ["c1", 0]],
    );
  });
});
