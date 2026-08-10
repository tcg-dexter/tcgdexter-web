-- Lists: named, user-owned collections of specific card printings.
--
-- A user can curate an arbitrary named list of cards (a want list, trade
-- bait, cards for a deck they're planning) independent of the owned-card
-- inventory tracked by user_card_collection. Lists are public/shareable
-- like saved_decks — same cascading-visibility rule (list AND owner
-- profile must both be public), same short_id share-URL pattern.
--
-- Card membership itself lives in list_items (20260810_list_items.sql),
-- a separate migration so the FK ordering is trivially correct.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

begin;

-- Mirrors generate_saved_deck_short_id() (20260620_saved_deck_short_id.sql)
-- exactly — same alphabet, same 8-byte nanoid-style approach — kept as its
-- own function rather than reused so lists' short_id generation doesn't
-- depend on a saved_decks-named function.
create or replace function generate_list_short_id()
returns text as $$
declare
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  id text := '';
  i int := 0;
  bytes bytea;
begin
  bytes := gen_random_bytes(8);
  while i < 8 loop
    id := id || substr(alphabet, 1 + (get_byte(bytes, i) & 63), 1);
    i := i + 1;
  end loop;
  return id;
end;
$$ language plpgsql volatile;

create table if not exists public.lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  is_public  boolean not null default false,
  short_id   text not null unique default generate_list_short_id(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Mirrors saved_decks_public_idx — supports the cascading-visibility read
-- policy below without scanning private rows.
create index if not exists lists_public_idx
  on public.lists (user_id)
  where is_public = true;

create or replace function public.lists_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists lists_updated_at on public.lists;
create trigger lists_updated_at
  before update on public.lists
  for each row execute function public.lists_set_updated_at();

-- ── RLS ────────────────────────────────────────────────────────
alter table public.lists enable row level security;

drop policy if exists "lists_owner_select" on public.lists;
create policy "lists_owner_select"
  on public.lists for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "lists_owner_insert" on public.lists;
create policy "lists_owner_insert"
  on public.lists for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists "lists_owner_update" on public.lists;
create policy "lists_owner_update"
  on public.lists for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "lists_owner_delete" on public.lists;
create policy "lists_owner_delete"
  on public.lists for delete to authenticated
  using (user_id = auth.uid());

-- Cascading public read: list must be public AND owner profile must be
-- public — same rule as saved_decks_public_read (20260428_phase1_visibility.sql).
drop policy if exists "lists_public_read" on public.lists;
create policy "lists_public_read"
  on public.lists for select to anon, authenticated
  using (
    is_public = true
    and exists (
      select 1 from public.profiles p
      where p.id = lists.user_id and p.is_public = true
    )
  );

commit;
