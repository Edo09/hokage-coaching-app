-- ==========================================================================
-- «Sonidos de la app», part 2: the coach's own sounds.
--
-- Each moment of app_sound_settings (20261106150000_app_sound_settings.sql)
-- can now be 'custom': a sound the coach uploaded in the panel (Ajustes →
-- Sonidos de la app). The panel converts it in the browser to the app's
-- format (mono 16-bit 44.1 kHz WAV), trims its silence, levels it and checks
-- its length before uploading it to the app-sounds bucket, as
-- custom/<moment>-<time>.wav; each upload is a new file, so phones that
-- downloaded the last one notice the change. The app downloads the files and
-- plays them offline.
--
-- An uploaded «rest over» plays while the app is open; the notification with
-- the app in the background can only use sounds built into the app, so it
-- plays the classic one (the app's src/utils/sound-sets.ts).
--
--   * <moment>_file: the moment's uploaded file, kept when the coach picks a
--     built-in set again, so «Propio» can come back without a new upload.
--     'custom' needs its file, and a file is always custom/<name>.wav.
--   * app-sounds bucket: public (sounds, nothing personal; the app downloads
--     without a session), WAV only, 1 MB at most (5 s of WAV is 441 KB).
--     Only the coach (is_coach()) adds, replaces or deletes its files.
--
-- Additive and idempotent. Run after 20261106150000_app_sound_settings.sql.
-- ==========================================================================

begin;

-- 1) The uploaded file of each moment ------------------------------------------------
alter table public.app_sound_settings
  add column if not exists rest_start_file   text,
  add column if not exists rest_warn_file    text,
  add column if not exists rest_done_file    text,
  add column if not exists new_record_file   text,
  add column if not exists day_complete_file text;

-- 'custom' joins the built-in sets.
alter table public.app_sound_settings drop constraint if exists app_sound_settings_sets;
alter table public.app_sound_settings add constraint app_sound_settings_sets check (
  rest_start   in ('classic', 'bells', 'ring', 'arcade', 'custom') and
  rest_warn    in ('classic', 'bells', 'ring', 'arcade', 'custom') and
  rest_done    in ('classic', 'bells', 'ring', 'arcade', 'custom') and
  new_record   in ('classic', 'bells', 'ring', 'arcade', 'custom') and
  day_complete in ('classic', 'bells', 'ring', 'arcade', 'custom')
);

-- 'custom' needs its file.
alter table public.app_sound_settings drop constraint if exists app_sound_settings_custom_has_file;
alter table public.app_sound_settings add constraint app_sound_settings_custom_has_file check (
  (rest_start   <> 'custom' or rest_start_file   is not null) and
  (rest_warn    <> 'custom' or rest_warn_file    is not null) and
  (rest_done    <> 'custom' or rest_done_file    is not null) and
  (new_record   <> 'custom' or new_record_file   is not null) and
  (day_complete <> 'custom' or day_complete_file is not null)
);

-- A file is a WAV in the bucket's custom/ folder.
alter table public.app_sound_settings drop constraint if exists app_sound_settings_file_paths;
alter table public.app_sound_settings add constraint app_sound_settings_file_paths check (
  coalesce(rest_start_file,   'custom/x.wav') ~ '^custom/[A-Za-z0-9_-]+\.wav$' and
  coalesce(rest_warn_file,    'custom/x.wav') ~ '^custom/[A-Za-z0-9_-]+\.wav$' and
  coalesce(rest_done_file,    'custom/x.wav') ~ '^custom/[A-Za-z0-9_-]+\.wav$' and
  coalesce(new_record_file,   'custom/x.wav') ~ '^custom/[A-Za-z0-9_-]+\.wav$' and
  coalesce(day_complete_file, 'custom/x.wav') ~ '^custom/[A-Za-z0-9_-]+\.wav$'
);

grant update (rest_start_file, rest_warn_file, rest_done_file, new_record_file, day_complete_file)
  on public.app_sound_settings to authenticated;

-- 2) The bucket ------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('app-sounds', 'app-sounds', true, 1048576, array['audio/wav'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Reads go through the public URL. The coach alone writes, in custom/.
drop policy if exists "app sounds: signed-in users list" on storage.objects;
create policy "app sounds: signed-in users list" on storage.objects
  for select to authenticated
  using (bucket_id = 'app-sounds');

drop policy if exists "app sounds: the coach uploads" on storage.objects;
create policy "app sounds: the coach uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'app-sounds' and public.is_coach()
              and (storage.foldername(name))[1] = 'custom');

drop policy if exists "app sounds: the coach replaces" on storage.objects;
create policy "app sounds: the coach replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'app-sounds' and public.is_coach())
  with check (bucket_id = 'app-sounds' and public.is_coach()
              and (storage.foldername(name))[1] = 'custom');

drop policy if exists "app sounds: the coach deletes" on storage.objects;
create policy "app sounds: the coach deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'app-sounds' and public.is_coach());

-- 3) PostgREST: pick up the new columns (sent on commit) ---------------------------------
notify pgrst, 'reload schema';

commit;

-- Verify:
--   select column_name from information_schema.columns
--    where table_name = 'app_sound_settings' and column_name like '%\_file';   -- 5 rows
--   select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'app-sounds';
--   select policyname, cmd from pg_policies
--    where schemaname = 'storage' and policyname like 'app sounds:%';          -- 4 rows
