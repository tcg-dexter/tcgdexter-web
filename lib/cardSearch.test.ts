import { describe, it, expect } from "vitest";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import { sortCardEntries } from "./cardSearch";

function card(overrides: Partial<CardIndexEntry> & { id: string; name: string }): CardIndexEntry {
  return {
    nameLower: overrides.name.toLowerCase(),
    nameTokens: [],
    setId: "set1",
    setName: "Set One",
    setReleaseDate: "2024-01-01",
    setSize: 100,
    ptcgoCode: null,
    number: "1",
    numberPadded: "001",
    numberNumeric: 1,
    supertype: "Pokémon",
    subtypes: [],
    types: [],
    hp: null,
    retreatCost: 0,
    regulationMark: null,
    marketPrice: 0,
    rarity: null,
    artist: null,
    artistLower: null,
    artistTokens: [],
    evolvesFrom: null,
    effectNames: [],
    effectNameTokens: [],
    effectText: "",
    variants: [],
    ...overrides,
  };
}

describe("sortCardEntries", () => {
  it("sorts by name ascending/descending, matching the catalog's comparator", () => {
    const cards = [
      card({ id: "c", name: "Charizard" }),
      card({ id: "a", name: "Absol" }),
      card({ id: "b", name: "Blastoise" }),
    ];
    expect(sortCardEntries(cards, "name", "asc").map((c) => c.name)).toEqual([
      "Absol",
      "Blastoise",
      "Charizard",
    ]);
    expect(sortCardEntries(cards, "name", "desc").map((c) => c.name)).toEqual([
      "Charizard",
      "Blastoise",
      "Absol",
    ]);
  });

  it("sorts by price, tie-breaking on name", () => {
    const cards = [
      card({ id: "a", name: "Zebstrika", marketPrice: 5 }),
      card({ id: "b", name: "Absol", marketPrice: 5 }),
      card({ id: "c", name: "Mewtwo", marketPrice: 20 }),
    ];
    expect(sortCardEntries(cards, "price", "desc").map((c) => c.id)).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input array", () => {
    const cards = [card({ id: "b", name: "Blastoise" }), card({ id: "a", name: "Absol" })];
    const original = [...cards];
    sortCardEntries(cards, "name", "asc");
    expect(cards).toEqual(original);
  });

  it("sorts unknown rarities to the end regardless of direction", () => {
    const cards = [
      card({ id: "a", name: "A", rarity: "Rare" }),
      card({ id: "b", name: "B", rarity: null }),
      card({ id: "c", name: "C", rarity: "Ultra Rare" }),
    ];
    expect(sortCardEntries(cards, "rarity", "desc").map((c) => c.id)).toEqual(["c", "a", "b"]);
    expect(sortCardEntries(cards, "rarity", "asc").map((c) => c.id)).toEqual(["a", "c", "b"]);
  });
});
