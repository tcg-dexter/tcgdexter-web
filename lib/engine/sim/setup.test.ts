// Deck instantiation — card-name normalization so decklists written in TCG
// Live shorthand still resolve to the engine catalog.

import { describe, it, expect } from "vitest";
import { canonicalCardName, instantiateDeck, energyProvides } from "./setup";

describe("canonicalCardName — TCG Live basic-energy shorthand", () => {
  it("maps 'Basic {D} Energy' to a catalog basic energy", () => {
    expect(canonicalCardName("Basic {D} Energy")).toBe("Basic Darkness Energy");
    expect(canonicalCardName("Basic {R} Energy")).toBe("Basic Fire Energy");
    expect(canonicalCardName("Basic {L} Energy")).toBe("Basic Lightning Energy");
  });

  it("passes through names that already resolve", () => {
    expect(canonicalCardName("Darkness Energy")).toBe("Darkness Energy");
    expect(canonicalCardName("N's Zoroark ex")).toBe("N's Zoroark ex");
    expect(canonicalCardName("Boss's Orders")).toBe("Boss's Orders");
  });
});

describe("instantiateDeck — shorthand energy is a real, attachable card", () => {
  it("resolves '{D}' energy to a catalog card with an energy type and image", () => {
    const deck = instantiateDeck(
      ["Pokémon: 1", "1 N's Zekrom ASC 155", "Energy: 7", "7 Basic {D} Energy MEE 7"].join("\n"),
      "t",
    );
    expect(deck.unknownNames).toEqual([]);
    const energy = deck.cards.find((c) => /energy/i.test(c.name))!;
    expect(energy.name).toBe("Basic Darkness Energy");
    expect(energy.catalog?.supertype).toBe("Energy");
    expect(energyProvides(energy)).toBe("Darkness");
  });
});
