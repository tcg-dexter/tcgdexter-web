// W2 cutover (headless): the universal `effect` move flows through the live
// engine stack — validate (isLegalHumanMove) and the driver (applyMove) — the
// same path human and AI moves take. Distinct from runtime.test.ts (which
// tests enumerate/apply in isolation): this proves the integration seams the
// cutover adds, while the effect kind is still dormant in legalMoves.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "../setup";
import { lookupCard } from "../../catalog";
import { mintInstanceId } from "../../initial";
import { mulberry32 } from "../rng";
import type { CardInstance, GameState, PokemonInPlay } from "../../types";
import { applyMove } from "../driver";
import { isLegalHumanMove } from "../validate";
import { describeMove } from "../serialize";
import type { TurnContext } from "../moves";
import { enumerateEffect, type EffectMove } from "./runtime";
import { effectsFor } from "./cards";

const card = (n: string): CardInstance => ({ id: mintInstanceId("t"), name: n, catalog: lookupCard(n) });
const mon = (n: string): PokemonInPlay => toPokemonInPlay(card(n), 0);

function state(): GameState {
  const deck = instantiateDeck(
    ["Pokémon: 8", "4 Pikachu SVI 62", "4 Snorlax", "Energy: 52", "52 Basic Darkness Energy"].join("\n"),
    "t",
  );
  const s = buildSimInitialState(deck, deck, mulberry32(3), "player");
  s.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  return s;
}
const ctx = (): TurnContext => ({ retreated: false });
const eff = (name: string) => effectsFor(name)[0];

/** First enumerated effect move for a hand card, via the runtime. */
function firstEffectMove(s: GameState, src: CardInstance): EffectMove {
  const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff(src.name), 0);
  expect(moves.length).toBeGreaterThan(0);
  return moves[0];
}

describe("W2 cutover — effect moves through validate + driver", () => {
  it("Boss's Orders: isLegalHumanMove accepts an enumerated pick and applyMove gusts", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    const target = mon("Snorlax");
    s.sides.opponent.bench = [target];

    const move = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(true);
    expect(describeMove(s, "player", move)).toContain("Boss's Orders");

    applyMove(s, "player", move, ctx(), mulberry32(9));
    expect(s.sides.opponent.active).toBe(target);
    expect(s.sides.player.supporterPlayedThisTurn).toBe(true);
    expect(s.sides.player.discard.some((c) => c.id === src.id)).toBe(true);
  });

  it("Nest Ball: applyMove benches the fetched Basic via the driver", () => {
    const s = state();
    const src = card("Nest Ball");
    s.sides.player.hand = [src];
    const benchBefore = s.sides.player.bench.length;

    const move = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(true);
    applyMove(s, "player", move, ctx(), mulberry32(9));
    expect(s.sides.player.bench.length).toBe(benchBefore + 1);
  });

  it("rejects a forged pick that enumeration never produced", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    s.sides.opponent.bench = [mon("Snorlax")];

    const forged: EffectMove = {
      kind: "effect",
      sourceId: src.id,
      card: "Boss's Orders",
      effectIndex: 0,
      picks: [{ ref: "t", monIds: ["not-a-real-mon-id"] }],
    };
    expect(isLegalHumanMove(s, "player", ctx(), forged)).toBe(false);
  });

  it("rejects an effect move whose source card is not in hand", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.opponent.active = mon("Pikachu");
    s.sides.opponent.bench = [mon("Snorlax")];
    // src deliberately NOT placed in hand.
    const move: EffectMove = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(false);
  });

  it("enforces the supporter-per-turn gate on a declarative Supporter", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    s.sides.opponent.bench = [mon("Snorlax")];
    s.sides.player.supporterPlayedThisTurn = true; // already used one
    const move = firstEffectMove(s, src);
    expect(isLegalHumanMove(s, "player", ctx(), move)).toBe(false);
  });
});
