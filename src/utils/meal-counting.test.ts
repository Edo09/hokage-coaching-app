/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { MealItem, MealWithItems } from "@/src/types/database";
import { caloriesConsumed, macrosConsumed } from "@/src/utils/calories";
import {
  combinedEstimateState,
  countsTowardTotals,
  fuelSlots,
  hoyAccent,
  hoyStatus,
  isEaten,
  isLoggedDay,
  isOldDiaryRow,
  missingEstimate,
} from "@/src/utils/meal-counting";

let seq = 0;
function item(over: Partial<MealItem> = {}): MealItem {
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
/** A row as old builds write it, or as the persisted cache restores it: no kind key. */
function old(over: Partial<MealItem> = {}): MealItem {
  const row = item(over);
  delete row.kind;
  return row;
}
function meal(id: string, items: MealItem[]): MealWithItems {
  return {
    id,
    user_id: "u1",
    name: id,
    meal_type: "lunch",
    date: "2026-11-05",
    assigned_by: null,
    created_at: "2026-11-05T08:00:00Z",
    updated_at: "2026-11-05T08:00:00Z",
    meal_items: items,
  };
}

describe("counting rules", () => {
  it("treats rows without kind as old diary rows (cached rows lack the key)", () => {
    const o = old({ calories: 300 });
    assert.equal(isOldDiaryRow(o), true);
    assert.equal(countsTowardTotals(o), true);
    assert.equal(isEaten(o), true);
  });
  it("counts only done estimates; skipped is never food", () => {
    assert.equal(countsTowardTotals(item({ kind: "plan", estimate_status: "pending" })), false);
    assert.equal(countsTowardTotals(item({ kind: "other", estimate_status: "done", calories: 410 })), true);
    assert.equal(isEaten(item({ kind: "skipped", estimate_status: null })), false);
    assert.equal(missingEstimate(item({ kind: "skipped", estimate_status: null })), null);
  });
  it("combines gaps: pending wins over failed", () => {
    assert.equal(
      combinedEstimateState([
        item({ kind: "plan", estimate_status: "failed" }),
        item({ kind: "other", estimate_status: "pending" }),
      ]),
      "pending",
    );
    assert.equal(combinedEstimateState([item({ kind: "plan", estimate_status: "failed" })]), "failed");
    assert.equal(combinedEstimateState([item({ kind: "plan", estimate_status: "done" })]), null);
  });
  it("builds fuel slots: meals not foods, skipped-only slots kept", () => {
    const day = [
      { ...meal("b", [item({ kind: "plan", estimate_status: "done", calories: 410 })]), meal_type: "breakfast" as const },
      { ...meal("l", [item({ kind: "other", estimate_status: "pending" })]), meal_type: "lunch" as const },
      { ...meal("s", [item({ kind: "skipped", estimate_status: null })]), meal_type: "snack" as const },
    ];
    assert.deepEqual(fuelSlots(day), [
      { slot: "breakfast", meals: 1, kcal: 410, gap: null, skippedOnly: false },
      { slot: "lunch", meals: 1, kcal: 0, gap: "pending", skippedOnly: false },
      { slot: "snack", meals: 0, kcal: 0, gap: null, skippedOnly: true },
    ]);
  });
  it("hoyStatus follows the ranges, one-sided included", () => {
    assert.deepEqual(hoyStatus(590, 1800, 1850), { kind: "remaining", n: 1210 });
    assert.deepEqual(hoyStatus(1820, 1800, 1850), { kind: "inRange" });
    assert.deepEqual(hoyStatus(1900, 1800, 1850), { kind: "over", n: 50 });
    assert.deepEqual(hoyStatus(1800, 1800, 1800), { kind: "inRange" });
    assert.deepEqual(hoyStatus(2500, 1800, null), { kind: "inRange" });
    assert.deepEqual(hoyStatus(1000, null, 1850), { kind: "remaining", n: 850 });
    assert.equal(hoyStatus(1000, null, null), null);
    assert.equal(hoyAccent(590, 1800, 1850), 590 / 1850);
  });
  it("logged day needs one eaten row and no missing estimate", () => {
    assert.equal(isLoggedDay([item({ kind: "skipped" })]), false);
    assert.equal(
      isLoggedDay([item({ kind: "plan", estimate_status: "done" }), item({ kind: "other", estimate_status: "failed" })]),
      false,
    );
    assert.equal(isLoggedDay([old({ calories: 200 })]), true);
  });
  it("caloriesConsumed and macrosConsumed skip pending, failed and skipped rows", () => {
    const meals = [
      meal("c", [
        item({ kind: "plan", estimate_status: "done", calories: 410, protein_g: 30 }),
        item({ kind: "other", estimate_status: "pending" }),
        item({ kind: "plan", estimate_status: "failed" }),
        item({ kind: "skipped", estimate_status: null }),
        old({ calories: 200, protein_g: 10 }),
      ]),
    ];
    assert.equal(caloriesConsumed(meals), 610);
    assert.equal(macrosConsumed(meals).protein_g, 40);
  });
});
