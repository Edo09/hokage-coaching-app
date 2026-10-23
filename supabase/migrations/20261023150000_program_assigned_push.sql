-- ==========================================================================
-- Push notification when the coach assigns a program.
--
-- When a client's program becomes active -- a new program saved for them
-- (save_coach_program), a template assigned (assign_program_template), or an
-- older block switched back on ("Activar", a plain status update) -- each of
-- the client's phones gets one Expo push: «Tienes un nuevo programa» with the
-- program's name. Tapping it opens the app's Programa tab (data.url, read by
-- the app's notification tap handler).
--
--   * push_tokens: one row per device (the Expo push token), owned by the
--     signed-in client. The app registers it after sign-in through
--     register_push_token and deletes it on sign-out. RLS: a user sees and
--     manages only their own rows.
--   * program_assignment_pushes: one row per program that has been handled,
--     so a program never notifies twice (edits, re-saves, archive and
--     re-activate). Written only by the trigger; no policies.
--   * notify_program_assigned: AFTER trigger on programs. Sends through pg_net
--     straight to Expo's push API; the request is queued in the same
--     transaction and only goes out once it commits, so a failed or rolled
--     back save sends nothing, and the program's days are there by the time
--     the client opens it. Any failure here is a warning, never an error: a
--     push must not block an assignment. A client with no device: recorded,
--     nothing sent.
--
-- The text is Spanish (the app's default language), spelled once below.
-- data.kind 'program-assigned' and data.url '/(tabs)/routines' are spelled
-- the same in src/lib/push.ts; channelId 'coach' is the Android channel the
-- app creates.
--
-- Additive and idempotent. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

-- 1) pg_net: async HTTP from the database (creates schema net) ----------------
create extension if not exists pg_net;

-- 2) push_tokens ---------------------------------------------------------------
create table if not exists public.push_tokens (
  -- The Expo push token. Primary key: a device belongs to one account at a
  -- time; signing in as someone else on the same phone moves the row.
  token text primary key check (token ~ '^Expo(nent)?PushToken\[.+\]$'),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_push_tokens_user on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

drop policy if exists "user manages own push tokens" on public.push_tokens;
create policy "user manages own push tokens" on public.push_tokens for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_tokens to authenticated;

-- Register this device for the signed-in user. SECURITY DEFINER because the
-- token may still be on another account's row (the previous user of this
-- phone signed out offline, or their session expired): that row has to move,
-- and RLS would refuse the update. Expo tokens are only readable on the
-- device itself, so only someone holding the phone can claim one.
create or replace function public.register_push_token(p_token text, p_platform text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;

  insert into public.push_tokens (token, user_id, platform)
  values (p_token, auth.uid(), p_platform)
  on conflict (token) do update
     set user_id    = excluded.user_id,
         platform   = excluded.platform,
         updated_at = now();
end;
$$;

revoke all     on function public.register_push_token(text, text) from public, anon;
grant  execute on function public.register_push_token(text, text) to authenticated;

-- 3) program_assignment_pushes ---------------------------------------------------
create table if not exists public.program_assignment_pushes (
  program_id uuid primary key references public.programs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  devices int not null default 0,          -- how many phones the push went to
  created_at timestamptz not null default now()
);

alter table public.program_assignment_pushes enable row level security;
revoke all on public.program_assignment_pushes from anon, authenticated;

-- 4) the trigger -------------------------------------------------------------------
create or replace function public.notify_program_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_messages jsonb;
  v_devices  int;
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

    select count(*),
           jsonb_agg(jsonb_build_object(
             'to',        t.token,
             'title',     'Tienes un nuevo programa',
             'body',      format('«%s» ya está en tu pestaña Programa.', left(new.name, 120)),
             'data',      jsonb_build_object(
                            'kind',       'program-assigned',
                            'url',        '/(tabs)/routines',
                            'program_id', new.id),
             'sound',     'default',
             'channelId', 'coach',
             'priority',  'high'))
      into v_devices, v_messages
      from (select token
              from public.push_tokens
             where user_id = new.user_id
             order by updated_at desc
             limit 100) t;   -- Expo takes at most 100 messages per request

    update public.program_assignment_pushes
       set devices = v_devices
     where program_id = new.id;

    if v_devices > 0 then
      perform net.http_post(
        url     := 'https://exp.host/--/api/v2/push/send',
        body    := v_messages,
        headers := jsonb_build_object(
                     'Content-Type', 'application/json',
                     'Accept',       'application/json'));
    end if;
  exception when others then
    raise warning 'program % assigned, push not sent: %', new.id, sqlerrm;
  end;

  return null;
end;
$$;

revoke all on function public.notify_program_assigned() from public, anon, authenticated;

drop trigger if exists trg_notify_program_assigned on public.programs;
create trigger trg_notify_program_assigned
  after insert or update of status on public.programs
  for each row
  when (new.status = 'active' and new.user_id is not null and not new.is_template)
  execute function public.notify_program_assigned();

-- 5) PostgREST: pick up the new table and function (sent on commit) ------------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select extname from pg_extension where extname = 'pg_net';           -- 1 row
--   select tgname from pg_trigger
--    where tgrelid = 'public.programs'::regclass
--      and tgname = 'trg_notify_program_assigned';                       -- 1 row
--   select has_function_privilege('authenticated',
--          'public.register_push_token(text, text)', 'execute');         -- true
--   After assigning a program to a client with the app installed:
--   select * from public.program_assignment_pushes order by created_at desc limit 5;
--   select id, status_code, content from net._http_response order by id desc limit 5;
--     -- Expo's answer: {"data":[{"status":"ok","id":"..."}]} per device
