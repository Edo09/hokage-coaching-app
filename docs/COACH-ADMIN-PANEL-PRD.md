# Coach Web Admin Panel — Product Requirements Document

**Project:** Hokage Coaching — Coach Admin Panel
**Status:** Draft for review · **Date:** 2026-07-17
**Companion docs:** [`ADMIN_WEB_DB_CONNECTION.md`](./ADMIN_WEB_DB_CONNECTION.md) (data-layer source of truth), [`COACH-PROGRAMS-SPEC.md`](./COACH-PROGRAMS-SPEC.md) (the Programs feature this panel authors), [`PRD_Plataforma_Fitness.md`](./PRD_Plataforma_Fitness.md) (business vision).

---

## 0. Resumen ejecutivo (Español)

El **Panel de Administración del Coach** es la aplicación web que le da al entrenador el "centro de mando" que hoy no existe: actualmente los programas y datos de prueba se cargan a mano con SQL. La app móvil del cliente ya está completa (entrenamiento, nutrición, progreso, y la nueva función de **Programas** multi-semana con registro de series real). Falta el lado del coach.

Con este panel, el coach podrá **asignar y dar seguimiento** a cada cliente:

- **Asignar** — crear cuentas de clientes; construir **Programas periodizados de varias semanas** (días, ejercicios con series×rango de reps, RIR, %1RM, tempo, unilateral, y la tabla semanal de periodización con descarga); gestionar el **catálogo de ejercicios** compartido (nombre, video, grupo muscular); asignar rutinas simples; fijar la **meta de calorías** y comidas; y administrar **membresías** (estado, precio, vencimiento).
- **Rastrear** — ver el progreso **real** del cliente: series registradas → volumen y récords (1RM estimado), cumplimiento por semana del programa, historial de entrenamientos, y medidas corporales (peso, grasa, cintura, etc.).

**Modelo de seguridad:** un solo coach (dueño del gym). El panel es una SPA de navegador que habla directo con Supabase; toda la autorización la impone RLS en la base de datos vía `is_coach()`. La llave de servicio nunca vive en el navegador.

**Fuera de alcance (futuro):** procesamiento de pagos dentro de la app, muro de avisos/mentalidad, y soporte multi-coach.

**Bloqueadores conocidos antes de construir:** (1) el coach **no puede leer** `body_measurements` hoy — falta una política RLS; (2) el candado de fecha de inicio de programa también bloquea al coach; (3) crear cuentas requiere desplegar la Edge Function `create-client`. Ver §7.

> The remainder of this document is in English to stay aligned with the technical companion docs.

---

## 1. Overview & Goals

The Coach Admin Panel is a browser app that lets the single coach (gym owner) run the training business: onboard clients, author and assign training/nutrition, and review each client's real progress — all against the **same Supabase project** the mobile app uses, with **Row-Level Security as the authorization boundary**.

**Goals**

1. **One place to author everything a coach assigns** — clients, the multi-week Programs feature, the exercise catalog, simple routines, nutrition, and memberships — with no hand-written SQL.
2. **WYSIWYG program authoring** — what the coach builds matches exactly what the client sees on mobile (same prescription semantics as `src/components/program/*`).
3. **Real progress tracking** — surface logged sets → volume/PRs, program compliance, workout history, and body measurements per client.
4. **Safe by construction** — reuse the existing RLS model; the panel ships only the anon key; the service-role key stays server-side.

**Non-goals (this version)**

- In-app **payment processing** (memberships are status records the coach sets manually; no gateway). *Future.*
- **Announcements / mentality wall** and motivational content publishing. *Future — needs new tables.*
- **Multi-coach / multi-tenant.** The model is deliberately single-coach (`is_coach()`), so client access needs no `coach_clients` link table. *Future.*
- **Rebuilding the mobile app.** This panel is the coach counterpart only.

---

## 2. Personas & Jobs-To-Be-Done

**The Coach (the only admin user)** — owns the gym, trains N clients, needs a desktop command center.

Top jobs:

1. *Onboard a client* — create their login, see their intake profile.
2. *Build & assign a program* — a periodized multi-week block, then attach it to a client.
3. *Maintain the exercise library* — add movements + demo videos once, reuse across clients.
4. *Set nutrition* — daily calorie target, optionally seed assigned meals.
5. *Manage membership* — plan, price, status, renewal date.
6. *Review real progress* — did they train? how much volume? new PRs? weight trend?

**The Client** is **not** a panel user — they use the mobile app. Listed here only because the panel's writes surface in their app (assigned plans appear under "De tu coach", read-only).

---

## 3. Architecture & Security (summary)

Full mechanics live in [`ADMIN_WEB_DB_CONNECTION.md`](./ADMIN_WEB_DB_CONNECTION.md); this PRD only summarizes and **extends** it with the Programs tables.

- **Browser-only React SPA (Vite)** + `@supabase/supabase-js`, same project URL + **anon key** as mobile (`VITE_` env). No custom backend **except** the `create-client` Edge Function (account creation needs the service-role key, which never touches the SPA).
- **RLS is the boundary.** The coach's power comes from `profiles.role = 'coach'` → `is_coach()` → additive permissive policies granting cross-client CRUD. Clients stay self-scoped.
- **Route guard:** `assertCoach()` after login; sign out anyone who isn't the coach. Belt-and-suspenders on top of RLS.
- **Role escalation is blocked** by the `guard_role_change` trigger; roles are set only via the Supabase dashboard / service role.

---

## 4. Entity Inventory — what the coach can ASSIGN / MANAGE

Every property below is grounded in the applied migrations (see §10). Types are Postgres; "→" denotes a foreign key.

### 4.1 Clients — `profiles` (role = `user`)

Created via the `create-client` Edge Function; the intake is filled by the client during mobile onboarding, but the coach can read/edit all of it.

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | = `auth.users.id` |
| `display_name` | text | client name |
| `avatar_url` | text | |
| `age` | int | |
| `sex` | text | `male` \| `female` \| `other` |
| `height_cm` | numeric | |
| `weight_kg` | numeric | current bodyweight (also mirrored into `body_measurements`) |
| `activity_level` | text | `sedentary` \| `active` \| `very_active` |
| `profession_type` | text | `desk` \| `physical` |
| `days_per_week` | int | training days target |
| `session_duration` | int | minutes |
| `available_days` | text[] | `["Mon".."Sun"]` |
| `calorie_goal` | int | **coach-settable** daily target |
| `goal` | text | `lose_weight` \| `gain_muscle` \| `maintain` |
| `onboarding_completed` | bool | |
| `role` | text | `user` \| `coach` — **read-only via API** (trigger-guarded) |

### 4.2 Exercise catalog — `exercises` (+ `bodyparts`)

Shared library. Coach-writable (`is_coach()`), readable by everyone. Editing a row propagates live to every assignment (routines/programs store only `exercise_id`).

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `name` | text | **case-insensitively unique** (`unique(lower(name))`) |
| `video_url` | text | demo video played in-app |
| `body_part_id` | uuid → `bodyparts.id` | |
| `created_at` / `updated_at` | timestamptz | |

`bodyparts` categories: `back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs, waist`. Delete of an in-use exercise fails with FK error `23503` — the panel must catch it and tell the coach to reassign first.

### 4.3 Programs (multi-week block) — `programs` *(NEW — the marquee feature)*

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `user_id` | uuid → `profiles.id` | the **client** |
| `assigned_by` | uuid → `profiles.id` | the **coach** |
| `source` | text | `'coach'` (check-constrained) |
| `name` | text | e.g. "Hipertrofia — Glúteos y Piernas" |
| `description` | text | |
| `focus` | text | e.g. "Glúteos y Piernas" |
| `duration_weeks` | int | 1–52 |
| `start_date` | date | **cannot be in the past for API writers** — see GAP 2 |
| `status` | text | `active` \| `completed` \| `archived` |
| `progression_rule` | text | e.g. double-progression description |
| `tempo_default` | text | e.g. "Excéntrica 2-3s…" |
| `notes` | text | e.g. "Cardio 20 min postworkout" |

### 4.4 Program days — `program_days`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `program_id` | uuid → `programs.id` | |
| `day_index` | int | 1..N, unique per program |
| `label` | text | e.g. "Pecho + Bíceps" |
| `weekday` | text | nullable `monday..sunday` |
| `sort_order` | int | |

### 4.5 Program exercises (the base prescription) — `program_exercises`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `program_day_id` | uuid → `program_days.id` | |
| `exercise_id` | uuid → `exercises.id` | nullable |
| `custom_name` | text | fallback when not in catalog; **one of `exercise_id`/`custom_name` required** |
| `sets` | int | 1–20 |
| `rep_min` / `rep_max` | int | rep **range**; `rep_min ≤ rep_max` |
| `is_unilateral` | bool | reps are per-side |
| `rir_min` / `rir_max` | int | 0–10; `rir_min ≤ rir_max` |
| `load_pct_1rm` | int | 1–100 |
| `load_qualitative` | text | `light` \| `moderate` \| `heavy` |
| `tempo` | text | |
| `rest_seconds` | int | 0–900 |
| `notes` | text | |
| `sort_order` | int | |

> **Display precedence** (mirror the mobile app): the row shows its own `%1RM` when set, else its qualitative tag; the **week's** global RIR/%load is shown once in the week summary, not per row. See `effectivePrescription` in `src/utils/program.ts`.

### 4.6 Program weeks (global periodization table) — `program_weeks`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `program_id` | uuid → `programs.id` | |
| `week_number` | int | 1..duration, unique per program |
| `label` | text | e.g. "Base técnica", "Descarga" |
| `rir_min` / `rir_max` | int | |
| `load_pct_min` / `load_pct_max` | int | |
| `is_deload` | bool | |
| `sets_override` | int | deload drops set count globally |
| `notes` | text | |

### 4.7 Flat routines (legacy/simple path) — `routines` + `routine_exercises`

Still supported for quick, non-periodized assignments. `routines`: `name`, `description`, `day_of_week`, `assigned_by`, `source` (`user`/`ai`/`coach`). `routine_exercises`: `exercise_id`, `sets`, single `reps`, `weight_kg`, `rest_seconds`, `sort_order`, `notes`. Assigned when `assigned_by = coach` → read-only for the client.

### 4.8 Nutrition — `profiles.calorie_goal` + `meals` + `meal_items`

- **Calorie goal:** `profiles.calorie_goal` (§4.1).
- `meals`: `name`, `meal_type` (`breakfast`/`lunch`/`dinner`/`snack`), `date`, `assigned_by`.
- `meal_items`: `name`, `calories`, `protein_g`, `carbs_g`, `fat_g`, `portion`, `photo_path`.
- Assigned meals (`assigned_by = coach`) appear read-only in the client's diary.

### 4.9 Memberships — `memberships`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid (PK) | |
| `client_id` | uuid → `profiles.id` | |
| `coach_id` | uuid → `profiles.id` | |
| `plan_name` | text | |
| `status` | text | `active` \| `expired` \| `paused` \| `cancelled` |
| `price` | numeric | |
| `currency` | text | default `USD` |
| `started_at` / `expires_at` | date | mobile shows a renewal reminder near/after expiry |
| `notes` | text | |

### 4.10 Coach profile — `profiles` (role = `coach`)

`display_name`, `avatar_url`, `whatsapp` (international digits only, `^\d{8,15}$` — powers the client's `wa.me` button).

---

## 5. Entity Inventory — what the coach can TRACK

Read surfaces per client. Reuse the app's existing math (`src/utils/progress.ts`) rather than reinventing formulas.

### 5.1 Workout sessions — `workout_logs`
`date`, `duration_minutes`, `completed_exercises: text[]` (names), `notes`, `routine_name`, `routine_id`. Session-level "did they train" + streak/compliance inputs.

### 5.2 Logged sets — `workout_set_logs` *(NEW)*
Per prescribed set: `program_exercise_id`, `week_number`, `date`, `set_index`, `weight_kg`, `reps`, `rir`. This is the **real training data**:
- **Volume** = Σ weight·reps (unilateral ×2) → `realVolume`.
- **8-week volume series** → `realVolumeSeries8w`.
- **PRs / estimated 1RM** (Epley) → `personalRecords`, `e1rm`.

Join through `program_exercises → exercises(name)` for exercise labels.

### 5.3 Program completion — `program_exercise_completions` *(NEW)*
One row = "client finished this exercise in this week" (`program_exercise_id`, `week_number`, `completed_at`). Powers **program adherence** (per-day N/N, per-week completion).

### 5.4 Body measurements — `body_measurements`
`measured_on`, `weight_kg`, `body_fat_pct`, `waist_cm`, `chest_cm`, `arm_cm`, `thigh_cm`. Weight trend + composition over time. **Blocked by GAP 1** (no coach-read policy yet).

### 5.5 Derived progress
Compliance, weekly streak, muscle distribution/alert, nutrition adherence — all computed client-side in `src/utils/progress.ts`. The panel can re-implement from the raw tables above or port the util.

---

## 6. Screens & Flows

Information architecture, with acceptance criteria (AC) per screen.

**6.1 Login + coach guard**
- AC: valid coach → dashboard; any `user` account → signed out with "not authorized"; session persists across reload.

**6.2 Clients list**
- Table of `role='user'` profiles (name, goal, calorie goal, onboarding status, membership status), searchable + paginated (`.range`).
- AC: lists every client; "New client" opens the create-client flow (§6.9); row → Client detail.

**6.3 Client detail (hub)**
- Tabs: **Profile/intake**, **Program**, **Routines**, **Nutrition**, **Tracking**, **Membership**.
- AC: shows the client's assigned program (if any), their intake, and quick links to each authoring flow.

**6.4 Program builder** *(marquee)*
- Create program (name, focus, duration_weeks, start_date, status, progression_rule, tempo_default, notes) → add **days** (label, weekday, order) → add **exercises** to each day from the catalog picker with the full prescription fields (§4.5) → define the **weekly periodization table** (§4.6, one row per week, deload flag + set override) → **assign** (sets `user_id`, `assigned_by`, `source='coach'`).
- **WYSIWYG:** render a live preview matching the mobile `ProgramView` (week navigator + day cards + effective-prescription rules).
- AC: a built program round-trips and appears in the client's mobile "De tu coach" Coach segment, correct week auto-selected, prescriptions identical; edits by the coach update it live.
- AC: exercises resolve to catalog entries; a movement not in the catalog is either added to the catalog or stored as `custom_name` (flagged).

**6.5 Exercise catalog manager**
- CRUD over `exercises` with `body_part` picker + `video_url`.
- AC: duplicate name (case-insensitive) is prevented with a clear message; deleting an in-use exercise surfaces the `23503` "still assigned" message instead of a raw error; edits propagate to all assignments.

**6.6 Nutrition**
- Set `calorie_goal`; optionally seed assigned meals + items.
- AC: calorie goal reflects on the client's home; assigned meals show read-only in their diary.

**6.7 Membership editor**
- Upsert `memberships` (plan, status, price, currency, dates, notes).
- AC: status + expiry reflect on the client's mobile Profile with the renewal reminder.

**6.8 Coach settings**
- Edit coach `display_name`, `avatar_url`, `whatsapp` (validated digits).
- AC: WhatsApp powers the client's contact button.

**6.9 Create client** (Edge Function)
- Calls `create-client`; the function verifies caller is coach, creates the auth user (service role), triggers a set-password email.
- AC: new `role='user'` account appears in the clients list; client receives an invite/reset email.

**6.10 Business dashboard** (light, read-only)
- Active memberships, expiring-soon list, recent client activity (workout logs). Optional realtime subscription.
- AC: counts match the DB; expiring-soon uses `expires_at`.

---

## 7. RLS Coverage & Gaps to Resolve Before Build

Grounded in the migrations (§10). **The panel must not weaken any existing policy.**

**Already granted — coach full CRUD** (via `is_coach()` permissive policies): `profiles`, `routines`, `routine_exercises`, `meals`, `meal_items`, `workout_logs`, `memberships`, `exercises` (write), and **all `programs*` tables** — `programs`, `program_days`, `program_exercises`, `program_weeks` ("coach all …" policies in `20260717120000_coach_programs.sql`).

**Already granted — coach read-only** (client owns the actuals; correct): `workout_set_logs` ("coach reads all set logs") and `program_exercise_completions` ("coach reads all completions").

**Gaps:**

- **GAP 1 — `body_measurements` had no coach-read policy (FIX WRITTEN).** `20260710120000_body_measurements.sql` defined only self-scoped policies, so the coach could not read client measurements. **Fix migration:** `supabase/migrations/20260717140000_body_measurements_coach_read.sql` adds a `coach reads all measurements` SELECT policy (`using (public.is_coach())`), mirroring the set-logs/completions pattern. **Apply it in the Supabase SQL editor before the tracking view ships.**
- **GAP 2 — program `start_date` past-date guard also blocks the coach.** `guard_program_start_date` rejects `start_date < current_date` for **any** authenticated writer (`auth.uid()` non-null) except the service role. The coach authors via the panel with their JWT → they **cannot backdate** a block. *Decision needed:* (a) keep it — assigned programs always start today or later; or (b) exempt coaches (`OR public.is_coach()`) so a coach can set a retroactive start. Recommend (a) unless backdating is a real need.
- **GAP 3 — no program template / duplicate.** *Resolved:* program templates (`supabase/migrations/20260724120000_program_templates.sql`), which the panel assigns to clients.
- **GAP 4 — `create-client` Edge Function.** *Resolved:* deployed and in use. Client accounts are created only through it, and forgotten passwords are reset through `reset-client-password` (`ADMIN_WEB_DB_CONNECTION.md §6`).

---

## 8. Phasing

- **P0 — Author + track core.** Coach auth + guard; clients list & detail; **program builder** (+ WYSIWYG preview); exercise catalog manager; tracking **read** views (logged-set volume/PRs, program compliance, workout history). Requires GAP 1 migration.
- **P1 — Operate the business.** Nutrition (calorie goal + assigned meals); membership editor; coach settings; light business dashboard; `create-client` deployment (GAP 4).
- **P2 — Scale & delight.** Program templates/duplication (GAP 3); realtime activity; announcements/mentality wall + payments (new tables; currently out of scope).

---

## 9. Open Questions

- **GAP 2 decision:** allow coaches to backdate `start_date`, or keep "starts today+"? (blocking for the builder's date field)
- **Measurements policy (GAP 1):** confirm the coach may read *all* clients' measurements (single-coach model implies yes) before writing the migration.
- **Derived metrics:** re-implement `utils/progress.ts` math in the panel, or extract it into a shared package both app + panel import?
- **Data retention / pagination:** default windows for tracking queries (the app uses 60 days for set logs / measurements) — same in the panel, or configurable?
- **Business layer timing:** when do payments + announcements move from "future" into scope (they need new tables + policies)?

---

## 10. References

- Data layer & security mechanics: [`ADMIN_WEB_DB_CONNECTION.md`](./ADMIN_WEB_DB_CONNECTION.md)
- Programs feature spec: [`COACH-PROGRAMS-SPEC.md`](./COACH-PROGRAMS-SPEC.md)
- Business vision: [`PRD_Plataforma_Fitness.md`](./PRD_Plataforma_Fitness.md)
- Migrations (property/RLS source of truth):
  - `supabase/migrations/20260707120000_coaching_platform.sql` (roles, `is_coach()`, assigned read-only, memberships)
  - `supabase/migrations/20260708120000_exercise_catalog.sql` (exercise catalog)
  - `supabase/migrations/20260717120000_coach_programs.sql` (programs, days, exercises, weeks, set logs, RLS, start-date guard)
  - `supabase/migrations/20260717130000_program_exercise_completions.sql` (completions)
  - `supabase/migrations/20260710120000_body_measurements.sql` (measurements — GAP 1)
  - `supabase/migrations/20260717140000_body_measurements_coach_read.sql` (GAP 1 fix — coach read policy)
- Type mirror: `src/types/database.ts`
- Program UX to mirror: `src/components/program/program-view.tsx`, `program-exercise-row.tsx`, `program-set-logger.tsx`; prescription rules in `src/utils/program.ts`.
