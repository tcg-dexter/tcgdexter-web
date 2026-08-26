-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- One-time data fix. These 4 users signed up before first-sign-in
-- banner_accent randomization existed (app/auth/callback/route.ts), so they
-- were stuck on the site-gradient default. Assigns each a distinct random
-- accent from the same set the picker/DB check allow.
update public.profiles set banner_accent = 'Psychic' where username = 'misty';
update public.profiles set banner_accent = 'Lightning' where username = 'brock';
update public.profiles set banner_accent = 'Metal' where username = '69gizmo-shivers';
update public.profiles set banner_accent = 'Grass' where username = 'hermescl';
