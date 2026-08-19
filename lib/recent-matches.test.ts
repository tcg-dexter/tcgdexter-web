import { describe, expect, it } from "vitest";
import { pickFeaturedMatch } from "./recent-matches";
import type { RecentMatch } from "@/app/components/MatchCard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only `totalDamage` and `createdAt` participate in the ranking, so the
 *  rest of RecentMatch is filled in as whatever type-checks — a full
 *  fixture would obscure which two fields actually drive the outcome. */
function match(id: string, totalDamage: number | null, daysAgo: number): RecentMatch {
  return {
    id,
    totalDamage,
    createdAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  } as unknown as RecentMatch;
}

// Both /matches and the home-page showcase call this, so it decides what
// "the current featured match" means for the whole app. If it ever returned
// different answers for the same pool, the two surfaces would disagree.
describe("pickFeaturedMatch", () => {
  it("picks the highest total damage inside the window", () => {
    const picked = pickFeaturedMatch([
      match("low", 500, 1),
      match("high", 2000, 3),
      match("mid", 1200, 2),
    ]);
    expect(picked?.id).toBe("high");
  });

  it("ignores matches older than the seven-day window", () => {
    // The biggest bloodbath ever, but stale — the point of the window is
    // that the home page keeps showing something current.
    const picked = pickFeaturedMatch([
      match("ancient", 99999, 30),
      match("recent", 100, 1),
    ]);
    expect(picked?.id).toBe("recent");
  });

  it("ignores matches with no damage recorded", () => {
    // totalDamage is null for manual match logs — no parsed battle log, so
    // nothing for the showcase's replay viewer to play.
    const picked = pickFeaturedMatch([match("manual", null, 1), match("logged", 10, 2)]);
    expect(picked?.id).toBe("logged");
  });

  it("breaks damage ties toward the more recent match", () => {
    const picked = pickFeaturedMatch([
      match("older", 1000, 5),
      match("newer", 1000, 1),
    ]);
    expect(picked?.id).toBe("newer");
  });

  it("returns null when nothing qualifies", () => {
    expect(pickFeaturedMatch([])).toBeNull();
    expect(pickFeaturedMatch([match("stale", 500, 30)])).toBeNull();
    expect(pickFeaturedMatch([match("manual", null, 1)])).toBeNull();
  });

  it("does not reorder the caller's array", () => {
    // The home page slices the same pool for its Recent Battles grid, which
    // must stay in newest-first feed order — a sort in place here would
    // silently reorder that grid by damage.
    const pool = [match("a", 100, 1), match("b", 5000, 2), match("c", 200, 3)];
    const before = pool.map((m) => m.id);
    pickFeaturedMatch(pool);
    expect(pool.map((m) => m.id)).toEqual(before);
  });
});
