import { describe, expect, it } from "vitest";
import type { PokemonInPlay } from "../../types";
import { bestCopy, copyCandidates } from "./copy";

/** Minimal in-play Pokémon with the attacks a copy op would choose between. */
function mon(
  name: string,
  attacks: { name: string; damage: string; text?: string }[],
): PokemonInPlay {
  return {
    id: name,
    card: {
      id: name,
      name,
      catalog: { name, supertype: "Pokémon", hp: 130, attacks: attacks.map((a) => ({ ...a, cost: [] })) },
    },
    damage: 0,
    attachedEnergy: [],
    conditions: [],
    abilitiesUsedThisTurn: [],
  } as unknown as PokemonInPlay;
}

describe("copy-an-attack donor selection", () => {
  const zekrom = mon("N's Zekrom", [
    { name: "Shred", damage: "70" },
    { name: "Rampaging Thunder", damage: "250" },
  ]);
  const zorua = mon("N's Zorua", [{ name: "Scratch", damage: "20" }]);

  it("picks the donor's BEST attack, not its first", () => {
    // The regression this guards: the original implementation read
    // `attacks[0]`, so N's Zoroark could only ever copy Shred (70) and the
    // archetype's 250-damage payoff line was unreachable.
    const best = bestCopy([zorua, zekrom]);
    expect(best?.donor.card.name).toBe("N's Zekrom");
    expect(best?.attackIndex).toBe(1);
    expect(best?.damage).toBe(250);
  });

  it("honours the filter", () => {
    const outsider = mon("Pikachu", [{ name: "Thunder", damage: "300" }]);
    const best = bestCopy([outsider, zekrom], {
      side: "own",
      zone: "bench",
      namePrefix: "N's ",
    });
    expect(best?.donor.card.name).toBe("N's Zekrom");
  });

  it("never offers a copy attack as a donor (no recursion)", () => {
    const other = mon("N's Zoroark ex", [
      { name: "Night Joker", damage: "", text: "Choose 1 of your Benched N's Pokémon's attacks and use it as this attack." },
    ]);
    expect(copyCandidates([other])).toHaveLength(0);
  });

  it("skips empty slots and unmatched donors without throwing", () => {
    expect(bestCopy([null, null])).toBeNull();
  });
});

describe("copy tempo — drawbacks come with the copied attack", () => {
  const locked = (name: string, atk: string, dmg: string) =>
    mon(name, [{ name: atk, damage: dmg, text: "During your next turn, this Pokémon can't use attacks." }]);

  it("prefers a smaller attack once the lockout halves the bigger one below it", () => {
    // A locked attack costs the copier its next turn, so it is worth about
    // half its printed damage per turn. 150 locked = 75/turn, which a clean
    // 90 beats.
    const big = locked("N's Zekrom", "Rampaging Thunder", "150");
    const steady = mon("N's Darmanitan", [{ name: "Flamebody Cannon", damage: "90" }]);
    expect(bestCopy([big, steady])?.donor.card.name).toBe("N's Darmanitan");
  });

  it("still takes the big locked attack when it wins even at half rate", () => {
    // The real pairing: Rampaging Thunder's 250 is 125/turn, which still
    // beats Flamebody Cannon's 90. Halving is a discount, not a veto — this
    // is the case that made me check the model instead of assuming it.
    const zekrom = locked("N's Zekrom", "Rampaging Thunder", "250");
    const steady = mon("N's Darmanitan", [{ name: "Flamebody Cannon", damage: "90" }]);
    expect(bestCopy([zekrom, steady])?.donor.card.name).toBe("N's Zekrom");
  });
});
