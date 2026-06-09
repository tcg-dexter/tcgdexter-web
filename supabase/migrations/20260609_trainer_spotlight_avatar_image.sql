-- Trainer Spotlight: optional uploaded foreground image (e.g. the
-- trainer's TCG Live avatar) overlaid on the banner. avatar_image_url
-- is a public URL into the avatars bucket; avatar_image_position is
-- {x, y} as percentages of the banner so the placement scales with
-- whatever banner height the viewport produces.

alter table public.trainer_spotlights
  add column if not exists avatar_image_url text,
  add column if not exists avatar_image_position jsonb not null
    default '{"x": 50, "y": 50}'::jsonb;
