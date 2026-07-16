// Self-play generator acceptance: decisions recorded for both actors with
// schema-aligned vectors, outcomes labeled per actor, and the whole dataset
// reproduced byte-for-byte from the same (seed, games, decks) tuple.

import { describe, it, expect } from "vitest";
import { generateSelfPlayGames } from "./selfplay";
import { ACTION_FEATURE_NAMES, STATE_FEATURE_NAMES } from "./features/policy";

const DECK = [
  "Pokémon: 12",
  "4 Miraidon ex SVI 81",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 24",
  "24 Basic Lightning Energy SVE 4",
].join("\n");

const OPTS = {
  decks: [
    { id: "deck-a", list: DECK },
    { id: "deck-b", list: DECK },
  ],
  games: 2,
  seed: 7,
  maxTurns: 20,
  evaluator: null, // artifact-independent determinism
};

describe("self-play dataset generator", () => {
  const games = generateSelfPlayGames(OPTS);

  it("records decisions for both actors with aligned vectors", () => {
    expect(games.length).toBe(2);
    for (const game of games) {
      expect(game.decisions.length).toBeGreaterThan(0);
      const actors = new Set(game.decisions.map((d) => d.actor));
      expect(actors.has("player")).toBe(true);
      expect(actors.has("opponent")).toBe(true);
      for (const d of game.decisions) {
        expect(d.stateFeatures.length).toBe(STATE_FEATURE_NAMES.length);
        expect(d.candidates.length).toBeGreaterThan(0);
        for (const c of d.candidates) {
          expect(c.features.length).toBe(ACTION_FEATURE_NAMES.length);
        }
        expect(d.chosenIndex).toBeGreaterThanOrEqual(0);
        expect(d.chosenIndex).toBeLessThan(d.candidates.length);
        expect(d.candidates[d.chosenIndex].kind).toBe(d.chosenKind);
        expect(d.valueEstimate).toBeNull();
      }
    }
  });

  it("labels every decision with its actor's outcome", () => {
    for (const game of games) {
      for (const d of game.decisions) {
        if (game.winner === null) expect(d.outcome).toBe(0.5);
        else expect(d.outcome).toBe(game.winner === d.actor ? 1 : 0);
      }
    }
  });

  it("reproduces the dataset exactly from the same tuple", () => {
    const again = generateSelfPlayGames(OPTS);
    expect(JSON.stringify(again)).toBe(JSON.stringify(games));
  });

  it("varies with the seed", () => {
    const other = generateSelfPlayGames({ ...OPTS, seed: 8 });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(games));
  });
});
