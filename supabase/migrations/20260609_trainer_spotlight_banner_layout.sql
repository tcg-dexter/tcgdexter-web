-- Trainer Spotlight: programmatic banner. Instead of rendering the
-- favorite cards as separate modules under the header, we place them
-- (plus the favorite-Pokémon sprite and the uploaded user image) as
-- four independently-positionable items inside the banner gradient.
--
-- Layout is a single jsonb keyed by item slot. Each item carries:
--   x:     0-100, percentage across the banner
--   y:     0-100, percentage down the banner
--   scale: multiplier vs the item type's base width (cards, sprite,
--          user image each have their own base footprint)
--
-- Defaults form the editorial preset the admin can drag away from —
-- and that the Reset button restores. avatar_image_position and
-- avatar_image_scale (added earlier) remain on the row for backward
-- compatibility but are no longer read by the page.

alter table public.trainer_spotlights
  add column if not exists banner_layout jsonb not null default jsonb_build_object(
    'collection_card', jsonb_build_object('x', 15, 'y', 55, 'scale', 1.0),
    'pokemon',         jsonb_build_object('x', 38, 'y', 55, 'scale', 1.0),
    'user_image',      jsonb_build_object('x', 58, 'y', 55, 'scale', 1.0),
    'format_card',     jsonb_build_object('x', 85, 'y', 55, 'scale', 1.0)
  );
