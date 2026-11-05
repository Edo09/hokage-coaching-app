# Meal registration · Plan 2 of 3: the app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Nutrición tab drops Diario. Clients register each of today's plan meals as an option, «otra cosa» or «No la comí», with an optional photo, in the Dojo Poster look. Inicio and Progreso count registrations by the spec's Counting rules.

**Architecture:**
- **Pure logic** in `src/utils/` (registration model, counting, day override, cache patches, photo-queue rules), covered by `npm test`.
- **Data hooks** wrap the existing `qk.meals` cache and the outbox:
  - registrations sync as upserts under ids derived from the client, the date and the meal;
  - a separate persisted photo queue hands a row to the outbox only after its photo is stored;
  - a Realtime sync patches estimates into the cache.
- **The screen** is rebuilt from new components (Hoy card, meal cards, status box, registration sheet, day-type chip). The diary, its screens and its strings go.

**Tech Stack:** Expo SDK (expo-router with typed routes, React Compiler), React Native, NativeWind / react-native-css (rem 14 on device), Reanimated 4, react-query with a persisted cache, Supabase JS with Realtime, expo-image-picker, expo-file-system, i18next, and `node --test` with type stripping.

**Spec:** `docs/superpowers/specs/2026-11-05-nutrition-meal-registration-design.md` (all of «The tab», «The AI after saving → Saving / The app shows it / Changing or undoing», «Counting», «Inicio and Progreso», «Data», «Edge cases», «Copy (es)»), with the reference mockups next to it. It depends on Plan 1: its migration must be applied before any build of this plan talks to the project, internal test builds included.

## Global Constraints

- **Column names from Plan 1** (exact):
  - `meal_items.plan_meal_id`, `kind` (`plan|other|skipped`), `original_text`;
  - `estimate_status` (`pending|done|failed`), `estimate_version`, `estimate_attempts`, `estimate_next_at`.
  - The server owns status, numbers, version, attempts and next try. Whatever the app sends for them is ignored, except a failed row marked `pending` (a retry).
- **Old diary row = `kind == null`** (loose equality, since cached rows can lack the key). Never tell rows apart by `estimate_status`.
- **Outbox writes:**
  - registrations go as `kind: "upsert"`, as the full `MealItem` row;
  - containers go as `kind: "insert"`, as a plain `Meal` with no `meal_items` key and no UI-only keys;
  - an unknown key gets PGRST204, which the outbox drops.
  - Never delete a `meals` container.
- **Ids:**
  - a registration's id is `uuidV5("registration:<userId>:<dateKey>:<planMealId>", REGISTRATION_NAMESPACE)`;
  - its container's id is `uuidV5("container:<userId>:<dateKey>:<diaryType>", …)`;
  - pre- and post-workout map to `snack` (`mealTypeToDiarySlot`).
- **Today** is `toDateKey(useToday())`, in the tab and on Inicio. `useMeals().todaysMeals` is not day-reactive and goes away.
- **NativeWind on device:**
  - rem is 14px, so size text in px (`text-[15px]/[14px]/[13px]/[11px]/[10px]`), never `leading-*`;
  - a nested `Text` must not repeat a `text-*` size and must repeat its face class (`font-bold`, `font-anton`), because tw `Text` injects `font-app`;
  - no `bg-x/15` opacity modifiers: use the `-soft` tokens or inline rgba;
  - macro colours come inline from `useColors()` (`macroProtein`, `macroCarbs`, `macroFat`);
  - exact mockup sizes use px classes (`h-[26px]`), never a className mirrored as a JS number.
- **Glyphs:** ✦ ⇄ ⚡ are not in Inter or Anton. Draw Ionicons instead: `sparkles` (✦), `swap-horizontal` (⇄), `flash` (⚡), `checkmark` (✓), `remove` (–).
- **Inside the RN `Modal` sheet,** gluestack overlays and toasts draw underneath. Confirm with `Alert.alert` on native and `globalThis.confirm` on web, as `program-exercise-modal.tsx:202-219` does.
- **Testability:**
  - pure modules in `src/utils/*.ts` use only `import type` for types and import only other pure modules (no RN, expo, i18n, AsyncStorage or supabase);
  - tests go in `src/**/*.test.ts` in the repo's style;
  - `.tsx` can't be unit-tested.
- **Test fixtures:** each test file builds rows with small local helpers:
  - `item(over)`: a full `MealItem` with zeros and the given overrides;
  - `old(over)`: the same with no `kind` key;
  - `meal(id, items)`: a `MealWithItems` container dated 2026-11-05;
  - `plainMeal(id)`: the same container as a plain `Meal`, with no `meal_items` key;
  - `planWith(meals, over)`, `planMeal(id, over)`, `option(id, foods)` and `food(name, dayType)`: plan fixtures.
- **Copy:** es and en get the same keys. The es text is exactly the spec's Copy table, as pinned in Task 8. Numbers use `toLocaleString(i18n.language === "es" ? "es-ES" : "en-US")`, as Inicio does.
- **React Compiler is on:**
  - set Reanimated values with `.set()`;
  - avoid manual `useMemo` in screen components;
  - keep day-scoped state above every `Swap`, which remounts its children.
- **Gates for every commit:** `npm test`, `npx tsc --noEmit` and `npx expo lint` stay clean.
- **Git:**
  - commit to `main` per task, and push when the plan is done;
  - there is no OTA: users get this only through a store build, made after Plan 1's migration is applied.

## Review Focus

1. **Midnight with the tab open.** Today's list, the Hoy card and Inicio move to the new day, and yesterday's cards can't be edited. Pinned by date-key selection tests (Task 3) and the harness check (Task 16).
2. **Rows restored from the persisted cache without the new keys** (`kind` undefined). They count as old diary rows. Pinned by a test (Task 2).
3. **A plan meal whose options are all filtered out today.** It is still in M and can be next, and its sheet offers only «Comí otra cosa» and «No la comí». Pinned by a test (Task 3).
4. **Two rows for the same plan meal today** (an old offline duplicate). The newest by `created_at` shows on the card, and both count in the totals. Pinned by a test (Task 3).
5. **Undo while the photo is still uploading.** The queued hand-off is cancelled and nothing comes back afterwards. Pinned by a pure queue test (Task 5) and a device check (Task 16).

---

### Task 1: Types, UUID v5 and registration ids

**Files:**
- Modify: `src/types/database.ts:98-166` (the `MealItem` block)
- Modify: `src/lib/ids.ts` (add `uuidV5`)
- Create: `src/utils/meal-registration.ts` (the ids part; Task 3 extends it)
- Test: `src/lib/ids.test.ts`, `src/utils/meal-registration.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // database.ts
  export type RegistrationKind = "plan" | "other" | "skipped";
  export type EstimateStatus = "pending" | "done" | "failed";
  // MealItem gains optional fields (cached rows lack them; use-meals' literal must still compile):
  //   plan_meal_id?: string | null; kind?: RegistrationKind | null; original_text?: string | null;
  //   estimate_status?: EstimateStatus | null; estimate_version?: number | null;
  //   estimate_attempts?: number | null; estimate_next_at?: string | null;
  // ids.ts
  export function uuidV5(name: string, namespace: string): string;
  // meal-registration.ts
  export const REGISTRATION_NAMESPACE = "3f6d1c9e-8a2b-4e57-b0c4-9d2e7f1a6b38";
  export function registrationId(userId: string, dateKey: string, planMealId: string): string;
  export function containerId(userId: string, dateKey: string, mealType: MealType): string;
  ```

- [ ] **Step 1: Write the failing tests.**
```ts
// src/lib/ids.test.ts
const DNS = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
it("matches RFC 4122 v5 vectors", () => {
  assert.equal(uuidV5("python.org", DNS), "886313e1-3b8a-5372-9b90-0c9aee199e5d");
  assert.equal(uuidV5("www.example.com", DNS), "2ed6657d-e927-568b-95e1-2665a8aea6a2");
});
it("handles non-ASCII names deterministically", () => {
  assert.equal(uuidV5("comí", DNS), uuidV5("comí", DNS));
  assert.notEqual(uuidV5("comí", DNS), uuidV5("comi", DNS));
});
// src/utils/meal-registration.test.ts
it("derives stable, distinct ids", () => {
  const a = registrationId("u1", "2026-11-05", "m1");
  assert.equal(a, registrationId("u1", "2026-11-05", "m1"));
  assert.notEqual(a, registrationId("u1", "2026-11-06", "m1"));
  assert.notEqual(containerId("u1", "2026-11-05", "snack"), registrationId("u1", "2026-11-05", "snack"));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
```
- [ ] **Step 2: Run the tests and check they fail.** `npm test` → FAIL (`uuidV5` is not exported).
- [ ] **Step 3: Implement.**
  - `uuidV5` is synchronous: an inline SHA-1 over `TextEncoder` UTF-8 bytes of the namespace bytes plus the name. Set the version nibble to `5` and the variant to `10xx`.
  - Add no dependency (`uuid` is only a transitive build-time package).
  - Add the `database.ts` types.
- [ ] **Step 4: Run the gates.** `npm test`, `npx tsc --noEmit` → pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(meals): registration ids (uuid v5) and registration fields on MealItem"`

### Task 2: Counting rules

**Files:**
- Create: `src/utils/meal-counting.ts`
- Modify: `src/utils/calories.ts:103-125` (`caloriesConsumed` and `macrosConsumed` use the predicate)
- Modify: `src/utils/progress.ts:579-643` (`nutritionStats` counts only logged days)
- Modify: `src/hooks/use-progress-dashboard.ts:332` (`hasMeals` ignores «No la comí»)
- Test: `src/utils/meal-counting.test.ts`, `src/utils/progress.test.ts` (new; covers `nutritionStats`)

**Interfaces:**
- Produces:
  ```ts
  export const DIARY_SLOTS: MealType[]; // ["breakfast","lunch","dinner","snack"]
  export type EstimateGap = "pending" | "failed";
  export function isOldDiaryRow(item: MealItem): boolean;          // item.kind == null
  export function isEaten(item: MealItem): boolean;                // kind plan|other, or old diary row
  export function countsTowardTotals(item: MealItem): boolean;     // old diary row, or estimate_status === "done"
  export function missingEstimate(item: MealItem): EstimateGap | null; // kind plan|other and status pending|failed
  export function combinedEstimateState(items: MealItem[]): EstimateGap | null; // any pending → "pending", else any failed → "failed"
  export function itemsOf(meals: MealWithItems[]): MealItem[];
  export type FuelSlot = { slot: MealType; meals: number; kcal: number; gap: EstimateGap | null; skippedOnly: boolean };
  export function fuelSlots(todays: MealWithItems[]): FuelSlot[];  // DIARY_SLOTS order, only slots with rows
  export type HoyStatus = { kind: "remaining"; n: number } | { kind: "inRange" } | { kind: "over"; n: number };
  export function hoyStatus(kcal: number, min: number | null, max: number | null): HoyStatus | null;
  export function hoyAccent(kcal: number, min: number | null, max: number | null): number; // kcal / (max ?? min), 0..1; 0 without target
  export function isLoggedDay(items: MealItem[]): boolean;         // ≥1 eaten and no missing estimate
  ```

- [ ] **Step 1: Write the failing tests.**
```ts
it("treats rows without kind as old diary rows (cached rows lack the key)", () => {
  const o = old({ calories: 300 });
  assert.equal(isOldDiaryRow(o), true); assert.equal(countsTowardTotals(o), true); assert.equal(isEaten(o), true);
});
it("counts only done estimates; skipped is never food", () => {
  assert.equal(countsTowardTotals(item({ kind: "plan", estimate_status: "pending" })), false);
  assert.equal(countsTowardTotals(item({ kind: "other", estimate_status: "done", calories: 410 })), true);
  assert.equal(isEaten(item({ kind: "skipped", estimate_status: null })), false);
  assert.equal(missingEstimate(item({ kind: "skipped", estimate_status: null })), null);
});
it("combines gaps: pending wins over failed", () => {
  assert.equal(combinedEstimateState([item({ kind: "plan", estimate_status: "failed" }), item({ kind: "other", estimate_status: "pending" })]), "pending");
  assert.equal(combinedEstimateState([item({ kind: "plan", estimate_status: "failed" })]), "failed");
  assert.equal(combinedEstimateState([item({ kind: "plan", estimate_status: "done" })]), null);
});
it("builds fuel slots: meals not foods, skipped-only slots kept", () => {
  const day = [
    { ...meal("b", [item({ kind: "plan", estimate_status: "done", calories: 410 })]), meal_type: "breakfast" as const },
    { ...meal("l", [item({ kind: "other", estimate_status: "pending" })]), meal_type: "lunch" as const },
    { ...meal("s", [item({ kind: "skipped", estimate_status: null })]), meal_type: "snack" as const }];
  assert.deepEqual(fuelSlots(day), [
    { slot: "breakfast", meals: 1, kcal: 410, gap: null, skippedOnly: false },
    { slot: "lunch", meals: 1, kcal: 0, gap: "pending", skippedOnly: false },
    { slot: "snack", meals: 0, kcal: 0, gap: null, skippedOnly: true }]);
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
  assert.equal(isLoggedDay([item({ kind: "plan", estimate_status: "done" }), item({ kind: "other", estimate_status: "failed" })]), false);
  assert.equal(isLoggedDay([old({ calories: 200 })]), true);
});
it("caloriesConsumed and macrosConsumed skip pending, failed and skipped rows", () => {
  const meals = [meal("c", [item({ kind: "plan", estimate_status: "done", calories: 410, protein_g: 30 }),
    item({ kind: "other", estimate_status: "pending" }), item({ kind: "plan", estimate_status: "failed" }),
    item({ kind: "skipped", estimate_status: null }), old({ calories: 200, protein_g: 10 })])];
  assert.equal(caloriesConsumed(meals), 610);
  assert.equal(macrosConsumed(meals).protein_g, 40);
});
// src/utils/progress.test.ts
it("nutritionStats leaves out unlogged days entirely", () => {
  // A: one done row of 1800 kcal; B: one done 500 + one pending; C: skipped only. All inside the 7-day window of NOW.
  const s = nutritionStats(meals, 1800, 7, NOW);
  assert.equal(s.loggedDays, 1); assert.equal(s.avgKcal, 1800); assert.equal(s.adherentDays, 1);
  assert.equal(s.perDay.find((d) => d.date === B)?.kcal, null);
  assert.equal(s.perDay.find((d) => d.date === C)?.kcal, null);
});
```
- [ ] **Step 2: Run the tests and check they fail.** `npm test` → FAIL.
- [ ] **Step 3: Implement.**
  - **`meal-counting.ts`:** pure, with type-only imports.
  - **`calories.ts`:** filters items through `countsTowardTotals` before summing. It imports the predicate from `meal-counting.ts`, which imports `MacroTotals` back as a type only, so there is no runtime cycle.
  - **`nutritionStats`:**
    1. Gather the items per date inside the window.
    2. Keep only the dates where `isLoggedDay(items)`.
    3. Sum the `countsTowardTotals` items of those dates.
    4. Leave everything downstream (bars, averages, adherence, macro split) as it is.
  - **`hasMeals`** becomes `meals.some((m) => m.meal_items.some(isEaten))`.
- [ ] **Step 4: Run the gates.** All three pass.
- [ ] **Step 5: Commit.** `git commit -m "feat(meals): counting rules for pending, failed and skipped registrations"`

### Task 3: Today's plan model (cards, «N de M», «Siguiente», rows to write)

**Files:**
- Modify: `src/utils/meal-registration.ts`
- Test: `src/utils/meal-registration.test.ts`

**Interfaces:**
- Consumes: `appliesOn`, `visibleItems`, `mealTypeToDiarySlot` and `ResolvedDay` from `src/utils/nutrition-plan.ts`; Task 1's ids.
- Produces:
  ```ts
  export type TodayMeal = { meal: NutritionPlanMeal; applies: boolean; registration: MealItem | null;
    options: NutritionPlanOption[]; noteOnly: boolean };
  export function registrationsByPlanMeal(todays: MealWithItems[]): Map<string, MealItem>; // newest created_at wins
  export function optionFoods(option: NutritionPlanOption, day: ResolvedDay, cycling: boolean): NutritionPlanOptionItem[];
  export function optionFoodsText(option: NutritionPlanOption, day: ResolvedDay, cycling: boolean): string; // names joined " · "
  export function todayMeals(plan: NutritionPlanWithDetails, day: ResolvedDay, registrations: Map<string, MealItem>): TodayMeal[];
  export function doneCount(meals: TodayMeal[]): { done: number; total: number };
  export function nextMealId(meals: TodayMeal[]): string | null;
  export function capitalizeFirst(s: string): string;
  export function mealDisplayName(meal: Pick<NutritionPlanMeal, "label" | "meal_type">, typeName: (t: PlanMealType) => string): string;
  export function optionLabel(option: NutritionPlanOption, index: number, fallback: (n: number) => string): string; // label ?? fallback(index + 1)
  export type RegistrationChoice =
    | { kind: "plan"; option: NutritionPlanOption; foodsText: string }
    | { kind: "plan-kept" }                // the «Del plan» row: keep the stored foods
    | { kind: "other"; text: string }
    | { kind: "skipped" };
  export function buildContainer(a: { userId: string; dateKey: string; mealType: MealType; name: string; now: string }): Meal;
  export function buildRegistrationRow(a: { userId: string; dateKey: string; meal: NutritionPlanMeal; displayName: string;
    choice: RegistrationChoice; photoPath: string | null; previous: MealItem | null; now: string }): MealItem;
  ```
- **Rules** (spec «Meal card states → Rules»):
  - **applies:** `!plan.day_cycling || appliesOn(meal.applies_to, day)`.
  - **A meal is listed** when it applies, is registered, or doesn't apply but has a note. In that last case `noteOnly` is true, and only while it isn't registered.
  - **options:** the meal's options in order, dropping those whose `optionFoods` is empty. Foods are `visibleItems(option, day)` when cycling, and all items otherwise.
  - **«N de M»:** M counts the listed, non-`noteOnly` meals that are `(applies && !is_optional) || registration != null`. N is the registered ones among them.
  - **Next:** the candidates are listed meals with `applies && !is_optional && !registration && !noteOnly`. Take the first candidate after the highest list index among registered meals; if there is none, the first candidate; if there are no candidates, `null`.
  - **Rows:**
    - `id = registrationId(...)`;
    - `meal_id = containerId(userId, dateKey, mealTypeToDiarySlot(meal.meal_type))`;
    - `plan_meal_id = meal.id`, `portion: null`, numbers 0;
    - `created_at = previous?.created_at ?? now`.
  - **By choice:**

    | Choice | `kind` | `plan_option_id` | `name` | `original_text` | `estimate_status` | `photo_path` |
    |---|---|---|---|---|---|---|
    | plan | plan | `option.id` | `foodsText` | null | `"pending"` | the given path |
    | plan-kept | plan | `previous.plan_option_id` | `previous.name` | null | `"pending"` | the given path |
    | other | other | null | `text.trim()` | `text.trim()` | `"pending"` | the given path |
    | skipped | skipped | null | `displayName` | null | `null` | null |

  - **Never set** version, attempts or next try in the row.

- [ ] **Step 1: Write the failing tests.** Use the fixture plan `plan` (cycling) with these meals:
  - `bk` breakfast (required, both);
  - `pre` pre_workout (training only, with a note);
  - `lu` lunch (required, both, options `lu-o1` and `lu-o2`, where `lu-o2` has only training foods);
  - `sn` snack (optional);
  - `di` dinner (required).

  `reg(id, over)` and `skip(id)` build registrations for a plan meal.
```ts
it("lists meals for the day: not-for-today with a note becomes a note row", () => {
  const ms = todayMeals(plan, "rest", new Map());
  assert.deepEqual(ms.map((m) => [m.meal.id, m.applies, m.noteOnly]),
    [["bk", true, false], ["pre", false, true], ["lu", true, false], ["sn", true, false], ["di", true, false]]);
  assert.deepEqual(ms[2].options.map((o) => o.id), ["lu-o1"]);
});
it("keeps a registered meal the day type would hide", () => {
  const ms = todayMeals(plan, "rest", new Map([["pre", reg("pre")]]));
  assert.equal(ms[1].noteOnly, false); assert.ok(ms[1].registration);
});
it("counts N de M: optional only when registered, note rows never", () => {
  assert.deepEqual(doneCount(todayMeals(plan, "rest", new Map())), { done: 0, total: 3 });
  assert.deepEqual(doneCount(todayMeals(plan, "rest", new Map([["sn", reg("sn")], ["bk", skip("bk")]]))), { done: 2, total: 4 });
});
it("next skips forgotten meals and wraps to the top", () => {
  assert.equal(nextMealId(todayMeals(plan, "rest", new Map())), "bk");
  assert.equal(nextMealId(todayMeals(plan, "rest", new Map([["lu", reg("lu")]]))), "di");
  assert.equal(nextMealId(todayMeals(plan, "rest", new Map([["di", reg("di")]]))), "bk");
  assert.equal(nextMealId(todayMeals(plan, "rest", new Map([["bk", reg("bk")], ["lu", reg("lu")], ["di", reg("di")]]))), null);
});
it("a meal with no options offered today is still in M and can be next", () => {
  const p = planWith([planMeal("x", { options: [option("x-o1", [food("arroz", "training")])] })], { day_cycling: true });
  const ms = todayMeals(p, "rest", new Map());
  assert.deepEqual(ms[0].options, []);
  assert.deepEqual(doneCount(ms), { done: 0, total: 1 });
  assert.equal(nextMealId(ms), "x");
});
it("newest registration wins for the card", () => {
  const map = registrationsByPlanMeal([meal("c", [reg("lu", { created_at: "2026-11-05T12:00:00Z", id: "a" }),
                                                 reg("lu", { created_at: "2026-11-05T13:00:00Z", id: "b" })])]);
  assert.equal(map.get("lu")?.id, "b");
});
it("builds rows per choice", () => {
  const base = { userId: "u1", dateKey: "2026-11-05", meal: planMeal("bk", { meal_type: "breakfast" }), displayName: "Desayuno", previous: null, now: "2026-11-05T08:00:00Z" };
  const other = buildRegistrationRow({ ...base, choice: { kind: "other", text: " arros con poyo " }, photoPath: null });
  assert.deepEqual([other.kind, other.name, other.original_text, other.estimate_status, other.plan_option_id],
    ["other", "arros con poyo", "arros con poyo", "pending", null]);
  const skipped = buildRegistrationRow({ ...base, choice: { kind: "skipped" }, photoPath: "u1/p.jpg" });
  assert.deepEqual([skipped.kind, skipped.name, skipped.photo_path, skipped.estimate_status], ["skipped", "Desayuno", null, null]);
  assert.equal(other.meal_id, containerId("u1", "2026-11-05", "breakfast"));
  assert.equal("estimate_version" in other, false);
});
it("capitalises the type name fallback only", () => {
  assert.equal(mealDisplayName({ label: null, meal_type: "lunch" }, () => "almuerzo"), "Almuerzo");
  assert.equal(mealDisplayName({ label: "cena ligera", meal_type: "dinner" }, () => "cena"), "cena ligera");
});
```
- [ ] **Step 2: Run the tests and check they fail.**
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4: Run the gates.**
- [ ] **Step 5: Commit.** `git commit -m "feat(meals): today's plan model: cards, N de M, next meal, rows"`

### Task 4: Day-type override shared by Nutrición and Inicio

**Files:**
- Create: `src/utils/day-override.ts`, `src/lib/day-override.ts`
- Modify: `src/hooks/use-nutrition-plan.ts:57-102`
- Modify: `app/(tabs)/index.tsx:66-67` (the goal uses `nutrition.day`)
- Test: `src/utils/day-override.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // utils
  export type StoredOverride = { dateKey: string; day: ResolvedDay };
  export function parseStoredOverride(raw: string | null): StoredOverride | null;
  export function overrideFor(stored: StoredOverride | null, todayKey: string): ResolvedDay | null;
  // lib (module store like src/lib/muscle-map-view.ts; AsyncStorage key `day_override_v1:${userId}`)
  export function useDayOverride(userId: string | undefined, todayKey: string): ResolvedDay | null;
  export async function setDayOverride(userId: string, todayKey: string, day: ResolvedDay | null): Promise<void>;
  // useNutritionPlan() return gains `todayKey: string`; `setViewDay` becomes `(day: ResolvedDay | null) => void`
  ```
- [ ] **Step 1: Write the failing tests.**
```ts
it("applies only on its own date", () => {
  assert.equal(overrideFor({ dateKey: "2026-11-05", day: "rest" }, "2026-11-05"), "rest");
  assert.equal(overrideFor({ dateKey: "2026-11-04", day: "rest" }, "2026-11-05"), null);
});
it("parses defensively", () => {
  assert.equal(parseStoredOverride("garbage"), null);
  assert.equal(parseStoredOverride(JSON.stringify({ dateKey: "2026-11-05", day: "both" })), null);
  assert.deepEqual(parseStoredOverride(JSON.stringify({ dateKey: "2026-11-05", day: "training" })), { dateKey: "2026-11-05", day: "training" });
});
```
- [ ] **Step 2: Run the tests and check they fail.**
- [ ] **Step 3: Implement.**
  - **The store:** module state per user, an AsyncStorage restore with a `changed` flag (as `src/utils/reminder-prefs.ts:20,34` does), and `useSyncExternalStore`.
  - **`useNutritionPlan`:**
    - `todayKey = toDateKey(useToday())`;
    - `autoDay = resolveDayType(program, todayKey)`;
    - `override = useDayOverride(user?.id, todayKey)`;
    - `day = override ?? autoDay`;
    - `overridden = override != null && override !== autoDay`;
    - `setViewDay(d)` stores `d === autoDay ? null : d`.
  - **Inicio:** `planCalorieGoal(nutrition.plan, nutrition.day)`.
- [ ] **Step 4: Run the gates.**
- [ ] **Step 5: Commit.** `git commit -m "feat(nutrition): day-type override lasts the day, survives restarts, shared with Inicio"`

### Task 5: Persisted photo queue (row only after its photo is stored)

**Files:**
- Create: `src/utils/photo-queue.ts` (pure), `src/lib/photo-queue.ts` (the store and the worker)
- Modify: `src/services/meal-photos.ts` (add `uploadMealPhotoBytes`)
- Modify: `src/lib/outbox-overlay.ts:21-53` (`overlayMeals(userId, rows, extraOps = [])`) and `src/hooks/use-meals.ts:23-34` (pass `await getPendingPhotoOps(userId)`)
- Modify: `app/_layout.tsx:59-67, 159-162` (call `setupPhotoQueue()` once; process on AppState active and after the cache restore)
- Modify: `src/providers/auth-provider.tsx:92-100` (`clearPhotoQueue()` on sign-out)
- Modify: `package.json` (`npx expo install expo-file-system`; it is already in the native build through `expo`)
- Test: `src/utils/photo-queue.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // utils
  export type PhotoJob = { registrationId: string; userId: string; localUri: string; storagePath: string;
    mimeType: string; container: Meal; row: MealItem; tries: number };
  export const MAX_UPLOAD_TRIES = 3;
  export function putJob(jobs: PhotoJob[], job: PhotoJob): PhotoJob[];               // replaces same registrationId
  export function dropJob(jobs: PhotoJob[], registrationId: string): PhotoJob[];
  export function afterFailedUpload(job: PhotoJob): { job: PhotoJob; giveUp: boolean }; // tries + 1; giveUp at MAX
  export function isDuplicateUpload(e: unknown): boolean;                            // statusCode "409" / status 409 / /already exists/i
  export function jobAsOps(job: PhotoJob): Omit<OutboxOp, "opId" | "createdAt">[];   // `import type`; container insert + row upsert
  // lib
  export async function queuePhotoJob(i: { userId: string; registrationId: string; sourceUri: string; mimeType: string;
    storagePath: string; container: Meal; row: MealItem }): Promise<void>;
  export async function updateQueuedRow(registrationId: string, row: MealItem): Promise<boolean>;
  export async function cancelPhotoJob(registrationId: string): Promise<void>;
  export function hasQueuedPhoto(registrationId: string): boolean;
  export function useRegistrationPhotoUri(item: MealItem | null): string | null;    // queued local uri, else mealPhotoUrl(photo_path), else null
  export async function getPendingPhotoOps(userId: string): Promise<OutboxOp[]>;
  export function processPhotoQueue(): Promise<void>;   // single-flight
  export function setupPhotoQueue(): void;              // hydrate + onlineManager subscription
  export async function clearPhotoQueue(): Promise<void>;
  // meal-photos.ts
  export async function uploadMealPhotoBytes(path: string, body: ArrayBuffer, contentType: string): Promise<"stored" | "duplicate" | "failed">;
  ```
- **Behaviour:**
  - **Persistence:** jobs persist under the AsyncStorage key `hokage-photo-queue-v1`, metadata only. Store no base64: AsyncStorage on Android is capped at 6 MB.
  - **Files:** `queuePhotoJob` copies `sourceUri` into `Paths.document/meal-photo-queue/<registrationId>.<ext>` with expo-file-system's `File`/`Directory` API. On web, it keeps the original uri in memory.
  - **The worker** runs while online, one job at a time:
    1. Read the bytes and upload them to the job's fixed `storagePath`, with no `upsert`.
    2. `stored` or `duplicate`: `enqueue` each op of `jobAsOps(job)`, then drop the job and delete the local file.
    3. `failed` while online: `afterFailedUpload`. On give-up, set the row's `photo_path` to null, enqueue it without the photo, update the `qk.meals` cache, and drop the job.
    4. Offline: stop and wait.
    5. A missing local file: enqueue the row without the photo.
  - **The outbox is never blocked by an upload.**
- [ ] **Step 1: Write the failing tests.**
```ts
it("one job per registration; cancel removes it (undo during upload)", () => {
  const a = job("r1"); const b = { ...job("r1"), storagePath: "u1/new.jpg" };
  assert.deepEqual(putJob([a], b), [b]);
  assert.deepEqual(dropJob([b], "r1"), []);
});
it("gives up after three failed uploads", () => {
  let r = afterFailedUpload(job("r1")); assert.equal(r.giveUp, false);
  r = afterFailedUpload(r.job); r = afterFailedUpload(r.job); assert.equal(r.giveUp, true);
});
it("recognises a duplicate upload as stored", () => {
  assert.equal(isDuplicateUpload({ statusCode: "409" }), true);
  assert.equal(isDuplicateUpload(new Error("The resource already exists")), true);
  assert.equal(isDuplicateUpload({ statusCode: "500" }), false);
});
it("hands the row over as a container insert then a row upsert, photo path set", () => {
  const [c, r] = jobAsOps(job("r1"));
  assert.deepEqual([c.table, c.kind, r.table, r.kind, (r.payload as MealItem).photo_path], ["meals", "insert", "meal_items", "upsert", "u1/p.jpg"]);
  assert.equal("meal_items" in c.payload, false);
});
```
- [ ] **Step 2: Run the tests and check they fail.**
- [ ] **Step 3: Implement** the pure part, then the lib, the overlay parameter, and the setup and sign-out wiring.
- [ ] **Step 4: Run the gates.**
- [ ] **Step 5: Commit.** `git commit -m "feat(meals): persisted photo queue; a registration syncs once its photo is stored"`

### Task 6: Registration writes (register, undo, retry)

**Files:**
- Create: `src/utils/meal-cache.ts` (pure cache edits; Task 7 extends it)
- Create: `src/hooks/use-meal-registrations.ts`
- Test: `src/utils/meal-cache.test.ts`

**Interfaces:**
- Consumes: Task 3's `buildRegistrationRow`, `buildContainer` and `registrationsByPlanMeal`; Task 5's `queuePhotoJob`, `updateQueuedRow`, `cancelPhotoJob` and `hasQueuedPhoto`; `enqueue` from `src/lib/outbox.ts`; `removeMealPhoto` from `src/services/meal-photos.ts`.
- Produces:
  ```ts
  // meal-cache.ts
  export function upsertItemInCache(meals: MealWithItems[], container: Meal, item: MealItem): MealWithItems[]; // prepends container if absent; removes item id everywhere, then appends to its container
  export function removeItemFromCache(meals: MealWithItems[], itemId: string): MealWithItems[];             // containers stay
  // use-meal-registrations.ts
  export type PickedPhoto = { uri: string; mimeType: string };
  export type PhotoChange = { kind: "keep" } | { kind: "remove" } | { kind: "new"; photo: PickedPhoto };
  export type RegisterInput = { meal: NutritionPlanMeal; displayName: string; choice: RegistrationChoice; photo: PhotoChange };
  export function useMealRegistrations(): {
    todayKey: string; todays: MealWithItems[]; registrations: Map<string, MealItem>;
    register(input: RegisterInput): Promise<void>;
    undo(item: MealItem): Promise<void>;
    retry(items: MealItem[]): Promise<void>;
  };
  ```
- **Behaviour:**
  - **`todays`:** `useMeals().meals` filtered to `todayKey = toDateKey(useToday())`.
  - **`register`:**
    1. Build the container (`name: i18n.t("meals.<slot>")`) and the row.
    2. Choose the photo:
       - skipped or `remove`: `photo_path` null, and cancel any queued job;
       - `keep`: the previous `photo_path`. If a queued job exists for this id, call `updateQueuedRow` and stop;
       - `new`: a fresh path `${userId}/${newId()}.jpg|png`; cancel any old job, call `queuePhotoJob`, and stop.
    3. Apply `upsertItemInCache` optimistically.
    4. Unless step 2 stopped, enqueue the container (`insert`) and then the row (`upsert`).
    5. Once the row is handed off, call `removeMealPhoto` on a previously uploaded photo that was replaced or removed.
  - **`undo`:** cancel the queued job, `removeItemFromCache`, enqueue `delete` `{ id }`, then `removeMealPhoto` on the uploaded photo.
  - **`retry`:** for each failed item, apply `{ ...item, estimate_status: "pending" }` to the cache and enqueue it as an upsert.
- [ ] **Step 1: Write the failing tests.**
```ts
it("prepends a new container, moves the item, keeps containers on removal", () => {
  let ms = upsertItemInCache([meal("c1", [])], plainMeal("c2"), item({ id: "r", meal_id: "c2" }));
  assert.deepEqual(ms.map((m) => [m.id, m.meal_items.map((i) => i.id)]), [["c2", ["r"]], ["c1", []]]);
  ms = upsertItemInCache(ms, meal("c1", []), item({ id: "r", meal_id: "c1" }));
  assert.deepEqual(ms.map((m) => [m.id, m.meal_items.map((i) => i.id)]), [["c2", []], ["c1", ["r"]]]);
  ms = removeItemFromCache(ms, "r");
  assert.deepEqual(ms.map((m) => [m.id, m.meal_items.length]), [["c2", 0], ["c1", 0]]);
});
```
- [ ] **Step 2: Run the tests and check they fail.**
- [ ] **Step 3: Implement** the pure functions, then the hook. The hook takes `user` from `useAuth()`, and its writes go through `queryClient.setQueryData(qk.meals(uid), …)` and `enqueue`.
- [ ] **Step 4: Run the gates.**
- [ ] **Step 5: Commit.** `git commit -m "feat(meals): register, undo and retry registrations through the outbox"`

### Task 7: Estimates reach the app (Realtime patch + re-read while pending)

**Files:**
- Modify: `src/utils/meal-cache.ts` (add `normalizeMealItem`, `patchItemInCache` and `pendingRecheckIds`)
- Create: `src/hooks/use-meal-estimate-sync.ts`
- Modify: `app/(tabs)/_layout.tsx:69-74` (call it inside `Reminders()`, which is mounted once)
- Test: `src/utils/meal-cache.test.ts`

**Interfaces:**
- Consumes: `getPendingOps` from `src/lib/outbox.ts`; `hasQueuedPhoto` (Task 5).
- Produces:
  ```ts
  export function normalizeMealItem(row: Record<string, unknown>): MealItem;          // Number() on calories/protein_g/carbs_g/fat_g/estimate_version/estimate_attempts
  export function patchItemInCache(meals: MealWithItems[], row: MealItem): MealWithItems[] | null; // null when its container isn't cached
  export function pendingRecheckIds(todays: MealWithItems[], now: Date): string[];   // pending rows whose estimate_next_at is null or ≤ now + 60 s
  export function useMealEstimateSync(): void;
  ```
- **Behaviour:**
  - **Channel:** `supabase.channel(\`sync:meal_items:${++seq}\`)` on `postgres_changes` `{ event: "*", schema: "public", table: "meal_items", filter: \`user_id=eq.${uid}\` }`.
  - **INSERT or UPDATE:** skip the event when `getPendingOps(uid)` holds an op with `payload.id === row.id`, or `hasQueuedPhoto(row.id)`. Otherwise `setQueryData` with `patchItemInCache(normalizeMealItem(row))`; a `null` result invalidates `qk.meals(uid)`.
  - **DELETE:** invalidate.
  - **Re-read:** every 10 s while `pendingRecheckIds(todays, now)` is non-empty and the app is active, run `select * from meal_items where id in (…)` and patch the rows the same way.
- [ ] **Step 1: Write the failing tests.**
```ts
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
  const ms = [meal("c1", [item({ id: "a", kind: "other", estimate_status: "pending", estimate_next_at: null }),
    item({ id: "b", kind: "plan", estimate_status: "pending", estimate_next_at: "2026-11-05T13:10:00Z" }),
    item({ id: "c", kind: "plan", estimate_status: "done" })])];
  assert.deepEqual(pendingRecheckIds(ms, now), ["a"]);
});
```
- [ ] **Step 2: Run the tests and check they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gates.**
- [ ] **Step 5: Commit.** `git commit -m "feat(meals): estimates appear live (Realtime patch, re-read while pending)"`

### Task 8: Copy (es/en) for the new screens

**Files:**
- Modify: `src/i18n/es.ts`, `src/i18n/en.ts` (a new `mealReg` namespace at the same line in both; `progress.emptyNutricion` reworded)
- Test: `src/i18n/meal-registration.test.ts`, pinned like `src/i18n/check-card.test.ts`

- [ ] **Step 1: Write the failing test** with this table, exactly:
```ts
const COPY: [key: string, es: string, en: string][] = [
  ["today", "Hoy", "Today"], ["aiEstimated", "estimado con IA", "AI estimate"],
  ["remaining", "{{n}} restantes", "{{n}} left"], ["inRange", "En tu rango", "In range"], ["over", "{{n}} de más", "{{n}} over"],
  ["doneCount_one", "{{done}} de {{count}} comida", "{{done}} of {{count}} meal"],
  ["doneCount_other", "{{done}} de {{count}} comidas", "{{done}} of {{count}} meals"],
  ["next", "Siguiente", "Next"],
  ["optionsCount_one", "{{count}} opción", "{{count}} option"], ["optionsCount_other", "{{count}} opciones", "{{count}} options"],
  ["registerMeal", "Registrar {{meal}}", "Log {{meal}}"], ["optionN", "Opción {{n}}", "Option {{n}}"],
  ["fromPlan", "Del plan", "From the plan"], ["otherMeal", "Otra comida", "Something else"],
  ["skipped", "No la comí", "Didn't eat it"], ["optional", "Opcional", "Optional"],
  ["estimating", "Calculando…", "Estimating…"], ["notEstimated", "Sin estimar", "Not estimated"],
  ["notToday", "No aplica hoy", "Not for today"], ["whatDidYouEat", "¿Qué comiste?", "What did you eat?"],
  ["ateSomethingElse", "Comí otra cosa", "I ate something else"], ["writeWhatYouAte", "Escribe lo que comiste", "Write what you ate"],
  ["aiHint", "Al guardar, la IA corrige la ortografía y calcula las calorías.", "When you save, the AI fixes the spelling and works out the calories."],
  ["addPhoto", "Añadir foto", "Add photo"], ["platePhoto", "Foto del plato", "Photo of the plate"], ["change", "Cambiar", "Change"],
  ["photoNeedsConnection", "La foto necesita conexión. Puedes guardar sin ella.", "The photo needs a connection. You can save without it."],
  ["undoEntry", "Deshacer registro", "Undo entry"], ["undoTitle", "¿Deshacer el registro?", "Undo this entry?"],
  ["undoBody", "{{meal}} vuelve a quedar pendiente.", "{{meal}} will be pending again."], ["undoConfirm", "Deshacer", "Undo"],
  ["trainingDay", "Día de entreno", "Training day"], ["restDay", "Día de descanso", "Rest day"],
  ["autoFromProgram", "Según tu programa", "From your program"], ["overridden", "Cambiado por ti", "Changed by you"],
  ["noPlanTitle", "Sin plan nutricional", "No nutrition plan"], ["noPlanHint", "Tu coach aún no te ha asignado uno.", "Your coach hasn't assigned one yet."],
  ["coachNotes", "Notas del coach", "Coach notes"],
  ["mealsCount_one", "{{count}} comida", "{{count}} meal"], ["mealsCount_other", "{{count}} comidas", "{{count}} meals"],
];
// deepEqual({ ...es.mealReg }, fromEntries(es)), same for en; plus
// es.progress.emptyNutricion === "Registra las comidas de tu plan para ver tus calorías, proteína y adherencia a la meta."
// en.progress.emptyNutricion === "Log your plan's meals to see your calories, protein and goal adherence."
```
- [ ] **Step 2: Run the test and check it fails.**
- [ ] **Step 3: Add the namespace to both files** at the same line numbers. Reuse `common.save`, `common.cancel`, `meals.removePhoto`, `meals.takePhoto`, `meals.fromGallery` and `meals.cameraPermission`.
- [ ] **Step 4: Run the gates.**
- [ ] **Step 5: Commit.** `git commit -m "feat(i18n): meal registration copy (es/en)"`

### Task 9: Status box, sharp chip, meal icons

**Files:**
- Create: `src/components/nutrition/meal-icons.ts` (move `MEAL_ICON` from `nutrition-plan-view.tsx:195-202`)
- Create: `src/components/nutrition/status-box.tsx`, `src/components/nutrition/sharp-chip.tsx`

**Interfaces:**
- Produces:
  ```ts
  export const MEAL_ICON: Record<PlanMealType, React.ComponentProps<typeof Ionicons>["name"]>;
  export type StatusBoxState = "pending" | "next" | "plan" | "other" | "skipped";
  export function StatusBox(props: { state: StatusBoxState; popKey: number }): JSX.Element;
  export function SharpChip(props: { tone: "red" | "neutral" | "solid" | "ai"; icon?: IoniconName; children: string }): JSX.Element;
  ```
- **The box** is `h-[26px] w-[26px]` inside `Skewed deg={-8}`, with the outer view `justify-center`. Its looks:

  | State | Look |
  |---|---|
  | pending | dashed `border-content-muted`, 1.5px |
  | next | `border-2 border-brand-primary` |
  | plan | `bg-brand-primary` with a white `checkmark` |
  | other | `bg-surface-elevated` with `swap-horizontal` in `contentSecondary` |
  | skipped | `bg-brand-dark` with `border-border-strong` and `remove` in `contentMuted` |

  When `popKey` grows past 0 and the state is plan or other, it plays `usePop().pop()`, `<Burst play={popKey} from={15} to={27} colors={[colors.brandPrimary, colors.contentPrimary]} />` and `Haptics.impactAsync(Medium)`. Skipped never pops. The pop and the skew sit on separate nested views.
- **The chip** is sharp (no radius), with `CapsLabel size={8.5}` text:

  | Tone | Look |
  |---|---|
  | red | `bg-brand-primary-soft` with `text-brand-primary-light` |
  | neutral | `bg-brand-dark border border-border` with `text-content-tertiary` |
  | solid | skewed `bg-brand-primary` with white text |
  | ai | `bg-brand-accent-soft` with `text-brand-accent` |

- [ ] **Step 1: Implement**, following `DoneCheckbox` (`program-exercise-row.tsx:270-329`) and `Skewed` (`poster.tsx:11-36`).
- [ ] **Step 2: Gates:** `npx tsc --noEmit`, `npx expo lint`. These components are checked visually in Task 16.
- [ ] **Step 3: Commit.** `git commit -m "feat(nutrition): slanted status box and sharp chips"`

### Task 10: Meal card

**Files:**
- Create: `src/components/nutrition/meal-card.tsx`

**Interfaces:**
- Consumes: Task 3's `TodayMeal`, `optionFoods` and `optionLabel`; Task 2's `missingEstimate`; Task 5's `useRegistrationPhotoUri`; Task 9.
- Produces:
  ```ts
  export function MealCard(props: {
    item: TodayMeal; name: string; isNext: boolean; open: boolean; day: ResolvedDay; cycling: boolean; popKey: number;
    onOpen: () => void; onRegister: (optionId: string | null) => void; onEdit: () => void; onRetry: () => void;
  }): JSX.Element;
  export function NotTodayRow(props: { name: string; note: string }): JSX.Element;
  ```
- **States** are as in the spec's table. The `StatusBox` state is:
  - `next` when open and next;
  - `pending` when open but not next;
  - `plan`, `other` or `skipped` from the registration's kind.
  - **Registered:**
    - the photo `useRegistrationPhotoUri(item.registration)` (expo-image), or the meal-type icon on the left;
    - an Anton name (`PosterText size={15}`, muted for skipped);
    - the chip: «Opción N» (red), or «Del plan» when `plan_option_id` is null or no longer among `item.options`; «Otra comida» plus the text (neutral); «No la comí» plus the time hint (neutral);
    - the right side: a `PosterText size={18}` kcal with a «kcal» CapsLabel. A pending row shows sparkles + «Calculando…» in gold instead; a failed row shows a small «Sin estimar» `Pressable` that calls `onRetry`.
  - **Open:**
    - a red-bordered card;
    - a header with the icon in a red tile, the name, the «Siguiente» solid chip when `isNext`, and the time hint · «N opciones»;
    - option tabs only when there are 2 or more options;
    - the foods with red skewed bullets, then the option note;
    - a `SkewButton` «Registrar {meal lowercased}» that calls `onRegister(selectedOptionId)`.
  - **Pending:** a dashed box, and the optional chip when `is_optional`.
- **Buttons never nest.** Put a backdrop `Pressable` behind the content (`program-exercise-row.tsx:128-136`).
- [ ] **Step 1: Implement.** The selected tab is local state, reset when the card closes.
- [ ] **Step 2: Gates:** tsc and lint.
- [ ] **Step 3: Commit.** `git commit -m "feat(nutrition): meal card in every state"`

### Task 11: Hoy card

**Files:**
- Create: `src/components/nutrition/today-card.tsx`

**Interfaces:**
- Consumes: Task 2's `hoyStatus`, `hoyAccent`, `combinedEstimateState`, `itemsOf` and `macrosConsumed`.
- Produces: `export function TodayCard(props: { target: NutritionPlanTarget | null; todays: MealWithItems[]; onRetry: () => void }): JSX.Element;`
- **Layout:**
  - `Card topAccent={hoyAccent(kcal, kcal_min, kcal_max)} className="rounded-[20px] p-[18px] gap-3"`;
  - the label «HOY · ✦ estimado con IA», as sibling Texts with a gold `sparkles` icon;
  - kcal as `PosterText size={30}`, with the target («/ 1800–1850 kcal») as a sibling Text, formatted in the app's locale. A target with `min === max` shows one number;
  - `hoyStatus` text on the right: «N restantes» in `success`, «En tu rango» in `success`, «N de más» in `warning`;
  - three macro columns split by hairlines, as in `hero-card.tsx:182-200`, coloured with `useColors()`;
  - under the kcal, `combinedEstimateState(itemsOf(todays))` shows «✦ Calculando…» (gold), or a «Sin estimar» `Pressable` that calls `onRetry`.
  - **With no target:** the totals only.
- [ ] **Step 1: Implement.** **Step 2: Gates.** **Step 3: Commit.** `git commit -m "feat(nutrition): Hoy card with ranges and estimate state"`

### Task 12: Registration sheet and photo picker

**Files:**
- Create: `src/hooks/use-meal-photo-picker.ts` (moved from `app/(tabs)/nutrition/create.tsx:29-35, 101-131`, with `base64: false`)
- Create: `src/components/nutrition/registration-sheet.tsx`

**Interfaces:**
- Consumes: `PickedPhoto` and `RegisterInput` (Task 6); Task 5's `useRegistrationPhotoUri`; Task 3's `optionFoodsText` and `optionLabel`.
- Produces:
  ```ts
  export function useMealPhotoPicker(): { fromCamera(): Promise<PickedPhoto | null>; fromGallery(): Promise<PickedPhoto | null> };
  export type SheetTarget = { meal: NutritionPlanMeal; name: string; registration: MealItem | null; preselectOptionId: string | null };
  export function RegistrationSheet(props: {
    target: SheetTarget | null; options: NutritionPlanOption[]; day: ResolvedDay; cycling: boolean; online: boolean;
    onClose: () => void; onSave: (input: RegisterInput) => void; onUndo: (item: MealItem) => void;
  }): JSX.Element;
  ```
- **The frame** is `program-exercise-modal.tsx:222-252`: an RN `Modal` (`slide`, `transparent`, `statusBarTranslucent`, `navigationBarTranslucent`), the backdrop, `bottom: useKeyboardHeight()`, and the grabber. It keeps the last target rendered until the slide-out ends.
- **Content:**
  - the header: an Anton name and the time hint;
  - the «¿Qué comiste?» CapsLabel;
  - the radio rows:
    1. a pre-selected «Del plan» row with the stored foods, first, when the registration's option is gone;
    2. one row per option, with its label and foods;
    3. «Comí otra cosa», dashed, with «Escribe lo que comiste»;
    4. «No la comí», plain, only when `!meal.is_optional`.
  - **While «otra cosa» is selected,** the option rows shrink to their labels, and a multiline tw `TextInput` (`placeholderTextColor={colors.contentMuted}`) replaces the subtitle, followed by the gold hint.
  - **The photo row:** «Añadir foto · Opcional», with two buttons («Tomar foto», «Galería»). With a photo, it shows the thumbnail, «Foto del plato», «Cambiar» and «Quitar foto». Offline, it is disabled with «La foto necesita conexión. Puedes guardar sin ella.» It is hidden while «No la comí» is selected.
  - **«Guardar»:** a `SkewButton`, disabled while «otra cosa» has no text.
  - **«Deshacer registro»** when editing. It confirms with `Alert.alert` on native and `globalThis.confirm` on web («¿Deshacer el registro?» / «{{meal}} vuelve a quedar pendiente.» / «Deshacer» / «Cancelar»), then calls `onUndo`.
- **The initial choice** follows the registration's kind (plan with an option that still exists, «Del plan» when it is gone, other, or skipped), else `preselectOptionId`. The initial photo is `{ kind: "keep" }`.
- **Camera permission refusal** shows `Alert.alert(t("meals.cameraPermission"))`, because a toast would draw under the Modal.
- [ ] **Step 1: Implement.** **Step 2: Gates.** **Step 3: Commit.** `git commit -m "feat(nutrition): registration sheet (plan, otra cosa, no la comí, photo, undo)"`

### Task 13: The tab: Plan pane, day-type chip, default pane, header, supplements

**Files:**
- Rewrite: `app/(tabs)/nutrition/index.tsx` (`NutritionScreen`, `PlanPane`, `SupplementsPane`; the DiaryPane goes)
- Modify: `app/(tabs)/nutrition/_layout.tsx:9-25, 48-63` (the header date from `useToday()`; drop `unstable_settings` and the `create`/`edit` screens)
- Create: `src/components/nutrition/day-type-chip.tsx`
- Delete: `src/components/nutrition/nutrition-plan-view.tsx` (replaced)
- Modify: `src/components/nutrition/supplement-stack-view.tsx` and `shopping-list-card.tsx` (restyle)

**Interfaces:**
- Consumes: Tasks 3–7 and 9–12; `useNutritionPlan` (Task 4), `useSupplementPlan`, `useSupplementLog(toDateKey(useToday()))`, `useIsOnline` and `targetFor`.
- Produces: `export function DayTypeChip(props: { day: ResolvedDay; overridden: boolean; onChange: (day: ResolvedDay) => void }): JSX.Element;`
- **Behaviour:**
  - **Default pane:** `pane` is null until `!plan.loading && !supplements.loading`. It is then seeded once (plan if there is a nutrition plan, otherwise supplements if there is a supplement plan, otherwise plan), and a segment tap wins. Show `LoadingBlock` until the seed, and mount the `Swap` only after it.
  - **PlanPane** is keyed by `plan.todayKey`, so the open card and the sheet reset at midnight. It holds:
    - `openId: string | null` (null means the next meal is open);
    - `sheet: SheetTarget | null`;
    - `popKeys: Record<string, number>`.

    On save it calls `register`, sets `openId = null` (so the next meal opens), and bumps `popKeys[meal.id]` for plan and other.
  - **Order inside `Screen onRefresh={plan.refresh}`:**
    1. `TodayCard` (`onRetry`: retry today's failed rows);
    2. the row with the `DayTypeChip` (only when `day_cycling`) and the «N de M comidas» CapsLabel;
    3. a `MealCard` or `NotTodayRow` for each `todayMeals` item;
    4. `ShoppingListCard`;
    5. the «Notas del coach» Card.
  - **No plan:** an `EmptyState` with «Sin plan nutricional» / «Tu coach aún no te ha asignado uno.» inside `Screen`, so pull-to-refresh still works.
  - **DayTypeChip:** the red chip «⚡ Día de entreno» (a `flash` icon) or the neutral chip «Día de descanso», with the caption «Según tu programa» or «Cambiado por ti» next to it. A tap opens the gluestack `Actionsheet` with the two days. Picking the auto day clears the override.
  - **Supplements:** the same data and check-offs, restyled with a poster header card, tier `Card`s with a `CapsLabel` title, `DoneCheckbox` (from `program-exercise-row.tsx`) for each tick, and a Horario card. No `bg-x/15` classes are left.
- [ ] **Step 1: Implement.**
- [ ] **Step 2: Gates.** Then run:
  ```bash
  grep -rn "nutrition/create\|nutrition/edit\|NutritionPlanView" app src
  ```
  Expected: no hits.
- [ ] **Step 3: Commit.** `git commit -m "feat(nutrition): the new Plan pane, day-type chip, restyled supplements"`

### Task 14: Inicio and Progreso

**Files:**
- Modify: `app/(tabs)/index.tsx`:
  - imports at 22, 33-41;
  - `todaysMeals` at 59;
  - the fuel card at 222-268;
  - «Combustible de Hoy» at 323-393;
  - the header date at 123-127.
- Modify: `src/components/progress/nutrition-card.tsx:38-63` (the reworded empty text from Task 8)

**Interfaces:**
- Consumes: `useMealRegistrations().todays` (Task 6); Task 2's `fuelSlots`, `combinedEstimateState`, `itemsOf` and `caloriesConsumed`; Task 3's `capitalizeFirst`.
- **Inicio:**
  - `consumed = caloriesConsumed(todays)`.
  - Under the `Ring`, in a column wrapper, a gold sparkles + «Calculando…» or a muted «Sin estimar» when the combined state is set.
  - **«Combustible de Hoy»** has one row per `fuelSlots(todays)` entry:
    - the title is `capitalizeFirst(t("meals.<slot>"))`, with the `capitalize` class removed;
    - the subtitle is `t("mealReg.mealsCount", { count: meals })`, or «No la comí» when `skippedOnly`;
    - the kcal shows when not `skippedOnly`, followed by the gap label when set.
  - **The empty state** shows only when `itemsOf(todays).length === 0`. Its button runs `router.push("/(tabs)/nutrition")` alone: the `setTimeout`, `suggestedSlot` and `toDateKey` go.
  - **The header date** comes from `useToday()`.
- **Progreso:** only the copy changes. The counting already moved in Task 2.
- [ ] **Step 1: Implement.** **Step 2: Gates.** **Step 3: Commit.** `git commit -m "feat(home): Inicio and Progreso read registrations by the counting rules"`

### Task 15: Remove the diary; product docs

**Files:**
- Delete:
  - `app/(tabs)/nutrition/create.tsx`, `edit.tsx`;
  - `src/components/diary-slot.tsx`, `src/components/ui/fab.tsx` (and `src/components/ui/index.ts:13`);
  - the `pop` factory at `src/lib/motion.tsx:72-75` if it has no users left;
  - `src/utils/meal-slots.ts`, `src/services/ai-nutrition.ts`.
- Modify:
  - `src/services/llm.ts`: drop `completeJSONWithImage`, `MAX_IMAGE_BASE64_CHARS`, `invoke`'s image parameter, and the error kinds `"no_food"` and `"too_large"` if they are unused;
  - `src/services/meal-photos.ts`: drop `uploadMealPhoto` and its `ImageInput` import if unused, else move the `ImageInput` type here;
  - `src/utils/dates.ts`: drop `isDateKey` and `formatDayLabel`;
  - `src/hooks/use-meals.ts`: drop `todaysMeals`, `createMeal`, `addMealItem`, `getOrCreateSlotMeal`, `updateDiaryItem`, `removeDiaryItem`, `removeMealItem`, `deleteMeal` and `inflightSlotCreates` once nothing uses them;
  - `es.ts` and `en.ts`: remove the dead keys, which are `nutritionPlan.segmentDiary`, `loggedVsTarget`, `register`, `registerHint`, `trainingDay`, `restDay`, `slotHiddenToday`, `autoFromProgram`, `overridden`, `noPlanHint` and `coachNotes`, plus the `meals.*` keys except the six slot names, `proteinName`/`carbsName`/`fatName` and the picker strings, plus `home.fuelYourBody`/`logMeal` and `meals.itemCount_*` if unused, and the comment at line 151;
  - `README.md` («log sets and meals» → «register the plan's meals»);
  - `docs/COACH-NUTRITION-SPEC.md` and `docs/COACH-ADMIN-PANEL-PRD.md`: a superseded note at the top (spec «Docs and legal text»).
- [ ] **Step 1: Delete and edit.** Grep every removed name and every removed i18n key before deleting it. i18n keys are untyped, so a missed one renders the key path.
- [ ] **Step 2: Gates.** Then run:
  ```bash
  grep -rn "DiarySlot\|todaysMeals\|meals\.addFood\|segmentDiary\|suggestedSlot\|ai-nutrition" app src
  ```
  Expected: no hits.
- [ ] **Step 3: Commit.** `git commit -m "refactor(nutrition): remove the diary, its screens, strings and dead helpers"`

### Task 16: Verify on web and device; push

**Files:**
- Create, temporarily (never committed): `app/(auth)/nutrition-demo.tsx`, following `git show a47a56e:'app/(auth)/poster-test.tsx'`. It renders from a test `QueryClient` seeded with mock `qk.meals(undefined)`, `qk.nutritionPlan(undefined)` and `qk.program(undefined)`, with a `?screen=` switch.

- [ ] **Step 1: Screenshot every state** with the web harness (memory note *web-screenshot-harness*):
  - `npx expo start --web --port 8091`;
  - playwright-core on Chrome, in `colorScheme` dark and light, with `html { font-size: 14px }`.

  The screens:
  - **day:** every card state (next, pending, plan, other, skipped, estimating, failed, optional, not-for-today, «Del plan»), the Hoy card with a gap, and «N de M»;
  - the **sheet** in each of its three choices, plus a «Del plan» row;
  - **no plan**;
  - **supplements**;
  - **Inicio's** fuel card and «Combustible de Hoy»;
  - **midnight:** the harness advances `useToday`'s date key and the list resets.

  Compare against the mockups, then delete the harness file.
- [ ] **Step 2: Run the full gates and the leftover greps.**
  ```bash
  npm test
  npx tsc --noEmit
  npx expo lint
  git status --short   # the harness must not be listed
  ```
- [ ] **Step 3: Push.** Commit any fixes, then:
  ```bash
  git fetch origin && git status -sb
  git push origin main
  ```
- [ ] **Step 4: Device check on Android** (owner or implementer).
  - The local APK build needs `google-services.json`, which is missing on this PC (memory note *local-android-apk-build*), so build on the other PC or with EAS.
  - Only after Plan 1 Task 6 passes, check:
    - sizes and fonts at rem 14;
    - camera and gallery;
    - a save with a photo on mobile data: the sheet closes at once, supplement ticks still sync, and one estimate lands with the photo;
    - closing the app mid-upload loses nothing;
    - an undo during an upload brings nothing back;
    - an offline save, then reconnecting: the estimate lands after the sync;
    - the day-type override survives a restart and resets at midnight.
