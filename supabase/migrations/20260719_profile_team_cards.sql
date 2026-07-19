-- Team of 7: replaces team_of_6 (bare Pokémon species names, rendered as
-- sprites) with team_cards — an ordered array of up to 7 specific card
-- references, fanned across the profile banner the same way the meta
-- archetype header fans its top cards. Each entry is null (empty slot) or
-- {name, set_id, number} identifying an exact printing; image URLs are
-- derived client-side via cardImageLarge(), so we don't store them here.

alter table public.profiles
  drop constraint if exists profiles_team_of_6_check;

alter table public.profiles
  drop column if exists team_of_6;

alter table public.profiles
  add column if not exists team_cards jsonb;

alter table public.profiles
  drop constraint if exists profiles_team_cards_check;

alter table public.profiles
  add constraint profiles_team_cards_check
  check (
    team_cards is null
    or (
      jsonb_typeof(team_cards) = 'array'
      and jsonb_array_length(team_cards) <= 7
    )
  );
