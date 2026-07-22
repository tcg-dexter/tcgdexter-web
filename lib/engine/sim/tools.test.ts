// Passive Stadium / Tool effects read where the rule is applied.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "./setup";
import { retreatCost, canRetreat } from "./tools";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState, PokemonInPlay } from "../types";

const card = (n: string): CardInstance => ({ id: mintInstanceId("t"), name: n, catalog: lookupCard(n) });
const mon = (n: string): PokemonInPlay => toPokemonInPlay(card(n), 0);

function state(): GameState {
  const deck = instantiateDeck(["Pokémon: 4", "4 Pikachu SVI 62", "Energy: 56", "56 Basic Darkness Energy"].join("\n"), "t");
  return buildSimInitialState(deck, deck, mulberry32(1), "player");
}

describe("N's Castle — no Retreat Cost for N's Pokémon", () => {
  it("waives retreat cost for an N's Pokémon while N's Castle is in play", () => {
    const s = state();
    const zoro = mon("N's Zoroark ex");
    const base = zoro.card.catalog?.retreat_cost ?? 0;
    expect(base).toBeGreaterThan(0); // sanity: it normally costs something

    // No Stadium ⇒ can't retreat with zero energy attached.
    expect(retreatCost(zoro, s)).toBe(base);
    expect(canRetreat(zoro, s)).toBe(false);

    // N's Castle down ⇒ retreat cost waived, retreat is free.
    s.stadium = { card: card("N's Castle"), owner: "player" };
    expect(retreatCost(zoro, s)).toBe(0);
    expect(canRetreat(zoro, s)).toBe(true);
  });

  it("does not waive retreat for non-N's Pokémon", () => {
    const s = state();
    s.stadium = { card: card("N's Castle"), owner: "player" };
    const snorlax = mon("Snorlax");
    if ((snorlax.card.catalog?.retreat_cost ?? 0) > 0) {
      expect(retreatCost(snorlax, s)).toBe(snorlax.card.catalog!.retreat_cost);
      expect(canRetreat(snorlax, s)).toBe(false);
    }
  });
});
