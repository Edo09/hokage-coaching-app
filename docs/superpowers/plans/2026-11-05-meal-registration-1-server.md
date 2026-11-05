# Meal registration · Plan 1 of 3: server estimate pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every plan or «otra cosa» registration that reaches the database gets a kcal + macros estimate from the server (and, for «otra cosa», a spelling-only correction). It is retried until it is done or has failed, and it is charged to the client's own AI quota.

**Architecture:**
- **Migration:** one additive migration on `meal_items` adds:
  - the registration columns;
  - a `BEFORE` trigger that owns the estimate state;
  - `AFTER` triggers and two `pg_cron` jobs that post to a new `estimate-meal` Edge Function through `pg_net`;
  - service-role-only RPCs the function uses to write back;
  - service-role quota variants.
- **Function:** answers at once. In the background it reads the row, takes quota, calls the model through a shared photo-capable completion, and writes back only while the row's version still matches.
- **Pure logic:** the prompt, the parsing and the spelling guard live in an import-free shared module that `npm test` runs.

**Tech Stack:**
- Postgres 17 on Supabase, with pg_net, pg_cron and Vault; PostgREST v14.
- Deno Edge Functions (`jsr:` imports).
- Gemini and Groq through `supabase/functions/_shared/llm.ts`.
- `node --test` with type stripping for the pure module.

**Spec:** `docs/superpowers/specs/2026-11-05-nutrition-meal-registration-design.md`, the sections «The AI after saving» (all subsections), «Data», «Edge cases», «Constraints» and «Docs and legal text». Plan 2 (app) and Plan 3 (panel) build on this plan. The app plan must not ship a build until this plan's migration is applied.

## Global Constraints

- **Database:**
  - Supabase project `rzgwkwxskrovxnnymxqo`, where RLS is the security boundary.
  - Migrations are additive, and the owner applies them by hand in the SQL editor. Never edit an applied migration.
- **Migration file conventions** (as `20261024130000_coach_notifications.sql`):
  - a `-- ====` banner header;
  - `begin;` … `commit;` with numbered sections;
  - idempotent statements (`if not exists`, `create or replace`, `drop trigger if exists` + `create trigger`);
  - `notify pgrst, 'reload schema';` just before `commit;`;
  - a `-- Verify:` block after `commit;`.
- **Every new function** is `security definer` with `set search_path = ''` and schema-qualifies every name. It revokes all from `public, anon, authenticated`; the service-role RPCs also `grant execute … to service_role`.
- **No new trigger on `meal_items` may raise.** Every `net.http_post` and Vault read sits in `begin … exception when others then raise warning … end`.
- **Client write:** `auth.uid() is not null and pg_trigger_depth() = 1`, as in `stamp_set_log_snapshot` (`20260925120000:97`). Anything else is a server write: `service_role`, cron, the SQL editor, or a cascade at depth 2.
- **Kinds:** `plan`, `other`, `skipped`.
- **States:** `pending`, `done`, `failed`.
- **No defaults:** `kind` and `estimate_status` have none, so old builds' rows stay null and are never touched.
- **Quota:** 30 per hour and 100 per day, shared with `ai-complete`, under the same advisory lock key `hashtext('ai_quota:' || uid::text)`.
- **Spelling rule (spec):** «spelling, accents and capital letters only: same words, same order, same quantities; nothing added, removed or reworded; when unsure, keep the original».
- **The function:**
  - deploys with `--no-verify-jwt` (the app's key is `sb_publishable_…`, not a JWT);
  - accepts a call only when it carries the secret;
  - takes its URL and secret from Vault (`estimate_meal_url`, `estimate_meal_secret`), set by hand.
- **Unchanged:** `ai-complete` keeps its behaviour; only its photo call's import and its refund change. `_shared/complete-json.ts` stays as it is.
- **Pure modules under `supabase/functions/_shared/`** that tests import have **no imports at all**. A `.ts`-suffixed import trips tsc (TS5097), and `llm.ts`/`cors.ts`/`coach.ts` fail under Node.
- **Rollout order (spec):**
  1. deploy the function and set its secrets;
  2. apply the migration;
  3. only then any app build with the feature.
- **Git:** work on `main` and never branch. Commit per task, and push once at the end of Task 6, because a push to `supabase/functions/**` deploys every function.

## Review Focus

1. **The model returns junk** (numbers as words, negatives, 12000 kcal, missing calories, prose around the JSON). Expected: it counts as a provider failure and is never saved. Pinned by `parseEstimate` tests in Task 1.
2. **A "correction" changes the meaning** («2 huevos» → «3 huevos», «arroz con pollo» → «arroz sin pollo» or «pollo asado con arroz integral»). Expected: the original text is kept, while «arros con poyo» → «Arroz con pollo» is accepted. Pinned by `acceptCorrection` tests in Task 1.
3. **A client upserts a stale cached row** (status done, old numbers, typed name). Expected: the server keeps its status, numbers and corrected name, and no second estimate starts. Pinned by a smoke assertion in Task 3.
4. **The coach's plan save nulls a pending registration's option or meal.** Expected: the write succeeds, and no estimate starts. Pinned by a smoke assertion in Task 3.
5. **A registration is undone and re-inserted under the same id while its old estimate is still running.** Expected: the old answer is discarded on a version mismatch. Pinned by a smoke assertion in Task 4.

---

### Task 1: Pure estimate module (prompt, parsing, spelling guard, photo path)

**Files:**
- Create: `supabase/functions/_shared/meal-estimate.ts` (no imports)
- Test: `src/utils/meal-estimate.test.ts` (imports `@/supabase/functions/_shared/meal-estimate`, extensionless)

**Interfaces:**
- Produces (used by Task 5):
  ```ts
  export type EstimateKind = 'plan' | 'other';
  export type EstimateResult = { calories: number; protein_g: number; carbs_g: number; fat_g: number; corrected: string | null };
  export const MAX_TEXT_CHARS = 600;
  export function buildEstimatePrompt(input: { kind: EstimateKind; text: string; hasPhoto: boolean }): { system: string; user: string };
  export function parseEstimate(raw: unknown, kind: EstimateKind): EstimateResult | null;
  export function acceptCorrection(original: string, corrected: string): boolean;
  export function photoPathAllowed(userId: string, path: string): boolean;
  ```

- [ ] **Step 1: Write the failing tests** in `src/utils/meal-estimate.test.ts`, in the repo's test style (`/// <reference types="node" />`, `node:assert/strict`, `node:test`). Add a header comment saying it covers the Edge Function's pure module.

```ts
describe("acceptCorrection", () => {
  it("accepts spelling, accents and capitals", () => {
    assert.equal(acceptCorrection("arros con poyo y abichuelas", "Arroz con pollo y habichuelas"), true);
    assert.equal(acceptCorrection("platano", "Plátano"), true);
    assert.equal(acceptCorrection("Yogur con fresas", "Yogur con fresas"), true);
  });
  it("rejects changed meaning, words or quantities", () => {
    assert.equal(acceptCorrection("arroz con pollo", "pollo asado con arroz integral"), false);
    assert.equal(acceptCorrection("arroz con pollo", "arroz sin pollo"), false);
    assert.equal(acceptCorrection("2 huevos", "3 huevos"), false);
    assert.equal(acceptCorrection("jugo de chinola", "jugo de maracuyá"), false);
    assert.equal(acceptCorrection("pechugade pollo", "pechuga de pollo"), false);
    assert.equal(acceptCorrection("yogur con fresas", ""), false);
  });
});
describe("parseEstimate", () => {
  it("reads numbers and rounds them", () => {
    assert.deepEqual(parseEstimate({ calories: 410.6, protein_g: 30.04, carbs_g: "55", fat_g: 10 }, "plan"),
      { calories: 411, protein_g: 30, carbs_g: 55, fat_g: 10, corrected: null });
  });
  it("defaults missing macros to 0 and keeps the correction for other", () => {
    assert.deepEqual(parseEstimate({ calories: 180, corrected_text: "Yogur con fresas" }, "other"),
      { calories: 180, protein_g: 0, carbs_g: 0, fat_g: 0, corrected: "Yogur con fresas" });
  });
  it("rejects missing, non-numeric or out-of-range numbers", () => {
    assert.equal(parseEstimate({ protein_g: 10 }, "plan"), null);
    assert.equal(parseEstimate({ calories: "mucho" }, "plan"), null);
    assert.equal(parseEstimate({ calories: -5 }, "plan"), null);
    assert.equal(parseEstimate({ calories: 12000 }, "plan"), null);
    assert.equal(parseEstimate({ calories: 300, fat_g: 900 }, "plan"), null);
    assert.equal(parseEstimate("410 kcal", "plan"), null);
  });
  it("ignores an empty correction", () => {
    assert.equal(parseEstimate({ calories: 180, corrected_text: "  " }, "other")?.corrected, null);
  });
});
describe("photoPathAllowed", () => {
  it("only allows the owner's folder", () => {
    assert.equal(photoPathAllowed("u1", "u1/abc.jpg"), true);
    assert.equal(photoPathAllowed("u1", "u2/abc.jpg"), false);
    assert.equal(photoPathAllowed("u1", "u1abc/x.jpg"), false);
    assert.equal(photoPathAllowed("u1", "u1/../u2/x.jpg"), false);
  });
});
describe("buildEstimatePrompt", () => {
  it("quotes the text, truncated, and asks for corrected_text only for other", () => {
    const long = "a".repeat(700);
    const p = buildEstimatePrompt({ kind: "other", text: long, hasPhoto: false });
    assert.ok(p.user.includes("a".repeat(600)) && !p.user.includes("a".repeat(601)));
    assert.ok(p.system.includes("corrected_text"));
    assert.ok(!buildEstimatePrompt({ kind: "plan", text: "80 g avena", hasPhoto: true }).system.includes("corrected_text"));
  });
});
```

- [ ] **Step 2: Run the tests and check they fail.** Run `npm test`. Expected: FAIL, because the module `supabase/functions/_shared/meal-estimate` cannot be found.

- [ ] **Step 3: Implement `supabase/functions/_shared/meal-estimate.ts`** (no imports).
  - **`acceptCorrection`, exact rule:**
    1. Normalise each string: `normalize('NFD')`, strip `\p{M}`, lowercase, turn every character that isn't a letter, digit or whitespace into a space, collapse spaces, trim.
    2. Split into tokens.
    3. Return false when the corrected text has no tokens or the token counts differ.
    4. Compare the tokens position by position:
       - If either token contains a digit, the two must be identical.
       - Otherwise the Levenshtein distance must be ≤ the allowed distance. With `n = max(len a, len b)`, that is 1 when n ≤ 3, 2 when n ≤ 5, and `floor(n * 0.4)` above that.
  - **`parseEstimate`:**
    - Accept a number or a numeric string.
    - `calories` is required; the macros default to 0.
    - Ranges: calories 0–5000, protein 0–500, carbs 0–1000, fat 0–500. Anything else returns `null`.
    - Calories round to an integer and macros to one decimal.
    - `corrected` is the trimmed `corrected_text` for `other` when non-empty, else `null`.
  - **`buildEstimatePrompt`.** The system prompt must say:
    - Answer only with JSON `{"calories","protein_g","carbs_g","fat_g"}`, plus `"corrected_text"` for `other`.
    - The text is what the client ate. Never rename it or turn it into a dish name.
    - Quantities written in the text («80 g avena», «2 huevos enteros») set the portion. The photo changes them only when the plate clearly shows a different amount (a double portion, a missing food). With no written quantities the photo sets the portion; with neither, one typical serving.
    - The photo never names the meal. A photo that isn't food is ignored.
    - For `other`: `corrected_text` is the same text with only spelling, accents and capital letters fixed, following the spelling rule word for word (same words, same order, same quantities, nothing added, removed or reworded, keep the original when unsure), in the same language.

    The user message is `JSON.stringify` of `{ text: text.slice(0, MAX_TEXT_CHARS), photo: hasPhoto }`.
  - **`photoPathAllowed`:** true when `path.startsWith(userId + '/')` and the path contains no `..`.

- [ ] **Step 4: Run the tests and check they pass.** Run `npm test` (all 330+ tests pass) and `npx tsc --noEmit` (0 errors).

- [ ] **Step 5: Commit.**
```bash
git add supabase/functions/_shared/meal-estimate.ts src/utils/meal-estimate.test.ts
git commit -m "feat(ai): pure meal-estimate module: prompt, parsing, spelling guard"
```

### Task 2: Shared photo-capable completion; `ai-complete` uses it and refunds through the server

**Files:**
- Create: `supabase/functions/_shared/complete-json-photo.ts`, with the body moved from `ai-complete/llm.ts`
- Delete: `supabase/functions/ai-complete/llm.ts`
- Modify: `supabase/functions/ai-complete/index.ts` (imports at line 22; limits at 26-33; refund at about line 90; header at 1-18)
- Modify: `supabase/functions/_shared/coach.ts:4-5` and `supabase/functions/_shared/llm.ts:1` (the header comments name their users)

**Interfaces:**
- Produces (used by Task 5):
  ```ts
  export type PhotoInput = { base64: string; mimeType: string };
  export interface PhotoJsonRequest { system: string; user: string; image?: PhotoInput; temperature?: number }
  export const MAX_IMAGE_BASE64_CHARS = 7_000_000;
  export const IMAGE_TYPES: Set<string>; // 'image/jpeg','image/png','image/webp','image/heic','image/heif'
  export async function completeJSONWithPhoto(r: PhotoJsonRequest): Promise<{ json: unknown; provider: Provider }>; // Provider: import type from './complete-json.ts'
  ```
- Consumes: `refund_ai_quota_for(p_user_id uuid)` from Task 4. Until the migration lands, the call fails and is only logged, exactly as today's refund is best-effort.

- [ ] **Step 1: Move the code.**
  - Move `completeJSON` and its helpers from `ai-complete/llm.ts` into `_shared/complete-json-photo.ts` as `completeJSONWithPhoto`. Keep the same provider order (photo: Gemini then Groq vision; text: Groq then Gemini), the same timeouts (20 s for text, 30 s for an image) and the same token limits.
  - When `r.temperature` is given, it replaces every per-provider temperature. When it is absent, today's values stay (Gemini 0.4 with an image and 0.7 without; Groq vision 0.4; Groq text 0.7).
  - Move `MAX_IMAGE_BASE64_CHARS` and `IMAGE_TYPES` from `ai-complete/index.ts:26-33` into this file and export them.
- [ ] **Step 2: Point `ai-complete` at it.**
  - Import from `../_shared/complete-json-photo.ts`.
  - Replace the refund `db.rpc('refund_ai_quota')` with `adminClient().rpc('refund_ai_quota_for', { p_user_id: user.id })`, keeping it best-effort.
  - Update the header comment: estimates moved to `estimate-meal`; the refund now goes through the server.
- [ ] **Step 3: Static check.** Run:
  ```bash
  grep -rn "ai-complete/llm\|from './llm.ts'" supabase/functions
  ```
  Expected: no hits. If the owner agrees to a temporary download, also run `npx --yes deno@2 check supabase/functions/ai-complete/index.ts` and expect no errors. Otherwise note that the check was skipped.
- [ ] **Step 4: Commit.**
```bash
git add -A supabase/functions/_shared supabase/functions/ai-complete
git commit -m "refactor(ai): shared photo-capable completion; ai-complete refunds through the server"
```

### Task 3: Migration, part 1: registration columns, link trigger, estimate-state trigger

**Files:**
- Create: `supabase/migrations/20261105120000_meal_registrations.sql` (sections 1–3; Task 4 appends the rest)
- Create: `supabase/scripts/smoke_meal_registrations.sql` (one `do $$` block, part 1 of its assertions)

**Interfaces:**
- Produces (Plans 2 and 3 read these names; Task 4 and the function use them):
  - `meal_items` columns:
    - `plan_meal_id uuid` → `nutrition_plan_meals(id)` on delete set null;
    - `kind text check (kind in ('plan','other','skipped'))`;
    - `original_text text`;
    - `estimate_status text check (estimate_status in ('pending','done','failed'))`;
    - `estimate_version bigint`;
    - `estimate_attempts smallint not null default 0`;
    - `estimate_next_at timestamptz`.
  - Sequence `public.meal_estimate_version_seq`.
  - `public.meal_estimate_configured() returns boolean`: both Vault secrets exist. Never raises; returns false on error.
  - Triggers, ordered by name:
    - `trg_meal_items_10_links`: `before insert or update of plan_option_id, plan_meal_id`, function `public.meal_items_drop_missing_links()`;
    - `trg_meal_items_20_estimate`: `before insert or update`, function `public.meal_items_estimate_state()`.
  - Indexes:
    - `idx_meal_items_plan_meal (plan_meal_id) where plan_meal_id is not null`;
    - `idx_meal_items_estimate_due (estimate_next_at) where estimate_status = 'pending'`;
    - `idx_meal_items_estimate_failed (created_at) where estimate_status = 'failed'`.

- [ ] **Step 1: Write the smoke script (part 1)** in `supabase/scripts/smoke_meal_registrations.sql`.
  - It is a `do $$ … $$` block that picks `v_uid` from `auth.users`.
  - It switches between a client (`set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true)`) and the server (`json_build_object('role','service_role')`).
  - It creates its own container. For the cascade case it also creates an archived nutrition plan with one meal and one option.
  - It ends with `raise exception 'SMOKE OK: meal registrations; nothing was saved';`, so nothing is kept and no pg_net request leaves.

  Assertions (each one an `assert …, '<what failed>'`):
  - A client inserts kind `other` with `original_text = 'arros con poyo'` and `name = 'x'`. The row then has: `estimate_status = 'pending'`; `name = 'arros con poyo'`; numbers all 0; `estimate_version` not null; `estimate_attempts = case when public.meal_estimate_configured() then 1 else 0 end`.
  - A client upserts the same row with `estimate_status='done', calories=999, estimate_attempts=0` and nothing else changed. Status, numbers, version and attempts are unchanged.
  - A server update sets `estimate_status='done', calories=410, name='Arroz con pollo'`. The row reads done, 410, «Arroz con pollo».
  - A client replays the stale row (`name='arros con poyo'`, `estimate_status='pending'`, `calories=0`, same `original_text`). The status stays done, the calories stay 410, and the name stays «Arroz con pollo» (review focus 3).
  - A client changes `original_text` to «yogur». Status pending, `name = 'yogur'`, numbers 0, version greater than before.
  - A client switches the row to kind `skipped` with a `photo_path`. `estimate_status` is null, numbers 0, `photo_path` null, `original_text` null, version greater than before.
  - A server sets a kind `plan` row to `failed`, then a client sets it to `pending` with nothing else changed. Status pending, and attempts follow the configured rule above.
  - A client inserts with a random `plan_option_id` and a random `plan_meal_id`. The row is saved, and both links are null.
  - Deleting the plan option that a pending row points to (the coach's cascade, at depth 2) leaves the row's `plan_option_id` null, and `estimate_version` and status unchanged (review focus 4).
  - A row with `kind` null that a client inserts keeps the client's own numbers and has a null `estimate_status`.
- [ ] **Step 2: Write sections 1–3 of the migration.**
  - **Banner.** It says what the migration does, and it lists the contracts with the app and the panel: the kind values, the states, the client-write rule, and the Vault names. Its last line reads: «Additive and idempotent. Run in the Supabase SQL editor after deploying estimate-meal and setting its secrets (docs/ADMIN_WEB_DB_CONNECTION.md §6.6).»
  - **Section 1:** the columns, the sequence and the indexes.
  - **Section 2:** `meal_estimate_configured()` and the link trigger. On INSERT, or when a link changed, the trigger checks each non-null link with `perform 1 from public.nutrition_plan_options where id = new.plan_option_id for key share; if not found then new.plan_option_id := null; end if;`, and the same for `plan_meal_id` against `nutrition_plan_meals`. The checks sit in an exception block that leaves NEW unchanged on error.
  - **Section 3:** the estimate-state trigger, exactly this algorithm. The tests don't determine all of it, so follow it as written:

```text
meal_items_estimate_state()            -- BEFORE INSERT OR UPDATE, returns new
  v_client := auth.uid() is not null and pg_trigger_depth() = 1
  if not v_client or new.kind is null: return new          -- server writes and old diary rows pass through
  if UPDATE: version/attempts/next_at := old.*  else: version := null, attempts := 0, next_at := null
  if new.kind = 'skipped':
      status := null; calories/protein/carbs/fat := 0; photo_path := null; original_text := null
      if INSERT or old.kind is distinct from 'skipped': version := nextval('public.meal_estimate_version_seq')
      return new
  if new.kind = 'other':
      if INSERT or old.kind is distinct from 'other' or new.original_text is distinct from old.original_text:
          original_text := coalesce(new.original_text, new.name); name := original_text
      else: name := old.name                                   -- keep the server's correction
  content := INSERT or new.kind is distinct from old.kind or new.photo_path is distinct from old.photo_path
             or (new.kind = 'plan'  and new.name is distinct from old.name)
             or (new.kind = 'other' and new.original_text is distinct from old.original_text)
  retry   := UPDATE and old.estimate_status = 'failed' and new.estimate_status = 'pending'
  if content or retry:
      status := 'pending'; numbers := 0; version := nextval('public.meal_estimate_version_seq')
      if public.meal_estimate_configured(): attempts := 1; next_at := now() + interval '3 minutes'
      else:                                 attempts := 0; next_at := now()
  else:
      status := old.estimate_status; numbers := old numbers   -- a replay never re-runs a finished estimate
  return new
```

- [ ] **Step 3: Self-check the SQL.** Run:
  ```bash
  grep -n "search_path = ''" supabase/migrations/20261105120000_meal_registrations.sql
  ```
  Expected: one hit per function. Also confirm by reading that every function is revoked from `public, anon, authenticated` and that no `raise exception` exists outside the smoke script. Nothing can run locally: there is no Supabase Postgres here, so Task 6 runs the smoke on the project.
- [ ] **Step 4: Commit.**
```bash
git add supabase/migrations/20261105120000_meal_registrations.sql supabase/scripts/smoke_meal_registrations.sql
git commit -m "feat(db): meal registration columns and server-owned estimate state"
```

### Task 4: Migration, part 2: sending, write-back RPCs, retries, quota variants, Realtime

**Files:**
- Modify: `supabase/migrations/20261105120000_meal_registrations.sql` (append sections 4–8, `notify pgrst`, `commit;`, and the Verify block)
- Modify: `supabase/scripts/smoke_meal_registrations.sql` (append part 2 of the assertions)

**Interfaces:**
- Consumes: the Task 3 columns, sequence and `meal_estimate_configured()`.
- Produces (Task 5 calls these through `adminClient().rpc`; Plan 2 subscribes to Realtime):
  - `public.send_meal_estimate(p_id uuid, p_version bigint) returns boolean`:
    - reads `estimate_meal_url` and `estimate_meal_secret` from `vault.decrypted_secrets`;
    - posts `{id, version}` with headers `Content-Type: application/json` and `x-estimate-secret: <secret>`, and `timeout_milliseconds := 10000`;
    - returns false when not configured or on error (warning only).
  - The AFTER trigger function `public.meal_items_send_estimate()` calls `send_meal_estimate(new.id, new.estimate_version)` and returns null. Two triggers use it:
    - `trg_meal_items_30_send_ins` `after insert … when (new.kind in ('plan','other') and new.estimate_status = 'pending' and new.estimate_attempts > 0)`;
    - `trg_meal_items_30_send_upd` `after update … when (` the same `and new.estimate_version is distinct from old.estimate_version)`.
  - `public.finish_meal_estimate(p_id uuid, p_version bigint, p_calories integer, p_protein_g numeric, p_carbs_g numeric, p_fat_g numeric, p_name text) returns boolean`. It sets the numbers, sets `name = coalesce(p_name, name)` and `estimate_status = 'done'`, and clears `estimate_next_at`, only `where id = p_id and estimate_version = p_version and estimate_status = 'pending'`. It returns `found`.
  - `public.fail_meal_estimate(p_id uuid, p_version bigint) returns boolean`, under the same match:
    - with `estimate_attempts >= 5`, it sets `failed` and clears `next_at`;
    - otherwise it stays pending with `next_at = now() + ` 1 minute after attempt 1, 5 minutes after attempt 2, 15 minutes after attempt 3, and 60 minutes after attempt 4.
  - `public.defer_meal_estimate(p_id uuid, p_version bigint) returns boolean` handles a quota wait. Under the same match it sets `estimate_attempts = greatest(estimate_attempts - 1, 0)` and `estimate_next_at = now() + interval '15 minutes'`.
  - `public.resend_meal_estimates() returns integer` (cron `meal-estimates-resend`, `*/2 * * * *`). It returns 0 when not configured. Otherwise:
    1. It marks `failed` the pending rows of kind plan or other whose attempts are ≥ 5 and whose `next_at` has passed.
    2. It locks at most 50 due rows (pending, `next_at` null or passed, attempts < 5) with `for update skip locked`.
    3. In one `update … returning id, estimate_version` it sets `estimate_attempts + 1`, `estimate_next_at = now() + interval '3 minutes'` and `estimate_version = coalesce(estimate_version, nextval(...))`.
    4. It calls `send_meal_estimate` for each returned row and returns how many it sent.
  - `public.retry_failed_meal_estimates() returns integer` (cron `meal-estimates-daily-retry`, `0 11 * * *`). It sets failed rows of kind plan or other with `created_at > now() - interval '7 days'` to pending, with `estimate_attempts = 4` and `estimate_next_at = now()`, and returns the row count.
  - `public.take_ai_quota_for(p_user_id uuid) returns boolean` and `public.refund_ai_quota_for(p_user_id uuid) returns boolean` copy the bodies of `take_ai_quota()` and `refund_ai_quota()` (`20260926140000:35-68`, `20260928120000:21-49`) with `p_user_id` in place of `auth.uid()`. A null user returns false.
  - `public.take_ai_quota()` is replaced by `return public.take_ai_quota_for(auth.uid());` and keeps its grant to `authenticated`.
  - Grants and revokes:
    - `revoke all on function public.refund_ai_quota() from public, anon, authenticated;`
    - every function in this task except `take_ai_quota()` is revoked from `public, anon, authenticated`;
    - `finish_`, `fail_` and `defer_meal_estimate`, `take_ai_quota_for` and `refund_ai_quota_for` are also granted `execute … to service_role`.
  - `meal_items` is added to `supabase_realtime`, guarded as in `20261024130000:89-99`.

- [ ] **Step 1: Write the smoke script (part 2).** Append assertions to the same block, before its final `raise`:
  - **Re-insert after undo** (review focus 5):
    1. As a client, insert row R (kind other) and remember its version as v1.
    2. Delete R, then insert it again with the same id. Its version v2 is greater than v1.
    3. `public.finish_meal_estimate(R, v1, …)` returns false and leaves the row pending.
    4. `public.finish_meal_estimate(R, v2, 410, 30, 55, 10, 'Arroz con pollo')` returns true.
  - **Retries:** `fail_meal_estimate` on a row whose attempts are 2 keeps it pending, with `next_at` about now + 5 minutes. With attempts at 5 it sets failed.
  - **Quota wait:** `defer_meal_estimate` on a row whose attempts are 1 sets attempts to 0 and `next_at` about now + 15 minutes.
  - **Privileges:** `has_function_privilege('authenticated', 'public.take_ai_quota_for(uuid)', 'execute')` is false. The same holds for `refund_ai_quota_for(uuid)`, `refund_ai_quota()`, `finish_meal_estimate(uuid,bigint,integer,numeric,numeric,numeric,text)`, `send_meal_estimate(uuid,bigint)`, `resend_meal_estimates()` and `retry_failed_meal_estimates()`. `has_function_privilege('authenticated', 'public.take_ai_quota()', 'execute')` is true.
  - **Cron:** two `cron.job` rows exist, named `meal-estimates-resend` and `meal-estimates-daily-retry`.
- [ ] **Step 2: Write the sections.**
  - **Section 4:** the send helper and the AFTER triggers.
  - **Section 5:** finish, fail and defer.
  - **Section 6:** resend and daily retry, plus `create extension if not exists pg_cron;` and the two `cron.schedule` calls.
  - **Section 7:** the quota variants, the `take_ai_quota()` wrapper and the revokes.
  - **Section 8:** Realtime.
  - **Section 9:** `notify pgrst, 'reload schema';`.
  - Then `commit;`.
  - **Verify block:** the trigger names (4 rows), the cron jobs (2 rows), the mojibake check on the new functions (0 rows), `select id, status_code, content from net._http_response order by id desc limit 5;`, and `select status, return_message from cron.job_run_details order by start_time desc limit 5;`.
- [ ] **Step 3: Self-check.**
  - Every function has `set search_path = ''`.
  - Every `vault.`, `net.` and `cron.` name is qualified.
  - The AFTER trigger function never updates the row.
  - Read the whole file once against the spec's «Retries» and «Bookkeeping» bullets.
- [ ] **Step 4: Commit.**
```bash
git add supabase/migrations/20261105120000_meal_registrations.sql supabase/scripts/smoke_meal_registrations.sql
git commit -m "feat(db): send registrations to estimate-meal, retries, server quota"
```

### Task 5: The `estimate-meal` Edge Function and its deploy

**Files:**
- Create: `supabase/functions/estimate-meal/index.ts` (HTTP entry)
- Create: `supabase/functions/estimate-meal/estimate.ts` (one estimate, end to end)
- Modify: `.github/workflows/deploy-functions.yml` (the header's secrets list at lines 9-10; a new deploy line after the loop at 49-53)

**Interfaces:**
- Consumes:
  - Task 1's `buildEstimatePrompt`, `parseEstimate`, `acceptCorrection`, `photoPathAllowed` and `MAX_TEXT_CHARS`;
  - Task 2's `completeJSONWithPhoto`, `IMAGE_TYPES` and `MAX_IMAGE_BASE64_CHARS`;
  - `adminClient()` from `_shared/coach.ts` and `json()` from `_shared/cors.ts`;
  - the Task 4 RPCs.
- Produces: `export async function estimateRegistration(db: SupabaseClient, id: string, version: number): Promise<void>` in `estimate.ts`.

- [ ] **Step 1: Write `index.ts`.**
  - Declare `const EdgeRuntime: { waitUntil(p: Promise<unknown>): void }`, then `Deno.serve`.
  - Only POST is allowed (405 otherwise).
  - With `ESTIMATE_MEAL_SECRET` unset, answer 503.
  - The `x-estimate-secret` header must match the secret, compared in constant time over UTF-8 bytes; otherwise 401.
  - The body must be `{ id: <uuid string>, version: <finite integer> }`; otherwise 400.
  - Then `EdgeRuntime.waitUntil(estimateRegistration(adminClient(), id, version).catch((e) => console.error('estimate-meal failed:', e)))`, and return `json({ accepted: true }, 202)`.
- [ ] **Step 2: Write `estimateRegistration`.**
  1. Select `id, user_id, kind, name, original_text, photo_path, estimate_status, estimate_version` by id. Return quietly when the row is missing, isn't pending, isn't kind plan or other, or has another version.
  2. Call `rpc('take_ai_quota_for', { p_user_id })`.
     - `false`: call `rpc('defer_meal_estimate', { p_id, p_version })` and return.
     - An RPC error: go to the failure path without a refund.
  3. If `Deno.env.get('ESTIMATE_FAIL_USER_ID') === user_id`, throw `new Error('test failure')`. This is the switch the verification uses.
  4. Read the photo when `photo_path` passes `photoPathAllowed`:
     - download it with `db.storage.from('meal-photos').download(path)`;
     - use it only when `blob.size <= 5_000_000` and its type is in `IMAGE_TYPES`;
     - encode it with `encodeBase64` from `jsr:@std/encoding@1/base64`;
     - on any problem, continue without it.
  5. The text is `original_text ?? name` for other and `name` for plan. Call `buildEstimatePrompt`, then `completeJSONWithPhoto({ system, user, image, temperature: 0.1 })`, then `parseEstimate`. A `null` result goes to the failure path.
  6. For other, the name is `acceptCorrection(text, r.corrected) ? r.corrected : text` (use `text` when `r.corrected` is null). For plan, it is `null`.
  7. Call `rpc('finish_meal_estimate', …)`.
  8. **Failure path**, every step best-effort and logged: `rpc('refund_ai_quota_for', { p_user_id })` when quota was taken, then `rpc('fail_meal_estimate', { p_id, p_version })`.
- [ ] **Step 3: Update the deploy workflow.**
  - Add `ESTIMATE_MEAL_SECRET` (and the optional `ESTIMATE_FAIL_USER_ID`) to the header's secrets list.
  - Add this after the loop:
  ```bash
      # estimate-meal is called by the database (pg_net) with its own secret, not a user JWT.
      echo "::group::estimate-meal"
      supabase functions deploy estimate-meal --project-ref "$PROJECT_REF" --no-verify-jwt
      echo "::endgroup::"
  ```
- [ ] **Step 4: Static check.** Run:
  ```bash
  grep -n "estimate-meal" .github/workflows/deploy-functions.yml
  ```
  Expected: the new block only, and not in the loop. Run `npm test` and `npx tsc --noEmit`, both clean. If the owner agrees, also run `npx --yes deno@2 check supabase/functions/estimate-meal/index.ts`.
- [ ] **Step 5: Commit.**
```bash
git add supabase/functions/estimate-meal .github/workflows/deploy-functions.yml
git commit -m "feat(ai): estimate-meal function, called by the database"
```

### Task 6: Prompt reword, docs, push, owner rollout and end-to-end check

**Files:**
- Modify: `supabase/functions/generate-nutrition-plan/prompt.ts:7-8, 142-144`
- Modify: `docs/ADMIN_WEB_DB_CONNECTION.md`: §5 (b) at about line 247; a new §6.6 «Meal estimates (`estimate-meal`)»; §6.4 at about line 349; §6.5 at about line 380
- Modify: `CLAUDE.md` and `AGENTS.md`, together in the same commit: the Infrastructure section
- Modify: `README.md:43-46` (the App AI line)
- Create: `supabase/scripts/e2e_meal_estimate.sql`

- [ ] **Step 1: Reword the plan generator's prompt.**
  - Line 142 becomes «The client picks ONE option per slot and registers it.»
  - Line 143 becomes «Foods carry NO macros and NO portion field: when the client registers an option, the AI estimates it from these food names, plus a photo when the client adds one. When a portion matters, write it IN the name: …», keeping the examples.
  - In line 144, «measured intake» becomes «estimated intake».
  - In the header at 7-8, «diary entries» becomes «registrations».
- [ ] **Step 2: Write the docs.**
  - **§6.6:**
    - who calls the function: the triggers and the cron, through pg_net;
    - `--no-verify-jwt`;
    - the secrets: the function's `ESTIMATE_MEAL_SECRET` (and the optional `ESTIMATE_FAIL_USER_ID`), and the Vault entries `estimate_meal_url` and `estimate_meal_secret`, with the exact `select vault.create_secret('<value>', '<name>');` lines;
    - quota and retries: a 3-minute lease; backoff of 1, 5, 15 and 60 minutes; 5 attempts; a daily retry for 7 days at 11:00 UTC;
    - the rollout order;
    - check queries: pending and failed counts, `net._http_response`, `cron.job_run_details`.
  - **§6.4:** `ai-complete` serves only the weekly analysis and refunds through `refund_ai_quota_for`.
  - **§5 (b):** seeded meals no longer show in the app, only in its totals.
  - **§6.5:** «an option keeps the registrations made from it».
  - **`CLAUDE.md` and `AGENTS.md`:** one identical Infrastructure bullet: «Meal estimates: triggers on `meal_items` post new or changed registrations through `pg_net` to the `estimate-meal` Edge Function (deployed with `--no-verify-jwt`; it checks `ESTIMATE_MEAL_SECRET`, which Vault also holds as `estimate_meal_secret`, with the URL as `estimate_meal_url`). `pg_cron` re-sends lost calls and retries failures. See `docs/ADMIN_WEB_DB_CONNECTION.md` §6.6.»
  - **README:** meal estimates run in `estimate-meal`, started by the database on the client's quota, and `ai-complete` serves the weekly analysis.
- [ ] **Step 3: Write `supabase/scripts/e2e_meal_estimate.sql`**, for the owner to run with a test client's uuid.
  1. In a transaction, as that client, insert today's container and an «otra cosa» registration `original_text = 'arros con poyo'`, then `commit;`.
  2. After about 30 seconds, select it. Expected: `estimate_status = 'done'`, `name = 'Arroz con pollo'`, `calories > 0`.
  3. A cleanup `delete` of the test rows.
- [ ] **Step 4: Commit and push.**
```bash
git add supabase/functions/generate-nutrition-plan/prompt.ts docs/ADMIN_WEB_DB_CONNECTION.md CLAUDE.md AGENTS.md README.md supabase/scripts/e2e_meal_estimate.sql
git commit -m "docs: meal estimates on the server; prompt no longer assumes a diary"
git fetch origin && git status -sb   # expect: up to date before pushing
git push origin main
```
  Expected: the «Deploy Edge Functions» workflow on GitHub succeeds and lists `estimate-meal` after the loop.
- [ ] **Step 5: Owner steps.** The implementer cannot do these. Hand the owner this checklist and wait for the results.
  1. Dashboard → Edge Functions → Secrets: set `ESTIMATE_MEAL_SECRET` to a fresh random value (`select encode(extensions.gen_random_bytes(32), 'hex');`).
  2. SQL editor:
     ```sql
     select vault.create_secret('https://rzgwkwxskrovxnnymxqo.supabase.co/functions/v1/estimate-meal', 'estimate_meal_url');
     select vault.create_secret('<the same secret>', 'estimate_meal_secret');
     ```
  3. SQL editor: run the migration, then its Verify block. Expected: 4 triggers, 2 cron jobs, 0 mojibake rows.
  4. SQL editor: run `supabase/scripts/smoke_meal_registrations.sql`. Expected: `ERROR: SMOKE OK: meal registrations; nothing was saved`.
  5. Run `supabase/scripts/e2e_meal_estimate.sql` with a test client. Expected: the row is done, «Arroz con pollo», with calories > 0. Then run its cleanup.
  6. Run:
     ```bash
     curl -i -X POST https://rzgwkwxskrovxnnymxqo.supabase.co/functions/v1/estimate-meal -d '{}'
     ```
     Expected: `401`.
  7. Open Progreso on any client with history, or check `ai-complete`'s logs. Expected: the weekly analysis still answers.
  8. Failure path:
     1. Set the function secret `ESTIMATE_FAIL_USER_ID` to the test client's uuid, then repeat step 5's insert.
     2. After about 30 seconds: the row is still `pending`, with `estimate_attempts = 1`, `estimate_next_at` about one minute ahead, and no new `ai_requests` row for that client, because the failed call was refunded.
     3. Remove the secret. Within about 4 minutes the cron re-sends the row, and it ends `done`.
     4. Clean up.
  9. Optional quota check:
     1. Insert 30 `ai_requests` rows for the test client, then register.
     2. After about 30 seconds: `pending`, `estimate_attempts = 0`, `estimate_next_at` about 15 minutes ahead.
     3. Delete the filler rows. Within about 17 minutes the row lands as `done`.
- [ ] **Step 6: Record the result.** When checks 1–8 pass, Plans 2 and 3 can start their device and panel checks. If any fails, debug it with superpowers:systematic-debugging before Plan 2 ships a build.
