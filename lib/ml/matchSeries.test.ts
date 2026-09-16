import { describe, it, expect } from "vitest";

import { instantiateDeck } from "@/lib/engine/sim";
import { loadMetaCorpus } from "@/lib/ml/deckGen/corpus";
import { renderDeck } from "@/lib/ml/deckGen/rules";
import { gameSeedFor, playMatch, playSeries } from "./matchSeries";

const corpus = loadMetaCorpus();
const A = instantiateDeck(renderDeck(corpus[0].entries))!;
const B = instantiateDeck(renderDeck(corpus[40].entries))!;

describe("best-of-three matches", () => {
  it("stops as soon as the match is decided", () => {
    // A tournament would not play a dead third game, and simulating one would
    // both misrepresent the format and waste ~17% of a study's compute.
    for (let m = 0; m < 12; m++) {
      const rec = playMatch(A, B, m, 1000 + m);
      expect(rec.games.length).toBeLessThanOrEqual(3);
      expect(rec.games.length).toBeGreaterThanOrEqual(2);
      if (rec.gamesA === 2 || rec.gamesB === 2) {
        // Once someone has two, nothing further was played.
        const decidedAt = rec.games.findIndex((_, i) => {
          const a = rec.games.slice(0, i + 1).filter((g) => g.winner === "player").length;
          const b = rec.games.slice(0, i + 1).filter((g) => g.winner === "opponent").length;
          return a === 2 || b === 2;
        });
        expect(rec.games.length).toBe(decidedAt + 1);
      }
    }
  });

  it("gives the match to whoever won more games", () => {
    for (let m = 0; m < 12; m++) {
      const r = playMatch(A, B, m, 77 + m);
      if (r.gamesA > r.gamesB) expect(r.winner).toBe("player");
      else if (r.gamesB > r.gamesA) expect(r.winner).toBe("opponent");
      else expect(r.winner).toBeNull();
    }
  });

  it("alternates the opening seat within and between matches", () => {
    // Going first is worth ~3-4 points here. Within a match the seats
    // alternate; between neighbouring matches the pattern mirrors, so an even
    // match count cancels the advantage exactly rather than accumulating it.
    const m0 = playMatch(A, B, 0, 5);
    const m1 = playMatch(A, B, 1, 5);
    expect(m0.games[0].firstActor).toBe("player");
    expect(m0.games[1].firstActor).toBe("opponent");
    expect(m1.games[0].firstActor).toBe("opponent");
    expect(m1.games[1].firstActor).toBe("player");
  });

  it("reproduces exactly from the same seed", () => {
    const a = playMatch(A, B, 3, 4242);
    const b = playMatch(A, B, 3, 4242);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("derives every game seed purely from (matchSeed, gameIndex)", () => {
    // The property that lets a study shard freely: worker count can never
    // change results.
    expect(gameSeedFor(99, 0)).toBe(gameSeedFor(99, 0));
    expect(gameSeedFor(99, 0)).not.toBe(gameSeedFor(99, 1));
  });

  it("flags an odd match count as seat-imbalanced", () => {
    expect(playSeries(A, B, 4, 11).seatBalanced).toBe(true);
    expect(playSeries(A, B, 5, 11).seatBalanced).toBe(false);
  });

  it("keeps match and game tallies consistent", () => {
    const r = playSeries(A, B, 10, 31);
    expect(r.match_wins_a + r.match_wins_b + r.match_draws).toBe(10);
    expect(r.game_wins_a + r.game_wins_b + r.game_draws).toBe(r.games);
    expect(r.avg_games_per_match).toBeGreaterThanOrEqual(2);
    expect(r.avg_games_per_match).toBeLessThanOrEqual(3);
    expect(r.deciders).toBeLessThanOrEqual(10);
  });

  it("produces a decider population that single-game corpora never contain", () => {
    // Game three is played from 1-1. That is a different distribution of
    // positions than game one, and it is the one a route planner most needs.
    const r = playSeries(A, B, 20, 808);
    expect(r.deciders).toBeGreaterThan(0);
    for (const rec of r.records) {
      if (rec.wentToDecider) expect(rec.games.length).toBe(3);
    }
  });
});
