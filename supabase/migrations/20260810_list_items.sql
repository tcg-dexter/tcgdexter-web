-- List items: card membership for the lists table (20260810_lists.sql).
--
-- A printing is addressed by (set_id, number) — the same composite key
-- used everywhere else in the app (user_card_collection, profiles.team_cards,
-- deck-list analysis) to identify a card. There is no `cards` table to FK
-- against: the catalog is a static in-memory index (lib/cardsIndex.ts),
-- not a DB table.
--
-- No `variant` column (unlike user_card_collection) — a list tracks
-- presence, not owned quantity/finish, so (list_id, set_id, number) is a
-- sufficient, FULL (non-partial) primary key. That matters: a partial
-- unique index can't be an ON CONFLICT inference target (see CLAUDE.md's
-- migration gotcha, and 20260727_notifications_dedup_fix.sql) — this
-- table has no such trap since nothing here is partial.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

begin;

create table if not exists public.list_items (
  list_id    uuid not null references public.lists(id) on delete cascade,
  set_id     text not null,
  number     text not null,
  created_at timestamptz not null default now(),
  primary key (list_id, set_id, number)
);

create index if not exists list_items_list_idx
  on public.list_items (list_id);

-- ── RLS ────────────────────────────────────────────────────────
alter table public.list_items enable row level security;

-- list_items has no user_id column of its own — ownership is derived
-- through list_id -> lists.user_id. No update policy: items are toggled
-- by insert/delete only, never mutated in place.
drop policy if exists "list_items_owner_select" on public.list_items;
create policy "list_items_owner_select"
  on public.list_items for select to authenticated
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_items.list_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "list_items_owner_insert" on public.list_items;
create policy "list_items_owner_insert"
  on public.list_items for insert to authenticated
  with check (
    exists (
      select 1 from public.lists l
      where l.id = list_items.list_id and l.user_id = auth.uid()
    )
  );

drop policy if exists "list_items_owner_delete" on public.list_items;
create policy "list_items_owner_delete"
  on public.list_items for delete to authenticated
  using (
    exists (
      select 1 from public.lists l
      where l.id = list_items.list_id and l.user_id = auth.uid()
    )
  );

-- Cascading public read, one join deeper than lists_public_read: the
-- parent list must be public AND the owning profile must be public.
drop policy if exists "list_items_public_read" on public.list_items;
create policy "list_items_public_read"
  on public.list_items for select to anon, authenticated
  using (
    exists (
      select 1 from public.lists l
      join public.profiles p on p.id = l.user_id
      where l.id = list_items.list_id
        and l.is_public = true
        and p.is_public = true
    )
  );

commit;
