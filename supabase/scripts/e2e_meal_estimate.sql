-- ==========================================================================
-- End-to-end check of meal estimates (docs/ADMIN_WEB_DB_CONNECTION.md §6.6).
--
-- Run it in the Supabase SQL editor after the migration and the Vault
-- secrets, in three parts. Replace <client-uuid> with a test client's id
-- (profiles.id) everywhere. If an earlier run left its rows, run Part 3 first.
--
-- The failure path uses the same script: set the function secret
-- ESTIMATE_FAIL_USER_ID to the same uuid, run Part 1, and Part 2 then shows
-- the row still pending with estimate_attempts = 1 and the next try about a
-- minute ahead. Remove the secret and it lands as done within ~4 minutes.
-- ==========================================================================

-- Part 1: register an «otra cosa» as that client. It commits, so the
-- trigger's request to estimate-meal goes out.
begin;
select set_config('request.jwt.claims',
                  json_build_object('sub', '<client-uuid>', 'role', 'authenticated')::text, true);
insert into public.meals (id, user_id, name, meal_type, date)
values ('00000000-0000-4000-8000-0000000e2e01', '<client-uuid>', 'e2e', 'lunch', current_date);
insert into public.meal_items (id, meal_id, user_id, name, kind, original_text)
values ('00000000-0000-4000-8000-0000000e2e02', '00000000-0000-4000-8000-0000000e2e01', '<client-uuid>',
        'arros con poyo', 'other', 'arros con poyo');
commit;

-- Part 2: about 30 seconds later.
-- Expected: estimate_status = done, name = Arroz con pollo, calories > 0.
select estimate_status, name, original_text, calories, protein_g, carbs_g, fat_g,
       estimate_attempts, estimate_next_at
  from public.meal_items
 where id = '00000000-0000-4000-8000-0000000e2e02';
-- Still pending? Why it failed:
--   select created_at, attempt, error from public.meal_estimate_errors
--    where meal_item_id = '00000000-0000-4000-8000-0000000e2e02' order by id desc;
-- the call and its answer:
--   select id, status_code, content from net._http_response order by id desc limit 3;
-- and estimate-meal's logs in the dashboard (Edge Functions → estimate-meal → Logs).

-- Part 3: clean up (deleting the container removes its item).
delete from public.meals where id = '00000000-0000-4000-8000-0000000e2e01';
