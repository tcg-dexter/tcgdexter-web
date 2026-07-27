-- User follows + new_follower notifications
--
-- Adds the social graph on top of the existing notifications substrate:
--   • user_follows (follower -> following) with public-read RLS
--   • denormalized profiles.follower_count / following_count, trigger-synced
--     (mirrors saved_decks.like_count / deck_likes_count_sync)
--   • a partial unique index so a refollow refreshes ONE new_follower
--     notification instead of stacking
--
-- Dedup note — read before touching the follow-dedup index:
--   The index is PARTIAL (where type = 'new_follower'). Postgres CANNOT infer
--   a partial index from a bare ON CONFLICT (cols), which is exactly what
--   silently 42P10'd the deck_liked upsert (fixed in 20260727_notifications_
--   dedup_fix.sql). So notifyNewFollower deliberately does NOT use
--   supabase-js .upsert({onConflict}); it inserts and, on the 23505 this
--   partial unique index raises for a duplicate, updates the existing row.
--   A partial index is therefore safe here.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

begin;

-- ── profiles.follower_count / following_count ──────────────────
alter table public.profiles
  add column if not exists follower_count  integer not null default 0,
  add column if not exists following_count integer not null default 0;

-- ── user_follows ───────────────────────────────────────────────
create table if not exists public.user_follows (
  follower_user_id  uuid not null references auth.users(id) on delete cascade,
  following_user_id uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  primary key (follower_user_id, following_user_id),
  constraint user_follows_no_self check (follower_user_id <> following_user_id)
);

-- Reverse lookup: "who follows this user" + follower-count joins. The PK
-- already covers (follower, following) — this covers the other direction.
create index if not exists user_follows_following_idx
  on public.user_follows (following_user_id);

-- ── RLS ────────────────────────────────────────────────────────
alter table public.user_follows enable row level security;

-- Follows are public: drives follower/following counts, the "do I follow
-- this user?" check, and any future follower/following lists.
drop policy if exists "user_follows_authenticated_read" on public.user_follows;
create policy "user_follows_authenticated_read"
  on public.user_follows for select to authenticated using (true);

-- You may only create your OWN follow, and only of a PUBLIC profile you can
-- actually see (mirrors deck_likes' cascading-visibility rule — you can't
-- follow what you can't view).
drop policy if exists "user_follows_follower_insert" on public.user_follows;
create policy "user_follows_follower_insert"
  on public.user_follows for insert to authenticated
  with check (
    follower_user_id = auth.uid()
    and exists (
      select 1 from public.profiles p
      where p.id = following_user_id and p.is_public = true
    )
  );

-- You may only remove your own follow.
drop policy if exists "user_follows_follower_delete" on public.user_follows;
create policy "user_follows_follower_delete"
  on public.user_follows for delete to authenticated
  using (follower_user_id = auth.uid());

-- ── follower/following count denormalization trigger ───────────
create or replace function public.user_follows_count_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.profiles set following_count = following_count + 1
      where id = new.follower_user_id;
    update public.profiles set follower_count = follower_count + 1
      where id = new.following_user_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.profiles set following_count = greatest(following_count - 1, 0)
      where id = old.follower_user_id;
    update public.profiles set follower_count = greatest(follower_count - 1, 0)
      where id = old.following_user_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists user_follows_count_sync_ins on public.user_follows;
create trigger user_follows_count_sync_ins
  after insert on public.user_follows
  for each row execute function public.user_follows_count_sync();

drop trigger if exists user_follows_count_sync_del on public.user_follows;
create trigger user_follows_count_sync_del
  after delete on public.user_follows
  for each row execute function public.user_follows_count_sync();

-- One-time reconciliation (no-op on a clean install — no follows exist yet).
update public.profiles p set
  follower_count  = (select count(*) from public.user_follows f where f.following_user_id = p.id),
  following_count = (select count(*) from public.user_follows f where f.follower_user_id  = p.id);

-- ── new_follower notification dedup ────────────────────────────
-- One row per (recipient, actor, 'new_follower'); a genuine refollow refreshes
-- it (created_at bumped, read_at cleared) rather than stacking. PARTIAL by
-- type — safe because notifyNewFollower uses insert + 23505->update, never
-- ON CONFLICT inference (see the header dedup note).
create unique index if not exists notifications_follow_dedup_idx
  on public.notifications (recipient_user_id, actor_user_id, type)
  where type = 'new_follower';

commit;
