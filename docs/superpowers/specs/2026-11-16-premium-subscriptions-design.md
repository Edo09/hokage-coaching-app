# Premium: RevenueCat subscriptions that unlock the coach's programs and plans

Design for the in-app subscription and the «Solicitar programa» / «Solicitar
Plan de nutrición» requests. App, panel and Supabase are one project
(`rzgwkwxskrovxnnymxqo`); nothing here needs a new backend or a second user
system. RevenueCat facts were checked against its documentation on 2026-11-16.

## Problem

Every client the coach creates (or who signs up since 2026-11-07) sees whatever
the coach assigns, for free. The only money concept is `memberships`, a status
record the coach sets by hand; the PRD lists in-app payment as «future». The
coach wants clients to pay inside the app, on iOS and Android, and to receive
their personalised program and nutrition plan once they have.

A subscription must not generate or assign anything: the coach still builds
every program and plan. What a subscription buys is the right to *ask* the coach
for one, and to *see and use* what the coach assigns.

## Decisions (from the product owner)

1. One membership, **Premium**, with three billing periods: monthly,
   quarterly, annual. No free trial. Prices come from the store products
   through RevenueCat, never from our code or database.
2. Purchases use Apple In-App Purchase and Google Play Billing, managed by
   **RevenueCat**: one entitlement, `premium_access`. The RevenueCat app user
   id is the Supabase Auth user UUID.
3. Subscription state reaches Supabase through **RevenueCat webhooks** handled
   by an Edge Function. The client never writes it, and the app never unlocks
   anything on its own say-so.
4. **Both** a store subscription **and** an active coach-set `memberships` row
   grant access (the coach keeps a way to give access by hand: clients who pay
   the coach directly, courtesy access).
5. When access ends (expired, or never started) the client's **assigned
   program, nutrition plan and supplement plan are locked** and logging stops;
   their account, profile and **history stay readable**. Enforced in the
   database, not only in the UI.
6. A request («Solicitar programa», «Solicitar Plan de nutrición») is stored in
   Supabase and shown in the existing panel; buying never assigns content.
7. Store setup starts under the developer's own Apple, Google and RevenueCat
   accounts and moves to the coach's later (new bundle ids, products and keys at
   that point).

## Goals, non-goals, anti-goals

**Goals**

- One rule for «does this person have access», written once in the database and
  read by the app, the panel and the RLS policies alike.
- A client can see the three offers with store prices, buy, restore, see when it
  renews or ends, and open the store's manage page.
- The coach sees, in places they already look, who asked for what and who has
  access.
- Every lifecycle case in the brief (purchase, renewal, cancel-but-active,
  expiry, billing problem, restore, new device, reactivation) ends in the right
  state without anyone touching the data.
- Everything ships *dark*: it can be deployed, tested and released long before
  anyone is locked out, and turned on with one statement.

**Non-goals**

- Free trials, intro prices, offer codes, several tiers.
- Web purchases (the web export is view-only), Stripe, RevenueCat Billing.
- Per-feature entitlements; the AI insight and the rest of the app stay as is.
- Notifying the coach by push or email (bell, Dashboard and client page only).
- Revenue dashboards in the panel; a forced-update screen for old app builds.

**Anti-goals** (it fails even if it «works» if…)

- A client can get access, a request or locked content by calling the API
  directly while the UI hides the button.
- A real client loses data, progress or sign-in because a subscription lapsed,
  or is locked out before the app can sell them anything.
- Premium logic ends up copied into several screens or both stores' code paths.
- A forged or replayed webhook can grant anyone Premium.
- The coach has to edit data by hand to repair a subscription state.
- Existing coach flows (assign, edit, notify, memberships page) change meaning
  before the switch is on.

## Approaches considered

The brief fixes the stack (RevenueCat, Edge Function webhook, RLS). Four choices
were left; each has one sensible answer.

**Where the app reads «am I premium».** (a) Supabase is the one source; the SDK
buys, restores, manages and prices. (b) The SDK's `CustomerInfo` drives the UI
and Supabase only guards the server. (c) Optimistic unlock from the SDK after a
purchase. **Chosen (a).** (b) gives two answers that disagree for the minutes
around a purchase or an expiry and duplicates the rule in two languages, which
the brief forbids; (c) breaks «no activation without the provider's
confirmation». The web build has no purchase SDK, so it needs the server answer
anyway.

**How the lock is enforced.** (a) Add *restrictive* RLS policies next to the
existing ones. (b) Rewrite each «client reads own …» policy. (c) Put every
content read behind an RPC. **Chosen (a).** The database already does this for
assigned meals and routines (`… assigned read-only`, `RESTRICTIVE`). It is
additive, one policy per table and command, and removed by dropping it. (b)
touches 11 working policies; (c) rewrites every hook and the offline cache.

**How the webhook keeps the state right.** (a) Apply each event's own fields,
guarded by its timestamp. (b) Treat each event as a *signal* and re-read the
customer from RevenueCat's REST API. **Chosen (b).** RevenueCat itself
recommends fetching the subscriber after any webhook; delivery has no ordering
guarantee and can repeat; a `TRANSFER` event carries no state at all; and the
grace, hold, pause and product-change rules live in RevenueCat's backend, not in
the event. It also closes the worst hole in (a): the payload is never trusted
for access, so a leaked webhook secret or a replayed event cannot grant Premium
to anyone, only cause a harmless re-read. The cost is a secret API key and one
API call per event, retried by RevenueCat if it fails. The raw event is still
stored whole.

**When the lock turns on.** (a) In the same migration. (b) Behind one switch,
off by default. **Chosen (b).** There is no over-the-air update (no
`expo-updates`): an installed build has no paywall, the stores do not exist yet,
and the web build (an installable PWA) cannot buy. Locking in the same migration
would lock every current account the moment it is applied.

## How access works

`public.premium_settings` holds one row, `enforced boolean default false`,
changed only by SQL. While it is false nobody is locked and the app does not
show a paywall; the database objects, functions and app build can all be live.

With `enforced = true`, `has_premium_access()` (no argument: it answers for the
caller) is true when **any** of:

| Source | Counts when |
|---|---|
| Coach | the caller's profile has `role = 'coach'` |
| Store subscription | `subscriptions.is_premium` and `access_until > now()` |
| Coach-set membership | `memberships.status = 'active'` and (`expires_at` is null or `expires_at >=` the coach's local date) |

With `enforced = false` it is true for everyone. `access_until` is the end of
the paid period, or of the grace period while a payment is retried, whichever is
later; it is checked against the clock on every read, so a lost expiry event
cannot keep access open. `is_premium = false` (refund, revocation) closes access
at once.

The other functions, all `SECURITY DEFINER`, `search_path = ''`:

- `premium_write_access()`: `has_premium_access()`, plus **72 hours** after access
  ended. Used by the logging policies only, so a set or meal logged offline just
  before an expiry still syncs just after it instead of being dropped.
- `premium_access_for(uuid)` and `is_being_coached(uuid)`: the same answers for
  any user, for the server's jobs. Not granted to `authenticated`, so no client
  can probe another person's status.
- `get_my_access()`: one row for the app: `enforced`, has access, source, the
  moment access ends, the subscription (status, store, product, environment,
  dates, renew flag), the membership (status, date), and flags for whether an
  *active program / nutrition plan / supplement plan exists* (flags only, never
  content). Every screen is built from it.
- `coach_client_access()`: coach-only (raises otherwise); one row per client with
  access, source, end and `being_coached`, so the panel's lists, badges and
  attention rules read the rule instead of copying it.

### What access unlocks

| | With access | Without access |
|---|---|---|
| Read the assigned program, nutrition plan, supplement plan | yes | **no** (11 tables, restrictive `SELECT`) |
| Check off exercises, log sets, register meals, tick supplements | yes | **no** after the 72 h grace (5 tables, restrictive `INSERT/UPDATE/DELETE`) |
| Send a request | yes | **no** (`request_content`) |
| Read history: set logs, completions, meals, supplement ticks, measurements | yes | yes |
| Account, sign-in, onboarding, profile, weight, push token, AI insight | yes | yes |

Locked tables: `programs`, `program_weeks`, `program_days`, `program_exercises`,
`nutrition_plans`, `nutrition_plan_meals`, `nutrition_plan_options`,
`nutrition_plan_option_items`, `nutrition_plan_targets`, `supplement_plans`,
`supplement_plan_items`. Logging tables: `program_exercise_completions`,
`workout_set_logs`, `supplement_intake_logs`, `meals`, `meal_items`. The coach
always passes (the function is true for the coach role, and the coach's own
permissive policies are untouched).

## Data

One migration, idempotent, in the repo's style. Every new table is granted **per
table**, `service_role` included: the project's tables are not granted wholesale
(`meal_items` and `profiles` both failed for the service role until they were).
`memberships` joins the `supabase_realtime` publication (the access hook listens
to it; it is not there today).

### `subscriptions` (one row per user, the current state)

`user_id` (pk, → `profiles`, cascade), `product_id`, `store`, `environment`
(`production` | `sandbox`), `status` (`active` | `cancelled` | `billing_issue` |
`expired`), `is_premium`, `will_renew`, `started_at` (first purchase),
`current_period_started_at`, `expires_at`, `grace_expires_at`, `access_until`,
`rc_app_user_id`, `last_event_id`, `last_event_at`, `last_synced_at`,
`updated_at`.

`cancelled` means «auto-renew is off but the paid period has not ended»: it still
has access. `expired` means access has ended (a paused Google subscription is
`expired` until it resumes). The app and panel tell them apart by `status`, never
by guessing from dates. RLS: a user reads their own row; the coach reads all;
only the service role writes. In `supabase_realtime`.

### `revenuecat_events` (idempotency and audit)

`event_id` (pk, RevenueCat's id; retries reuse it), `event_type`, `app_user_id`,
`event_at`, `payload` (jsonb, whole), `received_at`, `outcome` (`received` |
`synced` | `ignored` | `unknown_user` | `failed`), `error`. No policies, no
grants but `service_role`: unreadable from the API.

### Writers

Two `SECURITY DEFINER` functions, executable by `service_role` only:
`record_revenuecat_event(...)` inserts the event `on conflict do nothing` and says
whether it is new, a repeat already `synced`, or a repeat still unprocessed (a
retry after a failure, which must run again); `apply_subscription_snapshot(user,
patch, fetched_at)` upserts the row only when `fetched_at` is not older than the
row's `last_synced_at`, so two overlapping syncs cannot leave the older answer.
Both live in SQL so idempotency and ordering are tested by the smoke script with
plain data, without deploying anything.

### `content_requests`

`id`, `user_id` (→ `profiles`, cascade), `kind` (`program` | `nutrition_plan`),
`status` (`pending` | `fulfilled` | `dismissed`), `note` (≤ 500 chars),
`created_at`, `resolved_at`, `resolved_by`. A partial unique index allows one
`pending` request per user and kind.

- **Insert only through `request_content(kind, note)`**, which refuses the coach,
  a caller without access, and a caller who already has an active assignment of
  that kind; if a pending one exists it returns that instead of failing. There is
  no client `INSERT` policy.
- RLS: a client reads their own; the coach does everything. In `supabase_realtime`.
- **Fulfilled automatically**: a trigger on `programs` / `nutrition_plans` (a row
  becoming `active` for a client, not a template) marks that client's pending
  request of that kind `fulfilled`. Supplement plans resolve nothing. The coach
  can also dismiss one.
- A trigger writes a `coach_notifications` row, kind **`content_requested`** (the
  kind check gains it), `data = {kind, request_id, note}`, `dedupe_key =
  'content_requested:<id>'`.

### Coach rules follow access

`create_coach_daily_notices()` and `send_block_ending_pushes()` decide who is «being
coached» with `m.client_id is null or m.status = 'active'`. Both move to
`is_being_coached(user)`, which returns **that exact legacy rule while
`enforced` is false** and real access once it is true. A locked client cannot
train, so «4 days without training» would only be noise. The smoke script proves
the two jobs select the same clients as before while the switch is off. The
assign and update pushes are unchanged: a locked client who is told «Tienes un
nuevo programa» lands on a «Renovar» screen.

## Webhook and sync

`revenuecat-webhook` Edge Function, deployed with `--no-verify-jwt` (RevenueCat
sends no Supabase token), added to `deploy-functions.yml` like `estimate-meal`.
RevenueCat's webhooks need its Pro plan, which costs nothing below $2,500 of
monthly tracked revenue.

- **Authentication.** RevenueCat sends a fixed `Authorization` header value set in
  its dashboard on every request; the function compares it in constant time with
  the secret `REVENUECAT_WEBHOOK_SECRET` (unset → 503, wrong → 401, `POST` only).
  RevenueCat can also sign each request (`X-RevenueCat-Webhook-Signature`,
  `t=<unix>,v1=<hmac-sha256>` over `"<t>.<raw body>"`); when
  `REVENUECAT_WEBHOOK_SIGNING_SECRET` is set the function also requires a valid
  signature within 5 minutes. Because the payload never decides access (below),
  a replay can do nothing but trigger a re-read.
- **What triggers a re-read.** `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`,
  `UNCANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`, `PRODUCT_CHANGE`,
  `SUBSCRIPTION_PAUSED`, `SUBSCRIPTION_EXTENDED`, `REFUND_REVERSED`,
  `TEMPORARY_ENTITLEMENT_GRANT`, and `TRANSFER` (every user in `transferred_from`
  and `transferred_to`; the event has no `app_user_id`). `TEST` is acknowledged;
  any other type is recorded as `ignored`.
- **The re-read.** For each affected id that is a UUID *and* an existing profile
  (RevenueCat's lookup creates a missing customer, so never an arbitrary id), the
  function asks RevenueCat's REST API for the customer with the secret key
  `REVENUECAT_API_KEY` and turns the answer into a patch with a pure function.
  `apply_subscription_snapshot` writes it.

| RevenueCat's customer says | Row |
|---|---|
| no `premium_access` entitlement, or the subscription is refunded | `is_premium = false`, `status = 'expired'` |
| the entitlement is active (end, or grace end, in the future) | `is_premium = true`, `access_until` = the later of the two |
| …and a billing issue is detected | `status = 'billing_issue'`, `will_renew = false` |
| …and an unsubscribe is detected | `status = 'cancelled'`, `will_renew = false` |
| …otherwise | `status = 'active'`, `will_renew = true` |
| product, store, sandbox flag, first and current purchase dates | `product_id`, `store`, `environment`, `started_at`, `current_period_started_at` |

- **Responses.** RevenueCat treats only HTTP 200 as success, waits 60 seconds, and
  retries five times (about 2.5, 5, 10, 20 and 40 minutes) before giving up. The
  function answers 200 for anything handled, ignored, repeated or about a user it
  does not know (recorded, not retried) and 5xx only when the database or
  RevenueCat's API failed, so it is retried.
- **`sync-subscription`**, a second function with the normal JWT check: re-reads
  *the caller's own* customer (the id comes from the token, never the body),
  applies it, returns the new access. The app calls it right after a purchase or
  a restore, and from Settings. It is the safety net for a webhook that was lost
  or late, and costs nothing extra: it is the same code. Calls within 10 seconds
  of the last sync return the stored row.
- **Sandbox.** One webhook configuration sends production and sandbox events;
  they are applied and flagged `environment = 'sandbox'`, so the production
  project can be tested from the stores' sandboxes.
- The pure parts (event → ids and action, customer → patch) live in
  `supabase/functions/_shared/revenuecat.ts` and are unit-tested under `src/utils/`
  with fixtures, as the meal-estimate module is; the handler takes its database
  and its RevenueCat client as arguments so a test can fake both.

## The app

Dependency: `react-native-purchases` (latest 11.0.2; it needs React Native 0.80 and
Expo SDK 54, the app has 0.86 and 57). Native code: a new development build, and
it does not work in Expo Go. No `react-native-purchases-ui`: the paywall is built
from the app's own components to keep the Dojo Poster look.

- **Configuration in one place** (`src/config/purchases.ts`): the entitlement id,
  the public SDK keys from `EXPO_PUBLIC_REVENUECAT_IOS_KEY` /
  `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (EAS variables per build profile, like the
  Supabase ones), the Terms and Privacy URLs. No product ids in code: the offer is
  the RevenueCat offering, matched by package type (`$rc_monthly`,
  `$rc_three_month`, `$rc_annual`).
- **`SubscriptionProvider`**, under `AuthProvider`: configures the SDK once
  without a user id (native only), `logIn(user.id)` when the session starts,
  `logOut()` on sign-out, and on a `CustomerInfo` update only invalidates the
  access query. Nothing in it decides access.
- **`usePremiumAccess()`**, the one hook every screen uses: wraps `get_my_access()`
  in react-query (persisted, so it renders offline), refetches on focus and when
  `subscriptions` / `memberships` change over Realtime, and compares the end of
  access with the local clock so an expiry flips the screen without a round trip.
  A pure function (`src/utils/subscription.ts`, unit-tested) turns the row into
  `loading | open | active | cancelled_active | grace | lapsed`. When access
  flips, the program, nutrition-plan and supplement queries are invalidated.
- **Paywall**: a route outside `(tabs)` (`AuthGate` sends a signed-in client back
  to `(tabs)` from every other route, so it gets one allowed exception). Three
  package cards with the store's own price strings, `pricePerMonthString` and a
  saving computed from them, the primary button, «Restaurar compras», and what
  Apple requires on a subscription screen: the name and length of each plan, what
  the client gets, the full renewal price as the most prominent number, Terms of
  Use and Privacy links, and a way to manage the subscription. Custom paywalls
  must call restore themselves.
- **Request sheet**: one tap and an optional note; the onboarding profile is the
  intake. Sends `request_content`; online only.
- **Screens by state** (training tab, nutrition tab, Home's program card;
  supplements follow nutrition):

| Access | Assigned content | Shows | Button |
|---|---|---|---|
| none | none | empty state | «Solicitar programa» → paywall |
| none | exists | locked state «Tu acceso terminó» | «Renovar suscripción» → paywall |
| active | none, nothing pending | empty state | «Solicitar programa» → request sheet |
| active | none, request pending | «Solicitud enviada» + date | — |
| active | exists | the program, as today | — |

  (nutrition the same, with «Solicitar Plan de nutrición»). While `enforced` is
  false every client counts as active, so nothing changes for anyone.
- **Settings** gets a subscription card beside the membership card: status,
  renewal or end date, «Gestionar suscripción» (iOS `showManageSubscriptions()`;
  on Android the customer's `managementURL`), «Restaurar compras». A client whose
  access comes from a membership sees that.
- **Purchase states**, by the SDK's error code: offerings loading or failed
  (offline: retry); in progress (buttons disabled); `PURCHASE_CANCELLED` (silent);
  `PAYMENT_PENDING` (Ask to Buy, Google pending: «pendiente de aprobación»);
  `NETWORK` / `OFFLINE` («Sin conexión»); `PRODUCT_ALREADY_PURCHASED` /
  `RECEIPT_ALREADY_IN_USE` (offer restore); `STORE_PROBLEM` / `PURCHASE_NOT_ALLOWED`
  (store message and retry); success: «Confirmando tu compra…», `sync-subscription`
  at once, then wait for the access query to turn active (Realtime, up to a
  minute, then «Tu compra se está procesando»). Success is never shown from the
  SDK alone. Restore runs only from a tap.
- **Reminders** (`dateAllowed` in `src/utils/reminders.ts`) read coverage from
  `get_my_access()`, and keep the membership rule while `enforced` is false.
- **Web** has no purchase SDK: the paywall explains that subscribing is done in
  the iOS or Android app; access that exists works normally.
- **Offline**: purchasing and requesting need a connection and say so; reading
  uses the persisted cache. A queued write the database still refuses is dropped
  by the existing outbox, as today.

## The panel

No new page. Existing places learn the new facts.

- **The bell must tolerate unknown notice kinds first.** `describeNotice` has no
  default case and `NotificationBell` reads `v.tone`, so the first
  `content_requested` row would break it. This tiny change ships before the
  migration is applied.
- **Dashboard «Hoy necesita tu atención»** and the **bell**: a top-ranked item,
  «Solicitó un programa» / «Solicitó un plan de nutrición», with the note and one
  action: «Crear programa» / «Crear plan» → the client's tab.
- **Client page**: in the Programas and Nutrición tabs, a banner with the pending
  request (date, note, «Descartar»); in the header, a «Sin acceso» warning when
  the client is locked, with «Dar acceso» (the existing renew action).
- **Clientes list**: a «Solicitud» badge and filter chip.
- **Membresías page and the client's Membresía tab**: the store subscription next
  to the manual membership (status, store, product, renews / ends, sandbox flag),
  read-only, and the combined access. The manual editor is unchanged.
- **Add client** gets «Dar acceso ahora» (on by default): it creates an active,
  open-ended membership with the account. A coach who adds someone by hand is
  vouching for them, and `create-client` writes no membership today.
- Lists read access from `coach_client_access()`; `ClientSummary` also embeds the
  subscription and pending requests (`subscriptions!user_id`,
  `content_requests!user_id`), so the lists stay one query. The attention rules
  and the «clientes activos» count use `being_coached`.

## Edge cases

- **`app_user_id` not a UUID** (an anonymous RevenueCat id) or no such profile:
  recorded as `unknown_user`, answered 200; a later transfer or purchase event
  carries the real user.
- **Same store account on two app accounts**: RevenueCat's default restore
  behavior transfers the subscription to the newer account; the transfer event
  re-reads both. The first account loses access.
- **A lost, late or repeated event**: duplicates change nothing; `access_until`
  ends access on its own; `sync-subscription` repairs a missed renewal. A
  cancellation can reach us up to about two hours late, so «cancelada» may show
  late. Harmless.
- **Cancelled, then reactivated in the store**: `UNCANCELLATION` restores `active`;
  only the store's manage page can do it.
- **A client with an active membership and a lapsed subscription** has access (the
  rule is «any»); Settings says which source applies.
- **Progress cards for a locked client**: set logs and completions are read with
  embedded program rows; those return nothing under the lock and the code falls
  back to the exercise name and laterality stored with each log. Verify on a
  lapsed account that the charts still draw and nothing crashes.
- **The cache after a lapse**: a persisted program may still render offline until
  the app reconnects, but the screen checks access (local clock) first and shows
  the locked state.
- **Purchase while the webhook is slow**: `sync-subscription` covers it; the
  screen keeps listening past its timeout message.
- **Two pending requests, a request for content that now exists, a coach
  request**: one pending per kind (a second call returns the first), refused when
  an active assignment exists, refused for the coach.
- **Old app builds and the web/PWA after the switch**: they cannot sell anything.
  A locked client on one sees today's «Aún sin programa». Web and PWA clients
  keep access only through a membership. This is why go-live is a checklist.
- **Client deleted**: subscriptions, requests and notices cascade.

## Verification

| # | Case | Where it is checked |
|---|---|---|
| 1 | New user, nothing | SQL smoke: no access when enforced, content and requests refused; unit test of the UI state |
| 2–4 | Buy monthly / quarterly / annual | unit tests: each product's customer → row; SQL smoke: access from the row; a purchase in a dev build (Test Store first, then the stores' sandboxes) |
| 5, 6 | Subscribed, asks for a program / a plan | SQL smoke: `request_content`, notice written, duplicate returns the first; panel check |
| 7 | Both assigned | SQL smoke: content readable, pending requests fulfilled by the assignment |
| 8 | Cancels, keeps access | unit test: `cancelled`, `will_renew = false`; SQL smoke: access until `access_until`; UI state |
| 9 | Expires | SQL smoke: content hidden, history readable, writes refused after 72 h; device check of the locked state and Progress |
| 10 | Restores | unit test: transfer touches both users; `restorePurchases` on a device |
| 11 | New device | same user id returns the same row (SQL); sign-in on a second device |
| 12 | Payment problem | unit test: billing issue keeps access until the grace end; SQL smoke: then none |
| 13 | Premium action without access | SQL smoke as `authenticated`: request, content read and log write refused |
| — | Duplicate, late, out-of-order | SQL smoke: a repeat changes nothing; an older fetch does not overwrite a newer one |
| — | Webhook auth | unit tests: no secret, wrong, right; bad and good signature; `TEST` |
| — | Dark by default | SQL smoke: with `enforced = false` no policy blocks anyone and the two jobs pick the same clients as the old rule |
| — | Panel access function | SQL smoke: refused for a client, correct rows for the coach |

The SQL smoke script follows `supabase/scripts/smoke_*.sql`: acts as the
`authenticated` role with forged claims, asserts each rule, and ends with
`SMOKE OK … nothing was saved`, so it can run against the live project. Real
purchases need the setup below; until then the backend and the UI are verified
with fixtures and the unit tests.

## Staged delivery

0. **Panel, tiny**: the bell tolerates unknown notice kinds. Before step 1 is
   applied. (The panel's rule: ask before every push.)
1. **Server, dark**: the migration (switch off), the webhook and `sync-subscription`,
   the pure module, the deploy line, the smoke script, tests, docs. Applying it
   to production and setting the secrets wait for the owner's go; nothing changes
   for any user.
2. **App**: SDK, provider, hook, paywall, request sheet, the screen states,
   Settings card, es/en copy, a new development build. The Test Store lets the
   whole purchase flow run before any store account exists.
3. **Panel**: requests everywhere, the subscription next to the membership,
   access-based rules, «Dar acceso ahora».
4. **Stores** (the owner's side, in parallel from day one): the setup below, then
   the sandbox pass over the 13 cases on both platforms.
5. **Go-live checklist**, then one statement.
   1. Stores and RevenueCat set up; real sandbox purchases pass the 13 cases on
      both platforms; the webhook shows them arriving.
   2. The new app build is released and installed (old builds cannot sell).
   3. The panel is updated.
   4. Decide who keeps access: give every existing client who should keep it an
      open-ended membership (the panel's Membresías page, or one `insert` I
      prepare). Clients on the web or PWA keep access only this way.
   5. `update public.premium_settings set enforced = true;` Watch
      `revenuecat_events` and the first purchases.
   6. Rollback: the same statement with `false`.

## Setup outside the code

Under the developer's own accounts first; none of it blocks steps 0 to 3.

- **Apple**: paid developer account; the Paid Applications agreement with tax and
  banking details; a subscription group (with its localization) holding three
  products (1 month, 3 months, 1 year) each with a name, price and review
  screenshot; the first products are submitted with an app version; an In-App
  Purchase key (`.p8` and Issuer ID) for RevenueCat; an App Store Connect API key
  (recommended); App Store Server Notifications V2 pointed at RevenueCat (optional,
  faster refunds and events); sandbox testers. Sandbox renews 1 month in 5 minutes,
  3 months in 15, 1 year in 1 hour, up to 12 times; TestFlight renews daily, 6
  times.
- **Google**: Play Console developer account; the app with an uploaded build on a
  testing track; a subscription with three base plans (1 month, 3 months, 1 year);
  a service account with the roles RevenueCat lists, invited in Play Console
  (**validation takes up to 36 hours: start early**); real-time developer
  notifications through Pub/Sub (optional, strongly recommended); license testers.
  Sandbox renews 1 month in 5 minutes, 3 months in 10, 1 year in 30, up to 6 times.
- **RevenueCat**: a project; an iOS and an Android app whose bundle id and package
  name match the builds; the six products attached to the entitlement
  `premium_access`; one offering with the three packages; the public SDK keys; a
  secret API key; the Test Store key for development builds only; the webhook:
  URL `https://rzgwkwxskrovxnnymxqo.supabase.co/functions/v1/revenuecat-webhook`,
  both environments, all apps, the Authorization value from
  `REVENUECAT_WEBHOOK_SECRET`, and the signing secret if used.
- **Ours**: the function secrets `REVENUECAT_WEBHOOK_SECRET`,
  `REVENUECAT_API_KEY` (and `REVENUECAT_WEBHOOK_SIGNING_SECRET`); the EAS
  variables per profile; the Terms and Privacy links for the paywall (Privacy
  exists: `EXPO_PUBLIC_PRIVACY_POLICY_URL`, the panel's `/privacidad.html`; Terms
  of Use does not: Apple's standard EULA, or a page of the coach's own); a
  development build on a real device for each platform.

## Open risks

- **New Architecture** is mandatory on Expo SDK 57 and RevenueCat states no
  support either way (one maintainer's fresh SDK 54 project ran Bridgeless and
  Fabric). The first development build is the check.
- **SDK version.** RevenueCat's 11.0.0 notes told Expo apps to stay on 10.x while
  CocoaPods' trunk was frozen; the pods 11.0.2 needs are on trunk now and nothing
  withdraws the advice explicitly. Install 11.0.2 first, fall back to the newest
  10.x if iOS pods do not resolve. Trunk goes read-only on 2026-12-02; a later
  major drops CocoaPods. Pin exact versions.
- **Test Store** release builds crash with a Test Store key (TestFlight and Play
  test tracks count): the key lives only in the `development` profile. Whether
  Test Store purchases fire webhooks is unverified; if they do not, the first
  pass uses `sync-subscription`.
- **REST details unverified**: the key type v1 accepts and its rate limit (v2:
  480 requests a minute). The first real sync call settles it; v2 is an
  equivalent source if v1 is a problem.
- **Google pause and Apple billing retry** are described inconsistently across
  RevenueCat's pages; the design relies on the re-read, not on event meaning.

## Left to the builder

- The paywall's layout inside the Dojo Poster look; polish of the Spanish and
  English copy (the strings below are the intent).
- REST v1 or v2 behind the same internal shape; exact column types and indexes;
  retention of `revenuecat_events`.
- The poll interval and timeout of «Confirmando tu compra…».
- Whether Home shows the lock state as a card or reuses the tab's component.

## Out of scope

Free trials and offers; web purchases; per-feature entitlements; gating the AI
insight; coach push or email on a request; re-requesting after a block ends
(today the coach archives the old program and assigns the next); revenue
reporting; a forced-update screen for old builds; changing the manual membership
editor beyond «Dar acceso ahora».

## Calls made in design (owner to check)

1. Supabase is the app's only source for access; the SDK buys, restores, manages
   and prices, and its updates only trigger a refetch.
2. The webhook is a trigger: the state is re-read from RevenueCat's REST API and
   the payload is never trusted. A second, on-demand `sync-subscription` exists
   for the caller's own account.
3. One switch, off by default; everything ships dark and go-live is one statement.
   Until then the coach jobs and the reminders keep today's membership rule.
4. The coach role always has access.
5. Only coach content and its logging are gated. Onboarding, profile, weight and
   the AI insight stay open to everyone, because a new client must finish
   onboarding before they can subscribe.
6. Writes to the five logging tables stay open for 72 hours after access ends, so
   offline logs do not vanish; reads of coach content lock at once.
7. The lock hides content of every status, active and archived: the app never
   shows archived content, and logs keep their own exercise names.
8. A request is one tap and an optional note up to 500 characters; the onboarding
   profile is the intake.
9. Request alerts are the bell, the Dashboard, the client page and the list; no
   push or email.
10. Supplement plans follow the nutrition gate and have no request of their own.
11. Assign and update pushes still reach a locked client (it is a reason to
    renew); block-ending pushes, reminders and the coach's notices follow access.
12. Sandbox purchases grant access on the production project and are flagged, so
    the stores can be tested before any real client exists.
13. The web build is view-only; web and PWA clients keep access through a
    membership.
14. A manual membership counts exactly as the panel shows it today (`active`, not
    past `expires_at`); one with no end date counts.
15. «Trimestral» is the store's three-month period (RevenueCat's three-month
    package).
16. «Dar acceso ahora» defaults to on when the coach adds a client by hand.
17. The SDK version (11.0.2, or the newest 10.x) is decided at install, by whether
    the iOS pods resolve.

## Copy (es)

- Training, none/none: «Aún sin programa» · «Suscríbete y pídele tu programa
  personalizado a tu coach.» · **Solicitar programa**
- Training, premium/none: «Aún sin programa» · «Pide tu programa y tu coach lo
  preparará para ti.» · **Solicitar programa**
- Pending: «Solicitud enviada» · «Tu coach la verá y te avisará cuando esté lista.»
- Locked: «Tu acceso terminó» · «Renueva tu suscripción para volver a tu programa.
  Tu historial sigue aquí.» · **Renovar suscripción**
- Nutrition: the same with «plan de nutrición» and **Solicitar Plan de nutrición**.
- Paywall: «Acceso Premium» · **Mensual**, **Trimestral**, **Anual** ·
  **Suscribirme** · «Restaurar compras» · «Se renueva automáticamente. Puedes
  cancelar cuando quieras desde los ajustes de la tienda.»
- States: «Confirmando tu compra…» · «Tu compra está pendiente de aprobación» ·
  «No se pudo completar la compra. Inténtalo de nuevo.» · «Compras restauradas» ·
  «No encontramos compras para restaurar» · «Sin conexión».
