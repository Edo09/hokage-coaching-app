-- ==========================================================================
-- Supplement check-off (docs/COACH-NUTRITION-SPEC.md P1-4).
--
-- One row = "the client took this supplement on this day". The checkbox in
-- the app's Suplementos pane writes/removes it; the coach reads adherence.
--
-- Keyed by the supplement's NAME, not supplement_plan_items.id:
-- save_supplement_plan replaces every item on each coach save (new ids), so an
-- id-keyed tick would vanish the moment the coach fixed a typo mid-day. The
-- name is what the client actually took, and it survives edits and plan
-- swaps alike.
--
-- Additive, idempotent. Run in the Supabase SQL editor.
-- ==========================================================================

begin;

create table if not exists public.supplement_intake_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  taken_on date not null,
  supplement_name text not null check (length(trim(supplement_name)) > 0),
  created_at timestamptz not null default now(),
  -- One tick per supplement per day per client.
  unique (user_id, taken_on, supplement_name)
);
create index if not exists idx_supplement_intake_user_day
  on public.supplement_intake_logs(user_id, taken_on);

alter table public.supplement_intake_logs enable row level security;

drop policy if exists "client manages own supplement intake" on public.supplement_intake_logs;
create policy "client manages own supplement intake" on public.supplement_intake_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "coach reads all supplement intake" on public.supplement_intake_logs;
create policy "coach reads all supplement intake" on public.supplement_intake_logs for select
  using (public.is_coach());

grant select, insert, update, delete on public.supplement_intake_logs to authenticated;

commit;
