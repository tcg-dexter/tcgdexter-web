-- Trainer Spotlight: aspect-preserving scale for the banner image. Stored
-- as a multiplier of the base image width (32% of banner width). 1.0 is
-- the natural default ("scale to fit" reset value); the check cap of 4
-- keeps the image from running away if a slider/wheel gesture overshoots.

alter table public.trainer_spotlights
  add column if not exists avatar_image_scale numeric not null default 1.0
    check (avatar_image_scale > 0 and avatar_image_scale <= 4);
