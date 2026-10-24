-- ==========================================================================
-- Push notifications when the coach assigns a nutrition or supplement plan.
--
-- The same contract as the program push (20261023150000_program_assigned_push):
-- when a client's plan becomes active -- saved new for them from the panel, a
-- template assigned, or an older plan switched back on -- each of the
-- client's phones gets one Expo push, and tapping it opens the app's
-- Nutrición tab (where the supplements live too):
--
--   nutrition_plans   «Tienes un nuevo plan de nutrición»
--   supplement_plans  «Tienes un nuevo plan de suplementos»
--     body: «<plan name>» ya está en tu pestaña Nutrición.
--
--   * send_client_push: the one place that builds Expo messages and posts
--     them through pg_net. The program trigger is re-created on top of it,
--     with the same behaviour and text as before.
--   * nutrition_plan_assignment_pushes / supplement_plan_assignment_pushes:
--     one row per plan that has been handled, so a plan never notifies twice
--     (edits keep the plan's id since 20260925120000_plan_edits_keep_history;
--     archive and re-activate). Written only by the triggers; no policies.
--
-- data.kind 'nutrition-plan-assigned' / 'supplement-plan-assigned' and
-- data.url '/(tabs)/nutrition' are spelled the same in the app's
-- src/utils/push.ts. channelId 'coach' is the Android channel the app creates.
--
-- Additive and idempotent. Run in the Supabase SQL editor, after
-- 20261023150000_program_assigned_push.sql.
-- ==========================================================================

begin;

-- 1) send_client_push ------------------------------------------------------------
-- One Expo push to each of the client's phones (newest 100: Expo takes at
-- most 100 messages per request). Returns how many phones it went to; 0 sends
-- nothing. The request is queued in the caller's transaction and only goes out
-- once it commits. Errors propagate: each caller turns them into a warning.
create or replace function public.send_client_push(
  p_user_id uuid,
  p_title   text,
  p_body    text,
  p_data    jsonb
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb;
  v_devices  int;
begin
  select count(*),
         jsonb_agg(jsonb_build_object(
           'to',        t.token,
           'title',     p_title,
           'body',      p_body,
           'data',      p_data,
           'sound',     'default',
           'channelId', 'coach',
           'priority',  'high'))
    into v_devices, v_messages
    from (select token
            from public.push_tokens
           where user_id = p_user_id
           order by updated_at desc
           limit 100) t;

  if v_devices > 0 then
    perform net.http_post(
      url     := 'https://exp.host/--/api/v2/push/send',
      body    := v_messages,
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Accept',       'application/json'));
  end if;
  return v_devices;
end;
$$;

revoke all on function public.send_client_push(uuid, text, text, jsonb) from public, anon, authenticated;

-- 2) The program push, now through send_client_push --------------------------------
create or replace function public.notify_program_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- An update only counts when the program was not active before (an edit of
  -- the live program also writes status = 'active').
  if tg_op = 'UPDATE' and old.status = 'active' then
    return null;
  end if;
  -- Clients can't write programs today; should one ever save their own, it
  -- is not news to them.
  if auth.uid() is not null and auth.uid() = new.user_id then
    return null;
  end if;

  begin
    insert into public.program_assignment_pushes (program_id, user_id)
    values (new.id, new.user_id)
    on conflict (program_id) do nothing;
    if not found then
      return null;   -- this program has already been handled
    end if;

    update public.program_assignment_pushes
       set devices = public.send_client_push(
             new.user_id,
             'Tienes un nuevo programa',
             format('«%s» ya está en tu pestaña Programa.', left(new.name, 120)),
             jsonb_build_object(
               'kind',       'program-assigned',
               'url',        '/(tabs)/routines',
               'program_id', new.id))
     where program_id = new.id;
  exception when others then
    raise warning 'program % assigned, push not sent: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

-- 3) Handled plans ------------------------------------------------------------------
create table if not exists public.nutrition_plan_assignment_pushes (
  plan_id uuid primary key references public.nutrition_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  devices int not null default 0,          -- how many phones the push went to
  created_at timestamptz not null default now()
);
alter table public.nutrition_plan_assignment_pushes enable row level security;
revoke all on public.nutrition_plan_assignment_pushes from anon, authenticated;

create table if not exists public.supplement_plan_assignment_pushes (
  plan_id uuid primary key references public.supplement_plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  devices int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.supplement_plan_assignment_pushes enable row level security;
revoke all on public.supplement_plan_assignment_pushes from anon, authenticated;

-- 4) The triggers -------------------------------------------------------------------
create or replace function public.notify_nutrition_plan_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Same rules as the program push: only a plan that was not active before,
  -- and never one the client saved themself.
  if tg_op = 'UPDATE' and old.status = 'active' then
    return null;
  end if;
  if auth.uid() is not null and auth.uid() = new.user_id then
    return null;
  end if;

  begin
    insert into public.nutrition_plan_assignment_pushes (plan_id, user_id)
    values (new.id, new.user_id)
    on conflict (plan_id) do nothing;
    if not found then
      return null;   -- this plan has already been handled
    end if;

    update public.nutrition_plan_assignment_pushes
       set devices = public.send_client_push(
             new.user_id,
             'Tienes un nuevo plan de nutrición',
             format('«%s» ya está en tu pestaña Nutrición.', left(new.name, 120)),
             jsonb_build_object(
               'kind',    'nutrition-plan-assigned',
               'url',     '/(tabs)/nutrition',
               'plan_id', new.id))
     where plan_id = new.id;
  exception when others then
    raise warning 'nutrition plan % assigned, push not sent: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

create or replace function public.notify_supplement_plan_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'active' then
    return null;
  end if;
  if auth.uid() is not null and auth.uid() = new.user_id then
    return null;
  end if;

  begin
    insert into public.supplement_plan_assignment_pushes (plan_id, user_id)
    values (new.id, new.user_id)
    on conflict (plan_id) do nothing;
    if not found then
      return null;   -- this plan has already been handled
    end if;

    update public.supplement_plan_assignment_pushes
       set devices = public.send_client_push(
             new.user_id,
             'Tienes un nuevo plan de suplementos',
             format('«%s» ya está en tu pestaña Nutrición.', left(new.name, 120)),
             jsonb_build_object(
               'kind',    'supplement-plan-assigned',
               'url',     '/(tabs)/nutrition',
               'plan_id', new.id))
     where plan_id = new.id;
  exception when others then
    raise warning 'supplement plan % assigned, push not sent: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.notify_nutrition_plan_assigned()  from public, anon, authenticated;
revoke all on function public.notify_supplement_plan_assigned() from public, anon, authenticated;

drop trigger if exists trg_notify_nutrition_plan_assigned on public.nutrition_plans;
create trigger trg_notify_nutrition_plan_assigned
  after insert or update of status on public.nutrition_plans
  for each row
  when (new.status = 'active' and new.user_id is not null and not new.is_template)
  execute function public.notify_nutrition_plan_assigned();

drop trigger if exists trg_notify_supplement_plan_assigned on public.supplement_plans;
create trigger trg_notify_supplement_plan_assigned
  after insert or update of status on public.supplement_plans
  for each row
  when (new.status = 'active' and new.user_id is not null and not new.is_template)
  execute function public.notify_supplement_plan_assigned();

commit;

-- Verify:
--   select tgname from pg_trigger
--    where tgname in ('trg_notify_nutrition_plan_assigned',
--                     'trg_notify_supplement_plan_assigned');                -- 2 rows
--   select proname from pg_proc
--    where proname in ('send_client_push', 'notify_program_assigned',
--                      'notify_nutrition_plan_assigned',
--                      'notify_supplement_plan_assigned')
--      and prosrc like '%' || chr(65533) || '%';                            -- 0 rows
--   After assigning a nutrition plan to a client with the app installed:
--   select * from public.nutrition_plan_assignment_pushes order by created_at desc limit 5;
--   select id, status_code, content from net._http_response order by id desc limit 5;
