-- ==========================================================================
-- Premium: requests, the lock, and the coach's rules.
-- (docs/superpowers/specs/2026-11-16-premium-subscriptions-design.md; builds
-- on 20261123120000_premium_access.sql)
--
-- 1. content_requests: «Solicitar programa» / «Solicitar Plan de nutrición».
--    A client can only ask through request_content(), which checks access;
--    the assignment itself closes the request, and the coach hears of it in
--    the bell (coach_notifications kind 'content_requested').
-- 2. The lock: RESTRICTIVE policies, added next to the existing ones (the same
--    pattern as «… assigned read-only» on meals and routines), that hide the
--    coach's content from a client whose access (and 72-hour grace) has ended
--    and stop their logging. They call premium_content_access(), which is true
--    for everyone while premium_settings.enforced is false: dark until the
--    switch is turned on.
-- 3. The coach's daily notices and the block-ending pushes ask
--    is_being_coached() instead of reading memberships themselves: the old
--    rule while the switch is off, real access once it is on.
--
-- Idempotent. Run with `supabase db query --remote=<ref> --yes -f <this file>`
-- or in the SQL editor. supabase/scripts/smoke_premium.sql checks it.
-- ==========================================================================

begin;

-- 1) content_requests ---------------------------------------------------------------
create table if not exists public.content_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null check (kind in ('program', 'nutrition_plan')),
  status      text not null default 'pending' check (status in ('pending', 'fulfilled', 'dismissed')),
  note        text check (note is null or length(note) <= 500),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

-- One open request per client and kind.
create unique index if not exists content_requests_one_pending
  on public.content_requests (user_id, kind) where status = 'pending';
create index if not exists idx_content_requests_pending_created
  on public.content_requests (created_at desc) where status = 'pending';

-- A client reads their own; the coach does everything. Nobody inserts through
-- the API (no INSERT grant): requests are made by request_content().
alter table public.content_requests enable row level security;
drop policy if exists "client reads own requests" on public.content_requests;
create policy "client reads own requests" on public.content_requests for select
  using (user_id = (select auth.uid()));
drop policy if exists "coach manages requests" on public.content_requests;
create policy "coach manages requests" on public.content_requests for all
  using (public.is_coach()) with check (public.is_coach());

revoke all on public.content_requests from anon, authenticated;
grant select on public.content_requests to authenticated;
grant update (status, resolved_at, resolved_by) on public.content_requests to authenticated;
-- The project grants tables one by one: without this an Edge Function reading
-- the requests with the service role would get 42501.
grant select, insert, update, delete on public.content_requests to service_role;

-- 2) A new kind of coach notice ----------------------------------------------------------
--   content_requested  A client asked for a program or a nutrition plan.
--                      data: kind, request_id, note
alter table public.coach_notifications drop constraint if exists coach_notifications_kind_check;
alter table public.coach_notifications add constraint coach_notifications_kind_check
  check (kind in ('day_completed', 'inactive', 'block_ending', 'block_ended', 'content_requested'));

-- 3) request_content ------------------------------------------------------------------------
-- Raises, by message: premium_required (42501; also for the coach and a
-- signed-out caller), invalid_kind, note_too_long, already_assigned. Asking
-- again while one is pending returns that one.
create or replace function public.request_content(p_kind text, p_note text default null)
returns public.content_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_req public.content_requests;
begin
  if v_uid is null or public.is_coach() or not public.premium_access_for(v_uid) then
    raise exception 'premium_required' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('program', 'nutrition_plan') then
    raise exception 'invalid_kind';
  end if;
  if p_note is not null and length(p_note) > 500 then
    raise exception 'note_too_long';
  end if;
  if (p_kind = 'program' and exists (
        select 1 from public.programs p
         where p.user_id = v_uid and p.status = 'active' and not p.is_template))
     or (p_kind = 'nutrition_plan' and exists (
        select 1 from public.nutrition_plans p
         where p.user_id = v_uid and p.status = 'active' and not p.is_template)) then
    raise exception 'already_assigned';
  end if;

  select * into v_req from public.content_requests r
   where r.user_id = v_uid and r.kind = p_kind and r.status = 'pending';
  if found then
    return v_req;
  end if;

  begin
    insert into public.content_requests (user_id, kind, note)
    values (v_uid, p_kind, nullif(btrim(p_note), ''))
    returning * into v_req;
  exception when unique_violation then
    -- Two taps at once: the other one won; return it.
    select * into v_req from public.content_requests r
     where r.user_id = v_uid and r.kind = p_kind and r.status = 'pending';
  end;
  return v_req;
end;
$$;

-- 4) Triggers -----------------------------------------------------------------------------------
-- The coach hears of a request in the bell. Never blocks the client's write.
create or replace function public.notify_content_requested()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.coach_notifications (client_id, kind, data, dedupe_key)
  values (
    new.user_id,
    'content_requested',
    jsonb_build_object('kind', new.kind, 'request_id', new.id, 'note', new.note),
    'content_requested:' || new.id)
  on conflict (dedupe_key) do nothing;
  return null;
exception when others then
  raise warning 'content request %: coach notice not created: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_notify_content_requested on public.content_requests;
create trigger trg_notify_content_requested
  after insert on public.content_requests
  for each row execute function public.notify_content_requested();

-- Assigning the content closes the request. A template, an archived row and a
-- supplement plan do not. Never blocks the coach's assignment.
create or replace function public.fulfil_content_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.content_requests
     set status = 'fulfilled', resolved_at = now(), resolved_by = new.assigned_by
   where user_id = new.user_id
     and kind = case tg_table_name when 'programs' then 'program' else 'nutrition_plan' end
     and status = 'pending';
  return null;
exception when others then
  raise warning 'assignment %: content request not closed: %', new.id, sqlerrm;
  return null;
end;
$$;

drop trigger if exists trg_fulfil_content_request on public.programs;
create trigger trg_fulfil_content_request
  after insert or update of status on public.programs
  for each row
  when (new.status = 'active' and new.user_id is not null and not new.is_template)
  execute function public.fulfil_content_request();

drop trigger if exists trg_fulfil_content_request on public.nutrition_plans;
create trigger trg_fulfil_content_request
  after insert or update of status on public.nutrition_plans
  for each row
  when (new.status = 'active' and new.user_id is not null and not new.is_template)
  execute function public.fulfil_content_request();

-- 5) The lock -------------------------------------------------------------------------------------
-- RESTRICTIVE: a row is visible or writable only if every restrictive policy
-- passes AND a permissive one does, so the existing «client reads own …»,
-- «coach all …» and «assigned read-only» policies are untouched. Reading the
-- coach's content and writing what the client logs both need access or its
-- 72-hour grace (premium_content_access): the triggers that stamp a check-off
-- or a set read the program as the client, so the two cannot differ. History
-- reads, profile, weight and measurements are not locked.
do $$
declare
  t text;
begin
  foreach t in array array[
    'programs', 'program_weeks', 'program_days', 'program_exercises',
    'nutrition_plans', 'nutrition_plan_meals', 'nutrition_plan_options',
    'nutrition_plan_option_items', 'nutrition_plan_targets',
    'supplement_plans', 'supplement_plan_items'
  ] loop
    execute format('drop policy if exists premium_lock_select on public.%I', t);
    execute format(
      'create policy premium_lock_select on public.%I as restrictive for select '
      || 'using ((select public.premium_content_access()))', t);
  end loop;

  foreach t in array array[
    'program_exercise_completions', 'workout_set_logs', 'supplement_intake_logs',
    'meals', 'meal_items'
  ] loop
    execute format('drop policy if exists premium_lock_insert on public.%I', t);
    execute format(
      'create policy premium_lock_insert on public.%I as restrictive for insert '
      || 'with check ((select public.premium_content_access()))', t);
    execute format('drop policy if exists premium_lock_update on public.%I', t);
    execute format(
      'create policy premium_lock_update on public.%I as restrictive for update '
      || 'using ((select public.premium_content_access())) '
      || 'with check ((select public.premium_content_access()))', t);
    execute format('drop policy if exists premium_lock_delete on public.%I', t);
    execute format(
      'create policy premium_lock_delete on public.%I as restrictive for delete '
      || 'using ((select public.premium_content_access()))', t);
  end loop;
end $$;

-- 6) The coach's rules ------------------------------------------------------------------------------
-- The two daily jobs below are the live bodies, with one change each: the
-- join on the manual table and its old clause are replaced by
-- is_being_coached(p.user_id), which IS that clause while the switch is off.

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
     where p.status = 'active'
       and not p.is_template
       and p.user_id is not null
       and p.start_date <= v_today
       and public.is_being_coached(p.user_id)
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

create or replace function public.send_block_ending_pushes()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.coach_local_date();
  v_sent  int  := 0;
  v_day   text;
  r       record;
begin
  for r in
    select b.*
      from (select p.id, p.user_id, p.name,
                   p.start_date + p.duration_weeks * 7 - 1 as end_date
              from public.programs p
             where p.status = 'active'
               and not p.is_template
               and p.user_id is not null
               and p.duration_weeks >= 2
               and p.start_date <= v_today
               and public.is_being_coached(p.user_id)) b
     -- Three days before the last day; a missed run catches up until the eve.
     where v_today between b.end_date - 3 and b.end_date - 1
  loop
    begin
      insert into public.program_ending_pushes (program_id, end_date, user_id)
      values (r.id, r.end_date, r.user_id)
      on conflict (program_id, end_date) do nothing;
      if found then
        v_day := (array['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'])
                 [extract(isodow from r.end_date)::int];
        update public.program_ending_pushes
           set devices = public.send_client_push(
                 r.user_id,
                 format('Tu bloque termina el %s', v_day),
                 format('«%s» termina el %s %s. Aprovecha estos días para completar lo que te falte.',
                        left(r.name, 120), v_day, extract(day from r.end_date)::int),
                 jsonb_build_object(
                   'kind',       'block-ending',
                   'url',        '/(tabs)/routines',
                   'program_id', r.id,
                   'end_date',   r.end_date))
         where program_id = r.id and end_date = r.end_date;
        v_sent := v_sent + 1;
      end if;
    exception when others then
      raise warning 'block % ending, push not sent: %', r.id, sqlerrm;
    end;
  end loop;

  return v_sent;
end;
$$;

-- 7) Who may call what -----------------------------------------------------------------------------
revoke all on function public.request_content(text, text) from public, anon;
grant execute on function public.request_content(text, text) to authenticated;
revoke all on function public.notify_content_requested() from public, anon, authenticated;
revoke all on function public.fulfil_content_request()   from public, anon, authenticated;

-- 8) Realtime: the client sees their request close, the coach sees new ones ------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'content_requests'
  ) then
    alter publication supabase_realtime add table public.content_requests;
  end if;
end $$;

commit;
