# Premium subscriptions · Plan 1 of 3: server, shipped dark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The database objects, the RevenueCat webhook and an on-demand sync that make «does this person have Premium» one server-side rule, all deployed with the switch off so no current user changes.

**Architecture:** Two migrations (access plumbing; requests, locks and coach rules) behind `premium_settings.enforced`; a pure `_shared/revenuecat.ts` (event → ids, customer → patch); a handler module that takes its database and RevenueCat client as arguments; two thin Edge Functions. State is always re-read from RevenueCat's REST API: the payload never decides access.

**Tech Stack:** Postgres/Supabase (RLS, plpgsql), Deno Edge Functions, `node:test` for the pure modules, `supabase db query` for rolled-back rehearsals.

**Spec:** `docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md` (read it with this plan; Plans 2 and 3 are the app and the panel).

## Global Constraints

- **Dark:** `premium_settings.enforced` defaults `false`. While false: `has_premium_access()` and `premium_content_access()` are true for everyone, no lock blocks anything, and `is_being_coached(uuid)` returns exactly the old rule `(no memberships row) or status = 'active'`.
- **Rule (enforced):** access = coach role, **or** `subscriptions.is_premium and access_until > now()`, **or** `memberships.status = 'active' and (expires_at is null or expires_at >= coach_local_date())`. Content access (what the locks call) = access, or access ended less than **72 hours** ago (a membership: `expires_at >= coach_local_date() - 3` while still `active`).
- **Status values:** `active | cancelled | billing_issue | expired`; environment `production | sandbox`; entitlement id `premium_access`. A non-premium patch clamps `access_until` to the sync time.
- **Requests:** kinds `program | nutrition_plan`; statuses `pending | fulfilled | dismissed`; note ≤ 500 chars; one `pending` per user and kind; notice kind `content_requested`, `dedupe_key = 'content_requested:<request id>'`.
- **Webhook:** `POST` only; only HTTP 200 is success; secret unset → 503; wrong `Authorization` → 401 (constant-time compare); optional signature `X-RevenueCat-Webhook-Signature: t=<unix>,v1=<hex hmac-sha256 of "<t>.<raw body>">`, 300 s tolerance, required only when `REVENUECAT_WEBHOOK_SIGNING_SECRET` is set; deployed `--no-verify-jwt`; secrets `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_API_KEY`.
- **`sync-subscription`:** normal JWT check; the user id comes from the token, never the body; a call within **10 s** of the user's last attempt returns the stored state (a per-user slot, `take_subscription_sync`, so it holds for a user with no subscription row too).
- **SQL style:** idempotent; schema-qualified; functions `security definer` with `set search_path = ''`; **per-table grants, `service_role` included**; server-only functions revoked from `public`, `anon`, `authenticated`; policies and triggers dropped before created.
- **Locks** are `RESTRICTIVE` policies named `premium_lock_select|insert|update|delete`, predicate `(select public.premium_content_access())` for reads and writes alike (the stamp triggers read the program as the client, so the read grace must equal the write grace).
- **Pure modules** (`_shared/secret.ts`, `_shared/revenuecat.ts`, `_shared/subscription-sync.ts`) import nothing but each other (with `.ts` extensions) so Deno and `npm test` both load them; tests live in `src/utils/` and import `@/supabase/functions/_shared/<name>`, like `meal-estimate.test.ts`.
- **Commits:** conventional (`feat(premium): …`), end with the attribution trailer, `git add` named files only. App repo: commit per task, **push only after the final review**. Panel repo: commit, **never push without asking**.
- **Nothing reaches production in this plan:** no migration applied, no secret set, no push before the owner's go. Rehearsals roll back.

## How SQL is verified (the rehearsal)

Each smoke script runs against the live schema inside a transaction that is rolled back. Build the file from the migrations plus the smoke script and run it:

```bash
SCRATCH="C:/Users/Signos/AppData/Local/Temp/claude/42a6156ee16fd473/733c6516-7464-4a98-985a-b4909451887a/scratchpad"
rehearse() { { echo 'begin;'; for f in "$@"; do sed -e '/^begin;$/d' -e '/^commit;$/d' "$f"; echo; done; echo 'rollback;'; } > "$SCRATCH/rehearsal.sql"
  npx -y supabase@3.1.0 db query --remote=rzgwkwxskrovxnnymxqo --yes -f "$SCRATCH/rehearsal.sql"; rm -f supabase/.temp/cli-latest; }
```

Pass = the output's error is `SMOKE OK: premium; nothing was saved`. Any other error names the failing rule. After a rehearsal, `select to_regclass('public.subscriptions')` must still be null.

## Review Focus

Failure modes the spec implies; each has a test in the task that owns the code.

1. An event for an id that is not a UUID, or has no profile (anonymous RevenueCat id, deleted account): answered 200, recorded `unknown_user`, no RevenueCat call. (Task 5)
2. RevenueCat's API fails or times out: 500 and outcome `failed`, so RevenueCat retries; the retry re-runs instead of being skipped as a repeat. (Task 5)
3. An active entitlement with no expiry (a promotional grant) means open-ended access, not no access. (Task 4; Task 2 stores `'infinity'`)
4. A refunded subscription whose period has not ended: access closes at once, and write grace counts from then. (Tasks 2, 4)
5. A client calling the API directly: writing `subscriptions`, inserting `content_requests`, executing the server-only functions, or reading `premium_settings` is refused. (Tasks 2, 3)

---

### Task 1: Panel: the bell tolerates notice kinds it does not know

Stage 0. Must ship before Task 3's migration is applied, because a `content_requested` notice would otherwise break the bell.

**Files:**
- Modify: `../hokage-web-panel/src/lib/notices.ts` (`describeNotice`)

**Interfaces:**
- Produces: `describeNotice(n: CoachNotification): NoticeView` never returns `undefined`, whatever `n.kind` is.

- [ ] **Step 1: Add a `default` branch** to the `switch` in `describeNotice` returning `{ tone: 'info', title: 'Novedad', detail: '', href: page() }` (the client's page). The type of `n.kind` is `never` there; do not read it.
- [ ] **Step 2: Verify the panel still builds.** Run in `../hokage-web-panel`: `npm run build`. Expected: exit 0 (tsc and vite).
- [ ] **Step 3: Commit in the panel repo, do not push.** `fix(notices): don't break the bell on a notice kind it doesn't know yet`. Tell the owner it is waiting for a push they approve.

---

### Task 2: Access plumbing: tables, the rule, the switch, the writers

**Files:**
- Create: `supabase/migrations/20261123120000_premium_access.sql`
- Create: `supabase/scripts/smoke_premium.sql` (sections 1–6; Task 3 adds 7–11)

**Interfaces:**
- Produces (tables): `premium_settings(id boolean pk default true check (id), enforced boolean not null default false, updated_at)`; `subscriptions(user_id pk → profiles cascade, product_id, store, environment, status, is_premium, will_renew, started_at, current_period_started_at, expires_at, grace_expires_at, access_until, rc_app_user_id, last_event_id, last_event_at, last_synced_at, updated_at)`; `revenuecat_events(event_id pk, event_type, app_user_id, event_at, payload jsonb, received_at, outcome default 'received' check in (received|synced|ignored|unknown_user|failed), error)`.
- Produces (functions, all `security definer`):
  - server-only: `premium_enforced() → boolean`; `premium_source_for(p_user uuid) → text` (`'coach'|'subscription'|'membership'|null`, switch ignored, the one place the rule lives); `premium_access_for(p_user uuid) → boolean` (`not enforced or source is not null`); `premium_content_access_for(p_user uuid) → boolean`; `is_being_coached(p_user uuid) → boolean`.
  - policy predicates, executable by `anon` and `authenticated`: `has_premium_access() → boolean`, `premium_content_access() → boolean` (the `_for(auth.uid())` forms).
  - for the app, `authenticated` only: `get_my_access() → jsonb` with keys `enforced, has_access, source` (`'open'` when not enforced and no real source), `subscription` (the row's status, store, product_id, environment, is_premium, will_renew, started_at, current_period_started_at, expires_at, grace_expires_at, access_until, last_synced_at, or null), `membership` (`{status, expires_at}` or null), `has_program, has_nutrition_plan, has_supplement_plan` (an active non-template row exists; flags only). Returns null when not signed in.
  - for the panel, `authenticated` only, raises `42501` unless `is_coach()`: `coach_client_access() → table(client_id uuid, has_access boolean, source text, being_coached boolean)`, one row per `role = 'user'` profile.
  - writers, `service_role` only: `record_revenuecat_event(p_event_id text, p_event_type text, p_app_user_id text, p_event_at timestamptz, p_payload jsonb) → text` (`'new'|'repeat_done'|'repeat_retry'`, `repeat_done` when the stored outcome is `synced|ignored|unknown_user`); `finish_revenuecat_event(p_event_id text, p_outcome text, p_error text default null) → void`; `apply_subscription_snapshot(p_user uuid, p_patch jsonb, p_fetched_at timestamptz, p_event_id text default null, p_event_at timestamptz default null) → text` (`'applied'|'stale'|'skipped'`).
- Patch contract (Task 4 produces it, this function consumes it): `jsonb` with `product_id, store, environment, status, is_premium, will_renew, started_at, current_period_started_at, expires_at, grace_expires_at, access_until, rc_app_user_id`; `access_until` may be the string `'infinity'`; `product_id`/`store` may be null.
- Also: `memberships` and `subscriptions` join `supabase_realtime`; RLS on `subscriptions` (owner and coach read; nobody else), `premium_settings` and `revenuecat_events` (no policies); grants per the Global Constraints.

- [ ] **Step 1: Prove the rehearsal rolls back.** Run it once with a probe file (`begin; create table public.zz_probe(id int); do $$ begin raise exception 'PROBE'; end $$; rollback;`) through the same `db query` call, then check `select to_regclass('public.zz_probe')` is null. If it is not, stop and tell the owner.
- [ ] **Step 2: Write smoke sections 1–6** in the repo's smoke style (`do $$ … $$`, borrow a coach and a client, `assert` per rule, forged claims `set_config('request.jwt.claims', …)` + `set local role authenticated`; end with `raise exception 'SMOKE OK: premium; nothing was saved'`). The section-6 end marker moves to the last section when Task 3 extends the script. Sections:
  1. Switch row exists, `enforced` is false; with it off `has_premium_access()` is true for a client with nothing; `authenticated` cannot select `premium_settings` or `revenuecat_events`, nor execute `premium_source_for`, `premium_access_for`, `is_being_coached`, `record_revenuecat_event`.
  2. Rule matrix with `enforced = true`, one assertion each: nothing → false; coach role → true; subscription `is_premium` with `access_until` in the future → true, in the past → false; `is_premium = false` with a future `access_until` → false; membership `active` with no end → true, ending today → true, ended yesterday → false; membership `paused`, `expired`, `cancelled` → false. `premium_source_for` returns the matching source each time.
  3. Content access: subscription ended 71 h ago → true while `premium_access_for` is false; 73 h ago → both false; membership `active` ended 2 days ago → true; 4 days ago → false; membership `paused` → false.
  4. Writers (as the server role): `record_revenuecat_event` → `new`, then `repeat_retry`, then after `finish_revenuecat_event(…, 'synced')` → `repeat_done`; `failed` is `repeat_retry`; `apply_subscription_snapshot` → `applied`; again with an older `p_fetched_at` → `stale` and the row unchanged; with a newer one → `applied`; a null `product_id` and no row → `skipped` and no row; a null `product_id` with a row keeps the stored product and store; `access_until = 'infinity'` is stored; an unknown `p_user` → `skipped`. `authenticated` cannot execute any writer (SQLSTATE `42501`).
  5. RLS: a client reads only their own `subscriptions` row and cannot insert, update or delete it; the coach reads every row.
  6. `get_my_access()` for a client in each state (open, no access, subscription, cancelled-but-active, membership) has the documented keys and `source`; the content flags follow the client's active program and plans, including when `enforced` and access is false; `coach_client_access()` is refused for a client (`42501`) and, for the coach, returns a row per client whose `has_access`, `source` and `being_coached` match the rule; `is_being_coached` equals `(no membership) or status = 'active'` for membership states none, active, paused, expired, cancelled while `enforced` is false.
- [ ] **Step 3: Run the rehearsal; expect a failure** on the first missing object. `rehearse supabase/scripts/smoke_premium.sql`.
- [ ] **Step 4: Write the migration** (`begin; … commit;`, header comment in the repo's style): tables, the functions above, RLS, grants, realtime (guard with a `pg_publication_tables` check, as `20261024130000_coach_notifications.sql` does). `subscriptions.access_until` and `status`/`environment` get check constraints. `apply_subscription_snapshot` is `insert … on conflict (user_id) do update … where subscriptions.last_synced_at <= p_fetched_at`, with `coalesce` keeping the stored `product_id`/`store`, and `found` deciding `applied` vs `stale`.
- [ ] **Step 5: Run the rehearsal; expect `SMOKE OK`.** `rehearse supabase/migrations/20261123120000_premium_access.sql supabase/scripts/smoke_premium.sql`.
- [ ] **Step 6: Commit** `feat(premium): access rule, switch and subscription tables, shipped dark` (migration + script).

---

### Task 3: Requests, the lock, and the coach rules

**Files:**
- Create: `supabase/migrations/20261123130000_premium_requests_and_locks.sql`
- Modify: `supabase/scripts/smoke_premium.sql` (sections 7–11)

**Interfaces:**
- Consumes: Task 2's `has_premium_access()`, `premium_content_access()`, `premium_access_for(uuid)`, `is_being_coached(uuid)`.
- Produces: `content_requests(id, user_id → profiles cascade, kind, status default 'pending', note, created_at, resolved_at, resolved_by)` with a partial unique index on `(user_id, kind) where status = 'pending'`; RLS: a client reads own, the coach `for all`; grants `select` and `update (status, resolved_at, resolved_by)` to `authenticated`, nothing to `anon`; in `supabase_realtime`. `request_content(p_kind text, p_note text default null) → public.content_requests`, `authenticated` only, raising by message: `premium_required` (SQLSTATE `42501`, also for the coach and the signed-out), `invalid_kind`, `note_too_long`, `already_assigned` (an active non-template row of that kind exists for the caller); a second call while one is pending returns that row. Triggers: `fulfil_content_request()` after insert or `update of status` on `programs` and `nutrition_plans` when the row is active, assigned (`user_id` not null) and not a template, marking that user's pending request of that kind `fulfilled` (`resolved_at = now()`); `notify_content_requested()` after insert writing the `coach_notifications` row (never raises: `exception when others` → `raise warning`, as `notify_coach_day_completed` does). `coach_notifications_kind_check` gains `content_requested`. Restrictive lock policies on the 11 read tables (`programs, program_weeks, program_days, program_exercises, nutrition_plans, nutrition_plan_meals, nutrition_plan_options, nutrition_plan_option_items, nutrition_plan_targets, supplement_plans, supplement_plan_items`) and on the 5 write tables (`program_exercise_completions, workout_set_logs, supplement_intake_logs, meals, meal_items`; insert, update and delete each). `create_coach_daily_notices()` and `send_block_ending_pushes()` redefined with the same body except: the `left join public.memberships m …` is removed and `and (m.client_id is null or m.status = 'active')` becomes `and public.is_being_coached(p.user_id)`.

- [ ] **Step 1: Extend the smoke script, sections 7–11.**
  7. `request_content`: signed out → refused; the coach → refused; enforced and no access → `premium_required`; with access: creates a `pending` row for each kind; a second call returns the same id; `invalid_kind`; a 501-char note → `note_too_long`; with an active program in place → `already_assigned`; a client's direct `insert`, `update` and `delete` on `content_requests` are refused; the `content_requested` notice exists once, with the dedupe key and `data` carrying `kind`, `request_id`, `note`; the coach can set `status = 'dismissed'`.
  8. Fulfilment: the coach assigns an active program to the client → their pending `program` request is `fulfilled` with `resolved_at` set; a nutrition plan does the same for `nutrition_plan`; a template, a supplement plan, or another client's assignment change nothing; a request made after the assignment is refused (`already_assigned`).
  9. The lock, `enforced = true`, a client without access, with a program, a nutrition plan and a supplement plan in place: every one of the 11 tables returns 0 rows to them and the full rows to the coach; granting access (a membership) returns the rows; history reads (`workout_set_logs`, `program_exercise_completions`, `meals`, `meal_items`, `supplement_intake_logs`, `body_measurements`) still return the client's rows without access.
  10. The grace, then the lock: within 72 h of the end the 11 tables are still readable and the 5 writable (check-offs and sets name a real `program_exercise_id`, which the stamp triggers require) while `get_my_access()` says `has_access = false`; after it, reads return nothing, inserts are refused (SQLSTATE `42501`), updates and deletes change 0 rows; `body_measurements` and `profiles` writes are never refused.
  11. Dark: with `enforced = false` a client without access reads all 11 tables and writes all 5; both redefined jobs' source (`pg_get_functiondef`) contains `is_being_coached` and no `memberships`; the coach jobs' selection while off equals the old rule (covered by section 6's `is_being_coached` check).
- [ ] **Step 2: Fetch the live bodies of the two jobs** (`select pg_get_functiondef('public.create_coach_daily_notices'::regproc)` and `…send_block_ending_pushes…` through `db query --read-only`), diff them against `20261024130000_coach_notifications.sql` and `20261106140000_plan_update_and_block_end_pushes.sql`, and base the redefinition on whichever matches the live one. Stop and tell the owner if the live body differs from both.
- [ ] **Step 3: Run the rehearsal with both migrations; expect failures** on the missing objects. `rehearse supabase/migrations/20261123120000_premium_access.sql supabase/scripts/smoke_premium.sql`.
- [ ] **Step 4: Write the migration**, the lock policies in a `do $$ … foreach … format(…) $$` block over the table lists (drop then create each, so it re-runs).
- [ ] **Step 5: Run the rehearsal; expect `SMOKE OK`.** `rehearse supabase/migrations/20261123120000_premium_access.sql supabase/migrations/20261123130000_premium_requests_and_locks.sql supabase/scripts/smoke_premium.sql`.
- [ ] **Step 6: Run the existing smoke script that exercises the changed jobs** against the new objects: `rehearse supabase/migrations/20261123120000_premium_access.sql supabase/migrations/20261123130000_premium_requests_and_locks.sql supabase/scripts/smoke_plan_pushes.sql`. Expect its own `SMOKE OK: plan pushes; nothing was saved`: it borrows a client by the old rule, which is unchanged while the switch is off.
- [ ] **Step 7: Commit** `feat(premium): requests, the lock and the coach rules behind the switch`.

---

### Task 4: Pure modules: secrets, signatures, RevenueCat mapping

**Files:**
- Create: `supabase/functions/_shared/secret.ts`, `supabase/functions/_shared/revenuecat.ts`
- Modify: `supabase/functions/estimate-meal/index.ts` (import `sameSecret` instead of its local copy)
- Test: `src/utils/secret.test.ts`, `src/utils/revenuecat.test.ts`

**Interfaces:**
- Produces, `secret.ts`: `sameSecret(a: string, b: string): boolean` (constant-time, the body moved from `estimate-meal`); `verifySignature(header: string | null, rawBody: string, secret: string, nowSeconds: number, toleranceSeconds?: number): Promise<boolean>` (default 300; uses `crypto.subtle`).
- Produces, `revenuecat.ts`:
  - `type RcEvent = { id: string; type: string; app_user_id?: string; original_app_user_id?: string; aliases?: string[]; transferred_from?: string[]; transferred_to?: string[]; event_timestamp_ms?: number; [k: string]: unknown }`
  - `parseWebhook(body: unknown): { ok: true; event: RcEvent } | { ok: false; reason: string }` (needs an object with an `event` object holding string `id` and `type`)
  - `isUuid(s: string): boolean`
  - `type EventPlan = { action: 'ack' } | { action: 'ignore' } | { action: 'sync'; userIds: string[]; unknownIds: string[] }`
  - `planEvent(event: RcEvent): EventPlan` — `TEST` → ack; the types that trigger a re-read (`INITIAL_PURCHASE, RENEWAL, CANCELLATION, UNCANCELLATION, EXPIRATION, BILLING_ISSUE, PRODUCT_CHANGE, SUBSCRIPTION_PAUSED, SUBSCRIPTION_EXTENDED, REFUND_REVERSED, TEMPORARY_ENTITLEMENT_GRANT`) → sync the UUIDs among `app_user_id`, then `original_app_user_id`, then `aliases` (deduplicated, in that order); `TRANSFER` → the UUIDs in `transferred_from` and `transferred_to`; anything else → ignore. `unknownIds` collects the non-UUID ids seen.
  - `type SubscriptionPatch` — the patch contract of Task 2, with `environment: 'production' | 'sandbox'`, `status: 'active' | 'cancelled' | 'billing_issue' | 'expired'`.
  - `patchFromSubscriber(subscriber: unknown, appUserId: string, now: Date): SubscriptionPatch` — `subscriber` is the `subscriber` object of `GET /v1/subscribers/{id}`; the rules are the spec's mapping table, entitlement id `premium_access`; never throws on missing or odd fields.

- [ ] **Step 1: Write `secret.test.ts`.** `sameSecret`: equal → true; different; different lengths; empty vs set → false. `verifySignature`: a header built with the same algorithm → true; wrong secret; tampered body; timestamp 301 s old; timestamp 301 s in the future; `null`, empty, and `t=1` (no `v1`) headers → false.
- [ ] **Step 2: Write `revenuecat.test.ts`.** `parseWebhook`: a real-shaped envelope → ok; `null`, a string, no `event`, no `event.id` → not ok with a reason. `planEvent` (one assertion each): `INITIAL_PURCHASE` with a UUID `app_user_id` → sync `[that id]`; `app_user_id: '$RCAnonymousID:abc'` with a UUID in `aliases` → sync `[the alias]` and `unknownIds` has the anonymous id; a non-UUID only → sync with no `userIds`; `TRANSFER` (no `app_user_id`) → the UUIDs of both arrays; `TEST` → ack; `NON_RENEWING_PURCHASE`, `EXPERIMENT_ENROLLMENT`, `SUBSCRIBER_ALIAS` → ignore; every re-read type → sync. `patchFromSubscriber` with fixtures (build `now` fixed): monthly active → `active`, `will_renew` true, `access_until = expires`; cancelled (`unsubscribe_detected_at` set, period in the future) → `cancelled`, `is_premium` true, `will_renew` false; billing issue inside a grace window → `billing_issue`, `access_until` = the grace end; billing issue with the grace already passed → `expired`; expiry in the past → `expired`, `is_premium` false, `access_until <= now`; refunded (`refunded_at` set, expiry in the future) → `is_premium` false and `access_until` equals `now`; promotional entitlement with no `expires_date` and no subscriptions entry → `is_premium` true, `access_until` `'infinity'`, `store` `'unknown'`; no entitlements and no subscriptions → `product_id` null, `expired`; `is_sandbox` true → `environment` `'sandbox'`; quarterly and annual product ids pass through unchanged; garbage input (`null`, `{}`, strings where objects belong) → an `expired` patch, no throw.
- [ ] **Step 3: Run `npm test`; expect the new tests to fail** (modules missing).
- [ ] **Step 4: Implement `secret.ts` and `revenuecat.ts`** as signatures above; `verifySignature` computes HMAC-SHA256 over `` `${t}.${rawBody}` `` and compares hex in constant time. Date comparisons use `Date.parse` on the ISO strings RevenueCat sends.
- [ ] **Step 5: Point `estimate-meal/index.ts` at `../_shared/secret.ts`** and delete its local `sameSecret` (behavior unchanged).
- [ ] **Step 6: Run `npm test`; expect all green.**
- [ ] **Step 7: Commit** `feat(premium): RevenueCat event and customer mapping, shared secret helpers`.

---

### Task 5: The handler: webhook and sync logic, with fakes

**Files:**
- Create: `supabase/functions/_shared/subscription-sync.ts`
- Test: `src/utils/subscription-sync.test.ts`

**Interfaces:**
- Consumes: Task 4's `sameSecret`, `verifySignature`, `parseWebhook`, `planEvent`, `patchFromSubscriber`, `isUuid`, `RcEvent`, `SubscriptionPatch`.
- Produces:
  - `type SyncDeps = { now(): Date; fetchSubscriber(appUserId: string): Promise<unknown>; applySnapshot(userId: string, patch: SubscriptionPatch, fetchedAt: Date, eventId: string | null, eventAt: Date | null): Promise<'applied' | 'stale' | 'skipped'> }` (`fetchSubscriber` returns the `subscriber` object and throws on a non-2xx answer)
  - `syncUser(deps: SyncDeps, userId: string, eventId?: string | null, eventAt?: Date | null): Promise<'applied' | 'stale' | 'skipped'>` — takes `fetchedAt = deps.now()` *before* fetching.
  - `type WebhookDeps = SyncDeps & { secret: string | undefined; signingSecret: string | undefined; recordEvent(event: RcEvent, payload: unknown): Promise<'new' | 'repeat_done' | 'repeat_retry'>; finishEvent(eventId: string, outcome: 'synced' | 'ignored' | 'unknown_user' | 'failed', error?: string): Promise<void>; existingProfiles(ids: string[]): Promise<Set<string>> }`
  - `handleWebhook(deps: WebhookDeps, req: { method: string; authorization: string | null; signature: string | null; rawBody: string }): Promise<{ status: number; body: Record<string, unknown> }>`
  - `type OwnSyncDeps = SyncDeps & { takeSlot(userId: string): Promise<boolean> }`; `syncOwnAccount(deps: OwnSyncDeps, userId: string): Promise<'cooldown' | 'applied' | 'stale' | 'skipped'>` — `'cooldown'` when `takeSlot` says the user synced a few seconds ago.

- [ ] **Step 1: Write `subscription-sync.test.ts`** with in-memory fakes recording their calls. Cases, one assertion group each: `GET`/other method → 405; `secret` undefined → 503 (nothing else called); wrong or missing `Authorization` → 401; `signingSecret` set with a bad or missing signature → 401, with a good one → proceeds, and unset → the signature is not checked; unparseable JSON → 400; no `event.id` → 400; `TEST` → 200, recorded then finished `ignored`; `repeat_done` → 200 `{duplicate: true}` and no sync; `repeat_retry` → runs again; an ignored type → 200, `ignored`; ids with no existing profile (or none that are UUIDs) → 200, `unknown_user`, `fetchSubscriber` never called (Review Focus 1); one known user → `fetchSubscriber` called with that id, `applySnapshot` with the patch, `fetchedAt` earlier than or equal to the fetch's completion, outcome `synced`, 200; `TRANSFER` → both users synced; `fetchSubscriber` throws → 500, outcome `failed` with the message, and the other user in the event is still attempted (Review Focus 2); `applySnapshot` returning `stale` → still `synced`, 200; `syncOwnAccount` within 10 s → `cooldown` and no fetch, 11 s → fetches.
- [ ] **Step 2: Run `npm test`; expect the new file to fail** (module missing).
- [ ] **Step 3: Implement `subscription-sync.ts`.** Order in `handleWebhook`: method, secret configured, `Authorization`, signature, JSON, `parseWebhook`, `recordEvent`, `planEvent`, `existingProfiles`, sync each known user collecting failures, `finishEvent`. All user syncs are attempted before answering 500.
- [ ] **Step 4: Run `npm test`; expect all green.**
- [ ] **Step 5: Commit** `feat(premium): webhook and on-demand sync handlers`.

---

### Task 6: The two Edge Functions and the deploy

**Files:**
- Create: `supabase/functions/revenuecat-webhook/index.ts`, `supabase/functions/sync-subscription/index.ts`
- Modify: `.github/workflows/deploy-functions.yml`

**Interfaces:**
- Consumes: Task 5's `handleWebhook`, `syncOwnAccount`, deps types; `adminClient()` and `callerClient()` from `../_shared/coach.ts`; `withCors` and `json` from `../_shared/cors.ts`; Task 2's writers.
- Produces: `revenuecat-webhook` (no JWT; reads `Deno.env` `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_WEBHOOK_SIGNING_SECRET`, `REVENUECAT_API_KEY`; wires `fetchSubscriber` to `GET https://api.revenuecat.com/v1/subscribers/<encoded id>` with `Authorization: Bearer <key>` and a 20 s `AbortSignal.timeout`, and the database deps to the writers above via the service-role client; `existingProfiles` selects `profiles.id in (…)`); `sync-subscription` (JWT via `callerClient(req).auth.getUser()`; 401 when absent; 503 when `REVENUECAT_API_KEY` is unset; 502 when RevenueCat fails; returns `callerClient(req).rpc('get_my_access')` as JSON; `takeSlot` calls `take_subscription_sync` with the service role).

- [ ] **Step 1: Write both `index.ts` files** thin: read env, build deps, call the handler, return `json(...)`. No logic beyond wiring.
- [ ] **Step 2: Add to `deploy-functions.yml`** `sync-subscription` to the normal loop, and a block deploying `revenuecat-webhook` with `--no-verify-jwt` after `estimate-meal`'s, with the same `::group::` style; update the header comment's secrets list.
- [ ] **Step 3: Type-check what can be.** Try `npx -y deno check supabase/functions/revenuecat-webhook/index.ts supabase/functions/sync-subscription/index.ts`. Expected: no errors. If Deno cannot be fetched here, say so in the report and rely on the deploy workflow's first run plus Task 7's live probes; do not claim these two files were type-checked.
- [ ] **Step 4: Commit** `feat(premium): revenuecat-webhook and sync-subscription Edge Functions`.

---

### Task 7: Docs, the full rehearsal, and the review

**Files:**
- Modify: `docs/ADMIN_WEB_DB_CONNECTION.md` (new §6.7 «Premium subscriptions», and the new tables in §8)
- Create: nothing else

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write §6.7**: what the two functions are and their URLs; the three secrets and where each comes from (set them with `supabase secrets set … --project-ref rzgwkwxskrovxnnymxqo`; the webhook's Authorization value is `REVENUECAT_WEBHOOK_SECRET`); the deploy (a push to `main`); the switch (`select enforced from public.premium_settings`, `update public.premium_settings set enforced = true|false`); the three smoke commands; live probes after deploy (`curl -i -X POST <url>` with no header → `401`, with a wrong one → `401`, and with no secret configured → `503`); the order for going live (panel Task 1 pushed, migrations applied, secrets set, then later the switch). In §8 add one line per new table.
- [ ] **Step 2: Run the full rehearsal** with both migrations and the full smoke script; expect `SMOKE OK: premium; nothing was saved`. Run `smoke_plan_pushes.sql` the same way (with both migrations) and expect its `SMOKE OK`.
- [ ] **Step 3: Run `npm test` and `npm run lint`;** expect all tests green and no new lint errors.
- [ ] **Step 4: Prove nothing was applied.** `select to_regclass('public.subscriptions'), to_regclass('public.premium_settings'), to_regclass('public.content_requests')` → all null; `git status -s` shows only the intended files and no `supabase/.temp/cli-latest`.
- [ ] **Step 5: Commit** `docs(premium): subscriptions section of the DB guide`. Also commit the spec and this plan if not yet committed (`docs(premium): design and server plan`).
- [ ] **Step 6: One fresh reviewer on the whole branch** (the most capable model, given the spec, this plan and `git diff <base>..HEAD`): look for correctness bugs, RLS holes, rules that differ from the spec, tests that cannot fail. Fix what is real, re-run Steps 2–4.
- [ ] **Step 7: Stop and report to the owner.** What exists, what was verified and how (rolled-back rehearsals, unit tests), what was not (Deno type-check if unavailable, any live probe), and the go-needed list: push the panel commit, push the app commits (deploys both functions; they answer 503 until the secrets exist), apply the two migrations with `db query --yes -f`, set secrets, and, once applied, add the Premium bullet to `CLAUDE.md` and `AGENTS.md` in one commit (they must stay identical). Nothing from that list happens without the owner's go.


---

## Execution record (2026-11-23)

Executed inline on `main` (the repo's rule: no branches or worktrees). App repo commits: `29467de` design and plan, `a6d88b7` Task 2, `c80ffbb` Task 3, `c330721` Task 4, `5cb0d91` Task 5, `51f788f` Task 6, `4251d1f` Task 7 docs, `4de6efb` the review's fixes. Panel repo: `50dc5f5` Task 1. At the end of execution nothing was pushed or applied; the rollout is recorded at the end of this section.

Verified: `supabase/scripts/smoke_premium.sql` (sections 1-15) passes as a rolled-back rehearsal on the live schema, and the live project still has none of the new objects afterwards; `smoke_plan_pushes.sql` and `smoke_meal_registrations.sql` still pass with both migrations in place; `npm test` 508/508; `npm run lint` 0 errors; `deno check` passes for `revenuecat-webhook`, `sync-subscription` and `estimate-meal` (run on a copy of `supabase/functions` outside the repo, because Deno picks up the repo's `package.json` and expects `node_modules`). One independent whole-branch review found no Critical issue; its six Important findings were fixed test-first (see the last commit).

### Rulings made during execution

- Content reads share the 72-hour grace with writes (`premium_content_access`, renamed from `premium_write_access`): the stamp triggers read `program_exercises` as the client, so a write grace under an immediate read lock cannot work. Spec decision 6 amended. The app still shows the locked state the moment access ends.
- The two coach jobs in migration 2 are generated from the repo's own definitions (equal to live) with exactly two edits each.
- Two shared modules the plan did not list: `_shared/revenuecat-client.ts` and `_shared/subscription-deps.ts`. A 200 from RevenueCat without a `subscriber` is an error to retry, never "no access".
- Review fixes: a revoked row's end of access never moves forward (the grace is counted once); every event type re-reads except `TEST` and three irrelevant ones; the sync cooldown is a per-user slot (`take_subscription_sync`); `access_ends_at` is computed in SQL; `content_requests` is granted to the service role.
- The optional webhook signature is handled by documentation: enable it only after a real delivery passes with it.
- Declined-to-judge, ruled to stand: sandbox purchases grant Premium on production (spec decision 12); legacy routines, meals and the exercise catalog stay readable to a locked client; a locked client cannot log, edit or delete meals after the grace; a membership set to paused/expired/cancelled gets no grace; assign and update pushes still reach locked clients; `revenuecat_events` has no retention; ordering by fetch start time may discard a slow answer; `sync-subscription` refuses browser origins outside `ALLOWED_ORIGINS`; `CLAUDE.md`/`AGENTS.md` get their Premium bullet when the migrations are applied; the panel commit must be live before migration 2.

### Deferred minors

- Google base plans: REST v1 may report the base plan separately (`product_plan_identifier`), so the three Google plans could share one `product_id`.
- `refunded_at` counts even if RevenueCat keeps it after a re-purchase of the same product.
- `will_renew` is true for promotional and open-ended grants.
- A stale `expires_at` survives an open-ended grant (`access_until = infinity` beside a past date).
- The webhook reads the body and builds an admin client before checking the method and secret.
- `sync-subscription` answers 502 for a database failure too.
- `request_content`'s race branch can return a null row (negligible).
- Sequential re-reads at 20 s each can pass RevenueCat's 60 s on a transfer with several ids.
- Untested wiring: the two `index.ts` files, `subscription-deps.ts`, the subscription-grace branch through the policies, and the coach jobs' equivalence by running them.
- Section 6.7 does not say that sandbox purchases grant real access here, nor that a paused/expired/cancelled membership locks at once.
- Every RevenueCat fixture is hand-written.

### Rollout (2026-11-23, after the owner's go)

Pushed: panel `50dc5f5`, app `8235fae..2d161e3`. The deploy workflow succeeded: `revenuecat-webhook` v1 (JWT verification off), `sync-subscription` v1, `estimate-meal` v4. Applied to the live project, in order: `20261123120000_premium_access.sql`, then `20261123130000_premium_requests_and_locks.sql`; `premium_settings.enforced` is `false`.

Checked on the applied state: `smoke_premium.sql`, `smoke_plan_pushes.sql` and `smoke_meal_registrations.sql` all pass (rolled back, with identical row counts before and after); 11 read locks, 15 write locks, 3 triggers, the notice kind, both coach jobs and realtime for the three tables are in place; Supabase's advisors flag nothing actionable in the new objects (server-only tables with RLS and no policies, the RPC functions, the project's usual client-plus-coach permissive policies, an unused index on a new table). Live probes: the webhook answers 503 until its secret is set and 405 to a GET; `sync-subscription` is refused at the gateway without a token; `estimate-meal` still answers 401 without its secret.

Still to do: create the RevenueCat project, then set `REVENUECAT_WEBHOOK_SECRET` and `REVENUECAT_API_KEY` and configure the webhook (§6.7); plans 2 (app) and 3 (panel).

### Before the switch is turned on

Capture one real `GET /v1/subscribers` body per store from the sandbox (active, cancelled, refunded, promotional, transferred away) and add them as fixtures; check the Google base-plan and refund questions above against them; confirm a real signed delivery before enabling `REVENUECAT_WEBHOOK_SIGNING_SECRET`; give every client who should keep access a membership.
