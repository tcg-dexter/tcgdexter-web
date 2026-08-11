import { describe, it, expect } from "vitest";
import {
  buildVariantKey,
  compareVariants,
  isSpecialPrinting,
  isValidVariantKey,
  parseVariantKey,
  variantLabel,
} from "./variants";
import { allowedAddVariants, isValidVariant } from "./inventory";

describe("parseVariantKey", () => {
  it("parses a plain finish", () => {
    expect(parseVariantKey("reverse")).toEqual({
      type: "reverse", subtype: null, foil: null, stamps: [], size: "standard",
    });
  });

  it("parses every part of a fully-decorated key", () => {
    expect(parseVariantKey("holo:s=shadowless:f=cosmos:t=set-logo+staff:z=jumbo")).toEqual({
      type: "holo",
      subtype: "shadowless",
      foil: "cosmos",
      stamps: ["set-logo", "staff"],
      size: "jumbo",
    });
  });

  it("rejects unknown types, bad tokens and empty input", () => {
    for (const bad of ["", "sparkly", "holo:t=Staff", "normal:z=huge", "holo:x=1"]) {
      expect(parseVariantKey(bad)).toBeNull();
    }
  });

  it("rejects non-canonical stamp ordering so a printing has exactly one key", () => {
    expect(parseVariantKey("holo:t=staff+set-logo")).toBeNull();
    expect(parseVariantKey("holo:t=set-logo+staff")).not.toBeNull();
  });
});

describe("buildVariantKey", () => {
  it("sorts stamps so input order doesn't matter", () => {
    expect(buildVariantKey({ type: "holo", stamps: ["staff", "set-logo"] })).toBe(
      "holo:t=set-logo+staff",
    );
  });

  it("round-trips with parseVariantKey", () => {
    const keys = [
      "normal",
      "holo",
      "reverse",
      "holo:f=cosmos:t=player-rewards-program",
      "normal:s=shadowless:t=1st-edition",
      "reverse:f=league:t=winner",
      "holo:z=jumbo",
    ];
    for (const key of keys) {
      const parsed = parseVariantKey(key)!;
      expect(parsed).not.toBeNull();
      expect(buildVariantKey(parsed)).toBe(key);
    }
  });
});

describe("variantLabel", () => {
  it("uses the recognised wording for common printings", () => {
    expect(variantLabel("normal")).toBe("Normal");
    expect(variantLabel("reverse")).toBe("Reverse Holo");
    expect(variantLabel("holo:t=player-rewards-program")).toBe("Play! Pokémon Stamp");
    expect(variantLabel("holo:f=cosmos:t=player-rewards-program")).toBe(
      "Play! Pokémon Stamp — Cosmos Holo",
    );
  });

  it("composes a label for printings with no bespoke entry", () => {
    // TCGdex adds stamps regularly; an unlisted one must still read sensibly
    // rather than falling back to the raw slug.
    expect(variantLabel("reverse:f=pokeball")).toBe("Poké Ball Reverse Holo");
    expect(variantLabel("normal:t=worlds-2025")).toBe("Normal — Worlds 2025");
    expect(variantLabel("holo:z=jumbo")).toBe("Holo (Jumbo)");
  });

  it("returns the raw key when it can't be parsed, so bad data is visible", () => {
    expect(variantLabel("nonsense!")).toBe("nonsense!");
  });
});

describe("isSpecialPrinting", () => {
  it("treats plain finishes as ordinary and decorated ones as special", () => {
    expect(isSpecialPrinting("normal")).toBe(false);
    expect(isSpecialPrinting("holo")).toBe(false);
    expect(isSpecialPrinting("reverse")).toBe(false);
    expect(isSpecialPrinting("holo:f=cosmos")).toBe(true);
    expect(isSpecialPrinting("normal:t=1st-edition")).toBe(true);
    expect(isSpecialPrinting("holo:z=jumbo")).toBe(true);
  });
});

describe("compareVariants", () => {
  it("orders plain finishes before decorated ones, jumbo last", () => {
    const sorted = [
      "holo:z=jumbo",
      "reverse",
      "holo:f=cosmos:t=player-rewards-program",
      "normal",
      "holo",
    ].sort(compareVariants);
    expect(sorted).toEqual([
      "normal",
      "holo",
      "reverse",
      "holo:f=cosmos:t=player-rewards-program",
      "holo:z=jumbo",
    ]);
  });
});

describe("allowedAddVariants", () => {
  it("offers exactly the printings the card exists in", () => {
    // A modern common: normal + reverse, and crucially no holo — the old
    // rarity heuristic offered a Play! stamp on every card in the catalog.
    expect(allowedAddVariants(["normal", "reverse"])).toEqual(["normal", "reverse"]);
  });

  it("falls back to the universal finishes when the card has no variant data", () => {
    expect(allowedAddVariants(undefined)).toEqual(["normal", "holo", "reverse"]);
    expect(allowedAddVariants([])).toEqual(["normal", "holo", "reverse"]);
  });
});

describe("isValidVariant", () => {
  it("accepts any real printing and rejects malformed input", () => {
    expect(isValidVariant("holo:f=cosmos:t=player-rewards-program")).toBe(true);
    expect(isValidVariant("reverse")).toBe(true);
    expect(isValidVariant("prize_pack")).toBe(false); // the old free-text key
    expect(isValidVariant("")).toBe(false);
  });

  it("agrees with isValidVariantKey", () => {
    for (const k of ["normal", "holo:z=jumbo", "bogus", "holo:t=A"]) {
      expect(isValidVariant(k)).toBe(isValidVariantKey(k));
    }
  });
});

// The add menu is built from the card's real printings unioned with whatever is
// already owned. Mirrors the derivation in InventoryOverlay; extracted here
// because the real regression it guards is silent — a variant that's removable
// but not addable splits a user's count across two keys the next time they add.
function addMenu(variants: string[] | undefined, owned: string[]): string[] {
  return Array.from(new Set([...allowedAddVariants(variants), ...owned])).sort(compareVariants);
}

describe("add menu", () => {
  it("offers exactly the card's printings when nothing exotic is owned", () => {
    expect(addMenu(["normal", "reverse"], [])).toEqual(["normal", "reverse"]);
    expect(addMenu(["normal", "reverse"], ["normal"])).toEqual(["normal", "reverse"]);
  });

  it("keeps a WotC-era holding addable when no plain printing exists", () => {
    // Every Base Set printing carries a subtype, so a bare "holo" — which is
    // what the old four-key UI recorded — matches none of them.
    const base = [
      "holo:s=unlimited",
      "holo:s=shadowless",
      "holo:s=shadowless:t=1st-edition",
      "holo:s=1999-2000-copyright",
    ];
    expect(addMenu(base, ["holo"])).toContain("holo");
    expect(addMenu(base, ["holo"])).toHaveLength(base.length + 1);
  });

  it("keeps a printing upstream hasn't recorded yet", () => {
    // Chaos Rising reverse holos exist but TCGdex doesn't list them; the owner
    // is right and our data is incomplete, so their row must stay addable.
    expect(addMenu(["normal", "holo"], ["reverse"])).toEqual(["normal", "holo", "reverse"]);
  });

  it("does not invent rows for a card with no variant data", () => {
    expect(addMenu(undefined, [])).toEqual(["normal", "holo", "reverse"]);
  });
});
