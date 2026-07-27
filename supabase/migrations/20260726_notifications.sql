-- In-app notifications
--
-- Closes social loops that today are invisible in-app: someone liking your
-- public deck, and earning an achievement badge. One row per notification,
-- addressed to a recipient, optionally crediting an actor (null for system
-- notifs like badges).
--
-- Writes are performed exclusively by the service-role admin client (see
-- lib/notifications/notify.ts) — a liker inserting a row for the deck OWNER
-- is a cross-user write no RLS INSERT policy can sanely allow. Clients get
-- SELECT + UPDATE (mark-read) on their own rows only; no INSERT/DELETE.
--
-- Display data (actor name/handle/avatar, deck name, badge name) is
-- snapshotted into `data` so the feed renders with zero joins — mirroring
-- the app's denormalization philosophy (cf. saved_decks.like_count). A later
-- rename doesn't rewrite history, which is an acceptable trade for cheap reads.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

begin;

create table if not exists public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id     uuid references auth.users(id) on delete set null,
  type              text not null,
  saved_deck_id     uuid references public.saved_decks(id) on delete cascade,
  data              jsonb not null default '{}'::jsonb,
  read_at           timestamptz,
  created_at        timestamptz not null default now()
);

-- Recipient's feed, newest-first.
create index if not exists notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc);

-- Unread-count query behind the nav bell. Partial keeps it tiny.
create index if not exists notifications_unread_idx
  on public.notifications (recipient_user_id)
  where read_at is null;

-- Dedup target for deck_liked upserts: one row per (recipient, actor, deck,
-- type) so like->unlike->like refreshes a single row instead of stacking.
-- Partial (actor + deck present) so badge/system notifs are unaffected.
create unique index if not exists notifications_dedup_idx
  on public.notifications (recipient_user_id, actor_user_id, saved_deck_id, type)
  where actor_user_id is not null and saved_deck_id is not null;

-- ── RLS ────────────────────────────────────────────────────────
alter table public.notifications enable row level security;

-- Recipient reads only their own notifications.
drop policy if exists "notifications_recipient_select" on public.notifications;
create policy "notifications_recipient_select"
  on public.notifications
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

-- Recipient can update only their own rows (the app only ever sets read_at;
-- RLS can't restrict columns, so the with-check just re-asserts ownership).
drop policy if exists "notifications_recipient_update" on public.notifications;
create policy "notifications_recipient_update"
  on public.notifications
  for update
  to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

-- No INSERT/DELETE policy: clients cannot forge notifications to other users
-- or delete history. All inserts go through the admin client; deletes happen
-- only in the account-deletion route (also admin client).

commit;
