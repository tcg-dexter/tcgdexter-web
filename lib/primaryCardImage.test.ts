import { describe, expect, it } from "vitest";
import cardData from "@/data/cards-standard.json";
import { isStandardMark } from "./cardPrinting";
import { headlineVariantForName, primaryPokemonCard } from "./primaryCardImage";

const CARD_DB = cardData as unknown as Record<
  string,
  { regulation_mark?: string | null }[]
>;

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

// The reported bug: a battle whose opponent archetype read "Dragapult
// Dusknoir" showed a rotated-out Sword & Shield Dragapult (swsh12/89, mark
// F) instead of the Standard-legal Dragapult ex. highestEvolutionForName
// couldn't fix it on its own — "Dragapult" and "Dragapult ex" both evolve
// from Drakloak, so they're SIBLINGS, and a name already at its final stage
// has no forward step left to take.
describe("headlineVariantForName: plain species resolve to their headline card", () => {
  it("escalates a plain final-stage name to its rule-box variant", () => {
    expect(headlineVariantForName("Dragapult")).toBe("Dragapult ex");
  });

  it("is idempotent — every member of a species resolves to the same card", () => {
    expect(headlineVariantForName("Dragapult ex")).toBe("Dragapult ex");
    expect(headlineVariantForName(headlineVariantForName("Dragapult"))).toBe("Dragapult ex");
  });

  it("prefers the rule-box card even when a plain print is more recent", () => {
    // Blaziken's newest plain print is mark I and Pikachu's is mark J —
    // both strictly newer than their ex (mark H) — so a recency-first rule
    // picks the wrong card here. These decks are built around the ex.
    expect(headlineVariantForName("Blaziken")).toBe("Blaziken ex");
    expect(headlineVariantForName("Pikachu")).toBe("Pikachu ex");
  });

  it("always lands on a Standard-legal card when the species has one", () => {
    for (const species of ["Dragapult", "Greninja", "Blaziken", "Pikachu", "Charizard"]) {
      const chosen = headlineVariantForName(species);
      const prints = CARD_DB[chosen] ?? [];
      // Charizard is the deliberate exception: its whole species rotated
      // (plain mark F, ex mark G), so there is no legal card to land on.
      if (species === "Charizard") {
        expect(chosen).toBe("Charizard ex");
        continue;
      }
      expect(prints.some((p) => isStandardMark(p.regulation_mark))).toBe(true);
    }
  });

  it("keeps a leading qualifier as a different species, not a variant", () => {
    // Only the trailing rule-box token is stripped, so the qualifier that
    // makes these distinct cards ("Mega", "N's") can't be collapsed away.
    expect(headlineVariantForName("Mega Greninja ex")).toBe("Mega Greninja ex");
    expect(headlineVariantForName("N's Zoroark ex")).toBe("N's Zoroark ex");
    expect(headlineVariantForName("Greninja")).toBe("Greninja ex");
  });

  it("leaves a species alone when it has no rule-box variant", () => {
    // Dusknoir is the real partner card in the reported archetype — it
    // should stay itself rather than being escalated to something else.
    expect(headlineVariantForName("Dusknoir")).toBe("Dusknoir");
  });
});
