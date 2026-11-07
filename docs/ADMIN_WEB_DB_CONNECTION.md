# Admin Web Panel — Database Connection Guide

**Project:** Hokage Coaching — Admin Web Panel
**Stack:** React SPA (Vite) + `@supabase/supabase-js`
**Backend:** the **same** Supabase project the mobile app already uses
**Status:** the coaching database migration is applied and live (`supabase/migrations/20260707120000_coaching_platform.sql`)

This document explains exactly how the web admin panel connects to the database and operates safely under the existing Row-Level Security (RLS) model. It is the source of truth for the panel's data layer.

---

## 1. Overview & Security Model

The panel is a **browser-only React SPA**. It talks to Supabase directly with `@supabase/supabase-js`. There is **no custom backend server** — with one exception (creating client accounts, see §6).

The security model rests on three facts already enforced in the database:

1. **RLS is the boundary, not the client.** Every table has Row-Level Security enabled. What a request can read/write is decided by Postgres based on the caller's JWT — never by trusting the browser.
2. **The coach's power comes from their role, via `is_coach()`.** There is exactly one coach (the gym owner). Their `profiles.role = 'coach'`. A security-definer function `public.is_coach()` returns true for that account, and additive RLS policies grant the coach **full CRUD across every client's data**. Clients (`role = 'user'`) stay scoped to their own rows.
3. **The anon key is public and safe to ship in the browser.** It grants *nothing* on its own — every request is still filtered by RLS against the signed-in user's JWT. The **service-role key is never shipped to the browser**; it lives only inside one server-side Edge Function (§6).

```
┌─────────────────────────┐         anon key + coach JWT
│  Admin Web Panel (SPA)  │  ───────────────────────────────►  ┌──────────────────┐
│  @supabase/supabase-js  │        RLS: is_coach() = true       │  Supabase (Postgres) │
└─────────────────────────┘  ◄───────────────────────────────  │  RLS-enforced        │
            │                                                    └──────────────────┘
            │  functions.invoke('create-client')  (coach JWT)            ▲
            ▼                                                             │ service role
┌─────────────────────────┐   SUPABASE_SERVICE_ROLE_KEY (secret)         │ (server only)
│  Edge Function          │  ──────────────────────────────────────────►┘
│  create-client          │   auth.admin.createUser(...)
└─────────────────────────┘
```

---

## 2. Environment & Setup

The web panel reuses the **same project URL** and **same anon key** as the mobile app (mobile reads them as `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY`). For Vite, expose them with the `VITE_` prefix.

`.env` (Vite):

```dotenv
VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

Both values are found in the Supabase dashboard → **Project Settings → API**. The anon key is the **`anon` `public`** key — do **not** use the `service_role` key here.

Install and create a single shared client:

```bash
npm install @supabase/supabase-js
```

`src/lib/supabaseClient.ts`:

```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,      // keep the coach logged in across reloads
      autoRefreshToken: true,
      detectSessionInUrl: true,  // needed if you use magic-link / OAuth later
    },
  },
);
```

> **Never** create a browser client with the service-role key. That key bypasses RLS entirely; in a public SPA it would hand every visitor full database access.

---

## 3. Coach Authentication

The coach signs in with their normal Supabase account (the one whose `profiles.role` you set to `'coach'`). The JWT it returns is what makes `is_coach()` true on the server.

```ts
// Sign in
const { data, error } = await supabase.auth.signInWithPassword({
  email,
  password,
});
if (error) throw error;
```

**Verify the role after login** — the panel must refuse anyone who is not the coach. RLS already prevents a non-coach from *reading/writing* other users' data, but the UI should also gate access explicitly:

```ts
export async function assertCoach(): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (error) return false;
  return data?.role === "coach";
}
```

Use this in a route guard: if `assertCoach()` is false, sign out and show a "not authorized" screen.

Session & sign-out:

```ts
supabase.auth.onAuthStateChange((_event, session) => {
  // update app auth state
});

await supabase.auth.signOut();
```

> The role-escalation trigger (`guard_role_change`) blocks any attempt to change `role` through the API, so a compromised client account cannot promote itself to `coach`. Roles are managed only via the Supabase dashboard / service role.

---

## 4. What RLS Grants the Coach

Once signed in as the coach, `is_coach()` is true and these additive **permissive** policies apply. Clients (`role = 'user'`) continue to see only their own rows.

| Table | Coach (via `is_coach()`) | Client (`role = 'user'`) |
|---|---|---|
| `profiles` | read + update **all** profiles | read/update **own**; read the coach profile |
| `routines` | full CRUD on **all** | CRUD **own** — but rows with `assigned_by` set are **read-only** |
| `routine_exercises` | full CRUD on **all** | CRUD **own** — read-only if the parent routine is assigned |
| `meals` | full CRUD on **all** | CRUD **own** — assigned meals read-only |
| `meal_items` | full CRUD on **all** | CRUD **own** — read-only if parent meal is assigned |
| `workout_logs` | read (+ CRUD) on **all** | CRUD **own** |
| `memberships` | full CRUD on **all** | read **own** only |

The client read-only rule is enforced by **restrictive** policies that AND onto the client's self-policies; the coach is explicitly exempt (`is_coach() OR ...`). So the coach can always edit an assigned plan; the client cannot.

**Provenance:** a plan is "assigned by the coach" when its `assigned_by` column holds the coach's `profiles.id`. `assigned_by = null` means the client made it themselves. The mobile app uses this to split each list into **"From your coach"** vs **"My own"**.

---

## 5. Core Operations (with `supabase-js` snippets)

All of these run in the browser with the coach's session; RLS authorizes them because `is_coach()` is true. Replace `clientId` / `coachId` with real UUIDs (`coachId` = the signed-in coach's `user.id`).

### List all clients

```ts
const { data: clients } = await supabase
  .from("profiles")
  .select("id, display_name, avatar_url, age, weight_kg, calorie_goal, onboarding_completed")
  .eq("role", "user")
  .order("display_name");
```

### Read one client's plans & progress

```ts
const { data: routines } = await supabase
  .from("routines")
  .select("*, routine_exercises(*, exercise:exercises(*, body_part:bodyparts(name)))")
  .eq("user_id", clientId)
  .order("created_at", { ascending: false });

const { data: meals } = await supabase
  .from("meals")
  .select("*, meal_items(*)")
  .eq("user_id", clientId);

const { data: logs } = await supabase
  .from("workout_logs")
  .select("*")
  .eq("user_id", clientId)
  .order("date", { ascending: false });
```

### Manage the exercise catalog

Exercises are a **shared library** (`public.exercises`), not per-routine free text — assigning "Bench Press" to five clients means picking the same catalog row five times, not retyping it. Only the coach can write to it; every signed-in user (coach + clients) can read it.

```ts
// List (e.g. for a picker in the routine-builder UI)
const { data: catalog } = await supabase
  .from("exercises")
  .select("*, body_part:bodyparts(name)")
  .order("name");

// Create — name is case-insensitively unique (unique index on lower(name)).
// Search the list above before creating to avoid a duplicate-key error.
const { data: exercise, error } = await supabase
  .from("exercises")
  .insert({ name: "Bench Press", video_url: "https://.../bench-press.mp4", body_part_id: chestId })
  .select()
  .single();

// Update — instantly updates every client this exercise is assigned to
// (routine_exercises stores only exercise_id, name/video are read live via join).
await supabase.from("exercises").update({ video_url: newUrl }).eq("id", exercise.id);

// Delete — fails with Postgres error 23503 (foreign key violation) if any
// routine_exercises row still references it. Catch this and tell the coach
// to reassign/remove those first rather than showing a raw DB error.
const { error: delErr } = await supabase.from("exercises").delete().eq("id", exercise.id);
if (delErr?.code === "23503") {
  // "Still assigned to one or more clients — remove it from their routines first."
}
```

### Assign a workout plan (this is what the mobile app shows under "From your coach")

Insert routine rows **into the client's account** (`user_id = client`) stamped with `assigned_by = coach`, then their exercises — referencing the catalog by `exercise_id`, not a free-text name.

```ts
const { data: routine, error } = await supabase
  .from("routines")
  .insert({
    user_id: clientId,
    assigned_by: coachId,          // <-- marks it coach-assigned + read-only for the client
    name: "Push Day",
    description: "Chest / shoulders / triceps",
    day_of_week: "monday",
  })
  .select()
  .single();
if (error) throw error;

// benchPressId / overheadPressId come from the exercises catalog (see above) —
// pick them from the list, don't type a name here.
await supabase.from("routine_exercises").insert([
  { routine_id: routine.id, user_id: clientId, exercise_id: benchPressId, sets: 4, reps: 8, sort_order: 0 },
  { routine_id: routine.id, user_id: clientId, exercise_id: overheadPressId, sets: 3, reps: 10, sort_order: 1 },
]);
```

> Set `user_id` to the **client's** id (not the coach's) and always include `assigned_by: coachId`. The insert guard rejects a client trying to fake `assigned_by`, but the coach is allowed.

### Assign nutrition

The coach assigns a nutrition plan (§6.5) and sets the client's daily calorie target:

```ts
await supabase.from("profiles").update({ calorie_goal: 2200 }).eq("id", clientId);
```

The app has no diary since meal registration (2026-11): the client registers each of today's plan meals, and those registrations are the `meals` / `meal_items` rows (§6.6). Don't seed meals: a coach-written row shows nowhere in the app, only in the client's calorie totals.

### Manage a membership

```ts
// Create or update a client's membership (coach-managed status; no in-app payment)
await supabase.from("memberships").upsert({
  client_id: clientId,
  coach_id: coachId,
  plan_name: "Monthly",
  status: "active",              // 'active' | 'expired' | 'paused' | 'cancelled'
  price: 50,
  currency: "USD",
  started_at: "2026-07-01",
  expires_at: "2026-08-01",
});
```

The client's mobile app reads this and shows status + a renewal reminder when it nears/passes `expires_at`.

### Set the coach's own WhatsApp (shown to clients on mobile)

```ts
await supabase
  .from("profiles")
  .update({ whatsapp: "5215512345678" }) // international digits only, no + or spaces
  .eq("id", coachId);
```

---

## 6. Client Accounts (the one server-side piece)

Creating a login and resetting a forgotten password are the **only** operations that cannot run in the browser: they need the Supabase Admin API (`auth.admin.*`), which requires the **service-role key**. That key must never touch the SPA, so both live in Supabase **Edge Functions** in this repo:

| Function | Body | Returns | Does |
|---|---|---|---|
| `create-client` | `{ email, display_name }` | `{ user_id, temp_password }` | Creates the auth user (confirmed, no email sent); `handle_new_user` creates the profile with `role = 'user'`. |
| `reset-client-password` | `{ user_id }` | `{ temp_password }` | Sets a new password on an existing **client** (`role = 'user'` only — a coach account is refused). |

Both verify the caller's JWT belongs to the coach before using the service role (`supabase/functions/_shared/coach.ts`), and both answer browsers only from the origins in the `ALLOWED_ORIGINS` secret (`supabase/functions/_shared/cors.ts`).

There is no email delivery anywhere: the function returns a one-time temporary password (`Hkg-…`) that the panel shows once, the coach shares it over WhatsApp, and the client changes it in the app's **Ajustes → Cambiar contraseña**. The app's login screen tells a client who forgot their password to ask their coach.

### 6.1 Deploy

```bash
supabase functions deploy create-client         --project-ref rzgwkwxskrovxnnymxqo
supabase functions deploy reset-client-password --project-ref rzgwkwxskrovxnnymxqo
# The panel's real origin(s), comma-separated, exact scheme + host, no trailing slash.
# Add http://localhost:5173 only if you run the panel locally against this project.
supabase secrets set ALLOWED_ORIGINS=https://<panel-domain> --project-ref rzgwkwxskrovxnnymxqo
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically (the CLI refuses to set `SUPABASE_*` secrets). Until `ALLOWED_ORIGINS` is set, every browser call is refused with `origin not allowed`.

`reset-client-password` reads the target's `profiles.role` with the service role, which `profiles` was never granted: apply `supabase/migrations/20261107120000_profiles_service_role_read.sql`, or every reset fails with `permission denied for table profiles`.

### 6.2 Calling them from the SPA

```ts
const { data, error } = await supabase.functions.invoke("create-client", {
  body: { email: "client@example.com", display_name: "Jane Doe" },
});
const { data: reset } = await supabase.functions.invoke("reset-client-password", {
  body: { user_id: clientId },
});
// supabase.functions.invoke automatically attaches the coach's JWT as the
// Authorization header, which the functions use to verify role === 'coach'.
```

The new account is created with `role = 'user'` (the default), so the coach immediately sees it in the clients list (§5) and can start assigning plans.

---

### 6.3 AI program drafts (`generate-program`)

The panel's program builder has a **Generar / Editar con IA** assistant. The coach describes a program (or a change to the current draft) and `generate-program` returns it as JSON, which the panel loads into the builder. The function **writes nothing**: the coach reviews the draft and saves it through the normal `save_coach_program` RPC, so every check still applies. It runs with the caller's JWT (RLS applies) and never uses the service role; it is server-side only to keep the model keys out of the browser.

| Body | Returns |
|---|---|
| `{ prompt, current?, client_id?, include_notes? }` | `{ program, unresolved, provider }` |

- `current` = the builder's draft (edit mode); omitted = a new program. Days and exercises carry a `ref` so the panel maps kept rows back to their DB ids (logged sets stay attached).
- `client_id` adds the client's profile fields (goal, age, sex, weight, days, session length; never name or email). `include_notes: true` also sends the coach's private `client_notes` body.
- Exercise names are forced onto the catalog (exact, then accent/case-insensitive, then one follow-up call for the closest catalog movement); the panel drops anything still unresolved.
- Models (shared with `ai-complete`, in `supabase/functions/_shared/llm.ts`): Gemini with a response schema — `gemini-3.8-flash` (optional `GEMINI_MODEL` secret overrides), then `gemini-3.5-flash-lite`, then `gemini-2.5-flash`; a model that's overloaded (503, after one retry), out of quota (429) or not available to the key (404) hands over to the next. Groq is the fallback: `openai/gpt-oss-120b`, then `openai/gpt-oss-20b` (Llama 3.3 70B is enterprise-only now), moving on the same way on 404, 429 or 5xx. A failed call returns `{ error, detail }` with a 502: `error` in Spanish for the coach, `detail` the providers' own error text (shown in the panel toast).

```bash
supabase functions deploy generate-program --project-ref rzgwkwxskrovxnnymxqo
# Either key alone works; with both, Groq is only the fallback.
supabase secrets set GEMINI_API_KEY=<key> GROQ_API_KEY=<key> --project-ref rzgwkwxskrovxnnymxqo
```

### 6.4 App AI (`ai-complete`)

The **mobile app's** weekly analysis card on the progress dashboard calls `ai-complete` instead of Groq/Gemini directly, so the model keys are function secrets and never ship in the app bundle. The app's `src/services/llm.ts` is a thin `supabase.functions.invoke("ai-complete")` wrapper; the prompts are still built in the app. Registered meals are estimated by `estimate-meal` instead (§6.6); app builds from before meal registration still send their own meal estimates here, photo included.

| Body | Returns |
|---|---|
| `{ system, user, image?: { base64, mimeType } }` | `{ result, provider }` (`result` = the model's JSON, parsed) |

- Callers are **clients**, so any signed-in user may call it (it checks `auth.getUser()`, not the coach role). Requests from the native app carry no `Origin`, so `ALLOWED_ORIGINS` doesn't affect them. The app's **web** build (`vercel.json`), if deployed, is a browser: add its origin to `ALLOWED_ORIGINS` (§6.1) or its AI calls are refused.
- **Quota:** 30 requests per hour and 100 per day per user, shared with `estimate-meal`, enforced by `take_ai_quota()` from migration `20260926140000_ai_request_quota.sql` before any model call; over the limit the function answers `429`. The migration must be applied first: until it is, the function answers `503` to every request. A request whose model call fails (`502`) is given back through the service role by `refund_ai_quota_for()` from `20261105120000_meal_registrations.sql`, so a provider outage doesn't use up users' quota; without that migration the refund is skipped (logged) and the failure still counts. Clients can no longer call `refund_ai_quota()` themselves: that migration revokes it, because a client could otherwise refund every request and never run out.
- **Limits:** `system` and `user` at most 6,000 characters each; `image.base64` at most 7,000,000 characters (~5 MB; the app's photos at quality 0.5 are typically 1–3 MB of base64). `mimeType`: `image/jpeg`, `png`, `webp`, `heic` or `heif`. Supabase doesn't document a request-body limit for Edge Functions; Gemini accepts up to 20 MB per request.
- Models (same lists and retries as §6.3, `_shared/llm.ts`): text goes to Groq (`openai/gpt-oss-120b`, then `-20b`) first with Gemini as the fallback, as the app did before; photos go to Gemini first with Groq (`qwen/qwen3.8-27b`) as the fallback. The app's old Groq vision model, `llama-4-scout`, was shut down on 2026-07-17.

```bash
# 1. SQL editor: run supabase/migrations/20260926140000_ai_request_quota.sql,
#    then 20260928120000_ai_quota_refund.sql
# 2. Deploy. The keys are the same secrets as generate-program (§6.3); set them once.
supabase functions deploy ai-complete --project-ref rzgwkwxskrovxnnymxqo
supabase secrets set GEMINI_API_KEY=<key> GROQ_API_KEY=<key> --project-ref rzgwkwxskrovxnnymxqo
```

App builds need no AI env at all: `EXPO_PUBLIC_GROQ_API_KEY` / `EXPO_PUBLIC_GEMINI_API_KEY` are gone, and should not be set in EAS (an `EXPO_PUBLIC_*` value is readable by anyone who downloads the app).

### 6.5 AI nutrition drafts (`generate-nutrition-plan`)

The panel's nutrition builder has the same **Generar / Editar con IA** assistant as the program builder (§6.3). The coach describes a nutrition plan (or a change to the current draft) and `generate-nutrition-plan` returns it as JSON — header, macro targets per day type, meal slots, rotation options and foods — which the panel loads into the builder. The function **writes nothing**: the coach reviews the draft and saves it through the normal `save_nutrition_plan` RPC, so every check still applies. It runs with the caller's JWT (RLS applies) and never uses the service role; it is server-side only to keep the model keys out of the browser.

| Body | Returns |
|---|---|
| `{ prompt, current?, client_id?, include_notes? }` | `{ plan, provider }` |

- `current` = the builder's draft (edit mode); omitted = a new plan. Slots and options carry a `ref` so the panel maps kept rows back to their DB ids (an option keeps the registrations made from it).
- `client_id` adds the client's profile fields (goal, age, sex, height, weight, activity level, job, calorie goal, training days per week; never name or email). `include_notes: true` also sends the coach's private `client_notes` body (allergies, intolerances, dislikes, limits).
- Foods are free text (there is no food catalog), so nothing is resolved or dropped: a portion, when useful, is part of the name ("Arroz 110 g"). The panel clamps every number to the ranges the DB CHECKs enforce before anything reaches the builder.
- Models, fallback order and the `{ error, detail }` 502 shape are the same as §6.3 (`supabase/functions/_shared/complete-json.ts`, on top of `_shared/llm.ts`). It reads the same `GEMINI_API_KEY` / `GROQ_API_KEY` and `ALLOWED_ORIGINS` secrets, so nothing new has to be set.

```bash
supabase functions deploy generate-nutrition-plan --project-ref rzgwkwxskrovxnnymxqo
# Same keys and origins as generate-program (§6.3) — already set if that one is deployed.
```

### 6.6 Meal estimates (`estimate-meal`)

The client registers each of today's plan meals in the app: the plan option, «otra cosa» (typed) or «No la comí». The **server** estimates the calories and macros of every meal eaten, and fixes only the spelling of «otra cosa». Neither a browser nor the app calls this function: the **database** does, through `pg_net`, from the triggers and `pg_cron` jobs in `supabase/migrations/20261105120000_meal_registrations.sql`.

| Body | Returns |
|---|---|
| `{ id, version }`, header `x-estimate-secret` | `202 { accepted: true }` at once; the estimate is written back later |

- **Auth:** deployed with `--no-verify-jwt`, because the database carries no user JWT. The only way in is the shared secret, set in two places (below). A call without it gets `401`; with the secret unset, every call gets `503`.
- **Flow:** the function reads the row, takes the client's quota (`take_ai_quota_for`, the same 30/hour and 100/day allowance as `ai-complete`), calls the model with the option's foods or the typed text plus the photo when there is one, and writes back through `finish_meal_estimate` only while the row is still the version it was sent for. A quota wait (`defer_meal_estimate`) looks again in 15 minutes and isn't an attempt. A failure (`fail_meal_estimate`) is refunded and retried, and its reason goes to `meal_estimate_errors` (`log_meal_estimate_error`, migration `20261106120000_meal_estimate_errors.sql`): server-only, kept 30 days, read with SQL (Checks below).
- **Retries:** each send moves the row's next try one 3-minute lease ahead and counts an attempt. Failures back off 1, 5, 15, then 60 minutes; after 5 attempts the row is `failed`, which the app and the panel show as «Sin estimar». The `meal-estimates-resend` job (every 2 minutes) re-sends lost calls, and `meal-estimates-daily-retry` (11:00 UTC) gives each failure from the last 7 days one more try. A client can also retry from the app.
- **Test switch:** with the optional function secret `ESTIMATE_FAIL_USER_ID` set to a client's uuid, that client's estimates fail as a provider failure would, without calling the model. Remove it after testing.

Setup, in this order (the owner):

```bash
# 1. Deploy: a push to main runs .github/workflows/deploy-functions.yml, which
#    deploys estimate-meal with --no-verify-jwt.
# 2. A fresh secret (or: select encode(extensions.gen_random_bytes(32), 'hex'); in the SQL editor):
supabase secrets set ESTIMATE_MEAL_SECRET=<secret> --project-ref rzgwkwxskrovxnnymxqo
```

```sql
-- 3. SQL editor: the URL and the same secret in Vault (vault.update_secret changes them later).
select vault.create_secret('https://rzgwkwxskrovxnnymxqo.supabase.co/functions/v1/estimate-meal', 'estimate_meal_url');
select vault.create_secret('<secret>', 'estimate_meal_secret');
-- 4. Run supabase/migrations/20261105120000_meal_registrations.sql,
--    20261106120000_meal_estimate_errors.sql and
--    20261106130000_meal_items_service_role_read.sql with their Verify blocks, then
--    supabase/scripts/smoke_meal_registrations.sql (expects «SMOKE OK») and
--    supabase/scripts/e2e_meal_estimate.sql with a test client.
-- 5. Only then let an app build with meal registration talk to the project.
```

Checks:

```sql
select estimate_status, count(*) from public.meal_items where kind is not null group by 1;  -- pending / done / failed
select id, status_code, content from net._http_response order by id desc limit 5;         -- recent posts
select created_at, meal_item_id, attempt, error
  from public.meal_estimate_errors order by id desc limit 10;                              -- why estimates failed
select j.jobname, d.status, d.return_message
  from cron.job_run_details d join cron.job j using (jobid)
 where j.jobname like 'meal-estimates-%' order by d.start_time desc limit 5;
```

## 7. Security Checklist

- [ ] **Service-role key is never in the SPA** — only inside the Edge Functions (§6).
- [ ] **No model keys in the SPA or the app** — `GEMINI_API_KEY` / `GROQ_API_KEY` are function secrets only (§6.3, §6.4); no `EXPO_PUBLIC_*` / `VITE_*` AI keys in `.env` files or EAS.
- [ ] The SPA uses the **anon** key; all access is mediated by RLS.
- [ ] Post-login **`role === 'coach'` guard** on every admin route (`assertCoach`).
- [ ] The Edge Functions **verify the caller is a coach** before using the service role.
- [ ] Rely on RLS for data isolation — do **not** re-implement authorization in the browser (belt-and-suspenders UI checks are fine, but the DB is the boundary).
- [ ] The **role-escalation trigger** and **restrictive read-only guards** are already in the DB; do not weaken them.
- [ ] Validate inputs on write: emails (create-client), and **WhatsApp as international digits only** (`^\d{8,15}$`, no `+`/spaces) so `https://wa.me/<digits>` works on mobile.
- [ ] `ALLOWED_ORIGINS` lists only the panel's real domain (§6.1).

---

## 8. Schema Reference

Source of truth: **`supabase/migrations/20260707120000_coaching_platform.sql`** and **`supabase/migrations/20260708120000_exercise_catalog.sql`** (plus the base `supabase-schema.sql`, which is not fully in sync with either migration). Columns and objects the panel depends on:

**Columns added for coaching**

| Column | Table | Meaning |
|---|---|---|
| `role` | `profiles` | `'user'` (client) or `'coach'`. Drives `is_coach()`. Default `'user'`. |
| `whatsapp` | `profiles` | Coach's contact number (international digits). Shown to clients on mobile. |
| `assigned_by` | `routines`, `meals` | `null` = self-made; coach's `profiles.id` = coach-assigned (read-only for the client). |

**Membership table** — `public.memberships`: `client_id`, `coach_id`, `plan_name`, `status` (`active`/`expired`/`paused`/`cancelled`), `price`, `currency`, `started_at`, `expires_at`, `notes`.

**Exercise catalog** — `public.exercises`: `id`, `name` (case-insensitively unique), `video_url`, `body_part_id` (→ `bodyparts.id`), `created_at`, `updated_at`. Coach-writable only (`is_coach()`), readable by everyone. `routine_exercises.exercise_id` (→ `exercises.id`, `not null`, `on delete restrict`) replaced the old per-row `name`/`video_url` text columns — those are gone after the cleanup migration ran.

**Helper functions (security definer)**

| Function | Purpose |
|---|---|
| `is_coach()` | True when the caller's profile role is `coach`. Gates all coach RLS policies. |
| `is_assigned_routine(uuid)` / `is_assigned_meal(uuid)` | Used by restrictive policies to keep assigned plans read-only for clients. |
| `guard_role_change()` (trigger `trg_guard_role_change`) | Blocks role changes made through the API (clients cannot self-promote). |

**Auth trigger** — `handle_new_user` (base schema): auto-inserts a `profiles` row on signup, so `create-client` does not insert the profile manually.

---

## 9. Optional Enhancements

- **Realtime dashboard.** Subscribe to changes for a live view of client activity:

  ```ts
  supabase
    .channel("workout_logs")
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "workout_logs" },
      (payload) => { /* refresh UI */ })
    .subscribe();
  ```

- **Pagination** for large client lists — use `.range(from, to)` on the `profiles` query.
- **Coach-only content later** (announcements): add tables with `is_coach()` write policies + public/`user` read policies, following the same pattern as this migration. (The exercise library described here is already built — see §5 "Manage the exercise catalog" and §8.)

---

## 10. Quick Verification

Against a scratch Vite app wired to the same project:

1. Sign in as the coach → `assertCoach()` returns true; a `user` account is rejected.
2. List clients → returns all `role='user'` profiles.
3. Assign a routine to a client (`assigned_by = coachId`) → open the **mobile** app as that client → it appears under **"From your coach"**, badged and non-deletable.
4. Upsert a membership with `expires_at` a few days out → the client's mobile Profile shows the status + renewal reminder.
5. Call `create-client` → a new `role='user'` account is created and appears in the clients list and the panel shows its temporary password once.

Every SQL object referenced here exists in the applied migration `20260707120000_coaching_platform.sql`.
