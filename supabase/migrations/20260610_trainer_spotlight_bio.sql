-- Trainer Spotlight: long-form bio body displayed above the featured
-- decks on the published page. Separate from `headline`, which is the
-- short tagline shown inside the banner block.

alter table public.trainer_spotlights
  add column if not exists bio text;
