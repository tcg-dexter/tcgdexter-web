import { describe, expect, it } from "vitest";
import { resolveOpponentHero } from "./opponentHeroCard";

// "Dragapult" is a real, currently-dominant top-30 meta archetype (see
// data/meta-archetypes.json) whose primary card resolves to "Dragapult ex"
// via metaArchetypeCard's own icon-matched pick — the exact real-world case
// this resolver exists for: a Dragapult deck paired with Dusknoir or
// Blaziken shouldn't lose its hero slot to whichever partner happened to
// deal the most damage or get played the most in one particular game.
describe("resolveOpponentHero: archetype beats gameplay inference", () => {
  it("is not a vacuous guard — 'Dragapult' is a resolvable top-30 archetype", () => {
    const hero = resolveOpponentHero({ opponentArchetype: "Dragapult", gameplayName: null });
    expect(hero?.name).toBe("Dragapult ex");
  });

  it("picks the recognized archetype's own card over a gameplay-inferred partner", () => {
    // Dusknoir stands in for "whichever attacker dealt the most damage or
    // got played the most" — a real signal, just one the archetype should
    // outrank when both are available.
    const hero = resolveOpponentHero({
      opponentArchetype: "Dragapult",
      gameplayName: "Dusknoir",
    });
    expect(hero?.name).toBe("Dragapult ex");
  });

  it("falls back to a Pokémon name parsed out of free text when the archetype isn't an exact top-30 match", () => {
    const hero = resolveOpponentHero({
      opponentArchetype: "Some rogue deck ft. Charizard ex",
      gameplayName: "Dusknoir",
    });
    expect(hero?.name).toBe("Charizard ex");
  });

  it("falls back to the gameplay-inferred name when the archetype resolves to nothing at all", () => {
    const hero = resolveOpponentHero({
      opponentArchetype: "totally unrecognized made-up archetype",
      gameplayName: "Dusknoir",
    });
    expect(hero?.name).toBe("Dusknoir");
  });

  it("falls back to the gameplay-inferred name when no archetype was logged", () => {
    const hero = resolveOpponentHero({ opponentArchetype: null, gameplayName: "Dusknoir" });
    expect(hero?.name).toBe("Dusknoir");
  });

  // The reported battle: a compound archetype that isn't an exact top-30
  // match, so it goes through the free-text parse — which pulls out the bare
  // species "Dragapult" (the "ex" isn't in the string to match on). Before
  // headlineVariantForName that bare name stopped at plain Dragapult, whose
  // newest print is swsh12/89, mark F — rotated out of Standard.
  it("resolves a compound archetype to the Standard-legal ex, not a rotated plain print", () => {
    for (const archetype of ["Dragapult Dusknoir", "Dragapult Blaziken"]) {
      const hero = resolveOpponentHero({ opponentArchetype: archetype, gameplayName: null });
      expect(hero?.name).toBe("Dragapult ex");
      expect(hero?.imageUrl).not.toContain("swsh12");
      // Dragapult ex is a Dragon-type; the rotated plain print is Psychic,
      // so a regression here would silently recolor the banner too.
      expect(hero?.color).toBe("#C7A126");
    }
  });

  it("agrees on the same card whichever signal supplies it", () => {
    // Archetype text, the bare species, and a mid-line gameplay attacker
    // must all land on one card — otherwise the /matches preview and the
    // battle banner could still disagree about the same match.
    const names = [
      resolveOpponentHero({ opponentArchetype: "Dragapult Dusknoir", gameplayName: null })?.name,
      resolveOpponentHero({ opponentArchetype: null, gameplayName: "Dragapult" })?.name,
      resolveOpponentHero({ opponentArchetype: null, gameplayName: "Drakloak" })?.name,
    ];
    expect(names).toEqual(["Dragapult ex", "Dragapult ex", "Dragapult ex"]);
  });

  it("returns null when neither an archetype nor a gameplay signal resolves", () => {
    expect(resolveOpponentHero({ opponentArchetype: null, gameplayName: null })).toBeNull();
    expect(
      resolveOpponentHero({
        opponentArchetype: "totally unrecognized made-up archetype",
        gameplayName: null,
      }),
    ).toBeNull();
  });
});
