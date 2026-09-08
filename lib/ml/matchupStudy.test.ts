// The sharding contract: how many workers you use is a performance knob and
// never a variable in the result.
//
// This is the property that makes a parallel study trustworthy. A scheme
// where workers pulled from a shared queue would be simpler and would
// silently produce different games on a busy machine than on an idle one —
// and nothing downstream would ever reveal it.

import { describe, it, expect } from "vitest";
import { allPairs, pairSeed, panelPairs, shardOf, type StudyDeck } from "./matchupStudy";

const deck = (id: string, source: StudyDeck["source"] = "generated"): StudyDeck => ({
  id,
  list: `list-${id}`,
  source,
});

const subjects = ["s1", "s2", "s3", "s4", "s5"].map((i) => deck(i));
const panel = ["m1", "m2", "m3"].map((i) => deck(i, "meta"));

describe("pair seeds are a pure function of (study seed, pair index)", () => {
  it("is stable across calls and distinct across indices", () => {
    expect(pairSeed("study-1", 7)).toBe(pairSeed("study-1", 7));
    expect(pairSeed("study-1", 7)).not.toBe(pairSeed("study-1", 8));
    expect(pairSeed("study-1", 7)).not.toBe(pairSeed("study-2", 7));
  });

  it("does not hand adjacent pairs adjacent seeds", () => {
    // Adjacent seeds would correlate neighbouring pairs' opening draws, so
    // "independent" games would quietly share their luck. The mix is what
    // prevents it; a plain `base + index` would not.
    const gaps = [0, 1, 2, 3, 4].map((i) =>
      Math.abs(pairSeed("study-1", i + 1) - pairSeed("study-1", i)),
    );
    for (const g of gaps) expect(g).toBeGreaterThan(1000);
  });
});

describe("panel mode", () => {
  const pairs = panelPairs(subjects, panel, "study-1");

  it("plays every subject against every panel deck in both seat orders", () => {
    // Both orders matter: simulateMatchup alternates who moves first, but
    // deck A always holds the "player" seat.
    expect(pairs).toHaveLength(subjects.length * panel.length * 2);
    for (const s of subjects) {
      for (const p of panel) {
        expect(pairs.some((x) => x.a.id === s.id && x.b.id === p.id)).toBe(true);
        expect(pairs.some((x) => x.a.id === p.id && x.b.id === s.id)).toBe(true);
      }
    }
  });

  it("never pairs a deck with itself", () => {
    const withMeta = panelPairs([...subjects, panel[0]], panel, "study-1");
    expect(withMeta.every((p) => p.a.id !== p.b.id)).toBe(true);
  });

  it("gives every subject the same reference frame", () => {
    // The whole point of the panel: two decks are comparable by differencing
    // only if they faced the same opponents on the same seeds.
    const opponentsOf = (id: string) =>
      pairs.filter((p) => p.a.id === id).map((p) => p.b.id).sort();
    const first = opponentsOf(subjects[0].id);
    for (const s of subjects.slice(1)) expect(opponentsOf(s.id)).toEqual(first);
  });
});

describe("all-pairs mode", () => {
  it("covers every unordered pair once per seat order", () => {
    const decks = ["a", "b", "c", "d"].map((i) => deck(i));
    const pairs = allPairs(decks, "s");
    expect(pairs).toHaveLength((4 * 3) / 2 * 2);
    expect(new Set(pairs.map((p) => `${p.a.id}>${p.b.id}`)).size).toBe(pairs.length);
  });
});

describe("sharding cannot change the answer", () => {
  const pairs = panelPairs(subjects, panel, "study-1");

  it.each([1, 2, 3, 8, 16])("shard count %i partitions the same work", (shards) => {
    const seen = Array.from({ length: shards }, (_, k) => shardOf(pairs, k, shards)).flat();
    // Every pair exactly once, with its seed and index untouched.
    expect(seen).toHaveLength(pairs.length);
    const byIndex = new Map(seen.map((p) => [p.pairIndex, p]));
    expect(byIndex.size).toBe(pairs.length);
    for (const p of pairs) {
      const got = byIndex.get(p.pairIndex)!;
      expect(got.seed).toBe(p.seed);
      expect(got.a.id).toBe(p.a.id);
      expect(got.b.id).toBe(p.b.id);
    }
  });

  it("spreads a subject's pairs across shards rather than blocking them", () => {
    // Stride, not block: a block split hands one worker all of one subject's
    // games and finishes badly unbalanced when decks differ in game length.
    const shards = 4;
    const ofFirst = pairs.filter((p) => p.a.id === subjects[0].id);
    const touched = new Set(ofFirst.map((p) => p.pairIndex % shards));
    expect(touched.size).toBeGreaterThan(1);
  });
});
