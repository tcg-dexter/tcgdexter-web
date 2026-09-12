import { describe, it, expect } from "vitest";

import { isCurrentStandard, lookupCard } from "@/lib/engine/catalog";
import {
  FORMAT_VERSION,
  canEvolve,
  currentStandardNames,
  currentStandardPokemon,
  evolutionsOf,
  legalCard,
} from "./format";

describe("the format-legal pool", () => {
  it("is a strict subset of the catalog", () => {
    // cards-standard.json spans marks D-J plus thousands of unmarked
    // printings. If the "legal pool" were the whole catalog, the gate would
    // be doing nothing — which was the bug.
    const legal = currentStandardNames();
    expect(legal.length).toBeGreaterThan(500);
    for (const n of legal.slice(0, 200)) expect(isCurrentStandard(n)).toBe(true);
  });

  it("excludes rotated cards that still resolve in the catalog", () => {
    for (const n of ["Iono", "Professor's Research", "Nest Ball"]) {
      expect(lookupCard(n)).not.toBeNull();
      expect(currentStandardNames()).not.toContain(n);
      expect(legalCard(n)).toBeNull();
    }
  });

  it("pins a version so a stale pool cannot silently train", () => {
    expect(FORMAT_VERSION).toBe(1);
  });
});

describe("the evolution graph", () => {
  it("knows what a Basic becomes", () => {
    // The edge the threat model walks. An opponent showing N's Zorua is
    // showing the possibility of N's Zoroark ex, and a model that reads only
    // the board scores that as harmless.
    expect(evolutionsOf("N's Zorua")).toContain("N's Zoroark ex");
    expect(canEvolve("N's Zorua")).toBe(true);
  });

  it("returns nothing for a card with no legal evolution", () => {
    expect(evolutionsOf("Ultra Ball")).toEqual([]);
    expect(canEvolve("Not A Real Card")).toBe(false);
  });

  it("only ever names legal evolutions", () => {
    // A Stage 1 whose Basic rotated is unplayable no matter what the
    // evolution edge says, and suggesting it would invent a threat.
    let edges = 0;
    for (const base of currentStandardPokemon()) {
      for (const evo of evolutionsOf(base)) {
        edges += 1;
        expect(isCurrentStandard(evo)).toBe(true);
        expect(isCurrentStandard(base)).toBe(true);
      }
    }
    expect(edges).toBeGreaterThan(100);
  });

  it("agrees with the catalog's own evolves_from", () => {
    for (const base of ["N's Zorua", "Charmander", "Ralts"]) {
      for (const evo of evolutionsOf(base)) {
        expect(lookupCard(evo)?.evolves_from).toBe(base);
      }
    }
  });
});
