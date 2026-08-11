import { describe, it, expect } from "vitest";
import type { CardIndexEntry } from "@/lib/cardsIndex";
import { sortCardEntries, filterCardEntries, computeFacetsFromCards } from "./cardSearch";

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

describe("filterCardEntries", () => {
  const cards = [
    card({ id: "a", name: "Charizard", supertype: "Pokémon", types: ["Fire"], hp: 180, marketPrice: 40, rarity: "Rare Holo" }),
    card({ id: "b", name: "Blastoise", supertype: "Pokémon", types: ["Water"], hp: 160, marketPrice: 10, rarity: "Rare" }),
    card({ id: "c", name: "Professor's Research", supertype: "Trainer", types: [], hp: null, marketPrice: 1, rarity: "Uncommon" }),
  ];

  it("with no params, returns every card", () => {
    expect(filterCardEntries(cards, {}).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("matches by name query (prefix/substring), case-insensitively", () => {
    expect(filterCardEntries(cards, { q: "char" }).map((c) => c.id)).toEqual(["a"]);
  });

  it("applies facet filters (supertype, hp range, price range)", () => {
    expect(filterCardEntries(cards, { supertype: ["Trainer"] }).map((c) => c.id)).toEqual(["c"]);
    expect(filterCardEntries(cards, { hpMin: 170 }).map((c) => c.id)).toEqual(["a"]);
    expect(filterCardEntries(cards, { priceMax: 15 }).map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("combines a query with facet filters (AND, not OR)", () => {
    expect(filterCardEntries(cards, { q: "charizard", supertype: ["Trainer"] })).toEqual([]);
  });
});

describe("computeFacetsFromCards", () => {
  it("derives facets scoped to only the given cards, not the whole catalog", () => {
    const cards = [
      card({ id: "a", name: "Charizard", setId: "sv1", setName: "Scarlet & Violet", supertype: "Pokémon", types: ["Fire"], rarity: "Rare Holo", retreatCost: 2 }),
      card({ id: "b", name: "Blastoise", setId: "sv1", setName: "Scarlet & Violet", supertype: "Pokémon", types: ["Water"], rarity: "Rare", retreatCost: 3 }),
      card({ id: "c", name: "Boss's Orders", setId: "sv2", setName: "Paldea Evolved", supertype: "Trainer", types: [], rarity: "Uncommon" }),
    ];
    const facets = computeFacetsFromCards(cards);
    expect(facets.supertypes).toEqual(["Pokémon", "Trainer"]);
    expect(facets.types).toEqual(["Fire", "Water"]);
    expect(facets.retreatCosts).toEqual([2, 3]);
    expect(facets.sets.map((s) => s.id)).toEqual(["sv2", "sv1"]);
    // Lower-ranked (more common) rarities sort first, mirroring getFilterFacets' order.
    expect(facets.rarities).toEqual(["Uncommon", "Rare", "Rare Holo"]);
  });

  it("returns empty facets for an empty list", () => {
    const facets = computeFacetsFromCards([]);
    expect(facets).toEqual({
      supertypes: [],
      types: [],
      regulations: [],
      rarities: [],
      retreatCosts: [],
      sets: [],
    });
  });
});
