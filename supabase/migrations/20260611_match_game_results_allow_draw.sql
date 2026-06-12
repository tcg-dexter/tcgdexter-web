-- Allow drawn games in a Best-of-3 sequence
--
-- game_results previously permitted only W/L. Individual games can also be a
-- draw (e.g. time called mid-game), so relax the check to W/L/D. The round
-- result is still derived from the win vs loss count; draws count toward
-- neither side.

begin;

alter table public.matches
  drop constraint if exists matches_game_results_check;

alter table public.matches
  add constraint matches_game_results_check
  check (game_results is null or game_results ~ '^[WLD]{2,5}$');

commit;
