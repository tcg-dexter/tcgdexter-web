-- Personal "favorite" flag on saved decks — a private organizational bookmark
-- for the owner's own /my-decks collection view. Distinct from the existing
-- public deck_likes/like_count feature: favorites are never shown to other
-- users and carry no count, they only drive the owner's own filter/sort.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

alter table public.saved_decks
  add column if not exists is_favorite boolean not null default false;

commit;
