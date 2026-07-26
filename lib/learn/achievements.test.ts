import { describe, it, expect } from "vitest";
import {
  qualifiedKeys,
  reconcileAchievements,
  CATALOG,
  type Metrics,
  type AchievementKey,
} from "./achievements";

const M = (partial: Partial<Metrics>): Metrics => ({
  savedDecks: 0,
  totalMatches: 0,
  importMatches: 0,
  ...partial,
});

describe("qualifiedKeys — count-based predicates", () => {
  it("awards nothing at zero", () => {
    expect(qualifiedKeys(M({}))).toEqual([]);
  });

  it("first save unlocks First Save only", () => {
    expect(qualifiedKeys(M({ savedDecks: 1 }))).toEqual(["first_save"]);
  });

  it("first manual match unlocks First Match only (no battle log)", () => {
    expect(qualifiedKeys(M({ totalMatches: 1, importMatches: 0 }))).toEqual([
      "first_match",
    ]);
  });

  it("a first-ever import earns BOTH First Match and First Battle Log", () => {
    const keys = qualifiedKeys(M({ totalMatches: 1, importMatches: 1 }));
    expect(keys).toContain("first_match");
    expect(keys).toContain("first_battle_log");
  });

  it("match-grind milestones stack at their thresholds", () => {
    expect(qualifiedKeys(M({ totalMatches: 10 }))).toEqual(
      expect.arrayContaining(["first_match", "matches_10"]),
    );
    expect(qualifiedKeys(M({ totalMatches: 49 }))).not.toContain("matches_50");
    expect(qualifiedKeys(M({ totalMatches: 100 }))).toEqual(
      expect.arrayContaining(["matches_10", "matches_50", "matches_100"]),
    );
  });

  it("deck-builder tiers award after First Save, at 5/10/20/30/40/50", () => {
    expect(qualifiedKeys(M({ savedDecks: 5 }))).toEqual(
      expect.arrayContaining(["first_save", "decks_5"]),
    );
    expect(qualifiedKeys(M({ savedDecks: 5 }))).not.toContain("decks_10");
    expect(qualifiedKeys(M({ savedDecks: 50 }))).toEqual(
      expect.arrayContaining([
        "decks_5",
        "decks_10",
        "decks_20",
        "decks_30",
        "decks_40",
        "decks_50",
      ]),
    );
  });

  it("never awards certified_trainer, even at huge metrics", () => {
    const keys = qualifiedKeys(
      M({ savedDecks: 999, totalMatches: 999, importMatches: 999 }),
    );
    expect(keys).not.toContain("certified_trainer");
    // Every other catalog key should be present at that point.
    for (const def of CATALOG) {
      if (def.key === "certified_trainer") continue;
      expect(keys).toContain(def.key);
    }
  });
});

/**
 * Minimal chainable Supabase stub covering exactly the calls
 * reconcileAchievements makes: three COUNT-only queries (gatherMetrics),
 * a `.in()` read of already-held keys, and an ignoreDuplicates upsert.
 */
function fakeSupabase(store: {
  counts: Metrics;
  held: Set<string>;
  insertedLog: string[];
}) {
  class Query {
    table: string;
    filters: Record<string, unknown> = {};
    isCount = false;
    inVals: string[] | null = null;
    upsertRows: { achievement_key: string }[] | null = null;
    constructor(table: string) {
      this.table = table;
    }
    select(_cols: string, opts?: { count?: string; head?: boolean }) {
      if (opts?.count) this.isCount = true;
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters[col] = val;
      return this;
    }
    in(_col: string, vals: string[]) {
      this.inVals = vals;
      return this;
    }
    upsert(rows: { achievement_key: string }[]) {
      this.upsertRows = rows;
      return this;
    }
    then(
      resolve: (v: { data?: unknown; count?: number; error: null }) => unknown,
      reject?: (e: unknown) => unknown,
    ) {
      return Promise.resolve(this.result()).then(resolve, reject);
    }
    result() {
      if (this.isCount) {
        if (this.table === "saved_decks")
          return { count: store.counts.savedDecks, error: null };
        if (this.table === "matches")
          return {
            count:
              this.filters.source === "tcg_live_log"
                ? store.counts.importMatches
                : store.counts.totalMatches,
            error: null,
          };
      }
      if (this.table === "user_achievements" && this.upsertRows) {
        const inserted: { achievement_key: string }[] = [];
        for (const r of this.upsertRows) {
          if (!store.held.has(r.achievement_key)) {
            store.held.add(r.achievement_key);
            store.insertedLog.push(r.achievement_key);
            inserted.push({ achievement_key: r.achievement_key });
          }
        }
        return { data: inserted, error: null };
      }
      if (this.table === "user_achievements" && this.inVals) {
        return {
          data: this.inVals
            .filter((k) => store.held.has(k))
            .map((k) => ({ achievement_key: k })),
          error: null,
        };
      }
      return { data: [], count: 0, error: null };
    }
  }
  return {
    from: (table: string) => new Query(table),
  } as never;
}

describe("reconcileAchievements — idempotent awarding", () => {
  it("inserts exactly the newly-qualified, non-held keys", async () => {
    const store = {
      counts: M({ savedDecks: 5, totalMatches: 12, importMatches: 1 }),
      held: new Set<string>(),
      insertedLog: [] as string[],
    };
    const inserted = await reconcileAchievements(fakeSupabase(store), "u1");
    expect(new Set(inserted)).toEqual(
      new Set<AchievementKey>([
        "first_save",
        "first_match",
        "first_battle_log",
        "matches_10",
        "decks_5",
      ]),
    );
    expect(inserted).not.toContain("certified_trainer");
  });

  it("is a no-op on a second call (nothing re-inserted)", async () => {
    const store = {
      counts: M({ savedDecks: 5, totalMatches: 12, importMatches: 1 }),
      held: new Set<string>(),
      insertedLog: [] as string[],
    };
    await reconcileAchievements(fakeSupabase(store), "u1");
    store.insertedLog.length = 0;
    const second = await reconcileAchievements(fakeSupabase(store), "u1");
    expect(second).toEqual([]);
    expect(store.insertedLog).toEqual([]);
  });

  it("leaves a pre-held certified_trainer untouched and doesn't re-award earned badges", async () => {
    const store = {
      counts: M({ savedDecks: 1, totalMatches: 0, importMatches: 0 }),
      held: new Set<string>(["certified_trainer", "first_save"]),
      insertedLog: [] as string[],
    };
    const inserted = await reconcileAchievements(fakeSupabase(store), "u1");
    expect(inserted).toEqual([]); // first_save already held; nothing new
    expect(store.held.has("certified_trainer")).toBe(true);
  });
});
