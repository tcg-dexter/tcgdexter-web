-- Adds the signed-in user's dark-mode preference so it can sync across
-- devices (the client also caches the resolved value in a dx_theme
-- cookie for instant, no-flash rendering; this column is the durable,
-- cross-device source of truth for signed-in users).

alter table public.profiles
  add column if not exists theme_preference text not null default 'light'
    check (theme_preference in ('light', 'dark', 'system'));
