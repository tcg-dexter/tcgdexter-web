-- Best-of-3 game tracking for matches
--
-- A match row already represents the round-level outcome (result =
-- win/loss/draw). This adds the ordered per-game sequence so a BO3 round can
-- be logged as a single match showing e.g. "WW" or "WLW" instead of two or
-- three separate single-game rows.
--
-- Design notes:
-- * game_results is null for ordinary single-game matches (today's behavior,
--   unchanged). When set, it is an ordered string of per-game outcomes using
--   W / L (e.g. "WW", "WLW"). A 1-1 timed round is recorded at the round level
--   as result = draw — there is no per-game tie.
-- * result stays authoritative for all stats/queries; game_results is
--   supplemental detail. The API derives result from the sequence on write.
-- * {2,5} leaves headroom for a future best-of-5 without another migration.

begin;

alter table public.matches
  add column if not exists game_results text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_game_results_check'
  ) then
    alter table public.matches
      add constraint matches_game_results_check
      check (game_results is null or game_results ~ '^[WL]{2,5}$');
  end if;
end $$;

commit;
