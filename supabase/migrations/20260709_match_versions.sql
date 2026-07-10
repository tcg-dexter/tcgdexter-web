-- Deck version control, part 2: matches record which version was played.
--
-- Nullable + ON DELETE SET NULL so match history never blocks anything;
-- deck-level aggregation (computeDeckRecords) keeps keying off
-- saved_deck_id. Existing matches predate versioning, so they attach to
-- their deck's v1 — the only truthful anchor for history that old.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

alter table public.matches
  add column if not exists saved_deck_version_id uuid references public.deck_versions(id) on delete set null;

create index if not exists matches_version_idx
  on public.matches (saved_deck_version_id);

update public.matches m
set saved_deck_version_id = v.id
from public.deck_versions v
where v.deck_id = m.saved_deck_id
  and v.version_number = 1
  and m.saved_deck_version_id is null;

commit;
