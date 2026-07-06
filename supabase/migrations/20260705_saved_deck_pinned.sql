-- Single "pinned" deck per user for the /my-decks hero section. Exclusivity
-- (only one deck pinned at a time) is enforced in the PATCH route, not here —
-- pinning a deck clears the flag on the user's other decks in the same
-- request.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

alter table public.saved_decks
  add column if not exists is_pinned boolean not null default false;

commit;
