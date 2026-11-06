-- ==========================================================================
-- Smoke test for supabase/migrations/20261106150000_app_sound_settings.sql
-- and 20261106160000_app_sound_uploads.sql.
--
-- Run it after the migration. It acts as a client and as the coach (as the
-- `authenticated` role, so RLS applies), checks each rule with assert, and
-- ends with
--
--   ERROR:  SMOKE OK: app sounds; nothing was saved
--
-- which rolls everything back. Any other error names the rule that failed.
-- ==========================================================================

do $$
declare
  v_coach     uuid;
  v_client    uuid;
  v_as_coach  text;
  v_as_client text;
  v_n         int;
  r           public.app_sound_settings%rowtype;
begin
  select id into v_coach from public.profiles where role = 'coach' limit 1;
  assert v_coach is not null, 'there is no coach to act as';
  select id into v_client from public.profiles where role is distinct from 'coach' limit 1;
  assert v_client is not null, 'there is no client to act as';
  v_as_coach  := json_build_object('sub', v_coach,  'role', 'authenticated')::text;
  v_as_client := json_build_object('sub', v_client, 'role', 'authenticated')::text;

  -- 1. One row; the app may read it, and change only the sounds.
  assert (select count(*) from public.app_sound_settings) = 1, '1: there is one row';
  assert has_table_privilege('authenticated', 'public.app_sound_settings', 'select'), '1: signed-in users read it';
  assert not has_table_privilege('anon', 'public.app_sound_settings', 'select'), '1: anon can''t read it';
  assert not has_table_privilege('authenticated', 'public.app_sound_settings', 'insert'), '1: nobody adds rows';
  assert not has_table_privilege('authenticated', 'public.app_sound_settings', 'delete'), '1: nobody deletes it';
  assert has_column_privilege('authenticated', 'public.app_sound_settings', 'rest_done', 'update'),
    '1: the sounds can be changed';
  assert not has_column_privilege('authenticated', 'public.app_sound_settings', 'updated_by', 'update'),
    '1: the stamp can''t be written by hand';

  -- 2. A client reads it and can't change it.
  perform set_config('request.jwt.claims', v_as_client, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.app_sound_settings;
  assert v_n = 1, '2: a client reads the row';
  update public.app_sound_settings set rest_done = 'ring' where id;
  get diagnostics v_n = row_count;
  assert v_n = 0, '2: a client changes nothing';
  execute 'reset role';

  -- 3. The coach changes it, and the change is stamped.
  perform set_config('request.jwt.claims', v_as_coach, true);
  execute 'set local role authenticated';
  update public.app_sound_settings set rest_done = 'ring', new_record = 'arcade' where id;
  get diagnostics v_n = row_count;
  assert v_n = 1, '3: the coach changes it';
  execute 'reset role';
  select * into r from public.app_sound_settings;
  assert r.rest_done = 'ring' and r.new_record = 'arcade' and r.rest_start = 'classic', '3: the change is saved';
  assert r.updated_by = v_coach and r.updated_at = now(), '3: stamped with the coach and the time';

  -- 4. Only the sets the app has.
  begin
    update public.app_sound_settings set rest_warn = 'whistle' where id;
    assert false, '4: an unknown set is refused';
  exception when check_violation then
    null;
  end;

  -- 5. Never a second row.
  begin
    insert into public.app_sound_settings (id) values (false);
    assert false, '5: a second row is refused';
  exception when check_violation then
    null;
  end;

  -- ---- the coach's own sounds (20261106160000) ------------------------------

  -- 6. «Propio» needs its file.
  begin
    update public.app_sound_settings set rest_done = 'custom', rest_done_file = null where id;
    assert false, '6: custom without a file is refused';
  exception when check_violation then
    null;
  end;

  -- 7. A file is a WAV in custom/, nothing else.
  begin
    update public.app_sound_settings set rest_warn_file = '../meal-photos/x.wav' where id;
    assert false, '7: a path outside custom/ is refused';
  exception when check_violation then
    null;
  end;
  begin
    update public.app_sound_settings set rest_warn_file = 'custom/x.mp3' where id;
    assert false, '7: a file that is not a WAV is refused';
  exception when check_violation then
    null;
  end;

  -- 8. The coach picks an upload; the file stays when a built-in set comes back.
  perform set_config('request.jwt.claims', v_as_coach, true);
  execute 'set local role authenticated';
  update public.app_sound_settings
     set day_complete = 'custom', day_complete_file = 'custom/day_complete-1.wav' where id;
  get diagnostics v_n = row_count;
  assert v_n = 1, '8: the coach picks an uploaded sound';
  update public.app_sound_settings set day_complete = 'bells' where id;
  execute 'reset role';
  select * into r from public.app_sound_settings;
  assert r.day_complete = 'bells' and r.day_complete_file = 'custom/day_complete-1.wav',
    '8: the uploaded file stays for later';

  -- 9. The bucket: public WAVs of 1 MB at most, written by the coach alone.
  assert exists (select 1 from storage.buckets
                  where id = 'app-sounds' and public and file_size_limit = 1048576
                    and allowed_mime_types = array['audio/wav']), '9: the bucket is set up';
  assert (select count(*) from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'app sounds:%') = 4, '9: the bucket has its four policies';
  assert (select bool_and(coalesce(qual, '') || coalesce(with_check, '') like '%is_coach()%')
            from pg_policies
           where schemaname = 'storage' and tablename = 'objects'
             and policyname like 'app sounds: the coach%'), '9: only the coach writes';

  raise exception 'SMOKE OK: app sounds; nothing was saved';
end $$;
