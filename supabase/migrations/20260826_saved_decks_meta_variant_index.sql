-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- Distinguishes which of a meta archetype's top-N variant deck lists a
-- given saved_decks row was cloned from. Without this, every variant
-- card for the same archetype shared one "is this saved?" lookup keyed
-- only on meta_archetype_id, so saving ONE variant made every variant
-- preview card on the meta archetype page show as saved.
alter table public.saved_decks
  add column meta_variant_index integer;

comment on column public.saved_decks.meta_variant_index is
  'Index into the archetype''s variant list (0-based) this row was cloned from, when archetype_source is auto via the meta clone endpoint. NULL for pre-existing rows and non-meta saves.';
