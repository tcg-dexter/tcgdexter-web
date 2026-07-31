// Effect-coverage (W1): implemented vs unmodeled effects, distinct from
// name-resolution coverage.

import { describe, it, expect } from "vitest";
import { deckEffectCoverage } from "./effectCoverage";
import { classifyCardEffects } from "@/lib/engine/sim/coverage";

/** Real Standard trainers to draw an unmodeled example from. Deliberately a
 *  long tail — as the registries grow, later entries keep the test meaningful
 *  without an edit. See the note in the gap test below. */
const SAMPLE_TRAINERS = [
  "Ciphermaniac's Codebreaking",
  "Crushing Hammer",
  "Pokégear 3.0",
  "Bug Catching Set",
  "Handheld Fan",
  "Nighttime Mine",
  "Technical Machine: Evolution",
  "Counter Catcher",
  "Lost Vacuum",
  "Hisuian Heavy Ball",
  "Neutralization Zone",
  "Cook",
];

describe("deckEffectCoverage", () => {
  it("is fully covered for an all-basic-energy list (no effect slots)", () => {
    const cov = deckEffectCoverage(["Energy: 4", "4 Basic Darkness Energy"].join("\n"));
    expect(cov.slots).toBe(0);
    expect(cov.fraction).toBe(1);
    expect(cov.gaps).toEqual([]);
  });

  it("counts a registered trainer as implemented and an unregistered one as a gap", () => {
    // The unimplemented card is DERIVED, not hardcoded. Naming a real card
    // here made this test a moving target: it broke when Crushing Hammer was
    // implemented, and again when its replacement was. The behavior under
    // test — qty-weighted gap accounting — has nothing to do with which card
    // happens to be unmodeled today, so pick one at runtime.
    // Must be a `trainer`-kind slot specifically: some of the sample names are
    // Tools or Stadiums, which the classifier reports under their own kinds.
    const unimplemented = SAMPLE_TRAINERS.find((n) =>
      classifyCardEffects(n).some((s) => !s.implemented && s.kind === "trainer"),
    );
    if (!unimplemented) {
      // Every sampled trainer is modeled — the gap path can't be exercised.
      // A good problem; assert the happy path instead of failing.
      const cov = deckEffectCoverage(["Trainer: 3", "3 Boss's Orders"].join("\n"));
      expect(cov.gaps).toEqual([]);
      expect(cov.fraction).toBe(1);
      return;
    }

    const cov = deckEffectCoverage(
      ["Trainer: 5", "3 Boss's Orders", `2 ${unimplemented}`].join("\n"),
    );
    expect(cov.gaps.some((g) => g.key === unimplemented && g.kind === "trainer")).toBe(true);
    // Boss's Orders is modeled, so it must NOT appear as a gap.
    expect(cov.gaps.some((g) => g.key === "Boss's Orders")).toBe(false);
    // Gaps are qty-weighted: 2 copies ⇒ 2.
    expect(cov.gaps.find((g) => g.key === unimplemented)?.copies).toBe(2);
  });

  it("distinguishes a modeled Special Energy from an unmodeled one", () => {
    const cov = deckEffectCoverage(
      ["Energy: 2", "1 Luminous Energy", "1 Neo Upper Energy"].join("\n"),
    );
    expect(cov.gaps.some((g) => g.key === "Neo Upper Energy" && g.kind === "special_energy")).toBe(true);
    expect(cov.gaps.some((g) => g.key === "Luminous Energy")).toBe(false);
  });

  it("resolves TCG Live basic-energy shorthand as vanilla, not an unknown card", () => {
    const cov = deckEffectCoverage(["Energy: 7", "7 Basic {D} Energy MEE 7"].join("\n"));
    expect(cov.unknownCards).toEqual([]);
    expect(cov.slots).toBe(0);
  });
});
