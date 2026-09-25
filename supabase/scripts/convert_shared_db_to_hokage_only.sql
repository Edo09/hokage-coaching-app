-- ==========================================================================
-- ONE-OFF: turn the SHARED Supabase project into Hokage's own database.
--
-- Until now Hokage and Zyron (the self-serve app, previously "zenfit") shared
-- this project. Zyron moves to a project of its own
-- (zenfit/supabase/zyron_database_setup.sql), so this one becomes Hokage-only:
--
--   1) Zyron's users -- and everything they own -- are deleted.
--   2) The three Zyron-only migrations are reverted, so the schema ends up
--      exactly what hokage-coaching-app/supabase/migrations produces (once
--      20260925120000_plan_edits_keep_history is applied too -- step e):
--        20260826120000_zyron_app_scope       -> profiles.app dropped
--        20260826120100_realtime_coach_routines -> routines off realtime
--        20260827120000_routine_templates      -> routine templates removed,
--                                                 Hokage's save_coach_routine back
--
-- Not a migration (a fresh Hokage database never has any of this); lives in
-- supabase/scripts so a rebuild never runs it. Safe to re-run: a second run
-- finds nothing to do. One transaction -- if anything fails, nothing changes.
--
-- ORDER (do not skip):
--   a) Zyron already runs on its NEW project, and a Zyron build pointing there
--      passed a smoke test (sign up + open a screen). Any Zyron build still
--      pointing HERE breaks after this script -- and its users are deleted.
--   b) Dashboard -> Authentication -> Sign In / Providers: turn OFF "Allow new
--      users to sign up" NOW, before the script, so no stray sign-up lands in
--      the coach's roster. Hokage accounts are created only by create-client
--      (auth.admin.createUser), which the toggle does not affect.
--   c) Run STEP 0 below and read it -- especially the coach_content column.
--   d) Run this whole file in the Supabase SQL editor.
--   e) If not applied yet, run supabase/migrations/20260925120000_plan_edits_keep_history.sql
--      (before or after this file -- same result). The new web panel and app
--      builds read its columns. Applied already if this returns a row:
--        select 1 from information_schema.columns
--         where table_name = 'workout_set_logs' and column_name = 'exercise_name';
--   f) Deploy the web panel (it no longer filters on profiles.app; the old one
--      errors on the dropped column) and ship the app build.
--   g) Make sure this project runs HOKAGE's create-client (zenfit's copy hands
--      out 'Zyr-' temp passwords): from hokage-coaching-app run
--        supabase functions deploy create-client --project-ref rzgwkwxskrovxnnymxqo
--      (SUPABASE_SERVICE_ROLE_KEY is provided to functions automatically.)
--   h) Storage -> meal-photos: delete the orphaned folders listed by the query
--      at the end of this file. SQL can't remove Storage files.
-- ==========================================================================

-- STEP 0 — PREVIEW. Run these SELECTs on their own first; they change nothing.
--
--   -- Who gets deleted (Zyron-tagged or self-serve accounts). coach_content
--   -- not empty = a coach worked with them: the script refuses those until you
--   -- decide (see section 1) -- a Hokage client who once signed in to Zyron
--   -- shows up here too, because Zyron re-tags whoever signs in.
--   select p.id, p.email, p.display_name, p.role, p.app, p.account_type, p.created_at,
--          concat_ws(', ',
--            case when exists (select 1 from public.programs x where x.user_id = p.id) then 'program' end,
--            case when exists (select 1 from public.nutrition_plans x where x.user_id = p.id) then 'nutrition plan' end,
--            case when exists (select 1 from public.supplement_plans x where x.user_id = p.id) then 'supplement plan' end,
--            case when exists (select 1 from public.memberships x where x.client_id = p.id) then 'membership' end,
--            case when exists (select 1 from public.routines x where x.user_id = p.id and x.assigned_by is not null) then 'coach routine' end,
--            case when exists (select 1 from public.meals x where x.user_id = p.id and x.assigned_by is not null) then 'coach meal' end
--          ) as coach_content
--     from public.profiles p
--    where p.app = 'zyron' or p.account_type = 'solo'
--    order by p.role, p.created_at;
--
--   -- Everyone who stays. A Zyron user who signed up before 26 Aug and never
--   -- opened Zyron again may still say app = 'hokage' -- if you spot one, add
--   -- its id to v_extra in section 1.
--   select id, email, display_name, role, app, account_type, created_at
--     from public.profiles
--    where not (app = 'zyron' or account_type = 'solo')
--    order by role, created_at;
--
--   -- Zyron's routine templates (removed in section 2):
--   select id, name, assigned_by, created_at from public.routines where is_template;

begin;

-- 1) Remove Zyron's users ------------------------------------------------------
--    Deleting the auth user cascades through every table they own (profiles,
--    routines, meals, logs, measurements, plans, memberships...); rows they
--    merely AUTHORED for others keep existing with assigned_by set to null.
--    A coach account is never deleted silently -- see the exception below.
do $$
declare
  -- Ids (from STEP 0) of Zyron users still tagged app = 'hokage'. Example:
  --   '{00000000-0000-0000-0000-000000000000}'
  v_extra   uuid[] := '{}';
  -- Ids of Zyron users WITH coach content (STEP 0 coach_content) that you have
  -- checked really are Zyron's and may be deleted anyway.
  v_confirm_delete uuid[] := '{}';
  v_ids     uuid[];
  v_coaches text;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles' and column_name = 'app') then
    execute $q$ select coalesce(array_agg(id), '{}') from public.profiles
                 where app = 'zyron' or account_type = 'solo' $q$ into v_ids;
  else
    select coalesce(array_agg(id), '{}') into v_ids from public.profiles where account_type = 'solo';
  end if;
  v_ids := array(select distinct unnest(v_ids || v_extra));

  select string_agg(coalesce(email, id::text), ', ') into v_coaches
    from public.profiles where id = any(v_ids) and role = 'coach';
  if v_coaches is not null then
    raise exception 'Refusing to delete coach account(s) that are tagged as Zyron: %', v_coaches
      using hint = 'If one of them is the Hokage coach (e.g. it once signed in to the Zyron app, which re-tags the profile), '
                || 'first run: update public.profiles set app = ''hokage'', account_type = ''coached'' where email = ''<coach email>''; '
                || 'then run this file again. If it is a Zyron-only coach, delete it from Authentication -> Users first.';
  end if;

  -- Signing in to the Zyron app re-tags ANY profile as 'zyron' -- a Hokage
  -- client who once tried Zyron included. Anyone a coach has worked with
  -- (program, plan, membership, assigned routine/meal) is never deleted
  -- silently: either they're a Hokage client to keep, or you confirm them.
  select string_agg(coalesce(p.email, p.id::text), ', ') into v_coaches
    from public.profiles p
   where p.id = any(v_ids)
     and not (p.id = any(v_confirm_delete))
     and (   exists (select 1 from public.programs x         where x.user_id = p.id)
          or exists (select 1 from public.nutrition_plans x  where x.user_id = p.id)
          or exists (select 1 from public.supplement_plans x where x.user_id = p.id)
          or exists (select 1 from public.memberships x      where x.client_id = p.id)
          or exists (select 1 from public.routines x where x.user_id = p.id and x.assigned_by is not null)
          or exists (select 1 from public.meals x    where x.user_id = p.id and x.assigned_by is not null));
  if v_coaches is not null then
    raise exception 'Refusing to delete user(s) a coach has worked with: %', v_coaches
      using hint = 'A Hokage client re-tagged by signing in to Zyron? Keep them: '
                || 'update public.profiles set app = ''hokage'', account_type = ''coached'' where email in (''...''); '
                || 'A Zyron user you checked? Add their id to v_confirm_delete. Then run this file again.';
  end if;

  delete from auth.users where id = any(v_ids);
  raise notice 'Removed % Zyron user(s) and everything they owned.', cardinality(v_ids);
end $$;

-- 2) Revert 20260827120000_routine_templates (Zyron's routine library) --------
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'routines' and column_name = 'is_template') then
    -- Exercises of a real (client) routine always carry its owner; repair any
    -- that don't before the NOT NULL comes back.
    update public.routine_exercises re
       set user_id = r.user_id
      from public.routines r
     where r.id = re.routine_id
       and re.user_id is null
       and r.user_id is not null;
    -- Templates have no owner; their exercises cascade, and any workout_logs /
    -- assigned copies pointing at them just lose the link (ON DELETE SET NULL).
    execute 'delete from public.routines where is_template or user_id is null';
  end if;
end $$;

drop function if exists public.assign_routine_template(uuid, uuid, text);
drop function if exists public.save_routine_as_template(uuid, text);

alter table public.routines drop constraint if exists routines_template_shape;
alter table public.routines drop column if exists template_id;   -- drops idx_routines_template_id
alter table public.routines drop column if exists is_template;   -- drops idx_routines_is_template
alter table public.routines          alter column user_id set not null;
alter table public.routine_exercises alter column user_id set not null;

-- Hokage's own save_coach_routine (20260720120000_save_coach_routine_rpc.sql),
-- replacing the template-aware version Zyron installed over it. Same signature.
create or replace function public.save_coach_routine(
  p_routine_id   uuid,
  p_client_id    uuid,
  p_name         text,
  p_description  text,
  p_day_of_week  text,
  p_exercises    jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_routine_id uuid;
begin
  if not public.is_coach() then
    raise exception 'Only a coach may assign routines' using errcode = '42501';
  end if;

  if p_routine_id is null then
    insert into public.routines (user_id, assigned_by, source, name, description, day_of_week)
    values (p_client_id, auth.uid(), 'coach', p_name, p_description, p_day_of_week)
    returning id into v_routine_id;
  else
    update public.routines
       set name        = p_name,
           description = p_description,
           day_of_week = p_day_of_week
     where id = p_routine_id
    returning id into v_routine_id;

    if v_routine_id is null then
      raise exception 'Routine % not found', p_routine_id using errcode = 'no_data_found';
    end if;

    -- Replace the exercise list wholesale (routine_exercises has no identity
    -- worth preserving; the app orders by sort_order).
    delete from public.routine_exercises where routine_id = v_routine_id;
  end if;

  insert into public.routine_exercises
    (routine_id, user_id, exercise_id, sets, reps, weight_kg, rest_seconds, sort_order, notes)
  select
    v_routine_id,
    p_client_id,
    (e->>'exercise_id')::uuid,
    (e->>'sets')::int,
    (e->>'reps')::int,
    nullif(e->>'weight_kg', '')::numeric,
    (e->>'rest_seconds')::int,
    (e->>'sort_order')::int,
    nullif(e->>'notes', '')
  from jsonb_array_elements(coalesce(p_exercises, '[]'::jsonb)) as e;

  return v_routine_id;
end;
$$;

revoke all     on function public.save_coach_routine(uuid, uuid, text, text, text, jsonb) from public;
grant  execute on function public.save_coach_routine(uuid, uuid, text, text, text, jsonb) to authenticated;

-- 3) Revert 20260826120100_realtime_coach_routines ------------------------------
--    Hokage's app subscribes to programs / nutrition / supplement plans only.
do $$
begin
  if exists (select 1 from pg_publication_tables
              where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'routines') then
    alter publication supabase_realtime drop table public.routines;
  end if;
end $$;
alter table public.routines replica identity default;

-- 4) Revert 20260826120000_zyron_app_scope ----------------------------------------
--    One app per project now, so there is nothing left to scope.
drop index if exists public.idx_profiles_app;
alter table public.profiles drop column if exists app;   -- drops profiles_app_check

commit;

-- Step h — meal-photo folders whose owner no longer exists (every deleted
-- user, v_extra ones included). Delete them in Storage -> meal-photos:
--   select split_part(name, '/', 1) as orphan_folder, count(*) as files
--     from storage.objects
--    where bucket_id = 'meal-photos'
--      and split_part(name, '/', 1) not in (select id::text from public.profiles)
--    group by 1;

-- Verify (each should return 0 rows / false):
--   select * from public.profiles where account_type = 'solo';
--   select column_name from information_schema.columns
--    where table_schema = 'public'
--      and (table_name, column_name) in (('profiles','app'), ('routines','is_template'), ('routines','template_id'));
--   select proname from pg_proc where proname in ('assign_routine_template', 'save_routine_as_template');
--   select tablename from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'routines';
