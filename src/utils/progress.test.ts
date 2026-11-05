/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MealItem, MealWithItems } from "@/src/types/database";
import { nutritionStats } from "@/src/utils/progress";

const NOW = new Date(2026, 10, 7, 12); // local noon, Nov 7 2026
const A = "2026-11-05";
const B = "2026-11-06";
const C = "2026-11-07";

let seq = 0;
function item(over: Partial<MealItem>): MealItem {
  seq += 1;
  return {
    id: `i${seq}`,
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
function day(date: string, items: MealItem[]): MealWithItems {
  return {
    id: `m-${date}`,
    user_id: "u1",
    name: "lunch",
    meal_type: "lunch",
    date,
    assigned_by: null,
    created_at: `${date}T08:00:00Z`,
    updated_at: `${date}T08:00:00Z`,
    meal_items: items,
  };
}

describe("nutritionStats", () => {
  it("leaves out unlogged days entirely", () => {
    const meals = [
      day(A, [item({ kind: "plan", estimate_status: "done", calories: 1800, protein_g: 120 })]),
      day(B, [
        item({ kind: "plan", estimate_status: "done", calories: 500 }),
        item({ kind: "other", estimate_status: "pending" }),
      ]),
      day(C, [item({ kind: "skipped", estimate_status: null })]),
    ];
    const s = nutritionStats(meals, 1800, 7, NOW);
    assert.equal(s.loggedDays, 1);
    assert.equal(s.avgKcal, 1800);
    assert.equal(s.adherentDays, 1);
    assert.equal(s.perDay.find((d) => d.date === B)?.kcal, null);
    assert.equal(s.perDay.find((d) => d.date === C)?.kcal, null);
  });
});
