// Best-of-three matches, not single games.
//
// WHY A MATCH IS A BETTER UNIT THAN A GAME
//
// Every study we have run scored decks by single-game win rate. That is not
// how the game is played, and it is not how the outcome we care about is
// decided: a tournament round is best-of-three. The difference is not
// cosmetic.
//
//   * A match outcome is a majority vote over correlated games, so it is a
//     LESS noisy read on which list is better — the same reason a best-of-
//     three exists in the first place.
//   * Going first is worth roughly 3-4 points in this engine. Over a single
//     game that is a bias; over a match with alternating seats it cancels
//     inside the unit being scored, so a match win is closer to a statement
//     about the decks than a game win is.
//   * A decider game is played from 1-1, which is a materially different
//     population of games than "game one" — and one no single-game corpus
//     has ever contained.
//
// SEAT BALANCE. Within a match, game j starts with A iff (matchIndex + j) is
// even, so consecutive matches mirror each other and an even number of
// matches per pair cancels the first-turn advantage exactly. The caller is
// warned when it asks for an odd count.
//
// EARLY EXIT. A best-of-three stops at 2-0. Not simulating the dead third
// game is both correct (a tournament would not play it) and ~17% cheaper
// across a study. Draws never count toward the 2, so a match can end drawn.
//
// DETERMINISM. Every game seed is a pure function of (matchSeed, gameIndex),
// so a match reproduces exactly and shard count cannot change results — the
// same discipline scripts/ml/matchups.ts already relies on.

import { playGame, type GameOptions } from "@/lib/engine/sim/driver";
import type { DecisionPolicy } from "@/lib/engine/sim/policy";
import { HeuristicPolicy } from "@/lib/engine/sim/policy";
import { mulberry32 } from "@/lib/engine/sim/rng";
import type { SimDeck } from "@/lib/engine/sim/setup";

const GOLDEN_RATIO_32 = 0x9e3779b9;

/** Per-game seed within a match. Mixed rather than incremented so adjacent
 *  games do not share low-bit structure in the rng stream. */
export function gameSeedFor(matchSeed: number, gameIndex: number): number {
  return (matchSeed + Math.imul(gameIndex + 1, GOLDEN_RATIO_32)) >>> 0;
}

export interface GameRecord {
  gameIndex: number;
  seed: number;
  /** Which side moved first in THIS game. */
  firstActor: "player" | "opponent";
  winner: "player" | "opponent" | null;
  prizeDiffA: number;
  turns: number;
  endReason: string;
}

export interface MatchRecord {
  matchIndex: number;
  seed: number;
  /** "player" = deck A took the match. null = drawn. */
  winner: "player" | "opponent" | null;
  gamesA: number;
  gamesB: number;
  draws: number;
  games: GameRecord[];
  /** True when the match went the distance — the decider population. */
  wentToDecider: boolean;
}

export interface SeriesOptions extends GameOptions {
  /** Games needed to take the match. 2 = best-of-three. */
  winsNeeded?: number;
  /** Hard cap on games played. Defaults to 2*winsNeeded - 1. */
  maxGames?: number;
  policies?: (gameSeed: number) => { player: DecisionPolicy; opponent: DecisionPolicy };
}

/** Play one best-of-N match between two instantiated decks. */
export function playMatch(
  deckA: SimDeck,
  deckB: SimDeck,
  matchIndex: number,
  matchSeed: number,
  options: SeriesOptions = {},
): MatchRecord {
  const winsNeeded = options.winsNeeded ?? 2;
  const maxGames = options.maxGames ?? winsNeeded * 2 - 1;

  let gamesA = 0;
  let gamesB = 0;
  let draws = 0;
  const games: GameRecord[] = [];

  for (let j = 0; j < maxGames; j++) {
    if (gamesA >= winsNeeded || gamesB >= winsNeeded) break; // decided
    const seed = gameSeedFor(matchSeed, j);
    // Alternate within the match AND across matches, so the seat advantage
    // cancels between neighbouring matches rather than accumulating.
    const firstActor = (matchIndex + j) % 2 === 0 ? ("player" as const) : ("opponent" as const);
    const policies = options.policies
      ? options.policies(seed)
      : { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() };
    const g = playGame(deckA, deckB, policies, mulberry32(seed), firstActor, options);

    if (g.winner === "player") gamesA += 1;
    else if (g.winner === "opponent") gamesB += 1;
    else draws += 1;

    games.push({
      gameIndex: j,
      seed,
      firstActor,
      winner: g.winner,
      prizeDiffA: g.prizesTaken.player - g.prizesTaken.opponent,
      turns: g.turns,
      endReason: g.endReason,
    });
  }

  const winner = gamesA > gamesB ? "player" : gamesB > gamesA ? "opponent" : null;
  return {
    matchIndex,
    seed: matchSeed,
    winner,
    gamesA,
    gamesB,
    draws,
    games,
    // "Went the distance" means the last game was played from a tied score,
    // which is the decider population route planning most wants.
    wentToDecider: games.length === maxGames && maxGames > 1,
  };
}

export interface SeriesResult {
  matches: number;
  match_wins_a: number;
  match_wins_b: number;
  match_draws: number;
  games: number;
  game_wins_a: number;
  game_wins_b: number;
  game_draws: number;
  deciders: number;
  avg_games_per_match: number;
  avg_prize_diff_a: number;
  avg_turns: number;
  end_reasons: Record<string, number>;
  /** Every match, in order — the substrate route labelling reads. */
  records: MatchRecord[];
}

/** Run `matches` best-of-N matches between two decks.
 *
 *  An ODD match count leaves a residual first-turn bias, because the seat
 *  pattern mirrors between neighbouring matches. Callers get a flag rather
 *  than a silent skew. */
export function playSeries(
  deckA: SimDeck,
  deckB: SimDeck,
  matches: number,
  seed: number,
  options: SeriesOptions = {},
): SeriesResult & { seatBalanced: boolean } {
  const records: MatchRecord[] = [];
  const endReasons: Record<string, number> = {};
  let matchWinsA = 0;
  let matchWinsB = 0;
  let matchDraws = 0;
  let gameWinsA = 0;
  let gameWinsB = 0;
  let gameDraws = 0;
  let deciders = 0;
  let games = 0;
  let prizeDiff = 0;
  let turns = 0;

  for (let m = 0; m < matches; m++) {
    const matchSeed = (seed + Math.imul(m + 1, GOLDEN_RATIO_32)) >>> 0;
    const rec = playMatch(deckA, deckB, m, matchSeed, options);
    records.push(rec);
    if (rec.winner === "player") matchWinsA += 1;
    else if (rec.winner === "opponent") matchWinsB += 1;
    else matchDraws += 1;
    if (rec.wentToDecider) deciders += 1;
    gameWinsA += rec.gamesA;
    gameWinsB += rec.gamesB;
    gameDraws += rec.draws;
    for (const g of rec.games) {
      games += 1;
      prizeDiff += g.prizeDiffA;
      turns += g.turns;
      endReasons[g.endReason] = (endReasons[g.endReason] ?? 0) + 1;
    }
  }

  return {
    matches,
    match_wins_a: matchWinsA,
    match_wins_b: matchWinsB,
    match_draws: matchDraws,
    games,
    game_wins_a: gameWinsA,
    game_wins_b: gameWinsB,
    game_draws: gameDraws,
    deciders,
    avg_games_per_match: matches > 0 ? games / matches : 0,
    avg_prize_diff_a: games > 0 ? prizeDiff / games : 0,
    avg_turns: games > 0 ? turns / games : 0,
    end_reasons: endReasons,
    records,
    seatBalanced: matches % 2 === 0,
  };
}
