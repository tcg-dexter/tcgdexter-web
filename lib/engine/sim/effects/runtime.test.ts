// Effect runtime (W2b): enumerate + apply a declarative CardEffect through the
// universal pick encoding, and confirm it reproduces the legacy behavior these
// cards have in trainers.test.ts — the migration contract.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "../setup";
import { lookupCard } from "../../catalog";
import { mintInstanceId } from "../../initial";
import { mulberry32 } from "../rng";
import type { CardInstance, GameState, PokemonInPlay } from "../../types";
import { enumerateEffect, applyEffect } from "./runtime";
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
const rng = () => mulberry32(9);
const eff = (name: string) => effectsFor(name)[0];

describe("effect runtime — legacy behavior via the universal encoding", () => {
  it("Nest Ball: enumerates one move per Basic and benches the pick", () => {
    const s = state();
    const src = card("Nest Ball");
    s.sides.player.hand = [src];
    const benchBefore = s.sides.player.bench.length;

    const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff("Nest Ball"), 0);
    expect(moves.length).toBeGreaterThan(0);
    expect(moves.every((m) => m.picks[0].cardIds?.length === 1)).toBe(true);

    applyEffect(s, "player", eff("Nest Ball"), moves[0], rng());
    expect(s.sides.player.bench.length).toBe(benchBefore + 1);
    expect(s.sides.player.discard.some((c) => c.id === src.id)).toBe(true);
  });

  it("Boss's Orders: gusts the chosen opponent Bench mon to Active (supporter gate set)", () => {
    const s = state();
    const src = card("Boss's Orders");
    s.sides.player.hand = [src];
    s.sides.opponent.active = mon("Pikachu");
    const target = mon("Snorlax");
    s.sides.opponent.bench = [target];

    const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff("Boss's Orders"), 0);
    expect(moves.length).toBe(1);
    applyEffect(s, "player", eff("Boss's Orders"), moves[0], rng());
    expect(s.sides.opponent.active).toBe(target);
    expect(s.sides.player.supporterPlayedThisTurn).toBe(true);
  });

  it("Professor's Research: discards the rest of the hand and draws 7", () => {
    const s = state();
    const src = card("Professor's Research");
    s.sides.player.hand = [src, card("Pikachu"), card("Pikachu")];

    const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff("Professor's Research"), 0);
    expect(moves.length).toBe(1); // no targets
    applyEffect(s, "player", eff("Professor's Research"), moves[0], rng());
    expect(s.sides.player.hand.length).toBe(7);
    expect(s.sides.player.discard.some((c) => c.id === src.id)).toBe(true);
  });

  it("N's PP Up: attaches a discard energy onto a Benched N's Pokémon (no supporter gate)", () => {
    const s = state();
    const src = card("N's PP Up");
    s.sides.player.hand = [src];
    s.sides.player.active = mon("Pikachu");
    const target = mon("N's Zekrom");
    s.sides.player.bench = [target];
    const energy = card("Basic Darkness Energy");
    s.sides.player.discard = [energy];

    const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff("N's PP Up"), 0);
    expect(moves.length).toBe(1); // 1 energy × 1 benched N's mon
    applyEffect(s, "player", eff("N's PP Up"), moves[0], rng());
    expect(target.attachedEnergy.some((c) => c.id === energy.id)).toBe(true);
    expect(s.sides.player.discard.some((c) => c.id === energy.id)).toBe(false);
    expect(s.sides.player.supporterPlayedThisTurn).toBe(false); // it's an Item
  });

  it("respects guards: a required target with no candidate yields no move", () => {
    const s = state();
    const src = card("N's PP Up");
    s.sides.player.hand = [src];
    s.sides.player.active = mon("Pikachu");
    s.sides.player.bench = []; // no benched N's Pokémon
    s.sides.player.discard = [card("Basic Darkness Energy")];
    const moves = enumerateEffect(s, "player", { id: src.id, name: src.name }, eff("N's PP Up"), 0);
    expect(moves.length).toBe(0);
  });
});
