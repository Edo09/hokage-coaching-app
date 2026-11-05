# Meal registration · Plan 3 of 3: the coach panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach's panel shows registrations correctly in «Lo que ha comido», «Días con comidas» and the Dashboard alert:
- «Calculando…», «Sin estimar» and «No comió»;
- totals that leave out missing numbers;
- «N comidas» counts the meals eaten;
- «del plan» survives a replaced option;
- empty containers count nowhere.

It also gets the new «Así lo ve el cliente» preview, the wording and privacy text the design asks for.

**Architecture:**
- **Shared rules:** pure helpers in `src/lib/mealRegistrations.ts` hold the counting rules (the same rules as the app's `src/utils/meal-counting.ts`, ported by hand because the repos share no code).
- **Day row:** `DayRow` moves to its own component file, so a temporary harness can render it.
- **Counters:** two queries learn to skip empty containers.
- **Preview:** `MobileNutritionPreview` is rebuilt to the Dojo Poster look, with its own small preview model.

**Tech Stack:** Vite + React + TypeScript (strict), Tailwind v3, lucide-react, react-query, Supabase JS. There is no test runner: the gates are `npm run build` (which runs `tsc --noEmit` and `vite build`) and `npm run lint`, plus a temporary harness viewed in the browser.

**Spec:** `docs/superpowers/specs/2026-11-05-nutrition-meal-registration-design.md` («Decisions» 5, «Counting», «Coach panel», «Docs and legal text», Calls 10, 17–19 and 25), with the mockups next to it. It depends on Plan 1's column names. It must also work before the migration, when the new columns are absent.

**Repo:** `C:/Users/Signos/Documents/edwin/hokage-web-panel`. Run `git fetch` first; the owner also pushes from another PC.

## Global Constraints

- **Columns** (Plan 1): `meal_items.kind` (`plan|other|skipped`), `estimate_status` (`pending|done|failed`), `original_text`, `plan_meal_id`, `estimate_version`, `estimate_attempts`, `estimate_next_at`. In the panel types they are all optional.
- **Old diary row = `kind == null`** (loose equality). Never tell rows apart by `estimate_status`.
- **Counting** (spec): an old diary row or a `done` registration counts with its numbers. `pending`/`failed` add nothing and are flagged. «No la comí» adds 0 and is not food. Empty containers count nowhere.
- **The panel is Spanish only.**
- **Pure non-component helpers** go in `src/lib/*.ts`, because exporting them from a `.tsx` is an ESLint error (`react-refresh/only-export-components`).
- **Leftover imports** fail lint, not tsc, so run both gates.
- **Pills** follow the panel's own conventions: «del plan» is `rounded-full bg-secondary/15 px-1.5 text-[11px] font-semibold text-secondary`; the muted pill is `rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground`.
- **Git:** commit to `main` and never branch. **Ask the owner before every push** (panel CLAUDE.md). A change to `CLAUDE.md` also changes `AGENTS.md` in the same commit.

## Review Focus

1. **A client with only old diary rows.** «Lo que ha comido» looks exactly as before: counts, kcal, «del plan» from `plan_option_id`. Pinned by harness day «legacy» (Task 6).
2. **A day whose containers are all empty** (undone meals). There is no day row; it doesn't count in «Días con comidas» and doesn't clear the 4-day alert. Pinned by harness day «vacío» (Task 6) and the query change (Task 3).
3. **A day with only «No la comí».** The row reads «0 comidas» and 0 kcal, and the items show «No comió». Pinned by harness day «saltado» (Task 6).
4. **A day with one pending and one failed row.** It reads «2 sin estimar», and the totals leave both out. Pinned by harness day «faltan» (Task 6).
5. **Narrow widths.** «Calculando…» and «Sin estimar» span the four numeric columns without breaking `ITEM_GRID`. Pinned by the harness at 1280 px and 600 px (Task 6).

---

### Task 1: Types and pure counting helpers

**Files:**
- Modify: `src/types.ts:113-128` (`MealItem` gains the optional fields; fix the stale comments at 373-376 and 385-386)
- Create: `src/lib/mealRegistrations.ts`

**Interfaces:**
- Produces:
  ```ts
  export type EstimateGap = 'pending' | 'failed';
  export function isOldDiaryRow(i: MealItem): boolean;          // i.kind == null
  export function isEaten(i: MealItem): boolean;                // kind plan|other, or old diary row
  export function countsTowardTotals(i: MealItem): boolean;     // old diary row, or estimate_status === 'done'
  export function missingEstimate(i: MealItem): EstimateGap | null;
  export function isPlanRegistration(i: MealItem): boolean;     // kind === 'plan', or (kind == null && plan_option_id != null)
  export function nonEmptyMeals<T extends { meal_items: unknown[] }>(meals: T[]): T[];
  export type Totals = { cal: number; p: number; c: number; f: number };
  export function mealTotals(m: MealWithItems): Totals;        // countsTowardTotals items only
  export type DayTotals = Totals & { photos: number; planned: number; eaten: number; missing: number };
  export function dayTotals(meals: MealWithItems[]): DayTotals;
  // eaten = kind plan|other rows + one per container holding old diary rows; missing = rows with a missing estimate
  ```
- [ ] **Step 1: Implement** the types and helpers. The types carry optional fields: `kind?: 'plan' | 'other' | 'skipped' | null`, `estimate_status?: 'pending' | 'done' | 'failed' | null`, and so on.
- [ ] **Step 2: Gates:** `npm run build`, `npm run lint`. Both clean.
- [ ] **Step 3: Commit.** `git commit -m "feat(meals): registration fields and counting helpers"`

### Task 2: «Lo que ha comido» (day row and section)

**Files:**
- Create: `src/pages/client/MealDayRow.tsx` (move `DayRow` and `Macro` from `NutritionTab.tsx:829-1005`, plus `ITEM_GRID` from `:75`)
- Modify: `src/pages/client/NutritionTab.tsx`:
  - grouping at 101-110;
  - the open-day seed at 113-118;
  - the empty state at 144;
  - the tip at 142;
  - imports that only the log used.

**Interfaces:**
- Consumes: Task 1.
- Produces: `export function MealDayRow(props: { date: string; meals: MealWithItems[]; goal: number | null; open: boolean; onToggle: () => void }): JSX.Element;`
- **Rules:**
  - **Grouping:** group `nonEmptyMeals(client.meals)`. The empty state and the seed use the same filtered list.
  - **Header:**
    - «{eaten} comida/comidas», using `plural(n, 'comida', 'comidas')` from `lib/utils.ts:143`;
    - the photo count as today;
    - the «del plan» count from `isPlanRegistration`;
    - kcal from `dayTotals(...).cal`, followed by `<span className="text-faint"> · {missing} sin estimar</span>` when `missing > 0`;
    - the bar and the macros from the same totals.
  - **Expanded:**
    - non-empty containers only;
    - container totals from `mealTotals`;
    - items:
      - «No la comí»: the name, the muted pill «No comió», and a single `col-span-4` empty number cell;
      - pending: one `col-span-4 text-right text-[11px] text-faint` cell «Calculando…»;
      - failed: the same cell with `text-warning`, «Sin estimar»;
      - otherwise the four numbers as today;
    - the «del plan» pill from `isPlanRegistration`.
  - **The tip** becomes «Las comidas del plan que registra en la app: la opción que eligió, otra comida o que no la comió, con foto opcional. La IA estima las calorías y los macros.»
- [ ] **Step 1: Move `DayRow` into `MealDayRow.tsx`**, unchanged. Gates: build and lint clean, so the move alone changes nothing.
- [ ] **Step 2: Apply the rules above.**
- [ ] **Step 3: Gates:** `npm run build`, `npm run lint`.
- [ ] **Step 4: Commit.** `git commit -m "feat(meals): Lo que ha comido shows registration states and skips empty containers"`

### Task 3: Resumen and Dashboard counters skip empty containers

**Files:**
- Modify: `src/pages/client/ClientPulse.tsx:295`
- Modify: `src/services/insights.ts:88`

- [ ] **Step 1: Make the edits.**
  - `mealDays` counts the dates of `nonEmptyMeals(client.meals)` inside `window28`.
  - The roster query selects `'user_id, date, meal_items!inner(id)'`, so only containers with rows come back. `RosterActivity.meals` keeps its `{ user_id; date }` shape; the extra array is ignored, and `lib/insights.ts:60-63` stays as it is.
- [ ] **Step 2: Gates:** `npm run build`, `npm run lint`.
- [ ] **Step 3: Commit.** `git commit -m "fix(meals): Días con comidas and the 4-day alert ignore empty containers"`

### Task 4: «Así lo ve el cliente» in the new look

**Files:**
- Modify: `src/components/nutrition/previewModel.ts` (add the preview rules)
- Rewrite: `src/components/nutrition/MobileNutritionPreview.tsx`, keeping its props and every call site: `NutritionPlanBuilder.tsx:718, 763`, `SupplementPlanBuilder.tsx:373, 387`, `NutritionTab.tsx:481, 662`, `pages/Nutrition.tsx:281, 462`

**Interfaces:**
- Produces (in `previewModel.ts`):
  ```ts
  export type PreviewTodayMeal = { meal: PreviewMeal; applies: boolean; noteOnly: boolean; options: PreviewOption[] };
  export function previewTodayMeals(plan: PreviewNutritionPlan, day: 'training' | 'rest'): PreviewTodayMeal[];
  export function previewTotalMeals(meals: PreviewTodayMeal[]): number;     // required meals that apply
  export function previewNextIndex(meals: PreviewTodayMeal[]): number | null; // first required meal that applies
  ```
- **What it renders.** It is a static client view with nothing registered, following the app's rules (spec «The tab»):
  - **Palette:** the app's dark tokens, replacing the old `APP` constants: canvas `#0f172a`, surface `#1e293b`, border `#334155`, red `#ef4444`, red text `#f87171`, gold `#fbbf24`, macros `#3b82f6`, `#f59e0b`, `#fb7185`, text `#f8fafc`, `#cbd5e1`, `#94a3b8`, `#64748b`.
  - **Fonts:** Anton for titles and numbers (the panel's Anton class; check `tailwind.config` for its name).
  - **Segments:** PLAN · SUPLEMENTOS, skewed, with no «Diario» segment.
  - **Hoy card:** «HOY · ✦ estimado con IA» and «0 / {target} kcal» (thousands grouped with `toLocaleString('en-US')`), plus the three macros against their targets.
  - **Day type:** a «⚡ Día de entreno» / «Día de descanso» chip when cycling; it toggles the preview's day. Next to it, «0 de {M} comidas».
  - **Meal cards in plan order:**
    - the next meal open, with «Siguiente», option tabs (only with 2 or more options), the foods, the option notes, and a «Registrar {comida}» pseudo-button;
    - the other meals pending, with a dashed box, «Opcional» on optional ones, and «No aplica hoy» note rows;
    - clicking a pending card opens it.
  - **«Notas del coach».**
  - **Supplements pane:** the same content, restyled.
  - **No** «Registrar en mi diario» pills.
  - **Header comment:** update it, removing «measured from the client's photo».
- [ ] **Step 1: Implement** the model functions, then the component.
- [ ] **Step 2: Gates:** `npm run build`, `npm run lint`.
- [ ] **Step 3: Commit.** `git commit -m "feat(nutrition): client preview matches the new Nutrición tab"`

### Task 5: Wording, privacy policy, docs

**Files:**
- Modify: `src/components/nutrition/AiNutritionDialog.tsx:108-112` (drop `replaceNote`; the shared `AiPromptDialog` keeps «Reemplaza todo el borrador actual.»)
- Modify: `src/components/nutrition/NutritionPlanBuilder.tsx:639` (tip) and `:146-150` (comment)
- Modify these comments: `src/components/nutrition/aiModel.ts:9, 83, 242`, `builderModel.ts:84`, `src/services/nutritionPlans.ts:145`, `src/lib/mealPhotos.ts:4`
- Modify: `public/privacidad.html:57`
- Modify: `README.md:61`
- Modify: `docs/COACH-ADMIN-PANEL-PRD.md` (a superseded note at the top) and `docs/ADMIN_WEB_DB_CONNECTION.md`, at the lines that describe the diary or seeded meals (about 133-134, 167-170, 241-257, 405)

- [ ] **Step 1: Write the exact text.**
  - **Builder tip:** «Cada comida tiene una o más opciones y el cliente elige una. Solo escribes los alimentos: las calorías y los macros los estima la IA cuando el cliente registra lo que comió.»
  - **Privacy policy line 57:** «**Proveedores de inteligencia artificial** (Groq y Google Gemini): cada comida que registras como comida se les envía automáticamente al guardarla (los alimentos de la opción o lo que escribiste, y la foto si añadiste una) para estimar sus calorías y macros; la IA también corrige la ortografía de lo que escribes. «No la comí» no envía nada. Para el resumen semanal se envían cifras agregadas de tu progreso (por ejemplo, sesiones, volumen, peso y objetivo), sin tu nombre ni tu correo.» Leave the `[FECHA]` placeholder at line 27 and tell the owner it is still unfilled.
  - **README:** «Nutrición (nutrition + supplement plans, calorie goal, the plan's meals the client registers, with photos)».
  - **Docs:** the meals are the client's registrations of the plan's meals; coach-seeded meals were never built and don't show in the app; a superseded note for the Diario and diary write-back stories.
- [ ] **Step 2: Gates:** `npm run build`, `npm run lint`. Then run:
  ```bash
  grep -rni "diario" src
  ```
  Expected: no user-visible hits.
- [ ] **Step 3: Commit.** `git commit -m "docs: panel wording and privacy policy for meal registrations"`

### Task 6: Verify with a temporary harness; ask before pushing

**Files:**
- Create, temporarily (never committed): `src/pages/DevMealsHarness.tsx`, and a route `/dev/meals` in `src/App.tsx` outside `RequireAuth`. It renders `MealDayRow` for mock days, each open:
  - «legacy»: old diary rows with `plan_option_id`;
  - «registros»: plan done with a photo, plan whose option is gone, otra cosa done;
  - «saltado»: only skipped;
  - «faltan»: one pending, one failed, one done;
  - «vacío»: a single empty container, which must render nothing.

  Below them it renders `MobileNutritionPreview` for a cycling mock plan.
- [ ] **Step 1: Look at it.** Start the panel's `panel` launch config (port 5181), open `/dev/meals`, and check every Review Focus line at 1280 px and at 600 px. Take screenshots for the owner.
- [ ] **Step 2: Clean up.** Delete the harness and its route. Then run `npm run build` and `npm run lint`, and check that `git status --short` doesn't list the harness.
- [ ] **Step 3: Commit any fixes**, then ask the owner before pushing:
  > «Panel changes for meal registration are committed on main (N commits). Push to origin/main now? Pushing deploys the panel.»

  Push only on a yes:
  ```bash
  git fetch origin && git status -sb
  git push origin main
  ```
