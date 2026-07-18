// Post-game review adapter: a finished AI-player transcript produces the
// same shape of coach report + win-prob curve as a real imported match.

import { describe, it, expect } from "vitest";
import {
  applyHumanMove,
  humanOptions,
  startGame,
  viewFor,
  HeuristicPolicy,
  IllegalMoveError,
} from "@/lib/engine/sim";
import type { GameSession, InteractiveMove } from "@/lib/engine/sim";
import { reviewFromTranscript } from "./gameReview";
import { findInvalidValues } from "./features";

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

function playFullGame(seed: number): GameSession {
  const session = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.95, seed });
  const policy = new HeuristicPolicy();
  for (let i = 0; i < 500 && session.status !== "over"; i++) {
    const options = humanOptions(session);
    const move: InteractiveMove =
      session.status === "human_promotion"
        ? options[0]
        : policy.chooseMove(
            viewFor(session.state, "player"),
            options as Parameters<HeuristicPolicy["chooseMove"]>[1],
            { retreated: session.ctx.retreated },
          );
    applyHumanMove(session, move);
  }
  return session;
}

describe("reviewFromTranscript", () => {
  const session = playFullGame(99);
  const review = reviewFromTranscript(session.transcript);

  it("matches the live game's outcome and prize totals", () => {
    expect(review.outcome).toEqual(session.outcome);
    expect(review.features.total_turns).toBe(session.outcome!.turns);
    expect(review.features.prizes_player).toBe(session.outcome!.prizesTaken.player);
    expect(review.features.prizes_opponent).toBe(session.outcome!.prizesTaken.opponent);
    expect(review.features.end_reason).toBe(session.outcome!.endReason);
  });

  it("produces a well-formed coach report with clean feature values", () => {
    expect(findInvalidValues({ ...review.features })).toEqual([]);
    for (const insight of review.report.insights) {
      expect(["warning", "suggestion", "info"]).toContain(insight.severity);
      expect(insight.title.length).toBeGreaterThan(0);
    }
    expect(review.report.summary.player_turns).toBe(review.features.player_turns);
  });

  it("includes a full win-prob curve when the artifact is live", () => {
    if (review.win_prob === null) return; // no registry artifact in this checkout
    expect(review.win_prob.curve).toHaveLength(review.features.total_turns!);
    for (const point of review.win_prob.curve) {
      expect(point.p_win).toBeGreaterThan(0);
      expect(point.p_win).toBeLessThan(1);
    }
  });

  it("refuses unfinished games", () => {
    const open = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed: 5 });
    expect(() => reviewFromTranscript(open.transcript)).toThrow(IllegalMoveError);
  });
});
