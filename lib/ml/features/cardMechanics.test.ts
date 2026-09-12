import { describe, it, expect } from "vitest";

import { isCurrentStandard, lookupCard } from "@/lib/engine/catalog";
import { MECHANICS_FIELDS, mechanicsOf, mechanicsSum } from "./cardMechanics";

describe("format legality is a property of the name, not of one printing", () => {
  it("keeps staples that were reprinted into the current marks", () => {
    // Each of these has a rotated original AND a current reprint. Reading the
    // single printing `pickPrinting` selects would have answered about the
    // wrong piece of cardboard for whichever way the tiebreak fell.
    for (const n of ["Judge", "Boss's Orders", "Ultra Ball"]) {
      expect(isCurrentStandard(n)).toBe(true);
    }
  });

  it("rejects cards that exist in the catalog but rotated out", () => {
    // The distinction the old legality gate could not make: these simulate
    // fine, so nothing downstream noticed they are unplayable.
    for (const n of ["Iono", "Professor's Research", "Nest Ball"]) {
      expect(lookupCard(n)).not.toBeNull();
      expect(isCurrentStandard(n)).toBe(false);
    }
  });

  it("treats basic Energy as legal despite carrying no current mark", () => {
    // Basic Energy never rotates. Without this every deck in the corpus
    // fails, which is exactly what the first pass reported.
    expect(isCurrentStandard("Basic Psychic Energy")).toBe(true);
  });

  it("is false for names outside the catalog entirely", () => {
    expect(isCurrentStandard("Not A Real Card")).toBe(false);
  });
});

describe("the legacy trainer registry wins precedence", () => {
  it("does not double-count a card that is in both registries", () => {
    // The engine checks TRAINER_EFFECTS first and never reaches the
    // declarative entry. Applying both gave gust=2 and draw_power=14 —
    // a card that does not exist.
    expect(mechanicsOf("Boss's Orders").gust).toBe(1);
    expect(mechanicsOf("Professor's Research").draw_power).toBe(7);
  });

  it("still encodes the legacy-only staples the declarative table misses", () => {
    expect(mechanicsOf("Ultra Ball").search_power).toBeGreaterThan(0);
    expect(mechanicsOf("Rare Candy").board_growth).toBeGreaterThan(0);
    expect(mechanicsOf("Night Stretcher").retrieve_power).toBeGreaterThan(0);
  });
});

describe("mechanics aggregate as counts", () => {
  it("sums element-wise, so two copies read as twice the effect", () => {
    const one = mechanicsSum(["Boss's Orders"]);
    const two = mechanicsSum(["Boss's Orders", "Boss's Orders"]);
    for (let i = 0; i < MECHANICS_FIELDS.length; i++) expect(two[i]).toBe(2 * one[i]);
  });

  it("returns an all-zero vector for an unknown name rather than throwing", () => {
    // The encoder must never crash on a card the catalog lost; a blank is a
    // recoverable wrong answer, an exception kills a 20k-game run.
    expect(mechanicsSum(["Not A Real Card"]).every((v) => v === 0)).toBe(true);
  });
});
