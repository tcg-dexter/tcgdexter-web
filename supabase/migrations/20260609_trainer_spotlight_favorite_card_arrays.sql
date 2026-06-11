-- Trainer Spotlight: allow up to 3 favorite collection cards and up to
-- 3 favorite cards to play, rendered as fanned stacks on either side of
-- the banner. The legacy singular columns (favorite_collection_card and
-- favorite_format_card) remain on the row for backward compat but are
-- no longer read by the page or editor.

alter table public.trainer_spotlights
  add column if not exists favorite_collection_cards jsonb not null default '[]'::jsonb,
  add column if not exists favorite_format_cards jsonb not null default '[]'::jsonb;

-- Backfill: lift any existing single-card values into a 1-element array
-- so the editor and renderer have a uniform shape to work against.
update public.trainer_spotlights
set favorite_collection_cards = jsonb_build_array(favorite_collection_card)
where favorite_collection_card is not null
  and jsonb_typeof(favorite_collection_card) = 'object'
  and jsonb_array_length(favorite_collection_cards) = 0;

update public.trainer_spotlights
set favorite_format_cards = jsonb_build_array(favorite_format_card)
where favorite_format_card is not null
  and jsonb_typeof(favorite_format_card) = 'object'
  and jsonb_array_length(favorite_format_cards) = 0;
