# "Solo semana actual": lock future weeks per program

Date: 2026-09-29 · Status: design approved, spec awaiting review ·
Repos: `hokage-coaching-app` (schema + app) and `hokage-web-panel` (coach UI)

## Problem

A client can check off any training in any week of their program, including
weeks that haven't started. The coach wants to be able to stop that for a
program, so the client only trains the week they are in.

## Decisions (from the product owner)

1. The setting is **per program**, chosen by the coach. Default **off**, which
   is today's behaviour. Templates carry it, and the assign-template dialogs
   let the coach change it for that client.
2. With it on, the client can only complete trainings of the **current
   calendar week** and of **past weeks** (so missed trainings can be caught
   up). Inside an open week, any order is fine.
3. "Current week" is the week the app already marks as *Actual*: weeks count
   in 7-day blocks from the program's `start_date` (`currentWeekOf`,
   `src/utils/program.ts`). A new week opens on its date whether or not the
   previous week was finished.
4. **Before the start date** the whole program is view only.
5. **Locked weeks are view only.** The client can open them and see
   exercises, sets, notes and videos, but cannot check, start the exercise
   timer or log sets. The UI says when the week opens.
6. Enforced **in the app only**. The database never rejects a write.
7. The panel's week views stay as they are. They already count weeks from
   `start_date`, so they match this rule.

Not in scope: order inside a week, a server-side check, changes to the
panel's week views, support for older app versions (there are no real users
yet).

## The rule

For a program with `lock_future_weeks = true`, week `w` is **locked** when:

- today (phone's local date) is before `start_date`, or
- `w > currentWeekOf(start_date, duration_weeks)`.

Week `w` opens on `start_date + 7·(w−1)` days. After the block ends,
`currentWeekOf` returns the last week, so every week is open.

One pure helper next to `currentWeekOf` in `src/utils/program.ts` answers
this, for example `weekLock(program, week, now)`, which returns `null` (open)
or `{ kind: 'start' | 'week', opensOn: 'YYYY-MM-DD' }`. Every screen and
guard uses it. For programs with the flag off it always returns `null`.

The lock only depends on the date. It needs no network and no logged data,
so offline use, the outbox and slow refetches cannot affect it.

## Database

New migration `supabase/migrations/20260929120000_program_lock_future_weeks.sql`
(additive, `begin/commit`, safe to re-run):

- `alter table public.programs add column if not exists lock_future_weeks boolean not null default false;`
  with a column comment. Existing programs stay unlocked. There is no RLS
  change: clients can only read `programs`, so they can't switch it off, and
  the coach already has full access.
- `save_coach_program` (latest version in
  `20260926130000_supersets_week_overrides_client_notes.sql`): read
  `p_header->>'lock_future_weeks'`. The INSERT uses `coalesce(…, false)` and
  the UPDATE uses `coalesce(…, lock_future_weeks)`. Templates are saved
  through the same function.
- `assign_program_template`: drop the `(uuid, uuid, date)` signature and
  re-create it with an extra `p_lock_future_weeks boolean default null`. The
  copied program gets `coalesce(p_lock_future_weeks, template.lock_future_weeks)`.
  Re-apply the same revoke/grant on the new signature. Dropping the old
  signature avoids two overloads, which PostgREST can't choose between.
- `save_program_as_template`: copy `lock_future_weeks` into the template.
- End with `notify pgrst, 'reload schema';` and verify queries (the column
  exists with default false, and only one `assign_program_template` exists).

Realtime needs no change: `programs` is already published and the app
refetches the program on change, so a coach switching it on reaches an open
app live.

Types: add `lock_future_weeks: boolean` to `Program` in the app
(`src/types/database.ts`) and the panel (`src/types.ts`).

## App (`hokage-coaching-app`)

**Fresh "today".** `useProgram` memoizes the current week on `[program]`
(`src/hooks/use-program.ts`), so a new week can go unnoticed until the
program refetches. Add a small today-key store (updated when the app returns
to the foreground and at local midnight) and key the week, `notStarted` and
the lock on it. The home card uses the same store.

**Guards in the logging hook** (`src/hooks/use-program-logging.ts`):
`setCompletion` (check and uncheck), `setDayCompletion` and `logSet` return
without writing when the week is locked. This is the backstop behind every
screen.

**Screens.** Each write control on a locked week is disabled and explains
why:

| Where | Change when the week is locked |
|---|---|
| Program tab, top of the week (`program-view.tsx`, existing before-start hint) | Note: «Disponible desde el 6 oct», or «Tu programa empieza el 1 oct» before the start |
| Exercise checkbox (`program-view.tsx` → `DoneCheckbox`) | Disabled with a lock look; accessibility label «{name}: bloqueado» |
| Day "n/total" mark-all pill (`program-view.tsx`) | Not pressable |
| Exercise sheet: «Marcar hecho» and undo (`program-exercise-modal.tsx`) | Replaced by the lock note |
| Exercise sheet: Empezar/Continuar, pause/resume, Terminar (`program-exercise-modal.tsx`, `exercise-session-host.tsx`) | Start and Finish unavailable. A timer that was already running (the coach switched the lock on, or moved the start date) can only be closed with Salir |
| Set logging (`program-set-logger.tsx` via the sheet) | Inputs read only |
| Home card (`program-home-card.tsx`) | Stays on the current week: no jump into next week once this week is done. Instead it shows «La semana 3 se abre el 6 oct». Checkboxes disabled before the start |
| Day-complete modal "next" line (`day-complete-modal.tsx`) | When the week is done and the next is locked: «La semana 3 se abre el 6 oct» instead of «Siguiente: semana 3» |

Everything else on locked weeks stays available: opening days and exercises,
video, instructions, notes, prescription, previously logged sets.

**Free programs** (flag off): no behaviour change. The only shared change is
the fresh-today store, which fixes the stale week for them too.

**Copy** (add to both `src/i18n/es.ts` and `en.ts`, `program` section):

| Key | es | en |
|---|---|---|
| `lockedStart` | Tu programa empieza el {{date}} | Your program starts on {{date}} |
| `lockedWeek` | Disponible desde el {{date}} | Available from {{date}} |
| `nextWeekOpens` | La semana {{n}} se abre el {{date}} | Week {{n}} opens on {{date}} |
| `lockedA11y` | {{name}}: bloqueado | {{name}}: locked |

## Panel (`hokage-web-panel`)

- **Builder:** a «Solo semana actual» switch in Detalles next to Inicio and
  Estado, in `ProgramWorkspace.tsx` and in `LegacyProgramBuilder.tsx`,
  visible for templates too. Help text: «El cliente solo puede marcar los
  entrenos de la semana en curso y de semanas pasadas. Las siguientes las
  ve, pero se abren en su fecha. Antes del inicio no puede marcar nada.»
  If the switch is on, Detalles starts open.
- **Builder state and save:** add the field to `builderModel.ts` (draft,
  header, payload), `useProgramBuilder.ts` (baseline, autosave, header,
  replace-draft) and `services/programs.ts` (`SaveProgramInput`, `p_header`).
- **Assign template:** `assignTemplate` sends `p_lock_future_weeks`. Both
  assign dialogs (`ProgramsTab.tsx` TemplatePicker, `Programs.tsx`
  AssignDialog) get the switch under the start date, pre-set from the chosen
  template.
- **Chips:** «Solo semana actual» on the client's program card
  (`ProgramsTab.tsx`) and on the template card (`Programs.tsx`) when on.
- Week views, progress bar, Seguimiento, muscle map and dashboard: unchanged.

## Edge cases

- **Coach switches it on mid-program** with checks already in future weeks:
  those weeks become view only; the checks stay and still count in the
  panel. They can't be unchecked until the week opens.
- **Coach moves Inicio later:** the weeks shift and may lock again. The
  existing start-date guard only allows moving a changed start back to
  yesterday or today, so this can't be fully undone.
- **Start date defaults to tomorrow** in the assign dialogs. With the switch
  on, the client can't check anything on the assignment day unless the coach
  picks today. The help text says nothing can be checked before the start.
- **Timezone:** the lock uses the phone's local date, the same as today's
  *Actual* week. Coach and clients are in the same timezone (UTC-4, no DST).

## Rollout

1. Apply the migration (SQL editor).
2. Deploy the panel. It must come after the migration, because
   `p_lock_future_weeks` doesn't exist before it.
3. Ship the app build.

## Verification

Neither repo has a test framework.

- `npx tsc --noEmit` and `npm run lint` in both repos.
- Migration verify queries. From the panel: save a program and a template
  with the switch on and off, and assign a template with and without
  changing the switch; check the stored rows.
- Manual pass on a phone (and the web build):
  - flag off: no change (weekday home card, next-week jump, early completion);
  - flag on: every control in the table above on a future week; past weeks
    stay open; before start; the week opening at midnight and on returning
    to the app;
  - the coach switching the lock on while the app is open (realtime), with
    and without a running exercise timer.
