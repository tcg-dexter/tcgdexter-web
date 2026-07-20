-- Drop deck version control entirely — the versioning feature (deck_versions
-- table, create_deck_version() RPC, and the FK columns it added on matches
-- and saved_decks) has been removed from the app; this cleans up the schema
-- to match. saved_decks.deck_list/analysis remain the sole source of truth
-- for a deck's current content (they were already the mirror columns, so no
-- data is lost by dropping the history table).
--
-- Fork lineage (forked_from_deck_id, cloned_from_id) and the deck-level
-- archetype identity columns (archetype_id/name/source, primary_pokemon_name)
-- added alongside versioning in 20260709_fork_lineage_and_archetype.sql are
-- unrelated features and are left in place.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

alter table public.matches
  drop column if exists saved_deck_version_id;

alter table public.saved_decks
  drop column if exists forked_from_version_id;

drop function if exists public.create_deck_version(uuid, text, jsonb, text, text);

drop table if exists public.deck_versions;

commit;
