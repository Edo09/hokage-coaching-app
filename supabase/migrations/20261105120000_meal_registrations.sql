-- ==========================================================================
-- Meal registrations: the client's plan meals, estimated on the server.
--
-- The app's Nutrición tab no longer keeps a free-form diary. For each of
-- today's plan meals the client registers what they ate: the plan option,
-- «otra cosa» (typed), or «No la comí». A registration is one meal_items row
-- in the day's meals container, as diary entries were, so the coach panel,
-- Inicio and Progreso keep reading the same tables. Design:
-- docs/superpowers/specs/2026-11-05-nutrition-meal-registration-design.md.
--
-- New meal_items columns (the app and the panel read these names):
--   plan_meal_id       the plan meal the row registers (on delete set null)
--   kind               'plan' | 'other' | 'skipped'; null = an old diary row,
--                      which old app builds keep writing and nothing here
--                      ever touches
--   original_text      «otra cosa» exactly as the client typed it; name gets
--                      the spelling-corrected text once the estimate lands
--   estimate_status    'pending' | 'done' | 'failed'; null on old diary rows
--                      and on «No la comí»
--   estimate_version, estimate_attempts, estimate_next_at
--                      server bookkeeping, see meal_items_estimate_state()
--
-- Who may change what. A client write is one made with the client's JWT,
-- directly: auth.uid() set and pg_trigger_depth() = 1 (as in
-- stamp_set_log_snapshot). The server owns the estimate: whatever a client
-- sends for the status, the numbers, the version, the attempts or the next
-- try is replaced, except a failed row marked pending again (a retry).
-- Writes by estimate-meal (service role), pg_cron, the SQL editor and
-- cascades (the coach's plan save nulls links one trigger level down) pass
-- through untouched.
--
-- Sending. AFTER triggers post {id, version} through pg_net to the
-- estimate-meal Edge Function, with the secret from Supabase Vault
-- (estimate_meal_url, estimate_meal_secret, both set by hand); a pg_cron job
-- re-sends lost calls and a daily one retries recent failures. The function
-- writes back through service-role-only RPCs, and only while the row's
-- version still matches. No trigger here ever fails the client's write: the
-- app's outbox drops any write the database rejects.
--
-- Additive and idempotent. Run in the Supabase SQL editor after deploying
-- estimate-meal and setting its secrets (docs/ADMIN_WEB_DB_CONNECTION.md §6.6).
-- ==========================================================================

begin;

-- 1) Columns, version sequence, indexes -------------------------------------------
alter table public.meal_items
  add column if not exists plan_meal_id uuid references public.nutrition_plan_meals(id) on delete set null,
  add column if not exists kind text check (kind in ('plan', 'other', 'skipped')),
  add column if not exists original_text text,
  add column if not exists estimate_status text check (estimate_status in ('pending', 'done', 'failed')),
  add column if not exists estimate_version bigint,
  add column if not exists estimate_attempts smallint not null default 0,
  add column if not exists estimate_next_at timestamptz;

-- One global sequence, not a per-row counter: a row re-inserted under the
-- same id after an undo never reuses a version an earlier answer carries.
create sequence if not exists public.meal_estimate_version_seq;
revoke all on sequence public.meal_estimate_version_seq from public, anon, authenticated;

create index if not exists idx_meal_items_plan_meal
  on public.meal_items(plan_meal_id) where plan_meal_id is not null;
create index if not exists idx_meal_items_estimate_due
  on public.meal_items(estimate_next_at) where estimate_status = 'pending';
create index if not exists idx_meal_items_estimate_failed
  on public.meal_items(created_at) where estimate_status = 'failed';

-- 2) Vault check and dangling links ------------------------------------------------
-- Whether estimate-meal can be called: both secrets are in Vault. Never raises.
create or replace function public.meal_estimate_configured()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return exists (select 1 from vault.decrypted_secrets where name = 'estimate_meal_url')
     and exists (select 1 from vault.decrypted_secrets where name = 'estimate_meal_secret');
exception when others then
  return false;
end;
$$;

revoke all on function public.meal_estimate_configured() from public, anon, authenticated;

-- A registration queued offline can arrive after the coach removed its option
-- or meal. The foreign key would refuse it, and the outbox would drop it, so
-- the link is dropped instead. The check takes the lock the foreign key would
-- (for key share): it waits for a coach's save that is deleting the row, then
-- sees it gone. Links are checked only when they change, so the cron's and the
-- function's updates take no plan locks.
create or replace function public.meal_items_drop_missing_links()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    if new.plan_option_id is not null
       and (tg_op = 'INSERT' or new.plan_option_id is distinct from old.plan_option_id) then
      perform 1 from public.nutrition_plan_options where id = new.plan_option_id for key share;
      if not found then
        new.plan_option_id := null;
      end if;
    end if;
    if new.plan_meal_id is not null
       and (tg_op = 'INSERT' or new.plan_meal_id is distinct from old.plan_meal_id) then
      perform 1 from public.nutrition_plan_meals where id = new.plan_meal_id for key share;
      if not found then
        new.plan_meal_id := null;
      end if;
    end if;
  exception when others then
    raise warning 'meal_items %: link check skipped: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.meal_items_drop_missing_links() from public, anon, authenticated;

drop trigger if exists trg_meal_items_10_links on public.meal_items;
create trigger trg_meal_items_10_links
  before insert or update of plan_option_id, plan_meal_id on public.meal_items
  for each row
  execute function public.meal_items_drop_missing_links();

-- 3) The estimate state ---------------------------------------------------------------
-- The app writes whole rows from its cache, which can be stale, so for a
-- client write this trigger decides the server-owned columns itself:
--   * content is name + photo for a plan row, original_text + photo for
--     «otra cosa», the kind alone for «No la comí»; a kind change is content;
--   * a new or changed plan / «otra cosa» row starts a send: pending, numbers
--     0, a new version, and (with Vault set) attempt 1 with the next try one
--     3-minute lease ahead — the AFTER trigger then posts it;
--   * a failed row marked pending again is a retry, handled the same way;
--   * anything else keeps the server's status, numbers and corrected name,
--     so a replayed write never re-runs a finished estimate.
create or replace function public.meal_items_estimate_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client  boolean := auth.uid() is not null and pg_trigger_depth() = 1;
  v_content boolean;
  v_retry   boolean;
begin
  if not v_client or new.kind is null then
    return new;
  end if;

  begin
    if tg_op = 'UPDATE' then
      new.estimate_version  := old.estimate_version;
      new.estimate_attempts := old.estimate_attempts;
      new.estimate_next_at  := old.estimate_next_at;
    else
      new.estimate_version  := null;
      new.estimate_attempts := 0;
      new.estimate_next_at  := null;
    end if;

    if new.kind = 'skipped' then
      new.estimate_status := null;
      new.calories := 0;
      new.protein_g := 0;
      new.carbs_g := 0;
      new.fat_g := 0;
      new.photo_path := null;
      new.original_text := null;
      if tg_op = 'INSERT' or old.kind is distinct from 'skipped' then
        new.estimate_version := nextval('public.meal_estimate_version_seq');
      end if;
      return new;
    end if;

    if new.kind = 'other' then
      if tg_op = 'INSERT' or old.kind is distinct from 'other'
         or new.original_text is distinct from old.original_text then
        new.original_text := coalesce(new.original_text, new.name);
        new.name := new.original_text;
      else
        new.name := old.name;            -- keep the server's correction
      end if;
    end if;

    v_content := tg_op = 'INSERT'
              or new.kind is distinct from old.kind
              or new.photo_path is distinct from old.photo_path
              or (new.kind = 'plan' and new.name is distinct from old.name)
              or (new.kind = 'other' and new.original_text is distinct from old.original_text);
    v_retry := tg_op = 'UPDATE' and old.estimate_status = 'failed' and new.estimate_status = 'pending';

    if v_content or v_retry then
      new.estimate_status := 'pending';
      new.calories := 0;
      new.protein_g := 0;
      new.carbs_g := 0;
      new.fat_g := 0;
      new.estimate_version := nextval('public.meal_estimate_version_seq');
      if public.meal_estimate_configured() then
        new.estimate_attempts := 1;
        new.estimate_next_at := now() + interval '3 minutes';
      else
        new.estimate_attempts := 0;
        new.estimate_next_at := now();
      end if;
    else
      new.estimate_status := old.estimate_status;
      new.calories := old.calories;
      new.protein_g := old.protein_g;
      new.carbs_g := old.carbs_g;
      new.fat_g := old.fat_g;
    end if;
  exception when others then
    raise warning 'meal_items %: estimate state not applied: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.meal_items_estimate_state() from public, anon, authenticated;

drop trigger if exists trg_meal_items_20_estimate on public.meal_items;
create trigger trg_meal_items_20_estimate
  before insert or update on public.meal_items
  for each row
  execute function public.meal_items_estimate_state();
