// Matchup studies: which pairs of decks to simulate, and how to split that
// work across cores without the split changing the answer.
//
// Two modes, because they answer different questions:
//
//   panel      every deck plays the SAME reference decks over the SAME seed
//              block. The frame is identical for everyone, so any two decks
//              are comparable by differencing — which is what makes a
//              parent-vs-child swap delta meaningful. This is the mode that
//              scales: 400 decks x 30 panel x 30 games is ~720k games, where
//              the equivalent all-pairs round robin is 7.98M.
//
//   all-pairs  every deck against every other. Answers a genuinely different
//              question — the STRUCTURE of the matchup graph, its
//              rock-paper-scissors cycles and clusters — and is only
//              affordable on a small subset.
//
// The sharding rule is the load-bearing part. Each pair's seed derives from
// (studySeed, pairIndex) alone, and shard k takes the pairs where
// pairIndex % shards === k. Nothing about a pair's result depends on which
// worker ran it or how many workers there were, so `--shards 8` and
// `--shards 1` produce byte-identical output. A scheme where workers drew
// from a shared counter would be faster to write and quietly irreproducible.

import { hashSeed } from "@/lib/engine/sim";

export interface StudyDeck {
  id: string;
  list: string;
  source: "meta" | "generated" | "community";
}

export interface StudyPair {
  pairIndex: number;
  a: StudyDeck;
  b: StudyDeck;
  /** Derived from (studySeed, pairIndex) — never from worker or wall clock. */
  seed: number;
}

const GOLDEN_RATIO_32 = 0x9e3779b9;

/** Seed for one pair. Mixed rather than added: adjacent pair indices must not
 *  produce adjacent seeds, or neighbouring pairs share their opening draws
 *  and the "independent" games are correlated. */
export function pairSeed(studySeed: string, pairIndex: number): number {
  return (hashSeed(studySeed) ^ Math.imul(pairIndex + 1, GOLDEN_RATIO_32)) >>> 0;
}

/** Panel mode: `subjects` x `panel`, both seat orders.
 *
 *  Both orders are not optional. simulateMatchup alternates who moves first,
 *  but deck A always occupies the "player" seat, and value_gate.ts records a
 *  seat/initiative confound that once faked an entire result. */
export function panelPairs(
  subjects: StudyDeck[],
  panel: StudyDeck[],
  studySeed: string,
): StudyPair[] {
  const out: StudyPair[] = [];
  for (const s of subjects) {
    for (const p of panel) {
      if (s.id === p.id) continue; // a deck is not its own reference point
      for (const [a, b] of [
        [s, p],
        [p, s],
      ] as [StudyDeck, StudyDeck][]) {
        out.push({ pairIndex: out.length, a, b, seed: 0 });
      }
    }
  }
  // Seeds assigned after the full list exists, so pairIndex is stable and the
  // seed is a pure function of it.
  return out.map((p) => ({ ...p, seed: pairSeed(studySeed, p.pairIndex) }));
}

/** All-pairs mode: every unordered pair, both seat orders. */
export function allPairs(decks: StudyDeck[], studySeed: string): StudyPair[] {
  const out: StudyPair[] = [];
  for (let i = 0; i < decks.length; i++) {
    for (let j = i + 1; j < decks.length; j++) {
      for (const [a, b] of [
        [decks[i], decks[j]],
        [decks[j], decks[i]],
      ] as [StudyDeck, StudyDeck][]) {
        out.push({ pairIndex: out.length, a, b, seed: 0 });
      }
    }
  }
  return out.map((p) => ({ ...p, seed: pairSeed(studySeed, p.pairIndex) }));
}

/** The pairs belonging to shard `k` of `shards`. Stride, not block: a block
 *  split would hand one worker all of a single subject's pairs and finish
 *  badly unbalanced when decks differ in game length. */
export function shardOf(pairs: StudyPair[], shard: number, shards: number): StudyPair[] {
  if (shards <= 1) return pairs;
  return pairs.filter((p) => p.pairIndex % shards === shard);
}
