-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- Removes the SQL side of the profile Collection module, which has been
-- taken off user profile pages: the aggregates cost more to compute than
-- the summary they produced was worth. See 20260830_collection_module.sql
-- and 20260830_collection_stats.sql for what they did.
--
-- `drop function` here also removes the PostgREST RPC endpoints, so the
-- schema reload at the bottom IS needed — unlike the index migration this
-- supersedes, this one does change the exposed API surface. Without it the
-- functions stay callable from the client until PostgREST next restarts.

drop function if exists public.collection_stats(uuid);
drop function if exists public.collection_value_history(uuid, integer);
drop function if exists public.can_view_collection(uuid);

-- Added purely to keep collection_value_history() inside the statement
-- timeout on the largest collection (~138k row fetches against a heap with
-- terrible locality). Nothing else reads card_price_history by (card_id,
-- date) in bulk — the card detail chart pulls one card at a time and the
-- primary key already serves it — so with the function gone this is ~1.5M
-- rows of index earning nothing on every write of the daily price pipeline.
drop index if exists public.card_price_history_card_date_price_idx;

-- profiles.collection_public is deliberately LEFT IN PLACE. It is a plain
-- boolean opt-in with no remaining reader (the settings toggle that wrote
-- it is gone too), so it costs nothing dormant, and dropping it would throw
-- away the visibility choices people already made — which is only a problem
-- if this module ever comes back, and only in the direction of exposing a
-- collection someone had kept private.

notify pgrst, 'reload schema';
