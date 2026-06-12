-- Per-game prizes for Best-of-3 matches
--
-- Single matches keep their match-level prizes_taken_player / _opponent. A
-- best-of-3 round instead records prizes per game, aligned to game_results
-- (e.g. game_results "WLW" pairs with three {"p":_,"o":_} entries). Null for
-- single matches and for BO3 rounds where no prizes were entered.

begin;

alter table public.matches
  add column if not exists game_prizes jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_game_prizes_array_check'
  ) then
    alter table public.matches
      add constraint matches_game_prizes_array_check
      check (game_prizes is null or jsonb_typeof(game_prizes) = 'array');
  end if;
end $$;

commit;
