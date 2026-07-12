// Phase 3 acceptance: fixed seed ⇒ deterministic rollout; core turn rules
// enforced; known-lopsided matchups directionally correct; latency within
// budget. (replay.test.ts stays green by construction — the sim never
// touches the replay reducer.)

import { describe, it, expect } from "vitest";
import {
  canPayCost,
  computeDamage,
  hashSeed,
  instantiateDeck,
  legalMoves,
  mulberry32,
  playGame,
  HeuristicPolicy,
  simulateMatchup,
} from "./index";
import { buildSimInitialState, toPokemonInPlay } from "./setup";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import type { CardInstance } from "../types";

/* ─── Test decks (real catalog printings) ───────────────────────── */

const STRONG_DECK = [
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

// Low-HP support Pokémon and energy that matches nobody's attack costs.
const WEAK_DECK = [
  "Pokémon: 20",
  "10 Dunsparce JTG 120",
  "10 Hoothoot SCR 114",
  "Trainer: 20",
  "20 Nest Ball SVI 181",
  "Energy: 20",
  "20 Basic Fire Energy SVE 2",
].join("\n");

function card(name: string): CardInstance {
  return { id: mintInstanceId("t"), name, catalog: lookupCard(name) };
}

/* ─── Determinism ───────────────────────────────────────────────── */

describe("simulateMatchup determinism", () => {
  it("fixed seed reproduces the rollout exactly", () => {
    const a = simulateMatchup(STRONG_DECK, WEAK_DECK, { n: 50, seed: 1234 });
    const b = simulateMatchup(STRONG_DECK, WEAK_DECK, { n: 50, seed: 1234 });
    const strip = ({ elapsed_ms: _, ...rest }: typeof a) => rest;
    expect(strip(b)).toEqual(strip(a));
  });

  it("string seeds hash deterministically", () => {
    expect(hashSeed("deck-pair")).toBe(hashSeed("deck-pair"));
    expect(hashSeed("a")).not.toBe(hashSeed("b"));
  });

  it("different seeds explore different games", () => {
    const a = simulateMatchup(STRONG_DECK, STRONG_DECK, { n: 30, seed: 1 });
    const b = simulateMatchup(STRONG_DECK, STRONG_DECK, { n: 30, seed: 2 });
    // Mirror matches: aggregate outcomes should not be byte-identical
    // across seeds (turn counts differ even when win counts tie).
    expect(a.avg_turns).not.toBe(b.avg_turns);
  });
});

/* ─── Rules ─────────────────────────────────────────────────────── */

describe("rules enforcement", () => {
  const deck = instantiateDeck(STRONG_DECK);
  const rng = mulberry32(7);
  const state = buildSimInitialState(deck, deck, rng, "player");

  it("bans attacking on the game's first turn", () => {
    state.turn = { number: 1, playerTurnNumber: 1, actor: "player", phase: "turn" };
    const moves = legalMoves(state, "player", { retreated: false });
    expect(moves.some((m) => m.kind === "attack")).toBe(false);
  });

  it("allows only one energy attachment per turn", () => {
    state.turn = { number: 2, playerTurnNumber: 1, actor: "opponent", phase: "turn" };
    const side = state.sides.opponent;
    side.energyAttachedThisTurn = 0;
    const before = legalMoves(state, "opponent", { retreated: false });
    const hadAttach = before.some((m) => m.kind === "attach");
    side.energyAttachedThisTurn = 1;
    const after = legalMoves(state, "opponent", { retreated: false });
    expect(hadAttach).toBe(true); // 24 energy — opening hands always hold one
    expect(after.some((m) => m.kind === "attach")).toBe(false);
  });

  it("enforces the evolution lock (no evolving the turn a mon enters)", () => {
    const hoothoot = toPokemonInPlay(card("Hoothoot"), 5);
    const fresh = { ...state, turn: { ...state.turn, number: 5 } };
    fresh.sides.player.active = hoothoot;
    fresh.sides.player.hand = [card("Noctowl")];
    const locked = legalMoves(fresh, "player", { retreated: false });
    expect(locked.some((m) => m.kind === "evolve")).toBe(false);
    fresh.turn.number = 6;
    const unlocked = legalMoves(fresh, "player", { retreated: false });
    expect(unlocked.some((m) => m.kind === "evolve")).toBe(true);
  });

  it("checks typed energy costs", () => {
    const pikachu = toPokemonInPlay(card("Pikachu"), 1);
    // Tiny Bolt costs Lightning/Colorless.
    expect(canPayCost(pikachu, ["Lightning", "Colorless"])).toBe(false);
    pikachu.attachedEnergy.push(card("Basic Fire Energy"));
    pikachu.attachedEnergy.push(card("Basic Fire Energy"));
    // Two Fire: pays Colorless but not the Lightning requirement.
    expect(canPayCost(pikachu, ["Lightning", "Colorless"])).toBe(false);
    pikachu.attachedEnergy.push(card("Basic Lightning Energy"));
    expect(canPayCost(pikachu, ["Lightning", "Colorless"])).toBe(true);
  });

  it("applies weakness ×2", () => {
    const attacker = toPokemonInPlay(card("Pikachu"), 1); // Lightning
    const defender = toPokemonInPlay(card("Hoothoot"), 1); // Colorless, weak to Lightning
    const tinyBolt = attacker.card.catalog!.attacks[1];
    const weaknesses = defender.card.catalog!.weaknesses.map((w) => w.type);
    const dmg = computeDamage(attacker, tinyBolt, defender);
    expect(dmg).toBe(weaknesses.includes("Lightning") ? 60 : 30);
  });
});

/* ─── Directional correctness + latency ─────────────────────────── */

describe("matchup quality", () => {
  it("a real attacker deck crushes a support-pile deck", () => {
    const result = simulateMatchup(STRONG_DECK, WEAK_DECK, { n: 100, seed: 99 });
    expect(result.win_rate_a).toBeGreaterThan(0.8);
    expect(result.avg_prize_diff_a).toBeGreaterThan(2);
  });

  it("is roughly symmetric in a mirror (first-mover alternation works)", () => {
    const result = simulateMatchup(STRONG_DECK, STRONG_DECK, { n: 200, seed: 7 });
    expect(result.win_rate_a).toBeGreaterThan(0.3);
    expect(result.win_rate_a).toBeLessThan(0.7);
  });

  it("orientation flip mirrors the result", () => {
    const ab = simulateMatchup(STRONG_DECK, WEAK_DECK, { n: 100, seed: 5 });
    const ba = simulateMatchup(WEAK_DECK, STRONG_DECK, { n: 100, seed: 5 });
    expect(ba.win_rate_a).toBeLessThan(1 - ab.win_rate_a + 0.15);
  });

  it("200 rollouts complete within the latency budget", () => {
    const result = simulateMatchup(STRONG_DECK, WEAK_DECK, { n: 200, seed: 3 });
    expect(result.elapsed_ms).toBeLessThan(3000);
  });

  it("games terminate and report a coherent outcome", () => {
    const deckA = instantiateDeck(STRONG_DECK);
    const deckB = instantiateDeck(WEAK_DECK);
    const policies = { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() };
    const game = playGame(deckA, deckB, policies, mulberry32(11), "player");
    expect(game.turns).toBeGreaterThan(0);
    expect(game.turns).toBeLessThanOrEqual(60);
    expect(["prizes", "no_active", "deck_out", "turn_cap"]).toContain(game.endReason);
    expect(game.prizesTaken.player).toBeGreaterThanOrEqual(0);
    expect(game.prizesTaken.player).toBeLessThanOrEqual(6);
  });
});
