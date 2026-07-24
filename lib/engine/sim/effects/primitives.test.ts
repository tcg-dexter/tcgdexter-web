// Effect primitives (W2a): each op mutates state the same way the hand-written
// applyTrainer/applyAbility arms do. Tested directly against a real GameState
// with hand-built resolved targets.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "../setup";
import { placeCounters } from "../damage";
import { lookupCard } from "../../catalog";
import { mintInstanceId } from "../../initial";
import { mulberry32 } from "../rng";
import type { CardInstance, GameState, PokemonInPlay } from "../../types";
import { applyOp, type OpContext, type ResolvedTargets } from "./primitives";

const card = (n: string): CardInstance => ({ id: mintInstanceId("t"), name: n, catalog: lookupCard(n) });
const mon = (n: string): PokemonInPlay => toPokemonInPlay(card(n), 0);

function state(): GameState {
  const deck = instantiateDeck(
    ["Pokémon: 4", "4 Pikachu SVI 62", "Energy: 56", "56 Basic Darkness Energy"].join("\n"),
    "t",
  );
  const s = buildSimInitialState(deck, deck, mulberry32(1), "player");
  s.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  return s;
}
const ctx = (s: GameState, targets: ResolvedTargets = {}): OpContext => ({
  state: s,
  actor: "player",
  targets,
  rng: mulberry32(9),
});

describe("effect primitives", () => {
  it("draw moves the top of deck to hand", () => {
    const s = state();
    const deckBefore = s.sides.player.deck.length;
    const handBefore = s.sides.player.hand.length;
    applyOp({ op: "draw", n: 2 }, ctx(s));
    expect(s.sides.player.hand.length).toBe(handBefore + 2);
    expect(s.sides.player.deck.length).toBe(deckBefore - 2);
  });

  it("search routes a resolved deck card to the Bench and off the deck", () => {
    const s = state();
    const pick = s.sides.player.deck.find((c) => c.name === "Pikachu")!;
    const benchBefore = s.sides.player.bench.length;
    applyOp(
      { op: "search", targetRef: "p", to: "bench" },
      ctx(s, { p: { mons: [], cards: [pick] } }),
    );
    expect(s.sides.player.bench.some((m) => m.card.id === pick.id)).toBe(true);
    expect(s.sides.player.bench.length).toBe(benchBefore + 1);
    expect(s.sides.player.deck.some((c) => c.id === pick.id)).toBe(false);
  });

  it("attach_energy moves a discard energy onto a mon", () => {
    const s = state();
    const target = mon("Pikachu");
    s.sides.player.active = target;
    const energy = card("Basic Darkness Energy");
    s.sides.player.discard = [energy];
    applyOp(
      { op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" },
      ctx(s, { e: { mons: [], cards: [energy] }, m: { mons: [{ mon: target, side: "player" }], cards: [] } }),
    );
    expect(target.attachedEnergy.some((c) => c.id === energy.id)).toBe(true);
    expect(s.sides.player.discard.length).toBe(0);
  });

  it("gust promotes an opponent Bench mon to their Active", () => {
    const s = state();
    s.sides.opponent.active = mon("Pikachu");
    const benched = mon("Snorlax");
    s.sides.opponent.bench = [benched];
    applyOp(
      { op: "gust", monRef: "t" },
      ctx(s, { t: { mons: [{ mon: benched, side: "opponent" }], cards: [] } }),
    );
    expect(s.sides.opponent.active).toBe(benched);
  });

  it("discard_from_mon strips a Special Energy from an opponent mon", () => {
    const s = state();
    const victim = mon("Snorlax");
    victim.attachedEnergy = [card("Jet Energy"), card("Basic Darkness Energy")];
    s.sides.opponent.active = victim;
    applyOp(
      { op: "discard_from_mon", monRef: "t", category: "special_energy" },
      ctx(s, { t: { mons: [{ mon: victim, side: "opponent" }], cards: [] } }),
    );
    expect(victim.attachedEnergy.map((c) => c.name)).toEqual(["Basic Darkness Energy"]);
    expect(s.sides.opponent.discard.some((c) => c.name === "Jet Energy")).toBe(true);
  });

  it("place_counters and heal adjust damage", () => {
    const s = state();
    const m = mon("Snorlax");
    s.sides.player.active = m;
    applyOp({ op: "place_counters", monRef: "m", n: 5 }, ctx(s, { m: { mons: [{ mon: m, side: "player" }], cards: [] } }));
    expect(m.damage).toBe(50);
    applyOp({ op: "heal", monRef: "m", n: 30 }, ctx(s, { m: { mons: [{ mon: m, side: "player" }], cards: [] } }));
    expect(m.damage).toBe(20);
  });

  it("hand_to_bottom_draw bottoms the hand and redraws (Iono-style)", () => {
    const s = state();
    s.sides.player.hand = [card("Pikachu"), card("Pikachu")];
    const deckBefore = s.sides.player.deck.length;
    applyOp({ op: "hand_to_bottom_draw", n: "own_prizes", who: "own" }, ctx(s));
    // 2 bottomed, drew prizes-count (6 at game start).
    expect(s.sides.player.hand.length).toBe(s.sides.player.prizes.length);
    expect(s.sides.player.deck.length).toBe(deckBefore + 2 - s.sides.player.prizes.length);
  });
});
