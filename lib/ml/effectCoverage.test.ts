// Effect-coverage (W1): implemented vs unmodeled effects, distinct from
// name-resolution coverage.

import { describe, it, expect } from "vitest";
import { deckEffectCoverage } from "./effectCoverage";

describe("deckEffectCoverage", () => {
  it("is fully covered for an all-basic-energy list (no effect slots)", () => {
    const cov = deckEffectCoverage(["Energy: 4", "4 Basic Darkness Energy"].join("\n"));
    expect(cov.slots).toBe(0);
    expect(cov.fraction).toBe(1);
    expect(cov.gaps).toEqual([]);
  });

  it("counts a registered trainer as implemented and an unregistered one as a gap", () => {
    // NOTE: the "unregistered" card here is a moving target — as W2/W3 model
    // more of the field, whichever card this test names will eventually become
    // implemented and the assertion will flip. That's the metric working, not
    // a bug: swap in any card still absent from the registries (check with
    // `npx tsx scripts/ml/effect_gap_report.ts`). Crushing Hammer held this
    // slot until W2-fin.4 implemented it.
    const cov = deckEffectCoverage(
      ["Trainer: 5", "3 Boss's Orders", "2 Ciphermaniac's Codebreaking"].join("\n"),
    );
    expect(
      cov.gaps.some((g) => g.key === "Ciphermaniac's Codebreaking" && g.kind === "trainer"),
    ).toBe(true);
    expect(cov.gaps.some((g) => g.key === "Boss's Orders")).toBe(false);
    // Ciphermaniac's Codebreaking contributes 2 unmodeled copies.
    expect(cov.gaps.find((g) => g.key === "Ciphermaniac's Codebreaking")?.copies).toBe(2);
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
