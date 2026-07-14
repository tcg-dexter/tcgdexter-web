// KO promotion choice: the human chooses their replacement for ALL KO
// types — the AI's attack, their own effect, and (new) a between-turns
// Poison/Burn KO at the Pokémon Checkup.

import { describe, it, expect } from "vitest";
import { startGame, applyHumanMove, humanOptions } from "./index";
import { applyCondition } from "./conditions";
import type { GameSession } from "./interactive";

const DECK = [
  "Pokémon: 12",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "4 Munkidori TWM 95",
  "Trainer: 20",
  "8 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 28",
  "28 Basic Darkness Energy",
].join("\n");

/** A fresh game where the human is on the move with a benched Pokémon. */
function humanTurnGame(seed: number): GameSession {
  for (let s = seed; s < seed + 50; s++) {
    const g = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed: s });
    if (g.status === "human_turn" && g.state.sides.player.active && g.state.sides.player.bench.length > 0) {
      return g;
    }
  }
  throw new Error("no suitable opening found");
}

describe("checkup KO prompts the human to promote", () => {
  it("a Poisoned human active that faints at the Checkup pauses for a choice", () => {
    const g = humanTurnGame(1);
    const active = g.state.sides.player.active!;
    // Poison it and leave it one counter from death, so the between-turns
    // Checkup after the human's turn KOs it.
    applyCondition(active, "Poisoned");
    active.damage = (active.card.catalog?.hp ?? 70) - 10;
    const benchBefore = g.state.sides.player.bench.length;

    // End the turn. The AI turn begins with the Checkup, which KOs the
    // poisoned active → the game must pause for the human's promotion.
    applyHumanMove(g, { kind: "pass" });

    expect(g.status).toBe("human_promotion");
    expect(g.state.sides.player.active).toBeNull();
    const options = humanOptions(g);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((m) => m.kind === "promote")).toBe(true);

    // The human picks their new active; play then resumes normally.
    applyHumanMove(g, options[0]);
    expect(g.status === "human_turn" || g.status === "over").toBe(true);
    if (g.status === "human_turn") {
      expect(g.state.sides.player.active).not.toBeNull();
      expect(g.state.sides.player.bench.length).toBe(benchBefore - 1);
    }
  });

  it("the AI still auto-promotes its own Checkup KO (no human pause)", () => {
    const g = humanTurnGame(2);
    const aiActive = g.state.sides.opponent.active!;
    applyCondition(aiActive, "Poisoned");
    aiActive.damage = (aiActive.card.catalog?.hp ?? 70) - 10;
    // Human passes; the AI's poisoned active faints at a Checkup and the AI
    // promotes itself without ever handing control to the human for it.
    applyHumanMove(g, { kind: "pass" });
    expect(["human_turn", "human_promotion", "over"]).toContain(g.status);
    // If the human is prompted, it's for THEIR own KO, never the AI's.
    if (g.status === "human_promotion") {
      expect(g.state.sides.player.active).toBeNull();
    }
  });
});
