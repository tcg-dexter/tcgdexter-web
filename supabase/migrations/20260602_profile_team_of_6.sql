-- Team of Six: the user's chosen Pokémon roster, displayed as 6 circle
-- avatars in the /u/[username] banner. Each entry is a Pokémon name
-- string (display form, e.g. "Pikachu") or null for an empty slot.
-- Sprite URLs are derived client-side via the existing pokemonSlug()
-- helper, so we don't store image URLs here.
--
-- Shape: jsonb array, length <= 6, each item null or a short string.
-- Constraint allows null to keep the default behaviour clean.

alter table public.profiles
  add column if not exists team_of_6 jsonb;

alter table public.profiles
  drop constraint if exists profiles_team_of_6_check;

alter table public.profiles
  add constraint profiles_team_of_6_check
  check (
    team_of_6 is null
    or (
      jsonb_typeof(team_of_6) = 'array'
      and jsonb_array_length(team_of_6) <= 6
    )
  );
