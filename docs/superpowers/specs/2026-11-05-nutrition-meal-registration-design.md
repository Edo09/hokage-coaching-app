# Nutrición: register the plan's meals instead of a diary, in the Dojo Poster look

Date: 2026-11-05 · Status: approved by the product owner on 2026-11-05 ·
Repos: `hokage-coaching-app` (app, one migration, a new Edge Function, small
`ai-complete` and prompt changes, docs) and `hokage-web-panel` (meal states
and counts in «Lo que ha comido» and Resumen, the Dashboard alert's query,
the phone preview, wording, the privacy policy)

Mockups: [`2026-11-05-nutrition-meal-registration-mockups.html`](2026-11-05-nutrition-meal-registration-mockups.html)
(open in a browser). They are a visual reference; build with the app's own
components and tokens.

## Problem

The Nutrición tab has three panes: Plan · Suplementos · Diario. Diario is a
free-form food log that predates the coaching product. In it the client can
log any food on any day, type the numbers in or have the AI estimate them, and
navigate between dates. A plan option is "registered" by opening that same
add-food screen with the option's first food filled in.

The coach (the buyer) wants clients to follow only the plan they assigned, so
the free-form log goes. What the coach still needs to know is whether the
client ate what the plan says, with a photo, and what they ate instead when
they didn't.

The tab also looks unfinished next to Inicio and Programa. It never adopted
the Dojo Poster pieces: Anton titles and numbers, slanted red buttons, sharp
chips and red top bars. It shows meals the coach left unnamed in lowercase
(«desayuno»), and every option ends in an identical full-width red button.

## Decisions (from the product owner)

1. **Diario goes.** That removes free-form logging, date navigation, the
   add-food and edit-food screens, and typed-in numbers.
2. **Each of today's plan meals is registered in one of three ways:**
   - **Lo del plan:** the client picks the option they ate (Opción 1, 2…).
   - **Comí otra cosa:** the client types what they ate.
   - **No la comí:** the meal counts as done for the day, with 0 kcal, no
     photo and no AI. The coach sees it as «No comió».

   With the first two they can add a photo. **The photo is optional.**
3. **The AI works after the client saves, never before, and on the server:**
   - For «otra cosa» text, it fixes **spelling, accents and capital letters
     only**. It never adds, removes or rewords anything, and there is no
     preview before saving.
   - **Every** meal the client ate gets an AI estimate of its calories and
     macros, plan options included. That keeps the day's totals meaningful.
   - **The server makes the estimate**, not the app. It arrives within
     seconds of the save reaching the server, even if the client closes the
     app afterwards. Online, that is right after saving; offline, once the
     save syncs.
4. **A registered meal can be changed or undone the same day.**
5. **The coach panel stays as it is today**, now fed by the registrations:
   - «Lo que ha comido» day by day, with photos, the «del plan» badge and
     kcal against the goal;
   - «Días con comidas» in Resumen;
   - the Dashboard alert for clients who go 4+ days without registering.

   **Two small additions** to «Lo que ha comido»:
   - a meal whose estimate hasn't arrived says «Calculando…» or «Sin
     estimar» instead of counting as 0;
   - a skipped meal says «No comió».
6. **Look:** direction A from the mockups, with the checks on the right.
   - Today's meals are a list of cards in the coach's order.
   - Each card shows its status on the right.
   - The next meal is open with its options.
   - Everything uses the Dojo Poster style.

## Goals, non-goals, anti-goals

**Goals**
- The client follows the coach's plan and says, meal by meal, whether they
  did. Registering takes a couple of taps.
- The coach keeps seeing what clients ate, with photos and calories, in the
  same places as today.
- The tab looks like the rest of the app.

**Non-goals**
- Logging food outside the plan's meals, editing numbers by hand, or
  registering past days.
- Redesigning the panel.
- New nutrition data for the coach: no portions or macros per food.

**Anti-goals.** Any of these makes the change a failure even if it works:
- The AI changes what the client meant. «arroz con pollo» must never become
  «pollo asado con arroz integral».
- Registering feels slow because the meal waits for the AI before it shows as
  registered.
- A registration silently counts as 0 kcal because its estimate never
  arrived.
- The panel's «Lo que ha comido», «Días con comidas» or Dashboard alert break
  or go empty.

## The tab

### Structure

- **Header:** the shared `TabHeader` is unchanged: NUTRICIÓN, the red dash and
  the date. The date must follow the day (`useToday`) instead of being
  computed once at render.
- **Today's rows:** the tab and Inicio pick today's registrations by
  `useToday()`'s date key (`src/lib/today.ts`). `useMeals().todaysMeals`
  doesn't change at midnight, so it can't be the source.
- **Switcher:** PLAN · SUPLEMENTOS, using the shared red slanted
  `SegmentedControl`.
- **PLAN pane**, top to bottom:
  1. The **Hoy** card.
  2. A row with the **day-type chip** on the left and «N de M comidas» on the
     right.
  3. **One card per meal** visible today, in plan order.
  4. The **shopping list**, kept and restyled.
  5. **Notas del coach**, kept and restyled.
- **SUPLEMENTOS pane:** same content and same daily check-offs, restyled with
  the same pieces (header card, tier cards, Horario).

All of it uses the Dojo Poster building blocks that Programa and Inicio
already use (`PosterText`, `CapsLabel`, `Skewed`, `Badge`, `Card` with
`topAccent`). Specifically:
- Anton for meal names and every number.
- Square-cornered chips.
- Red only for brand and action; gold only for AI.
- Macro colours: protein blue, carbs amber, fat rose.

Unnamed meals show their type name capitalised («Desayuno»), never in
lowercase.

### Hoy card

- **Top accent:** today's registered kcal divided by the top of the target
  range, capped at 100%.
- **Label:** «HOY · ✦ estimado con IA», with the second half in gold.
- **Kcal:** the registered kcal in large Anton, then the target as the coach
  set it («/ 1,800–1,850 kcal», or a single number when min = max). To the
  right:
  - below the minimum: «N restantes» (to the minimum);
  - within the range: «En tu rango»;
  - above the maximum: «N de más».
- **Macros:** a row of three: protein, carbs and fat registered against
  target, each shown as the coach set it («92 / 150–155 g»).
- **Counting:** as in [Counting](#counting). «No la comí» adds 0.
- **Missing estimates:** while any of today's registrations is pending, the
  card shows «✦ Calculando…» under its kcal. Otherwise, while any has failed,
  it shows «Sin estimar», and tapping that retries today's failed ones. This
  also covers registrations that have no card (see [Edge cases](#edge-cases)).
- **Plan without a target row:** show the registered totals with no target.
- **Nothing registered yet:** show «0 / {target}».
- **Inicio's ring is separate.** It keeps its own goal (the midpoint) and
  adds burned kcal, so its «Restantes» can differ from this card's on
  purpose.

### Meal card states

| State | Left | Middle | Right |
|---|---|---|---|
| **Next**: open, red border | Meal-type icon in a red tile | Anton name + chip «Siguiente»; time_hint · «N opciones»; option tabs; the option's foods; slanted button «Registrar {comida}» | Red outlined box |
| **Pending** | Meal-type icon | Anton name; time_hint · «N opciones» | Dashed box |
| **From the plan** | Photo, or the meal-type icon without one | Anton name; chip «Opción N» (or «Del plan» when that option is gone) + time_hint | Anton kcal + red ✓ box |
| **Otra cosa** | Photo or icon | Anton name; chip «Otra comida» + the text | Anton kcal + grey ⇄ box |
| **No la comí** (muted) | Meal-type icon | Anton name; chip «No la comí» + time_hint | No kcal; grey box with «–» |
| **Estimating** | as registered | as registered | «✦ Calculando…» in gold + its box |
| **Estimate failed** | as registered | as registered | A small «Sin estimar» button (tap retries) + its box |
| **Optional** | as pending, lighter | adds an «Opcional» chip | Dashed box |
| **Not for today** (`applies_to` is the other day type) | Hidden, unless already registered. If the meal has a note, show a compact «No aplica hoy» row with the note and no box. | | |

Rules:
- **«N de M»:** M is the required meals that apply today, plus every
  registered meal (an optional one, or one the day type would now hide). N is
  the registered ones, «No la comí» included. A «No aplica hoy» note row is
  never in M.
- **Next:** the first required, unregistered meal that applies today, after
  the registered meal that comes last in plan order, whenever it was saved.
  If none follows it, the first such meal from the top. «No la comí» counts as
  registered, and a «No aplica hoy» row is never next. A meal the client
  forgot therefore doesn't keep pulling «Siguiente» back to it; it stays
  pending and can be tapped.
- **The chip always reads «Siguiente».** It does not depend on the clock,
  because time_hint is free text such as «30-45 min antes de entrenar».
- **Optional meals:** never «next», and counted in «N de M» only once
  registered. They don't offer «No la comí», since skipping them is already
  allowed.
- **Registered meals stay.** A registered meal, «No la comí» included, keeps
  its card and counts in «N de M» even when a day-type change says it
  doesn't apply today.
- **Opening cards:** tapping a pending card opens it in place of the next
  one. Only one is open at a time.
- **Option tabs:** shown only when there is more than one option. A note on
  an option shows under its foods.
- **Registered cards:** tapping one opens the registration sheet with it
  loaded. On a failed card, the «Sin estimar» button retries instead: it
  marks the estimate pending again, and the card shows «✦ Calculando…» at
  once.

### Registration sheet

A bottom sheet over the dimmed tab, with these parts:
- **Header:** the meal name in Anton and its time_hint.
- **«¿Qué comiste?»:**
  - The options are radio rows, each with its label and that day's foods.
  - The option showing on the card comes pre-selected.
  - A plan registration whose option is gone opens with a first,
    pre-selected row «Del plan» that shows the stored foods. Saving it
    unchanged keeps the registration; picking a current option or «Comí otra
    cosa» replaces it.
  - Then **«Comí otra cosa»**, with a dashed border and «Escribe lo que
    comiste» under it. It opens a required text box right under it, with the
    same placeholder and the hint «Al guardar, la IA corrige la ortografía y
    calcula las calorías.» While it is selected, the option rows shrink to
    their labels and the text box takes the place of its subtitle (mockup 3).
  - The last row is **«No la comí»**, plain and quieter than the others. It
    is not offered on optional meals.
- **Photo row:** «Añadir foto · Opcional». It opens the camera or the gallery
  through the existing picker and its strings. With a photo, it shows the
  thumbnail, «Foto del plato», «Cambiar» and «Quitar foto». Offline, unless
  the builder queues offline photos, it says «La foto necesita conexión.
  Puedes guardar sin ella.» It hides while «No la comí» is selected, and a
  photo picked before that is dropped on save.
- **«Guardar»:** the slanted red button. It is disabled while «otra cosa» is
  selected with no text.
- **When editing a registration:** a secondary «Deshacer registro» action,
  with a confirmation: «¿Deshacer el registro?» · «{{meal}} vuelve a quedar
  pendiente.» · «Deshacer» · «Cancelar».

Saving closes the sheet at once, even with a photo still uploading (see
[Saving](#saving)):
- the card turns registered, showing «✦ Calculando…»;
- the next meal opens;
- the check plays Programa's pop and haptic. Its shape is the approved
  slanted box, not Programa's circle.

Saving «No la comí» shows its state at once, with no estimate and no pop.

### Day type

**Unchanged:**
- **Today's type:** training when the active program has today's weekday,
  otherwise rest.
- **Override:** the client can change it, labelled «Según tu programa» /
  «Cambiado por ti».
- **When it shows:** only when the plan cycles.

**What changes:**
- **Look:** it becomes the chip «⚡ Día de entreno» / «Día de descanso», which
  opens the choice.
- **Duration:** the override lasts for today only. It is saved with the date,
  so it survives an app restart or Android killing the app, and it resets at
  midnight. Today it is lost on restart, yet survives into the next day while
  the tab stays mounted.
- **Shared:** Inicio's calorie goal follows the same override, so both
  screens use the same day type.

### No plan

- **PLAN without a plan** shows «Sin plan nutricional» / «Tu coach aún no te
  ha asignado uno.», with no mention of a diary.
- **Pane the tab opens on:**
  - PLAN when there is a nutrition plan;
  - otherwise SUPLEMENTOS when there is a supplement plan;
  - otherwise PLAN.

  This is decided once both queries have loaded. That fixes today's flicker
  from DIARIO to PLAN.

## The AI after saving

The server makes every estimate (owner's decision). The app only saves.

### Saving

- **Immediate and offline-first.** Registrations go through the outbox as
  the diary's entries did.
- **What the app writes.** The server enforces all of this anyway (see
  [Bookkeeping](#bookkeeping)):
  - a plan or «otra cosa» registration: its estimate pending and its numbers
    at 0;
  - «otra cosa»: the text exactly as typed, in both `name` and the
    original-text column. The app writes the original text whenever the
    client types, on the first save and on every text edit, and nothing else
    ever changes it;
  - «No la comí»: numbers at 0, no photo and no estimate state.
- **With a photo**, the sheet still closes at once, and the server still makes
  one estimate, with the photo. So:
  - the row reaches the database only once its photo is in storage, or
    without the photo if the upload is given up;
  - the row is never written first and given its photo later, which would
    run two estimates and charge the quota twice;
  - closing the app mid-upload must not lose the registration;
  - an upload never holds back other writes. The outbox is strictly first in,
    first out, so a multi-MB upload must not sit in it;
  - an upload that finds its file already stored counts as done. One that
    keeps failing while online is given up after a few tries, and the row is
    saved without the photo.

  How is left to the builder (see [Left to the builder](#left-to-the-builder)).

### How the estimate starts

- **Database triggers call a new Edge Function** through `pg_net`, as the
  push notifications already call Expo's API. The call is made from `AFTER
  INSERT` and `AFTER UPDATE` triggers on `meal_items`. They fire exactly when
  the bookkeeping trigger has started a send (a new plan or «otra cosa» row,
  a content change, or a retry; see [Bookkeeping](#bookkeeping)). They only
  call `net.http_post` and never update the row. The call is never made from
  a `BEFORE` trigger, which would also run for an outbox replay that `ON
  CONFLICT` then skips.
- **Server writes never start an estimate:** the function's and the cron's
  own writes, and link-only changes such as `plan_option_id` or
  `plan_meal_id` set to null when the coach removes an option or a meal.
  `ON DELETE SET NULL` runs `meal_items`' update triggers inside the coach's
  save.
- **The call never fails the write.** As in the push triggers, the Vault
  lookup and `net.http_post` sit in an exception block that only raises a
  warning. When no secret is set yet, the call is skipped and the row waits
  for the cron. No new trigger on `meal_items` may raise: they also run inside
  the coach's `save_nutrition_plan`, and the outbox drops any write the
  database rejects.
- **Every new database function** is `security definer` with `search_path`
  set to `''`, like the repo's other definer functions. Each one revokes
  execute from `public`, `anon` and `authenticated`, as
  `create_coach_daily_notices` does, so no client can call it through
  `rpc()`.
- **The function's URL and its secret come from Supabase Vault**, set by
  hand, so the migration names neither. Vault is new to this repo. The call
  passes `timeout_milliseconds` explicitly.
- **Only the database can call the function.** It checks that secret on
  every call.

### The function

- **It answers at once** and finishes in the background
  (`EdgeRuntime.waitUntil`). `pg_net` stops waiting after a few seconds by
  default (the documented default differs between versions), and a model
  call with a photo can take up to 30 s.
- **It reads the row** with the service role. It does nothing when the row is
  no longer pending, or its version is no longer the one the call was sent
  for.
- **It reads the photo** from the `meal-photos` bucket only under
  `<row's user_id>/`, within `ai-complete`'s size and type limits, and it
  caps the text it sends. A photo that is missing, too big or not an image is
  ignored like a photo that isn't food.
- **It takes quota** for the client (see [Quota](#quota)).
- **One model call**, with the provider calls in
  `supabase/functions/_shared/llm.ts`. The photo-capable call that
  `ai-complete` uses (`completeJSON` in `ai-complete/llm.ts`) moves to its own
  shared file, for example `_shared/complete-json-photo.ts` exporting
  `completeJSONWithPhoto`, with a temperature option. Both functions import
  it. `_shared/complete-json.ts`, which `generate-program` and
  `generate-nutrition-plan` use, stays unchanged. The estimate and the
  spelling fix run at a low temperature (0 to 0.2).
  - Input for a plan option: the stored foods text (that day's foods, with the
    day-type filter applied when saving), plus the photo when there is one.
  - Input for «otra cosa»: the original text, plus the photo when there is
    one.
  - Output: kcal, protein, carbs and fat. For «otra cosa», also the corrected
    text.
- **The prompt.** The prompts in `src/services/ai-nutrition.ts` (from a name
  and from a photo) are a starting point for the estimate only:
  - the text is never renamed or turned into a dish name; the spelling rule
    below is the only change allowed;
  - the portion: quantities written in the text («80 g avena», «2 huevos
    enteros») set it. The photo changes them only when the plate clearly
    shows a different amount, such as a double portion or a missing food.
    Without written quantities the photo sets the portion, and without
    either, one typical serving;
  - the photo never names the meal. A photo that isn't food is ignored, and
    the estimate uses the text instead of failing.
- **Spelling rule.** The AI may fix spelling, accents and capital letters
  only:
  - same words, same order, same quantities;
  - nothing added, removed or reworded;
  - when unsure, keep the original.

  The function always corrects the original text, never the current `name`,
  and writes the result to `name`. When the correction doesn't closely match
  the original, it writes the original instead. The builder defines that
  check.
- **It saves the answer only if the version still matches.** Otherwise it
  discards it.

### Quota

- Each estimate is charged to the client's own AI quota: 30 per hour and 100
  per day, shared with `ai-complete`.
- `take_ai_quota()` and `refund_ai_quota()` only work for the signed-in
  caller, so the server gets variants that take the client (for example
  `take_ai_quota_for(p_user_id)` and `refund_ai_quota_for(p_user_id)`). Only
  `service_role` may run them.
- **The existing refund hole closes.** Today `refund_ai_quota()` is granted to
  every signed-in client, so a client can delete its own quota rows,
  estimates included, and has no real limit on the coach's AI keys. The
  migration revokes it from `authenticated`, and `ai-complete` refunds a
  failed call through `refund_ai_quota_for` with the caller's id, using the
  existing `adminClient()`. `take_ai_quota()` can stay: a client calling it
  only uses up its own quota.
- When the quota is used up, the estimate waits until it frees and doesn't
  count as an attempt. It never fails for that reason.
- A failed model call gives the request back, as it does today.

### Retries

- **A `pg_cron` job every few minutes** re-sends pending registrations whose
  next try has passed, whatever their date: a dinner saved at 23:50 and
  synced the next morning, or three days offline.
- **No double sends.** Every send, by the trigger or the cron, first moves the
  row's next try one lease ahead (for example 2 minutes). So the cron re-sends
  only calls that were lost, never one still running.
- **Attempts** are counted when a call is handed to `pg_net`: by the
  bookkeeping trigger for the send it starts, and by the cron in the same
  update that moves the lease. A send skipped for a missing secret doesn't
  count. The
  function gives the attempt back when it waits for quota, and doesn't count
  a provider failure a second time. Failures back off, and after the last
  attempt the state becomes failed. A row never stays pending forever.
- **Failed estimates get more chances.** Tapping «Sin estimar», on its card
  or on the Hoy card, marks them pending again. Once a day, a second job also
  gives each failed estimate from the last 7 days one more try, so an outage
  heals without the client.

### Bookkeeping

A `BEFORE INSERT OR UPDATE` trigger on `meal_items` owns the estimate state
and its bookkeeping: a version, the attempts and the next try. The app's
writes are whole rows from its cache, which can be stale, so the trigger
decides these columns itself.

- **Client and server writes.** A client write is one made with
  `auth.role() = 'authenticated'` at `pg_trigger_depth() = 1`. Server writes
  are those by the function (`service_role`), by the cron or the SQL editor
  (no JWT), and anything run from another trigger or a cascade, such as the
  coach's plan save.
- **Content.** For a plan registration, the content is `name` and the photo;
  for «otra cosa», `original_text` and the photo; for «No la comí», the kind
  alone. A change of kind is a content change.
- **On a client write**, the trigger ignores the version, attempts, next try,
  status and numbers the client sends, then:
  - for «otra cosa», keeps the stored `name` (the correction) while
    `original_text` is unchanged, and sets `name` to the new original text
    when it changes;
  - on a plan or «otra cosa» row that is new or whose content changed: sets
    the status to pending, the numbers to 0, a new version and the next try
    one lease ahead. That starts a send, which it counts as the first attempt
    (none when the send is skipped for a missing secret);
  - on a failed row marked pending again (a retry): the same, keeping the
    content;
  - when nothing else changed: keeps the server's status, numbers, `name`
    and bookkeeping, so a replayed write never re-runs a finished estimate;
  - on a «No la comí» row, new or switched to it: no estimate state, numbers
    at 0, no photo, and no send.
- **The version** comes from a global sequence (or a fresh random token) on
  every insert and every content change, never from a per-row counter. A row
  re-inserted under the same derived id after an undo therefore never matches
  an answer meant for the undone one.
- `meal_items` has no `updated_at`, so the version is the only clock.

### The app shows it

- The estimate shows **within seconds while the app is open**, in the
  Nutrición tab and on Inicio, and on the next open otherwise.
- **With Realtime:** add `meal_items` to the `supabase_realtime` publication,
  guarded as `20261024130000_coach_notifications.sql` does. Subscribe to the
  client's own rows and update today's rows from the event. Invalidating
  `qk.meals` would download the whole meal history again on every estimate.
- **Without Realtime:** re-read today's rows every few seconds while one is
  pending, backing off while its next try is minutes away (a quota wait).
- **Either way, the outbox wins.** An event or a re-read updates a row only
  when no outbox op for that row is pending (`getPendingOps`). Otherwise it is
  ignored, and the refetch at the end of the flush brings the row. On a
  `DELETE` event, or a row the cache doesn't have, today is refetched.
  Another device's undo shows on the next refetch, unless the table gets
  `REPLICA IDENTITY FULL`.

### Changing or undoing

- **Changing the option, the text or the photo** marks the estimate pending
  again and resets the numbers to 0, so nothing counts a stale estimate.
- **Switching to «No la comí»** clears the numbers and the photo: the server
  sets `photo_path` to null, and the app deletes the file, as undo does. It
  needs no estimate, and a late answer for the old version is discarded.
- **Undoing** removes the row and deletes its photo. Its container stays,
  even when empty. Deleting a container cascades to its rows, and another
  device may just have added one, so no one deletes containers. Every reader
  ignores containers with no rows (see [Counting](#counting)).

The app's `src/services/ai-nutrition.ts` and the image half of
`src/services/llm.ts` go away with the add-food screen, their only caller.
`ai-complete` keeps its behaviour for the weekly analysis; only its photo
call's import and its refund change.

## Counting

These rules apply everywhere kcal or macros are added up: the Hoy card,
Inicio, Progreso, the weekly AI analysis and the panel.

- **What counts:** an old diary row, and a registration whose estimate is
  done, with their numbers. Old diary rows are the ones whose `kind` is null;
  never tell them apart by `estimate_status`, which is null on «No la comí»
  too. In the app, one predicate in `src/utils/calories.ts` decides this, and
  every sum uses it: `caloriesConsumed`, `macrosConsumed`, Inicio's slot rows
  and `nutritionStats`.
- **A pending or failed estimate adds nothing, and says so** wherever a total
  shows:
  - on the meal's card and on the Hoy card;
  - under Inicio's ring and on each «Combustible de Hoy» row;
  - in the panel, on the item and on the day row.

  In the app, where one label covers several rows (the Hoy card, Inicio's
  ring, a «Combustible de Hoy» row), it reads «✦ Calculando…» while any is
  pending, and «Sin estimar» otherwise. The panel's day row counts pending and
  failed rows together, as «N sin estimar».
- **Progreso** counts a day as logged only when it has at least one eaten row
  (a plan or «otra cosa» registration, or an old diary row) and no pending or
  failed one. A day that isn't logged gets no bar and is left out of both
  averages, both numbers of «días en meta» and the macro split. The weekly
  analysis uses the same averages, and the card's `hasMeals` check ignores
  «No la comí» rows.
- **«No la comí»** adds 0 and is not food. It adds nothing to item or meal
  counts, and a day with only skipped meals isn't logged in Progreso. It does
  count as registering: in «N de M», and in the panel's «Días con comidas» and
  Dashboard alert (see [Coach panel](#coach-panel)).
- **Empty containers count nowhere.** A day or a meal type counts only
  through its rows. Inicio and Progreso already skip containers without rows;
  the panel must too.
- **Old diary entries** count as they always have.

## Coach panel

What the coach sees stays the same. The registrations reach the panel the
same way the diary entries did:
- A plan registration shows with «del plan» and its foods.
- An «otra cosa» registration shows the corrected text.
- Both show their photo and the AI's kcal and macros.

Items stay grouped under the diary's four meal types, as today. So
pre-workout, post-workout and both snacks appear under «Merienda».

Changes in the panel repo:
- **«Lo que ha comido»** (`DayRow` in `src/pages/client/NutritionTab.tsx`):
  - The two approved additions. An item whose estimate is pending shows
    «Calculando…» where its numbers go, and a failed one «Sin estimar». A «No
    la comí» item shows the meal's name with a «No comió» pill and no
    numbers.
  - The day's and each meal's totals add only known numbers. When any are
    missing, the day row says «N sin estimar» next to its kcal.
  - «N comidas» counts the meals the client ate that day (plan or «otra
    cosa» registrations), plus one per container that holds old diary rows,
    as today. Today it counts containers, which would cap a six-meal plan at
    «4 comidas» and count skipped meals.
  - «del plan», both the item badge and the day row's count, follows `kind =
    plan`, falling back to `plan_option_id` on old diary rows. So a plan
    registration keeps it after the coach removes its option.
  - Empty containers don't show, and neither do days left with none.
  - The panel's `MealItem` type gets the new columns. The query already
    loads every column (`meal_items(*)`).
- **«Días con comidas» and the Dashboard alert** keep counting registrations
  of any kind, so a «No la comí» counts as registering: both measure whether
  the client registers, not what they ate. They change in one way: they skip
  empty containers, which undone meals now leave behind.
  - «Días con comidas» (`ClientPulse.tsx:295`) counts only days with a
    container that holds a row.
  - The alert's query (`services/insights.ts:88`) takes only containers with
    rows, for example with `meal_items!inner(id)`.
- **`MobileNutritionPreview`** («Así lo ve el cliente»): redo it to the new
  look, with no Diario segment, no «Registrar en mi diario» pills, the meals
  as pending cards and options as tabs. Coaches use it to see what clients
  will see.
- **Wording:**
  - The tip on «Lo que ha comido» (`NutritionTab.tsx:142`) describes the
    diary («con foto o a mano»). New text: «Las comidas del plan que
    registra en la app: la opción que eligió, otra comida o que no la comió,
    con foto opcional. La IA estima las calorías y los macros.»
  - The builder's «Comidas» tip (`NutritionPlanBuilder.tsx:639`): «…las
    calorías y los macros los estima la IA cuando el cliente registra lo que
    comió.»
  - The warning in `AiNutritionDialog.tsx`: keep «Reemplaza todo el borrador
    actual.» and drop the half about the diary.
  - Any other builder tip that says «diario».

  The tip «lo que el cliente registra se compara con esto» stays true.

Panel commits go to `main`; **every panel push needs the owner's OK** (panel
CLAUDE.md).

In the app repo, reword the `generate-nutrition-plan` prompt
(`prompt.ts:142-144`) and keep the rest:
- «The client picks ONE option per slot and registers it.»
- «Foods carry NO macros and NO portion field: when the client registers an
  option, the AI estimates it from these food names, plus a photo when the
  client adds one. When a portion matters, write it IN the name: …», keeping
  the examples.
- «measured intake» becomes «estimated intake».

## Docs and legal text

- **Privacy policy** (panel repo, `public/privacidad.html`, the line about
  AI providers): today it says a meal is sent «cuando pides estimar una
  comida», with «la descripción o la foto». Now every meal registered as
  eaten is sent automatically after saving: the option's foods or what the
  client typed, plus the photo when there is one. Add that the AI also
  corrects the spelling of what the client writes, and that «No la comí»
  sends nothing.
- **`docs/COACH-NUTRITION-SPEC.md`** and **`docs/COACH-ADMIN-PANEL-PRD.md`:**
  add a note at the top. The Diario pane (P0-7), the diary write-back (P0-8)
  and the related stories, including coach-assigned meals showing in the
  client's diary, are superseded by this design; the plan model and
  supplements are not.
- **`README.md`:** «log sets and meals» becomes «register the plan's meals».
  Its App AI line says that meal estimates run in the new function, started
  by the database on the client's quota, and that `ai-complete` serves the
  weekly analysis. The panel README's Nutrición line changes the same way.
- **`docs/ADMIN_WEB_DB_CONNECTION.md`:**
  - §5 (b): seeded meals no longer show in the app, only in its totals; drop
    the snippet or say so;
  - §6: a subsection for the new function (who calls it, its deploy flag,
    both secrets, quota and retries, and check queries);
  - §6.4: `ai-complete` now serves only the weekly analysis, and refunds
    through the server variant;
  - §6.5: «an option keeps the registrations made from it».
- **`CLAUDE.md` and `AGENTS.md`**, in the same commit: an Infrastructure
  bullet for the estimate trigger, the retry jobs and the hand-set secret.
- **`.github/workflows/deploy-functions.yml`:** the new function and its
  secret in the header's list. The loop deploys every function with JWT
  verification. So if the function checks only its own secret, it deploys
  with `--no-verify-jwt` on its own line after the loop; if the database's
  call carries a JWT (such as the anon key), it can join the loop.

## Inicio and Progreso

- **Inicio:**
  - The calorie ring («Consumidas») and «Combustible de Hoy» read today's
    registrations and follow [Counting](#counting), with labels under the
    ring and on each row.
  - «Combustible de Hoy» counts meals, not foods: «{{count}} comida» /
    «{{count}} comidas», and each old diary row counts as one. A slot whose
    rows are all «No la comí» stays and reads «No la comí». The empty state
    shows only when today has no rows at all.
  - The «Registrar comida» shortcut opens the Nutrición tab, because the
    add-food screen it opened is gone.
- **Progreso:**
  - The nutrition card, the protein tip and the weekly AI analysis follow
    [Counting](#counting).
  - The empty state already opens Nutrición. Its text becomes «Registra las
    comidas de tu plan para ver tus calorías, proteína y adherencia a la
    meta.»
- **Perfil:** the calorie goal is unchanged.

## Data

The registrations reuse the diary's tables, `meals` and `meal_items`. That is
what keeps the panel, Inicio and Progreso working.

- **One row per registration.** A registration is one `meal_items` row in
  that day's `meals` container for the meal's diary type. Pre- and
  post-workout map to `snack`, as `mealTypeToDiarySlot` does today.
- **One registration per meal per day:** at most one per client, date and
  `plan_meal_id`.
- **The last change to reach the server wins.** A registration's id is
  derived from the client, the date and `plan_meal_id`, and its container's
  from the client, the date and the diary type (for example as UUID v5).
  Every registration write syncs as the outbox's upsert, after an insert of
  its container that ignores an existing one. A second device, a repeated
  save or an offline replay therefore updates the same row instead of
  breaking the rule above. That matters because the outbox drops any write
  the database rejects, and the date lives on `meals`, so the rule can't be a
  plain index on `meal_items`. The outbox carries no save time, so an offline
  phone's older change, or its undo, can overwrite a newer one from another
  device when it syncs.
- **New column** `meal_items.plan_meal_id` → `nutrition_plan_meals(id)`, with
  `on delete set null`. It records which meal of the plan the row registers,
  which «otra cosa» and «No la comí» need because they have no option.
- **Kind** (suggested column `kind`): plan, other or skipped. It is explicit
  because a plan registration loses its `plan_option_id` when the coach
  removes its option.
- **Plan option:** `plan_option_id` is set, and `name` = that day's foods,
  joined (for example «4 claras + 2 huevos enteros · 80 g avena · 1 plátano
  mediano»).
- **Otra cosa:** `plan_option_id` is null. `name` holds the text as typed
  until the estimate lands, then the corrected text. The original text has
  its own column (suggested `original_text`), written only by the app. The
  client never sees it.
- **No la comí:** `name` = the meal's name as the app shows it (the coach's
  label, or the type name), with 0 kcal and macros, no photo, and
  `estimate_status` null: it is never estimated.
- **Estimate state** (suggested `estimate_status`): pending, done or failed.
  It is explicit, never inferred from `calories = 0`, since that column has
  `default 0`.
- **Server bookkeeping:** a version, the attempts and the next try, owned by
  the server (see [Bookkeeping](#bookkeeping)).
- **Old builds keep writing diary rows**, since there is no lock and no OTA.
  `kind` and `estimate_status` therefore have no default: those rows keep
  `kind` null, count as old diary entries, are never estimated and are
  counted as written. The triggers and the every-few-minutes job act only on
  pending plan and «otra cosa» rows, and the daily job only on failed ones
  from the last 7 days. Rows with `kind` null are never touched. An old build
  that shows a registration in its diary and edits it makes a client write
  like any other.
- **Missing links never drop a write.** A `BEFORE INSERT OR UPDATE` trigger,
  which never raises, sets `plan_option_id` and `plan_meal_id` to null when
  the row they point to is gone. Its check takes the lock the foreign key
  would (`for key share`), so it waits for a coach's save that is deleting
  that row and then drops the link instead of failing. A registration queued
  offline is therefore saved without the missing link, instead of failing the
  foreign key, which the outbox would drop.
- **Photos:** the existing public `meal-photos` bucket and `photo_path`.
- **Existing diary history:** stays untouched. Old free-form entries for
  today count in the totals but show on no card.
- **No server-side lock.** Older app builds keep their diary until updated
  (there is no OTA), and a lock would also block the new registrations, which
  write to the same tables.
- **Migration:** a new additive file in `supabase/migrations`. Never edit
  applied migrations. It holds:
  - the new columns;
  - the `BEFORE` triggers (missing links, bookkeeping) and the `AFTER`
    triggers that call the function through `pg_net` (already enabled for the
    pushes);
  - the two `pg_cron` jobs (already enabled for the coach's daily notices);
  - the server-side quota variants, and `refund_ai_quota()` revoked from
    `authenticated`;
  - `meal_items` in `supabase_realtime`, if the app uses Realtime.

  Every function it adds revokes execute from `public`, `anon` and
  `authenticated`.

## Edge cases

| Case | Behaviour |
|---|---|
| The coach edits the plan during the day | Registrations keep their meal through the ids (`save_nutrition_plan` saves by id). Cards match registrations by `plan_meal_id`, not by option. A plan edit starts no estimate. |
| The coach deletes or replaces the registered option but keeps the meal (common with the panel's AI edit) | The meal stays registered. Its chip shows «Del plan» instead of «Opción N», and its sheet opens on a «Del plan» row with the stored foods. The panel keeps «del plan» too. Registering again replaces that row. |
| The coach deletes the registered meal | The registration stays in totals and in the panel, but no longer shows on a card. If its estimate is missing, the Hoy card says so. |
| A registration queued offline whose option or meal was deleted before it synced | It is saved without the missing link and never dropped (see [Data](#data)). |
| A new plan is assigned mid-day | Today's registrations stay in totals, without cards. The new plan's meals start as pending. |
| The day type changes after a meal was registered | The meal keeps its registered card and counts in «N de M». |
| The day changes with the tab open | The list resets to the new day, and yesterday's registrations can no longer be changed. |
| Offline | Registering works, and the estimate starts once the registration syncs. The photo needs a connection, and the photo row says so, unless the builder queues offline photos (see [Saving](#saving)). |
| The client changes or undoes a registration while its estimate runs | The late answer is discarded. A changed registration gets a new estimate. |
| The client undoes a meal, then registers it again the same day | The row comes back under the same id with a new version, so an answer meant for the undone registration is discarded. |
| An undone registration leaves its container empty | The container stays and counts nowhere. |
| The client's AI quota is used up | The meal stays «Calculando…», and the estimate runs once the quota frees. It never fails for that reason. |
| A failed estimate from an earlier day | The daily job gives it one more try, for 7 days. After that it stays «Sin estimar», since no card is left to retry it. |
| «No la comí», then the client ate it after all | They open it and pick an option or «Comí otra cosa». It is then estimated like any other registration. |
| The same meal registered on two devices | Both write the same row, through the derived id. The last change to reach the server wins, so an offline phone's older change can overwrite a newer one when it syncs. |
| A build with this feature talks to the project before the migration | Every registration is refused (PGRST204, unknown column) and the outbox drops it. The migration goes first (see [Constraints](#constraints)). |
| The client has no program | Day type is rest, with the override available, as today. |
| An option whose foods are all filtered out today | It is not offered, as the plan view already skips it. |

## Constraints

- **Database:** Supabase project `rzgwkwxskrovxnnymxqo`. RLS is the security
  boundary, and schema changes go in additive migrations. Migrations are
  applied by hand in the Supabase SQL editor, so the owner runs them.
- **Hand-set secrets:** the function's URL and secret go in Vault, and the
  secret also in the function's secrets, like `ALLOWED_ORIGINS`.
- **Rollout order:**
  1. deploy the function and set its secrets;
  2. apply the migration, ending with `notify pgrst, 'reload schema'` as the
     repo's migrations do;
  3. only then let any build with this feature talk to the project, internal
     test builds included.

  If the migration runs before the secrets are set, registrations just wait as
  pending until the cron finds the secret. A build that runs before the
  migration loses its registrations (see [Edge cases](#edge-cases)).
- **Edge Functions:** they deploy through `.github/workflows/deploy-functions.yml`
  on a push to `main`. That workflow names each function, so the new one has
  to be added to it, with the deploy flag described under [Docs and legal
  text](#docs-and-legal-text). The database calls it, not a signed-in user.
- **Tokens:** they live in `src/global.css` (Tailwind v4 `@theme inline`),
  mirrored in `src/theme/colors.ts`. The root `tailwind.config.js` and
  `globals.css` are unused gluestack leftovers.
- **Text sizes:** size text in px, as Programa does (15/14/13/11/10), so it
  doesn't shrink with the 14px rem.
- **AI:** the model keys stay server-side. Registration estimates run in the
  new function, with the shared provider code and the client's quota.
  `ai-complete` stays for the weekly analysis.
- **Writes:** offline-first, through `src/lib/outbox.ts`, which drops any
  write the database rejects with an error code.
- **Release:** it needs a store build, because there is no OTA. Old builds
  keep the old tab until updated.
- **NativeWind on device:**
  - rem is 14px, so sizes are 12.5% smaller than on web;
  - nested `Text` must not repeat `text-*` sizes;
  - `bg-…/15` opacity modifiers don't compile under react-native-css, so use
    the `-soft` tokens.
- **Themes:** dark and light, using the handoff's light mapping.
- **Copy:** Spanish and English (`es.ts` / `en.ts`, same keys).
- **Git:** the app repo commits and pushes to `main`. The panel repo commits
  to `main` and asks before every push.

## Copy (es)

| Key idea | Text |
|---|---|
| Segments | «Plan» · «Suplementos» |
| Hoy card | «Hoy» · «estimado con IA» · «{{n}} restantes» / «En tu rango» / «{{n}} de más» |
| Count | «{{done}} de {{total}} comidas» |
| Cards | «Siguiente» · «{{count}} opción» / «{{count}} opciones» · «Registrar {{meal}}» (a lowercase meal name inside the sentence is fine: «Registrar almuerzo») |
| Chips | «Opción {{n}}» (or the coach's label) · «Del plan» (when the option is gone; also the sheet row) · «Otra comida» · «No la comí» · «Opcional» |
| States | «✦ Calculando…» · «Sin estimar» · «No aplica hoy». The Hoy card, Inicio's ring and «Combustible de Hoy» use the first two. |
| Sheet | «¿Qué comiste?» · «Comí otra cosa» · «Escribe lo que comiste» (that row's subtitle and the text box's placeholder) · «Al guardar, la IA corrige la ortografía y calcula las calorías.» · «No la comí» · «Añadir foto» · «Opcional» · «Foto del plato» · «Cambiar» · «Quitar foto» · «Tomar foto» / «Galería» · «La foto necesita conexión. Puedes guardar sin ella.» · «Guardar» · «Deshacer registro» |
| Undo confirmation | «¿Deshacer el registro?» · «{{meal}} vuelve a quedar pendiente.» · «Deshacer» · «Cancelar» |
| Inicio | «{{count}} comida» / «{{count}} comidas» · «No la comí» |
| Progreso | «Registra las comidas de tu plan para ver tus calorías, proteína y adherencia a la meta.» |
| Day type | «Día de entreno» / «Día de descanso» · «Según tu programa» / «Cambiado por ti» |
| No plan | «Sin plan nutricional» · «Tu coach aún no te ha asignado uno.» |
| Panel (Spanish only, like the rest of the panel) | «Calculando…» · «Sin estimar» · «No comió» · «{{n}} sin estimar», and the tips under [Coach panel](#coach-panel) |

Delete the diary strings (`nutritionPlan.segmentDiary`, `loggedVsTarget`,
`register`, `registerHint`, and most of `meals.*`). Keep:
- the six slot names;
- the photo picker strings the sheet reuses (`takePhoto`, `fromGallery`,
  `removePhoto`, `cameraPermission`);
- anything Inicio and Progreso still use.

`photoRequiresInternet` («El análisis de fotos necesita conexión…») goes too,
since the phone no longer analyses photos; the sheet uses the new photo
string above. `nutritionPlan.noPlanHint` drops its diary sentence.

## Verification

- **Unit tests** (`node --test`) for the pure logic:
  - which meals show today, including registered meals the day type would
    hide;
  - «N de M» and the next meal, with «No la comí» among them, a forgotten
    meal registered late, and the fallback to the top;
  - matching registrations to meals;
  - the foods text for an option;
  - the derived ids;
  - the counting predicate, Progreso's logged days and «Combustible de Hoy»'s
    counts, with pending, failed, skipped and old diary rows and empty
    containers;
  - the spelling-correction guard. It runs in the Edge Function, so keep it a
    pure function that a test can reach. `npm test` only collects
    `src/**/*.test.ts`.
- **Web screenshots** through the temporary-route harness, with mock data, in
  dark and light:
  - every card state, «No la comí» and «Del plan» included;
  - the Hoy card's «✦ Calculando…» and «Sin estimar»;
  - the sheet with each of its three choices, and with a «Del plan» row;
  - no plan;
  - the supplements pane.
- **The server, on a test client account:**
  - a registration gets its estimate with the app closed;
  - an «otra cosa» comes back with only its spelling fixed and its original
    text unchanged. Re-saving it unchanged, as from a stale cache, keeps the
    correction and runs no new estimate;
  - «No la comí» calls no function and uses no quota. Switching a pending
    meal to it discards the late answer;
  - undoing a meal and registering it again gives a new version, and the
    undone registration's answer is discarded;
  - a provider failure retries, then ends as «Sin estimar», and tapping it
    starts it again. To simulate it, the function honours an optional secret
    that names the test client, for whom it fails instead of calling the
    model. Remove the secret after the test, and never break the live keys;
  - with the test client's quota used up (for example by filling its
    `ai_requests` rows), the meal stays «Calculando…» and lands once the
    quota frees, with no attempt counted;
  - a change during an estimate keeps only the newest answer;
  - a coach's plan edit that removes a registered option starts no estimate;
  - a client write can't set the status, the numbers or the bookkeeping;
  - the function refuses a call without the secret, and a client's `rpc()`
    call to every new function, and to `refund_ai_quota()`, is refused;
  - `ai-complete` still answers the weekly analysis and still refunds a
    failed call.
- **A device build on Android**, the platform clients use. iOS follows the
  normal release process, and the migration is additive, so it can be
  applied before any client build ships. The build checks:
  - sizes and fonts (rem 14);
  - camera and gallery;
  - a save with a photo on mobile data: the sheet closes at once, other
    writes aren't held back, and one estimate lands with the photo;
  - closing the app during a photo upload loses nothing;
  - an offline save, then reconnecting: the estimate lands after the sync.
- **Panel:**
  - «Lo que ha comido» shows a plan registration and an «otra cosa» one,
    each with photo and kcal;
  - it shows «Calculando…», «Sin estimar», «No comió» and «N sin estimar»,
    and its totals leave out the missing numbers;
  - «N comidas» counts the meals eaten, and «del plan» stays after the coach
    removes the option;
  - an undone meal leaves no day in «Lo que ha comido» or «Días con comidas»,
    and doesn't clear the Dashboard alert;
  - the Dashboard alert clears once a client registers;
  - the preview shows the new look.

## Left to the builder

- **The server mechanics**, as long as the requirements above hold: the
  trigger's payload and batching, the lease length, the backoff and attempt
  limit, and how the function checks the secret.
- **Saving with a photo.** For example, a small persisted photo queue,
  separate from the outbox, that hands the row to the outbox once its upload
  is done or given up, with the picked file copied where the system won't
  purge it. The choice also decides whether an offline photo waits for the
  connection or is refused.
- **How the app hears that an estimate landed:** Realtime or re-reading (see
  [The app shows it](#the-app-shows-it)).
- **The prompt or prompts**, and the exact rule that decides whether a
  spelling correction is close enough to keep.
- **The exact column names and shapes**, as long as the app and the panel use
  the same ones.
- **Component structure**, animations (existing `Swap`, `PressableScale`), and
  the sheet implementation, reusing Programa's patterns where they fit.
- **Removing dead code:**
  - the add-food and edit-food screens;
  - `DiaryPane` and `DiarySlot`;
  - the FAB, if nothing else uses it;
  - `meal-slots.ts`, unless Inicio still needs it;
  - `src/services/ai-nutrition.ts`, and the image half of
    `src/services/llm.ts` (`completeJSONWithImage` and its size cap). Move
    the `ImageInput` type into `meal-photos.ts`, which still uploads the
    photos;
  - the diary strings.

## Out of scope

- Deleting old diary data or photos, and making the photo bucket private.
- Portions or macros per food in the plan builder.
- Panel changes beyond the meal states, «N comidas», «del plan», skipping
  empty containers, the preview and the wording, such as showing the plan's
  meal name instead of the diary type.
- Trimming the photo path from `ai-complete`, which nothing will call any
  more.
- Ordering two devices' offline changes by when they were saved.
- Registering past days, and meal reminders.

## Calls made in design (owner to check)

1. **Same storage as the diary**, `meals` / `meal_items` plus a meal link. This
   is what keeps the panel, Inicio and Progreso working.
2. **The AI always gets the text** (the option's foods or what the client
   typed), **plus the photo when there is one.** A photo that isn't food is
   ignored.
3. **The client's original text is kept, but never shown**, as a safety net
   for the spelling fix.
4. **Today only:** no registering past days, and changes or undos only on the
   same day.
5. **«Siguiente» skips forgotten meals.** It is the first required,
   unregistered meal that applies today, after the registered meal that comes
   last in plan order, or the first such meal from the top when none follows.
   It never depends on the clock. «No la comí» counts as registered. Optional
   meals never block it and count only when registered.
6. **The day-type override lasts for today:** it survives restarts, resets at
   midnight, and Inicio follows it.
7. **Suplementos, the shopping list and the coach's notes stay**, restyled.
   Supplement check-offs work as today.
8. **Default pane without a plan:** PLAN if there is a nutrition plan,
   otherwise SUPLEMENTOS if there is a supplement plan.
9. **Inicio's «Registrar comida» opens Nutrición.**
10. **Panel:** besides the two approved additions, «N comidas» counts the
    meals eaten, «del plan» survives an option's removal, and empty
    containers count nowhere. Otherwise only the preview and the wording
    change, and grouping stays by the four diary meal types.
11. **No lock on old app versions.** Old diary entries stay, and rows from old
    builds are never estimated.
12. **Today card ranges:** «N restantes» counts to the minimum, «En tu rango»
    shows inside the range and «N de más» above the maximum. Inicio's ring
    keeps its own math.
13. **A replaced option keeps the meal registered** («Del plan»). Registering
    again replaces the row, and queued registrations are never dropped by a
    plan edit.
14. **Every pending estimate runs, whatever its date**, and ends as failed
    after repeated failures. Failed ones from the last 7 days get one more
    try each day.
15. **Device testing is on Android.**
16. **Estimates use the client's own AI quota** (30 per hour, 100 per day).
    When it runs out, the estimate waits; it doesn't fail.
17. **«No la comí» is not offered on optional meals**, and saving it plays no
    pop. In the panel it shows the meal's name with «No comió».
18. **Skipped meals count as registering, never as food.** They count in «N
    de M», «Días con comidas» and the Dashboard alert, and add 0 kcal. A day
    with only skipped meals isn't logged in Progreso.
19. **Missing estimates are flagged wherever a total shows:** the meal card,
    the Hoy card, Inicio's ring and «Combustible de Hoy», and the panel.
    Progreso leaves those days out entirely.
20. **A registered meal keeps its card** when the day type would hide it.
21. **«Combustible de Hoy» counts meals, not foods.**
22. **The last change to reach the server wins across devices**, through ids
    derived from the client, the date and the meal. An offline phone's older
    change can overwrite a newer one when it syncs.
23. **Portions:** the quantities written in the text set the portion; the
    photo changes them only when the plate clearly shows a different amount.
24. **The existing AI refund hole closes:** clients can no longer refund
    their own AI calls, and `ai-complete` refunds through the server.
25. **Containers are never deleted.** An undone meal leaves an empty
    container that counts nowhere, because deleting one could wipe another
    device's registration.
