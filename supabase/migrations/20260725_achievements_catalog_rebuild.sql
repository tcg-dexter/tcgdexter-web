-- Achievements catalog rebuild
--
-- Recreates public.user_achievements from scratch as the store for the
-- first real achievements catalog (Getting Started / Match Grind / Deck
-- Builder). The table keeps the same generic keyed shape as v1 — one row
-- per (user_id, achievement_key), earned once — because that shape is
-- already the right one for a flat, keyed catalog. The catalog itself
-- (keys, names, thresholds) lives in code (lib/learn/achievements.ts),
-- not in rows, so new badges never need a schema change.
--
-- v1 shipped exactly one key, 'certified_trainer' (awarded for a perfect
-- Trainer Quiz). Those earns are real user history, so the rebuild stashes
-- and restores them across the drop — no user loses their quiz badge.
--
-- Count-based badges are NOT written here. They are reconciled from the
-- user's live metrics (saved_decks / matches counts) by
-- reconcileAchievements() in app code, which inserts missing rows
-- idempotently. Existing users self-heal on their next log/save or their
-- next own-profile view.
--
-- Reads stay public (badges render on public profiles, incl. anon
-- viewers). Inserts are gated to the row's own user; there is no update or
-- delete policy (rows are immutable, earned-once). Cascades on
-- auth.users delete, matching v1.

begin;

-- Stash existing earns before the drop. Dropped automatically at commit.
create temporary table _user_achievements_backup on commit drop as
  select user_id, achievement_key, earned_at
  from public.user_achievements;

drop table if exists public.user_achievements;

create table public.user_achievements (
  user_id         uuid        not null references auth.users(id) on delete cascade,
  achievement_key text        not null,
  earned_at       timestamptz not null default now(),
  primary key (user_id, achievement_key)
);

create index user_achievements_key_earned_idx
  on public.user_achievements (achievement_key, earned_at desc);

-- Restore the only real v1 data: Certified Trainer earns. (Guarded to that
-- key so a stray future key wouldn't be resurrected unexpectedly.)
insert into public.user_achievements (user_id, achievement_key, earned_at)
  select user_id, achievement_key, earned_at
  from _user_achievements_backup
  where achievement_key = 'certified_trainer'
  on conflict (user_id, achievement_key) do nothing;

-- RLS
alter table public.user_achievements enable row level security;

-- Public read — profile pages render badges for signed-in and anonymous
-- viewers alike.
drop policy if exists "user_achievements_authenticated_read" on public.user_achievements;
create policy "user_achievements_authenticated_read"
  on public.user_achievements
  for select
  to authenticated
  using (true);

drop policy if exists "user_achievements_anon_read" on public.user_achievements;
create policy "user_achievements_anon_read"
  on public.user_achievements
  for select
  to anon
  using (true);

-- A user can only insert their own achievement rows. The quiz route and
-- reconcileAchievements() are the writers, both under the user's session.
drop policy if exists "user_achievements_owner_insert" on public.user_achievements;
create policy "user_achievements_owner_insert"
  on public.user_achievements
  for insert
  to authenticated
  with check (user_id = auth.uid());

commit;
