/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  DayType,
  MealItem,
  MealWithItems,
  NutritionPlanMeal,
  NutritionPlanOption,
  NutritionPlanOptionItem,
  NutritionPlanWithDetails,
} from "@/src/types/database";
import {
  buildRegistrationRow,
  containerId,
  doneCount,
  mealDisplayName,
  mealsOnDate,
  nextMealId,
  registrationId,
  registrationsByPlanMeal,
  todayMeals,
} from "@/src/utils/meal-registration";

// ---- fixtures ----------------------------------------------------------------

function food(name: string, day_type: DayType): NutritionPlanOptionItem {
  return { id: `f-${name}`, option_id: "o", name, day_type, sort_order: 0, created_at: "2026-11-01T00:00:00Z" };
}
function option(id: string, foods: NutritionPlanOptionItem[]): NutritionPlanOption {
  return {
    id,
    plan_meal_id: id.split("-")[0],
    label: null,
    notes: null,
    sort_order: 0,
    created_at: "2026-11-01T00:00:00Z",
    nutrition_plan_option_items: foods,
  };
}
function planMeal(
  id: string,
  over: Partial<Omit<NutritionPlanMeal, "nutrition_plan_options">> & { options?: NutritionPlanOption[] } = {},
): NutritionPlanMeal {
  const { options, ...rest } = over;
  return {
    id,
    plan_id: "p",
    slot_index: 1,
    label: null,
    meal_type: "lunch",
    time_hint: null,
    applies_to: "both",
    is_optional: false,
    notes: null,
    sort_order: 0,
    created_at: "2026-11-01T00:00:00Z",
    ...rest,
    nutrition_plan_options: options ?? [option(`${id}-o1`, [food(`${id} food`, "both")])],
  };
}
function planWith(meals: NutritionPlanMeal[], over: { day_cycling?: boolean } = {}): NutritionPlanWithDetails {
  return {
    id: "p",
    user_id: "u1",
    assigned_by: null,
    source: "coach",
    is_template: false,
    template_id: null,
    name: "Plan",
    description: null,
    focus: null,
    duration_weeks: null,
    start_date: "2026-11-01",
    status: "active",
    day_cycling: over.day_cycling ?? true,
    notes: null,
    created_at: "2026-11-01T00:00:00Z",
    updated_at: "2026-11-01T00:00:00Z",
    nutrition_plan_meals: meals,
    nutrition_plan_targets: [],
  };
}
function reg(planMealId: string, over: Partial<MealItem> = {}): MealItem {
  return {
    id: `r-${planMealId}`,
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
    plan_meal_id: planMealId,
    kind: "plan",
    estimate_status: "done",
    ...over,
  };
}
function skip(planMealId: string): MealItem {
  return reg(planMealId, { kind: "skipped", estimate_status: null });
}
function meal(id: string, items: MealItem[], date = "2026-11-05"): MealWithItems {
  return {
    id,
    user_id: "u1",
    name: id,
    meal_type: "lunch",
    date,
    assigned_by: null,
    created_at: `${date}T08:00:00Z`,
    updated_at: `${date}T08:00:00Z`,
    meal_items: items,
  };
}

// bk breakfast · pre pre-workout (training only, with a note) · lu lunch (two
// options; lu-o2 has only training foods) · sn snack (optional) · di dinner.
const plan = planWith([
  planMeal("bk", { meal_type: "breakfast" }),
  planMeal("pre", { meal_type: "pre_workout", applies_to: "training", notes: "En días de descanso, nada" }),
  planMeal("lu", {
    meal_type: "lunch",
    options: [
      option("lu-o1", [food("pollo", "both"), food("arroz", "training")]),
      option("lu-o2", [food("batata", "training")]),
    ],
  }),
  planMeal("sn", { meal_type: "snack", is_optional: true }),
  planMeal("di", { meal_type: "dinner" }),
]);

// ---- tests ---------------------------------------------------------------------

describe("registration ids", () => {
  it("derives stable, distinct ids", () => {
    const a = registrationId("u1", "2026-11-05", "m1");
    assert.equal(a, registrationId("u1", "2026-11-05", "m1"));
    assert.notEqual(a, registrationId("u1", "2026-11-06", "m1"));
    assert.notEqual(containerId("u1", "2026-11-05", "snack"), registrationId("u1", "2026-11-05", "snack"));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("today's plan model", () => {
  it("picks today's rows by date key (midnight moves to the new day)", () => {
    const meals = [meal("y", [reg("bk")], "2026-11-04"), meal("t", [reg("lu")], "2026-11-05")];
    assert.deepEqual(mealsOnDate(meals, "2026-11-05").map((m) => m.id), ["t"]);
    assert.deepEqual(mealsOnDate(meals, "2026-11-06"), []);
  });
  it("lists meals for the day: not-for-today with a note becomes a note row", () => {
    const ms = todayMeals(plan, "rest", new Map());
    assert.deepEqual(
      ms.map((m) => [m.meal.id, m.applies, m.noteOnly]),
      [["bk", true, false], ["pre", false, true], ["lu", true, false], ["sn", true, false], ["di", true, false]],
    );
    assert.deepEqual(ms[2].options.map((o) => o.id), ["lu-o1"]);
  });
  it("keeps a registered meal the day type would hide", () => {
    const ms = todayMeals(plan, "rest", new Map([["pre", reg("pre")]]));
    assert.equal(ms[1].noteOnly, false);
    assert.ok(ms[1].registration);
  });
  it("counts N de M: optional only when registered, note rows never", () => {
    assert.deepEqual(doneCount(todayMeals(plan, "rest", new Map())), { done: 0, total: 3 });
    assert.deepEqual(
      doneCount(todayMeals(plan, "rest", new Map([["sn", reg("sn")], ["bk", skip("bk")]]))),
      { done: 2, total: 4 },
    );
  });
  it("next skips forgotten meals and wraps to the top", () => {
    assert.equal(nextMealId(todayMeals(plan, "rest", new Map())), "bk");
    assert.equal(nextMealId(todayMeals(plan, "rest", new Map([["lu", reg("lu")]]))), "di");
    assert.equal(nextMealId(todayMeals(plan, "rest", new Map([["di", reg("di")]]))), "bk");
    assert.equal(
      nextMealId(todayMeals(plan, "rest", new Map([["bk", reg("bk")], ["lu", reg("lu")], ["di", reg("di")]]))),
      null,
    );
  });
  it("a meal with no options offered today is still in M and can be next", () => {
    const p = planWith([planMeal("x", { options: [option("x-o1", [food("arroz", "training")])] })], { day_cycling: true });
    const ms = todayMeals(p, "rest", new Map());
    assert.deepEqual(ms[0].options, []);
    assert.deepEqual(doneCount(ms), { done: 0, total: 1 });
    assert.equal(nextMealId(ms), "x");
  });
  it("newest registration wins for the card", () => {
    const map = registrationsByPlanMeal([
      meal("c", [
        reg("lu", { created_at: "2026-11-05T12:00:00Z", id: "a" }),
        reg("lu", { created_at: "2026-11-05T13:00:00Z", id: "b" }),
      ]),
    ]);
    assert.equal(map.get("lu")?.id, "b");
  });
  it("builds rows per choice", () => {
    const base = {
      userId: "u1",
      dateKey: "2026-11-05",
      meal: planMeal("bk", { meal_type: "breakfast" }),
      displayName: "Desayuno",
      previous: null,
      now: "2026-11-05T08:00:00Z",
    };
    const other = buildRegistrationRow({ ...base, choice: { kind: "other", text: " arros con poyo " }, photoPath: null });
    assert.deepEqual(
      [other.kind, other.name, other.original_text, other.estimate_status, other.plan_option_id],
      ["other", "arros con poyo", "arros con poyo", "pending", null],
    );
    const skipped = buildRegistrationRow({ ...base, choice: { kind: "skipped" }, photoPath: "u1/p.jpg" });
    assert.deepEqual(
      [skipped.kind, skipped.name, skipped.photo_path, skipped.estimate_status],
      ["skipped", "Desayuno", null, null],
    );
    assert.equal(other.meal_id, containerId("u1", "2026-11-05", "breakfast"));
    assert.equal("estimate_version" in other, false);
  });
  describe("re-saving a registration (spec «Changing or undoing»)", () => {
    const base = {
      userId: "u1",
      dateKey: "2026-11-05",
      meal: planMeal("lu", { meal_type: "lunch" }),
      displayName: "Almuerzo",
      now: "2026-11-05T14:00:00Z",
    };
    const estimated = { estimate_status: "done" as const, calories: 640, protein_g: 42, carbs_g: 70, fat_g: 18 };
    // The sheet shows «otra cosa» with the AI's corrected text (name).
    const otherDone = reg("lu", { kind: "other", name: "Arroz con pollo", original_text: "arros con poyo", ...estimated });

    it("an unchanged «otra cosa» keeps the correction, its original text and its estimate", () => {
      const row = buildRegistrationRow({
        ...base,
        previous: otherDone,
        choice: { kind: "other", text: "Arroz con pollo " },
        photoPath: null,
      });
      assert.deepEqual(
        [row.name, row.original_text, row.estimate_status, row.calories, row.fat_g],
        ["Arroz con pollo", "arros con poyo", "done", 640, 18],
      );
    });
    it("edited «otra cosa» text is new content: a fresh original and a new estimate", () => {
      const row = buildRegistrationRow({
        ...base,
        previous: otherDone,
        choice: { kind: "other", text: "Arroz con pollo y ensalada" },
        photoPath: null,
      });
      assert.deepEqual(
        [row.name, row.original_text, row.estimate_status, row.calories],
        ["Arroz con pollo y ensalada", "Arroz con pollo y ensalada", "pending", 0],
      );
    });
    it("an unchanged plan option keeps its estimate; a new photo starts a new one", () => {
      const lu = option("lu-o1", [food("150 g pechuga de pollo", "both")]);
      const previous = reg("lu", { plan_option_id: "lu-o1", name: "150 g pechuga de pollo", photo_path: "u1/a.jpg", ...estimated });
      const choice = { kind: "plan" as const, option: lu, foodsText: "150 g pechuga de pollo" };
      const same = buildRegistrationRow({ ...base, previous, choice, photoPath: "u1/a.jpg" });
      assert.deepEqual([same.estimate_status, same.calories], ["done", 640]);
      const newPhoto = buildRegistrationRow({ ...base, previous, choice, photoPath: "u1/b.jpg" });
      assert.deepEqual([newPhoto.estimate_status, newPhoto.calories], ["pending", 0]);
    });
    it("a failed estimate re-saved unchanged asks the server to try again", () => {
      const failed = reg("lu", { kind: "other", name: "Arroz con pollo", original_text: "arros con poyo", estimate_status: "failed" });
      const row = buildRegistrationRow({ ...base, previous: failed, choice: { kind: "other", text: "Arroz con pollo" }, photoPath: null });
      assert.deepEqual([row.original_text, row.estimate_status], ["arros con poyo", "pending"]);
    });
  });
  it("capitalises the type name fallback only", () => {
    assert.equal(mealDisplayName({ label: null, meal_type: "lunch" }, () => "almuerzo"), "Almuerzo");
    assert.equal(mealDisplayName({ label: "cena ligera", meal_type: "dinner" }, () => "cena"), "cena ligera");
  });
});
