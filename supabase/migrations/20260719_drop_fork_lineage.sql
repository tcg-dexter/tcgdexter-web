-- Drop fork lineage — the "GitHub-style fork" feature (a dedicated /fork
-- endpoint plus forked_from_deck_id tracking + deck_fork_count()) is
-- abandoned along with deck version control. It was never wired into any
-- UI (no fork button, no fork-count display) — backend scaffolding only.
--
-- The plain clone/save-to-library concept (cloned_from_id) predates the
-- fork effort and is unaffected — it's how DeckCardFooter's Save button
-- has always worked and stays in place.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

drop function if exists public.deck_fork_count(uuid);

drop index if exists public.saved_decks_forked_from_idx;

alter table public.saved_decks
  drop column if exists forked_from_deck_id;

commit;
