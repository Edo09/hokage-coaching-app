/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Meal, MealItem, MealWithItems } from "@/src/types/database";
import {
  normalizeMealItem,
  patchItemInCache,
  pendingRecheckIds,
  removeItemFromCache,
  upsertItemInCache,
} from "@/src/utils/meal-cache";

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

describe("estimates reaching the cache", () => {
  it("patches a row in place, or asks for a refetch when its container is missing", () => {
    const ms = [meal("c1", [item({ id: "r", meal_id: "c1", estimate_status: "pending" })])];
    const patched = patchItemInCache(ms, item({ id: "r", meal_id: "c1", estimate_status: "done", calories: 410 }));
    assert.equal(patched?.[0].meal_items[0].calories, 410);
    assert.equal(patchItemInCache(ms, item({ id: "z", meal_id: "c9" })), null);
  });
  it("normalises numeric strings", () => {
    const r = normalizeMealItem({ id: "r", meal_id: "c1", calories: "410", protein_g: "30.5", carbs_g: "0", fat_g: "1" });
    assert.deepEqual([r.calories, r.protein_g], [410, 30.5]);
  });
  it("re-reads pending rows unless their next try is minutes away", () => {
    const now = new Date("2026-11-05T13:00:00Z");
    const ms = [
      meal("c1", [
        item({ id: "a", kind: "other", estimate_status: "pending", estimate_next_at: null }),
        item({ id: "b", kind: "plan", estimate_status: "pending", estimate_next_at: "2026-11-05T13:10:00Z" }),
        item({ id: "c", kind: "plan", estimate_status: "done" }),
      ]),
    ];
    assert.deepEqual(pendingRecheckIds(ms, now), ["a"]);
  });
});
