import { describe, it, expect } from "vitest";
import {
  normalizeGameResults,
  isValidGameResults,
  deriveResultFromGames,
  sanitizePrize,
  sanitizeGamePrizes,
  manualPrizeTotals,
} from "./bo3";

/**
 * Trust-boundary tests for the Best-of-3 helpers.
 *
 * These functions sit between raw request JSON (POST/PATCH /api/matches) and
 * the `matches` table. They are the reason a client can't write a bogus
 * `game_results` string, an out-of-range prize count, or a malformed
 * `game_prizes` blob straight into the DB, and the reason the stored `result`
 * can never disagree with the per-game sequence it was derived from.
 */

describe("normalizeGameResults", () => {
  it("uppercases and trims a real sequence", () => {
    expect(normalizeGameResults("  wlw ")).toBe("WLW");
  });
  it("returns null for non-strings and empties", () => {
    expect(normalizeGameResults(undefined)).toBeNull();
    expect(normalizeGameResults(null)).toBeNull();
    expect(normalizeGameResults(42)).toBeNull();
    expect(normalizeGameResults("")).toBeNull();
    expect(normalizeGameResults("   ")).toBeNull();
  });
});

describe("isValidGameResults", () => {
  it("accepts 2–5 character runs of W/L/D", () => {
    expect(isValidGameResults("WW")).toBe(true);
    expect(isValidGameResults("WLW")).toBe(true);
    expect(isValidGameResults("WLDLW")).toBe(true);
  });
  it("rejects too-short, too-long, or out-of-alphabet sequences", () => {
    expect(isValidGameResults("W")).toBe(false); // single game isn't a bo3
    expect(isValidGameResults("WWWWWW")).toBe(false); // > 5
    expect(isValidGameResults("WLX")).toBe(false); // bad char
    expect(isValidGameResults("wlw")).toBe(false); // must be normalized first
    expect(isValidGameResults("")).toBe(false);
  });
});

describe("deriveResultFromGames", () => {
  it("derives the round result from W/L counts; draws count for neither", () => {
    expect(deriveResultFromGames("WW")).toBe("win");
    expect(deriveResultFromGames("WLW")).toBe("win");
    expect(deriveResultFromGames("LL")).toBe("loss");
    expect(deriveResultFromGames("WL")).toBe("draw");
    expect(deriveResultFromGames("WLD")).toBe("draw"); // 1-1, draw ignored
    expect(deriveResultFromGames("WWD")).toBe("win");
  });
});

describe("sanitizePrize", () => {
  it("clamps to an integer in 0–6", () => {
    expect(sanitizePrize(3)).toBe(3);
    expect(sanitizePrize(-5)).toBe(0);
    expect(sanitizePrize(99)).toBe(6);
    expect(sanitizePrize(2.9)).toBe(2); // truncates toward zero
  });
  it("coerces numeric strings and rejects junk as null", () => {
    expect(sanitizePrize("4")).toBe(4);
    expect(sanitizePrize("")).toBeNull();
    expect(sanitizePrize(null)).toBeNull();
    expect(sanitizePrize(undefined)).toBeNull();
    expect(sanitizePrize("abc")).toBeNull();
  });
});

describe("sanitizeGamePrizes", () => {
  it("caps at 5 games and sanitizes each side", () => {
    const out = sanitizeGamePrizes([
      { p: 6, o: 0 },
      { p: 99, o: -1 },
      { p: 1, o: 2 },
      { p: 1, o: 2 },
      { p: 1, o: 2 },
      { p: 1, o: 2 }, // 6th — must be dropped
    ]);
    expect(out).toHaveLength(5);
    expect(out![1]).toEqual({ p: 6, o: 0 }); // clamped
  });
  it("returns null when nothing meaningful was recorded", () => {
    expect(sanitizeGamePrizes([])).toBeNull();
    expect(sanitizeGamePrizes("nope")).toBeNull();
    expect(sanitizeGamePrizes([{ p: null, o: null }])).toBeNull();
    expect(sanitizeGamePrizes([{}, {}])).toBeNull();
  });
  it("survives malformed / null entries without throwing", () => {
    const out = sanitizeGamePrizes([null, { p: 3 }, 7]);
    expect(out).toEqual([
      { p: null, o: null },
      { p: 3, o: null },
      { p: null, o: null },
    ]);
  });
});

describe("manualPrizeTotals", () => {
  it("sums game_prizes when present", () => {
    expect(
      manualPrizeTotals({
        prizes_taken_player: null,
        prizes_taken_opponent: null,
        game_prizes: [
          { p: 2, o: 1 },
          { p: 1, o: 0 },
        ],
      }),
    ).toEqual({ player: 3, opponent: 1 });
  });
  it("falls back to single-game totals, else null", () => {
    expect(
      manualPrizeTotals({
        prizes_taken_player: 6,
        prizes_taken_opponent: 4,
        game_prizes: null,
      }),
    ).toEqual({ player: 6, opponent: 4 });
    expect(
      manualPrizeTotals({
        prizes_taken_player: null,
        prizes_taken_opponent: null,
        game_prizes: null,
      }),
    ).toBeNull();
  });
});
