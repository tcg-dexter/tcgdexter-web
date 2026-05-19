-- User card collection / inventory
--
-- One row per (user, printing, variant). A "printing" is identified by
-- (set_id, number) — the same composite key used everywhere else in
-- the app to address a card in the catalog. A "variant" is the finish
-- on that printing: normal, holo, reverse_holo, prize_pack. The set
-- of valid variant keys is enforced at the API layer.
--
-- Quantity is non-negative. The API decrements toward zero and never
-- inserts a zero row, but we keep the constraint as a safety net.

begin;

create table if not exists public.user_card_collection (
  user_id    uuid        not null references auth.users(id) on delete cascade,
  set_id     text        not null,
  number     text        not null,
  variant    text        not null,
  quantity   integer     not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, set_id, number, variant)
);

create index if not exists user_card_collection_user_idx
  on public.user_card_collection (user_id);

alter table public.user_card_collection enable row level security;

drop policy if exists "user_card_collection_owner_select" on public.user_card_collection;
create policy "user_card_collection_owner_select"
  on public.user_card_collection
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "user_card_collection_owner_insert" on public.user_card_collection;
create policy "user_card_collection_owner_insert"
  on public.user_card_collection
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "user_card_collection_owner_update" on public.user_card_collection;
create policy "user_card_collection_owner_update"
  on public.user_card_collection
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_card_collection_owner_delete" on public.user_card_collection;
create policy "user_card_collection_owner_delete"
  on public.user_card_collection
  for delete
  to authenticated
  using (user_id = auth.uid());

commit;
