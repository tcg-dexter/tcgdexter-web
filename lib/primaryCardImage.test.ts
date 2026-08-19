import { describe, expect, it } from "vitest";
import { primaryPokemonCard } from "./primaryCardImage";

// Real subtypes (from data/cards-standard.json) driving these cases:
//   Dragapult ex: ["Stage 2", "Tera", "ex"]  — a Stage 2 AND rule-box at once
//   Dusknoir:     ["Stage 2"]                — Stage 2, not rule-box
//   Blaziken ex:  ["Stage 2", "ex"]          — also a Stage 2 rule-box mon
//   Iron Leaves ex: ["Basic", "ex", "Future"] — rule-box, but only Basic
type Card = {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
};

function pkmn(name: string, number: string, setCode: string, qty: number): Card {
  return { qty, name, number, setCode, section: "pokemon" };
}

describe("primaryPokemonCard: rule-box status beats evolution stage", () => {
  // The bug this guards: the old ranking scored "Stage 2" (6) above "ex"
  // (4), and a card's rank was the max over its own subtypes — so a Stage
  // 2 ex like Dragapult ex scored only 6, identical to a plain non-ex
  // Stage 2 partner. The tiebreak (copy count) then decided, so a Dragapult
  // Dusknoir decklist could lose its archetype-defining ex to Dusknoir over
  // a 1-copy difference.
  it("picks the Stage 2 ex over a same-stage non-ex partner, even when the partner has more copies", () => {
    const cards = [
      pkmn("Dragapult ex", "130", "TWM", 2),
      pkmn("Dusknoir", "104", "PLB", 3),
    ];
    expect(primaryPokemonCard(cards)?.card.name).toBe("Dragapult ex");
  });

  it("picks a Basic-stage ex over a same-or-higher-stage non-ex, even when the non-ex has more copies", () => {
    // Under the old ranking, plain Stage 2 (6) beat Basic ex (4) outright —
    // rule-box status should win regardless of stage, not just at a tie.
    const cards = [
      pkmn("Iron Leaves ex", "186", "TEF", 2),
      pkmn("Dusknoir", "104", "PLB", 3),
    ];
    expect(primaryPokemonCard(cards)?.card.name).toBe("Iron Leaves ex");
  });

  it("still breaks ties on copy count when both candidates are equally rule-box and equally staged", () => {
    // Two Stage 2 ex Pokémon (Dragapult ex, Blaziken ex) have no stage or
    // rule-box distinction between them, so this is exactly the case that
    // should still fall through to qty — unlike the Dusknoir case above,
    // where rule-box status alone should have decided it.
    const cards = [
      pkmn("Dragapult ex", "130", "TWM", 3),
      pkmn("Blaziken ex", "90", "CG", 2),
    ];
    expect(primaryPokemonCard(cards)?.card.name).toBe("Dragapult ex");

    const flipped = [
      pkmn("Dragapult ex", "130", "TWM", 2),
      pkmn("Blaziken ex", "90", "CG", 3),
    ];
    expect(primaryPokemonCard(flipped)?.card.name).toBe("Blaziken ex");
  });

  it("still prefers higher evolution stage among cards that are equally rule-box (or equally not)", () => {
    const cards = [
      pkmn("Dragapult ex", "130", "TWM", 2), // Stage 2, rule-box
      pkmn("Iron Leaves ex", "186", "TEF", 2), // Basic, rule-box — same qty
    ];
    expect(primaryPokemonCard(cards)?.card.name).toBe("Dragapult ex");
  });
});
