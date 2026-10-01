# Check-off celebration: a card on each check, a better day modal

Date: 2026-10-01 · Status: design approved, spec awaiting review ·
Repo: `hokage-coaching-app` (app only; no database or panel change)

## Problem

Checking an exercise gives a pop, impact lines and a vibration, then nothing:
no "what's next". Finishing a day opens the «Sellado» modal, whose only
button is «Listo». The owner wants a quick celebration on each check, with
options, including going to the next training.

## Decisions (from the product owner)

1. **Shape**: a small **card on each check**, plus the existing
   **day-complete modal** as the one big moment. No blocking modal per
   exercise.
2. "Next training" means **the next exercise** on the card, and **the next
   day** on the day modal.
3. **«Siguiente» opens the next exercise and starts nothing** (no exercise
   clock, no rest). The rest is one tap.
4. First version: the card's core (header, «Siguiente», «Descanso»,
   «Deshacer»), **highlights on the card**, the day modal's «Ir al Día n»,
   **next-day preview and «Contarle a {coach}»**, and the fixes below.
   Later: «Te queda uno», week-complete / streak messages, a celebrations
   setting, milestones, sharing, «¿Cómo te sentiste?».

## Part 1: the card on each check

### When it shows

| Situation | What shows |
|---|---|
| One exercise checked (Programa tab row, home card row), and the check does not finish the day | The card |
| «Terminar» on a timed exercise (session host), not finishing the day | The card, with the time («en 3:12»). Replaces today's 3-second `program.sessionFinished` toast |
| The check finishes the day | Only the day modal |
| Unchecking | Nothing |
| The day's «x/6» mark-all pill | No card. The day modal if the day becomes complete |
| «Marcar hecho» inside the open exercise sheet | No card. The sheet's done state gets «Siguiente →» (same target as the card) |
| A second check within 8 s of the previous one | The card collapses to «{{count}} hechos · Deshacer» (logging after the fact) |
| A past week (week < the current week) | A card with only «Deshacer» |
| A locked week | Nothing (the check is already disabled) |
| Re-checking the last exercise of a day already celebrated this app session | No modal replay: the card reads «Día {{n}} completo» with «Deshacer» |
| Reduced motion | Shown without the slide animation |

### Behaviour

- Slides up above the tab bar, and above the rest bar and the session bar
  when they show. No backdrop: the screen stays usable underneath.
- Closes by itself after about 5 s, or with a swipe down. The timer pauses
  while a finger is on the card.
- A new check replaces the card; cards never stack.
- No haptic of its own (the check already gave one).

### Content

- **Header**: the exercise name with a check, and the day's progress as
  segments plus «{{done}}/{{total}}».
- **One highlight, only when true**, first match wins:
  1. **Record**: «Récord: {{weight}} × {{reps}}». The same rule the day modal
     uses today (best set by estimated 1RM, compared with every earlier
     weighted log of the same exercise name; a first-ever log is a baseline,
     not a record). That logic moves out of `day-complete-modal.tsx` into a
     shared module so both use it.
  2. **Better than last time** (`previousSetsFor`): «+{{kg}} vs semana {{w}}»
     when the top set's weight went up, else «+{{reps}} reps vs semana {{w}}»
     when reps went up at the same weight.
  3. **All sets done**: «{{done}} de {{total}} series» when the logged sets
     reach the prescribed count.
  - Nothing when no sets were logged. Never a negative comparison. No "vs"
    comparison on a deload week.
- **Buttons**:
  - **«Siguiente: {{name}}»** (main): closes the card and opens that
    exercise's sheet (`exerciseSession.open`). The next exercise is:
    1. inside a superset (consecutive rows with the same `superset_group`,
       as the Programa tab groups them), the next unchecked partner in the
       round;
    2. otherwise the next unchecked exercise after this one, in
       `sort_order`;
    3. otherwise the first unchecked exercise before it (one that was
       skipped).
    In a superset it reads «Ahora {{letter}}{{index}}: {{name}}».
    Hidden when nothing is left.
  - **«Descanso {{time}}»**: starts the rest timer with the exercise's
    prescribed rest (`effectivePrescription(...).restSeconds`). Hidden when
    the next exercise is a superset partner, when there is no prescribed
    rest, or when a rest is already running.
  - **«Deshacer»**: unchecks the exercise (or, collapsed, every exercise in
    the batch), and closes the card.

## Part 2: the day-complete modal («Sellado»)

The seal, stats, records, muscle map and week bar stay as they are. The
bottom changes:

- **Next day** (fixes the current pick): the next unfinished day after this
  one **in the Programa tab's order** (`sort_order`), then the first
  unfinished earlier day of the same week. When the week is done, the first
  day of the next week.
- **Preview**, above the buttons when there is a next day:
  «Día {{n}} · {{label}} · {{count}} ejercicios».
- **Main button**:
  - «Ir al Día {{n}}» (same week) or «Ir a la semana {{w}}» (next week).
    Closes the modal and shows that week on the Programa tab with that day
    expanded and scrolled into view. Opens no exercise.
  - No button when the next week is locked: the line reads «La semana
    {{w}} se abre el {{date}}» (as today). After the last week: «Terminaste
    el bloque.» (as today), no button.
- **«Contarle a {{coach}}»** (secondary, WhatsApp icon): opens
  `https://wa.me/<coach digits>?text=<summary>`, the same pattern as
  `src/components/coach-section.tsx`, with the coach from `useCoach()`.
  Summary: «¡Terminé el Día {{n}} ({{label}})! {{exercises}} ejercicios ·
  {{sets}} series[ · {{minutes}} min][ · Récord en {{name}}: {{weight}} ×
  {{reps}}]». Hidden when the coach has no WhatsApp number.
- **«Listo»** stays, as the quieter third option.

## Fixes

1. «Marcar hecho» that finishes the day: the sheet closes first, then the
   modal opens (today the modal opens on top of the open sheet).
2. No replay: re-checking the last exercise of a day already celebrated in
   this app session does not reopen the modal (see the card rule).
3. The modal's next day uses the Programa tab's order (see Part 2).

## Design

- **Pure helpers, unit tested** (`npm test`):
  - `nextExercise(day, currentId, week, isDone)`: the superset-aware pick
    above.
  - `checkHighlight(...)`: record / better than last time / all sets.
  - `nextDay(program, dayId, week, isDone)` and the record rule shared with
    the day modal.
- **Card state**: a small module store (like `src/lib/exercise-session.ts`):
  show, replace, collapse-within-8 s, dismiss, plus the set of days already
  celebrated this session.
- **Card UI**: a `CheckCard` component and its host mounted in
  `app/(tabs)/_layout.tsx` next to `RestTimerBar` and `ExerciseSessionHost`,
  so it knows the tab bar height and the bars it must sit above.
- **Triggers**: the Programa row and home card row checks, and the session
  host's «Terminar», decide card vs modal with `completesDay` before
  writing. The mark-all pill and the sheet's «Marcar hecho» never show the
  card.
- **Programa focus**: a way to ask the Programa tab to show week w with day
  d expanded and scrolled into view (a small store or route params), used by
  «Ir al Día n».
- **Copy**: new keys in both `src/i18n/es.ts` and `en.ts`.

## Copy

| Key | es | en |
|---|---|---|
| `checkCard.progress` | {{done}}/{{total}} | {{done}}/{{total}} |
| `checkCard.time` | en {{time}} | in {{time}} |
| `checkCard.record` | Récord: {{weight}} × {{reps}} | Record: {{weight}} × {{reps}} |
| `checkCard.moreKg` | +{{kg}} vs semana {{w}} | +{{kg}} vs week {{w}} |
| `checkCard.moreReps` | +{{reps}} reps vs semana {{w}} | +{{reps}} reps vs week {{w}} |
| `checkCard.allSets` | {{done}} de {{total}} series | {{done}} of {{total}} sets |
| `checkCard.next` | Siguiente: {{name}} | Next: {{name}} |
| `checkCard.nextSuperset` | Ahora {{slot}}: {{name}} | Now {{slot}}: {{name}} |
| `checkCard.rest` | Descanso {{time}} | Rest {{time}} |
| `checkCard.undo` | Deshacer | Undo |
| `checkCard.batch` | {{count}} hechos | {{count}} done |
| `checkCard.dayAgain` | Día {{n}} completo | Day {{n}} complete |
| `checkCard.sheetNext` | Siguiente → | Next → |
| `dayDone.goDay` | Ir al Día {{n}} | Go to Day {{n}} |
| `dayDone.goWeek` | Ir a la semana {{w}} | Go to week {{w}} |
| `dayDone.preview` | Día {{n}} · {{label}} · {{count}} ejercicios | Day {{n}} · {{label}} · {{count}} exercises |
| `dayDone.tellCoach` | Contarle a {{coach}} | Tell {{coach}} |
| `dayDone.whatsappSummary` | ¡Terminé el Día {{n}} ({{label}})! {{stats}} | I finished Day {{n}} ({{label}})! {{stats}} |

`dayDone.preview` and the exercise counts use i18next plural keys
(`_one`/`_other`), like the existing `program.statExercises_*`.

## Edge cases

- **Offline**: everything works from the local cache; WhatsApp needs
  connectivity like any link.
- **Coach edits while the card is up**: the card reads the program when it
  renders; a removed exercise hides «Siguiente».
- **"Solo semana actual"**: the card never shows on a locked week; «Ir a la
  semana {{w}}» never targets a locked week (the line says when it opens).
- **The exercise clock of another exercise is running** when one is checked:
  the card shows only «Deshacer» (no «Siguiente», which would start juggling
  two exercises).

## Verification

- `npm test`: `nextExercise` (plain order, supersets of 2 and 3, skipped
  earlier exercises, nothing left), `nextDay` (same week, wrap to a skipped
  day, next week, locked next week, block end), `checkHighlight` (record,
  +kg, +reps, all sets, nothing logged, deload, no negative), the shared
  record rule (same results as today's `daySummary`).
- `npx tsc --noEmit`, `npm run lint`.
- On the phone (and the web build): each row of the "When it shows" table;
  «Siguiente» across a superset; «Descanso» starting the rest; «Deshacer»;
  the 8-second collapse; «Terminar»'s card with the time; the day modal's
  three buttons, the preview, the WhatsApp text, and «Ir al Día n» landing on
  the right week with the day open; the three fixes.

## Out of scope

«Te queda uno», week-complete and streak messages, a celebrations setting,
milestones, sharing, «¿Cómo te sentiste?», sounds, and any database or panel
change.
