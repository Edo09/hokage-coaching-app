-- ==========================================================================
-- Pushes for a change to the client's live plan, and for a block about to end.
--
--   «Tu coach actualizó tu programa»             program-updated          Programa
--   «Tu coach actualizó tu plan de nutrición»    nutrition-plan-updated   Nutrición
--   «Tu coach actualizó tu plan de suplementos»  supplement-plan-updated  Nutrición
--     body: «<name>» tiene cambios. Míralos en tu pestaña Programa / Nutrición.
--
--     When the coach saves changes to a plan that is already active: the
--     panel's save_coach_program / save_nutrition_plan / save_supplement_plan
--     rewrite the plan's row on every save, and any other edit of that row by
--     the coach counts too. At most one push per plan every 30 minutes, so a
--     coach polishing a plan sends one, not ten; and none in the 30 minutes
--     after the plan's «Tienes un nuevo …» push, which already sent the client
--     there. Nothing for: a plan becoming active (the «nuevo» push says it),
--     one leaving it (archived, completed, or demoted by the one-active-program
--     rule), the template claim save_*_as_template writes (template_id), a
--     write that changes nothing, or a write with no coach signed in (a
--     script, a migration, a cron job): only the coach's own edits are news.
--
--   «Tu bloque termina el viernes»               block-ending             Programa
--     body: «<name>» termina el viernes 13. Aprovecha estos días para
--           completar lo que te falte.
--
--     Three days before the last day of a block (a program of 2 weeks or
--     more, as for the coach's «block ending» notice), from a daily pg_cron
--     job at 09:00 in the coach's time zone (coach_local_date). Once per block
--     and end date: a block the coach extends is announced again before its
--     new end. A day the job missed is made up on the next run, up to the day
--     before the end.
--
--   * plan_update_pushes: one row per plan, with when its last update push
--     went (the 30-minute rule). No foreign key (it serves three tables); a
--     deleted plan's row is a few bytes and harmless.
--   * program_ending_pushes: one row per block end announced.
--   Both written only by these functions; no policies.
--
-- The text is Spanish (the app's default language), spelled once below.
-- data.kind and data.url are spelled the same in the app's src/utils/push.ts.
-- Sent through send_client_push (20261024120000_plan_assigned_push.sql), on
-- the 'coach' Android channel; a failure is a warning, never an error: a push
-- must not block a save.
--
-- Additive and idempotent. Run after 20261024130000_coach_notifications.sql.
-- ==========================================================================

begin;

-- 1) Update pushes sent ---------------------------------------------------------------
create table if not exists public.plan_update_pushes (
  kind    text not null check (kind in ('program', 'nutrition', 'supplement')),
  plan_id uuid not null,               -- programs / nutrition_plans / supplement_plans
  user_id uuid not null references public.profiles(id) on delete cascade,
  devices int not null default 0,      -- how many phones the last push went to
  sent_at timestamptz not null default now(),
  primary key (kind, plan_id)
);
alter table public.plan_update_pushes enable row level security;
revoke all on public.plan_update_pushes from anon, authenticated;

-- 2) «Tu coach actualizó tu …» ----------------------------------------------------------
-- One function for the three tables; the triggers below say when.
create or replace function public.notify_plan_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind     text;
  v_title    text;
  v_tab      text;
  v_data     jsonb;
  v_assigned timestamptz;   -- when the plan's «Tienes un nuevo …» push went
begin
  -- Only the coach's own edits. A script, a migration or a cron job has no
  -- coach signed in, and clients never write their plans.
  if not public.is_coach() then
    return null;
  end if;

  if tg_table_name = 'programs' then
    v_kind  := 'program';
    v_title := 'Tu coach actualizó tu programa';
    v_tab   := 'Programa';
    v_data  := jsonb_build_object(
                 'kind', 'program-updated', 'url', '/(tabs)/routines', 'program_id', new.id);
    select a.created_at into v_assigned
      from public.program_assignment_pushes a where a.program_id = new.id;
  elsif tg_table_name = 'nutrition_plans' then
    v_kind  := 'nutrition';
    v_title := 'Tu coach actualizó tu plan de nutrición';
    v_tab   := 'Nutrición';
    v_data  := jsonb_build_object(
                 'kind', 'nutrition-plan-updated', 'url', '/(tabs)/nutrition', 'plan_id', new.id);
    select a.created_at into v_assigned
      from public.nutrition_plan_assignment_pushes a where a.plan_id = new.id;
  else
    v_kind  := 'supplement';
    v_title := 'Tu coach actualizó tu plan de suplementos';
    v_tab   := 'Nutrición';
    v_data  := jsonb_build_object(
                 'kind', 'supplement-plan-updated', 'url', '/(tabs)/nutrition', 'plan_id', new.id);
    select a.created_at into v_assigned
      from public.supplement_plan_assignment_pushes a where a.plan_id = new.id;
  end if;

  -- Just assigned: the «Tienes un nuevo …» push already sent them to it.
  if v_assigned > now() - interval '30 minutes' then
    return null;
  end if;

  begin
    -- Take the plan's turn: a first row, or one whose last push is over 30
    -- minutes old. Otherwise one went out a moment ago and covers this edit.
    insert into public.plan_update_pushes as u (kind, plan_id, user_id)
    values (v_kind, new.id, new.user_id)
    on conflict (kind, plan_id) do update
       set user_id = excluded.user_id, devices = 0, sent_at = now()
     where u.sent_at <= now() - interval '30 minutes';
    if not found then
      return null;
    end if;

    update public.plan_update_pushes
       set devices = public.send_client_push(
             new.user_id,
             v_title,
             format('«%s» tiene cambios. Míralos en tu pestaña %s.', left(new.name, 120), v_tab),
             v_data)
     where kind = v_kind and plan_id = new.id;
  exception when others then
    raise warning '% plan % updated, push not sent: %', v_kind, new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.notify_plan_updated() from public, anon, authenticated;

-- Active before and after (so not an activation, an archive or a demotion),
-- a client's plan, not the template claim, and something actually changed.
drop trigger if exists trg_notify_program_updated on public.programs;
create trigger trg_notify_program_updated
  after update on public.programs
  for each row
  when (old.status = 'active' and new.status = 'active'
        and new.user_id is not null and not new.is_template
        and old.template_id is not distinct from new.template_id
        and old.* is distinct from new.*)
  execute function public.notify_plan_updated();

drop trigger if exists trg_notify_nutrition_plan_updated on public.nutrition_plans;
create trigger trg_notify_nutrition_plan_updated
  after update on public.nutrition_plans
  for each row
  when (old.status = 'active' and new.status = 'active'
        and new.user_id is not null and not new.is_template
        and old.template_id is not distinct from new.template_id
        and old.* is distinct from new.*)
  execute function public.notify_plan_updated();

drop trigger if exists trg_notify_supplement_plan_updated on public.supplement_plans;
create trigger trg_notify_supplement_plan_updated
  after update on public.supplement_plans
  for each row
  when (old.status = 'active' and new.status = 'active'
        and new.user_id is not null and not new.is_template
        and old.template_id is not distinct from new.template_id
        and old.* is distinct from new.*)
  execute function public.notify_plan_updated();

-- 3) Block ends announced -----------------------------------------------------------------
create table if not exists public.program_ending_pushes (
  program_id uuid not null references public.programs(id) on delete cascade,
  end_date   date not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  devices    int not null default 0,   -- how many phones the push went to
  created_at timestamptz not null default now(),
  primary key (program_id, end_date)
);
alter table public.program_ending_pushes enable row level security;
revoke all on public.program_ending_pushes from anon, authenticated;

-- 4) «Tu bloque termina el viernes» ---------------------------------------------------------
-- Returns how many blocks it announced. Safe to run any number of times a day.
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
              left join public.memberships m on m.client_id = p.user_id
             where p.status = 'active'
               and not p.is_template
               and p.user_id is not null
               and p.duration_weeks >= 2
               and p.start_date <= v_today
               and (m.client_id is null or m.status = 'active')) b
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

revoke all on function public.send_block_ending_pushes() from public, anon, authenticated;

-- 5) Once a day, 09:00 in the coach's time zone (13:00 UTC) ---------------------------------
-- cron.schedule with a job name replaces that job, so this is safe to re-run.
create extension if not exists pg_cron;
select cron.schedule(
  'client-block-ending-push',
  '0 13 * * *',
  'select public.send_block_ending_pushes()'
);

-- 6) PostgREST: pick up the new tables (sent on commit) ---------------------------------------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select tgname from pg_trigger
--    where tgname in ('trg_notify_program_updated', 'trg_notify_nutrition_plan_updated',
--                     'trg_notify_supplement_plan_updated');                      -- 3 rows
--   select jobname, schedule from cron.job where jobname = 'client-block-ending-push';  -- 1 row
--   select proname from pg_proc
--    where proname in ('notify_plan_updated', 'send_block_ending_pushes')
--      and prosrc like '%' || chr(65533) || '%';                                      -- 0 rows
--   After the coach saves a change to a client's active plan:
--   select * from public.plan_update_pushes order by sent_at desc limit 5;
--   select id, status_code, content from net._http_response order by id desc limit 5;
--   Run the daily pass now instead of waiting for 09:00:
--   select public.send_block_ending_pushes();
--   select * from public.program_ending_pushes order by created_at desc limit 5;
