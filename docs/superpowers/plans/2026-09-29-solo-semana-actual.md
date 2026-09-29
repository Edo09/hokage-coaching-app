# "Solo semana actual" (lock future weeks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the coach turn on «Solo semana actual» per program (and per template) so the client's app only lets them complete trainings of the current and past weeks, while future weeks stay visible, view only, and say when they open.

**Architecture:** A new column `programs.lock_future_weeks` (default false) is written by `save_coach_program`, copied by `assign_program_template` and `save_program_as_template`, and set by a switch in the panel's builders and assign dialogs. In the app, one pure rule (`weekLock`, next to `currentWeekOf`), keyed on a fresh local-day store (`useToday`), drives both a backstop in the logging hook (writes to a locked week are dropped) and the locked look of every write control. Enforcement is app-only: the database never rejects a write.

**Tech Stack:** Supabase Postgres (plpgsql RPCs, PostgREST, realtime); app: Expo SDK 57, React Native, expo-router, NativeWind, TanStack Query (persisted, offline outbox), i18next, TypeScript; panel: Vite React SPA, shadcn/Radix, Tailwind, TypeScript; tests: `node:test` on Node 25.2.1 type stripping, with a small resolver hook.

**Spec:** docs/superpowers/specs/2026-09-29-solo-semana-actual-design.md

## Global Constraints

- Repos: app `C:\Users\Signos\Documents\edwin\hokage-coaching-app`, panel `C:\Users\Signos\Documents\edwin\hokage-web-panel`. Work directly on `main` in both; never create or switch branches; no PRs.
- Every task starts with a Preflight step: if `git status --short -- <task files>` lists anything, stop and ask; if the whole tree is clean, `git pull --rebase` before editing (other sessions may commit to `main` in this same working tree); if other files are dirty, do not pull or stash.
- Never touch `fetchLog` or `rowsOrEmpty` in `src/hooks/use-program-logging.ts`: they were just reworked by another session (commits `3a2f84d` and `bf56823`, already on `main`). Task 4 anchors only on other functions.
- Flag: `public.programs.lock_future_weeks boolean not null default false`. Default off is today's behaviour: free programs (flag off) behave exactly as before, because `weekLock` returns `null` unless `program.lock_future_weeks === true`.
- Rule: with the flag on, week `w` is locked when today (phone's local date) is before `start_date`, or when `w > currentWeekOf(start_date, duration_weeks)`. Week `w` opens on `start_date + 7·(w−1)` days. After the block every week is open. Any order inside an open week.
- Locked weeks are view only: no check or uncheck, no day pill, no timer start/pause/resume/finish, no set logging. Days, exercises, video, instructions, notes, prescription and earlier logged sets stay visible. A timer already running on a locked week can only be closed with «Salir».
- Enforcement is app-only: no database check, no RLS change. The lock depends only on the date (no network, no logged data).
- App copy goes in the `program` section of BOTH `src/i18n/es.ts` and `src/i18n/en.ts`: `lockedStart` «Tu programa empieza el {{date}}» / «Your program starts on {{date}}»; `lockedWeek` «Disponible desde el {{date}}» / «Available from {{date}}»; `nextWeekOpens` «La semana {{n}} se abre el {{date}}» / «Week {{n}} opens on {{date}}»; `lockedA11y` «{{name}}: bloqueado» / «{{name}}: locked». Dates read «6 oct» / «Oct 6».
- Panel copy: switch label «Solo semana actual»; help text «El cliente solo puede marcar los entrenos de la semana en curso y de semanas pasadas. Las siguientes las ve, pero se abren en su fecha. Antes del inicio no puede marcar nada.»; chip «Solo semana actual». With the switch on, Detalles starts open.
- Migration `supabase/migrations/20260929120000_program_lock_future_weeks.sql` is applied by the user in the SQL editor of project `rzgwkwxskrovxnnymxqo`, which is the live database. Every SQL statement in this plan is a USER STEP: ask the user to run it and paste the result. Use a test client only, and restore the rows you change.
- The web app (:8081) and the panel (:5181) sign in against the hosted project: ask the user to sign in in the Browser pane. Never type credentials or keys yourself.
- Commits: `git add` explicit paths only; before committing, `git diff --cached --name-only` must list exactly the task's files; every message ends with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Push: no push steps inside Tasks 1-9. App repo: pushing `main` after each finished task is fine (CI only deploys `supabase/functions/**`). Panel repo: pushing deploys through Vercel, so push panel commits ONLY after the user confirms the migration is applied (Task 1 Steps 4-5). Before the migration, Task 9 breaks every assign (PGRST202) and Task 8 silently drops the flag.
- Rollout order: (1) apply the migration, (2) deploy the panel, (3) ship the app build.
- Task order: Task 1 first; Tasks 2 → 7 (app) in order; Tasks 8 → 9 (panel) depend only on Task 1 and may run before the app tasks; Task 10 last.
- Baselines measured on app `64ab056` and panel `4911b25`: app `npx tsc --noEmit` prints nothing (exit 0) and `npm run lint` prints `✖ 3 problems (0 errors, 3 warnings)`, all `import/no-named-as-default-member` in `src/i18n/index.ts`; panel `npx tsc --noEmit` and `npm run lint` are clean.
- Shell: commands are written for Git Bash (the Bash tool); run `cd <repo> && <cmd>` in one call. Git Bash does not pass `TZ` to node.exe; the tests pin their zones themselves (PowerShell `$env:TZ` works if you ever need it).
- Timezone: the lock uses the phone's local date. Coach and clients are in UTC-4 with no DST (America/Santo_Domingo); the SQL in the checks uses that zone.
- No Zyron branding, self-serve sign-up or multi-coach logic (CLAUDE.md).

## Review Focus

1. Checks, done days and logged sets that already exist on a week that becomes locked (the coach turns the lock on mid-program, or moves Inicio later) → they stay: the check shows faded (opacity 0.5), unpressable, labelled «<name>: bloqueado»; the day pill shows `checkmark-done` and is disabled; the sheet shows only the lock note and read-only set values; the Inicio block % keeps counting them. Pinned by Task 5 Step 14 (rows, pill, %) and Task 6 Step 10 (sheet).
2. The day rolling over while a screen is open with the lock on (midnight timer, and returning to the foreground) → Sem 3 unlocks with no reload: its note disappears, the check's label becomes «Marcar <name> como hecho», a tap writes a completion, and the Inicio card moves on to week 3. Pinned by the store tests in Task 3 Step 2 and the web check in Task 7 Step 8 (C and D).
3. Phone-only behaviour (Hermes date formatting, `TextInput editable={false}`, a disabled `Pressable` without pop or haptic, AppState `active` after a background midnight) → «Disponible desde el <d> <mes>», no haptic or pop on a locked check, no keyboard on a set field, Sem 3 open after returning past midnight. Pinned by Task 10 Step 7 (USER STEP on an Android dev build).
4. The client-tab template picker reopened after «Cancelar» (it stays mounted while closed) → nothing picked, the switch off and disabled, and picking the same template pre-sets it again. Pinned by Task 9 Step 5 (reset on open) and Task 9 Step 10 item 4.
5. A program or template that is already locked, opened in the builder → no «¿Descartar los cambios?» and no draft written when cancelled untouched; the switch survives an AI edit and «Deshacer»; saving keeps `true`. Pinned by Task 8 Step 4 (baseline) and Task 8 Step 12 item 4.

---

### Task 1: Database column and RPCs + types in both repos

**Files:**
- Create: `C:\Users\Signos\Documents\edwin\hokage-coaching-app\supabase\migrations\20260929120000_program_lock_future_weeks.sql`
- Modify: `C:\Users\Signos\Documents\edwin\hokage-coaching-app\src\types\database.ts`: `export type Program` (lines 188-204), inserting after `status: ProgramStatus;` (line 198)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\types.ts`: `export interface Program` (lines 164-185), inserting after `status: ProgramStatus;` (line 179)

**Interfaces:**
- Consumes: the latest definitions of `save_coach_program`, `assign_program_template` and `save_program_as_template`, all in `supabase/migrations/20260926130000_supersets_week_overrides_client_notes.sql` (lines 63-428). No later migration redefines them (`20260926140000` and `20260928120000` don't touch them).
- Produces:
  - DB column `public.programs.lock_future_weeks boolean not null default false`.
  - `save_coach_program(uuid, uuid, jsonb, jsonb, jsonb)` (same signature) reads `p_header->>'lock_future_weeks'`. If the key is missing, INSERT stores `false` and UPDATE keeps the stored value.
  - `assign_program_template(p_template_id uuid, p_client_id uuid, p_start_date date default current_date, p_lock_future_weeks boolean default null) returns uuid`. The copy gets `coalesce(p_lock_future_weeks, template.lock_future_weeks)`. The old `(uuid, uuid, date)` signature is dropped. Callers that send only the first three named arguments (today's panel) still work.
  - `save_program_as_template(uuid, text)` (same signature) copies the flag into the new template.
  - App: `Program.lock_future_weeks: boolean`, so `ProgramWithDetails` has it (Task 2's `weekLock` needs it to type-check).
  - Panel: `Program.lock_future_weeks: boolean`, so `ProgramWithDetail extends Program` has it (Tasks 8-9).

- [ ] **Step 1: Preflight and starting point**

Run in Git Bash:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short
```

Expected: no line for anything under `supabase/migrations`, for `src/types/database.ts` (app) or for `src/types.ts` (panel). If one shows up, stop and ask. Another session may have `src/hooks/use-program-logging.ts` modified; leave it alone. For each repo whose output is empty, run `git -C <repo> pull --rebase` (expected: `Already up to date.` or a fast-forward). If a repo lists other files, don't pull or stash; continue.

Then:

```bash
grep -l "function public.\(save_coach_program\|assign_program_template\|save_program_as_template\)" /c/Users/Signos/Documents/edwin/hokage-coaching-app/supabase/migrations/*.sql | tail -1
```

Expected: `/c/Users/Signos/Documents/edwin/hokage-coaching-app/supabase/migrations/20260926130000_supersets_week_overrides_client_notes.sql`. If a later migration shows up, stop: the function bodies below would be out of date.

- [ ] **Step 2: Write the migration**

Create `C:\Users\Signos\Documents\edwin\hokage-coaching-app\supabase\migrations\20260929120000_program_lock_future_weeks.sql` with exactly this content. The three function bodies are copied verbatim from 20260926130000. Each change is marked by a `-- lock_future_weeks:` comment, apart from the new signature and the `drop function` just before it.

```sql
-- ==========================================================================
-- "Solo semana actual": the coach can lock a program's future weeks.
--
-- programs.lock_future_weeks -- when true, the client can only complete the
-- trainings of the current week (7-day blocks from start_date, the week the
-- app marks "Actual") and of past weeks, and nothing before start_date.
-- Future weeks stay visible, view only. Default false = today's behaviour, so
-- every existing program stays unlocked.
--
-- Enforced by the app only: the database never rejects a write. No RLS
-- change -- clients can only read programs, so they can't switch it off, and
-- the coach already has full access.
--
-- save_coach_program, assign_program_template and save_program_as_template
-- are redefined verbatim from 20260926130000 with the flag added, so saving
-- (programs and templates), assigning and promoting keep it:
--   * save_coach_program reads p_header->>'lock_future_weeks'. A header
--     without the key saves a new program unlocked and leaves an existing
--     one as it was, so an older panel build keeps working.
--   * assign_program_template gains p_lock_future_weeks (default null = copy
--     the template's value). The old (uuid, uuid, date) signature is dropped
--     first: two overloads would leave PostgREST unable to choose. Callers
--     that pass only the first three arguments still work.
--   * save_program_as_template copies the flag into the new template.
--
-- Additive and idempotent. Run in the Supabase SQL editor BEFORE deploying a
-- panel build that sends p_lock_future_weeks.
-- ==========================================================================

begin;

-- 1) column -------------------------------------------------------------------
alter table public.programs
  add column if not exists lock_future_weeks boolean not null default false;

comment on column public.programs.lock_future_weeks is
  '"Solo semana actual": true = the client can only complete the current week (7-day blocks from start_date) and past weeks, nothing before start_date. Enforced by the app, not the database.';

-- 2) functions that write or copy programs --------------------------------------
create or replace function public.save_coach_program(
  p_program_id uuid,
  p_client_id  uuid,   -- NULL => template
  p_header     jsonb,
  p_days       jsonb,
  p_weeks      jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_program_id      uuid;
  v_is_template     boolean := p_client_id is null;
  v_day             jsonb;
  v_day_id          uuid;
  v_ex              jsonb;
  v_ex_id           uuid;
  v_exercise_id     uuid;
  v_old_exercise_id uuid;
  v_keep_days       uuid[] := '{}';
  v_keep_ex         uuid[] := '{}';
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage programs' using errcode = '42501';
  end if;

  if p_program_id is null then
    insert into public.programs
      (user_id, assigned_by, source, name, description, focus, duration_weeks,
       start_date, status, progression_rule, tempo_default, notes, is_template,
       lock_future_weeks)
    values
      (p_client_id, auth.uid(), 'coach',
       p_header->>'name',
       nullif(p_header->>'description', ''),
       nullif(p_header->>'focus', ''),
       coalesce((p_header->>'duration_weeks')::int, 1),
       coalesce((p_header->>'start_date')::date, current_date),
       -- For a TEMPLATE, status means library shelf-state: 'active' = available
       -- to assign, 'archived' = retired. It can never collide with the
       -- one-active-per-CLIENT rule, since that index and trigger both ignore
       -- rows with a null user_id.
       coalesce(nullif(p_header->>'status', ''), 'active'),
       nullif(p_header->>'progression_rule', ''),
       nullif(p_header->>'tempo_default', ''),
       nullif(p_header->>'notes', ''),
       v_is_template,
       -- lock_future_weeks: a header without the key saves it unlocked.
       coalesce((p_header->>'lock_future_weeks')::boolean, false))
    returning id into v_program_id;
  else
    update public.programs set
       name             = p_header->>'name',
       description      = nullif(p_header->>'description', ''),
       focus            = nullif(p_header->>'focus', ''),
       duration_weeks   = coalesce((p_header->>'duration_weeks')::int, 1),
       start_date       = coalesce((p_header->>'start_date')::date, start_date),
       status           = case when is_template then status
                               else coalesce(nullif(p_header->>'status', ''), 'active') end,
       progression_rule = nullif(p_header->>'progression_rule', ''),
       tempo_default    = nullif(p_header->>'tempo_default', ''),
       notes            = nullif(p_header->>'notes', ''),
       -- lock_future_weeks: a header without the key keeps the stored value.
       lock_future_weeks = coalesce((p_header->>'lock_future_weeks')::boolean, lock_future_weeks),
       updated_at       = now()
     where id = p_program_id
    returning id into v_program_id;

    if v_program_id is null then
      raise exception 'Program % not found', p_program_id using errcode = 'no_data_found';
    end if;

    -- Park the existing days on negative day_index values so the in-place
    -- updates below can reorder days: unique (program_id, day_index) is not
    -- deferrable, so it is checked row by row and a swap would collide.
    update public.program_days d
       set day_index = -r.rn
      from (select id, row_number() over (order by day_index, id) as rn
              from public.program_days
             where program_id = v_program_id) r
     where d.id = r.id;
  end if;

  for v_day in select * from jsonb_array_elements(coalesce(p_days, '[]'::jsonb))
  loop
    -- Reuse the day only if it belongs to THIS program and no earlier element
    -- of the payload already claimed it (a duplicated id becomes a new day).
    v_day_id := nullif(v_day->>'id', '')::uuid;
    if v_day_id is not null and not (v_day_id = any(v_keep_days)) then
      update public.program_days set
          day_index  = (v_day->>'day_index')::int,
          label      = nullif(v_day->>'label', ''),
          weekday    = nullif(v_day->>'weekday', ''),
          sort_order = coalesce((v_day->>'sort_order')::int, 0)
       where id = v_day_id
         and program_id = v_program_id
      returning id into v_day_id;
    else
      v_day_id := null;
    end if;

    if v_day_id is null then
      insert into public.program_days (program_id, day_index, label, weekday, sort_order)
      values (v_program_id,
          (v_day->>'day_index')::int,
          nullif(v_day->>'label', ''),
          nullif(v_day->>'weekday', ''),
          coalesce((v_day->>'sort_order')::int, 0))
      returning id into v_day_id;
    end if;
    v_keep_days := v_keep_days || v_day_id;

    for v_ex in select * from jsonb_array_elements(coalesce(v_day->'exercises', '[]'::jsonb))
    loop
      v_ex_id       := nullif(v_ex->>'id', '')::uuid;
      v_exercise_id := nullif(v_ex->>'exercise_id', '')::uuid;

      if v_ex_id is not null and not (v_ex_id = any(v_keep_ex)) then
        -- It must belong to this program (any of its days -- moving a row to
        -- another day keeps its history) and still be the same movement.
        select pe.exercise_id into v_old_exercise_id
          from public.program_exercises pe
          join public.program_days d on d.id = pe.program_day_id
         where pe.id = v_ex_id
           and d.program_id = v_program_id;
        -- Only catalog lift A -> catalog lift B is a swap. custom <-> catalog
        -- is the same movement being named better (a typo fixed to the
        -- catalog spelling, a custom movement promoted into the catalog).
        if not found
           or (v_old_exercise_id is not null and v_exercise_id is not null
               and v_old_exercise_id <> v_exercise_id) then
          -- Swapped lift (or a foreign id): insert fresh; the old row, if it
          -- is ours, falls out with the removals below and its logs detach.
          v_ex_id := null;
        end if;
      else
        v_ex_id := null;
      end if;

      if v_ex_id is not null then
        update public.program_exercises set
            program_day_id   = v_day_id,
            exercise_id      = v_exercise_id,
            custom_name      = nullif(v_ex->>'custom_name', ''),
            sets             = coalesce((v_ex->>'sets')::int, 3),
            rep_min          = nullif(v_ex->>'rep_min', '')::int,
            rep_max          = nullif(v_ex->>'rep_max', '')::int,
            is_unilateral    = coalesce((v_ex->>'is_unilateral')::boolean, false),
            rir_min          = nullif(v_ex->>'rir_min', '')::int,
            rir_max          = nullif(v_ex->>'rir_max', '')::int,
            load_pct_1rm     = nullif(v_ex->>'load_pct_1rm', '')::int,
            load_qualitative = nullif(v_ex->>'load_qualitative', ''),
            tempo            = nullif(v_ex->>'tempo', ''),
            rest_seconds     = nullif(v_ex->>'rest_seconds', '')::int,
            notes            = nullif(v_ex->>'notes', ''),
            sort_order       = coalesce((v_ex->>'sort_order')::int, 0),
            superset_group   = nullif(v_ex->>'superset_group', ''),
            week_overrides   = coalesce(v_ex->'week_overrides', '{}'::jsonb)
         where id = v_ex_id;
      else
        insert into public.program_exercises
          (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
           rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order,
           superset_group, week_overrides)
        values (v_day_id,
            v_exercise_id,
            nullif(v_ex->>'custom_name', ''),
            coalesce((v_ex->>'sets')::int, 3),
            nullif(v_ex->>'rep_min', '')::int,
            nullif(v_ex->>'rep_max', '')::int,
            coalesce((v_ex->>'is_unilateral')::boolean, false),
            nullif(v_ex->>'rir_min', '')::int,
            nullif(v_ex->>'rir_max', '')::int,
            nullif(v_ex->>'load_pct_1rm', '')::int,
            nullif(v_ex->>'load_qualitative', ''),
            nullif(v_ex->>'tempo', ''),
            nullif(v_ex->>'rest_seconds', '')::int,
            nullif(v_ex->>'notes', ''),
            coalesce((v_ex->>'sort_order')::int, 0),
            nullif(v_ex->>'superset_group', ''),
            coalesce(v_ex->'week_overrides', '{}'::jsonb))
        returning id into v_ex_id;
      end if;
      v_keep_ex := v_keep_ex || v_ex_id;
    end loop;
  end loop;

  -- Removals: only what the coach actually deleted. Their logs survive,
  -- detached (section 1). No-ops for a brand-new program.
  delete from public.program_exercises pe
   using public.program_days d
   where d.id = pe.program_day_id
     and d.program_id = v_program_id
     and not (pe.id = any(v_keep_ex));

  delete from public.program_days
   where program_id = v_program_id
     and not (id = any(v_keep_days));

  -- Weeks have no dependents (logs store week_number, not a key), so a plain
  -- replace is still safe here.
  delete from public.program_weeks where program_id = v_program_id;

  insert into public.program_weeks
    (program_id, week_number, label, rir_min, rir_max, load_pct_min, load_pct_max,
     is_deload, sets_override, notes)
  select v_program_id,
      (w->>'week_number')::int,
      nullif(w->>'label', ''),
      nullif(w->>'rir_min', '')::int,
      nullif(w->>'rir_max', '')::int,
      nullif(w->>'load_pct_min', '')::int,
      nullif(w->>'load_pct_max', '')::int,
      coalesce((w->>'is_deload')::boolean, false),
      nullif(w->>'sets_override', '')::int,
      nullif(w->>'notes', '')
  from jsonb_array_elements(coalesce(p_weeks, '[]'::jsonb)) as w;

  return v_program_id;
end;
$$;

revoke all     on function public.save_coach_program(uuid, uuid, jsonb, jsonb, jsonb) from public;
grant  execute on function public.save_coach_program(uuid, uuid, jsonb, jsonb, jsonb) to authenticated;

-- A 4th parameter makes a NEW overload next to the old one, and PostgREST
-- can't choose between two. Drop the old signature first (a no-op on re-run).
drop function if exists public.assign_program_template(uuid, uuid, date);

create or replace function public.assign_program_template(
  p_template_id uuid,
  p_client_id   uuid,
  p_start_date  date default current_date,
  -- The assign dialog's "Solo semana actual"; null = the template's own value.
  p_lock_future_weeks boolean default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
  v_day    record;
  v_day_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may assign programs' using errcode = '42501';
  end if;

  if not exists (select 1 from public.programs
                  where id = p_template_id and is_template) then
    raise exception 'Template % not found', p_template_id using errcode = 'no_data_found';
  end if;

  if exists (select 1 from public.programs
              where id = p_template_id and is_template and status <> 'active') then
    raise exception 'Template % is archived — restore it before assigning', p_template_id;
  end if;

  insert into public.programs
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, progression_rule, tempo_default, notes,
     is_template, template_id, lock_future_weeks)
  select p_client_id, auth.uid(), 'coach', t.name, t.description, t.focus,
         t.duration_weeks, coalesce(p_start_date, current_date), 'active',
         t.progression_rule, t.tempo_default, t.notes, false, t.id,
         -- lock_future_weeks: the dialog's choice, else the template's.
         coalesce(p_lock_future_weeks, t.lock_future_weeks)
    from public.programs t
   where t.id = p_template_id
  returning id into v_new_id;

  for v_day in
    select * from public.program_days where program_id = p_template_id order by sort_order, day_index
  loop
    insert into public.program_days (program_id, day_index, label, weekday, sort_order)
    values (v_new_id, v_day.day_index, v_day.label, v_day.weekday, v_day.sort_order)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order,
       superset_group, week_overrides)
    select v_day_id, e.exercise_id, e.custom_name, e.sets, e.rep_min, e.rep_max, e.is_unilateral,
           e.rir_min, e.rir_max, e.load_pct_1rm, e.load_qualitative, e.tempo, e.rest_seconds,
           e.notes, e.sort_order, e.superset_group, e.week_overrides
      from public.program_exercises e
     where e.program_day_id = v_day.id;
  end loop;

  insert into public.program_weeks
    (program_id, week_number, label, rir_min, rir_max, load_pct_min, load_pct_max,
     is_deload, sets_override, notes)
  select v_new_id, w.week_number, w.label, w.rir_min, w.rir_max, w.load_pct_min,
         w.load_pct_max, w.is_deload, w.sets_override, w.notes
    from public.program_weeks w
   where w.program_id = p_template_id;

  return v_new_id;
end;
$$;

revoke all     on function public.assign_program_template(uuid, uuid, date, boolean) from public;
grant  execute on function public.assign_program_template(uuid, uuid, date, boolean) to authenticated;

create or replace function public.save_program_as_template(
  p_program_id uuid,
  p_name       text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
  v_day    record;
  v_day_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may manage programs' using errcode = '42501';
  end if;

  if not exists (select 1 from public.programs where id = p_program_id) then
    raise exception 'Program % not found', p_program_id using errcode = 'no_data_found';
  end if;

  insert into public.programs
    (user_id, assigned_by, source, name, description, focus, duration_weeks,
     start_date, status, progression_rule, tempo_default, notes,
     is_template, template_id, lock_future_weeks)
  select null, auth.uid(), 'coach',
         coalesce(nullif(btrim(p_name), ''), p.name),
         p.description, p.focus, p.duration_weeks,
         current_date, 'active',
         p.progression_rule, p.tempo_default, p.notes,
         true, null,
         -- lock_future_weeks: the template keeps the program's setting.
         p.lock_future_weeks
    from public.programs p
   where p.id = p_program_id
  returning id into v_new_id;

  for v_day in
    select * from public.program_days where program_id = p_program_id order by sort_order, day_index
  loop
    insert into public.program_days (program_id, day_index, label, weekday, sort_order)
    values (v_new_id, v_day.day_index, v_day.label, v_day.weekday, v_day.sort_order)
    returning id into v_day_id;

    insert into public.program_exercises
      (program_day_id, exercise_id, custom_name, sets, rep_min, rep_max, is_unilateral,
       rir_min, rir_max, load_pct_1rm, load_qualitative, tempo, rest_seconds, notes, sort_order,
       superset_group, week_overrides)
    select v_day_id, e.exercise_id, e.custom_name, e.sets, e.rep_min, e.rep_max, e.is_unilateral,
           e.rir_min, e.rir_max, e.load_pct_1rm, e.load_qualitative, e.tempo, e.rest_seconds,
           e.notes, e.sort_order, e.superset_group, e.week_overrides
      from public.program_exercises e
     where e.program_day_id = v_day.id;
  end loop;

  insert into public.program_weeks
    (program_id, week_number, label, rir_min, rir_max, load_pct_min, load_pct_max,
     is_deload, sets_override, notes)
  select v_new_id, w.week_number, w.label, w.rir_min, w.rir_max, w.load_pct_min,
         w.load_pct_max, w.is_deload, w.sets_override, w.notes
    from public.program_weeks w
   where w.program_id = p_program_id;

  -- Claim the source program for the new template. Without this the client who
  -- inspired the template wouldn't appear under "Clientes asignados" — they ARE
  -- running it, so the library should say so. Only ever fills a null.
  update public.programs
     set template_id = v_new_id, updated_at = now()
   where id = p_program_id
     and template_id is null
     and not is_template;

  return v_new_id;
end;
$$;

revoke all     on function public.save_program_as_template(uuid, text) from public;
grant  execute on function public.save_program_as_template(uuid, text) to authenticated;

-- 3) PostgREST: pick up the new column and signature (sent on commit) -----------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select data_type, is_nullable, column_default from information_schema.columns
--    where table_schema = 'public' and table_name = 'programs'
--      and column_name = 'lock_future_weeks';                -- 1 row: boolean | NO | false
--   select count(*) from public.programs where lock_future_weeks;  -- 0 right after the first run
--   select pg_get_function_identity_arguments(oid) from pg_proc
--    where proname = 'assign_program_template' and pronamespace = 'public'::regnamespace;
--     -- 1 row: p_template_id uuid, p_client_id uuid, p_start_date date, p_lock_future_weeks boolean
--   select proname, prosrc like '%lock_future_weeks%' from pg_proc
--    where pronamespace = 'public'::regnamespace
--      and proname in ('save_coach_program', 'assign_program_template', 'save_program_as_template');
--     -- 3 rows, all true
--   select has_function_privilege('authenticated',
--          'public.assign_program_template(uuid, uuid, date, boolean)', 'execute');  -- true
```

- [ ] **Step 3: Check that the copied bodies changed only where intended**

Run in Git Bash (it needs process substitution):

```bash
M=/c/Users/Signos/Documents/edwin/hokage-coaching-app/supabase/migrations
diff --strip-trailing-cr \
  <(sed -n '63,428p' $M/20260926130000_supersets_week_overrides_client_notes.sql) \
  <(sed -n '/^create or replace function public.save_coach_program/,/^grant  execute on function public.save_program_as_template/p' $M/20260929120000_program_lock_future_weeks.sql)
```

Expected output, exactly these 10 hunks:

```
30c30,31
<        start_date, status, progression_rule, tempo_default, notes, is_template)
---
>        start_date, status, progression_rule, tempo_default, notes, is_template,
>        lock_future_weeks)
46c47,49
<        v_is_template)
---
>        v_is_template,
>        -- lock_future_weeks: a header without the key saves it unlocked.
>        coalesce((p_header->>'lock_future_weeks')::boolean, false))
59a63,64
>        -- lock_future_weeks: a header without the key keeps the stored value.
>        lock_future_weeks = coalesce((p_header->>'lock_future_weeks')::boolean, lock_future_weeks),
220a226,229
> -- A 4th parameter makes a NEW overload next to the old one, and PostgREST
> -- can't choose between two. Drop the old signature first (a no-op on re-run).
> drop function if exists public.assign_program_template(uuid, uuid, date);
> 
224c233,235
<   p_start_date  date default current_date
---
>   p_start_date  date default current_date,
>   -- The assign dialog's "Solo semana actual"; null = the template's own value.
>   p_lock_future_weeks boolean default null
251c262
<      is_template, template_id)
---
>      is_template, template_id, lock_future_weeks)
254c265,267
<          t.progression_rule, t.tempo_default, t.notes, false, t.id
---
>          t.progression_rule, t.tempo_default, t.notes, false, t.id,
>          -- lock_future_weeks: the dialog's choice, else the template's.
>          coalesce(p_lock_future_weeks, t.lock_future_weeks)
289,290c302,303
< revoke all     on function public.assign_program_template(uuid, uuid, date) from public;
< grant  execute on function public.assign_program_template(uuid, uuid, date) to authenticated;
---
> revoke all     on function public.assign_program_template(uuid, uuid, date, boolean) from public;
> grant  execute on function public.assign_program_template(uuid, uuid, date, boolean) to authenticated;
315c328
<      is_template, template_id)
---
>      is_template, template_id, lock_future_weeks)
321c334,336
<          true, null
---
>          true, null,
>          -- lock_future_weeks: the template keeps the program's setting.
>          p.lock_future_weeks
```

Any other hunk is a copy mistake. Fix the file until the diff matches.

- [ ] **Step 4: USER STEP. Apply the migration in the Supabase SQL editor**

Migrations are applied by hand (README "Backend": "applied in order in the SQL editor"). You can't do this yourself. **Stop and ask the user:**

> Please open the Supabase SQL editor for project `rzgwkwxskrovxnnymxqo`, paste the whole of `supabase/migrations/20260929120000_program_lock_future_weeks.sql` and press Run. Tell me what it shows.

Expected: `Success. No rows returned`. Wait for the user's answer before Step 5. If they report an error, don't change the function bodies by guesswork: read the error, fix the file, repeat Step 3 and ask again. The file is safe to re-run. After the migration, today's panel keeps working: its 3-argument `assign_program_template` call resolves to the new function (the 4th parameter has a default), and a header without the key leaves stored values alone.

- [ ] **Step 5: USER STEP. Run the verify query**

The SQL editor only shows the last statement's result, so ask the user to run this single query and paste the result:

```sql
select item, actual, expected, actual = expected as ok
  from (
    select 'column' as item,
           (select format('%s | %s | %s', data_type, is_nullable, column_default)
              from information_schema.columns
             where table_schema = 'public' and table_name = 'programs'
               and column_name = 'lock_future_weeks') as actual,
           'boolean | NO | false' as expected
    union all
    select 'locked programs',
           (select count(*)::text from public.programs where lock_future_weeks),
           '0'
    union all
    select 'assign signatures',
           (select string_agg(pg_get_function_identity_arguments(oid), ' / ')
              from pg_proc
             where proname = 'assign_program_template' and pronamespace = 'public'::regnamespace),
           'p_template_id uuid, p_client_id uuid, p_start_date date, p_lock_future_weeks boolean'
    union all
    select 'functions read the flag',
           (select string_agg(proname || '=' || (prosrc like '%lock_future_weeks%')::text, ', ' order by proname)
              from pg_proc
             where pronamespace = 'public'::regnamespace
               and proname in ('save_coach_program', 'assign_program_template', 'save_program_as_template')),
           'assign_program_template=true, save_coach_program=true, save_program_as_template=true'
    union all
    select 'authenticated can assign',
           has_function_privilege('authenticated',
             'public.assign_program_template(uuid, uuid, date, boolean)', 'execute')::text,
           'true'
  ) v;
```

Expected: 5 rows, `ok = true` on every row. `locked programs` is `0` only right after the first run; it grows once the coach uses the switch. If `assign signatures` lists two entries separated by ` / `, the old overload survived: stop and report it.

- [ ] **Step 6: USER STEP (recommended). Functional check that rolls itself back**

Ask the user to run this block in the SQL editor. It acts as the coach, calls the three functions and checks the stored flag. Then it raises an error on purpose, which rolls back everything it wrote. Nothing is saved and no realtime event is sent.

```sql
do $$
declare
  v_coach  uuid := (select id from public.profiles where role = 'coach' order by created_at limit 1);
  v_client uuid := (select id from public.profiles where role = 'user' order by created_at limit 1);
  v_tpl    uuid;
  v_copy   uuid;
  v_free   uuid;
  v_promo  uuid;
begin
  if v_coach is null or v_client is null then
    raise exception 'Needs one coach and one client profile';
  end if;
  -- auth.uid() and is_coach() read these claims.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_coach, 'role', 'authenticated')::text, true);

  v_tpl := public.save_coach_program(null, null,
    '{"name": "zz lock smoke", "duration_weeks": 2, "lock_future_weeks": true}', '[]', '[]');
  assert (select lock_future_weeks from public.programs where id = v_tpl), 'save: new template with true';

  perform public.save_coach_program(v_tpl, null,
    '{"name": "zz lock smoke", "duration_weeks": 2}', '[]', '[]');
  assert (select lock_future_weeks from public.programs where id = v_tpl), 'save: header without the key keeps true';

  v_copy := public.assign_program_template(v_tpl, v_client, current_date);
  assert (select lock_future_weeks from public.programs where id = v_copy), 'assign: null copies the template';

  v_free := public.assign_program_template(v_tpl, v_client, current_date, false);
  assert not (select lock_future_weeks from public.programs where id = v_free), 'assign: false overrides the template';

  v_promo := public.save_program_as_template(v_copy);
  assert (select lock_future_weeks from public.programs where id = v_promo), 'promote: copies the flag';

  perform public.save_coach_program(v_tpl, null,
    '{"name": "zz lock smoke", "duration_weeks": 2, "lock_future_weeks": false}', '[]', '[]');
  assert not (select lock_future_weeks from public.programs where id = v_tpl), 'save: false switches it off';

  raise exception 'SMOKE OK: all 6 checks passed; nothing was saved';
end $$;
```

What the result means:
- Pass: the editor shows the error `P0001: SMOKE OK: all 6 checks passed; nothing was saved`.
- Failed check: an error `P0004:` followed by that check's message (for example `assign: false overrides the template`). Stop and report it.
- `Needs one coach and one client profile`: the check can't run on this database. Skip it; Step 5 is enough.

- [ ] **Step 7: Add the field to the app's `Program` type**

In `C:\Users\Signos\Documents\edwin\hokage-coaching-app\src\types\database.ts`, replace:

```ts
  start_date: string;
  status: ProgramStatus;
  progression_rule: string | null;
```

(lines 197-199, inside `export type Program`; the anchor is unique) with:

```ts
  start_date: string;
  status: ProgramStatus;
  /** "Solo semana actual" (20260929120000): the client can only complete the
   *  current week and past weeks. Enforced by the app, not the database. */
  lock_future_weeks: boolean;
  progression_rule: string | null;
```

The app fetches programs with `select("*, …")` (`src/hooks/use-program.ts`), so the column arrives without query changes. A program cached before the migration has no field at runtime, which is why `weekLock` (Task 2) checks `=== true`.

- [ ] **Step 8: Add the field to the panel's `Program` interface**

In `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\types.ts`, replace:

```ts
  start_date: string; // ISO date
  status: ProgramStatus;
  progression_rule: string | null;
```

(lines 178-180, inside `export interface Program`; the anchor is unique, and `TemplateAssignment` below has a different order) with:

```ts
  start_date: string; // ISO date
  status: ProgramStatus;
  /** "Solo semana actual": the client's app only lets them complete the
   *  current week and past weeks. Templates pass it on when assigned. */
  lock_future_weeks: boolean;
  progression_rule: string | null;
```

This is the only place the panel type gets the field; Task 8 does not add it again.

- [ ] **Step 9: Type-check and lint both repos**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npx tsc --noEmit && npm run lint
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit && npm run lint
```

Expected:
- Panel: `tsc` prints nothing (exit 0); `eslint .` prints only its `> eslint .` banner (exit 0).
- App: `tsc` prints nothing (exit 0). `expo lint`: `✖ 3 problems (0 errors, 3 warnings)`, the existing `import/no-named-as-default-member` warnings in `src/i18n/index.ts`.

- [ ] **Step 10: Commit the app repo**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add supabase/migrations/20260929120000_program_lock_future_weeks.sql src/types/database.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly `src/types/database.ts` and `supabase/migrations/20260929120000_program_lock_future_weeks.sql`. Anything else was staged by someone else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(programs): lock_future_weeks column and RPCs (Solo semana actual)" -m "programs.lock_future_weeks (default false). save_coach_program reads it from the header, assign_program_template takes p_lock_future_weeks (old 3-arg signature dropped), save_program_as_template copies it. Program type gets the field." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with 2 files. A `LF will be replaced by CRLF` warning is harmless (`core.autocrlf=true`).

- [ ] **Step 11: Commit the panel repo**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel add src/types.ts
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel diff --cached --name-only
```

Expected: exactly `src/types.ts`.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel commit -m "feat(programs): lock_future_weeks on the Program type" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected: one commit with 1 file.

---

### Task 2: Test harness + week-lock rule

**Files:**
- Create: `scripts/test-resolve.mjs`
- Create: `scripts/test-register.mjs`
- Create: `scripts/test-stubs/react-native.mjs`
- Modify: `package.json` (line 11, `"lint": "expo lint"`)
- Create: `src/utils/program.test.ts`
- Modify: `src/utils/program.ts` (line 7 import; lines 22-25, the body of `currentWeekOf`; insert between `isAfterEnd`, which ends at line 42, and `weekByNumber` at line 44)

All paths are relative to the app repo `C:\Users\Signos\Documents\edwin\hokage-coaching-app`; run every command from there (`cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && …`).

**Interfaces:**
- Consumes: `Program.lock_future_weeks: boolean` in `src/types/database.ts` (Task 1). The tests run without it because types are stripped; `npx tsc --noEmit` needs it (without it: `TS2344 … does not satisfy the constraint` in `src/utils/program.ts`).
- Produces:
  - `export type WeekLock = { kind: "start" | "week"; opensOn: string }`
  - `export function weekOpensOn(startDate: string, week: number): string`
  - `export function weekLock(program: Pick<ProgramWithDetails, "lock_future_weeks" | "start_date" | "duration_weeks">, week: number, now: Date = new Date()): WeekLock | null`
  - `currentWeekOf`, now DST-safe, with the same signature (`src/utils/progress.ts` line 432 also calls it, and gets the fix)
  - `npm test`, which runs `src/**/*.test.ts` with `node:test`
  - the `react-native` test stub (only `AppState`), which Task 3 uses

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- scripts package.json src/utils/program.ts src/utils/program.test.ts
```

Expected: the second command prints nothing (else stop and ask). If the first prints nothing, run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`; if it lists other files, don't pull or stash. Then read `package.json` and `src/utils/program.ts` in full.

- [ ] **Step 2: Create the resolver hook `scripts/test-resolve.mjs`**

```js
// Module resolution for `npm test`: node:test runs the app's .ts sources with
// Node's built-in type stripping. Metro and tsc resolve the app's imports on
// their own; plain Node can't, so this fills the gaps:
//   - "@/..." is the repo root (tsconfig "paths");
//   - app imports leave out the extension ("./dates" → "./dates.ts");
//   - the app's .ts files are ES modules (package.json can't say
//     "type": "module" without breaking the CommonJS configs Metro and ESLint
//     load);
//   - "react-native" can't load in Node, so it maps to a small stub.
// Test-only: nothing in the app imports this file.
import { statSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = new URL("../", import.meta.url);

const STUBS = {
  "react-native": new URL("./test-stubs/react-native.mjs", import.meta.url).href,
};

// Only what Node can strip: .tsx (JSX) can't run under `npm test`.
const SUFFIXES = ["", ".ts", "/index.ts"];

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isAppFile(url) {
  return url != null && url.startsWith("file:") && !url.includes("/node_modules/");
}

/** "@/…" and extensionless relative imports from app files → a file URL. */
function findAppFile(specifier, parentURL) {
  let base = null;
  if (specifier.startsWith("@/")) {
    base = new URL(specifier.slice(2), ROOT);
  } else if (isAppFile(parentURL) && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    base = new URL(specifier, parentURL);
  }
  if (base == null) return null;
  const path = fileURLToPath(base);
  for (const suffix of SUFFIXES) {
    if (isFile(path + suffix)) return pathToFileURL(path + suffix).href;
  }
  return null;
}

export function resolve(specifier, context, nextResolve) {
  const stub = STUBS[specifier];
  if (stub != null) return { url: stub, format: "module", shortCircuit: true };

  const found = findAppFile(specifier, context.parentURL);
  const result = found != null ? { url: found, shortCircuit: true } : nextResolve(specifier, context);
  if (isAppFile(result.url) && result.url.endsWith(".ts")) {
    return { ...result, format: "module-typescript" };
  }
  return result;
}
```

- [ ] **Step 3: Create `scripts/test-register.mjs` and `scripts/test-stubs/react-native.mjs`**

`scripts/test-register.mjs`:

```js
// Loaded with `node --import` by `npm test`: installs the resolver in
// ./test-resolve.mjs before any test file is imported.
import { registerHooks } from "node:module";

import { resolve } from "./test-resolve.mjs";

registerHooks({ resolve });
```

`scripts/test-stubs/react-native.mjs`:

```js
// Stand-in for "react-native" under `npm test` (see ../test-resolve.mjs).
// Covers only what modules under test touch; the real one never runs in Node.
export const AppState = {
  currentState: "active",
  addEventListener: () => ({ remove() {} }),
};
```

- [ ] **Step 4: Add the `test` script to `package.json`**

Replace:

```json
    "lint": "expo lint"
  },
```

With:

```json
    "lint": "expo lint",
    "test": "node --import ./scripts/test-register.mjs --test \"src/**/*.test.ts\""
  },
```

(npm runs scripts through cmd.exe on Windows even when called from Git Bash. The escaped quotes reach Node, which expands the glob itself. Verified from Git Bash, from PowerShell, and with `npm --prefix <repo> test` from another folder.)

- [ ] **Step 5: Write the failing tests in `src/utils/program.test.ts`**

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { addDays } from "@/src/utils/dates";
import { currentWeekOf, weekLock, weekOpensOn } from "@/src/utils/program";

// Run a suite's tests in a fixed time zone, so results don't depend on the
// machine's. Node re-reads TZ when process.env.TZ is assigned (Windows too;
// Git Bash drops a TZ set on the command line, so it has to be set here).
function inTimeZone(tz: string) {
  let saved: string | undefined;
  before(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  after(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

/** A local clock time on a "YYYY-MM-DD" day. */
function at(key: string, hours = 12, minutes = 0): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, hours, minutes);
}

// `lock` undefined stands for a program cached before the column existed.
function program(lock: boolean | undefined, startDate = "2026-10-05", durationWeeks = 4) {
  return {
    lock_future_weeks: lock as boolean,
    start_date: startDate,
    duration_weeks: durationWeeks,
  };
}

// The coach's zone (UTC-4, no DST).
describe("in America/Santo_Domingo", () => {
  inTimeZone("America/Santo_Domingo");

  describe("weekOpensOn", () => {
    it("opens week 1 on the start date", () => {
      assert.equal(weekOpensOn("2026-10-05", 1), "2026-10-05");
    });

    it("opens each later week 7 days after the one before", () => {
      assert.equal(weekOpensOn("2026-10-05", 2), "2026-10-12");
      assert.equal(weekOpensOn("2026-10-05", 4), "2026-10-26");
    });

    it("crosses month and year ends", () => {
      assert.equal(weekOpensOn("2026-12-28", 2), "2027-01-04");
    });
  });

  describe("currentWeekOf", () => {
    it("is week 1 before the start and on the start date", () => {
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-09-20")), 1);
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-10-05", 0, 0)), 1);
    });

    it("moves to week 2 on day 8, whatever the time of day", () => {
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-10-11", 23, 59)), 1);
      assert.equal(currentWeekOf("2026-10-05", 4, at("2026-10-12", 0, 0)), 2);
    });

    it("stays on the last week after the block", () => {
      assert.equal(currentWeekOf("2026-10-05", 4, at("2027-01-15")), 4);
    });
  });

  describe("weekLock", () => {
    it("never locks when the flag is off", () => {
      assert.equal(weekLock(program(false), 1, at("2026-09-20")), null);
      assert.equal(weekLock(program(false), 4, at("2026-10-14")), null);
    });

    it("never locks when the flag is missing", () => {
      assert.equal(weekLock(program(undefined), 1, at("2026-09-20")), null);
      assert.equal(weekLock(program(undefined), 4, at("2026-10-14")), null);
    });

    it("locks every week until the start date", () => {
      const now = at("2026-10-04", 23, 59);
      assert.deepEqual(weekLock(program(true), 1, now), { kind: "start", opensOn: "2026-10-05" });
      assert.deepEqual(weekLock(program(true), 3, now), { kind: "start", opensOn: "2026-10-05" });
    });

    it("opens week 1 on the start date", () => {
      assert.equal(weekLock(program(true), 1, at("2026-10-05", 0, 0)), null);
    });

    it("keeps the current week and past weeks open", () => {
      const now = at("2026-10-14"); // week 2
      assert.equal(weekLock(program(true), 2, now), null);
      assert.equal(weekLock(program(true), 1, now), null);
    });

    it("locks later weeks until the date each one opens", () => {
      const now = at("2026-10-14"); // week 2
      assert.deepEqual(weekLock(program(true), 3, now), { kind: "week", opensOn: "2026-10-19" });
      assert.deepEqual(weekLock(program(true), 4, now), { kind: "week", opensOn: "2026-10-26" });
    });

    it("opens the next week at local midnight", () => {
      assert.deepEqual(weekLock(program(true), 3, at("2026-10-18", 23, 59)), {
        kind: "week",
        opensOn: "2026-10-19",
      });
      assert.equal(weekLock(program(true), 3, at("2026-10-19", 0, 0)), null);
    });

    it("opens every week after the block", () => {
      for (let w = 1; w <= 4; w++) {
        assert.equal(weekLock(program(true), w, at("2026-11-20")), null);
      }
    });
  });
});

// US Eastern: DST starts 2027-03-14 (a 23-hour day) and ends 2027-11-07 (a
// 25-hour day). Counting days by dividing local-midnight gaps by 24h and
// flooring came out a day short across the spring change.
describe("across DST changes (America/New_York)", () => {
  inTimeZone("America/New_York");

  it("runs in the zone (EST before, EDT after 2027-03-14)", () => {
    assert.equal(new Date(2027, 2, 13, 12).getTimezoneOffset(), 300);
    assert.equal(new Date(2027, 2, 15, 12).getTimezoneOffset(), 240);
  });

  it("moves to week 2 on day 8 across the spring change", () => {
    assert.equal(currentWeekOf("2027-03-08", 4, at("2027-03-15", 0, 30)), 2);
  });

  it("moves to week 2 on day 8 across the fall change", () => {
    assert.equal(currentWeekOf("2027-11-01", 4, at("2027-11-08", 0, 30)), 2);
  });

  // Blocks starting on every day of a four-week window around each change,
  // so every week boundary near it is crossed, at both ends of the day.
  it("opens each week on its date and not the day before", () => {
    const starts = [
      ...Array.from({ length: 28 }, (_, i) => addDays("2027-02-20", i)),
      ...Array.from({ length: 28 }, (_, i) => addDays("2027-10-20", i)),
    ];
    for (const start of starts) {
      const p = program(true, start, 4);
      for (let w = 2; w <= 4; w++) {
        const opensOn = weekOpensOn(start, w);
        const dayBefore = addDays(opensOn, -1);
        for (const [h, m] of [
          [0, 0],
          [23, 59],
        ]) {
          assert.equal(
            weekLock(p, w, at(opensOn, h, m)),
            null,
            `start ${start}: week ${w} open on ${opensOn} ${h}:${m}`,
          );
          assert.deepEqual(
            weekLock(p, w, at(dayBefore, h, m)),
            { kind: "week", opensOn },
            `start ${start}: week ${w} locked on ${dayBefore} ${h}:${m}`,
          );
        }
      }
    }
  });
});
```

TypeScript 6.0.3 here doesn't load `@types/node` on its own; the `/// <reference types="node" />` line is what lets `npx tsc --noEmit` accept `node:test` (without it: `TS2591`). `tsconfig.json` stays unchanged.

- [ ] **Step 6: Run the tests and watch them fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: the file fails to load and the run exits non-zero:

```
SyntaxError: The requested module '@/src/utils/program' does not provide an export named 'weekLock'
...
ℹ tests 1
ℹ pass 0
ℹ fail 1
```

(This also shows the resolver maps `@/src/utils/program` to `src/utils/program.ts`.) On Windows the run may also print `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING) … async.c`; that line is harmless and not part of the result. Do not set `TZ` in the shell: Git Bash does not pass it to node.exe, and the tests set it themselves.

- [ ] **Step 7: Add `WeekLock`, `weekOpensOn` and `weekLock` to `src/utils/program.ts`**

Replace:

```ts
  return toDateKey(now) > lastDay;
}

export function weekByNumber(
```

With:

```ts
  return toDateKey(now) > lastDay;
}

/** Why a week is view only under "Solo semana actual": the program hasn't
    started, or the week hasn't opened yet. `opensOn` is "YYYY-MM-DD". */
export type WeekLock = { kind: "start" | "week"; opensOn: string };

/** The day a week begins: the start date plus 7·(week − 1) days. */
export function weekOpensOn(startDate: string, week: number): string {
  return addDays(startDate, (week - 1) * 7);
}

/** Null when the client may log the week, else why not. Only programs with
    lock_future_weeks lock anything: before the start date the whole program
    is view only, then each week opens on its date (weekOpensOn) and stays
    open, so missed trainings can be caught up. After the block every week is
    open, since currentWeekOf stays on the last one. */
export function weekLock(
  program: Pick<ProgramWithDetails, "lock_future_weeks" | "start_date" | "duration_weeks">,
  week: number,
  now: Date = new Date(),
): WeekLock | null {
  // `!== true`: a program cached before the column existed has no flag.
  if (program.lock_future_weeks !== true) return null;
  if (isBeforeStart(program.start_date, now)) {
    return { kind: "start", opensOn: program.start_date };
  }
  if (week > currentWeekOf(program.start_date, program.duration_weeks, now)) {
    return { kind: "week", opensOn: weekOpensOn(program.start_date, week) };
  }
  return null;
}

export function weekByNumber(
```

- [ ] **Step 8: Run the tests and watch only the DST cases fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: `ℹ tests 18`, `ℹ pass 16`, `ℹ fail 2`. The two failures are:
- `✖ moves to week 2 on day 8 across the spring change` with `1 !== 2`
- `✖ opens each week on its date and not the day before` with `start 2027-02-22: week 4 open on 2027-03-15 0:0`, where the actual value is `{ kind: 'week', opensOn: '2027-03-15' }` and the expected value is `null`

- [ ] **Step 9: Make `currentWeekOf` DST-safe**

In `src/utils/program.ts`, replace line 7:

```ts
import { addDays, toDateKey } from "@/src/utils/dates";
```

with:

```ts
import { addDays, dateKeyToDate, toDateKey } from "@/src/utils/dates";
```

and replace the body lines of `currentWeekOf`:

```ts
  const start = new Date(`${startDate}T00:00:00`);
  const today = new Date(`${toDateKey(now)}T00:00:00`);
  const elapsedDays = Math.floor((today.getTime() - start.getTime()) / DAY_MS);
  const week = Math.floor(elapsedDays / 7) + 1;
```

with:

```ts
  // Noon to noon, rounded: a DST change in between makes the gap a whole
  // number of days ± 1h, and flooring midnight gaps came out a day short
  // after a 23-hour day, opening the week a day late.
  const start = dateKeyToDate(startDate);
  const today = dateKeyToDate(toDateKey(now));
  const elapsedDays = Math.round((today.getTime() - start.getTime()) / DAY_MS);
  const week = Math.floor(elapsedDays / 7) + 1;
```

(Leave the signature, the doc comment, `DAY_MS` and the clamping `return` line as they are.)

- [ ] **Step 10: Run the tests: all pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: no `MODULE_TYPELESS_PACKAGE_JSON` warning, and it ends with:

```
ℹ tests 18
ℹ suites 5
ℹ pass 18
ℹ fail 0
```

To run one file: `node --import ./scripts/test-register.mjs --test src/utils/program.test.ts`.

- [ ] **Step 11: Type-check and lint**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`
Expected: no output, exit 0.

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint`
Expected: `✖ 3 problems (0 errors, 3 warnings)`, the existing `src/i18n/index.ts` warnings only; nothing in `scripts/` or `src/utils/`.

- [ ] **Step 12: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add scripts/test-resolve.mjs scripts/test-register.mjs scripts/test-stubs/react-native.mjs package.json src/utils/program.ts src/utils/program.test.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly those 6 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): week-lock rule and a node:test harness" -m "weekLock/weekOpensOn next to currentWeekOf for Solo semana actual; currentWeekOf counts days noon to noon so a week opens on its date across DST. npm test runs src/**/*.test.ts with Node's type stripping." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Fresh today (`src/lib/today.ts`) wired into `use-program.ts` and `program-home-card.tsx`

**Files:**
- Create: `src/lib/today.test.ts`
- Create: `src/lib/today.ts`
- Modify: `src/hooks/use-program.ts` (line 6 import; lines 77-83 `autoWeek`; lines 94-99 `notStarted` / `completed`)
- Modify: `src/components/program/program-home-card.tsx` (line 10 import; line 42 `autoWeek`; line 66 `dow`)

**Interfaces:**
- Consumes: `currentWeekOf`, `isBeforeStart` and `isAfterEnd` (all take a `now` argument) from `src/utils/program.ts`; `toDateKey` and `dateKeyToDate` from `src/utils/dates.ts`; the Task 2 harness and its `react-native` stub.
- Produces:
  - `export function msUntilNextLocalMidnight(now: Date): number` (pure)
  - `export function getToday(): Date` and `export function subscribeToday(listener: () => void): () => void`: the store, exported for the tests
  - `export function useToday(): Date`: noon of the local day, the same object all day, re-rendering at local midnight (+1s) and on AppState `active`
  - `useProgram()` computes `autoWeek`, `notStarted` and `completed` from `useToday()`; its return shape is unchanged (it does not return `today`)
  - `ProgramHomeCard` gets its week and weekday from `useToday()`; Task 7 builds on the `today` const this task adds

This follows the existing module-store pattern (`src/lib/alert-mode.ts`, `src/lib/weight-unit.ts`: a module `listeners` Set plus `useSyncExternalStore(subscribe, get, get)`). React is 19.2.3.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/lib/today.ts src/lib/today.test.ts src/hooks/use-program.ts src/components/program/program-home-card.tsx
```

Expected: the second command prints nothing (else stop and ask). If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`; otherwise don't pull or stash. Read `src/hooks/use-program.ts` and `src/components/program/program-home-card.tsx` in full.

- [ ] **Step 2: Write the failing tests in `src/lib/today.test.ts`**

```ts
/// <reference types="node" />
// `npm test`: node:test on the app sources (see scripts/test-resolve.mjs). The
// reference above loads Node's types, which this tsconfig leaves out.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { AppState, type AppStateStatus } from "react-native";

import { getToday, msUntilNextLocalMidnight, subscribeToday } from "@/src/lib/today";
import { addDays, toDateKey } from "@/src/utils/dates";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

// Run a suite's tests in a fixed time zone, so results don't depend on the
// machine's. Node re-reads TZ when process.env.TZ is assigned (Windows too;
// Git Bash drops a TZ set on the command line, so it has to be set here).
function inTimeZone(tz: string) {
  let saved: string | undefined;
  before(() => {
    saved = process.env.TZ;
    process.env.TZ = tz;
  });
  after(() => {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  });
}

describe("msUntilNextLocalMidnight", () => {
  describe("in America/Santo_Domingo", () => {
    inTimeZone("America/Santo_Domingo");

    it("counts to 00:00 of the next day", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 5, 12, 0)), 12 * HOUR);
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 5, 23, 59)), MINUTE);
    });

    it("is a whole day at midnight itself, never 0", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 9, 5, 0, 0)), 24 * HOUR);
    });

    it("rolls over the end of the year", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2026, 11, 31, 18, 0)), 6 * HOUR);
    });
  });

  // US Eastern: 2027-03-14 has 23 hours, 2027-11-07 has 25.
  describe("across DST changes (America/New_York)", () => {
    inTimeZone("America/New_York");

    it("runs in the zone (EST before, EDT after 2027-03-14)", () => {
      assert.equal(new Date(2027, 2, 13, 12).getTimezoneOffset(), 300);
      assert.equal(new Date(2027, 2, 15, 12).getTimezoneOffset(), 240);
    });

    it("follows the calendar on a 23-hour day", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2027, 2, 14, 0, 30)), 22.5 * HOUR);
    });

    it("follows the calendar on a 25-hour day", () => {
      assert.equal(msUntilNextLocalMidnight(new Date(2027, 10, 7, 0, 30)), 24.5 * HOUR);
    });

    it("always lands on 00:00 of the next day", () => {
      for (const first of [new Date(2027, 2, 13, 0, 15), new Date(2027, 10, 6, 0, 15)]) {
        // Every half hour for three days around the change.
        for (let i = 0; i < 3 * 48; i++) {
          const now = new Date(first.getTime() + i * 30 * MINUTE);
          const ms = msUntilNextLocalMidnight(now);
          const then = new Date(now.getTime() + ms);
          assert.ok(ms > 0, now.toString());
          assert.equal(then.getHours(), 0, now.toString());
          assert.equal(then.getMinutes(), 0, now.toString());
          assert.equal(toDateKey(then), addDays(toDateKey(now), 1), now.toString());
        }
      }
    });
  });
});

// The store behind useToday, driven by mocked timers and a fake AppState
// ("react-native" is scripts/test-stubs/react-native.mjs under npm test).
describe("today store", () => {
  inTimeZone("America/Santo_Domingo");

  const realAddEventListener = AppState.addEventListener;
  let onAppState: ((status: AppStateStatus) => void) | null = null;
  let removed = 0;
  // Every subscription a test makes, so a failing test can't leave the
  // store's timer running into the next one.
  const stops: (() => void)[] = [];

  function listen(listener: () => void): () => void {
    const stop = subscribeToday(listener);
    stops.push(stop);
    return stop;
  }

  beforeEach(() => {
    onAppState = null;
    removed = 0;
    AppState.addEventListener = (_type, handler) => {
      onAppState = handler;
      return {
        remove() {
          removed++;
          onAppState = null;
        },
      };
    };
  });

  afterEach(() => {
    stops.splice(0).forEach((stop) => stop());
    mock.timers.reset();
    AppState.addEventListener = realAddEventListener;
  });

  it("is the same object all day", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 8, 0) });
    const first = getToday();
    assert.equal(toDateKey(first), "2026-10-05");
    mock.timers.setTime(new Date(2026, 9, 5, 22, 0).getTime());
    assert.equal(getToday(), first);
  });

  it("notifies just after local midnight and moves to the new day", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 23, 59) });
    let calls = 0;
    listen(() => calls++);
    mock.timers.tick(MINUTE); // 00:00:00; the timer aims 1s past it
    assert.equal(calls, 0);
    mock.timers.tick(1000);
    assert.equal(calls, 1);
    assert.equal(toDateKey(getToday()), "2026-10-06");
    mock.timers.tick(24 * HOUR); // and again the next night
    assert.equal(calls, 2);
    assert.equal(toDateKey(getToday()), "2026-10-07");
  });

  it("catches up on returning to the foreground", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 10, 0) });
    let calls = 0;
    listen(() => calls++);
    // Two days in the background, with the timer never firing.
    mock.timers.setTime(new Date(2026, 9, 7, 9, 0).getTime());
    onAppState?.("background");
    assert.equal(calls, 0);
    onAppState?.("active");
    assert.equal(calls, 1);
    assert.equal(toDateKey(getToday()), "2026-10-07");
  });

  it("stops the timer and the AppState listener after the last unsubscribe", () => {
    mock.timers.enable({ apis: ["Date", "setTimeout"], now: new Date(2026, 9, 5, 23, 0) });
    let calls = 0;
    const stopA = listen(() => calls++);
    const stopB = listen(() => calls++);
    stopA();
    assert.ok(onAppState != null);
    assert.equal(removed, 0);
    stopB();
    assert.equal(onAppState, null);
    assert.equal(removed, 1);
    mock.timers.tick(2 * 24 * HOUR);
    assert.equal(calls, 0);
  });
});
```

- [ ] **Step 3: Run the tests and watch the new file fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: `src\lib\today.test.ts` fails to load with `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@/src' imported from …\src\lib\today.test.ts` (the resolver finds no `src/lib/today.ts` and falls through to Node). Totals: `ℹ tests 19`, `ℹ pass 18`, `ℹ fail 1`.

- [ ] **Step 4: Create `src/lib/today.ts`**

```ts
import { useSyncExternalStore } from "react";
import { AppState, type NativeEventSubscription } from "react-native";

import { dateKeyToDate, toDateKey } from "@/src/utils/dates";

// The device's local calendar day as a store. Screens keyed on it (the
// program's current week, "starts on", the Solo-semana-actual lock) move to
// the new day on their own: at local midnight while the app is open, and on
// returning to the foreground after the day changed in the background. A
// `new Date()` read inside a memo only moves when something else re-renders.

/** Milliseconds from `now` to the next local midnight. Calendar math, not
    now + 24h, so a 23- or 25-hour DST day still lands on 00:00. */
export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

let key = toDateKey();
// Noon of the day (dateKeyToDate): one stable object per day for
// useSyncExternalStore, and far from any DST edge.
let today = dateKeyToDate(key);
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let appState: NativeEventSubscription | null = null;

/** Today (noon), re-read from the clock on every call, so any render after
    midnight already gets the new day; the timer and AppState below make sure
    one happens. The same object all day. */
export function getToday(): Date {
  const next = toDateKey();
  if (next !== key) {
    key = next;
    today = dateKeyToDate(next);
  }
  return today;
}

function emit() {
  listeners.forEach((listener) => listener());
}

// +1s: a timer that fires a hair early would still read the old day.
function scheduleMidnight() {
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(() => {
    emit();
    scheduleMidnight();
  }, msUntilNextLocalMidnight(new Date()) + 1000);
}

/** Calls `listener` at local midnight and on returning to the foreground.
    The clock only runs while someone listens: the first subscriber starts the
    midnight timer and the AppState listener, the last one stops both. */
export function subscribeToday(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    scheduleMidnight();
    appState = AppState.addEventListener("change", (status) => {
      if (status !== "active") return;
      // Timers stall in the background: re-aim at the coming midnight.
      scheduleMidnight();
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer != null) clearTimeout(timer);
      timer = null;
      appState?.remove();
      appState = null;
    }
  };
}

/** Today's local date (at noon). Re-renders when the day changes, and is the
    same object all day, so it is safe in memo and effect deps. */
export function useToday(): Date {
  return useSyncExternalStore(subscribeToday, getToday, getToday);
}
```

- [ ] **Step 5: Run the tests: all pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected output ends with:

```
ℹ tests 29
ℹ suites 9
ℹ pass 29
ℹ fail 0
```

and the process exits right away (the timer only starts on the first subscribe, and every test unsubscribes).

- [ ] **Step 6: Key `useProgram` on the fresh day (`src/hooks/use-program.ts`)**

Replace:

```ts
import { qk } from "@/src/lib/query-keys";
import type { ProgramWithDetails } from "@/src/types/database";
```

With:

```ts
import { qk } from "@/src/lib/query-keys";
import { useToday } from "@/src/lib/today";
import type { ProgramWithDetails } from "@/src/types/database";
```

Replace:

```ts
  const autoWeek = useMemo(
    () =>
      program != null
        ? currentWeekOf(program.start_date, program.duration_weeks)
        : 1,
    [program],
  );
```

With:

```ts
  // Keyed on today as well as the program: the week turns over at local
  // midnight (or while the app sat in the background), not only when the
  // program happens to refetch.
  const today = useToday();
  const autoWeek = useMemo(
    () =>
      program != null
        ? currentWeekOf(program.start_date, program.duration_weeks, today)
        : 1,
    [program, today],
  );
```

Replace:

```ts
  const notStarted = program != null && isBeforeStart(program.start_date);
  // Done when the coach marked it, or the calendar has run past the final week.
  const completed =
    program != null &&
    (program.status === "completed" ||
      isAfterEnd(program.start_date, program.duration_weeks));
```

With:

```ts
  const notStarted = program != null && isBeforeStart(program.start_date, today);
  // Done when the coach marked it, or the calendar has run past the final week.
  const completed =
    program != null &&
    (program.status === "completed" ||
      isAfterEnd(program.start_date, program.duration_weeks, today));
```

- [ ] **Step 7: Use the fresh day in the home card (`src/components/program/program-home-card.tsx`)**

Replace:

```tsx
import { usePressScale } from "@/src/lib/motion";
import { useCelebration } from "@/src/providers/celebration-context";
```

With:

```tsx
import { usePressScale } from "@/src/lib/motion";
import { useToday } from "@/src/lib/today";
import { useCelebration } from "@/src/providers/celebration-context";
```

Replace:

```tsx
  const autoWeek = currentWeekOf(program.start_date, program.duration_weeks);
  const logging = useProgramLogging(program);
```

With:

```tsx
  // The fresh day (src/lib/today): the week and today's weekday move over at
  // midnight even when nothing else re-renders the card.
  const today = useToday();
  const autoWeek = currentWeekOf(program.start_date, program.duration_weeks, today);
  const logging = useProgramLogging(program);
```

Replace:

```tsx
  const dow = new Date().getDay();
```

With:

```tsx
  const dow = today.getDay();
```

- [ ] **Step 8: Type-check, lint, test**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`. Expected: no output, exit 0.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint`. Expected: `✖ 3 problems (0 errors, 3 warnings)`, the existing `src/i18n/index.ts` warnings only (`react-hooks/exhaustive-deps` accepts `[program, today]`).
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`. Expected: `ℹ tests 29`, `ℹ pass 29`, `ℹ fail 0`.

- [ ] **Step 9: Test program setup, then a manual check (web): the week turns over at midnight with no refetch**

Prerequisite: the user applied the migration (Task 1 Steps 4-5). If not, ask them to do it now; if they decline, skip this step and every later manual step, and run them in Task 10.

**Test program setup** (reused by Tasks 4-7 and 10):

1. USER STEP: ask the user which **test client** to use (an account no real person trains on; these checks write completions and set logs into its active program) and for its email. Then ask them to run this in the SQL editor of project `rzgwkwxskrovxnnymxqo` and paste the result:

   ```sql
   select p.id, p.name, p.start_date, p.lock_future_weeks, p.duration_weeks,
          (select count(*) from public.program_days d
            where d.program_id = p.id
              and exists (select 1 from public.program_exercises e where e.program_day_id = d.id)) as days_with_exercises
     from public.programs p
     join public.profiles c on c.id = p.user_id
    where c.email = '<the test client email the user gave>'
      and p.status = 'active';
   ```

   Expected: one row with `duration_weeks >= 3` and `days_with_exercises >= 2`. Record `id` as `<program id>`, and the returned `start_date` and `lock_future_weeks` as the **saved values** (Task 7 Step 8 restores them). If there is no such row, ask the user to assign such a program to the test client in the panel, then re-run the query.

2. USER STEP: put the program in week 2 (week 3 then opens on today + 6 days):

   ```sql
   update public.programs
      set start_date = (now() at time zone 'America/Santo_Domingo')::date - 8
    where id = '<program id>';
   ```

**The check.** Start the web app: `preview_start` with `{"name": "web"}` (app repo `.claude/launch.json`, `npx expo start --web --port 8081`). If the Browser pane shows the sign-in screen, ask the user to sign in as the test client in the Browser pane, then continue. The Browser pane must be displayed while you do this (a hidden pane reports `document.visibilityState` "hidden", and the app then sees "background"): `javascript_tool` `document.visibilityState` must return `"visible"`.

Open `http://localhost:8081/routines`. The header reads «Semana 2 de T» (T = `duration_weeks`). Work out the date week 3 opens: today + 6 days, as `YYYY-MM-DD` (call it `OPENS`). Then run this in the page with `javascript_tool` (it defines two helpers that Task 7 Step 8 reuses; they only exist until the page reloads):

```js
// Test-only clock shift for the web build. __shiftTo(key, ms) makes the clock
// read local midnight at the start of `key` plus `ms`, then fires
// visibilitychange, which react-native-web's AppState reports as "active"
// (back in the foreground). __unshift() restores the real clock.
window.__RealDate ??= Date;
window.__shiftTo = (key, ms) => {
  const Real = window.__RealDate;
  const [y, m, d] = key.split("-").map(Number);
  const shift = new Real(y, m - 1, d).getTime() + ms - Real.now();
  window.Date = class extends Real {
    constructor(...args) { super(...(args.length ? args : [Real.now() + shift])); }
    static now() { return Real.now() + shift; }
  };
  document.dispatchEvent(new Event("visibilitychange"));
};
window.__unshift = () => {
  window.Date = window.__RealDate;
  document.dispatchEvent(new Event("visibilitychange"));
};
```

Then run `__shiftTo("<OPENS>", -5000)` (the clock lands 5 s before that local midnight; the foreground event re-aims the midnight timer on the shifted clock).

Expected: the header stays «Semana 2 de T» for about 6 s, then changes to «Semana 3 de T» by itself, with no reload and no tap. On **Inicio**, the card's week label also shows week 3. Then run `__unshift()`: the header goes back to «Semana 2 de T». Reload the page to fully reset. If the auth session drops, ask the user to sign in again.

- [ ] **Step 10: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/lib/today.ts src/lib/today.test.ts src/hooks/use-program.ts src/components/program/program-home-card.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly those 4 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): fresh today for the current week and the home card" -m "A local-day store (src/lib/today) re-renders at local midnight and on returning to the foreground; useProgram keys autoWeek/notStarted/completed on it and the home card reads its week and weekday from it, so a new week no longer waits for a program refetch." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Logging guards + `lockOf` in `use-program-logging.ts`

**Files:**
- Modify: `src/hooks/use-program-logging.ts`. Anchors checked against HEAD `64ab056` (the file is unchanged since `bf56823`):
  - imports at lines 8-9 (`qk` / `useCelebration`) and 16-17 (`toDateKey` / `supabase`)
  - line 82, `export function useProgramLogging`
  - lines 98-101, the end of `setCache` and the `// ---- completion checkbox` header
  - lines 110-114, the start of `setCompletion`
  - lines 191-199, `setDayCompletion`
  - lines 232-242, the start of `logSet`, and line 271, its deps
  - lines 290-293, the start of `return {`

  Do not touch `fetchLog` or `rowsOrEmpty` (lines 37-74); another session just reworked them. Every edit below matches exact text, so line shifts don't matter.

**Interfaces:**
- Consumes: `weekLock` and `WeekLock` from `src/utils/program.ts` (Task 2); `useToday` from `src/lib/today.ts` (Task 3); `Program.lock_future_weeks` (Task 1).
- Produces:
  - `useProgramLogging(program)` also returns `lockOf(week: number): WeekLock | null`, keyed on `useToday()`, for rendering. It returns `null` when `program` is `null` or the flag is off.
  - `setCompletion` (check and uncheck), `setDayCompletion` and `logSet` return early, with no cache write and no `enqueue`, when `weekLock(program, week, new Date()) != null`. The check reads the clock at call time.
  - Every other return field is unchanged. `deleteSet` gets no guard (no callers outside the hook).

- [ ] **Step 1: Preflight: make sure no other edits are pending on the file**

The `fetchLog` session (task_93390f2f) has finished; its commits `3a2f84d` and `bf56823` are on `main`. Check that nothing else is editing the file:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/hooks/use-program-logging.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app log -3 --oneline -- src/hooks/use-program-logging.ts
```

Expected: the second command prints nothing. If it lists the file, the other session's edits are still uncommitted: stop and ask (a `git add` here would sweep them into this commit). If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`; otherwise don't pull or stash. Then read the whole of `src/hooks/use-program-logging.ts` again. If any find text below no longer matches exactly once, stop and ask; never edit `fetchLog` or `rowsOrEmpty` to make an anchor fit.

- [ ] **Step 2: Add the imports**

Replace:

```ts
import { qk } from "@/src/lib/query-keys";
import { useCelebration } from "@/src/providers/celebration-context";
```

With:

```ts
import { qk } from "@/src/lib/query-keys";
import { useToday } from "@/src/lib/today";
import { useCelebration } from "@/src/providers/celebration-context";
```

Replace:

```ts
import { toDateKey } from "@/src/utils/dates";
import { supabase } from "@/src/utils/supabase";
```

With:

```ts
import { toDateKey } from "@/src/utils/dates";
import { weekLock } from "@/src/utils/program";
import { supabase } from "@/src/utils/supabase";
```

- [ ] **Step 3: Add the call-time guard helper above the hook**

Replace:

```ts
export function useProgramLogging(program: ProgramWithDetails | null) {
```

With:

```ts
// The backstop behind every screen for "Solo semana actual": a write to a
// locked week is dropped here, however the call got in. Reads the clock at
// call time, not the day the screen last rendered.
function lockedNow(program: ProgramWithDetails | null, week: number): boolean {
  return program != null && weekLock(program, week, new Date()) != null;
}

export function useProgramLogging(program: ProgramWithDetails | null) {
```

- [ ] **Step 4: Add `lockOf` (render-time, keyed on the fresh day) and return it**

Replace:

```ts
    [queryClient, key],
  );

  // ---- completion checkbox --------------------------------------------------
```

With:

```ts
    [queryClient, key],
  );

  // ---- week lock ("Solo semana actual") -------------------------------------
  // For rendering. Keyed on the fresh day (src/lib/today), so a week that
  // opens at midnight, or while the app sat in the background, unlocks on
  // every screen that asks.
  const today = useToday();
  /** Why the week is view only, or null when the client may log it. */
  const lockOf = useCallback(
    (week: number) => (program != null ? weekLock(program, week, today) : null),
    [program, today],
  );

  // ---- completion checkbox --------------------------------------------------
```

Replace:

```ts
    setLogs: data.setLogs,
    isDone,
```

With:

```ts
    setLogs: data.setLogs,
    lockOf,
    isDone,
```

- [ ] **Step 5: Guard `setCompletion` (check and uncheck)**

Replace:

```ts
  /** Check or uncheck one exercise. A check-off that finishes its whole day
      for the week sets off the day-complete celebration. */
  const setCompletion = useCallback(
    async (exerciseId: string, week: number, done: boolean) => {
      const existing = completionOf(exerciseId, week);
```

With:

```ts
  /** Check or uncheck one exercise. A check-off that finishes its whole day
      for the week sets off the day-complete celebration. A locked week
      changes nothing, either way. */
  const setCompletion = useCallback(
    async (exerciseId: string, week: number, done: boolean) => {
      if (lockedNow(program, week)) return;
      const existing = completionOf(exerciseId, week);
```

(`program` is already in this callback's deps, `[completionOf, setCache, user, program, queryClient, key, celebration]`. Leave them as they are.)

- [ ] **Step 6: Guard `setDayCompletion`**

Replace:

```ts
    async (day: ProgramDayWithExercises, week: number, done: boolean) => {
      for (const ex of day.program_exercises) {
        await setCompletion(ex.id, week, done);
      }
    },
    [setCompletion],
  );
```

With:

```ts
    async (day: ProgramDayWithExercises, week: number, done: boolean) => {
      // Up front as well as in each setCompletion: a locked day returns at once.
      if (lockedNow(program, week)) return;
      for (const ex of day.program_exercises) {
        await setCompletion(ex.id, week, done);
      }
    },
    [setCompletion, program],
  );
```

- [ ] **Step 7: Guard `logSet`**

Replace:

```ts
      "checkbox + optional sets" model). */
  const logSet = useCallback(
    async (
      exerciseId: string,
      week: number,
      setIndex: number,
      input: SetInput,
    ) => {
      const existing = setsFor(exerciseId, week).find(
```

With:

```ts
      "checkbox + optional sets" model). A locked week logs nothing. */
  const logSet = useCallback(
    async (
      exerciseId: string,
      week: number,
      setIndex: number,
      input: SetInput,
    ) => {
      if (lockedNow(program, week)) return;
      const existing = setsFor(exerciseId, week).find(
```

Replace:

```ts
    [setsFor, setCache, user],
  );
```

With:

```ts
    [setsFor, setCache, user, program],
  );
```

(`deleteSet` keeps its `[setCache, user]` deps and has no guard: it has no callers outside the hook, and the spec's guard list is `setCompletion`, `setDayCompletion` and `logSet`.)

- [ ] **Step 8: Type-check, lint, unit tests**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`. Expected: no output, exit 0.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint`. Expected: `✖ 3 problems (0 errors, 3 warnings)`, the existing `src/i18n/index.ts` warnings only, with no `react-hooks/exhaustive-deps` warning in `use-program-logging.ts`.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`. Expected: `ℹ tests 29`, `ℹ pass 29`, `ℹ fail 0`.

- [ ] **Step 9: Manual check (web): the backstop drops writes on locked weeks only**

Uses the test program from Task 3 Step 9 (start = today − 8: week 2 is current, week 3 opens on today + 6). If that setup was skipped, do its two USER STEPs first.

1. USER STEP: ask the user to turn the lock on:

   ```sql
   update public.programs set lock_future_weeks = true where id = '<program id>';
   ```

2. Start the web app (`preview_start` `{"name": "web"}`); if the sign-in screen shows, ask the user to sign in as the test client in the Browser pane, then continue. Open `http://localhost:8081/routines`. The lock UI from later tasks isn't there yet, so controls still press but do nothing on a locked week. Watch requests with `read_network_requests` (urlPattern `program_exercise_completions`, then `workout_set_logs`).
   - **Sem 2 (the «Actual» chip):** tap an exercise circle. It checks, and tapping again unchecks it, as before. Requests to `program_exercise_completions` appear.
   - **Sem 3:** tap an exercise circle: it stays empty. Tap the day's «0/n» pill: it stays «0/n». Open an exercise and tap «Marcar hecho»: nothing changes. Type a weight and reps into set 1, tab out, then close and reopen the sheet: set 1 is empty. Through all of this, no new requests to `program_exercise_completions` or `workout_set_logs`.
   - **Sem 1 (past):** tapping an exercise circle checks it, and a `program_exercise_completions` request appears. Uncheck it again.

3. USER STEP: ask the user to run `update public.programs set lock_future_weeks = false where id = '<program id>';`. Within a few seconds (realtime refetch), tapping a Sem 3 exercise circle checks it and a `program_exercise_completions` request appears. Uncheck it again.

4. USER STEP: ask the user to turn the lock back on (`update public.programs set lock_future_weeks = true where id = '<program id>';`). Tasks 5-7 start from this state.

- [ ] **Step 10: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/hooks/use-program-logging.ts
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly `src/hooks/use-program-logging.ts`. Also run `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached -- src/hooks/use-program-logging.ts` and confirm no hunk touches `fetchLog` or `rowsOrEmpty`.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): drop logging writes on locked weeks, expose lockOf" -m "setCompletion (check and uncheck), setDayCompletion and logSet return without a cache write or outbox op when weekLock says the week is locked, read at call time. lockOf(week) is keyed on the fresh day for screens." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Lock copy, LockNote and the Programa tab

**Files:**
- Modify: `src/i18n/es.ts` (program section, anchor line 354 `demoFullScreen`)
- Modify: `src/i18n/en.ts` (program section, anchor line 354 `demoFullScreen`)
- Create: `src/utils/dates.test.ts`
- Modify: `src/utils/dates.ts` (append after `formatDayLabel`, which ends at line 42)
- Create: `src/components/program/lock-note.tsx`
- Modify: `src/components/program/program-exercise-row.tsx` (Props lines 29-31, destructure lines 47-51, line 241, `DoneCheckbox` lines 247-299)
- Modify: `src/components/program/program-view.tsx` (lines 5-6, 48-49, 95-96, 157-159, 168-169, 206-215, 257-269, 319-322)

**Interfaces:**
- Consumes: `WeekLock` from `src/utils/program.ts` (Task 2); `useProgramLogging(program).lockOf(week): WeekLock | null` (Task 4); the `npm test` harness (Task 2).
- Produces:
  - i18n keys `program.lockedStart`, `program.lockedWeek`, `program.nextWeekOpens`, `program.lockedA11y` (es and en).
  - `formatShortDate(key: string, lang: string): string` in `src/utils/dates.ts`.
  - `lockText(lock: WeekLock, t, lang): string`, `LockLine({ text, className? })` and `LockNote({ lock, className? })` in `src/components/program/lock-note.tsx`.
  - `DoneCheckbox` and `ProgramExerciseRow` get an optional `locked?: boolean` (default `false`).

**Free programs** (`lock_future_weeks = false`): `lockOf` always returns `null`. So `lock == null`, `locked === false`, no LockNote appears, and the header's before-start hint shows exactly as today. Every changed control renders and behaves as before.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/i18n/es.ts src/i18n/en.ts src/utils/dates.ts src/utils/dates.test.ts src/components/program/lock-note.tsx src/components/program/program-exercise-row.tsx src/components/program/program-view.tsx
```

Expected: the second command prints nothing. If it lists anything (for example another session's uncommitted strings in `es.ts`/`en.ts`), don't edit: stop and ask, or this task's `git add` would sweep in someone else's hunks. If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`; otherwise don't pull or stash. Read every file listed above in full.

- [ ] **Step 2: Add the Spanish copy**

In `src/i18n/es.ts`, find this line (line 354, the last key of `program`):

```ts
    demoFullScreen: "Ver en pantalla completa",
```

Replace it with:

```ts
    demoFullScreen: "Ver en pantalla completa",
    // Solo semana actual (semanas que aún no abren)
    lockedStart: "Tu programa empieza el {{date}}",
    lockedWeek: "Disponible desde el {{date}}",
    nextWeekOpens: "La semana {{n}} se abre el {{date}}",
    lockedA11y: "{{name}}: bloqueado",
```

- [ ] **Step 3: Add the English copy**

In `src/i18n/en.ts`, find this line (line 354):

```ts
    demoFullScreen: "View full screen",
```

Replace it with:

```ts
    demoFullScreen: "View full screen",
    // Current week only (weeks not open yet)
    lockedStart: "Your program starts on {{date}}",
    lockedWeek: "Available from {{date}}",
    nextWeekOpens: "Week {{n}} opens on {{date}}",
    lockedA11y: "{{name}}: locked",
```

- [ ] **Step 4: Write the failing test for `formatShortDate`**

Create `src/utils/dates.test.ts`:

```ts
/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatShortDate } from "./dates";

test("formatShortDate: day and short month in the app language", () => {
  assert.equal(formatShortDate("2026-10-06", "es"), "6 oct");
  assert.equal(formatShortDate("2026-10-06", "en"), "Oct 6");
});

test("formatShortDate: keeps the key's calendar day (no UTC shift)", () => {
  assert.equal(formatShortDate("2026-10-01", "en"), "Oct 1");
  assert.equal(formatShortDate("2026-12-31", "es"), "31 dic");
});
```

(The `/// <reference types="node" />` line loads Node's types for tsc, as in Task 2's test file. Task 2 uses the same triple-slash line; `tsconfig.json` is unchanged.)

- [ ] **Step 5: Run the test and watch it fail**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: `src\utils\dates.test.ts` fails with `SyntaxError: The requested module './dates' does not provide an export named 'formatShortDate'`. Totals: `ℹ tests 30`, `ℹ pass 29`, `ℹ fail 1`.

- [ ] **Step 6: Implement `formatShortDate`**

In `src/utils/dates.ts`, find the end of `formatDayLabel` (lines 38-42):

```ts
  return dateKeyToDate(key).toLocaleDateString(
    lang === "es" ? "es-ES" : "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );
}
```

Replace it with:

```ts
  return dateKeyToDate(key).toLocaleDateString(
    lang === "es" ? "es-ES" : "en-US",
    { weekday: "short", month: "short", day: "numeric" },
  );
}

/** "6 oct" / "Oct 6": day and short month, no weekday or year. */
export function formatShortDate(key: string, lang: string): string {
  return dateKeyToDate(key).toLocaleDateString(
    lang === "es" ? "es-ES" : "en-US",
    { day: "numeric", month: "short" },
  );
}
```

- [ ] **Step 7: Run the test and watch it pass**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`

Expected: `ℹ tests 31`, `ℹ pass 31`, `ℹ fail 0`. (`dateKeyToDate` is anchored at noon, so the result doesn't depend on the zone. Node's ICU prints «6 sept» for September; phones are checked in Task 10 Step 7.)

- [ ] **Step 8: Create the lock note component**

Create `src/components/program/lock-note.tsx`:

```tsx
import { Ionicons } from "@expo/vector-icons";
import type { TFunction } from "i18next";
import React from "react";
import { useTranslation } from "react-i18next";

import { useColors } from "@/src/theme/colors";
import { Text, View } from "@/src/tw";
import { cn } from "@/src/utils/cn";
import { formatShortDate } from "@/src/utils/dates";
import type { WeekLock } from "@/src/utils/program";

// "Solo semana actual": on a program with lock_future_weeks on, a week that
// hasn't opened yet (or every week, before the start) is view only. These
// say so, and when it opens, where a write control would otherwise be.

/** "Tu programa empieza el 1 oct" (before the start) / "Disponible desde el 6 oct". */
export function lockText(lock: WeekLock, t: TFunction, lang: string): string {
  const date = formatShortDate(lock.opensOn, lang);
  return lock.kind === "start"
    ? t("program.lockedStart", { date })
    : t("program.lockedWeek", { date });
}

/** A lock and one line of text on a quiet fill. Display only: taps pass through. */
export function LockLine({ text, className }: { text: string; className?: string }) {
  const colors = useColors();
  return (
    <View
      pointerEvents="none"
      className={cn("flex-row items-center gap-2 rounded-lg bg-surface-elevated px-3 py-2", className)}
    >
      <Ionicons name="lock-closed" size={13} color={colors.contentTertiary} />
      {/* shrink, so a long line wraps inside the row instead of running past it. */}
      <Text className="shrink text-[12px] font-semibold text-content-secondary">{text}</Text>
    </View>
  );
}

/** Why this week can't be checked yet: when it opens, or when the program starts. */
export function LockNote({ lock, className }: { lock: WeekLock; className?: string }) {
  const { t, i18n } = useTranslation();
  return <LockLine text={lockText(lock, t, i18n.language)} className={className} />;
}
```

- [ ] **Step 9: Give `DoneCheckbox` a locked state**

In `src/components/program/program-exercise-row.tsx`, find the doc comment and signature (lines 247-263):

```tsx
/**
 * The completion check. Checking it off is the moment the client finished an
 * exercise, so it answers with a pop, impact lines and a haptic; unchecking
 * stays quiet. Shared with the home card's rows.
 */
export function DoneCheckbox({
  done,
  name,
  onToggle,
  className = "mt-0.5",
}: {
  done: boolean;
  name: string;
  onToggle: () => void;
  /** Placement of the 24px check (margins). */
  className?: string;
}) {
```

Replace it with:

```tsx
/**
 * The completion check. Checking it off is the moment the client finished an
 * exercise, so it answers with a pop, impact lines and a haptic; unchecking
 * stays quiet. Shared with the home card's rows. Locked (a week that isn't
 * open yet, "Solo semana actual"), it can't be pressed: an empty check shows
 * a lock, and one made before the lock came on stays, faded.
 */
export function DoneCheckbox({
  done,
  name,
  onToggle,
  locked = false,
  className = "mt-0.5",
}: {
  done: boolean;
  name: string;
  onToggle: () => void;
  /** The week isn't open yet: shown, not pressable. */
  locked?: boolean;
  /** Placement of the 24px check (margins). */
  className?: string;
}) {
```

In the same function, find the check's `Pressable` (lines 282-295):

```tsx
        <Pressable
          onPress={onPress}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done }}
          accessibilityLabel={t(done ? "program.markUndone" : "program.markDone", { name })}
          hitSlop={8}
          className={
            done
              ? "h-6 w-6 items-center justify-center rounded-full bg-success"
              : "h-6 w-6 items-center justify-center rounded-full border-2 border-border-strong"
          }
        >
          {done && <Ionicons name="checkmark" size={15} color={colors.white} />}
        </Pressable>
```

Replace it with:

```tsx
        <Pressable
          onPress={onPress}
          disabled={locked}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: done, disabled: locked }}
          accessibilityLabel={
            locked
              ? t("program.lockedA11y", { name })
              : t(done ? "program.markUndone" : "program.markDone", { name })
          }
          hitSlop={8}
          className={
            done
              ? "h-6 w-6 items-center justify-center rounded-full bg-success"
              : locked
                ? "h-6 w-6 items-center justify-center rounded-full bg-surface-elevated"
                : "h-6 w-6 items-center justify-center rounded-full border-2 border-border-strong"
          }
          style={locked && done ? { opacity: 0.5 } : undefined}
        >
          {done && <Ionicons name="checkmark" size={15} color={colors.white} />}
          {!done && locked && <Ionicons name="lock-closed" size={12} color={colors.contentMuted} />}
        </Pressable>
```

Free programs: `locked` defaults to `false`, so the classes, label, icon and press behave as before (no `style`).

- [ ] **Step 10: Pass `locked` through `ProgramExerciseRow`**

In the same file, find the Props entries (lines 29-31):

```tsx
  /** Phase 3 completion checkbox. */
  done?: boolean;
  onToggleDone?: () => void;
```

Replace them with:

```tsx
  /** Phase 3 completion checkbox. */
  done?: boolean;
  onToggleDone?: () => void;
  /** "Solo semana actual": the viewed week isn't open yet, so the checkbox
      shows a lock and can't be pressed. Never set for free programs. */
  locked?: boolean;
```

Find the destructure (lines 47-51):

```tsx
  done = false,
  onToggleDone,
  onOpen,
  loggedCount = 0,
}: Props) {
```

Replace it with:

```tsx
  done = false,
  onToggleDone,
  locked = false,
  onOpen,
  loggedCount = 0,
}: Props) {
```

Find line 241:

```tsx
        <DoneCheckbox done={done} name={p.name} onToggle={onToggleDone} />
```

Replace it with:

```tsx
        <DoneCheckbox done={done} name={p.name} onToggle={onToggleDone} locked={locked} />
```

- [ ] **Step 11: Programa tab: the week's lock and its note**

In `src/components/program/program-view.tsx`, find the imports (lines 5-6):

```tsx
import { ExerciseVideoModal } from "@/src/components/exercise-video-modal";
import { ProgramExerciseRow } from "@/src/components/program/program-exercise-row";
```

Replace them with:

```tsx
import { ExerciseVideoModal } from "@/src/components/exercise-video-modal";
import { LockNote } from "@/src/components/program/lock-note";
import { ProgramExerciseRow } from "@/src/components/program/program-exercise-row";
```

Find lines 48-49:

```tsx
  const logging = useProgramLogging(program);
  // The exercise sheet lives in the tabs layout (ExerciseSessionHost) so an
```

Replace them with:

```tsx
  const logging = useProgramLogging(program);
  // "Solo semana actual": the selected week is view only until it opens (or
  // until the program starts). Always null for free programs.
  const lock = logging.lockOf(selectedWeek);
  // The exercise sheet lives in the tabs layout (ExerciseSessionHost) so an
```

Find the header's before-start hint (lines 95-96):

```tsx
        {notStarted && (
          <View className="rounded-lg bg-info-soft px-3 py-2">
```

Replace them with:

```tsx
        {/* With the week locked, its lock note below says when it starts. */}
        {notStarted && lock == null && (
          <View className="rounded-lg bg-info-soft px-3 py-2">
```

Find the end of the week header block, just before the days (lines 157-159):

```tsx
        )}

        {/* Days */}
```

Replace it with:

```tsx
        )}

        {/* A week that isn't open yet (every week, before the start) is view
            only: say when it opens. */}
        {lock != null && <LockNote lock={lock} />}

        {/* Days */}
```

Free programs: `lock` is `null`. The blue «Este bloque inicia el …» hint shows before the start as today, and no note is added.

- [ ] **Step 12: Programa tab: lock the day pill and the rows**

In the same file, find the `DayCard` element's props (lines 168-169):

```tsx
            logging={logging}
            manualCollapsed={pins[`${day.id}:${selectedWeek}`] ?? null}
```

Replace them with:

```tsx
            logging={logging}
            locked={lock != null}
            manualCollapsed={pins[`${day.id}:${selectedWeek}`] ?? null}
```

Find the `DayCard` signature (lines 206-215):

```tsx
  logging,
  manualCollapsed,
  onPin,
}: {
  day: ProgramDayWithExercises;
  week: ProgramWeek | null;
  selectedWeek: number;
  onOpenExercise: (exercise: ProgramExercise) => void;
  onPlayVideo: (uri: string) => void;
  logging: ReturnType<typeof useProgramLogging>;
```

Replace it with:

```tsx
  logging,
  locked,
  manualCollapsed,
  onPin,
}: {
  day: ProgramDayWithExercises;
  week: ProgramWeek | null;
  selectedWeek: number;
  onOpenExercise: (exercise: ProgramExercise) => void;
  onPlayVideo: (uri: string) => void;
  logging: ReturnType<typeof useProgramLogging>;
  /** "Solo semana actual": this week isn't open yet, so nothing can be checked. */
  locked: boolean;
```

Find the day pill (lines 257-269):

```tsx
        {/* Day completion: progress + one-tap mark-all toggle. */}
        <Pressable
          onPress={() => logging.setDayCompletion(day, selectedWeek, !allDone)}
          accessibilityRole="button"
          accessibilityLabel={t(allDone ? "program.markDayUndone" : "program.markDayDone")}
          className={
            allDone
              ? "flex-row items-center gap-1 rounded-full bg-success-soft px-2.5 py-1"
              : "flex-row items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1"
          }
        >
          <Ionicons
            name={allDone ? "checkmark-done" : "ellipse-outline"}
```

Replace it with:

```tsx
        {/* Day completion: progress + one-tap mark-all toggle. Locked, it
            still shows the count but can't be pressed. */}
        <Pressable
          onPress={() => logging.setDayCompletion(day, selectedWeek, !allDone)}
          disabled={locked}
          accessibilityRole="button"
          accessibilityState={{ disabled: locked }}
          accessibilityLabel={t(allDone ? "program.markDayUndone" : "program.markDayDone")}
          className={
            allDone
              ? "flex-row items-center gap-1 rounded-full bg-success-soft px-2.5 py-1"
              : "flex-row items-center gap-1 rounded-full bg-surface-elevated px-2.5 py-1"
          }
        >
          <Ionicons
            name={allDone ? "checkmark-done" : locked ? "lock-closed" : "ellipse-outline"}
```

Find the row's toggle (lines 319-322):

```tsx
              onToggleDone={() =>
                logging.setCompletion(ex.id, selectedWeek, !logging.isDone(ex.id, selectedWeek))
              }
              onOpen={() => onOpenExercise(ex)}
```

Replace it with:

```tsx
              onToggleDone={() =>
                logging.setCompletion(ex.id, selectedWeek, !logging.isDone(ex.id, selectedWeek))
              }
              locked={locked}
              onOpen={() => onOpenExercise(ex)}
```

The row body still opens the exercise sheet on a locked week: opening stays available.

- [ ] **Step 13: Type-check, lint, test**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`. Expected: no output, exit 0.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint`. Expected: `✖ 3 problems (0 errors, 3 warnings)`, the existing `src/i18n/index.ts` warnings only.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`. Expected: `ℹ tests 31`, `ℹ pass 31`, `ℹ fail 0`.

- [ ] **Step 14: Manual check on the web build (note, locked checks and pills, existing progress on a locked week)**

Uses the test program from Task 3 Step 9 with the lock on from Task 4 Step 9: start = today − 8, so Sem 2 is current and Sem 3 opens on today + 6 (for example, if today is 2026-10-06, on «12 oct»).

Start the web app (`preview_start` `{"name": "web"}`); if the sign-in screen shows, ask the user to sign in as the test client in the Browser pane, then continue. Open `http://localhost:8081/routines`.

Expected:
- **Sem 2 (Actual):** no lock note. Checkboxes are empty circles with a border. Checking one works (pop and burst); uncheck it again. `find` "bloqueado" returns no matches.
- **Sem 3:**
  - Under the «SEMANA 3» divider there is a grey note with a lock: «Disponible desde el <today + 6, e.g. 12 oct>».
  - Every exercise check is a grey disc with a small lock, and clicking it does nothing.
  - `find` "bloqueado" returns one checkbox per exercise, named «<exercise>: bloqueado».
  - Each day pill shows a lock and `0/N`, and clicking it does nothing (`aria-disabled="true"`).
  - Tapping a row body still opens the exercise sheet.
- **Sem 1 (past):** open. Checking and unchecking work.
- **Before the start:**
  - USER STEP: `update public.programs set start_date = (now() at time zone 'America/Santo_Domingo')::date + 2 where id = '<program id>';`. The app refetches live.
  - The header has no blue «Este bloque inicia el …» box.
  - Every week shows «Tu programa empieza el <today + 2, e.g. 8 oct>», and all checks are locked.
- **Free program:**
  - USER STEP: `update public.programs set lock_future_weeks = false where id = '<program id>';`.
  - The blue «Este bloque inicia el …» hint is back. No lock notes, and every check and pill in every week works as before.
- **English:**
  - USER STEP: `update public.programs set lock_future_weeks = true, start_date = (now() at time zone 'America/Santo_Domingo')::date - 8 where id = '<program id>';`.
  - Ajustes → Idioma → English. Sem 3 shows «Available from Oct 12» (today + 6). Switch back to Español.
- **Existing progress on a week that becomes locked (Review Focus 1):**
  1. USER STEP: `update public.programs set lock_future_weeks = false where id = '<program id>';`.
  2. On Sem 3: check day 1's first exercise with its circle. Tap day 2's «0/n» pill so every day-2 exercise is done («n/n»). Open day 1's first exercise, type 20 into set 1's weight and 8 into its reps, tab out, and close the sheet. On **Inicio**, note the block-progress percentage on the card.
  3. USER STEP: `update public.programs set lock_future_weeks = true where id = '<program id>';`. Within a few seconds:
     - `javascript_tool`: `[...document.querySelectorAll('[aria-label$=": bloqueado"]')].map((e) => [e.getAttribute("aria-label"), e.getAttribute("aria-checked"), getComputedStyle(e).opacity])`. Day 1's first exercise and every day-2 exercise are listed with `"true"` and `"0.5"` (faded green checks); every other exercise is listed with `"false"` and `"1"`.
     - Clicking day 1's faded check does nothing, and no `program_exercise_completions` request is sent (`read_network_requests`).
     - Day 2's pill shows the double check (`checkmark-done`) and «n/n», has `aria-disabled="true"`, and clicking it does not uncheck anything.
     - The Inicio card's block-progress percentage is the same as in item 2.
  4. Leave these checks and set 1 in place: Task 6 Step 10 checks the sheet on them, then cleans up.

- [ ] **Step 15: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/i18n/es.ts src/i18n/en.ts src/utils/dates.ts src/utils/dates.test.ts src/components/program/lock-note.tsx src/components/program/program-exercise-row.tsx src/components/program/program-view.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly those 7 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): lock note and locked checks on the Programa tab" -m "Solo semana actual: a week that isn't open yet shows when it opens, and its checks and day pills can't be pressed. Copy in es and en; formatShortDate for the dates." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Exercise sheet, set logger and session host

**Files:**
- Modify: `src/components/program/program-set-logger.tsx` (Props lines 26-28, destructure lines 49-51, lines 97-99, SetRow lines 111-121, lines 156-159, lines 182-203)
- Modify: `src/components/program/program-exercise-modal.tsx` (line 18, lines 33-39, lines 51-54, lines 79-86, lines 252-260, lines 336-337, lines 343-398)
- Modify: `src/components/program/exercise-session-host.tsx` (lines 85-89, lines 108-115, lines 125-126, lines 135-150, lines 186-195)

**Interfaces:**
- Consumes: `WeekLock` from `src/utils/program.ts` (Task 2); `useProgramLogging(program).lockOf(week)` (Task 4); `LockNote` from Task 5; the `exerciseSession` store (`src/lib/exercise-session.ts`, unchanged).
- Produces:
  - `ProgramSetLogger` gets an optional `readOnly?: boolean`.
  - `ProgramExerciseModal` gets a required `lock: WeekLock | null`. Its only consumer is `ExerciseSessionHost`, which this task updates.
  - The host gates `onStart`, `finish` and pause/resume on the lock; «Salir» (`onQuit`) always works.
  - `ExerciseSessionBar` (file-private) gets `locked` and `onTogglePause` props.

**Free programs:** `sheetLock` and `activeLock` are always `null`, and `readOnly` is `false`. `togglePause` calls `exerciseSession.togglePause()` as before. The footer's `(timed || lock == null)` is always true, and every button, the clock's pause and the inputs render exactly as today.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/components/program/program-set-logger.tsx src/components/program/program-exercise-modal.tsx src/components/program/exercise-session-host.tsx
```

Expected: the second command prints nothing (else stop and ask). If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`; otherwise don't pull or stash. Read the three files in full.

- [ ] **Step 2: Read-only set logger**

In `src/components/program/program-set-logger.tsx`, find the end of `Props` (lines 26-28):

```tsx
  /** An input got focus (the sheet scrolls it clear of the keyboard). */
  onInputFocus?: () => void;
};
```

Replace it with:

```tsx
  /** An input got focus (the sheet scrolls it clear of the keyboard). */
  onInputFocus?: () => void;
  /** "Solo semana actual": the week isn't open yet, so logged sets show but
      can't be edited. Never set for free programs. */
  readOnly?: boolean;
};
```

Find the destructure (lines 49-51):

```tsx
  onLogSet,
  onInputFocus,
}: Props) {
```

Replace it with:

```tsx
  onLogSet,
  onInputFocus,
  readOnly = false,
}: Props) {
```

Find the `SetRow` element's last props (lines 97-99):

```tsx
          onSave={(input) => onLogSet(i, input)}
          onFocus={onInputFocus}
        />
```

Replace them with:

```tsx
          onSave={(input) => onLogSet(i, input)}
          onFocus={onInputFocus}
          readOnly={readOnly}
        />
```

Find the `SetRow` signature (lines 111-121):

```tsx
  onSave,
  onFocus,
}: {
  index: number;
  unit: "kg" | "lb";
  repPlaceholder: string;
  prescribedRir: string;
  logged: WorkoutSetLog | null;
  onSave: (input: SetInput) => void;
  onFocus?: () => void;
}) {
```

Replace it with:

```tsx
  onSave,
  onFocus,
  readOnly,
}: {
  index: number;
  unit: "kg" | "lb";
  repPlaceholder: string;
  prescribedRir: string;
  logged: WorkoutSetLog | null;
  onSave: (input: SetInput) => void;
  onFocus?: () => void;
  readOnly: boolean;
}) {
```

- [ ] **Step 3: Read-only inputs**

In the same file, find the input classes (lines 156-159):

```tsx
  const inputCls =
    "flex-1 rounded-md bg-surface px-2 py-1.5 text-[13px] text-content-primary border border-border";

  return (
```

Replace them with:

```tsx
  // Read only, the fields sit flat on the card's fill and their values dim:
  // shown, not waiting for input.
  const inputCls = readOnly
    ? "flex-1 rounded-md bg-surface-elevated px-2 py-1.5 text-[13px] text-content-tertiary border border-border"
    : "flex-1 rounded-md bg-surface px-2 py-1.5 text-[13px] text-content-primary border border-border";

  return (
```

Find both `TextInput`s (lines 182-203):

```tsx
      <TextInput
        className={inputCls}
        keyboardType="decimal-pad"
        placeholder="—"
        placeholderTextColor={colors.contentMuted}
        value={weight}
        onChangeText={setWeight}
        onFocus={onFocus}
        onBlur={save}
        returnKeyType="done"
      />
      <TextInput
        className={inputCls}
        keyboardType="number-pad"
        placeholder={repPlaceholder}
        placeholderTextColor={colors.contentMuted}
        value={reps}
        onChangeText={setReps}
        onFocus={onFocus}
        onBlur={save}
        returnKeyType="done"
      />
```

Replace them with:

```tsx
      <TextInput
        className={inputCls}
        keyboardType="decimal-pad"
        placeholder="—"
        placeholderTextColor={colors.contentMuted}
        value={weight}
        onChangeText={setWeight}
        editable={!readOnly}
        onFocus={readOnly ? undefined : onFocus}
        onBlur={readOnly ? undefined : save}
        returnKeyType="done"
      />
      <TextInput
        className={inputCls}
        keyboardType="number-pad"
        placeholder={repPlaceholder}
        placeholderTextColor={colors.contentMuted}
        value={reps}
        onChangeText={setReps}
        editable={!readOnly}
        onFocus={readOnly ? undefined : onFocus}
        onBlur={readOnly ? undefined : save}
        returnKeyType="done"
      />
```

With no `onBlur`, a read-only field never calls `onLogSet`. The logging hook's `logSet` guard (Task 4) stays as the backstop.

- [ ] **Step 4: Sheet: the `lock` prop**

In `src/components/program/program-exercise-modal.tsx`, find line 18:

```tsx
import { RestButton } from "@/src/components/program/program-exercise-row";
```

Replace it with:

```tsx
import { LockNote } from "@/src/components/program/lock-note";
import { RestButton } from "@/src/components/program/program-exercise-row";
```

Find the end of the `@/src/utils/program` import (lines 33-39):

```tsx
  formatReps,
  formatRir,
} from "@/src/utils/program";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** How much of the sheet stays visible above a focused input (about a row). */
```

Replace it with:

```tsx
  formatReps,
  formatRir,
  type WeekLock,
} from "@/src/utils/program";

const TABULAR = { fontVariant: ["tabular-nums" as const] };

/** How much of the sheet stays visible above a focused input (about a row). */
```

Find in `Props` (lines 51-54):

```tsx
  week: ProgramWeek | null;
  weekNumber: number;
  logging: ReturnType<typeof useProgramLogging>;
  /** In progress (timed). False: not started yet, or done (review). */
```

Replace it with:

```tsx
  week: ProgramWeek | null;
  weekNumber: number;
  /** "Solo semana actual": set while the week isn't open yet, and the sheet
      is view only. Always null for free programs. */
  lock: WeekLock | null;
  logging: ReturnType<typeof useProgramLogging>;
  /** In progress (timed). False: not started yet, or done (review). */
```

Find the end of the doc comment and the start of the destructure (lines 79-86):

```tsx
 *  - done: review, with the done toggle.
 * State lives in `@/src/lib/exercise-session`; this only renders it.
 */
export function ProgramExerciseModal({
  exercise,
  week,
  weekNumber,
  logging,
```

Replace it with:

```tsx
 *  - done: review, with the done toggle.
 * On a locked week ("Solo semana actual") it is view only: a note says when
 * the week opens in place of the done/start buttons, the sets can't be
 * edited, and a clock already running on it can only be quit.
 * State lives in `@/src/lib/exercise-session`; this only renders it.
 */
export function ProgramExerciseModal({
  exercise,
  week,
  weekNumber,
  lock,
  logging,
```

- [ ] **Step 5: Sheet: no pause on a locked week, read-only sets**

In the same file, find the clock's pause button (lines 252-260):

```tsx
                  <Pressable
                    onPress={onTogglePause}
                    accessibilityRole="button"
                    accessibilityLabel={t(running ? "program.sessionPause" : "program.sessionResume")}
                    hitSlop={6}
                    className="h-12 w-12 items-center justify-center rounded-full border-2 border-border-strong"
                  >
                    <Ionicons name={running ? "pause" : "play"} size={20} color={colors.contentPrimary} />
                  </Pressable>
```

Replace it with:

```tsx
                  {/* No pause/resume on a locked week: the clock can only be quit. */}
                  {lock == null && (
                    <Pressable
                      onPress={onTogglePause}
                      accessibilityRole="button"
                      accessibilityLabel={t(running ? "program.sessionPause" : "program.sessionResume")}
                      hitSlop={6}
                      className="h-12 w-12 items-center justify-center rounded-full border-2 border-border-strong"
                    >
                      <Ionicons name={running ? "pause" : "play"} size={20} color={colors.contentPrimary} />
                    </Pressable>
                  )}
```

Find the end of the `ProgramSetLogger` element (lines 336-337):

```tsx
                  onInputFocus={revealFocused}
                />
```

Replace it with:

```tsx
                  onInputFocus={revealFocused}
                  readOnly={lock != null}
                />
```

- [ ] **Step 6: Sheet: the footer**

In the same file, find the whole footer row (lines 343-398):

```tsx
              <View className="flex-row gap-3 px-5 pt-2">
                {timed ? (
                  <>
                    <PressableScale
                      scaleTo={0.98}
                      onPress={confirmQuit}
                      accessibilityRole="button"
                      accessibilityLabel={t("program.sessionQuit")}
                      className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5"
                    >
                      <Ionicons name="exit-outline" size={19} color={colors.contentSecondary} />
                      <Text className="text-base font-semibold text-content-primary">
                        {t("program.sessionQuit")}
                      </Text>
                    </PressableScale>
                    <DoneButton
                      done={false}
                      label={t("program.sessionFinish")}
                      settleMs={FINISH_SETTLE_MS}
                      onPress={onFinish}
                      className="flex-[2]"
                    />
                  </>
                ) : done ? (
                  <DoneButton
                    done
                    onPress={() => void logging.setCompletion(exercise.id, weekNumber, false)}
                    className="flex-1"
                  />
                ) : (
                  <>
                    {/* Done without the clock (e.g. trained earlier, logging now). */}
                    <DoneButton
                      done={false}
                      tone="secondary"
                      label={t("program.markDoneShort")}
                      onPress={() => void logging.setCompletion(exercise.id, weekNumber, true)}
                      className="flex-1"
                    />
                    <PressableScale
                      scaleTo={0.98}
                      haptic
                      onPress={onStart}
                      accessibilityRole="button"
                      className="flex-[2] flex-row items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3.5"
                    >
                      <Ionicons name="play" size={18} color={colors.white} />
                      <Text className="text-base font-bold text-white" style={TABULAR}>
                        {elapsedMs >= 1000
                          ? t("program.sessionContinue", { time: clock })
                          : t("program.sessionStart")}
                      </Text>
                    </PressableScale>
                  </>
                )}
              </View>
```

Replace it with:

```tsx
              {/* A locked week: in place of check/undo/start, when it opens.
                  A clock already running on it (the coach switched the lock
                  on, or moved the start) keeps only Salir below. */}
              {lock != null && <LockNote lock={lock} className="mx-5 mt-2 py-3" />}

              {(timed || lock == null) && (
                <View className="flex-row gap-3 px-5 pt-2">
                  {timed ? (
                    <>
                      <PressableScale
                        scaleTo={0.98}
                        onPress={confirmQuit}
                        accessibilityRole="button"
                        accessibilityLabel={t("program.sessionQuit")}
                        className="flex-1 flex-row items-center justify-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3.5"
                      >
                        <Ionicons name="exit-outline" size={19} color={colors.contentSecondary} />
                        <Text className="text-base font-semibold text-content-primary">
                          {t("program.sessionQuit")}
                        </Text>
                      </PressableScale>
                      {lock == null && (
                        <DoneButton
                          done={false}
                          label={t("program.sessionFinish")}
                          settleMs={FINISH_SETTLE_MS}
                          onPress={onFinish}
                          className="flex-[2]"
                        />
                      )}
                    </>
                  ) : done ? (
                    <DoneButton
                      done
                      onPress={() => void logging.setCompletion(exercise.id, weekNumber, false)}
                      className="flex-1"
                    />
                  ) : (
                    <>
                      {/* Done without the clock (e.g. trained earlier, logging now). */}
                      <DoneButton
                        done={false}
                        tone="secondary"
                        label={t("program.markDoneShort")}
                        onPress={() => void logging.setCompletion(exercise.id, weekNumber, true)}
                        className="flex-1"
                      />
                      <PressableScale
                        scaleTo={0.98}
                        haptic
                        onPress={onStart}
                        accessibilityRole="button"
                        className="flex-[2] flex-row items-center justify-center gap-2 rounded-2xl bg-brand-primary px-4 py-3.5"
                      >
                        <Ionicons name="play" size={18} color={colors.white} />
                        <Text className="text-base font-bold text-white" style={TABULAR}>
                          {elapsedMs >= 1000
                            ? t("program.sessionContinue", { time: clock })
                            : t("program.sessionStart")}
                        </Text>
                      </PressableScale>
                    </>
                  )}
                </View>
              )}
```

The inner branches are the same code as before, indented one level deeper. The only change inside is that «Terminar» is wrapped in `lock == null`. `cn` (tailwind-merge) lets `py-3` override LockLine's `py-2`.

- [ ] **Step 7: Host: compute the locks and gate start, finish and pause**

In `src/components/program/exercise-session-host.tsx`, find lines 85-89:

```tsx
      ? effectivePrescription(activeExercise, weekByNumber(program, active.week), active.week).name
      : null;

  const finish = () => {
    if (sheet == null || sheetExercise == null) return;
```

Replace them with:

```tsx
      ? effectivePrescription(activeExercise, weekByNumber(program, active.week), active.week).name
      : null;

  // "Solo semana actual": a week that isn't open yet can't be started,
  // paused, resumed or finished, only quit. Both null for free programs.
  const sheetLock = sheet != null ? logging.lockOf(sheet.week) : null;
  const activeLock = active != null ? logging.lockOf(active.week) : null;
  const togglePause = () => {
    if (activeLock == null) exerciseSession.togglePause();
  };

  const finish = () => {
    if (sheet == null || sheetExercise == null || sheetLock != null) return;
```

Find the modal props (lines 108-115):

```tsx
        weekNumber={sheet?.week ?? 1}
        logging={logging}
        timed={sheetTimed}
        elapsedMs={sheet != null ? elapsedMs(session, sheet.exerciseId, sheet.week, now) : 0}
        running={sheetTimed && running}
        onStart={() => sheet != null && exerciseSession.start(sheet.exerciseId, sheet.week)}
        onHide={exerciseSession.hide}
        onTogglePause={exerciseSession.togglePause}
```

Replace them with:

```tsx
        weekNumber={sheet?.week ?? 1}
        lock={sheetLock}
        logging={logging}
        timed={sheetTimed}
        elapsedMs={sheet != null ? elapsedMs(session, sheet.exerciseId, sheet.week, now) : 0}
        running={sheetTimed && running}
        onStart={() =>
          sheet != null && sheetLock == null && exerciseSession.start(sheet.exerciseId, sheet.week)
        }
        onHide={exerciseSession.hide}
        onTogglePause={togglePause}
```

`onQuit` (line 117) stays ungated: «Salir» always works.

- [ ] **Step 8: Host: the minimized bar**

In the same file, find the bar element's props (lines 125-126):

```tsx
          running={running}
          bottom={tabBarHeight + (rest.running ? REST_BAR_H : 0)}
```

Replace them with:

```tsx
          running={running}
          locked={activeLock != null}
          onTogglePause={togglePause}
          bottom={tabBarHeight + (rest.running ? REST_BAR_H : 0)}
```

Find the bar's doc comment and signature (lines 135-150):

```tsx
/**
 * The exercise in progress, minimized: name, clock and pause. Tap it to
 * reopen the sheet. Floats above the tab bar, and above the rest bar when a
 * rest is running.
 */
function ExerciseSessionBar({
  name,
  clock,
  running,
  bottom,
}: {
  name: string;
  clock: string;
  running: boolean;
  bottom: number;
}) {
```

Replace it with:

```tsx
/**
 * The exercise in progress, minimized: name, clock and pause. Tap it to
 * reopen the sheet. Floats above the tab bar, and above the rest bar when a
 * rest is running. On a locked week a lock takes the pause button's place;
 * the sheet can still quit it.
 */
function ExerciseSessionBar({
  name,
  clock,
  running,
  locked,
  onTogglePause,
  bottom,
}: {
  name: string;
  clock: string;
  running: boolean;
  locked: boolean;
  onTogglePause: () => void;
  bottom: number;
}) {
```

Find the bar's pause button (lines 186-195):

```tsx
        <Pressable
          onPress={exerciseSession.togglePause}
          accessibilityRole="button"
          accessibilityLabel={t(running ? "program.sessionPause" : "program.sessionResume")}
          hitSlop={6}
          className="h-9 w-9 items-center justify-center rounded-full border"
          style={{ borderColor: colors.contentSecondary }}
        >
          <Ionicons name={running ? "pause" : "play"} size={16} color={colors.contentSecondary} />
        </Pressable>
```

Replace it with:

```tsx
        {locked ? (
          <View pointerEvents="none" className="h-9 w-9 items-center justify-center">
            <Ionicons name="lock-closed" size={15} color={colors.contentMuted} />
          </View>
        ) : (
          <Pressable
            onPress={onTogglePause}
            accessibilityRole="button"
            accessibilityLabel={t(running ? "program.sessionPause" : "program.sessionResume")}
            hitSlop={6}
            className="h-9 w-9 items-center justify-center rounded-full border"
            style={{ borderColor: colors.contentSecondary }}
          >
            <Ionicons name={running ? "pause" : "play"} size={16} color={colors.contentSecondary} />
          </Pressable>
        )}
```

`exerciseSession` stays imported: the bar still uses `exerciseSession.expand`.

- [ ] **Step 9: Type-check, lint, test**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`. Expected: no output, exit 0.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint`. Expected: `✖ 3 problems (0 errors, 3 warnings)`, all in `src/i18n/index.ts`.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`. Expected: `ℹ pass 31`, `ℹ fail 0`.

- [ ] **Step 10: Manual check on the web build (view-only sheet, running clock, existing progress)**

Uses the test program (lock on, start = today − 8: Sem 2 current, Sem 3 locked) with the Review Focus 1 data Task 5 Step 14 left on Sem 3. Start the web app; if the sign-in screen shows, ask the user to sign in as the test client in the Browser pane, then continue. Open `http://localhost:8081/routines`. Before any «Salir» below, run `window.confirm = () => true` with `javascript_tool` (on web, «Salir» asks with the browser's confirm after 10 s on the clock, which would stall the Browser pane).

- **Sem 3, open an exercise that isn't checked:**
  - The demo, «Cómo hacerlo», tempo and rest button all show.
  - The footer is only the grey lock note «Disponible desde el <today + 6>». There is no «Marcar hecho» and no «Empezar».
  - Type in a set's weight field: nothing changes.
  - While the sheet is open, `javascript_tool` `document.querySelectorAll('input[readonly]').length` returns 2 × the number of set rows.
- **Sem 3, open day 1's first exercise (checked before the lock, Review Focus 1):** the footer is only the lock note (no green done/undo button); set 1 shows 20 and 8, dimmed, and typing into it changes nothing.
- **Sem 2, open an exercise:** the footer shows «Marcar hecho» and «Empezar», the inputs are editable, and `document.querySelectorAll('input[readonly]').length` returns `0`.
- **A clock running when the lock comes on:**
  1. USER STEP: `update public.programs set lock_future_weeks = false where id = '<program id>';`.
  2. On Sem 3, open an exercise that isn't checked and press «Empezar». The clock runs and the pause button shows.
  3. With the sheet still open, USER STEP: `update public.programs set lock_future_weeks = true where id = '<program id>';`. The app refetches live.
  4. Expected in the sheet: the clock keeps counting and the pause button is gone; the lock note shows, and the only button is a full-width «Salir».
  5. Hide the sheet (chevron). Expected in the bar: the exercise name and clock show; a grey lock sits where pause was, and tapping the lock does nothing.
  6. Tap the bar: the sheet reopens.
  7. Tap «Salir». The sheet closes, the bar disappears, and the exercise is not checked.
- **Free program:** USER STEP `update public.programs set lock_future_weeks = false where id = '<program id>';`. Sem 3's sheet (unchecked exercise) shows «Marcar hecho» and «Empezar». Once started, it shows pause, «Salir» and «Terminar», and the bar shows pause/play. Tap «Salir» to end it.
- **Cleanup (lock still off):** on Sem 3, uncheck day 1's first exercise and tap day 2's pill to uncheck day 2. Set 1's log stays in the test client's history; if the user wants it gone, USER STEP:

  ```sql
  delete from public.workout_set_logs
   where week_number = 3
     and program_exercise_id in (
       select pe.id from public.program_exercises pe
         join public.program_days d on d.id = pe.program_day_id
        where d.program_id = '<program id>');
  ```

- USER STEP: `update public.programs set lock_future_weeks = true where id = '<program id>';` for Task 7.

- [ ] **Step 11: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/components/program/program-set-logger.tsx src/components/program/program-exercise-modal.tsx src/components/program/exercise-session-host.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly those 3 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): view-only exercise sheet on a locked week" -m "Solo semana actual: on a week that isn't open yet the sheet shows when it opens instead of check/undo/start, the sets are read only, and a clock already running can only be quit (no pause, resume or finish, also from the minimized bar)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Home card and day-complete modal

**Files:**
- Modify: `src/components/program/program-home-card.tsx`. Line numbers are as Task 3 leaves the file: imports lines 6 and 17-18, lines 46-47, comment lines 65-66, line 86, line 95, lines 207-215, lines 251-261, line 319.
- Modify: `src/components/program/day-complete-modal.tsx` (lines 34-35, lines 137-145)

**Interfaces:**
- Consumes: the home card's `today` const (`useToday()`) and `autoWeek` from Task 3; `weekOpensOn(startDate, week)` from Task 2; `useProgramLogging(program).lockOf(week)` from Task 4; `LockLine`, `formatShortDate` and `DoneCheckbox`'s `locked` prop from Task 5.
- Produces: no new exports.

**Free programs:** `nextLocked` is always `false` (`lockOf` returns `null`), so the next-week jump runs exactly as today. `locked` and `waitingNextWeek` are `false`, and the modal's `nextWeekLocked` is `false`, so «Siguiente: semana N» shows as before.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short -- src/components/program/program-home-card.tsx src/components/program/day-complete-modal.tsx
```

Expected: the second command prints nothing (else stop and ask). If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase`; otherwise don't pull or stash. Read both files in full. `program-home-card.tsx` must already contain `import { useToday } from "@/src/lib/today";` and `const today = useToday();` (Task 3); if not, stop: Task 3 is missing.

- [ ] **Step 2: Home card imports**

In `src/components/program/program-home-card.tsx`, replace:

```tsx
import { DoneCheckbox } from "@/src/components/program/program-exercise-row";
```

with:

```tsx
import { LockLine } from "@/src/components/program/lock-note";
import { DoneCheckbox } from "@/src/components/program/program-exercise-row";
```

Then replace:

```tsx
import { dayLabel } from "@/src/utils/day-label";
import { currentWeekOf, effectivePrescription, formatReps, weekByNumber } from "@/src/utils/program";
```

with:

```tsx
import { formatShortDate } from "@/src/utils/dates";
import { dayLabel } from "@/src/utils/day-label";
import {
  currentWeekOf,
  effectivePrescription,
  formatReps,
  weekByNumber,
  weekOpensOn,
} from "@/src/utils/program";
```

(`useToday` is already imported by Task 3.)

- [ ] **Step 3: Home card: whether next week is closed**

In the same file, replace (lines 46-47):

```tsx
  const autoWeek = currentWeekOf(program.start_date, program.duration_weeks, today);
  const logging = useProgramLogging(program);
```

with:

```tsx
  const autoWeek = currentWeekOf(program.start_date, program.duration_weeks, today);
  const logging = useProgramLogging(program);
  // "Solo semana actual": next week still closed. Always false for free
  // programs (lockOf is null for them) and in the block's last week.
  const nextLocked = autoWeek < program.duration_weeks && logging.lockOf(autoWeek + 1) != null;
```

- [ ] **Step 4: Home card: stay on the week while next week is locked**

In the same file, replace the comment lines (65-66):

```tsx
  // not-fully-done day of the current week, advancing to next week once the
  // whole week is cleared. Falls back to the last day when the block is done.
```

with:

```tsx
  // not-fully-done day of the current week, advancing to next week once the
  // whole week is cleared, unless next week is still locked: then the card
  // stays on this week and says when the next one opens. Falls back to the
  // last day when the block is done.
```

Replace line 86:

```tsx
    if (day == null && autoWeek < program.duration_weeks) {
```

with:

```tsx
    if (day == null && autoWeek < program.duration_weeks && !nextLocked) {
```

Replace line 95:

```tsx
  const week = weekByNumber(program, displayWeek);
```

with:

```tsx
  const week = weekByNumber(program, displayWeek);
  // The shown week isn't open (only before the start, since the card never
  // moves into a locked week): its checkboxes show a lock.
  const locked = logging.lockOf(displayWeek) != null;
  // This week is all done and next week is still closed.
  const waitingNextWeek = nextLocked && days.every((d) => !pending(d, autoWeek));
```

When the week is done and next week is locked, `day` stays `null` after the skipped jump. The existing fallback then sets `displayWeek = autoWeek` and shows the last day.

- [ ] **Step 5: Home card: locked rows and the "opens on" line**

In the same file, find the end of the rows (lines 207-215):

```tsx
                    onPress={() => exerciseSession.open(ex.id, displayWeek)}
                    onToggleDone={() =>
                      logging.setCompletion(ex.id, displayWeek, !logging.isDone(ex.id, displayWeek))
                    }
                  />
                ))}
              </View>
            </>
          )}
```

Replace it with:

```tsx
                    onPress={() => exerciseSession.open(ex.id, displayWeek)}
                    onToggleDone={() =>
                      logging.setCompletion(ex.id, displayWeek, !logging.isDone(ex.id, displayWeek))
                    }
                    locked={locked}
                  />
                ))}
              </View>
            </>
          )}

          {/* In place of jumping ahead: when next week opens. */}
          {waitingNextWeek && (
            <LockLine
              text={t("program.nextWeekOpens", {
                n: autoWeek + 1,
                date: formatShortDate(weekOpensOn(program.start_date, autoWeek + 1), i18n.language),
              })}
            />
          )}
```

`LockLine` is `pointerEvents="none"`, so a tap on it reaches the card's tap target. The date is week n+1's own opening date, not `lockOf(...).opensOn`: before the start, that lock only carries `start_date`.

Find `ExerciseMiniRow`'s signature (lines 251-261):

```tsx
  done,
  onPress,
  onToggleDone,
}: {
  exercise: ProgramExercise;
  week: ProgramWeek | null;
  weekNumber: number;
  done: boolean;
  onPress: () => void;
  onToggleDone: () => void;
}) {
```

Replace it with:

```tsx
  done,
  onPress,
  onToggleDone,
  locked,
}: {
  exercise: ProgramExercise;
  week: ProgramWeek | null;
  weekNumber: number;
  done: boolean;
  onPress: () => void;
  onToggleDone: () => void;
  /** The week isn't open yet: the checkbox shows a lock. */
  locked: boolean;
}) {
```

Find line 319:

```tsx
      <DoneCheckbox done={done} name={p.name} onToggle={onToggleDone} className="" />
```

Replace it with:

```tsx
      <DoneCheckbox done={done} name={p.name} onToggle={onToggleDone} locked={locked} className="" />
```

- [ ] **Step 6: Day-complete modal: the "next" line**

In `src/components/program/day-complete-modal.tsx`, find lines 34-35:

```tsx
import { dayLabel } from "@/src/utils/day-label";
import { effectivePrescription, weekByNumber } from "@/src/utils/program";
```

Replace them with:

```tsx
import { formatShortDate } from "@/src/utils/dates";
import { dayLabel } from "@/src/utils/day-label";
import { effectivePrescription, weekByNumber, weekOpensOn } from "@/src/utils/program";
```

Find lines 137-145:

```tsx
  const nextTitle = next != null ? dayTitle(next, t) : null;
  const nextLine =
    next != null
      ? nextTitle != null
        ? t("program.dayDoneNext", { n: next.day_index, label: nextTitle })
        : t("program.dayDoneNextBare", { n: next.day_index })
      : week < program.duration_weeks
        ? t("program.dayDoneNextWeek", { n: week + 1 })
        : t("program.dayDoneBlock");
```

Replace them with:

```tsx
  const nextTitle = next != null ? dayTitle(next, t) : null;
  // "Solo semana actual": with the week done and the next one still closed,
  // say when it opens instead of pointing at it. Its own opening date, not
  // the lock's (before the start, the lock only knows the start date).
  // Always false for free programs.
  const nextWeekLocked = week < program.duration_weeks && logging.lockOf(week + 1) != null;
  const nextLine =
    next != null
      ? nextTitle != null
        ? t("program.dayDoneNext", { n: next.day_index, label: nextTitle })
        : t("program.dayDoneNextBare", { n: next.day_index })
      : week < program.duration_weeks
        ? nextWeekLocked
          ? t("program.nextWeekOpens", {
              n: week + 1,
              date: formatShortDate(weekOpensOn(program.start_date, week + 1), i18n.language),
            })
          : t("program.dayDoneNextWeek", { n: week + 1 })
        : t("program.dayDoneBlock");
```

(`i18n` is already in scope from line 58, `const { t, i18n } = useTranslation();`. `logging` is `useProgramLogging(program)` on the celebration's program, line 64. `lockOf` is a plain function, so calling it after the `if (day == null) return null;` on line 115 is fine.)

- [ ] **Step 7: Type-check, lint, test**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit`. Expected: no output, exit 0.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm run lint`. Expected: `✖ 3 problems (0 errors, 3 warnings)`, all in `src/i18n/index.ts`.
Run: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm test`. Expected: `ℹ pass 31`, `ℹ fail 0`.

- [ ] **Step 8: Manual check on the web build (home card, modal, the week opening live, weekday card)**

Uses the test program (lock on, start = today − 8: week 2 current, week 3 opens on today + 6, call that date `OPENS` as `YYYY-MM-DD`). Start the web app; if the sign-in screen shows, ask the user to sign in as the test client in the Browser pane, then continue. Keep the Browser pane displayed (`document.visibilityState` must be `"visible"`).

- **A. Finish week 2 (modal line):** on `http://localhost:8081/routines` → Sem 2, tap each day's `0/N` pill until every day of week 2 is done. When the last day completes, the «Completado» modal shows «Semana 2 completa». Its last line is «La semana 3 se abre el <OPENS, e.g. 12 oct>», not «Siguiente: semana 3». Close it with «Listo».
- **B. Home card after week 2** (`http://localhost:8081/`): the card reads «SEMANA 2 DE T»; it shows the last day of week 2, all checked; under the rows is a grey lock line «La semana 3 se abre el <OPENS>»; tapping the line opens the Programa tab (the card's tap target).
- **C. Week 3 opens at midnight with the screen open (Review Focus 2):**
  1. On `/routines`, tap Sem 3: the note «Disponible desde el <OPENS>» shows and the checks are «…: bloqueado».
  2. Run the helper script from Task 3 Step 9 with `javascript_tool` (it's gone after any reload), then `__shiftTo("<OPENS>", -5000)`.
  3. Expected, with no reload and no tap, within about 6 s: the header changes to «Semana 3 de T» and the lock note disappears; `javascript_tool` `[...document.querySelectorAll('[role="checkbox"]')].map((e) => e.getAttribute("aria-label"))` lists «Marcar <name> como hecho» entries and no «…: bloqueado».
  4. Click one Sem 3 exercise circle: it checks, and `read_network_requests` (urlPattern `program_exercise_completions`) shows a new request. If that finishes its day, close the «Completado» modal with «Listo». Click the circle again right away to uncheck it (while the clock is still shifted; once it's restored, week 3 is locked again).
  5. Open **Inicio**: the card reads «SEMANA 3 DE T» and shows week 3's first day; the lock line is gone.
  6. Run `__unshift()`: Sem 3 is locked again (note back), and the card is back on week 2 with its lock line.
- **D. Returning to the app after the day changed:** run `__shiftTo("<OPENS>", 12 * 3600 * 1000)` (noon of that day; the helper's visibilitychange is the "back in the foreground" signal). Expected: within a second, with no 6 s wait, Sem 3 is open as in C.3. Run `__unshift()`.
- **E. Free program:**
  - USER STEP: `update public.programs set lock_future_weeks = false where id = '<program id>';`.
  - The home card jumps to «SEMANA 3 DE T» with week 3's first pending day and no lock line.
  - On Sem 2, uncheck one exercise of the last day and check it again. The modal's last line is «Siguiente: semana 3». Close it with «Listo».
- **F. Weekday home card (flag off; `dow` now comes from `useToday()`):**
  1. USER STEP: ask the user to run and paste `select id, day_index, weekday from public.program_days where program_id = '<program id>' order by day_index;`. Record the last row's `id` and `weekday` (to restore).
  2. USER STEP:

     ```sql
     update public.program_days
        set weekday = to_char(now() at time zone 'America/Santo_Domingo', 'FMday')
      where id = '<last day id>';
     -- programs is on realtime, program_days is not: touch the parent so the app refetches.
     update public.programs set updated_at = now() where id = '<program id>';
     ```

  3. On Sem 2, tap each done day's pill to uncheck every day of week 2.
  4. Expected on Inicio: «SEMANA 2 DE T» showing the day that carries today's weekday (the last day, unless an earlier day already had today's weekday in item 1), not day 1.
  5. USER STEP: restore it (use `null` if the saved weekday was null):

     ```sql
     update public.program_days set weekday = <saved weekday, quoted, or null> where id = '<last day id>';
     update public.programs set updated_at = now() where id = '<program id>';
     ```

- **G. Before the start, lock on:**
  - USER STEP: `update public.programs set lock_future_weeks = true, start_date = (now() at time zone 'America/Santo_Domingo')::date + 2 where id = '<program id>';`.
  - The home card shows «EMPIEZA · <date>» and week 1's first day.
  - Every row's check is a grey disc with a lock. Clicking it does nothing. `find` "bloqueado" matches those checkboxes.
  - Clicking a row still opens its sheet, view only (Task 6).
- **H. Before the start, free program:**
  - USER STEP: `update public.programs set lock_future_weeks = false where id = '<program id>';`.
  - The home card's checks are normal circles and check off as before. Uncheck anything you checked.

Cleanup: USER STEP: restore the saved row from Task 3 Step 9, `update public.programs set start_date = '<saved start_date>', lock_future_weeks = <saved lock_future_weeks> where id = '<program id>';`. Reload the page to drop the clock helpers.

- [ ] **Step 9: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app add src/components/program/program-home-card.tsx src/components/program/day-complete-modal.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app diff --cached --name-only
```

Expected: exactly those 2 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app commit -m "feat(program): home card and day-complete stay on the open week" -m "Solo semana actual: with the week done and the next one still closed, the home card stays on this week and the day-complete modal says when the next week opens; before the start the card's checks are locked." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Panel: «Solo semana actual» switch in the builder, saved with the program

**Files:**
- Create: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\components\program\LockFutureWeeksSwitch.tsx`
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\services\programs.ts` (`SaveProgramInput` lines 175–187, `saveCoachProgram` `p_header` lines 202–212)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\components\program\builderModel.ts` (`DraftData` lines 193–205, `HeaderFields` lines 389–399, `buildPayload` return at line 457)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\components\program\useProgramBuilder.ts` (`baselineDraft` line 36, restore lines 77–84, state line 97, autosave lines 120–142, `header` lines 167–177, `replaceDraft` line 193, return lines 315–318)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\components\program\ProgramWorkspace.tsx` (imports lines 29–30, `detailsOpen` lines 108–110, Descripción/Notas lines 483–486)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\components\program\LegacyProgramBuilder.tsx` (import line 23, destructure lines 205–208, Datos step lines 369–373, Revisar lines 727–729)

**Interfaces:**
- Consumes: `Program.lock_future_weeks: boolean` in the panel's `src/types.ts` (Task 1 Step 8); `save_coach_program` reading `p_header->>'lock_future_weeks'` (Task 1 migration: INSERT `coalesce(…, false)`, UPDATE `coalesce(…, lock_future_weeks)`). Before the migration, `save_coach_program` ignores the extra header key (it reads each key by name).
- Produces:
  - `SaveProgramInput.lock_future_weeks: boolean`
  - `DraftData.lockFutureWeeks: boolean` and `HeaderFields.lockFutureWeeks: boolean`
  - `buildPayload(...)` emits `lock_future_weeks`
  - `useProgramBuilder(...)` returns `lockFutureWeeks` and `setLockFutureWeeks` (baseline = `initial.lock_future_weeks ?? false`, autosaved, in `header`, restored by `replaceDraft`)
  - `LockFutureWeeksSwitch({ checked, onCheckedChange, id?, disabled?, className? })`. `disabled` and `className` are optional extras on top of the fixed interface; Task 9 uses `disabled`.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short -- src/services/programs.ts src/components/program
grep -c "lock_future_weeks" C:/Users/Signos/Documents/edwin/hokage-web-panel/src/types.ts
```

Expected: the second command prints nothing (else stop and ask); the `grep -c` prints `1` (Task 1 Step 8 is in; if `0`, stop: Task 1 is missing). If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-web-panel pull --rebase`; otherwise don't pull or stash. Read every file listed above in full.

- [ ] **Step 2: Carry the flag in the save payload**

In `src/services/programs.ts`, `export interface SaveProgramInput` (lines 175–187), replace:

```ts
  tempo_default: string | null;
  notes: string | null;
  days: ProgramDayInput[];
```

with:

```ts
  tempo_default: string | null;
  notes: string | null;
  /** «Solo semana actual» (programs.lock_future_weeks). */
  lock_future_weeks: boolean;
  days: ProgramDayInput[];
```

In the same file, in `saveCoachProgram`, in the `p_header` object (lines 202–212), replace:

```ts
      tempo_default: input.tempo_default,
      notes: input.notes,
    },
```

with:

```ts
      tempo_default: input.tempo_default,
      notes: input.notes,
      lock_future_weeks: input.lock_future_weeks,
    },
```

- [ ] **Step 3: Add the field to the builder model (draft, header, payload)**

In `src/components/program/builderModel.ts`, `export interface DraftData` (lines 193–205), replace:

```ts
  tempoDefault: string;
  notes: string;
  days: DayRow[];
  weeks: WeekRow[];
}
```

with:

```ts
  tempoDefault: string;
  notes: string;
  /** «Solo semana actual». Drafts saved before it existed don't carry it;
   *  useProgramBuilder fills it in when it restores one. */
  lockFutureWeeks: boolean;
  days: DayRow[];
  weeks: WeekRow[];
}
```

In `export interface HeaderFields` (lines 389–399), replace:

```ts
  tempoDefault: string;
  notes: string;
}

/** Builds the save_coach_program payload
```

with:

```ts
  tempoDefault: string;
  notes: string;
  lockFutureWeeks: boolean;
}

/** Builds the save_coach_program payload
```

In `buildPayload`'s `return { … }` (line 457), replace:

```ts
    notes: header.notes.trim() || null,
    days: outDays,
```

with:

```ts
    notes: header.notes.trim() || null,
    lock_future_weeks: header.lockFutureWeeks,
    days: outDays,
```

- [ ] **Step 4: Baseline, and restoring drafts saved before the field existed**

`draftSignature` compares `JSON.stringify` output, so key order matters. `lockFutureWeeks` must come right after `notes` in the baseline, in the autosave object and in `header` (the `snapshot()` spreads `header`). An old `localStorage` draft (`hokage:program-draft:*`) has no `lockFutureWeeks`; it is spread over the baseline, which fills in the field and puts the keys in baseline order. The baseline takes `initial.lock_future_weeks`, so a program or template that is already locked opens equal to `pristine` (Review Focus 5).

In `src/components/program/useProgramBuilder.ts`, in `baselineDraft` (line 36), replace:

```ts
    notes: initial?.notes ?? '',
    days: initial ? daysFrom(initial) : [emptyDay()],
```

with:

```ts
    notes: initial?.notes ?? '',
    lockFutureWeeks: initial?.lock_future_weeks ?? false,
    days: initial ? daysFrom(initial) : [emptyDay()],
```

Replace the `restored` initializer (lines 77–84):

```ts
  const [restored] = useState(() => {
    const r = loadDraft<DraftData>(storageKey);
    if (r && draftSignature(r.data) === pristine) {
      clearDraft(storageKey); // an untouched form saved by an older version
      return null;
    }
    return r;
  });
```

with:

```ts
  const [restored] = useState(() => {
    const r = loadDraft<DraftData>(storageKey);
    if (!r) return null;
    // A draft saved before a field existed (lockFutureWeeks) takes the form's
    // opening value for it. Spreading over the baseline also keeps the keys in
    // baselineDraft's order, which draftSignature compares.
    const data: DraftData = { ...baselineDraft(initial), ...r.data };
    if (draftSignature(data) === pristine) {
      clearDraft(storageKey); // an untouched form saved by an older version
      return null;
    }
    return { ...r, data };
  });
```

(`restored` stays `{ savedAt, data } | null`. The callers only read `restored.savedAt`, `restored?.data` and `restored != null`.)

- [ ] **Step 5: State, autosave, header, replace-draft and the hook's return**

In the same file, replace line 97:

```ts
  const [notes, setNotes] = useState(d?.notes ?? initial?.notes ?? '');
```

with:

```ts
  const [notes, setNotes] = useState(d?.notes ?? initial?.notes ?? '');
  const [lockFutureWeeks, setLockFutureWeeks] = useState(d?.lockFutureWeeks ?? initial?.lock_future_weeks ?? false);
```

In the autosave effect, replace the end of the `data` object (lines 128–132):

```ts
        tempoDefault,
        notes,
        days,
        weeks,
      };
```

with:

```ts
        tempoDefault,
        notes,
        lockFutureWeeks,
        days,
        weeks,
      };
```

Replace the effect's dependency list (line 142):

```ts
  }, [storageKey, pristine, name, focus, description, durationWeeks, startDate, status, progressionRule, tempoDefault, notes, days, weeks]);
```

with:

```ts
  }, [storageKey, pristine, name, focus, description, durationWeeks, startDate, status, progressionRule, tempoDefault, notes, lockFutureWeeks, days, weeks]);
```

Replace the end of `const header = { … }` (lines 175–177):

```ts
    tempoDefault,
    notes,
  };
```

with:

```ts
    tempoDefault,
    notes,
    lockFutureWeeks,
  };
```

In `replaceDraft` (line 193), replace:

```ts
    setNotes(next.notes);
    setDays(next.days);
```

with:

```ts
    setNotes(next.notes);
    setLockFutureWeeks(next.lockFutureWeeks);
    setDays(next.days);
```

In the returned object (lines 315–318), replace:

```ts
    notes,
    setNotes,
    days,
```

with:

```ts
    notes,
    setNotes,
    lockFutureWeeks,
    setLockFutureWeeks,
    days,
```

(The AI dialog builds `after` as `{ ...before, ...next.header, … }`, and `next.header` never includes `lockFutureWeeks`. An AI edit therefore keeps the coach's value, and «Deshacer» (`replaceDraft(before)`) restores it; `AiProgramDialog.tsx` and `aiModel.ts` need no change.)

- [ ] **Step 6: Type-check the model and hook changes**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npx tsc --noEmit`
Expected: no output, exit code 0.

- [ ] **Step 7: Create the shared switch component**

Create `src/components/program/LockFutureWeeksSwitch.tsx`. It follows the «Ciclado por tipo de día» switch in `src/components/nutrition/NutritionPlanBuilder.tsx` (lines 634–651):

```tsx
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/**
 * «Solo semana actual» (programs.lock_future_weeks, migration 20260929120000
 * in the mobile repo): the client can only check trainings of the week they
 * are in and of past weeks. The app enforces it; the database never rejects a
 * write. Shared by both builders and both assign-template dialogs, so the
 * wording is the same everywhere.
 */
export function LockFutureWeeksSwitch({
  checked,
  onCheckedChange,
  id = 'lock-future-weeks',
  disabled,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  /** The assign dialogs keep it off until a template is picked (the template
   *  pre-sets it). */
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3.5', className)}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={`${id}-help`}
      />
      <div className="min-w-0">
        <Label htmlFor={id} className={cn('text-[13px]', disabled && 'opacity-60')}>
          Solo semana actual
        </Label>
        <p id={`${id}-help`} className="mt-0.5 text-[12px] text-faint">
          El cliente solo puede marcar los entrenos de la semana en curso y de semanas pasadas. Las
          siguientes las ve, pero se abren en su fecha. Antes del inicio no puede marcar nada.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Workspace: import, and open Detalles when the switch is on**

In `src/components/program/ProgramWorkspace.tsx`, replace lines 29–30:

```tsx
import { AiResultPanel } from '@/components/program/AiResultPanel';
import type { AiResult } from '@/components/program/aiModel';
```

with:

```tsx
import { AiResultPanel } from '@/components/program/AiResultPanel';
import { LockFutureWeeksSwitch } from '@/components/program/LockFutureWeeksSwitch';
import type { AiResult } from '@/components/program/aiModel';
```

Replace lines 108–110:

```tsx
  const [detailsOpen, setDetailsOpen] = useState(
    !!(props.initial?.progression_rule || props.initial?.tempo_default || props.initial?.description || props.initial?.notes),
  );
```

with:

```tsx
  // Open when something in it is set. «Solo semana actual» counts: it changes
  // what the client can do, so it must not sit behind a closed panel.
  const [detailsOpen, setDetailsOpen] = useState(
    () =>
      b.lockFutureWeeks ||
      !!(props.initial?.progression_rule || props.initial?.tempo_default || props.initial?.description || props.initial?.notes),
  );
```

(`b.lockFutureWeeks` at mount already includes a restored draft, so a recovered draft with the switch on also opens Detalles.)

- [ ] **Step 9: Workspace: the switch in Detalles, as a full row under Inicio · Estado · Descripción**

The Detalles grid is `md:grid-cols-2 xl:grid-cols-3`, and today's field order stays as it is. The switch goes in as a full-width row right after Descripción, so at xl a client program reads Enfoque | Regla | Tempo, then Inicio | Estado | Descripción, then the switch, then Notas; a template (no Inicio/Estado) reads Enfoque | Regla | Tempo, then Descripción, then the switch, then Notas.

In `WorkspaceHeader`, replace (lines 483–486):

```tsx
          <Field id="pw-desc" label="Descripción">
            <Input id="pw-desc" placeholder="Resumen breve del bloque…" value={b.description} onChange={(e) => b.setDescription(e.target.value)} />
          </Field>
          <Field id="pw-notes" label="Notas del programa" className="md:col-span-2 xl:col-span-3">
```

with:

```tsx
          <Field id="pw-desc" label="Descripción">
            <Input id="pw-desc" placeholder="Resumen breve del bloque…" value={b.description} onChange={(e) => b.setDescription(e.target.value)} />
          </Field>
          {/* A full row right under Inicio · Estado · Descripción (under
              Descripción alone for a template). Templates carry it too: the
              assign dialogs pre-set it from the template. */}
          <LockFutureWeeksSwitch
            id="pw-lock"
            className="rounded-none bg-field md:col-span-2 xl:col-span-3"
            checked={b.lockFutureWeeks}
            onCheckedChange={b.setLockFutureWeeks}
          />
          <Field id="pw-notes" label="Notas del programa" className="md:col-span-2 xl:col-span-3">
```

(`cn` uses tailwind-merge, so `rounded-none bg-field` overrides the component's `rounded-xl bg-muted/40` and matches the workspace's square "Dojo" fields; `bg-field` is the workspace's existing field token.)

- [ ] **Step 10: Legacy wizard: switch on the Datos step, mention it on Revisar**

In `src/components/program/LegacyProgramBuilder.tsx`, replace line 23:

```tsx
import { DiscardChangesDialog } from '@/components/program/DiscardChangesDialog';
```

with:

```tsx
import { DiscardChangesDialog } from '@/components/program/DiscardChangesDialog';
import { LockFutureWeeksSwitch } from '@/components/program/LockFutureWeeksSwitch';
```

In the `useProgramBuilder(props)` destructure (lines 205–208), replace:

```tsx
    notes,
    setNotes,
    days,
    setDays,
```

with:

```tsx
    notes,
    setNotes,
    lockFutureWeeks,
    setLockFutureWeeks,
    days,
    setDays,
```

In Step 1 · Datos, after the Duración / Inicio / Estado row (lines 369–373), replace:

```tsx
                </>
              )}
            </div>
            <div>
              <Disclosure
```

with:

```tsx
                </>
              )}
            </div>
            {/* Shown for templates too: the assign dialogs pre-set it from the
                template. */}
            <LockFutureWeeksSwitch id="pb-lock" checked={lockFutureWeeks} onCheckedChange={setLockFutureWeeks} />
            <div>
              <Disclosure
```

In Step 4 · Revisar (lines 727–729), replace:

```tsx
                {weeksN} {weeksN === 1 ? 'semana' : 'semanas'} · inicio {fmtDate(startDate)}
              </div>
```

with:

```tsx
                {weeksN} {weeksN === 1 ? 'semana' : 'semanas'} · inicio {fmtDate(startDate)}
                {lockFutureWeeks && ' · solo semana actual'}
              </div>
```

(Editing a program in the wizard opens straight on Revisar, so this is where the coach sees the flag without going back to Datos. The file's header says "Don't add features here"; the spec requires the switch there, so the change is kept to these two spots.)

- [ ] **Step 11: Build and lint the panel**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npm run build`
Expected: `tsc --noEmit` prints nothing, then Vite ends with `✓ built in …s`, exit code 0. The existing "Some chunks are larger than 500 kB" warning is not an error.

Run: `cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npm run lint`
Expected: only the `> eslint .` banner, no findings, exit code 0.

- [ ] **Step 12: Browser check (needs the migration applied first)**

Prerequisites:
- USER STEP: confirm the migration is applied: `select column_default from information_schema.columns where table_schema = 'public' and table_name = 'programs' and column_name = 'lock_future_weeks';` returns one row, `false`. If not, do Task 1 Steps 4-5 first.
- `C:\Users\Signos\Documents\edwin\hokage-web-panel\.env` must exist (today the repo has only `.env.example`). If it is missing, USER STEP: ask the user to create it with `VITE_SUPABASE_URL=https://rzgwkwxskrovxnnymxqo.supabase.co` and `VITE_SUPABASE_ANON_KEY=<their anon key>`. Don't write the key yourself.

Start the dev server: run `cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npm run dev -- --port 5181 --strictPort` with the Bash tool's `run_in_background`, then `preview_start` with `{"url": "http://localhost:5181"}`. (The app repo's `.claude/launch.json` `coach-panel` entry points at another machine's path and won't start here.) Ask the user to sign in as the coach in the Browser pane, then continue. Use a **test client**: saving an Activo program makes it that client's active program.

1. `/programs` → «Crear programa» → «Detalles». Expected (window ≥ 1280 px): Enfoque | Regla de progresión | Tempo por defecto, then Descripción, then a full-width square box «Solo semana actual» with the help text, then Notas del programa. There is no Inicio or Estado, and the switch is off.
2. Name the template `QA semana actual (plantilla)`, add one exercise from the library (+), turn the switch on and click «Guardar plantilla». Expected: toast «Plantilla guardada».
   - `read_network_requests` with urlPattern `save_coach_program`: the request body's `p_header` contains `"lock_future_weeks":true`.
   - USER STEP: `select is_template, lock_future_weeks from public.programs where name = 'QA semana actual (plantilla)';` returns `true | true`.
3. Edit that template (pencil). Expected: Detalles is already open on load and the switch is on. Turn it off and click «Guardar cambios»; the USER STEP query above returns `lock_future_weeks = false`. Edit again, turn it back on and save, so it is `true`.
4. **A program that is already locked (Review Focus 5):**
   - Before opening it, `javascript_tool`: `Object.keys(localStorage).filter((k) => k.startsWith("hokage:program-draft:"))` and note the list.
   - Edit `QA semana actual (plantilla)` and touch nothing for 2 s. Expected: no «Borrador guardado en este navegador», and the same `localStorage` query returns the same list (no new draft key).
   - Click «Cancelar»: the builder closes without the «¿Descartar los cambios?» dialog.
   - Edit it again. If «Editar con IA» works on this project (it calls the `generate-program` Edge Function): ask for a small change (for example «Añade un ejercicio de core al día 1») and apply it. Expected: the switch stays on. Click «Deshacer» in the AI review panel: the switch is still on. (If the AI isn't configured, skip this bullet and say so in your report.)
   - Click «Guardar cambios». USER STEP: the query from item 2 returns `true | true`.
5. `/clients` → test client → Programas → «Crear programa» → «Detalles». Expected at ≥ 1280 px: row 2 is Inicio | Estado | Descripción (as before), and row 3 is the switch across the full width. Name it `QA semana actual (cliente)`, set Estado to «Archivado» (so the client's active program is untouched), add one exercise, leave the switch off and save. USER STEP: `select lock_future_weeks from public.programs where name = 'QA semana actual (cliente)';` returns `false`.
6. Draft restore: on `/programs`, click «Crear programa», type any name, turn the switch on and wait for «Borrador guardado en este navegador». Reload (F5). The button reads «Continuar borrador». Click it. Expected: the «Recuperamos un borrador…» banner shows, Detalles is open and the switch is on.
7. Old-draft compatibility: with that draft still saved, run with `javascript_tool`:
   `const k = 'hokage:program-draft:template:new'; const v = JSON.parse(localStorage.getItem(k)); delete v.data.lockFutureWeeks; localStorage.setItem(k, JSON.stringify(v));`
   Reload and click «Continuar borrador». Expected:
   - the builder opens with the switch off and no console errors (`read_console_messages` with `onlyErrors`);
   - after about 1 s, `JSON.parse(localStorage.getItem('hokage:program-draft:template:new')).data.lockFutureWeeks` returns `false` (the autosave rewrote the draft with the field).

   Then click «Cancelar» → «Descartar».
8. Untouched form: click «Crear programa», turn the switch on, then off. Expected: within about 1 s «Borrador guardado en este navegador» disappears, and «Cancelar» closes the builder without the «¿Descartar los cambios?» dialog.
9. Legacy: `/settings` → Estilo del panel → «Clásico (legacy)» → `/programs` → edit `QA semana actual (plantilla)`. Expected: the wizard opens on Revisar, and the summary line ends in `· solo semana actual`. Click «Datos»: the «Solo semana actual» box sits under Duración and is on. Cancel, then set Estilo del panel back to «Nuevo (Dojo)».

Keep `QA semana actual (plantilla)` (switch on) for Task 9.

- [ ] **Step 13: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel add src/services/programs.ts src/components/program/builderModel.ts src/components/program/useProgramBuilder.ts src/components/program/LockFutureWeeksSwitch.tsx src/components/program/ProgramWorkspace.tsx src/components/program/LegacyProgramBuilder.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel diff --cached --name-only
```

Expected: exactly those 6 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel commit -m "feat(program): Solo semana actual switch in the builder" -m "Programs and templates carry lock_future_weeks: a switch in Detalles (workspace) and on the Datos step (legacy wizard), saved through save_coach_program. Drafts saved before the field existed restore with the program's own value." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Panel: assign dialogs send «Solo semana actual»; chips on the cards

**Files:**
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\services\programs.ts` (`assignTemplate`, lines 111–123)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\pages\client\ProgramsTab.tsx` (lucide import lines 11–12, import lines 39–40, card chips lines 281–282, `TemplatePicker` lines 491–503, 533–536 and 551)
- Modify: `C:\Users\Signos\Documents\edwin\hokage-web-panel\src\pages\Programs.tsx` (lucide import lines 11–12, import lines 30–31, `TemplateCard` chips lines 447–450, `AssignDialog` lines 518–519, 532 and 566–571)

**Interfaces:**
- Consumes:
  - `assign_program_template(p_template_id uuid, p_client_id uuid, p_start_date date, p_lock_future_weeks boolean default null)` from the Task 1 migration. The copy gets `coalesce(p_lock_future_weeks, template.lock_future_weeks)`, and the old `(uuid, uuid, date)` signature is dropped.
  - `Program.lock_future_weeks` from Task 1 Step 8.
  - `LockFutureWeeksSwitch`, including its `disabled` prop, from Task 8.
- Produces: `assignTemplate(templateId: string, clientId: string, startDate: string, lockFutureWeeks: boolean | null = null): Promise<string>`, which always sends `p_lock_future_weeks`.

- [ ] **Step 1: Preflight**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short -- src/services/programs.ts src/pages/client/ProgramsTab.tsx src/pages/Programs.tsx
ls C:/Users/Signos/Documents/edwin/hokage-web-panel/src/components/program/LockFutureWeeksSwitch.tsx
```

Expected: the second command prints nothing (else stop and ask); `ls` finds the file (Task 8 is in; if not, stop). If the first prints nothing, `git -C C:/Users/Signos/Documents/edwin/hokage-web-panel pull --rebase`; otherwise don't pull or stash. Read the three files in full.

- [ ] **Step 2: Confirm the call sites and the select strings**

Run: `grep -rn "assignTemplate(" C:/Users/Signos/Documents/edwin/hokage-web-panel/src`
Expected: exactly 3 hits: the definition in `src/services/programs.ts` (line 114), `src/pages/client/ProgramsTab.tsx:500` and `src/pages/Programs.tsx:532`.

Run: `grep -n "select(" C:/Users/Signos/Documents/edwin/hokage-web-panel/src/services/programs.ts`
Expected: `listProgramsForClient` (line 37) selects `'*, program_days(…'` and `listProgramTemplates` (line 55) selects `PROGRAM_GRAPH` (`'*, …'`). Both already return `lock_future_weeks`, so no query changes are needed. The explicit-column selects (line 69 `listTemplateAssignments`, line 268, and `services/insights.ts`) don't need the flag.

- [ ] **Step 3: `assignTemplate` sends `p_lock_future_weeks`**

In `src/services/programs.ts`, replace lines 111–123:

```ts
/** Deep-copies a template into a new ACTIVE program for the client (the
 *  single-active trigger archives whatever they were on). The copy is a
 *  snapshot — later template edits don't touch it. */
export async function assignTemplate(
  templateId: string,
  clientId: string,
  startDate: string,
): Promise<string> {
  const { data, error } = await supabase.rpc('assign_program_template', {
    p_template_id: templateId,
    p_client_id: clientId,
    p_start_date: startDate,
  });
```

with:

```ts
/** Deep-copies a template into a new ACTIVE program for the client (the
 *  single-active trigger archives whatever they were on). The copy is a
 *  snapshot — later template edits don't touch it. `lockFutureWeeks` sets
 *  «Solo semana actual» on the copy; null keeps the template's own value. */
export async function assignTemplate(
  templateId: string,
  clientId: string,
  startDate: string,
  lockFutureWeeks: boolean | null = null,
): Promise<string> {
  const { data, error } = await supabase.rpc('assign_program_template', {
    p_template_id: templateId,
    p_client_id: clientId,
    p_start_date: startDate,
    p_lock_future_weeks: lockFutureWeeks,
  });
```

(`p_lock_future_weeks` is always sent, including as `null`. PostgREST then matches only the new 4-argument function, so this panel build must be deployed after the migration.)

- [ ] **Step 4: Client Programas tab: imports and the chip on the program card**

In `src/pages/client/ProgramsTab.tsx`, lucide-react import (lines 11–12), replace:

```tsx
  LibraryBig,
  Pencil,
```

with:

```tsx
  LibraryBig,
  Lock,
  Pencil,
```

Replace lines 39–40:

```tsx
import { MobileProgramPreview } from '@/components/program/MobileProgramPreview';
import { programToPreview } from '@/components/program/previewModel';
```

with:

```tsx
import { MobileProgramPreview } from '@/components/program/MobileProgramPreview';
import { LockFutureWeeksSwitch } from '@/components/program/LockFutureWeeksSwitch';
import { programToPreview } from '@/components/program/previewModel';
```

In the program card's chip row (lines 281–282), replace:

```tsx
                  <Chip>Inicio {fmtDate(p.start_date)}</Chip>
                </div>
```

with:

```tsx
                  <Chip>Inicio {fmtDate(p.start_date)}</Chip>
                  {p.lock_future_weeks && <Chip icon={Lock}>Solo semana actual</Chip>}
                </div>
```

- [ ] **Step 5: Client Programas tab: `TemplatePicker` state, reset on open, pick and submit**

`TemplatePicker` stays mounted while closed (`open` prop, `ProgramsTab.tsx:375`), so without a reset a cancelled pick and a toggled switch would still be there on reopen, and because `pick()` ignores the already-picked id, re-picking wouldn't pre-set the switch (Review Focus 4). Each opening now starts fresh, with the same adjust-during-render pattern as `SaveAsTemplateDialog` (lines 419–424) and `AssignDialog`.

In `function TemplatePicker`, replace lines 491–503:

```tsx
  const [picked, setPicked] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(tomorrowISO());
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (picked == null) return;
    setSaving(true);
    try {
      const tpl = templates?.find((t) => t.id === picked);
      await assignTemplate(picked, clientId, startDate);
      toast.success(`"${tpl?.name ?? 'Programa'}" asignado`);
      setPicked(null);
      onAssigned();
```

with:

```tsx
  const [picked, setPicked] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(tomorrowISO());
  // «Solo semana actual» for this copy: pre-set from the picked template, and
  // reset whenever the coach picks a different one.
  const [lockFutureWeeks, setLockFutureWeeks] = useState(false);
  const [saving, setSaving] = useState(false);

  // The picker stays mounted while closed, so a cancelled pick (and its
  // switch) would still be there next time. Each opening starts fresh.
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) {
      setPicked(null);
      setStartDate(tomorrowISO());
      setLockFutureWeeks(false);
    }
  }

  const pick = (tpl: ProgramWithDetail) => {
    if (tpl.id === picked) return;
    setPicked(tpl.id);
    setLockFutureWeeks(tpl.lock_future_weeks);
  };

  const submit = async () => {
    if (picked == null) return;
    setSaving(true);
    try {
      const tpl = templates?.find((t) => t.id === picked);
      await assignTemplate(picked, clientId, startDate, lockFutureWeeks);
      toast.success(`"${tpl?.name ?? 'Programa'}" asignado`);
      setPicked(null);
      onAssigned();
```

(`ProgramWithDetail` is already imported at line 18. Stop the copy at `onAssigned();`: line 504, `} catch (e) {`, stays.)

- [ ] **Step 6: Client Programas tab: the switch under the start date, and the list uses `pick`**

In the same function's JSX (lines 533–536), replace:

```tsx
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
```

with:

```tsx
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <LockFutureWeeksSwitch
            id="tp-lock"
            checked={lockFutureWeeks}
            onCheckedChange={setLockFutureWeeks}
            disabled={picked == null}
          />

          <div className="max-h-[300px] overflow-y-auto rounded-lg border border-border">
```

In the template list button (line 551), replace:

```tsx
                    onClick={() => setPicked(tpl.id)}
```

with:

```tsx
                    onClick={() => pick(tpl)}
```

(The switch is disabled until a template is picked. Otherwise the coach could set it and then see picking a template overwrite it.)

- [ ] **Step 7: Programs library: imports and the chip on the template card**

In `src/pages/Programs.tsx`, lucide-react import (lines 11–12), replace:

```tsx
  FileDown,
  Pencil,
```

with:

```tsx
  FileDown,
  Lock,
  Pencil,
```

Replace lines 30–31:

```tsx
import { MobileProgramPreview } from '@/components/program/MobileProgramPreview';
import { programToPreview } from '@/components/program/previewModel';
```

with:

```tsx
import { MobileProgramPreview } from '@/components/program/MobileProgramPreview';
import { LockFutureWeeksSwitch } from '@/components/program/LockFutureWeeksSwitch';
import { programToPreview } from '@/components/program/previewModel';
```

In `TemplateCard`, after the «Clientes» chip (lines 447–450), replace:

```tsx
        </Chip>
      </div>

      {template.progression_rule && (
```

with:

```tsx
        </Chip>
        {template.lock_future_weeks && <Chip icon={Lock}>Solo semana actual</Chip>}
      </div>

      {template.progression_rule && (
```

- [ ] **Step 8: Programs library: `AssignDialog` pre-set from the template, reset on template change**

In `function AssignDialog`, replace lines 518–519:

```tsx
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
```

with:

```tsx
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  // «Solo semana actual» for this copy: pre-set from the template each time
  // the dialog opens for one, and back to off when it closes, so a toggle from
  // a cancelled assign doesn't carry over.
  const [lockFutureWeeks, setLockFutureWeeks] = useState(false);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if ((template?.id ?? null) !== seededFor) {
    setSeededFor(template?.id ?? null);
    setLockFutureWeeks(template?.lock_future_weeks ?? false);
  }
```

(The dialog is open while `template != null` and closes by setting it to `null`, so reopening on the same template seeds it again.)

In `submit` (line 532), replace:

```tsx
      await assignTemplate(template.id, clientId, startDate);
```

with:

```tsx
      await assignTemplate(template.id, clientId, startDate, lockFutureWeeks);
```

In the JSX (lines 566–571), replace:

```tsx
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="as-search">Cliente</Label>
```

with:

```tsx
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <LockFutureWeeksSwitch id="as-lock" checked={lockFutureWeeks} onCheckedChange={setLockFutureWeeks} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="as-search">Cliente</Label>
```

- [ ] **Step 9: Build and lint the panel**

Run: `cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npm run build`
Expected: `tsc` prints nothing, Vite ends with `✓ built in …s`, exit code 0.

Run: `cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npm run lint`
Expected: no findings, exit code 0 (`react-hooks` accepts the adjust-during-render resets).

- [ ] **Step 10: Browser check (needs the migration applied, and Task 8's `QA semana actual (plantilla)` with the switch on)**

USER STEP: confirm the new signature: `select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'assign_program_template';` returns exactly one row, `p_template_id uuid, p_client_id uuid, p_start_date date, p_lock_future_weeks boolean`.

Dev server and coach sign-in as in Task 8 Step 12 (the user signs in). Every assignment below makes the copy the client's **active** program, so use the test client; note which program is its active one now (it gets archived, and item 7 re-activates it).

1. `/programs`. Expected: the `QA semana actual (plantilla)` card's chip row ends with a lock chip «Solo semana actual». A template with the flag off has no such chip.
2. On the QA template, click «Asignar a cliente». Expected: under «Fecha de inicio», «Solo semana actual» is **on**. Turn it off, click «Cancelar», then reopen «Asignar a cliente» on the same template: it is on again. Open «Asignar a cliente» on a template with the flag off: the switch is off. Cancel.
3. On the QA template, click «Asignar a cliente», pick the test client, turn the switch **off** and click «Asignar». Expected: toast «"QA semana actual (plantilla)" asignado a …».
   - `read_network_requests` with urlPattern `assign_program_template`: the body contains `"p_lock_future_weeks":false`.
   - USER STEP:
     `select p.lock_future_weeks, t.lock_future_weeks as template_lock from public.programs p join public.programs t on t.id = p.template_id where t.name = 'QA semana actual (plantilla)' order by p.created_at desc limit 1;`
     returns `false | true`.
4. Test client → Programas → «Usar plantilla». Expected: the «Solo semana actual» box sits under «Fecha de inicio» and is dimmed and disabled while nothing is picked. Then:
   - pick `QA semana actual (plantilla)`: the switch turns on; turn it off;
   - click «Cancelar» and reopen «Usar plantilla» (Review Focus 4): nothing is picked, the switch is off and disabled, and «Fecha de inicio» is tomorrow;
   - pick the QA template: the switch turns on;
   - pick a template with the flag off: it turns off;
   - pick the QA template again: it turns on;
   - click «Asignar»: toast «"QA semana actual (plantilla)" asignado», and the new card at the top shows the «Solo semana actual» chip. The copy from item 3 has no chip.
   - USER STEP: the query from item 3 now returns `true | true`.
5. Edit that new copy (pencil). Expected: Detalles opens already expanded, with the switch on. Cancel.
6. On the same card, click «Guardar como plantilla» (bookmark) → «Guardar plantilla» → `/programs`. Expected: the new template card shows «Solo semana actual». This checks the migration's `save_program_as_template` copy.
7. Cleanup: delete the QA copies from the test client's Programas (trash), and click «Activar» on the client's previous active program. On `/programs`, archive and then delete the QA templates (including the one from item 6) and the archived `QA semana actual (cliente)` program from Task 8.

- [ ] **Step 11: Commit**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel add src/services/programs.ts src/pages/client/ProgramsTab.tsx src/pages/Programs.tsx
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel diff --cached --name-only
```

Expected: exactly those 3 paths. Anything else: stop and ask.

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel commit -m "feat(program): assign templates with Solo semana actual, chips on cards" -m "Both assign dialogs show the switch under the start date, pre-set from the chosen template (and fresh on every opening), and send p_lock_future_weeks to assign_program_template. Client program cards and template cards show a Solo semana actual chip when it is on." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Rollout and end-to-end check

**Files:** none changed. This task applies the rollout order (migration → panel → app build) and runs the spec's Verification matrix end to end.

**Interfaces:**
- Consumes: everything from Tasks 1-9; the test program setup from Task 3 Step 9.
- Produces: the pushed panel deploy and the user's go-ahead for the app build.

- [ ] **Step 1: USER STEP. The migration is applied**

If the user hasn't confirmed Task 1 Steps 4-5 yet, ask them to do both now (paste the migration in the SQL editor of project `rzgwkwxskrovxnnymxqo`, run it, then run the Step 5 verify query). Expected: `Success. No rows returned`, then 5 rows with `ok = true` (`locked programs` may be above 0 by now). Don't continue until the user confirms.

- [ ] **Step 2: Final automated checks in both repos**

```bash
cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npx tsc --noEmit && npm run lint && npm test
cd C:/Users/Signos/Documents/edwin/hokage-web-panel && npm run build && npm run lint
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app log --oneline -8
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel log --oneline -4
```

Expected:
- App: tsc prints nothing; lint `✖ 3 problems (0 errors, 3 warnings)`; tests `ℹ tests 31`, `ℹ pass 31`, `ℹ fail 0`.
- Panel: build ends with `✓ built in …s`; lint clean.
- App log includes, in order: `feat(programs): lock_future_weeks column and RPCs (Solo semana actual)`, `feat(program): week-lock rule and a node:test harness`, `feat(program): fresh today for the current week and the home card`, `feat(program): drop logging writes on locked weeks, expose lockOf`, `feat(program): lock note and locked checks on the Programa tab`, `feat(program): view-only exercise sheet on a locked week`, `feat(program): home card and day-complete stay on the open week`.
- Panel log includes `feat(programs): lock_future_weeks on the Program type`, `feat(program): Solo semana actual switch in the builder`, `feat(program): assign templates with Solo semana actual, chips on cards`.

- [ ] **Step 3: Push the app repo**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app pull --rebase
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app push origin main
```

Run `pull --rebase` only if `status --short` printed nothing (if other sessions' files are dirty, just push). Expected: `main -> main` (or `Everything up-to-date` if each task was already pushed). Only `supabase/functions/**` changes trigger CI, so nothing deploys.

- [ ] **Step 4: Push the panel (deploy), only after Step 1**

With the user's confirmation from Step 1 in hand:

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel pull --rebase
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel push origin main
```

(`pull --rebase` only on a clean tree, as above.) Expected: `main -> main`. Pushing `main` deploys through Vercel's Git integration. USER STEP: ask the user to confirm the Vercel deployment for the pushed commit shows Ready.

- [ ] **Step 5: USER STEP. App build**

The feature is JavaScript only (no native change, no new package), so an installed dev build picks it up from Metro (`npm start`), and Step 7 uses that. Tell the user the store/tester build is theirs to ship after the panel: `eas build --profile preview --platform android` for testers, or `eas build --profile production --platform all` then `eas submit` (README "Builds & stores"). Older app builds ignore the flag, which the spec accepts (no real users yet).

- [ ] **Step 6: End-to-end matrix on the deployed panel and the web app**

Setup: repeat Task 3 Step 9's two USER STEPs (record the saved values again; the test client's active program may be a different one after Task 9's cleanup). Open the deployed panel as the coach (the user signs in) and the web app as the test client (`preview_start` `{"name": "web"}`, the user signs in), in two Browser pane tabs. Flip the lock from the **deployed panel**: test client → Programas → edit the program → Detalles → «Solo semana actual» → «Guardar cambios».

| Spec check | Where it was pinned | Re-run here, expected |
|---|---|---|
| Migration verify queries | Task 1 Step 5 | Step 1 above: 5 rows `ok = true` |
| Panel saves a program and a template with the switch on and off; assigns with and without changing the switch | Task 8 Step 12, Task 9 Step 10 | Panel switch on + «Guardar cambios» → USER STEP `select lock_future_weeks from public.programs where id = '<program id>';` returns `true`; the program card shows the «Solo semana actual» chip |
| Flag off: no change (weekday home card, next-week jump, early completion) | Task 5 Step 14, Task 7 Step 8 E-F-H | Switch off in the panel: in the app every week's checks work, including Sem 3 (early completion); uncheck afterwards |
| Flag on: every control on a future week (note, check, pill, sheet footer, timer, sets, home card, modal) | Task 5 Step 14, Task 6 Step 10, Task 7 Step 8 A-B | Switch on in the panel: within a few seconds (realtime) Sem 3 shows «Disponible desde el <today + 6>», its checks are «…: bloqueado», its pills are disabled, its sheet footer is the lock note and its set fields are read only |
| Past weeks stay open | Task 5 Step 14 | Sem 1 checks and unchecks with the switch on |
| Before start | Task 5 Step 14, Task 7 Step 8 G | Panel: set Inicio 2 days ahead (allowed forward) and save → every week reads «Tu programa empieza el <today + 2>»; USER STEP afterwards: `update public.programs set start_date = (now() at time zone 'America/Santo_Domingo')::date - 8 where id = '<program id>';` |
| Week opening at midnight and on returning to the app | Task 3 Step 9, Task 7 Step 8 C-D, Task 10 Step 7 | Covered by those; not re-run here |
| Coach switches the lock on while the app is open (realtime), with and without a running timer | Task 6 Step 10 | Switch off in the panel, start a Sem 3 timer in the app, switch on in the panel → the sheet keeps only «Salir» and the lock note; run `window.confirm = () => true`, then «Salir» |
| Future-week checks made before the lock still count in the panel | Task 5 Step 14 (app %) | Switch off, check one Sem 3 exercise, switch on: the panel's Seguimiento for the test client still counts it; switch off, uncheck, switch on |

- [ ] **Step 7: USER STEP. Phone pass on an Android dev build (Review Focus 3)**

Ask the user to run this on an Android phone with the Hokage dev build installed (Metro: `cd C:/Users/Signos/Documents/edwin/hokage-coaching-app && npm start`), signed in as the test client, with the Step 6 setup (lock on, start = today − 8), and to report each result:

1. Programa → Sem 3: the note reads exactly «Disponible desde el <d> <mes>» for today + 6 (for example «Disponible desde el 12 oct»; report the exact text if Hermes prints something else, such as a September «sept»).
2. Tap a locked Sem 3 check: no haptic, no pop, nothing changes. Tap a day pill: nothing.
3. Open a Sem 3 exercise: the footer is the lock note; tap a set field: no keyboard opens.
4. Sem 2: checking an exercise pops, bursts and gives a haptic, as before. Uncheck it.
5. Midnight in the background: turn off automatic date and time, set the clock to 23:58 on today + 5, open Sem 3 (still locked), press Home, wait until after 00:00, then bring the app back. Expected: Sem 3 is open (no note, checks pressable) and the header reads «Semana 3 de T».
6. Midnight with the app open: set the clock to 23:58 on today + 5 again, leave the app open on Programa on Sem 3. Expected: at 00:00:01 the note disappears and the header changes to «Semana 3 de T».
7. Turn automatic date and time back on. Ajustes → Idioma → English: Sem 3 reads «Available from Oct 12» (today + 6). Switch back to Español.

If any result differs, record it for the user; don't change code in this task.

- [ ] **Step 8: Cleanup**

- USER STEP: restore the saved row from this task's setup: `update public.programs set start_date = '<saved start_date>', lock_future_weeks = <saved lock_future_weeks> where id = '<program id>';`.
- In the web app, uncheck anything the checks left checked on the test program.
- Reload the Browser pane tabs (drops any clock helper), reset any viewport you changed (`resize_window` preset `desktop`), and stop the panel dev server if it is still running (TaskStop, or close its background shell).

- [ ] **Step 9: Nothing left uncommitted**

```bash
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app status --short
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel status --short
git -C C:/Users/Signos/Documents/edwin/hokage-coaching-app log origin/main..main --oneline
git -C C:/Users/Signos/Documents/edwin/hokage-web-panel log origin/main..main --oneline
```

Expected: no line for any file this plan touched (other sessions' files may show); both `log origin/main..main` print nothing (everything pushed). No commit: this task changes no files.
