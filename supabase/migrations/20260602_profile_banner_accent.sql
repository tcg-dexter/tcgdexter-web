-- Profile banner accent: per-user color for the new /u/[username] header.
-- NULL = signature site (brand) gradient; otherwise one of the 11 energy
-- types whose hex is mapped client-side via ENERGY_HEX.

alter table public.profiles
  add column if not exists banner_accent text;

alter table public.profiles
  drop constraint if exists profiles_banner_accent_check;

alter table public.profiles
  add constraint profiles_banner_accent_check
  check (
    banner_accent is null
    or banner_accent in (
      'Fire','Water','Grass','Lightning','Psychic',
      'Fighting','Darkness','Metal','Dragon','Fairy','Colorless'
    )
  );
