-- ==========================================================================
-- «Sonidos de la app»: the coach picks the workout sounds every client hears.
--
-- One row, one column per moment, each naming a sound set built into the
-- app (assets/sounds, named in src/utils/sound-sets.ts):
--
--   rest_start    a rest starts
--   rest_warn     10 seconds of rest left
--   rest_done     the rest is over (also the background notification's sound)
--   new_record    a logged set beats the client's best
--   day_complete  the day's last exercise is checked off
--
--   sets: classic (the app's first sounds) | bells | ring | arcade
--
-- The coach changes it in the panel (Ajustes → Sonidos de la app);
-- signed-in clients read it, and the app keeps it for use offline. A set an
-- app build doesn't have plays its classic sound. A new set takes new files
-- in a new app build, the panel's list, and the check below.
--
--   * RLS: signed-in users read the row; only the coach (is_coach()) changes
--     it, and only the five sound columns. Nobody adds or deletes rows: the
--     one row is made here.
--   * updated_at / updated_by are stamped by a trigger.
--
-- Additive and idempotent. Run after the is_coach() migrations.
-- ==========================================================================

begin;

-- 1) The one row ------------------------------------------------------------------
create table if not exists public.app_sound_settings (
  id           boolean primary key default true check (id),   -- only ever true: one row
  rest_start   text not null default 'classic',
  rest_warn    text not null default 'classic',
  rest_done    text not null default 'classic',
  new_record   text not null default 'classic',
  day_complete text not null default 'classic',
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.profiles(id) on delete set null,
  constraint app_sound_settings_sets check (
    rest_start   in ('classic', 'bells', 'ring', 'arcade') and
    rest_warn    in ('classic', 'bells', 'ring', 'arcade') and
    rest_done    in ('classic', 'bells', 'ring', 'arcade') and
    new_record   in ('classic', 'bells', 'ring', 'arcade') and
    day_complete in ('classic', 'bells', 'ring', 'arcade')
  )
);

insert into public.app_sound_settings (id) values (true) on conflict (id) do nothing;

-- 2) Who reads and who changes it -----------------------------------------------------
alter table public.app_sound_settings enable row level security;

drop policy if exists "signed-in users read the app sounds" on public.app_sound_settings;
create policy "signed-in users read the app sounds" on public.app_sound_settings
  for select to authenticated using (true);

drop policy if exists "the coach changes the app sounds" on public.app_sound_settings;
create policy "the coach changes the app sounds" on public.app_sound_settings
  for update to authenticated using (public.is_coach()) with check (public.is_coach());

revoke all on public.app_sound_settings from anon, authenticated;
grant select on public.app_sound_settings to authenticated;
grant update (rest_start, rest_warn, rest_done, new_record, day_complete)
  on public.app_sound_settings to authenticated;

-- 3) When and by whom it last changed ---------------------------------------------------
create or replace function public.stamp_app_sound_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.stamp_app_sound_settings() from public, anon, authenticated;

drop trigger if exists trg_stamp_app_sound_settings on public.app_sound_settings;
create trigger trg_stamp_app_sound_settings
  before update on public.app_sound_settings
  for each row execute function public.stamp_app_sound_settings();

-- 4) PostgREST: pick up the new table (sent on commit) ---------------------------------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select * from public.app_sound_settings;                              -- 1 row, all classic
--   select has_table_privilege('authenticated', 'public.app_sound_settings', 'select');  -- true
--   select has_table_privilege('anon', 'public.app_sound_settings', 'select');           -- false
