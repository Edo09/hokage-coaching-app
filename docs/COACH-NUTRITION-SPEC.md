# Coach Nutrition & Supplementation Plans (PRD)

**Status:** Draft for review · **Author:** generated from `Nutrición y suplementación fase 2.pdf` gap analysis · **Date:** 2026-08-07

This spec covers representing and delivering the kind of nutrition protocol a coach hands a
client today (see the Fase 2 PDF) **exactly** inside the app: a carb-cycled protocol with
per-meal rotation options, day-type variants, macro targets, and a tiered supplement stack —
none of which the current data model can express.

It is the nutrition counterpart to `docs/COACH-PROGRAMS-SPEC.md`, and deliberately reuses that
spec's architecture wherever the shape matches. Where this document says "mirrors X", it means
*copy the existing implementation*, not *build something similar*.

Scope was locked with the following decisions:

- **Two separate assignable plans:** nutrition and supplementation each get their own template
  library, assign flow, and client surface. The PDF ships them as one document, but a coach
  swaps diets far more often than they swap supplement stacks.
- **Structured meal content:** every food is its own row — a free-text name plus the day type it
  applies to, and nothing else. No quantity, amount, or unit column. This is what lets the app
  filter a meal by day type and hand a prescribed food to the diary as a prefilled entry.
  A coach who wants to state a portion just types it into the name ("Arroz 110 g"); a structured
  quantity field would have forced that decision onto every row of every plan.
- **Macros are measured, never prescribed.** The coach types no per-food kcal/P/C/F anywhere.
  Numbers enter the system in exactly one way: the client photographs the plate and the existing
  AI estimator fills `meal_items`. The only figures a coach enters are the **plan-level macro
  targets** (the document's page-2 table), which is what the measured intake is compared
  against. A coach-typed per-food number would be a second, unverified source of truth competing
  with the measured one.
- **Authoring locus:** the Admin Web Panel (which now exists, unlike when the programs spec was
  written). The client app renders read-only, plus one write action.
- **Day-type resolution:** training vs rest is derived from the client's active program
  (`program_days.weekday`), with a manual override.
- **Client role:** view + **register a meal option into the food diary**, which is what turns the
  plan into an adherence signal the coach can see.
- **Placement:** a new Nutrición tab that **replaces the legacy Comidas tab**, carrying three
  segments — **Plan · Suplementos · Diario**. The food diary does not disappear; it becomes one
  of the three panes. Bottom-bar tab count is unchanged.

---

## 1. Gap Analysis — Sample vs. Current App

The Fase 2 PDF is a **carb-cycled protocol**. It expresses four layers the app currently has no
place for: a **plan**, **meal slots**, **rotation options** within each slot, and **per-day-type
food items** underneath those — plus a global macro target table and a separate supplement
protocol.

### What the sample contains

| Sample element | Example from the PDF |
|---|---|
| Named protocol with a phase focus | "Protocolo Nutricional Fase 2 — con ciclado de carbohidratos" |
| Meal slots in day order | Desayuno · Almuerzo · Post-entrenamiento · Cena · Merienda opcional |
| **Rotation options** per slot | "Opción 1 / 2 / 3"; "Día 1-2 / Día 3-4 / Día 5-6 / Día 7" |
| **Per-day-type content** | Almuerzo Día 1-2: `110 g arroz` **+** `5 oz (140 g) pechuga de pollo` on training days; only the chicken on rest days |
| Slot that exists on one day-type only | "POST-ENTRENAMIENTO (SOLO DÍAS DE ENTRENAMIENTO)" |
| Optional slot | "MERIENDA OPCIONAL (igual para ambos días)" |
| Slot-level note | "En días de descanso, eliminar esta comida o sustituir por 1 scoop de proteína sola con agua" |
| **Macro targets per day type** | Entreno 2100–2150 kcal · P 150–155 · C 220–225 · G ~55 · Descanso 1750–1800 kcal · C 155–160 |
| Quantities in mixed units | `110 g`, `5 oz (140 g)`, `1 scoop`, `1 cdita`, `1/2 yogur griego` — **deliberately not modelled**; see the measured-not-prescribed decision |
| **Supplement tiers** | A. Base (obligatorios) · B. Condicionales · C. Opcionales |
| Per-supplement dose / timing / purpose / caveat | Creatina: `5 g al día` · post-entreno · "mejorar fuerza" · "no requiere fase de carga" |
| **Supplement schedule table** | Desayuno → D3/K2 · Pre-entreno → Cafeína + Citrulina · Post-entreno → Whey + Creatina · … |

### What the app models today

- `meals`: `user_id`, `name`, `meal_type` (`breakfast|lunch|dinner|snack`), `date`, `assigned_by`.
  **A dated diary container — no plan, no reuse, no rotation.**
- `meal_items`: `name`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `portion`, `photo_path`.
  Good macro shape, but bound to one calendar day.
- `profiles.calorie_goal`: a single scalar. **No macro split, no day-type variation.**
- Supplements: **nothing.** No table, type, screen, or i18n key exists anywhere in either repo.
- The panel's Nutrición tab renders the client's logged diary and lets the coach edit
  `calorie_goal`. Its own empty state admits the gap: *"El editor de planes de comida llega en la
  próxima iteración."*

### The delta

1. **No plan/slot/option hierarchy.** Nutrition can only be expressed one dated meal at a time,
   so nothing is reusable and nothing spans a phase. *(biggest gap)*
2. **No day-type concept.** Carb cycling — the entire premise of the sample — cannot be stored.
3. **No macro targets.** `calorie_goal` is one number; the sample prescribes four macros × two
   day types, each as a range.
4. **No rotation options.** "Opción 1/2/3" has nowhere to live; the client would see one fixed
   meal.
5. **No supplement model at all.** Dose, timing, tier, purpose, and the schedule table are
   entirely absent.
6. **No templates.** Every client's protocol would be rebuilt by hand — the exact problem
   `20260724120000_program_templates.sql` already solved for training.
7. **Plan and diary are disconnected.** The client photo-logs meals
   (`meals/create.tsx` → `ai-nutrition.ts`), but nothing links a logged item back to a prescribed
   one, so adherence is unknowable.
8. **Coach can't see the photos.** `meal_items.photo_path` is populated by the app and typed in
   the panel (`src/types.ts:120`) but never rendered — the coach's clearest window into what a
   client actually eats is currently dark.

---

## 2. Problem Statement

Coaches deliver nutrition as a structured protocol — meal slots with rotation options, food
quantities that change between training and rest days, macro targets per day type, and a tiered
supplement stack with dosing and timing — but the app can only store a dated food diary and a
single calorie number. Today a coach flattens that protocol into a PDF the client reads outside
the app, so the client's logging is disconnected from the prescription, the coach sees no
adherence, and onboarding each new client means retyping the same protocol. Training already
escaped this (programs, templates, set logging); nutrition is still a file-delivery service.

---

## 3. Goals

1. **Faithfully represent** the sample protocol with zero loss — it round-trips into the schema
   and back to the client screen without dropping a rotation option, a day-type variant, a
   a macro target, a supplement, or a timing note. Portions are the documented exception: they
   live in the food name if the coach types them there, and are otherwise the AI's job.
2. **Reuse across clients.** A coach authors a protocol once, and assigns it to any number of
   clients in two clicks — same template semantics as programs (assignment is a **snapshot**, so
   editing the library never disturbs a client's running phase).
3. **Show the right day automatically.** The plan opens on the correct day-type given the
   client's assigned training program, with a manual override.
4. **Close the loop.** The client registers a prescribed meal into their diary in one tap, and
   the coach sees both that and their photo-logged meals in the panel — so nutrition adherence
   becomes visible for the first time.
5. **Reuse, don't fork, the coaching security model.** Plans inherit the existing single-coach
   RLS pattern (`is_coach()`, client-read-only-on-assigned) with no new auth concepts.

### Non-Goals

1. **In-app authoring for clients.** The client never edits a plan; authoring is the panel's job.
   *(mirrors the programs decision)*
2. **AI parsing of the PDF into a plan.** Auto-ingest is a separate initiative; here the data
   arrives structured. *(the model must exist first regardless)*
3. **A food database with lookup.** The coach types the food name as free text. No catalog, no
   autocomplete, no per-food macro record. *(P2-3 if repeated foods ever justify it.)*
4. **Week-by-week periodization of nutrition.** The sample cycles by *day type*, not by week. A
   phase is one steady protocol; a new phase is a new plan. *(matches the data; avoids
   over-building)*
5. **Replacing `calorie_goal`.** The profile scalar keeps driving the home screen ring for clients
   with no assigned plan. When a plan exists, its target row wins.
6. **Hydration, micronutrients, bloodwork.** Out of scope.

---

## 4. User Stories

**Client (primary persona — the athlete)**

- As a client, I want to see my coach's nutrition protocol in the app so that I stop juggling a PDF.
- As a client, I want the app to know whether today is a training or a rest day so that I eat the right amount without thinking about it.
- As a client, I want to override the day type so that a session moved to Sunday doesn't feed me the wrong plan.
- As a client, I want to see each meal's rotation options so that I can pick the one I have food for.
- As a client, I want to see the day's macro target next to what I've actually logged so that I know where I stand.
- As a client, I want to register a prescribed meal into my diary in one tap so that I don't retype what my coach already specified.
- As a client, I want to still photo-log anything I eat off-plan so that my diary is honest.
- As a client, I want my supplement stack with doses and timings so that I take the right thing at the right time.
- As a client, I want the plan to be clearly read-only so that I don't think I can edit what my coach prescribed.

**Coach (primary persona in the panel)**

- As a coach, I want to build a nutrition protocol once and assign it to many clients so that onboarding isn't retyping.
- As a coach, I want to write the plan without keying a single per-food calorie so that building one takes minutes, not an evening with a nutrition database.
- As a coach, I want to assign a supplement stack separately from the diet so that I can change one without rebuilding the other.
- As a coach, I want to promote a protocol I built for one client into a reusable template so that good work compounds.
- As a coach, I want to see my client's logged meals **with their photos** so that I can tell what they're actually eating.
- As a coach, I want to tell a plan-registered meal from a free-form one so that I can read adherence at a glance.
- As a coach, I want to export a plan to PDF so that I can still hand one over outside the app.

**Edge / empty / error states**

- As a client with no assigned plan, the tab opens straight on my diary — exactly as the Comidas tab did — and the *Mi plan* pane explains my coach hasn't assigned one yet.
- As a client with no assigned *program*, the plan still works — it defaults to rest day and I flip the toggle myself.
- As a client on a plan whose slot doesn't apply today (post-workout on a rest day), that slot is hidden or shows its substitution note, not an empty card.
- As a client offline, I can view the cached plan and queue a registered meal (consistent with the existing offline outbox).
- As a client on a database that hasn't run the migration, the tab renders empty rather than throwing.

---

## 5. Requirements

### Must-Have (P0)

**P0-1 · Nutrition plan data model**
New tables under the existing coaching model, mirroring the `programs` graph:

- `nutrition_plans` — `id`, `user_id` (client; **nullable — null means template**), `assigned_by`
  (coach), `source` (`'coach'`), `name`, `description`, `focus` (e.g. "Definición fase 2"),
  `status` (`active|completed|archived`), `start_date`, `duration_weeks` (nullable — a phase may
  be open-ended), `day_cycling` (bool — false collapses the UI to a single day type), `notes`,
  `is_template`, `template_id`, timestamps.
- `nutrition_plan_targets` — the macro target table: `id`, `plan_id`,
  `day_type` (`both|training|rest`), `kcal_min`/`kcal_max`, `protein_min_g`/`protein_max_g`,
  `carbs_min_g`/`carbs_max_g`, `fat_min_g`/`fat_max_g`, `notes`. **Unique** on `(plan_id, day_type)`.
  `both` is the single target row a plan uses when `day_cycling` is false.
- `nutrition_plan_meals` — the slots: `id`, `plan_id`, `slot_index` (1..N), `label`
  ("Post-entrenamiento"), `meal_type`
  (`breakfast|lunch|dinner|snack|pre_workout|post_workout`), `time_hint`,
  `applies_to` (`both|training|rest`), `is_optional` (bool), `notes`, `sort_order`.
- `nutrition_plan_options` — the rotation tier: `id`, `plan_meal_id`, `label`
  ("Opción 1", "Día 1-2"), `notes`, `sort_order`.
- `nutrition_plan_option_items` — the leaf: `id`, `option_id`, `name` (free text),
  `day_type` (`both|training|rest`), `sort_order`. **No quantity and no macro columns** — see
  the measured-not-prescribed decision above.

Plus one additive column on the existing diary for adherence provenance:

```sql
alter table public.meal_items add column if not exists plan_option_id uuid
  references public.nutrition_plan_options(id) on delete set null;
```

*Acceptance:*
- [ ] The Fase 2 PDF inserts into these tables with no field dropped (verified by a seed script that reproduces it).
- [ ] `meal_type` carries six values, but a diary write-back collapses `pre_workout`/`post_workout` to `snack` (the four values `meals.meal_type` allows).
- [ ] Diary rows written from a plan leave `assigned_by` **null** — the client authored them and must stay able to correct the portion they actually ate.

**P0-2 · Supplement plan data model**
A second, independently assignable plan:

- `supplement_plans` — same header shape as `nutrition_plans` (nullable `user_id`, `is_template`,
  `template_id`, `status`, `start_date`, `notes`, timestamps).
- `supplement_plan_items` — `id`, `plan_id`, `name`, `tier` (`base|conditional|optional`),
  `dose` ("5 g al día"), `timing_slot`
  (`wake|breakfast|pre_workout|intra_workout|post_workout|lunch|dinner|bedtime|any`),
  `timing_note` ("30-45 minutos antes del entrenamiento"), `purpose`, `notes`,
  `applies_to` (`both|training|rest`), `sort_order`.

*Acceptance:*
- [ ] All 10 supplements from the PDF insert across the three tiers with dose, timing, purpose, and caveat intact.
- [ ] The PDF's closing "Horario de suplementación" table renders as a `group by timing_slot` view — **no** extra table.

**P0-3 · Templates + assignment (mirrors `20260724120000_program_templates.sql`)**
- [ ] A template is a plan row with `user_id is null` and `is_template = true`; a check constraint enforces `(is_template and user_id is null) or (not is_template and user_id is not null)`.
- [ ] Assigning **deep-copies** the whole graph into a new per-client row stamped with `template_id`, so editing a template never mutates a running plan.
- [ ] A one-off client plan can be promoted to a template, back-claiming `template_id` on the source (mirrors `save_program_as_template`).
- [ ] Templates are archived, never deleted; `status` on a template means library shelf-state.
- [ ] Templates cannot leak to a client: the app fetches `user_id = me`, and templates have none.

**P0-4 · Row-Level Security (reuse the coaching model)**
- [ ] All seven new tables: coach full access via `is_coach()`; client `select` only where the parent plan's `user_id = auth.uid()`; client `insert/update/delete` blocked.
- [ ] All new tables `enable row level security` and grant to `authenticated`.
- [ ] One active plan per client per type — partial unique index + auto-archive trigger, mirroring `20260721130000_single_active_program.sql`. The index ignores templates (`user_id is not null`).
- [ ] `start_date` cannot be in the past for API writers; templates and SQL-editor seeds are exempt (mirrors `guard_program_start_date`).
- [ ] Migrations are additive and idempotent (`if not exists`, `do $$ … $$` constraint guards) — applied via the Supabase SQL editor, not `db push`.

**P0-5 · Write path is one RPC per plan type**
Mirroring `save_coach_program`, where `p_client_id IS NULL` means "save a template":
- `save_nutrition_plan(p_plan_id, p_client_id, p_header, p_targets, p_meals)`
- `assign_nutrition_plan_template(p_template_id, p_client_id, p_start_date)`
- `save_nutrition_plan_as_template(p_plan_id, p_name)`
- the same trio for supplements.

*Acceptance:*
- [ ] All are `security invoker`, guarded by `is_coach()`, `revoke all` + `grant execute to authenticated`.
- [ ] Saving an existing plan replaces the child graph atomically (delete-and-reinsert in one transaction), so a partial save is impossible.

**P0-6 · Panel authoring**
- [ ] A `/nutrition` library page with two tabs (Planes nutricionales · Suplementación), mirroring `/programs`: card grid, assign dialog, mobile preview, PDF export, archive/restore.
- [ ] A nutrition builder wizard — **Datos → Comidas y opciones → Objetivos de macros → Revisar** — mirroring `ProgramBuilder`'s row-model and sub-components.
- [ ] The macro step collects only the **plan-level targets** — four ranges per day type. No per-food macro fields exist anywhere in the builder.
- [ ] The builder previews a day type by filtering items, so the coach can see exactly what a rest day drops before saving.
- [ ] A supplement builder: a tier-grouped list with dose, timing slot, purpose, and notes.
- [ ] The client's Nutrición tab gains assigned nutrition + supplement plan cards (assign template / build / preview / PDF / save-as-template / status), replacing the "próxima iteración" empty state.

**P0-7 · Client rendering (Nutrición tab replaces Comidas)**

The legacy Comidas tab is **retired and its diary absorbed**, so nutrition lives in exactly one
place. `app/(tabs)/meals/` becomes `app/(tabs)/nutrition/`, carrying its `create` and `edit`
modals with it; the tab bar keeps five entries (Inicio · Programa · **Nutrición** · Progreso ·
Perfil) and `profile` stays where it is.

- [ ] The tab hosts a `SegmentedControl` with three panes: **Plan · Suplementos · Diario**. It opens on *Plan* when a nutrition plan is assigned, otherwise on *Diario* — so a client without a coach plan sees today's behaviour unchanged.
- [ ] *Plan* shows the active nutrition plan: target card, day-type control, meal slots.
- [ ] *Suplementos* shows the active supplement plan: tier sections plus the derived schedule table. The two plans are independently assignable, so this pane has its own empty state and its own loading/error state — a client may have one, both, or neither.
- [ ] *Diario* is the existing screen moved verbatim: date navigation, day summary, per-slot entries, the add-food FAB, and photo logging. Date nav and FAB scope to this pane only.
- [ ] Segment labels stay short enough for a 375pt viewport (`Plan` / `Suplementos` / `Diario`); the control is the existing `src/components/ui/segmented-control.tsx`, which already skews and haptics on change.
- [ ] Day type resolves from the active program's `program_days.weekday` for today's date; a segmented control overrides it. No program → default rest.
- [ ] The seven `router.push("/(tabs)/meals…")` callsites (4 in `app/(tabs)/index.tsx`, 2 in the diary screen, 1 in `src/components/progress/nutrition-card.tsx`) repoint to `/(tabs)/nutrition…`.
- [ ] i18n: `tabs.meals` → `tabs.nutrition`. The `meals.*` namespace **stays** — it is the diary's copy, and the diary still exists. Likewise the `meals`/`meal_items` tables, `qk.meals`, and the outbox entries are untouched: this is a navigation change, not a data one.
- [ ] The target card shows this day type's macro ranges.
- [ ] Each slot is a card with its rotation options; each option lists its foods filtered to the current day type.
- [ ] Slots whose `applies_to` excludes the current day type are hidden, but a slot with a substitution `note` shows it.
- [ ] Supplements render grouped by tier, plus the derived schedule table.
- [ ] Everything is visibly read-only apart from the one write action below.
- [ ] Empty state when no plan is assigned; the tab degrades to empty (not a crash) on a pre-migration database.

**P0-8 · Diary write-back via the photo flow**

Because plan foods carry no macros, registering one cannot produce a usable diary row on its
own — a row with a name and zeros would silently under-count the day. So "Registrar" **hands the
prescription to the existing add-food screen** rather than writing rows directly, and the
client's photo is what supplies the numbers.

- [ ] Tapping an option's "Registrar" opens `app/(tabs)/nutrition/create` prefilled with the food's `name`, the slot's `meal_type` (collapsed to the four diary values), today's date, and the originating `plan_option_id`. The diary's own `portion` field is left for the client — they know what they actually served themselves.
- [ ] The client photographs the plate; the existing `src/services/ai-nutrition.ts` estimator fills kcal/P/C/F exactly as it does today. Nothing about that flow changes except that some fields arrive pre-filled.
- [ ] On save, the resulting `meal_items` row carries `plan_option_id` — the adherence link.
- [ ] An option with several foods walks the client through them, or offers to add them as separate entries; the add-food screen handles one item at a time today (`meals/create.tsx:111-198`) and must not be rearchitected for this.
- [ ] The write itself is unchanged and needs **no new infrastructure**: `getOrCreateSlotMeal(date, mealType)` → `addMealItem(...)`. `meal_items` is already an `OutboxTable`, so offline queueing, optimistic cache writes, and the overlay all keep working.
- [ ] The registered items are ordinary diary rows the client can edit or delete afterwards.

**P0-9 · Coach sees what the client eats**
- [ ] The panel's Nutrición tab renders each logged item's photo thumbnail from `meal_items.photo_path` via the public `meal-photos` bucket.
- [ ] Items carrying `plan_option_id` are visually marked, so the coach can tell a followed meal from a free-form one.

### Nice-to-Have (P1)

- **P1-1 · Measured vs. target on the client's plan screen.** Show today's photo-logged intake against the active day type's target ranges, so the client sees "1,840 / 2,100–2,150 kcal" without leaving the Plan pane. The one place the two halves of this feature meet.
- **P1-2 · Adherence summary.** Per-week "meals registered vs. prescribed" on the panel's client overview, derived from `plan_option_id`.
- **P1-3 · Plan-aware home ring.** When a plan is assigned, the client's home calorie ring targets the active day type's range rather than `profiles.calorie_goal`.
- **P1-4 · Supplement check-off.** Daily tick per supplement, feeding a compliance strip — the nutrition analogue of `program_exercise_completions`.
- **P1-5 · Shopping list.** Roll the week's plan up into a grocery list by food name.

### Future Considerations (P2)

- **P2-1 · PDF/AI import.** Coach uploads a protocol PDF; AI parses it into this schema (reuse `services/llm.ts`). The Fase 2 PDF is the obvious first fixture.
- **P2-2 · Per-week nutrition periodization.** If phases start needing a weekly ramp, add `nutrition_plan_weeks` mirroring `program_weeks` — the P0 schema leaves room.
- **P2-3 · Food catalog + aliases.** Promote repeated foods into a shared catalog with macros, mirroring the `exercises` catalog and its alias layer.
- **P2-4 · Auto day-type from logged training.** Resolve day type from actual `workout_set_logs` activity rather than the prescribed weekday.

---

## 6. Success Metrics

**Leading (days–weeks)**
- **Plan view rate:** % of clients with an assigned plan who open the Nutrición tab within 3 days of assignment. *Target: 80%.*
- **Registration activation:** % of assigned clients who register ≥1 plan meal into their diary in week 1. *Target: 50%.*
- **Template reuse:** ratio of assignments to templates authored. *Target: >2.0 within a month* (below 1.5 means templates aren't earning their build).
- **Authoring time:** median minutes to build a plan in the panel. *Target: <15 min* — the number P1-1 exists to cut.

**Lagging (weeks–months)**
- **Nutrition adherence:** % of prescribed meal slots with a registered or photo-logged entry, per client-week. *Target: >60% for clients on a plan.*
- **Diary density:** logged items per client-day for clients on a plan vs. without. *(directional — the plan should raise it.)*
- **Coaching retention:** membership retention for clients on a nutrition plan vs. training only (compare cohorts after one full phase).

*Measurement:* instrument four client events (`nutrition_plan_opened`, `day_type_overridden`,
`plan_meal_registered`, `supplements_viewed`); read from the analytics connector once wired, else
from `meal_items.plan_option_id` and `created_at`.

---

## 7. Open Questions

- **[product]** Should a nutrition plan carry `duration_weeks` at all? Programs are fixed blocks; a phase is often open-ended. Schema keeps it nullable — confirm whether the client should ever see "semana 3 de 8".
- **[product]** What counts as "followed" for a meal slot — any registered option, or per-item matching? Determines what P0-9's marker and P1-2's summary can honestly claim.
- **[product]** When a plan is assigned, does it override `profiles.calorie_goal` on the home ring, or coexist? (P1-3 assumes override; P0 leaves the scalar alone.)
- **[design]** Rotation options: show all of them expanded, or collapse to the first with a "ver otras opciones" affordance? The sample's slots have 3–4 each, which is a lot of vertical space.
- ~~**[design]** Where does the supplement stack live?~~ **Resolved:** its own segment — the Nutrición tab carries three panes, **Plan · Suplementos · Diario**. The bottom bar stays at five entries and `profile` keeps its place.
- ~~**[eng]** Should `quantity` be free text or structured `amount` + `unit`?~~ **Resolved:** neither — there is no quantity column. The coach names the food; portions, if stated at all, live in that name. Revisit only if scaling a plan to a different bodyweight becomes a real requirement, which would need structured amounts *and* a food catalog (P2-3).
- **[eng]** Day-type resolution reads the active program. What should happen for a client with a program whose `weekday` is null on every day (a program not pinned to the calendar)? *(Leaning: fall back to the manual toggle.)*
- **[eng]** `supplement_plan_items.timing_slot` holds **one** value, but the source takes Omega 3 "con las comidas principales (almuerzo y cena)". The fixture files it as `lunch` with the full phrasing in `timing_note`, so the derived schedule shows it once. Options if that's not good enough: make the column `text[]`, or allow duplicate rows per supplement. *(Leaning: leave it — one duplicated line in a schedule table is a small loss against an array's cost everywhere else.)*
- **[product]** An option can hold several foods, but the add-food screen takes one item at a time. Does "Registrar" walk the client through each food, register only the one they tapped, or add the rest with blank macros for later? *(Leaning: register the tapped food; a plate photo usually covers the whole option anyway, and the client can name it as one entry.)*
- **[ops]** Same question the programs spec asked and answered: the first real plan for testing is a hand-written SQL seed reproducing the Fase 2 PDF. Recommended as the P0 acceptance fixture.

---

## 8. Timeline & Phasing

No external hard deadline. Phased so each phase is shippable and verifiable against the sample PDF:

- **Phase 1 — Schema + fixture (P0-1…P0-5).** Two migrations (nutrition, supplements) with RLS,
  templates, single-active triggers, and the six RPCs; plus a seed reproducing the Fase 2 PDF.
  *Exit:* the PDF round-trips in the DB.
- **Phase 2 — Panel authoring (P0-6, P0-9).** Services, types, the two builders, the `/nutrition`
  library, PDF export, and the rebuilt client Nutrición tab including photo thumbnails.
  *Exit:* a coach builds the Fase 2 protocol through the UI and assigns it.
- **Phase 3 — Client rendering + write-back (P0-7, P0-8).** The Nutrición tab (absorbing the
  Comidas tab), hooks, day-type resolution, and diary registration. *Exit:* a client sees the plan
  on the right day type and registers a meal that lands in their diary, online and offline —
  and every path that used to reach Comidas still lands somewhere sensible.
- **Phase 4 — Close the loop (P1-1…P1-5).** Measured-vs-target on the plan screen, adherence
  summary, plan-aware home ring, supplement check-off.

**Dependencies**
- Day-type resolution (Phase 3) reads `program_days.weekday` from the programs schema — already
  shipped, not blocking.
- The panel exists now, so unlike the programs rollout there is no seed-script-as-substitute
  period; the seed is purely an acceptance fixture.
- Phase 2's photo-thumbnail work depends on nothing new — `photo_path` and the public bucket have
  shipped since `20260705120000_meal_photos.sql`.

---

## Appendix A — Sample → Schema mapping (worked example)

**ALMUERZO · Día 1-2** — the PDF row reading
`Día 1-2 | 110 g arroz | 5 oz (140 g) pechuga de pollo`:

```
nutrition_plans:            { name: "Protocolo Nutricional Fase 2",
                              focus: "Ciclado de carbohidratos",
                              day_cycling: true, status: "active",
                              start_date: <assigned>, duration_weeks: null }

nutrition_plan_targets:     [ { day_type: "training", kcal_min: 2100, kcal_max: 2150,
                                protein_min_g: 150, protein_max_g: 155,
                                carbs_min_g: 220,  carbs_max_g: 225,
                                fat_min_g: 55,     fat_max_g: 55 },
                              { day_type: "rest",     kcal_min: 1750, kcal_max: 1800,
                                protein_min_g: 150, protein_max_g: 155,
                                carbs_min_g: 155,  carbs_max_g: 160,
                                fat_min_g: 55,     fat_max_g: 55 } ]

nutrition_plan_meals:       { slot_index: 2, label: "Almuerzo", meal_type: "lunch",
                              applies_to: "both", is_optional: false }

nutrition_plan_options:     { label: "Día 1-2", sort_order: 0 }

nutrition_plan_option_items:[ { name: "Arroz",            day_type: "training" },
                              { name: "Pechuga de pollo", day_type: "both"     } ]
```

The source's "110 g" and "5 oz (140 g)" are **not** reproduced as data. `name` is free text, so a
coach who wants them states them ("Arroz 110 g") — but nothing requires it, and the fixture seeds
the bare names.

On a **training** day the client sees both foods; on a **rest** day only the chicken — which is
exactly the carb cycling the PDF describes, and the reason `day_type` lives on the *item* rather
than the option. Neither row carries macros: what those two foods actually cost is whatever the
client's photo of the finished plate estimates.

**POST-ENTRENAMIENTO** demonstrates slot-level gating:

```
nutrition_plan_meals: { slot_index: 3, label: "Post-entrenamiento",
                        meal_type: "post_workout", applies_to: "training",
                        notes: "En días de descanso, eliminar esta comida o sustituir
                                por 1 scoop de proteína sola con agua." }
```

The slot is hidden on rest days, but its `notes` surface as the substitution hint. On write-back
its `post_workout` type collapses to `snack`, the nearest of the four values `meals.meal_type`
permits.

**MERIENDA OPCIONAL** sets `is_optional: true`, `applies_to: "both"` — rendered with a lighter
treatment so the client reads it as a choice, not a requirement.

## Appendix B — Supplement mapping

`2. Creatina Monohidrato · Dosis: 5 g al día · Momento: post-entreno · Objetivo: mejorar fuerza…
· Nota: no requiere fase de carga`:

```
supplement_plans:      { name: "Suplementación Fase 2", status: "active" }
supplement_plan_items: { name: "Creatina Monohidrato", tier: "base",
                         dose: "5 g al día",
                         timing_slot: "post_workout",
                         timing_note: "Cualquier horario fijo (preferible post-entreno
                                       o con alguna comida con carbohidratos)",
                         purpose: "Mejorar fuerza, rendimiento en series cortas y
                                   volumen muscular",
                         notes: "No requiere fase de carga; mantener dosis diaria constante",
                         applies_to: "both", sort_order: 1 }
```

The PDF's closing schedule table is not stored — it is
`select timing_slot, string_agg(name) … group by timing_slot` over these rows, ordered by the
`timing_slot` enum's natural day order. Cafeína and Citrulina (`timing_slot: 'pre_workout'`,
`applies_to: 'training'`) therefore collapse into one "Pre-entreno (30-45 min)" line for free,
and drop off entirely on a rest day.
