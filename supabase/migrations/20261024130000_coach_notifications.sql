-- ==========================================================================
-- Coach notices: the bell in the coach panel.
--
-- The database writes one row per event in coach_notifications; the panel
-- lists them under the bell, counts the unread ones and hears new rows over
-- Realtime while it is open. Nothing is sent anywhere else (no push, no
-- email): a coach who has the panel closed sees them on the next visit.
--
-- Kinds, and what `data` carries for the panel to word and link them:
--
--   day_completed  The client checked off every exercise of a program day
--                  for a week (the app's «día completado»). Written by a
--                  trigger on program_exercise_completions, as it happens.
--                  data: program_id, program_name, program_day_id,
--                        day_label, week, exercises
--   inactive       N days without training while the client has a running
--                  block: one notice at 4 days, another at 7 (the Dashboard's
--                  and the app reminders' thresholds), counted from the last
--                  training or the block's start, whichever is later.
--                  data: days, last_trained (null: nothing since the block
--                        started), program_id, program_name
--   block_ending   The block entered its last week (blocks of 2+ weeks).
--                  data: program_id, program_name, duration_weeks, end_date
--   block_ended    The block's last day has passed and it is still the
--                  client's active program.
--                  data: program_id, program_name, end_date
--
-- inactive / block_* come from create_coach_daily_notices(), run once a day
-- by pg_cron. They follow the Dashboard's «Atención» rules: only clients
-- being coached (membership active, or none) with a started, active program.
--
-- dedupe_key makes every event land once: a re-check, an offline write the
-- app replays, or the next daily run hits the same key and adds nothing.
--
-- «Today» is the coach's calendar day: coach_local_date() holds the time
-- zone, in one place.
--
-- Additive and idempotent. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

-- 1) The coach's calendar day ----------------------------------------------------
create or replace function public.coach_local_date(p_at timestamptz default now())
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'America/Santo_Domingo')::date
$$;

-- 2) coach_notifications -----------------------------------------------------------
create table if not exists public.coach_notifications (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null check (kind in ('day_completed','inactive','block_ending','block_ended')),
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null unique,
  read_at timestamptz,                     -- null = unread
  created_at timestamptz not null default now()
);
create index if not exists idx_coach_notifications_created
  on public.coach_notifications(created_at desc);
create index if not exists idx_coach_notifications_unread
  on public.coach_notifications(created_at desc) where read_at is null;
create index if not exists idx_coach_notifications_client
  on public.coach_notifications(client_id);

-- The coach reads them, marks them read and may delete them. Only the
-- database writes them (the functions below are SECURITY DEFINER).
alter table public.coach_notifications enable row level security;

drop policy if exists "coach reads notifications" on public.coach_notifications;
create policy "coach reads notifications" on public.coach_notifications for select
  using (public.is_coach());
drop policy if exists "coach marks notifications read" on public.coach_notifications;
create policy "coach marks notifications read" on public.coach_notifications for update
  using (public.is_coach()) with check (public.is_coach());
drop policy if exists "coach deletes notifications" on public.coach_notifications;
create policy "coach deletes notifications" on public.coach_notifications for delete
  using (public.is_coach());

revoke all on public.coach_notifications from anon, authenticated;
grant select, delete on public.coach_notifications to authenticated;
grant update (read_at) on public.coach_notifications to authenticated;

-- 3) Realtime: the panel hears new rows (RLS applies: only the coach) -----------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'coach_notifications'
  ) then
    alter publication supabase_realtime add table public.coach_notifications;
  end if;
end $$;

-- 4) day_completed -------------------------------------------------------------------
-- After each check-off: is every exercise of that day now checked for that
-- week? The app writes check-offs one at a time (its outbox), so the last one
-- of the day is the one that sees the day complete. Unchecking and checking
-- again later finds the same dedupe_key. Never blocks the client's write.
create or replace function public.notify_coach_day_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day     public.program_days%rowtype;
  v_program public.programs%rowtype;
  v_total   int;
  v_done    int;
begin
  if new.program_exercise_id is null then
    return null;
  end if;

  begin
    select d.* into v_day
      from public.program_exercises pe
      join public.program_days d on d.id = pe.program_day_id
     where pe.id = new.program_exercise_id;
    if not found then
      return null;
    end if;

    select p.* into v_program from public.programs p where p.id = v_day.program_id;
    if v_program.user_id is distinct from new.user_id or v_program.status <> 'active' then
      return null;
    end if;

    select count(*), count(c.id)
      into v_total, v_done
      from public.program_exercises pe
      left join public.program_exercise_completions c
        on c.program_exercise_id = pe.id
       and c.user_id = new.user_id
       and c.week_number = new.week_number
     where pe.program_day_id = v_day.id;
    if v_total = 0 or v_done < v_total then
      return null;
    end if;

    insert into public.coach_notifications (client_id, kind, data, dedupe_key)
    values (
      new.user_id,
      'day_completed',
      jsonb_build_object(
        'program_id',     v_program.id,
        'program_name',   v_program.name,
        'program_day_id', v_day.id,
        -- The app's own name for the day: its label, else its weekday, else
        -- «Día n».
        'day_label',      coalesce(
                            nullif(btrim(v_day.label), ''),
                            case v_day.weekday
                              when 'monday'    then 'Lunes'
                              when 'tuesday'   then 'Martes'
                              when 'wednesday' then 'Miércoles'
                              when 'thursday'  then 'Jueves'
                              when 'friday'    then 'Viernes'
                              when 'saturday'  then 'Sábado'
                              when 'sunday'    then 'Domingo'
                            end,
                            'Día ' || v_day.day_index),
        'week',           new.week_number,
        'exercises',      v_total),
      format('day_completed:%s:%s', v_day.id, new.week_number))
    on conflict (dedupe_key) do nothing;
  exception when others then
    raise warning 'completion %: coach notice not created: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.notify_coach_day_completed() from public, anon, authenticated;

drop trigger if exists trg_notify_coach_day_completed on public.program_exercise_completions;
create trigger trg_notify_coach_day_completed
  after insert on public.program_exercise_completions
  for each row
  execute function public.notify_coach_day_completed();

-- 5) The daily notices: inactive, block_ending, block_ended -------------------------
-- Returns how many notices it added. Safe to run any number of times a day.
create or replace function public.create_coach_daily_notices()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.coach_local_date();
  v_added int  := 0;
  v_rows  int;
  v_since date;
  v_days  int;
  v_step  int;
  r       record;
begin
  for r in
    select p.id, p.user_id, p.name, p.start_date, p.duration_weeks,
           p.start_date + p.duration_weeks * 7 - 1 as end_date,
           -- The Dashboard's «activity»: a check-off, a logged set or a
           -- logged workout. greatest() skips the nulls.
           greatest(
             (select max(public.coach_local_date(c.completed_at))
                from public.program_exercise_completions c
               where c.user_id = p.user_id),
             (select max(s.date) from public.workout_set_logs s where s.user_id = p.user_id),
             (select max(w.date) from public.workout_logs w where w.user_id = p.user_id)
           ) as last_trained
      from public.programs p
      left join public.memberships m on m.client_id = p.user_id
     where p.status = 'active'
       and not p.is_template
       and p.user_id is not null
       and p.start_date <= v_today
       and (m.client_id is null or m.status = 'active')
  loop
    -- inactive: only while the block runs (after it, block_ended says it).
    if v_today <= r.end_date then
      v_since := greatest(r.start_date, r.last_trained);
      v_days  := v_today - v_since;
      if v_days >= 4 then
        -- One notice per threshold reached in this stretch; a first run that
        -- finds 20 idle days adds the 7-day one only.
        v_step := case when v_days >= 7 then 7 else 4 end;
        insert into public.coach_notifications (client_id, kind, data, dedupe_key)
        values (
          r.user_id,
          'inactive',
          jsonb_build_object(
            'days',         v_days,
            'last_trained', case when r.last_trained >= r.start_date then r.last_trained end,
            'program_id',   r.id,
            'program_name', r.name),
          format('inactive:%s:%s:%s', r.user_id, v_since, v_step))
        on conflict (dedupe_key) do nothing;
        get diagnostics v_rows = row_count;
        v_added := v_added + v_rows;
      end if;
    end if;

    -- The block's end. end_date is in the key, so a block the coach extends
    -- is announced again at its new end.
    if r.duration_weeks >= 2 and v_today between r.end_date - 6 and r.end_date then
      insert into public.coach_notifications (client_id, kind, data, dedupe_key)
      values (
        r.user_id,
        'block_ending',
        jsonb_build_object(
          'program_id',     r.id,
          'program_name',   r.name,
          'duration_weeks', r.duration_weeks,
          'end_date',       r.end_date),
        format('block_ending:%s:%s', r.id, r.end_date))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_added := v_added + v_rows;
    elsif v_today > r.end_date then
      insert into public.coach_notifications (client_id, kind, data, dedupe_key)
      values (
        r.user_id,
        'block_ended',
        jsonb_build_object(
          'program_id',   r.id,
          'program_name', r.name,
          'end_date',     r.end_date),
        format('block_ended:%s:%s', r.id, r.end_date))
      on conflict (dedupe_key) do nothing;
      get diagnostics v_rows = row_count;
      v_added := v_added + v_rows;
    end if;
  end loop;

  return v_added;
end;
$$;

revoke all on function public.create_coach_daily_notices() from public, anon, authenticated;

-- 6) Once a day, 07:00 in the coach's time zone (11:00 UTC) ---------------------------
-- cron.schedule with a job name replaces that job, so this is safe to re-run.
create extension if not exists pg_cron;
select cron.schedule(
  'coach-daily-notices',
  '0 11 * * *',
  'select public.create_coach_daily_notices()'
);

-- 7) PostgREST: pick up the new table (sent on commit) ------------------------------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select tgname from pg_trigger where tgname = 'trg_notify_coach_day_completed';   -- 1 row
--   select jobname, schedule from cron.job where jobname = 'coach-daily-notices';     -- 1 row
--   select tablename from pg_publication_tables
--    where pubname = 'supabase_realtime' and tablename = 'coach_notifications';       -- 1 row
--   select proname from pg_proc
--    where proname in ('notify_coach_day_completed', 'create_coach_daily_notices')
--      and prosrc like '%' || chr(65533) || '%';                                      -- 0 rows
--   Run the daily pass now instead of waiting for 07:00:
--   select public.create_coach_daily_notices();
--   select kind, data, created_at from public.coach_notifications order by created_at desc limit 10;
--   select status, return_message from cron.job_run_details order by start_time desc limit 5;
