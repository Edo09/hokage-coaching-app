# Premium subscriptions · Plan 2 of 3: the app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The client app's half of Premium: a paywall, a request sheet, the empty / pending / locked states of the training and nutrition tabs and Home, a Settings subscription card, and reminders that follow access, all built on `get_my_access()` and invisible while `premium_settings.enforced` is false.

**Architecture:** Supabase is the app's only source for «do I have access»: one react-query hook (`usePremiumAccess`) over the RPC, kept fresh by Realtime, focus and the local clock. The RevenueCat SDK buys, restores, prices and opens the store's manage page; its updates only invalidate that query. Every rule that decides what a screen shows is a pure function in `src/utils` (`node:test`); the SDK sits behind a small gateway with a web stub, so the web bundle never loads it.

**Tech Stack:** Expo SDK 57 / React Native 0.86, `react-native-purchases` (native only), react-query, Supabase (RPC, Realtime, Edge Function `sync-subscription`), NativeWind and the Dojo Poster kit, i18next, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md` (sections «The app», «Copy (es)», «Edge cases»). Plan 1's Execution record (`2026-11-23-premium-subscriptions-1-server.md`) describes the server this plan reads and lists the deferred minors. Plan 3 is the panel.

## Global Constraints

- **Dark:** while `access.enforced` is false every client counts as active: nothing locks, nothing sends a client to the paywall, `dateAllowed` keeps the membership rule. A client whose access cannot be read (first launch offline, RPC error, nothing cached) is treated the same, never locked.
- **Source of truth:** access comes only from `rpc('get_my_access')`, never from the SDK. Its jsonb: `enforced`, `has_access`, `source` (`'coach' | 'subscription' | 'membership' | 'open' | null`), `access_ends_at` (null when it never ends or there is no access), `subscription` (`status` active|cancelled|billing_issue|expired, `store`, `product_id`, `environment`, `is_premium`, `will_renew`, `started_at`, `current_period_started_at`, `expires_at`, `grace_expires_at`, `access_until`, `last_synced_at`) or null, `membership` (`status`, `expires_at`) or null, `has_program`, `has_nutrition_plan`, `has_supplement_plan`.
- **Derived states:** `loading | open | active | cancelled_active | grace | lapsed`; the local clock decides `lapsed` at `access_ends_at`.
- **RevenueCat:** entitlement id `premium_access`; keys `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`; Privacy `EXPO_PUBLIC_PRIVACY_POLICY_URL`; packages matched by type (`$rc_monthly`, `$rc_three_month`, `$rc_annual`), no product id anywhere; no `react-native-purchases-ui`; the SDK is never imported on web; a Test Store key (`test_…`) is refused outside a dev client (release builds crash with it).
- **Purchase:** success is shown only after `supabase.functions.invoke('sync-subscription')` (answers `{ result, access }`) and the access query reads a subscription that grants access; first sync at once, then every 12 s, give up after 60 s with «Tu compra se está procesando» and keep listening; restore only from a tap; a cancelled purchase is silent.
- **Requests:** `rpc('request_content', { p_kind: 'program' | 'nutrition_plan', p_note })`, note ≤ 500, raises by message `premium_required`, `invalid_kind`, `note_too_long`, `already_assigned`; own requests from `content_requests` (`pending | fulfilled | dismissed`); online only.
- **Copy:** Spanish and English in `src/i18n`, the spec's «Copy (es)» word for word; no brand name hard-coded.
- **UI:** the Dojo Poster kit in `src/components/ui`; NativeWind rules from the memory notes: no `leading-*`, nested `Text` spans carry no `text-*` size, never mirror a className size as a JS number (native rem is 14 px, web 16 px).
- **Pure modules** import nothing from React Native or the SDK at runtime (`import type` is fine), so `npm test` loads them; tests sit beside them in `src/**`. Run one file with `node --import ./scripts/test-register.mjs --test <file>`.
- **Commits:** conventional (`feat(premium): …`), ending with the attribution trailer, `git add` named files only, on `main` (no branches); push once, after the final review. No APK. No local temp paths in committed files (Tailwind scans `docs/`).
- **Baselines before this plan (2026-11-23):** `npm test` 508/508; `npm run lint` 0 errors and 3 warnings (`src/i18n/index.ts`); `npx tsc --noEmit` 3 errors (a stale typed route in `app/(auth)/login.tsx`, two TS5097 in `supabase/functions/_shared/subscription-sync.ts`). Target: nothing new.

## Calls made in this plan (the spec left them to the builder; veto any)

1. **SDK 11.0.4, not 11.0.2.** 11.0.4 fixes `configure()` without an `appUserID` (the provider starts the SDK exactly so); its pods exist on CocoaPods trunk (11.0.2 → `PurchasesHybridCommon` 20.7.0 → `RevenueCat` 5.102.2; 11.0.4 → 20.10.0). `pod install` needs macOS, so resolution is checked against trunk, not run. Fall back to the exact pin 11.0.2 if the device build misbehaves.
2. **`open` behaves as `active` on every screen**, so a client without a program sees «Solicitar programa» even while dark (the spec's «every client counts as active»). Hiding it while dark is one line in `contentGate`. **Reversed after the whole-branch review** (see the Execution record): a release build hides it while dark, a dev client keeps it.
3. **Entry points to the paywall:** the tab and Home buttons only exist for clients without access, so while dark nobody reaches it. Settings offers «Ver planes» when `enforced` or in a dev client (`__DEV__`), which is how the owner tests purchases before go-live. The route is also a deep link (`hokagecoaching://paywall`).
4. **Purchasing UI exists only where the gateway is `available`** (native with a usable key). Without keys the app behaves exactly as before.
5. **Terms link:** `EXPO_PUBLIC_TERMS_OF_USE_URL`; unset → Apple's standard EULA on iOS, no link on Android.
6. **Refresh:** react-query's app-focus refetch (30 s stale) plus `useRefreshOnFocus` on the screens that show a gate; Realtime for `subscriptions`, `memberships` (filter by user) and `content_requests` is opened once, in the provider.
7. **The coach's own account** in the client app gets no request or paywall button (`request_content` refuses the coach).
8. **Authored here:** success copy, benefits, web explanation, disclosure extras, the card's sandbox chip (Task 11, 12), in both languages.

## How the UI is verified (no device exists here)

Pure rules are unit-tested. Screens are checked on Expo web through a throwaway route `app/(auth)/premium-preview.tsx` (never committed) that mounts the real screen or component inside `AuthContext.Provider` with a fake user, seeds fixtures with `queryClient.setQueryData(qk.access(id), …)` (and program, plans, requests) under `staleTime: Infinity`, and picks one by `?state=`. Start the `web` server of `.claude/launch.json` with `preview_start`, open `/premium-preview?state=…`, `resize_window` preset `mobile`, read the copy with `get_page_text`, look with a screenshot; dark mode with `colorScheme: "dark"`, native sizes by injecting `html { font-size: 14px !important }` through `javascript_tool` (memory: web-screenshot-harness, native-rem-14). The route is deleted before every commit (`git status -s` must not list it). Nothing native runs here: purchases, the manage sheet and the SDK itself are device checks for the owner (Task 13 lists them).

## Review Focus

Failure modes the spec implies; each has a test in the task that owns the code.

1. A client whose access cannot be read (first launch offline after an upgrade, RPC error, nothing cached) is never locked or sent to the paywall, content already on the phone stays visible, and a stale cached program is not shown to a client whose access ended. (Task 3: `effectiveAccess`, `contentGate`)
2. An expiry weeks away must not wedge the clock: `setTimeout` overflows past 2³¹−1 ms (about 24.8 days) and fires at once, so the delay is clamped and re-armed; the screen still flips at the end. (Task 3: `msUntilAccessEnds`)
3. Buying before `logIn(user.id)` finished, or after an account switch, attaches the purchase to an anonymous or the previous RevenueCat user, which the webhook cannot map. (Task 6: identity helper)
4. Dead-end buttons: the coach's own account has no request or paywall button; a request refused with `premium_required` because access lapsed behind the screen offers the paywall, not a generic error; `already_assigned` closes the sheet and refreshes. (Task 3: `contentGate`; Task 9: `classifyRequestError`)
5. Success from the SDK alone: the store answers before the server knows. The flow stays in `confirming` until the access query shows a subscription, syncs again every 12 s (the function's cooldown is 10 s), gives up at 60 s into `processing`, and still turns to success if access arrives later. (Task 5)

---

### Task 1: The SDK and its configuration

**Files:**
- Modify: `package.json`, `package-lock.json`, `.env.example`
- Create: `src/config/purchases.ts`
- Test: `src/config/purchases.test.ts`

**Interfaces:**
- Produces (`src/config/purchases.ts`, no React Native or SDK import):
  - `ENTITLEMENT_ID = "premium_access"`
  - `PLAN_KINDS = ["monthly", "quarterly", "annual"] as const`, `type PlanKind`; `PLAN_PACKAGE_TYPES: Record<PlanKind, "MONTHLY" | "THREE_MONTH" | "ANNUAL">` (the SDK's `PACKAGE_TYPE` values behind `$rc_monthly`, `$rc_three_month`, `$rc_annual`)
  - `resolveSdkKey(os: string, keys: { ios?: string; android?: string }, dev: boolean): string | null`; `SDK_KEYS` (the two env vars, read as literal `process.env.EXPO_PUBLIC_…` so Expo inlines them)
  - `PRIVACY_POLICY_URL: string | null`; `TERMS_URL_ENV: string | undefined`; `termsUrl(os: string, configured: string | undefined): string | null`; `APPLE_STANDARD_EULA_URL` (`https://www.apple.com/legal/internet-services/itunes/dev/stdeula/`)

- [ ] **Step 1: Install the SDK pinned.** `npm install react-native-purchases@11.0.4 --save-exact`. Expect `npm ls react-native-purchases` → `11.0.4`; `package.json` gains that one line with no `^` and no `react-native-purchases-ui`; `git diff --stat` touches only `package.json` and `package-lock.json`.
- [ ] **Step 2: Write `purchases.test.ts`.** `resolveSdkKey`: `'ios'` → the iOS key, `'android'` → the Android key, `'web'` → null; undefined, `''` and `'   '` → null; whitespace around a key is trimmed; `'test_abc'` with `dev = false` → null, with `dev = true` → `'test_abc'`; `'appl_x'` passes with `dev = false`. `termsUrl`: a configured URL wins on both platforms (trimmed); unset on `'ios'` → `APPLE_STANDARD_EULA_URL`; unset or blank on `'android'` or `'web'` → null. Drift check: load the SDK's real enums with `createRequire(import.meta.url)("@revenuecat/purchases-typescript-internal")` and assert `PLAN_PACKAGE_TYPES.monthly === PACKAGE_TYPE.MONTHLY`, `quarterly === PACKAGE_TYPE.THREE_MONTH`, `annual === PACKAGE_TYPE.ANNUAL`; `PLAN_KINDS` order is monthly, quarterly, annual.
- [ ] **Step 3: Run `node --import ./scripts/test-register.mjs --test src/config/purchases.test.ts`; expect FAIL** (module missing).
- [ ] **Step 4: Implement `src/config/purchases.ts`** as above.
- [ ] **Step 5: Document the variables in `.env.example`:** the two public SDK keys (`appl_…`, `goog_…`), the Terms URL, and that a Test Store key (`test_…`) belongs only in EAS's `development` environment.
- [ ] **Step 6: Run `npm test` and `npm run lint`;** expect all green and the lint baseline.
- [ ] **Step 7: Commit** `feat(premium): RevenueCat SDK 11.0.4 and its configuration`.

---

### Task 2: Premium copy, es and en

**Files:**
- Modify: `src/i18n/es.ts`, `src/i18n/en.ts`
- Test: `src/i18n/premium.test.ts`

**Interfaces:**
- Produces namespace `premium` in both files. Later tasks add their keys under it, in both languages; this test keeps them honest. Keys of this task (es, from the spec):
  - `gate.program.{title «Aún sin programa», noneHint «Suscríbete y pídele tu programa personalizado a tu coach.», requestHint «Pide tu programa y tu coach lo preparará para ti.», requestAction «Solicitar programa», lockedHint «Renueva tu suscripción para volver a tu programa. Tu historial sigue aquí.»}`
  - `gate.nutrition.{title «Aún sin plan de nutrición», noneHint «Suscríbete y pídele tu plan de nutrición personalizado a tu coach.», requestHint «Pide tu plan de nutrición y tu coach lo preparará para ti.», requestAction «Solicitar Plan de nutrición», lockedHint «Renueva tu suscripción para volver a tu plan de nutrición. Tu historial sigue aquí.»}`
  - `gate.supplements.lockedHint «Renueva tu suscripción para volver a tu plan de suplementos. Tu historial sigue aquí.»`
  - `gate.{pendingTitle «Solicitud enviada», pendingHint «Tu coach la verá y te avisará cuando esté lista.», pendingSince «Enviada el {{date}}», lockedTitle «Tu acceso terminó», renewAction «Renovar suscripción»}`
  - `paywall.{title «Acceso Premium», planMonthly «Mensual», planQuarterly «Trimestral», planAnnual «Anual», subscribe «Suscribirme», restore «Restaurar compras», renewsAutomatically «Se renueva automáticamente. Puedes cancelar cuando quieras desde los ajustes de la tienda.»}`
  - `states.{confirming «Confirmando tu compra…», processing «Tu compra se está procesando», pendingApproval «Tu compra está pendiente de aprobación», failed «No se pudo completar la compra. Inténtalo de nuevo.», restored «Compras restauradas», nothingToRestore «No encontramos compras para restaurar», offline «Sin conexión»}`
  - `card.manage «Gestionar suscripción»`

- [ ] **Step 1: Write `premium.test.ts`** in the style of `src/i18n/reminders.test.ts`: a `COPY` table of `[path, es text]` with every string above, asserted exactly against `es.premium`; parity: the leaf paths of `es.premium` and `en.premium` are the same set, each leaf has the same `{{placeholder}}` set in both, and none is empty.
- [ ] **Step 2: Run it; expect FAIL** (no `premium` namespace).
- [ ] **Step 3: Add `premium` to `es.ts` and `en.ts`.** English is short and natural («Request a program», «Request a Nutrition plan», «Request sent», «Your access has ended», «Renew subscription», «Premium access», «Monthly», «Quarterly», «Annual», «Subscribe», «Restore purchases», …).
- [ ] **Step 4: Run it and `npm test`; expect green.**
- [ ] **Step 5: Commit** `feat(premium): copy for the paywall, requests and locked states`.

---

### Task 3: Access rules, pure

**Files:**
- Modify: `src/types/database.ts`, `src/lib/query-keys.ts`
- Create: `src/utils/subscription.ts`
- Test: `src/utils/subscription.test.ts`

**Interfaces:**
- Consumes: Task 2's `premium.gate.*` keys; the existing `coach.noProgramTitle` / `noProgramHint`, `mealReg.noPlanTitle` / `noPlanHint`, `supplements.noPlanTitle` / `noPlanHint`.
- Produces, `database.ts`: `AccessSource`, `SubscriptionStatus`, `MyAccessSubscription`, `MyAccess` (the Global Constraints shape, `access_until` may be the string `"infinity"`), `ContentRequestKind = "program" | "nutrition_plan"`, `ContentRequestStatus`, `ContentRequest { id, user_id, kind, status, note: string | null, created_at, resolved_at: string | null, resolved_by: string | null }`.
- Produces, `query-keys.ts`: `qk.access(userId)` → `["access", userId]`, `qk.contentRequests(userId)` → `["content-requests", userId]`, `premiumContentKeys = [["program"], ["nutrition-plan"], ["supplement-plan"]]`.
- Produces, `subscription.ts` (all take `now: Date`, never read the clock):
  - `type AccessState = "loading" | "open" | "active" | "cancelled_active" | "grace" | "lapsed"`; `OPEN_ACCESS: MyAccess` (`enforced false`, `has_access true`, `source "open"`, the rest null/false)
  - `parseMyAccess(raw: unknown): MyAccess | null`
  - `effectiveAccess(cached: MyAccess | null, query: { pending: boolean; paused: boolean }): MyAccess | null`
  - `hasAccessNow(access: MyAccess, now: Date): boolean`; `accessState(access: MyAccess | null, now: Date): AccessState`; `isSubscribed(access: MyAccess | null, now: Date): boolean`
  - `msUntilAccessEnds(access: MyAccess | null, now: Date): number | null` (`MAX_TIMEOUT_MS = 2_147_483_647`)
  - `type GateKind = "program" | "nutrition_plan" | "supplement_plan"`; `requestKindOf(gate: GateKind): ContentRequestKind | null`
  - `type ContentGate = { kind: "loading" } | { kind: "content" } | { kind: "empty"; action: "request" | "paywall" | null } | { kind: "pending"; since: string } | { kind: "locked" }`
  - `contentGate(i: { gate: GateKind; state: AccessState; access: MyAccess | null; hasContent: boolean; pending: ContentRequest | null }): ContentGate`
  - `pendingRequest(requests: readonly ContentRequest[], kind: ContentRequestKind): ContentRequest | null`
  - `type GateCopy = { icon: "ribbon-outline" | "nutrition-outline" | "medkit-outline" | "lock-closed-outline" | "time-outline"; titleKey: string; hintKey: string; actionKey: string | null; action: "request" | "paywall" | null; footnoteKey: string | null }`; `gateCopy(gate: GateKind, shown: Exclude<ContentGate, { kind: "loading" | "content" }>): GateCopy` (an empty state with no action uses the existing app keys)
  - `nutritionPane(i: { state: AccessState; access: MyAccess | null; hasPlan: boolean; hasSupplements: boolean }): "plan" | "supplements"`
  - `type SubscriptionCardView = { show: boolean; status: "none" | "active" | "cancelled" | "billing_issue" | "expired" | "membership"; date: { kind: "renews" | "ends" | "ended"; iso: string } | null; sandbox: boolean; action: "plans" | "renew" | null; manage: boolean; restore: boolean; storeOnly: boolean }`; `subscriptionCard(i: { access: MyAccess | null; state: AccessState; purchasable: boolean; dev: boolean; now: Date }): SubscriptionCardView`

- [ ] **Step 1: Add the types and the two query keys** (no behavior yet).
- [ ] **Step 2: Write `subscription.test.ts`** with `now = 2026-11-23T12:00:00Z`. Cases, one assertion group each:
  - `parseMyAccess`: `null`, `undefined`, `"x"`, `[]` → null; a full subscribed-and-cancelled shape round-trips field for field; `{}` and `{ enforced: false }` → open (a malformed answer never locks); `{ enforced: true }` alone → `has_access` false, source null, flags false; an unknown `source`, or a `subscription` that is not an object → null; extra keys dropped.
  - `effectiveAccess` (Review Focus 1): a cached value wins even when `paused`; nothing cached with `pending` and not `paused` → null (loading); nothing cached and `paused`, or not `pending` (errored) → `OPEN_ACCESS`.
  - `accessState`: null → `loading`; `enforced:false` (even `has_access:false`) → `open`; coach, no end → `active`; subscription ending in 1 h → `active`; ending exactly `now`, or 1 ms ago while `has_access` is still true (stale cache) → `lapsed`; `has_access:false` with a future end → `lapsed`; source `subscription` with status `billing_issue` → `grace`, `cancelled` → `cancelled_active`; source `membership` beside a `cancelled` subscription → `active`; an unparsable `access_ends_at` → falls back to `has_access`.
  - `isSubscribed`: premium with a future `access_until` → true; `"infinity"` → true; `is_premium:false` → false; past → false; null → false.
  - `msUntilAccessEnds` (Review Focus 2): null access, null end, `has_access:false`, not enforced, or an end already passed → null; 1 h ahead → 3_600_001; 90 days ahead → `2_147_483_647`.
  - `contentGate` for `program`, `nutrition_plan` and `supplement_plan`: `active` with content → `content` (even beside a pending request); without content or request → `{ empty, request }`; with a pending request → `{ pending, since: created_at }`; `open` gives the same three; `lapsed` with the matching `has_*` flag → `locked` even when `hasContent` is true (stale cache), without the flag → `{ empty, paywall }`; `supplement_plan` never offers `request` (active and lapsed-without-flag give `action: null`); `source: "coach"` without content → `{ empty, null }` (Review Focus 4); `loading` with content in hand → `content`, otherwise `loading` (Review Focus 1).
  - `pendingRequest`: the newest pending of that kind; ignores `fulfilled`, `dismissed` and the other kind; none → null.
  - `gateCopy`: for every gate and every shown kind, each returned key resolves in both `es` and `en`; pending carries `footnoteKey: "premium.gate.pendingSince"`; the empty-with-no-action cases return the existing app keys.
  - `nutritionPane`: a plan wins, else supplements, else `plan`; when `lapsed`, the flags (`has_nutrition_plan`, `has_supplement_plan`) decide the same way.
  - `subscriptionCard`: hidden while `loading`, for the coach, and for `open` without a subscription row unless `purchasable && dev`. Status: `lapsed` → `expired` with a row, else `none`; source `subscription` → the row's status; source `membership` → `membership`. Date: active and renewing → `renews` at `expires_at`; active not renewing, `cancelled`, `billing_issue` → `ends` at `access_ends_at ?? expires_at`; `expired` → `ended` at `access_until`; `membership` → `ends` at `access_ends_at`; a null, `"infinity"` or unparsable date → no date. `sandbox` when the row's environment is `sandbox`. `action`: only with `purchasable && (enforced || dev)`, `plans` for `none`, `renew` for `expired`. `manage` = purchasable with a row; `restore` = purchasable; `storeOnly` when not purchasable and the status is `none` or `expired`.
- [ ] **Step 3: Run `node --import ./scripts/test-register.mjs --test src/utils/subscription.test.ts`; expect FAIL** (module missing).
- [ ] **Step 4: Implement `subscription.ts`.** The state rules: not enforced → `open`; no `has_access`, or `access_ends_at` not after `now` → `lapsed`; otherwise `grace` / `cancelled_active` only when `source` is `subscription` and the row's status says so, else `active`. `parseMyAccess` is strict (`=== true`) and fails open.
- [ ] **Step 5: Run it and `npm test`; expect green.** Run `npx tsc --noEmit`; expect only the 3 baseline errors.
- [ ] **Step 6: Commit** `feat(premium): the access rules as pure functions`.

---

### Task 4: Plans, savings and purchase errors, pure

**Files:**
- Create: `src/utils/purchase.ts`
- Test: `src/utils/purchase.test.ts`

**Interfaces:**
- Consumes: Task 1's `PlanKind`, `PLAN_KINDS`, `PLAN_PACKAGE_TYPES`.
- Produces:
  - `type StorePackage = { identifier: string; packageType: string; product: { priceString: string; price: number; currencyCode: string; pricePerMonth: number | null; pricePerMonthString: string | null } }` (a structural subset of the SDK's `PurchasesPackage`)
  - `type Plan = { kind: PlanKind; identifier: string; priceString: string; price: number; currencyCode: string; perMonthString: string | null; savingPercent: number | null }`
  - `pickPlans(packages: readonly StorePackage[]): Plan[]` (monthly, quarterly, annual order; by `packageType`; missing kinds skipped)
  - `type FailureKind = "cancelled" | "pending" | "offline" | "already_purchased" | "store_problem"`; `type PurchaseFailure = { kind: FailureKind; detail: string | null }`
  - `type ErrorCodes = Pick<typeof PURCHASES_ERROR_CODE, "PURCHASE_CANCELLED_ERROR" | "PAYMENT_PENDING_ERROR" | "NETWORK_ERROR" | "OFFLINE_CONNECTION_ERROR" | "PRODUCT_ALREADY_PURCHASED_ERROR" | "RECEIPT_ALREADY_IN_USE_ERROR" | "RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR">` (type import from `react-native-purchases`)
  - `classifyPurchaseError(error: unknown, codes: ErrorCodes): PurchaseFailure`
  - `class PurchaseFailed extends Error { constructor(readonly failure: PurchaseFailure) }`

- [ ] **Step 1: Write `purchase.test.ts`.** `pickPlans` with a realistic offering in scrambled order (monthly 9.99, three-month 24.99 at 8.33 a month, annual 79.99 at 6.67 a month, all USD, plus `WEEKLY`, `LIFETIME`, `CUSTOM`, `UNKNOWN` packages): exactly three plans in order monthly, quarterly, annual; `priceString` is the store's string, `perMonthString` the store's `pricePerMonthString`; `savingPercent` null, 17, 33. Only monthly present → one plan, null saving; monthly absent → the others have null saving; no packages → `[]`; a duplicate type → the first wins; a different currency than monthly, or no monthly price, → null saving; `pricePerMonth` null → computed from `price / 3` or `/ 12`; a saving under 1 % or negative → null. `classifyPurchaseError` against the real `PURCHASES_ERROR_CODE` (loaded with `createRequire(import.meta.url)("@revenuecat/purchases-typescript-internal")`, so an SDK change fails this test): `PURCHASE_CANCELLED_ERROR` → `cancelled`; `userCancelled: true` with any code → `cancelled`; `PAYMENT_PENDING_ERROR` → `pending`; `NETWORK_ERROR` and `OFFLINE_CONNECTION_ERROR` → `offline`; `PRODUCT_ALREADY_PURCHASED_ERROR`, `RECEIPT_ALREADY_IN_USE_ERROR`, `RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR` → `already_purchased`; `STORE_PROBLEM_ERROR` and `PURCHASE_NOT_ALLOWED_ERROR` → `store_problem` with `detail` = `underlyingErrorMessage`, else `message`; an unknown code, a plain `Error`, a string and `null` → `store_problem` (detail from `Error.message`, else null). `PurchaseFailed` exposes `failure` and is `instanceof Error`.
- [ ] **Step 2: Run it; expect FAIL** (module missing).
- [ ] **Step 3: Implement `purchase.ts`.** Saving = `round(100 × (1 − perMonth / monthlyPrice))` using the numeric `pricePerMonth` when present.
- [ ] **Step 4: Run it and `npm test`; expect green.**
- [ ] **Step 5: Commit** `feat(premium): plans, savings and purchase error classification`.

---

### Task 5: The purchase flow, pure

**Files:**
- Create: `src/utils/purchase-flow.ts`, `src/lib/confirm-purchase.ts`
- Test: `src/utils/purchase-flow.test.ts`, `src/lib/confirm-purchase.test.ts`

**Interfaces:**
- Consumes: Task 4's `PurchaseFailure`.
- Produces, `purchase-flow.ts`:
  - `type FlowState = { phase: "idle" | "purchasing" | "confirming" | "processing" | "confirmed" | "restoring"; failure: PurchaseFailure | null; restored: "found" | "none" | null }`; `INITIAL_FLOW: FlowState`
  - `type FlowEvent = { type: "buy" } | { type: "restore" } | { type: "bought" } | { type: "restoredFound" } | { type: "restoredNone" } | { type: "failed"; failure: PurchaseFailure } | { type: "confirmed" } | { type: "timedOut" } | { type: "dismiss" }`
  - `flowReducer(state: FlowState, event: FlowEvent): FlowState`
- Produces, `confirm-purchase.ts` (no React Native import): `CONFIRM_POLL_MS = 3_000`, `CONFIRM_SYNC_MS = 12_000`, `CONFIRM_TIMEOUT_MS = 60_000`; `type ConfirmDeps = { sync(): Promise<void>; confirmed(): boolean; sleep(ms: number): Promise<void>; now(): number; cancelled(): boolean }`; `confirmPurchase(deps: ConfirmDeps): Promise<"confirmed" | "timeout" | "cancelled">`

- [ ] **Step 1: Write `purchase-flow.test.ts`.** From `INITIAL_FLOW`: `buy` → `purchasing`, clearing any failure and `restored`; `buy` while `purchasing`, `confirming` or `restoring` → unchanged; `bought` → `confirming`, never `confirmed` (Review Focus 5); `confirmed` from `confirming` or `processing` → `confirmed`, from `idle` → unchanged; `timedOut` from `confirming` → `processing`, from other phases unchanged; `failed` with `cancelled` → `idle` and no failure (silent), with `pending`, `offline`, `already_purchased` or `store_problem` → `idle` keeping that failure until the next `buy`, `restore` or `dismiss`; `restore` → `restoring`; `restoredNone` → `idle` with `restored: "none"`; `restoredFound` → `confirming` with `restored: "found"`.
- [ ] **Step 2: Write `confirm-purchase.test.ts`** with a fake clock whose `sleep(ms)` advances `now`. `sync` that confirms at once → `"confirmed"` after one `sync`; never confirmed → `"timeout"` once 60 000 ms passed, with `sync` called at 0, 12 000, 24 000, 36 000 and 48 000 ms (five calls, never a sixth); `confirmed()` turning true at 7 000 ms with no further `sync` → `"confirmed"`; a `sync` that rejects is ignored (polling continues, still `"confirmed"` when `confirmed()` flips); `cancelled()` true → `"cancelled"` with no further `sync`.
- [ ] **Step 3: Run both; expect FAIL** (modules missing).
- [ ] **Step 4: Implement both.** `confirmPurchase`: `sync` first, then poll `confirmed()` every `CONFIRM_POLL_MS`, syncing again whenever `CONFIRM_SYNC_MS` have passed since the last `sync`, until `CONFIRM_TIMEOUT_MS`.
- [ ] **Step 5: Run both and `npm test`; expect green.**
- [ ] **Step 6: Commit** `feat(premium): purchase flow reducer and confirmation loop`.

---

### Task 6: The purchases gateway: identity, native, web stub

**Files:**
- Create: `src/lib/purchases-identity.ts`, `src/lib/purchases-gateway.ts` (types only), `src/lib/purchases.ts` (native), `src/lib/purchases.web.ts`
- Test: `src/lib/purchases-identity.test.ts`

**Interfaces:**
- Consumes: Task 1's `PlanKind`, `ENTITLEMENT_ID`, `resolveSdkKey`, `SDK_KEYS`; Task 4's `Plan`, `pickPlans`, `classifyPurchaseError`, `PurchaseFailed`.
- Produces, `purchases-identity.ts` (no React Native import): `type IdentitySdk = { logIn(id: string): Promise<unknown>; logOut(): Promise<unknown>; getAppUserID(): Promise<string>; isAnonymous(): Promise<boolean> }`; `createIdentity(sdk: IdentitySdk): { identify(userId: string): Promise<void>; ensure(userId: string): Promise<void>; reset(): Promise<void> }`. Calls run one at a time in call order; `identify` skips a `logIn` for the user already identified; `ensure` waits for the queue, asks the SDK who it is and logs in again if that differs, and rejects if that `logIn` fails; `reset` skips `logOut` for an anonymous SDK user, never rejects, and forgets the identified user.
- Produces, `purchases-gateway.ts`: `interface PurchasesGateway { readonly available: boolean; configure(): void; identify(userId: string): Promise<void>; reset(): Promise<void>; loadPlans(): Promise<Plan[]>; purchase(kind: PlanKind, userId: string): Promise<void>; restore(userId: string): Promise<{ found: boolean }>; manage(): Promise<"opened" | "unavailable">; onCustomerInfoChange(listener: () => void): () => void }`. Methods that talk to the store throw `PurchaseFailed`.
- Produces, `purchases.ts` and `purchases.web.ts`: `export const purchases: PurchasesGateway`. Native `available` is `resolveSdkKey(Platform.OS, SDK_KEYS, __DEV__) != null`; web is `false` and never imports the SDK, so `tsc` keeps both files in step.

- [ ] **Step 1: Write `purchases-identity.test.ts`** with a fake SDK that records calls. `identify("u1")` → one `logIn("u1")`, a second `identify("u1")` → none; `identify("u2")` afterwards → `logIn("u2")`; `ensure("u1")` while `identify("u1")` is still pending waits for it, then does not log in twice when `getAppUserID()` says `u1` (Review Focus 3); `ensure("u1")` when the SDK reports another id → logs in again; `ensure` rejects when that `logIn` rejects; `reset()` skips `logOut` when `isAnonymous()` is true, calls it otherwise, never rejects when `logOut` throws, and a later `identify("u1")` logs in again; `identify("u1")` followed at once by `reset()` calls `logIn` then `logOut`, in that order.
- [ ] **Step 2: Run it; expect FAIL** (module missing).
- [ ] **Step 3: Implement `purchases-identity.ts`** as a promise chain.
- [ ] **Step 4: Run it; expect green.**
- [ ] **Step 5: Write the gateway files.** Native: `configure()` once, `Purchases.configure({ apiKey })` with no `appUserID`, log level `DEBUG` in dev else `WARN`; `identify`/`reset` through `createIdentity(Purchases)`; `loadPlans()` reads `getOfferings().current?.availablePackages ?? []` through `pickPlans`, remembering the SDK packages by kind; `purchase(kind, userId)` awaits `ensure(userId)` then `purchasePackage`; `restore(userId)` awaits `ensure` then `restorePurchases()` and answers `found` when `ENTITLEMENT_ID` is in `entitlements.active`; `manage()` is `showManageSubscriptions()` on iOS and `Linking.openURL(customerInfo.managementURL ?? "https://play.google.com/store/account/subscriptions")` on Android; `onCustomerInfoChange` wraps add/remove of the SDK's listener. Every store call rethrows `new PurchaseFailed(classifyPurchaseError(e, PURCHASES_ERROR_CODE))`. Web: the same object, inert (`loadPlans` → `[]`, `restore` → `{ found: false }`, `manage` → `"unavailable"`).
- [ ] **Step 6: Run `npx tsc --noEmit` and `npm run lint`;** expect the baselines and nothing new. Run `npm test`.
- [ ] **Step 7: Prove the web bundle never loads the SDK.** Run `npx expo export --platform web --output-dir <a folder outside the repo>` and search the output for `RNPurchases` and `setupPurchases` (string literals of the SDK's native-module lookup, present in any bundle that includes it); expect no match. Delete the output.
- [ ] **Step 8: Commit** `feat(premium): purchases gateway with identity ordering and a web stub`.

---

### Task 7: The access data layer: hook, provider, Realtime, the paywall route's slot

**Files:**
- Create: `src/hooks/use-premium-access.ts`, `src/hooks/use-content-requests.ts`, `src/providers/subscription-provider.tsx`, `app/paywall.tsx` (a placeholder until Task 11, so every later `router.push("/paywall")` type-checks)
- Modify: `app/_layout.tsx` (mount `SubscriptionProvider` directly under `AuthProvider`; `AuthGate` leaves a signed-in, onboarded client alone on `segments[0] === "paywall"`; register `<Stack.Screen name="paywall" options={{ presentation: "modal" }} />`)

**Interfaces:**
- Consumes: Task 3 (`qk.access`, `qk.contentRequests`, `premiumContentKeys`, `parseMyAccess`, `effectiveAccess`, `accessState`, `isSubscribed`, `msUntilAccessEnds`, `pendingRequest`, `hasAccessNow`); Task 6's `purchases`; the existing `useRealtimeInvalidate(table, filter, queryKey)`.
- Produces: `usePremiumAccess(): { access: MyAccess | null; state: AccessState; locked: boolean; subscribed: boolean; loading: boolean; refresh: () => Promise<unknown> }`; `useContentRequests(): { requests: ContentRequest[]; pending: (kind: ContentRequestKind) => ContentRequest | null; loading: boolean; refresh: () => Promise<unknown> }`; `SubscriptionProvider({ children })`.

- [ ] **Step 1: Write `usePremiumAccess`.** `useQuery({ queryKey: qk.access(user?.id), queryFn, enabled: !!user })`; `queryFn` runs `supabase.rpc("get_my_access")`, returns `OPEN_ACCESS` when the function does not exist (`42883` or `PGRST202`, a database without the migration), throws any other error, and parses with `parseMyAccess`. The cached value goes through `effectiveAccess(cached, { pending: q.isPending, paused: q.fetchStatus === "paused" })`. A local `now` state re-arms a `setTimeout` for `msUntilAccessEnds` (the clamped delay) and refreshes on `AppState` `active`, so the state flips at `access_ends_at` without a round trip. `locked = state === "lapsed"`.
- [ ] **Step 2: Write `useContentRequests`.** `select * from content_requests where user_id = <me> order by created_at desc` (RLS limits it anyway), persisted like the other queries; `pending(kind)` is `pendingRequest`.
- [ ] **Step 3: Write `SubscriptionProvider`** (renders its children, owns the side effects, once): `purchases.configure()` on mount; `identify(user.id)` when a session starts and `reset()` when it ends after having had one; `onCustomerInfoChange` → `invalidateQueries(qk.access(user.id))` and nothing else; `useRealtimeInvalidate` for `subscriptions` (`user_id=eq.<id>`) and `memberships` (`client_id=eq.<id>`) onto `qk.access`, and `content_requests` (`user_id=eq.<id>`) onto `qk.contentRequests`; and one effect that, when `hasAccessNow` flips (not on the first read), invalidates `premiumContentKeys`.
- [ ] **Step 4: Mount it and open the route's slot.** `SubscriptionProvider` under `AuthProvider` in `app/_layout.tsx`; the `AuthGate` exception and the `paywall` screen as listed under Files; `app/paywall.tsx` renders a bare `View` for now.
- [ ] **Step 5: Verify.** `preview_start` the `web` server (it regenerates the typed routes), then `npx tsc --noEmit` and `npm run lint` at baseline (the stale `/(auth)/register` error goes away). Open `/`: `read_console_messages` shows no error from the provider and, signed out, `read_network_requests` shows no `get_my_access` call. Open `/paywall` signed out: AuthGate sends it to login as before.
- [ ] **Step 6: Commit** `feat(premium): access hook, requests hook, subscription provider and the paywall route's slot`.

---

### Task 8: Reminders follow access

**Files:**
- Modify: `src/utils/reminders.ts`, `src/utils/reminder-sync.ts`, `src/hooks/use-reminder-sync.ts`
- Test: `src/utils/reminders.test.ts`, `src/utils/reminder-sync.test.ts`

**Interfaces:**
- Consumes: Task 3's `MyAccess`; Task 7's `usePremiumAccess`.
- Produces: `type ReminderAccess = Pick<MyAccess, "enforced" | "has_access" | "access_ends_at">`; `ReminderInput.access?: ReminderAccess | null` (optional, so the planner stays callable without it); `dateAllowed(program, membership, access, dateKey)`: with `access?.enforced` true, a date is allowed only while `has_access` and (`access_ends_at` is null or its local date key is on or after `dateKey`), and the membership rule is not applied; otherwise exactly the old membership rule. `ReminderSyncGate.access: SourceState`, joining `membership` in `sources`.

- [ ] **Step 1: Add tests to `reminders.test.ts`** (inside the file's `inEachZone` helper, three time zones). Training reminders for a program with a Mon/Wed schedule: `access` null or `enforced:false` with an `expired` membership → none, as today (the membership rule survives, even with `has_access:true`); `enforced:true, has_access:false` → no reminders at all; `enforced:true` with a `paused` membership but `has_access:true`, `access_ends_at:null` → reminders on every scheduled date; `access_ends_at` on a local date D → reminders up to and including D, none after; the same `access` stops inactivity and week-opened reminders after D.
- [ ] **Step 2: Add tests to `reminder-sync.test.ts`:** the new `access` source `loading` or `failed` → `wait`, `ready` → `plan` (with everything else ready).
- [ ] **Step 3: Run both; expect FAIL.**
- [ ] **Step 4: Implement** the planner change (`planTraining`, `planInactivity`, `planWeekOpened` pass `input.access` to `dateAllowed`) and the gate change.
- [ ] **Step 5: Wire `use-reminder-sync.ts`:** read `usePremiumAccess()`, pass `access` to `planReminders`, add its `sourceState` to the gate and its value to the effect's dependencies.
- [ ] **Step 6: Run both files and `npm test`; run `npx tsc --noEmit`;** expect green and the baseline.
- [ ] **Step 7: Commit** `feat(premium): reminders read coverage from the access answer`.

---

### Task 9: Requests: sheet, store, hook

**Files:**
- Create: `src/utils/content-request.ts`, `src/lib/request-sheet.ts`, `src/hooks/use-request-content.ts`, `src/components/ui/bottom-sheet.tsx`, `src/components/premium/request-sheet.tsx`
- Modify: `app/(tabs)/_layout.tsx` (mount `RequestSheetHost`), `src/i18n/es.ts`, `src/i18n/en.ts`
- Test: `src/utils/content-request.test.ts`

**Interfaces:**
- Consumes: Task 3's `ContentRequest`, `ContentRequestKind`, `qk.contentRequests`, `premiumContentKeys`.
- Produces, `content-request.ts` (pure): `REQUEST_NOTE_MAX = 500`; `type RequestError = "premium_required" | "already_assigned" | "offline" | "invalid" | "failed"`; `classifyRequestError(error: unknown): RequestError` (reads `message`, and SQLSTATE `42501`; `invalid_kind` and `note_too_long` → `invalid`; a failed fetch → `offline`); `upsertRequest(list: readonly ContentRequest[], row: ContentRequest): ContentRequest[]` (replace by id, else prepend).
- Produces: `requestSheet: { open(kind: ContentRequestKind): void; close(): void }` and `useRequestSheet(): ContentRequestKind | null` (an external store like `src/lib/exercise-session.ts`); `useRequestContent(): { send(kind: ContentRequestKind, note: string): Promise<{ ok: true } | { ok: false; error: RequestError }>; sending: boolean }` (answers `offline` without a call when `onlineManager` says so; otherwise calls `rpc("request_content", { p_kind, p_note })`, writes the returned row into `qk.contentRequests`, and on `already_assigned` invalidates `premiumContentKeys`); `RequestSheetHost` (a `BottomSheet` with the kind's title, a note field with a counter to 500, «Enviar solicitud»; online only).

- [ ] **Step 1: Write `content-request.test.ts`.** `classifyRequestError`: `{ message: "premium_required", code: "42501" }` → `premium_required` (Review Focus 4); `{ code: "42501" }` alone → `premium_required`; `already_assigned` → `already_assigned`; `invalid_kind` and `note_too_long` → `invalid`; `TypeError("Failed to fetch")` and `TypeError("Network request failed")` → `offline`; anything else, `null` and a string → `failed`. `upsertRequest`: replaces the row with the same id in place, prepends a new id, never mutates its input.
- [ ] **Step 2: Run it; expect FAIL** (module missing).
- [ ] **Step 3: Implement `content-request.ts`.**
- [ ] **Step 4: Run it; expect green.**
- [ ] **Step 5: Build the UI.** `BottomSheet` is the frame of `src/components/nutrition/registration-sheet.tsx` (scrim, handle, `rounded-t-3xl`, keyboard offset), generic over children; do not touch the registration sheet. `RequestSheetHost` shows: kind title (`premium.gate.<kind>.requestAction`), a hint line, the note input (`maxLength` 500, counter), a `SkewButton` «Enviar solicitud» (loading while sending, disabled and captioned `common.requiresInternet` offline). Errors inside the sheet: `premium_required` → a message and a «Ver planes» button that closes the sheet and `router.push("/paywall")`; `already_assigned` → closes, toast, refreshes; `offline` → `states.offline`; `invalid`/`failed` → `states.failed`. Success → closes with a success toast («Solicitud enviada»). Add the sheet's keys to both languages under `premium.request`.
- [ ] **Step 6: Mount `RequestSheetHost`** next to `CheckCardHost` in `app/(tabs)/_layout.tsx`.
- [ ] **Step 7: Verify on web** with the harness: the sheet empty, with a 500-character note, sending, offline, and the `premium_required` and `already_assigned` outcomes (fixture the hook's result); screenshot at mobile width and in dark; `get_page_text` shows the Spanish copy. Run `npm test`, `npx tsc --noEmit`, `npm run lint`.
- [ ] **Step 8: Commit** `feat(premium): request sheet, store and error classification`.

---

### Task 10: The gates on the training and nutrition tabs and Home

**Files:**
- Create: `src/components/premium/content-gate-view.tsx`
- Modify: `src/components/empty-state.tsx` (optional `footnote?: string`), `app/(tabs)/routines/index.tsx`, `app/(tabs)/nutrition/index.tsx`, `app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: Task 3 (`contentGate`, `gateCopy`, `nutritionPane`, `pendingRequest`, `GateKind`), Task 7's `usePremiumAccess` and `useContentRequests`, Task 9's `requestSheet`.
- Produces: `ContentGateView({ kind: GateKind; shown: Exclude<ContentGate, { kind: "loading" | "content" }>; variant: "screen" | "card" })`: renders `gateCopy` as an `EmptyState` (`screen`) or as Home's card (`card`: icon, title, hint, and a compact `SkewButton`), wires `request` to `requestSheet.open(requestKindOf(kind))` and `paywall` to `router.push("/paywall")`, formats the pending date with `formatShortDate(toDateKey(new Date(since)), i18n.language)`.

- [ ] **Step 1: Take the baseline, then build.** Before touching the screens, build the harness route and screenshot the three real screens as they are today (a seeded program, and no program) at mobile width: Step 5 compares against these. Then build `ContentGateView` and the `footnote` prop, and extend the harness to render it for every shown state × gate, in both variants.
- [ ] **Step 2: Wire the training tab.** `routines/index.tsx`: keep its loading and error early returns; compute `contentGate({ gate: "program", state, access, hasContent: program != null, pending: requests.pending("program") })`; `content` renders today's program, `loading` a `LoadingBlock`, the rest `ContentGateView` inside the existing centered container. Add `useRefreshOnFocus(access.refresh)`.
- [ ] **Step 3: Wire the nutrition tab.** `PlanPane` applies `contentGate` with `gate: "nutrition_plan"` before its content (a cached plan must not show when `locked`); `SupplementsPane` the same with `gate: "supplement_plan"` (no request, `has_supplement_plan` for the locked case); the first-pane seed uses `nutritionPane`.
- [ ] **Step 4: Wire Home's program card.** Replace the `program != null ? … : programLoading ? … : <empty card>` block: `content` keeps `ProgramHomeCard` and the skeleton; every other state is `ContentGateView variant="card"`.
- [ ] **Step 5: Verify every state on web** through the harness with the real screens and seeded caches: (a) active with a program: unchanged from today (compare against a screenshot taken before this task); (b) active, no program, nothing pending: «Aún sin programa» + «Pide tu programa y tu coach lo preparará para ti.» + «Solicitar programa», which opens the sheet; (c) pending: «Solicitud enviada» with «Enviada el …»; (d) lapsed, no content: the «Suscríbete y pídele…» copy with «Solicitar programa», which opens `/paywall`; (e) lapsed with `has_program`: «Tu acceso terminó» + «Renovar suscripción», even with a cached program in the seeded cache; (f) `open` with no program: same as (b); (g) the coach: no button. Repeat (b)–(e) for nutrition and supplements and for Home's card, with `get_page_text` per state, one mobile and one dark screenshot per screen.
- [ ] **Step 6: Run `npm test`, `npx tsc --noEmit`, `npm run lint`;** expect green and baselines. Delete the harness route.
- [ ] **Step 7: Commit** `feat(premium): request, pending and locked states on the tabs and Home`.

---

### Task 11: The paywall

**Files:**
- Create: `src/components/premium/paywall-view.tsx`, `src/components/premium/plan-card.tsx`, `src/hooks/use-plans.ts`, `src/hooks/use-purchase-flow.ts`
- Modify: `app/paywall.tsx` (Task 7's placeholder), `src/i18n/es.ts`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: Task 1 (`termsUrl`, `PRIVACY_POLICY_URL`, `TERMS_URL_ENV`), Task 4 (`Plan`, `PurchaseFailed`), Task 5 (`flowReducer`, `INITIAL_FLOW`, `confirmPurchase` and its constants), Task 6's `purchases`, Task 7's `usePremiumAccess`, Task 3's `parseMyAccess`, `isSubscribed`.
- Produces: `usePlans(): { plans: Plan[]; status: "loading" | "ready" | "error"; reload(): void }` (plain state, not persisted: prices must be the store's now); `usePurchaseFlow(): { state: FlowState; buy(kind: PlanKind): Promise<void>; restore(): Promise<void>; dismiss(): void }`; `PaywallView` (presentational: plans, selected kind, flow state, online, `available`, callbacks) and `PlanCard`; the route `/paywall`.
- `usePurchaseFlow` wiring: `buy` → `purchases.purchase(kind, user.id)` → `bought` → `confirmPurchase` with `sync` = `supabase.functions.invoke("sync-subscription")` then `setQueryData(qk.access(user.id), parseMyAccess(data.access))` (any error ignored), `confirmed` = `isSubscribed(getQueryData(qk.access(user.id)), new Date())`, `cancelled` = unmounted; result `confirmed` → `confirmed`, `timeout` → `timedOut`; while `processing`, `usePremiumAccess().subscribed` turning true dispatches `confirmed`. `restore` → `purchases.restore(user.id)` → `restoredFound` (then the same confirm) or `restoredNone`. Failures dispatch `failed` with `PurchaseFailed.failure`.

- [ ] **Step 1: Build `PlanCard` and `PaywallView`** (Dojo Poster): close button (falls back to `router.replace("/(tabs)")` when there is no history); title `premium.paywall.title`; what the client gets (three short lines); three cards, each with the plan name, its length («cada mes», «cada 3 meses», «cada año»), the store's `priceString` as the largest number, `perMonthString` and a «Ahorra {{n}} %» badge beneath in a smaller size, the selected card marked by the red border and top accent; a primary `SkewButton` «Suscribirme»; «Restaurar compras»; «Gestionar suscripción» (`purchases.manage()`); `premium.paywall.renewsAutomatically`, Apple's standard auto-renewal sentence on iOS and its Google Play equivalent on Android, and the Terms and Privacy links (`Linking.openURL`). States: loading plans (skeleton), plans failed or none (retry), purchasing (buttons disabled, spinner), `confirming` («Confirmando tu compra…» panel), `processing` («Tu compra se está procesando» + close), `confirmed` (success panel with the end or renewal date, «Listo» closes; also shown to a client who already `subscribed` when idle), each failure kind (`pending` → `states.pendingApproval`; `offline` → `states.offline` and buying disabled while `useIsOnline()` is false; `already_purchased` → a message with «Restaurar compras» emphasized; `store_problem` → `states.failed` plus the store's `detail`), restore results as toasts. Without `purchases.available`: on web the explanation «subscribe in the iOS or Android app, access you already have works here», on native without keys «subscriptions are not available right now»; no purchase control either way.
- [ ] **Step 2: Write `use-plans.ts` and `use-purchase-flow.ts`** as above, and replace Task 7's placeholder `app/paywall.tsx` with the screen joining them to `PaywallView`; add every new string to both languages under `premium.paywall` and `premium.states`.
- [ ] **Step 3: Verify on web** with the harness (a fake gateway object handed to `PaywallView`, since the real web gateway is inert): the real `/paywall` route on web shows the explanation and no buy control; with fixture plans: loaded (annual preselected, 17 % and 33 % badges, price strings dominant), a plan switched, purchasing, confirming, processing, confirmed, one screen per failure kind including `already_purchased`, offline, plans failed, no plans, at mobile width, in dark and at 14 px rem. `get_page_text` shows the pinned Spanish copy.
- [ ] **Step 4: Run `npm test`, `npx tsc --noEmit`, `npm run lint`;** expect green and baselines. Delete the harness route.
- [ ] **Step 5: Commit** `feat(premium): the paywall and the purchase flow`.

---

### Task 12: Settings subscription card

**Files:**
- Create: `src/components/premium/subscription-card.tsx`
- Modify: `src/components/coach-section.tsx` (render the card after `MembershipCard`), `src/i18n/es.ts`, `src/i18n/en.ts`

**Interfaces:**
- Consumes: Task 3's `subscriptionCard` and `SubscriptionCardView`, Task 7's `usePremiumAccess`, Task 6's `purchases`, Task 11's `usePurchaseFlow`.
- Produces: `SubscriptionCard()`: nothing when `view.show` is false; otherwise a `Card` like `MembershipCard` (status badge with the same soft tones, the date line `renews` / `ends` / `ended` via `toLocaleDateString`, a sandbox chip, `storeOnly` hint), then the actions the view allows: «Ver planes» or «Renovar suscripción» → `/paywall`, «Gestionar suscripción» (`purchases.manage()`; `unavailable` → an error toast), «Restaurar compras» (`usePurchaseFlow().restore()` with the `restored` / `nothingToRestore` / failure toasts; online only). `purchasable = purchases.available`, `dev = __DEV__`.

- [ ] **Step 1: Build the card** from the view; add its strings (status names, date lines, hints, sandbox chip) to both languages under `premium.card`.
- [ ] **Step 2: Render it in `CoachSection`** after `MembershipCard`.
- [ ] **Step 3: Verify on web** with the harness through the real Settings screen and seeded access: `open` with no subscription → no card at all (Settings unchanged from today); `none` (enforced, `purchasable` faked on) with «Ver planes»; active and renewing («Se renueva el …»); cancelled («Termina el …»); billing issue; expired with «Renovar suscripción»; membership-sourced access; a sandbox row; the web variant (`storeOnly` hint, no buttons). Mobile and dark screenshots; `get_page_text` per state.
- [ ] **Step 4: Run `npm test`, `npx tsc --noEmit`, `npm run lint`;** expect green and baselines. Delete the harness route.
- [ ] **Step 5: Commit** `feat(premium): Settings subscription card`.

---

### Task 13: Docs, final verification, review, push, report

**Files:**
- Modify: `docs/ADMIN_WEB_DB_CONNECTION.md` (a «The app» paragraph in §6.7), `CLAUDE.md` and `AGENTS.md` (identical, one commit), this plan (an Execution record at the end)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Docs.** §6.7 gains: the app's variables (`EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`, `EXPO_PUBLIC_TERMS_OF_USE_URL`, per EAS environment; the Test Store key only in `development`), how the owner tests with the Test Store (Settings «Ver planes» in a dev client, or the `hokagecoaching://paywall` link), and that purchases are unverified until a device runs them. In `CLAUDE.md` and `AGENTS.md` the Premium bullet says the app part is built and untested on a device and the panel part is not built; `diff CLAUDE.md AGENTS.md` prints nothing.
- [ ] **Step 2: Audit the lapsed-account paths the spec names.** Read `src/hooks/use-progress-dashboard.ts` (the two selects that embed `program_exercise`) and confirm every embedded row is read as optional with the stored `exercise_name` as fallback; record the result in the Execution record, and that a real lapsed account still has to be checked once the switch can be flipped for a test client.
- [ ] **Step 3: Full verification.** `npm test`, `npm run lint`, `npx tsc --noEmit` (baselines, nothing new); the web states of Tasks 9 to 12 once more in dark mode with 14 px rem; `git status -s` lists no harness route and no `supabase/.temp/cli-latest`.
- [ ] **Step 4: One fresh reviewer on the whole branch** (the most capable model; give it the spec, this plan and `git diff bd362c8..HEAD`): look for correctness bugs, rules that differ from the spec, tests that cannot fail, dead-end states. Fix what is real test-first; re-run Step 3.
- [ ] **Step 5: Write the Execution record** at the end of this plan (rulings, deviations, evidence, deferred minors, what is unverified), commit `docs(premium): app plan execution record`.
- [ ] **Step 6: Push.** `git fetch`; if `origin/main` moved, rebase onto it and re-run `npm test`; `git push origin main`; confirm `git status -sb` shows no divergence.
- [ ] **Step 7: Leave the hand-over** in the shared notes folder and update the Premium memory note, then report: what exists, what was verified and how, and the owner's list. Never say a purchase works: it has not run on a device. The owner's list: create the RevenueCat project (entitlement `premium_access`, the six products, one offering with the three packages, the iOS and Android apps, public keys, the Test Store); set `REVENUECAT_API_KEY` and `REVENUECAT_WEBHOOK_SECRET` and the webhook (without the API key `sync-subscription` answers 503 and a purchase can only confirm through the webhook); EAS variables per environment; a development build for each platform; then the 13 sandbox cases. Plan 1's deferred minors that matter at sandbox time: the Google base-plan `product_id` (display only, the app reads no product id), `refunded_at` surviving a re-purchase (a refund-then-buy test may stay closed), `will_renew` true for promotional grants (the card shows no renewal date without one), and `sync-subscription` needing its secret.


---

## Execution record (2026-11-23)

Executed inline on `main` (the repo's rule: no branches or worktrees; the tasks lean on each other's interfaces, so none was split off). Commits: `0271761` this plan, `e5197ae` Task 1, `3d82096` Task 2, `7ee9563` Task 3, `b69cf42` Task 4, `0a0adb9` Task 5, `26f6244` Task 6, `f19616e` Task 7, `1d41356` Task 8, `cc05f72` Task 9, `d0b278f` Task 10, `2bb004e` Task 11, `f41ec7d` Task 12, `cabb64a` docs; then, after the whole-branch review, `8101fb1` (a purchase is always synced), `d518379` (a renewing subscriber is not locked at the period end), `d3fecae` (reminders across a renewal), `703a56b` (no request button while the switch is off), `2b96612` («Ver planes» waits for the sheet), and this record.

**Review.** One fresh reviewer on the most capable model read `bd362c8..cabb64a`: Critical 0, Important 6, Minor 12. The six Important findings were fixed in one pass, each test first (the failing run seen, then green, the whole suite after each); the sixth, the throwaway preview route still on disk, was this plan's own last step and was deleted with its `.git/info/exclude` line. Minors went to the list below. No re-review was run: the covering tests and the suite answer "addressed" and "broke nothing".

- **Renewals (Important 1).** For a subscription `access_ends_at` is the current period's end, and the answer the app holds keeps it until the renewal reaches the app, so the clock used to lock a paying client at every renewal (and, offline, for good). A subscription that is active and set to renew now keeps counting for 72 h past that date (`RENEWAL_GRACE_MS`, the database's own content grace); a fresh answer that says no still wins, and a cancelled subscription, a billing problem, a membership and a coach-set end are hard ends. Five minutes after the period end (`RENEWAL_SETTLE_MS`), if the answer in hand still holds the old period, the provider waits 3 s for Realtime or the refetch on returning and then calls `sync-subscription`, at most once every five minutes (`createRenewalChecker`), which repairs a lost RENEWAL webhook, also for a client the server already locked out because its row never moved. Nothing of this runs while the switch is off.
- **Reminders (Important 2).** A renewing subscription is planned open-ended; the other ends keep their hard end.
- **Purchase confirmation (Important 3).** The first sync after a purchase or restore runs even if the paywall has been swiped away; every sync is aborted after 15 s (`src/lib/sync-subscription.ts`); the server showing the subscription also ends a wait that is still «confirming».
- **Dark behaviour (Important 4, reverses call 2).** While the switch is off a release build offers no request button anywhere and Home's card is the card of before Premium; a dev client (`__DEV__`) still offers requests so the owner can test them. The panel part (the coach seeing who asked for what) is plan 3.
- **«Ver planes» (Important 6).** The request sheet closes and the paywall is pushed after the sheet's own Modal has dismissed (`requestSheet.closeThen`, `BottomSheet`'s `onDismiss`, with a one-second fallback).

**Verified.** `npm test` 762/762 after the fixes (702 before them, 508 before this plan); each new rule was written test first, and for the pure modules a set of deliberate mutations was run against their tests (every one that changes behavior fails a test; the gaps found that way, in the confirmation loop's cancel handling and in `isRenewing`'s status check, got their own tests). `npm run lint`: 0 errors and the 3 old warnings. `npx tsc --noEmit`: 2 errors, both the old TS5097 in `supabase/functions/_shared/subscription-sync.ts`. The web export holds none of the SDK's strings (a positive control from the access hook is there); both native bundles build and contain the SDK (`expo export --platform ios` 2731 modules, `--platform android` 2814, each with `RNPurchases` and `setupPurchases`). Every state of the spec's table was looked at on Expo web (mobile width; dark, and light and native rem 14 px where it mattered) on the real training and nutrition screens, Home's slot, the paywall, the request sheet and Settings' section, with seeded caches; the real request sheet against the live server (an anonymous send is refused with permission denied and shown as «Necesitas una suscripción activa para pedirlo»); a client whose access ends flips to the locked state with no round trip; a copy of the program still cached is not shown once access ended; the coach and the supplements get no request button. After the fixes, on web: a renewing subscriber one hour past the period end keeps the program and one sync is attempted (no loop over 20 s); with the sync answering a renewed access the cached period moves a month on; four days past the period end the client is locked (with a sync); a cancelled subscription is locked at once with no sync; in a production export (`__DEV__` false) the training tab, the nutrition tab and Home's card are the plain empty states of before Premium with no request button and Settings has no card, while with the switch on «Solicitar programa» is offered; «Ver planes» from the real request sheet closes it and then pushes `/paywall`.

**Not verified, and the owner's to check on a device:** every call that touches the store (`src/lib/purchases.ts`: configure, logIn, offerings, purchase, restore, the manage sheet), the wiring around them (`use-purchase-flow.ts`, `subscription-card.tsx`), the Realtime events on `subscriptions`, `memberships` and `content_requests`, `pod install` for `react-native-purchases` 11.0.4 (it needs macOS; its pods exist on CocoaPods trunk), the Test Store's behavior, and the lapsed-account paths against a real locked account (only audited: the progress hooks read each embedded program row as optional with the stored exercise name as fallback). Also, because they cannot run here: «Ver planes» from the request sheet on iOS (the Modal's `onDismiss`), the paywall swiped down mid-purchase (the purchase must still be synced), and a real renewal (the grace, the 3 s wait and the sync only act on a stale answer; Android's sandbox renews every few minutes, which makes it testable).

### Rulings made during execution

- SDK 11.0.4, not the brief's 11.0.2 (decided in the plan): it fixes `configure()` without an `appUserID`; both versions' pods are on trunk.
- `PurchaseFailed` declares its field instead of using a parameter property (Node's type stripping rejects those).
- The reducer accepts `buy` and `restore` only from idle; `confirmPurchase` also checks `cancelled()` after each sync; a `reset` event returns a finished flow to idle (Settings stays open after a restore).
- The clock is a small store (`src/lib/access-clock.ts`) ticked by one timer in the provider, instead of a timer per consumer; the provider refetches the coach's content when access is *locked* or unlocked (not when a stale end date passes while the switch is off).
- Reminders compare the access end with the reminder's fire time, not with the end's date; the sync never waits on a failed access read (the hook opens it).
- `parseMyAccess` treats any answer that does not say `enforced: true` as open; `subscriptionCard` hides a renewal date that is already past.
- Files the plan did not list: `use-content-gate.ts`, `home-program-slot.tsx`, `defaultPlanKind`, `formatLongDate`, the `requestsLoading` input of `contentGate` (so «Solicitar» never flashes before «Solicitud enviada»), a presentational `SubscriptionCardBody`. All test first where testable.
- Restore and failure messages show inline on the paywall and as toasts on Settings.
- Review, Important 4: plan call 2 is **reversed**. The spec says nothing changes for anyone while the switch is off, and plan 3 cannot yet show the coach who asked for what, so a release build keeps today's plain empty state and a dev client keeps the button (cost if wrong: a tester on a release build cannot see the request flow before go-live).
- Review, Important 3: the reviewer's «better» fix (the provider's `onCustomerInfoChange` calling `sync-subscription`) was not done: the brief says an SDK update only invalidates the access query. The holes are closed inside the flow instead, plus the renewal check (cost if wrong: an Ask-to-Buy approval, or a purchase finished with the app killed, waits for the webhook or the next foreground read).
- Review, Important 1: the settle time of five minutes, the three-second wait, the five-minute gap between syncs, and the grace of 72 h are the executor's numbers (the grace mirrors the database's content grace; the others only space out a call that has a cooldown of its own).
- Review, declined to judge (all stand): the paywall reachable by `hokagecoaching://paywall` while the switch is off, and buying while dark with keys set (call 3); no Terms link on Android without `EXPO_PUBLIC_TERMS_OF_USE_URL` (call 5; the store may ask); sandbox purchases granting real access and `sync-subscription` answering 503 without its API key (plan 1's rulings); a client winding the clock back to read a cached copy offline (the database enforces; the UI is a view); a client flipped to locked at the exact end of anything that does not renew (the spec asks for it); New Architecture, the pods for 11.0.4, `Date.parse` of Postgres timestamps on Hermes, long timers on Android, Test Store webhooks and RevenueCat's transfer behavior (device and RevenueCat checks, on the owner's list).

### Found, not fixed (not this plan's)

- `src/lib/query-client.ts` sets `gcTime` to 35 days (3.02e9 ms), over `setTimeout`'s 2^31-1 ms limit; TanStack Query 5.101.2 does not clamp it, so on **web** a query with no observer is dropped after about a millisecond and the persisted cache is discarded as it hydrates (native timers do not overflow). Fix: clamp to 2147483647 and keep `PERSIST_MAX_AGE` at or under it.

### Deferred minors

- Double-tap guard: `usePurchaseFlow`'s phase ref is set in an effect, so two taps in one tick both reach `purchases.purchase`.
- `purchases.configure()` is not wrapped in try/catch (a throw from the root effect would crash the app where the native module is missing).
- «Gestionar suscripción» is offered for any subscription row whatever store it came from, and iOS has no `managementURL` fallback if `showManageSubscriptions` rejects.
- Changes to `programs`, `nutrition_plans` and `supplement_plans` do not invalidate `qk.access`, so a lapsed client's `has_*` flags are stale until focus.
- Cached content outside the three gates when locked: the training header's «Semana n de m» and Home's calorie goal from a cached nutrition plan.
- `parseSubscription` maps an unknown subscription status to `expired` (the card would say «Vencida» for a subscribed client).
- A coach with an unreadable access answer gets a request button that ends in the paywall (moot in release builds while the switch is off).
- Every `useContentGate` registers its own refresh-on-focus, so one focus fires several `get_my_access` calls.
- Reopening the request sheet for the other kind mid-send lets the first send's success close the new sheet.
- Accessibility: plan cards use `accessibilityState.selected` on a radio (should be `checked`); the confirming and processing panels have no live region.
- `subscribed` can stay true past an expiry while the switch is off (nothing ticks the clock then); it only affects the paywall's «Ya tienes Premium» while testing.

### What is left

The owner: the RevenueCat project and its secrets (§6.7), the EAS variables, a development build per platform, then the 13 sandbox cases plus the three device checks above; the panel (plan 3), which is also what lets requests come back in release builds while the switch is off; before go-live, plan 1's «Before the switch is turned on» and a membership for every client who keeps access. Plan 1's deferred minors that matter at sandbox time: the Google base-plan `product_id` (display only: the app reads no product id), `refunded_at` surviving a re-purchase (a refund-then-buy test may stay closed), `will_renew` true for promotional grants (the card shows a renewal date only when there is one; the 72 h grace and the renewal check would also treat such a grant as renewing, bounded by the same 72 h), and `sync-subscription` needing its secret.
