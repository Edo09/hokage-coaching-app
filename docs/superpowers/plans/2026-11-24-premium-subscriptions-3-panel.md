# Premium subscriptions · Plan 3 of 3: the coach panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The coach's half of Premium: content requests in the Dashboard, the bell and the client page; «Solicitud» and «Sin acceso» in the lists; «Dar acceso» in the client header; the store subscription read-only beside the manual membership; counts and attention rules that follow access; «Dar acceso ahora» in Add client. All of it invisible while `premium_settings.enforced` is false, apart from facts that exist as data (a request, a subscription row).

**Architecture:** Pure rules in `src/lib/*.ts` under `node:test` (the panel had no test runner; Task 1 adds a zero-dependency one). Reads go through `src/services/*`: the access list from `rpc('coach_client_access')` and the switch from `rpc('get_my_access').enforced`, subscriptions and pending requests as batched queries merged into `ClientSummary` / `ClientWithMeta`. UI pieces are small shared components that the existing pages mount. Nothing new on the server: every object this plan touches is applied (stage 1).

**Tech Stack:** Vite + React 18 + TypeScript (strict), Tailwind v3, react-query, supabase-js, `node:test` (Node's type stripping) for `.ts` modules; `.tsx` is checked by `tsc`, lint, the build and a browser harness.

**Spec:** `docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md` (this repo): «The panel» (lines 388-412), «Staged delivery» step 3, «Calls made in design», «Copy (es)». Plans 1 and 2 (same folder) hold the server and app records. All paths below are in the panel repo (`../hokage-web-panel`) unless prefixed `app:`.

## Global Constraints

- **Dark.** While `enforced` is false the panel looks and counts as before. What the server really answers then (read from `20261123120000_premium_access.sql`, live state read-only on 2026-11-24: `enforced = false`, 3 coached clients, 1 membership (active, no end), 0 subscriptions, 0 requests, 0 `content_requested` notices): `coach_client_access()` gives every client `has_access = true`; `source` is the real source (null for a client with no membership and no subscription: 2 of the 3); `being_coached` is the old rule (no membership row, or status `active`). It does not say whether the switch is on: the panel reads that from `rpc('get_my_access').enforced` (the coach may call it).
- **«Sin acceso»** only when `enforced && !has_access`. Never from `source == null`.
- **«Clientes activos»** is `membership.status = 'active'` while off (live: 1, not 3) and `has_access` while on. The attention rules use `being_coached` (equal to the old `status === 'active' || no membership` while off).
- **No server change.** Dismissing a request is `update content_requests set status, resolved_at, resolved_by` as the coach (the coach policy and that column grant exist; `smoke_premium.sql` §7 proves it). «Dar acceso» and «Dar acceso ahora» are the coach's own `memberships` upsert. Not a migration, not a deploy.
- **Reads:** `subscriptions` (select; coach RLS), `content_requests` (select pending), notice kind `content_requested` with `data = {kind, request_id, note}`. Request kinds `program | nutrition_plan`; statuses `pending | fulfilled | dismissed`; subscription statuses `active | cancelled | billing_issue | expired`; `access_until` may be the string `'infinity'`.
- **Copy (es) pinned by the spec:** «Solicitó un programa», «Solicitó un plan de nutrición», «Crear programa», «Crear plan», «Descartar», «Solicitud», «Sin acceso», «Dar acceso», «Dar acceso ahora». Everything else is authored here; subscription words mirror the app's card (Activa, Cancelada, Problema de pago, Vencida, «Se renueva el …», «Termina el …», «Terminó el …», «Compra de prueba (sandbox)»).
- **Panel conventions:** the UI reads data only through `src/services/*`; query keys in `qk`; `cn()`; Spanish UI; the existing Dojo components (`Button`, `Card`, `FilterChips`, `Switch`, `AlertDialog`…); no brand name in code.
- **Tests** cover pure `.ts` modules (Node cannot strip JSX); `.tsx` is verified by `tsc`, lint, build and the browser harness. A test file imports `describe, it` from `node:test` and `assert` from `node:assert/strict`.
- **Git.** Panel: commit to `main` per task, `git add` named files, trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`, **never push without asking**. App repo: commit and push to `origin/main`. No branches. `CLAUDE.md` and `AGENTS.md` identical in each repo (change both in one commit).
- **Baselines (2026-11-24, panel):** `npm run lint` clean, `npx tsc --noEmit` 0 errors, `npm run build` passes, no tests. Target: nothing new, tests green.

## Calls made in this plan (the spec left them open; veto any)

1. **A test runner for the panel** (`node:test` + a small resolver, the app's approach). The panel had none; its earlier plans verified in a browser only. Cost if wrong: a `scripts/` folder and one `package.json` line.
2. **The switch is read from `get_my_access().enforced`**, because `coach_client_access()` cannot say it. If either RPC fails the panel falls back to the old rules (the dark behavior) and logs a warning. Cost if wrong: one more RPC per list load.
3. **The count uses `has_access` only when the switch is on.** The spec says `being_coached`, which while off counts the clients with no membership: the tile would go from 1 to 3 on the live data while dark. The attention rules do use `being_coached`.
4. **Batched fetchers, not PostgREST embeds**, for subscriptions and pending requests (the spec names `subscriptions!user_id` / `content_requests!user_id`): `clients.ts` documents that convention, an embedded filter cannot be tried without a coach session, and the cost is two more parallel queries. A failed requests or subscriptions read is an error (shown, retry), a failed access read is not.
5. **«Dar acceso» in the header is the 30-day renewal** (`renewMembership`) behind a confirmation, like the Memberships page. «Dar acceso ahora» in Add client is written by the panel after `create-client` returns (no function change); if that write fails the account and its password still appear, with a warning. It is on by default even while dark (spec call 16): a client added now shows «Activa · Sin vencimiento» and counts as active. Untick to skip.
6. **Quiet when there is nothing:** Clients shows its chips row only while a request is pending (or that filter is on); the access line of the Membresía tab and the «Sin acceso» pills exist only while the switch is on; a subscription shows whenever its row exists.
7. **Not built:** Realtime for `content_requests` (the bell is live; lists refetch after 60 s or on a new visit), a locked-client attention item, retention.
8. **The app's «Solicitar …» comes back in release builds as the last task**, its own commit (Task 11). It reaches users with the next build, which must not be cut before the panel is deployed.

## How the UI is verified (no coach session exists here)

Pure rules: `npm test`. Screens: a throwaway harness that is never committed (`harness.html` + `src/harness/*`, listed in the panel's `.git/info/exclude`): it replaces `window.fetch` and `WebSocket` before the app loads, seeds a far-future session in `localStorage`, and answers the panel's real requests from fixtures (profiles, memberships, routines, notices, `rpc/coach_client_access`, `rpc/get_my_access`, `subscriptions`, `content_requests`, a fake `create-client`), logging each request URL so the filters can be read. Start the `panel` server of `.claude/launch.json`, open `/harness.html?enforced=0|1`, `resize_window` mobile, `colorScheme` dark, read with `get_page_text` and look. Not verifiable here: PostgREST's behavior with a real coach JWT (the queries are the simple shapes the panel already uses), Realtime, the real `create-client`. The access RPCs' live shape is confirmed once with a rolled-back `db query` as a forged coach (Task 5).

## Review Focus

Failure modes the spec implies; each has a test or a browser check in the task that owns it.

1. A client with no membership while the switch is off must not read as locked or uncounted-then-counted: `{has_access: true, source: null, being_coached: true}` is neither «Sin acceso» nor a change to the tile. (Tasks 2, 5)
2. `access_until = 'infinity'`, `expires_at = null` and a row that says `active` after its end date never print «Invalid Date» or a renewal that is not coming. (Task 3)
3. A `content_requested` notice with no note, or a request kind this panel does not know, never breaks the bell (unknown → «Novedad»). (Task 4)
4. A request is top-ranked and listed even when its client is paused, locked or not being coached; two requests from one client are two rows, oldest first. (Task 4)
5. Add client: the account exists but the membership write failed → the password is still shown, with a warning; «Descartar» on a request the DB already fulfilled changes nothing and says so. (Tasks 5, 8; browser)

---

### Task 1: A test runner for the panel

**Files:**
- Create: `scripts/test-register.mjs`, `scripts/test-resolve.mjs`, `scripts/test-stubs/supabaseClient.mjs`
- Modify: `package.json` (`"test"` script), `README.md` (one line under «Run it»)
- Test: `src/lib/notices.test.ts`

**Interfaces:**
- Produces: `npm test` = `node --import ./scripts/test-register.mjs --test "src/**/*.test.ts"`. The resolver maps `@/…` to `src/…`, tries `""`, `.ts`, `/index.ts` for extensionless imports from files under the repo, loads `.ts` as `module-typescript`, and answers `@/lib/supabaseClient` with the stub (`export const supabase = new Proxy({}, { get() { throw new Error('supabase is not available in tests') } })`).

- [ ] **Step 1: Write `src/lib/notices.test.ts`** pinning today's `describeNotice` (it changes in Task 4): `day_completed` → tone `success`, title `Completó un día de entreno`, detail `Día A · semana 2 · Fuerza`, href `/clients/c1?tab=tracking`; `inactive` with `days: 7` → `danger`, `days: 3` → `warning`, href `/clients/c1`; `block_ending` and `block_ended` → href `/clients/c1?tab=programs`; a notice whose kind is `'future_kind'` (cast) → `{ tone: 'info', title: 'Novedad', detail: '', href: '/clients/c1' }` (stage 0's default branch).
- [ ] **Step 2: Run `npm test`; expect** «Missing script: test».
- [ ] **Step 3: Write the three scripts and the `package.json` line.** The resolver is `../hokage-coaching-app/scripts/test-resolve.mjs` with the root alias pointing at `src/` and the one stub.
- [ ] **Step 4: Run `npm test`, `npx tsc --noEmit` and `npm run lint`; expect** all green (the root `tsconfig.json` has no `types` list, so `node:test` types resolve; if lint trips over `scripts/*.mjs`, give that glob `globals.node` in `eslint.config.js`).
- [ ] **Step 5: Commit** `test(panel): node:test runner and a regression test for the bell's wording`.

---

### Task 2: The access rules

**Files:**
- Modify: `src/types.ts` (add `AccessSource`, `ClientAccess`)
- Create: `src/lib/access.ts`
- Test: `src/lib/access.test.ts`

**Interfaces:**
- Produces (`types.ts`): `type AccessSource = 'coach' | 'subscription' | 'membership'`; `interface ClientAccess { enforced: boolean; hasAccess: boolean; source: AccessSource | null; beingCoached: boolean; endsAt: string | null }`.
- Produces (`access.ts`):
  - `parseClientAccess(rows: unknown, enforced: boolean): Map<string, ClientAccess>` — rows are `{client_id, has_access, source, being_coached, access_ends_at}`; a malformed row (no string `client_id`, non-boolean flags) is skipped; an unknown `source` becomes `null`; a non-array gives an empty map.
  - `parseEnforced(answer: unknown): boolean` — true only for an object whose `enforced === true`.
  - `isLocked(a: ClientAccess | null | undefined): boolean` — `a.enforced && !a.hasAccess`.
  - `isCoached(membership: { status: MembershipStatus } | null, a: ClientAccess | null | undefined): boolean` — `a ? a.beingCoached : membership == null || membership.status === 'active'`.
  - `isActiveClient(c: { membership: { status: MembershipStatus } | null; access?: ClientAccess | null }): boolean` — `c.access?.enforced ? c.access.hasAccess : c.membership?.status === 'active'`.
  - `type AccessSummary = { kind: 'locked' } | { kind: 'granted'; source: 'subscription' | 'membership'; endsAt: string | null }`; `accessSummary(a): AccessSummary | null` — null unless `a.enforced`; `granted` only for source `subscription` or `membership`.

- [ ] **Step 1: Write `access.test.ts`.** `parseClientAccess` on the live shape (`{has_access: true, source: null, being_coached: true}` for a client with no membership; `source: 'membership'` for the third) keeps both; skips malformed rows. `parseEnforced`: `{enforced: true}` true; `{enforced: false}`, `null`, `{}`, `{enforced: 'true'}` false. `isLocked`: only `(enforced, hasAccess) = (true, false)` is locked; `null` and `undefined` are not; **the trap**: `{enforced: false, hasAccess: true, source: null, beingCoached: true}` is not locked, and neither is `{enforced: false, hasAccess: false}`. `isCoached` with `null` access over membership none, active, paused, expired, cancelled gives true, true, false, false, false, and equals the old panel expression `status === 'active' || status == null` for every one; with an access that is not enforced it follows `beingCoached`; with `enforced` and `beingCoached: false` it is false even for an `active` membership. `isActiveClient` over the live roster (no membership, no membership, active) with `enforced: false` counts exactly 1; a paused one is not counted; with `enforced: true` it follows `hasAccess` (a subscription-only client counts, an active-but-lapsed membership does not); a missing `access` falls back to the membership rule. `accessSummary`: null when not enforced or missing; `granted` with source and `endsAt`; `locked`.
- [ ] **Step 2: Run `npm test`; expect** the file to fail (module missing).
- [ ] **Step 3: Implement** `access.ts` and the two types as above; pure, no imports but types.
- [ ] **Step 4: Run `npm test`; expect** all green.
- [ ] **Step 5: Commit** `feat(access): the panel's access rules, never locked while the switch is off`.

---

### Task 3: Subscription and membership helpers

**Files:**
- Modify: `src/types.ts` (add `SubscriptionStatus`, `Subscription`)
- Create: `src/lib/subscription.ts`, `src/lib/memberships.ts`
- Test: `src/lib/subscription.test.ts`, `src/lib/memberships.test.ts`

**Interfaces:**
- Produces (`types.ts`): `SubscriptionStatus = 'active' | 'cancelled' | 'billing_issue' | 'expired'`; `Subscription { user_id: string; product_id: string; store: string; environment: 'production' | 'sandbox'; status: SubscriptionStatus; is_premium: boolean; will_renew: boolean; started_at: string | null; current_period_started_at: string | null; expires_at: string | null; grace_expires_at: string | null; access_until: string; last_synced_at: string }`.
- Produces (`subscription.ts`): `SUBSCRIPTION_COLUMNS` (the comma list the services select); `grantsAccess(s: Subscription, now: Date): boolean` (`is_premium` and `access_until` is `'infinity'` or after `now`); `storeLabel(store: string): string`; `type SubscriptionView = { status: SubscriptionStatus; statusLabel: string; tone: 'success' | 'warning' | 'danger' | 'muted'; grantsAccess: boolean; storeLabel: string; product: string; sandbox: boolean; dateLabel: string | null; hint: string | null }`; `subscriptionView(s: Subscription, now: Date): SubscriptionView`. `status` is the effective one: a row that says `active`, `cancelled` or `billing_issue` but no longer grants access reads `expired`. Labels: Activa, Cancelada, Problema de pago, Vencida; tones success, warning, warning, muted (a lapsed subscription is history, and may sit beside a membership that still grants access, so it is not red). `dateLabel`: active with `expires_at` → «Se renueva el {fmtDate}»; cancelled or billing issue → «Termina el {fmtDate(access_until)}»; expired → «Terminó el {fmtDate(access_until)}»; `access_until = 'infinity'` → «Sin vencimiento»; active without `expires_at` → null. `hint` only for billing issue: «La tienda no pudo cobrar.». `storeLabel`: `app_store`, `mac_app_store` (any case) → App Store; `play_store` → Google Play; `test_store` → Tienda de pruebas; `promotional` → Promoción; `stripe`, `rc_billing` → Web; `amazon` → Amazon; `unknown` or empty → Tienda; anything else unchanged.
- Produces (`memberships.ts`): `renewedUntil(m: { expires_at: string | null } | null, now: Date, days = 30): Date` (the rule `renewMembership` applies: from the later of `now` and the current end); `openEndedAccess(now: Date): { status: 'active'; started_at: string; expires_at: null }` (`started_at` the local calendar date `YYYY-MM-DD`).

- [ ] **Step 1: Write both test files.** `subscription.test.ts` (fixed `now`; ISO timestamps at midday UTC so the local date cannot slip): monthly active → `Activa`, tone success, `Se renueva el` + the date of `expires_at`; cancelled with a future end → `Cancelada`, grants access, `Termina el …`; billing issue → `Problema de pago`, hint, `Termina el` the `access_until` date; expired → `Vencida`, `Terminó el …`; a row stored `active` whose `access_until` is past → `expired`, not granting, `Terminó el`; `is_premium: false` with a future end → `expired`, not granting; `access_until: 'infinity'` → grants, `Sin vencimiento`, and no `dateLabel` or `hint` contains `Invalid`; active with `expires_at: null` → `dateLabel` null; every store mapping above; `sandbox` follows `environment`. `memberships.test.ts`: `renewedUntil` from a future end adds 30 days to it, from a past end or `null` adds 30 to `now`; custom `days`; `openEndedAccess(new Date(2026, 10, 24, 23, 30))` → `{ status: 'active', started_at: '2026-11-24', expires_at: null }`.
- [ ] **Step 2: Run `npm test`; expect** the two files to fail.
- [ ] **Step 3: Implement** `subscription.ts` (dates through `fmtDate` from `@/lib/utils`) and `memberships.ts`.
- [ ] **Step 4: Run `npm test`; expect** all green.
- [ ] **Step 5: Commit** `feat(subscription): read-only subscription and membership helpers`.

---

### Task 4: Requests: words, the bell and the attention list

**Files:**
- Modify: `src/types.ts` (add `ContentRequestKind`, `ContentRequestStatus`, `ContentRequest`; the notice union and `CoachNotificationKind` gain `content_requested`; `ClientSummary` and `ClientWithMeta` gain `subscription: Subscription | null`, `pendingRequests: ContentRequest[]`, `access: ClientAccess | null`)
- Create: `src/lib/requests.ts`
- Modify: `src/lib/notices.ts`, `src/lib/insights.ts`
- Test: `src/lib/requests.test.ts`, `src/lib/notices.test.ts`, `src/lib/insights.test.ts`

**Interfaces:**
- Consumes: Task 2's `isCoached`.
- Produces (`types.ts`): `ContentRequestKind = 'program' | 'nutrition_plan'`; `ContentRequestStatus = 'pending' | 'fulfilled' | 'dismissed'`; `ContentRequest { id: string; user_id: string; kind: ContentRequestKind; status: ContentRequestStatus; note: string | null; created_at: string; resolved_at: string | null }`; notice variant `{ kind: 'content_requested'; data: { kind: ContentRequestKind; request_id: string; note: string | null } }`.
- Produces (`requests.ts`): `requestWords(kind: string): { title: string; action: string; tab: 'programs' | 'nutrition' } | null` (`program` → «Solicitó un programa» / «Crear programa» / `programs`; `nutrition_plan` → «Solicitó un plan de nutrición» / «Crear plan» / `nutrition`; anything else null); `requestDetail(note: string | null | undefined): string` (the trimmed note, or «Sin nota»); `pendingOf(requests: readonly ContentRequest[]): ContentRequest[]` (pending only, oldest first); `groupPendingByClient(rows: readonly ContentRequest[]): Map<string, ContentRequest[]>` (pending only, oldest first within a client).
- Changes: `describeNotice` handles `content_requested` (`tone: 'info'`, `title` and `href` from `requestWords`, `detail: requestDetail(note)`); a kind `requestWords` does not know falls to the existing default. `buildAttention` (a) adds, before the per-client loop, one item per pending request across `clients`, oldest first, `rank: -1`, `tone: 'info'`, `title` = words, `detail` = `requestDetail`, `action: { label: words.action, href: /clients/<id>?tab=<tab> }`, whatever the client's membership or access; (b) replaces `const coached = status === 'active' || status == null` with `isCoached(m, c.access)`.

- [ ] **Step 1: Write the tests.** `requests.test.ts`: both kinds' words; unknown → null; `requestDetail` trims, blank and null → «Sin nota»; `pendingOf` and `groupPendingByClient` drop fulfilled and dismissed and order by `created_at`. `notices.test.ts` (extend Task 1's): `content_requested` for each kind with a note and without; href `…?tab=programs` / `…?tab=nutrition`; an unknown request kind (cast) → `Novedad`; a notice with `data: {}` does not throw. `insights.test.ts` (fixtures: a `client()` factory, `pulse` a `Map`): **dark regression**, for membership none, active, paused, expired, cancelled, each with `access: null` and with the legacy-shaped access `{ enforced: false, hasAccess: true, beingCoached: <old rule> }` — a client with a block idle 10 days gets the «10 días sin entrenar» item exactly when the old rule says coached, and the membership item (`Membresía vencida`) fires either way; requests: one request → first item, title/detail/action/href as pinned; with a rank-0 danger item present it is still first; two requests from different clients are ordered by `created_at`; one client with both kinds yields two items; a request is listed for a paused client and for one with `beingCoached: false`; enforced: a client with `beingCoached: false` (an `active` membership past its date) gets no training chase but keeps the membership item, and a subscription-only client with `beingCoached: true` and an idle block gets the chase.
- [ ] **Step 2: Run `npm test`; expect** the new and changed tests to fail (and the old `notices` ones to stay green).
- [ ] **Step 3: Implement** the types, `requests.ts`, and the two edits above; `tsc` must pass for the new `ClientSummary` fields only after Task 5 fills them, so add them as required fields now and give `listClientSummaries` / `assemble` temporary `subscription: null, pendingRequests: [], access: null` until Task 5 replaces them.
- [ ] **Step 4: Run `npm test` and `npx tsc --noEmit`; expect** green.
- [ ] **Step 5: Commit** `feat(requests): content requests in the bell and the attention list`.

---

### Task 5: Reading access, subscriptions and requests

**Files:**
- Create: `src/services/access.ts`, `src/services/requests.ts`
- Modify: `src/services/clients.ts`, `src/pages/Dashboard.tsx`

**Interfaces:**
- Consumes: Tasks 2-4.
- Produces: `getClientAccess(): Promise<Map<string, ClientAccess> | null>` (both RPCs in parallel through `parseClientAccess(rows.data, parseEnforced(mine.data))`; any error → `console.warn` and `null`, never throws); `listPendingRequests(): Promise<ContentRequest[]>` and `listPendingRequestsFor(clientId: string): Promise<ContentRequest[]>` (`from('content_requests').select(...).eq('status', 'pending').order('created_at', { ascending: true })`); `dismissRequest(id: string): Promise<boolean>` (`update({ status: 'dismissed', resolved_at: <now>, resolved_by: <coach id> }).eq('id', id).eq('status', 'pending').select('id')`; true when a row came back, false when it was already resolved).
- Changes: `listClientSummaries` fetches subscriptions (`in('user_id', ids)`, `SUBSCRIPTION_COLUMNS`), pending requests and the access map in the same `Promise.all` and fills `subscription`, `pendingRequests` (via `groupPendingByClient`), `access`; `getClient` does the same for its one client; `renewMembership` computes its date with `renewedUntil`; the Dashboard's «Clientes activos» tile uses `clients.filter(isActiveClient)` (`expiring` and `paused` keep reading the membership).

- [ ] **Step 1: Write the services** as above (no unit test: they are I/O; the pure parts are Tasks 2-4). Extract nothing else.
- [ ] **Step 2: Run `npx tsc --noEmit`, `npm test`, `npm run lint`; expect** green.
- [ ] **Step 3: Confirm the live shape once, rolled back.** A `do $$ … $$` block (the smoke scripts' pattern, run with `db query --remote=… --yes -f`) that sets `request.jwt.claims` to a coach's id, does `set local role authenticated`, and ends with `raise exception 'SHAPE %', …` carrying `(select jsonb_agg(c) from public.coach_client_access() c)` and `public.get_my_access() -> 'enforced'`: the error aborts the statement, nothing is saved. Expect three rows with `has_access` true, `being_coached` true, `source` null for the two clients without a membership, and `enforced` false. If the shape differs from Task 2's fixtures, stop and fix Task 2.
- [ ] **Step 4: Commit** `feat(clients): read access, subscriptions and requests with the client lists`.

---

### Task 6: The client page: requests and «Sin acceso»

**Files:**
- Create: `src/components/shared/RequestBanner.tsx`, `src/components/shared/GrantAccessDialog.tsx`
- Modify: `src/pages/client/ClientDetail.tsx`, `src/pages/client/ProgramsTab.tsx`, `src/pages/client/NutritionTab.tsx`

**Interfaces:**
- Consumes: `requestWords`, `requestDetail`, `dismissRequest`, `isLocked`, `renewMembership`, `renewedUntil`.
- Produces: `RequestBanner({ requests, kind, onChanged }: { requests: ContentRequest[]; kind: ContentRequestKind; onChanged: () => void })` — nothing when none of `kind`; per request: the words' title, «el {fmtShort(created_at)}», the note (`requestDetail`) and a «Descartar» button (busy while running; success toast «Solicitud descartada», `false` → «Esa solicitud ya estaba resuelta.», error → «No se pudo descartar la solicitud»; always `onChanged()`). `GrantAccessDialog({ open, onOpenChange, client, onGranted })` — `AlertDialog` «¿Dar acceso a {firstName}?» / «Su membresía queda activa hasta el {date}. Podrá ver su programa y su plan.» with «Cancelar» and «Dar acceso»; runs `renewMembership`, toast «{firstName} ya tiene acceso hasta {date}».
- Changes: `ClientDetail` shows, inside the header column and only when `isLocked(client.access)`, a warning strip: «Sin acceso» · «No ve su programa ni su plan en la app.» · a «Dar acceso» button that opens the dialog; it passes `onChanged={reload}` to `ProgramsTab`. `ProgramsTab` takes `onChanged` and calls it from its `invalidate()`; both tabs render `RequestBanner` first (kinds `program` and `nutrition_plan`).

- [ ] **Step 1: Write the components and edits.** Tones: `info` for the banner, `warning` for the strip; keep the 44px-ish tap size of the existing buttons.
- [ ] **Step 2: Run `npx tsc --noEmit` and `npm run lint`; expect** clean. (Looked at in Task 10.)
- [ ] **Step 3: Commit** `feat(clients): request banners and «Sin acceso» on the client page`.

---

### Task 7: The clients list: «Solicitud» and «Sin acceso»

**Files:**
- Create: `src/components/shared/AccessBadges.tsx`
- Modify: `src/pages/Clients.tsx`
- Test: `src/lib/requests.test.ts` (extend)

**Interfaces:**
- Produces (`requests.ts`): `requestFilter(clients: { pendingRequests: ContentRequest[] }[], filter: 'all' | 'requests'): typeof clients` (the clients with a pending request when `filter === 'requests'`); `showRequestChip(pendingClients: number, filter: 'all' | 'requests'): boolean` (`pendingClients > 0 || filter === 'requests'`).
- Produces (`AccessBadges.tsx`): `RequestPill({ requests })` («Solicitud», with a `title` naming the kinds), `NoAccessPill()` («Sin acceso», warning), `SubscriptionPill()` («Suscripción», info).
- Changes: `Clients.tsx` keeps its search; adds `?filter=requests` (via `useSearchParams`, like Memberships) and a `FilterChips` row «Todos» / «Solicitud» only when `showRequestChip`; each row shows `RequestPill` after the name when `pendingRequests.length > 0`, `NoAccessPill` when `isLocked(c.access)`, and, in the membership column, `SubscriptionPill` instead of «Sin membresía» for a client with no membership and a subscription that `grantsAccess`; the filtered-empty state is «Sin solicitudes» / «Nadie ha pedido un programa ni un plan.» with «Ver todos».

- [ ] **Step 1: Extend `requests.test.ts`** for `requestFilter` (all → everyone, requests → only those with a pending request) and `showRequestChip` (none pending and filter all → false; none pending and filter requests → true; some → true).
- [ ] **Step 2: Run `npm test`; expect** the new tests to fail.
- [ ] **Step 3: Implement** the two functions, the badges and the page edits.
- [ ] **Step 4: Run `npm test`, `npx tsc --noEmit`, `npm run lint`; expect** green.
- [ ] **Step 5: Commit** `feat(clients): «Solicitud» and «Sin acceso» in the clients list`.

---

### Task 8: The store subscription beside the membership

**Files:**
- Create: `src/components/shared/SubscriptionDetails.tsx`
- Modify: `src/pages/client/MembershipTab.tsx`, `src/pages/Memberships.tsx`

**Interfaces:**
- Consumes: `subscriptionView`, `accessSummary`, `NoAccessPill`.
- Produces: `SubscriptionCard({ subscription })` (a `Card` «Suscripción de la tienda»: status badge, «Tienda», «Producto», the `dateLabel`, a «Compra de prueba (sandbox)» chip, the `hint`, footnote «Solo lectura: la gestiona la tienda.») and `SubscriptionLine({ subscription })` (one quiet line: «Suscripción · Activa · App Store · Se renueva el 12 dic 2026», sandbox marked).
- Changes: `MembershipTab` shows, above the membership card, an access line only when `accessSummary(client.access)` is not null («Sin acceso» · «No ve su programa ni su plan en la app. Su historial sigue ahí.», or «Con acceso» · «Por su suscripción · hasta el {date}» / «Por su membresía · sin vencimiento»), and `SubscriptionCard` whenever `client.subscription` exists; the manual editor is untouched. `Memberships` rows show `SubscriptionLine` under the plan (and under the price line on phones) when the client has a subscription, and `NoAccessPill` beside the status when `isLocked(c.access)`; filters, sorting and the actions are untouched.

- [ ] **Step 1: Write the components and edits** (the access line is a small local component of `MembershipTab`).
- [ ] **Step 2: Run `npx tsc --noEmit`, `npm run lint`; expect** clean.
- [ ] **Step 3: Commit** `feat(memberships): the store subscription beside the membership`.

---

### Task 9: «Dar acceso ahora» in Add client

**Files:**
- Modify: `src/services/clients.ts` (`createClient`), `src/components/shared/AddClientDialog.tsx`

**Interfaces:**
- Consumes: `openEndedAccess`, `updateMembership`.
- Produces: `createClient(input: { display_name: string; email: string; giveAccess?: boolean }): Promise<{ client: ClientWithMeta; tempPassword: string; accessGiven: boolean }>` — after the function answers it upserts `{ ...openEndedAccess(new Date()) }` through `updateMembership` when `giveAccess`; a failed write does not fail the call (`accessGiven: false`), so the one-time password is never lost.
- Changes: the dialog gains a `Switch` + `Label` «Dar acceso ahora» (on by default, reset on close) with an `InfoTip` («Crea una membresía activa y sin vencimiento junto con la cuenta, para que el cliente use su programa y su plan desde el primer día.»), the same pattern as `LockFutureWeeksSwitch`; when the switch was on and `accessGiven` is false the password step also says «No se pudo dar acceso. Hazlo desde su pestaña Membresía.» (warning tone).

- [ ] **Step 1: Write the service change and the dialog edit.**
- [ ] **Step 2: Run `npx tsc --noEmit`, `npm run lint`; expect** clean.
- [ ] **Step 3: Commit** `feat(clients): «Dar acceso ahora» when adding a client`.

---

### Task 10: Look at it

**Files:** the throwaway harness (never committed); fixes in the files above.

- [ ] **Step 1: Build the harness** as described above, with two fixture sets: **dark** (`enforced = false`: the live shape, two pending requests with and without a note, one sandbox subscription, a `content_requested` notice among the others) and **enforced** (a locked client, a subscription-only client, an active membership past its date, a request from a locked client).
- [ ] **Step 2: Look**, desktop and mobile, light and dark, and read `get_page_text` for the copy: Dashboard (tile value: dark 1, enforced per `has_access`; attention list with the requests first; the bell with the notice), Clients (chips only with a request; badges; the filtered state; pills enforced only), a client page per state (strip, banners in both tabs, «Descartar» on a request the fixture answers as already resolved), Membresía tab (subscription card, access line only enforced), Memberships rows, Add client (the switch; a fake `create-client` success with the membership write answering 403: the password and the warning appear). Check the logged request URLs carry `status=eq.pending`, `in.(…)`, the two RPCs and the `memberships?on_conflict=client_id` upsert.
- [ ] **Step 3: Fix what looks wrong**, tests first where it is a rule. Delete the harness and its `.git/info/exclude` lines; `git status -s` shows only intended files.
- [ ] **Step 4: Run `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run build`; expect** green. Commit fixes as `fix(...)` commits.

---

### Task 11: Docs, the review, the app's request button

**Files:**
- Panel: `README.md`, `docs/ADMIN_WEB_DB_CONNECTION.md` (a short Premium paragraph)
- App: `docs/superpowers/plans/2026-11-24-premium-subscriptions-3-panel.md` (the execution record), `docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md` (step 3 marked done), `CLAUDE.md` and `AGENTS.md` (identical), `docs/ADMIN_WEB_DB_CONNECTION.md` §6.7, `src/hooks/use-content-gate.ts`

- [ ] **Step 1: Panel docs** (README «What's inside» lines for the new places and `npm test`; the doc paragraph: what the panel reads and writes for Premium, and that it needs nothing server-side). Commit `docs: Premium in the panel's README and data guide`.
- [ ] **Step 2: One fresh reviewer on the whole branch** (the most capable model; given the spec, this plan and `git diff 50dc5f5..HEAD` of the panel): correctness bugs, any way a client shows as locked or the tile changes while the switch is off, copy that differs from the spec, tests that cannot fail. Fix what is real in one pass, test first, re-run Task 10 Step 4. Commit `fix(...)`.
- [ ] **Step 3: App repo docs, one commit:** the plan's execution record, the spec's «Staged delivery» step 3, `CLAUDE.md` and `AGENTS.md` («The panel part is built (2026-11-24): …»), §6.7. Commit `docs(premium): the panel part is built`.
- [ ] **Step 4: The app's «Solicitar …» in release builds, its own commit.** In `use-content-gate.ts` set `requestsEnabledWhileOpen: true` and rewrite its comment; change «while the switch is off a release build offers no request button, a dev client does» in `CLAUDE.md`, `AGENTS.md` (identical) and the sentence in §6.7 («What a new build shows while the switch is off»); the pure function and its tests keep both flag values. Run `npm test`, `npm run lint`, `npx tsc --noEmit` (no new errors against the baselines of plan 2). Commit `feat(premium): release builds offer «Solicitar …» while the switch is off`, saying the panel must be deployed before the next app build.
- [ ] **Step 5: Push the app repo; do not push the panel.** Update the Premium memory note, leave the hand-over in the shared notes folder, and report: what was done, what remains (the panel push, the next app build after it, Realtime, the owner's device checks), the rulings above with their costs, and the deferred minors. Ask before the panel push.
