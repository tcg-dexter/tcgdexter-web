import { describe, expect, it } from "vitest";
import { fetchAllPages, pickFeaturedBattle } from "./recent-battles";
import type { RecentBattle } from "@/app/components/BattleCard";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Only `totalDamage` and `createdAt` participate in the ranking, so the
 *  rest of RecentBattle is filled in as whatever type-checks — a full
 *  fixture would obscure which two fields actually drive the outcome. */
function battle(id: string, totalDamage: number | null, daysAgo: number): RecentBattle {
  return {
    id,
    totalDamage,
    createdAt: new Date(Date.now() - daysAgo * DAY_MS).toISOString(),
  } as unknown as RecentBattle;
}

// Both /battles and the home-page showcase call this, so it decides what
// "the current featured battle" means for the whole app. If it ever returned
// different answers for the same pool, the two surfaces would disagree.
describe("pickFeaturedBattle", () => {
  it("picks the highest total damage inside the window", () => {
    const picked = pickFeaturedBattle([
      battle("low", 500, 1),
      battle("high", 2000, 3),
      battle("mid", 1200, 2),
    ]);
    expect(picked?.id).toBe("high");
  });

  it("ignores battles older than the seven-day window", () => {
    // The biggest bloodbath ever, but stale — the point of the window is
    // that the home page keeps showing something current.
    const picked = pickFeaturedBattle([
      battle("ancient", 99999, 30),
      battle("recent", 100, 1),
    ]);
    expect(picked?.id).toBe("recent");
  });

  it("ignores battles with no damage recorded", () => {
    // totalDamage is null for manual battle logs — no parsed battle log, so
    // nothing for the showcase's replay viewer to play.
    const picked = pickFeaturedBattle([battle("manual", null, 1), battle("logged", 10, 2)]);
    expect(picked?.id).toBe("logged");
  });

  it("breaks damage ties toward the more recent battle", () => {
    const picked = pickFeaturedBattle([
      battle("older", 1000, 5),
      battle("newer", 1000, 1),
    ]);
    expect(picked?.id).toBe("newer");
  });

  it("returns null when nothing qualifies", () => {
    expect(pickFeaturedBattle([])).toBeNull();
    expect(pickFeaturedBattle([battle("stale", 500, 30)])).toBeNull();
    expect(pickFeaturedBattle([battle("manual", null, 1)])).toBeNull();
  });

  it("does not reorder the caller's array", () => {
    // The home page slices the same pool for its Recent Battles grid, which
    // must stay in newest-first feed order — a sort in place here would
    // silently reorder that grid by damage.
    const pool = [battle("a", 100, 1), battle("b", 5000, 2), battle("c", 200, 3)];
    const before = pool.map((m) => m.id);
    pickFeaturedBattle(pool);
    expect(pool.map((m) => m.id)).toEqual(before);
  });
});

// The Featured Battle vanished from both /battles and the home page because
// these reads weren't paged: ~1200 `attack` rows across the public battle
// pool ran past PostgREST's 1000-row response cap, and the truncation fell
// on the NEWEST battles — so every candidate inside the 7-day window came
// back with totalDamage null and the picker filtered all of them out.
describe("fetchAllPages", () => {
  /** Serves `total` rows out of a page-sized window, recording each range. */
  function pager(total: number, pageSize: number) {
    const calls: Array<[number, number]> = [];
    const fetchPage = async (from: number, to: number) => {
      calls.push([from, to]);
      return Array.from(
        { length: Math.max(0, Math.min(to, total - 1) - from + 1) },
        (_, i) => from + i,
      );
    };
    return { calls, fetchPage };
  }

  it("returns everything past the first page", () => {
    const { fetchPage } = pager(1198, 1000);
    return expect(fetchAllPages(fetchPage, 1000)).resolves.toHaveLength(1198);
  });

  it("requests contiguous, non-overlapping ranges", async () => {
    const { calls, fetchPage } = pager(1198, 1000);
    await fetchAllPages(fetchPage, 1000);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("stops after one round trip when the result fits in a page", async () => {
    const { calls, fetchPage } = pager(120, 1000);
    await expect(fetchAllPages(fetchPage, 1000)).resolves.toHaveLength(120);
    expect(calls).toHaveLength(1);
  });

  it("takes a second trip when the first page comes back exactly full", async () => {
    // The ambiguous case: a full page is indistinguishable from "there's
    // more", so it must ask again rather than assume it's done.
    const { calls, fetchPage } = pager(1000, 1000);
    await expect(fetchAllPages(fetchPage, 1000)).resolves.toHaveLength(1000);
    expect(calls).toHaveLength(2);
  });

  it("preserves order across the page boundary", async () => {
    const { fetchPage } = pager(2500, 1000);
    const rows = await fetchAllPages(fetchPage, 1000);
    expect(rows.slice(0, 3)).toEqual([0, 1, 2]);
    expect(rows[999]).toBe(999);
    expect(rows[1000]).toBe(1000);
    expect(rows[rows.length - 1]).toBe(2499);
  });

  it("gives up rather than looping forever on a always-full pager", async () => {
    // Guards MAX_ACTION_PAGES: a pager that never returns a short page
    // must terminate, not spin.
    let calls = 0;
    const rows = await fetchAllPages(async () => {
      calls++;
      return Array.from({ length: 10 }, (_, i) => i);
    }, 10);
    expect(calls).toBe(25);
    expect(rows).toHaveLength(250);
  });
});
