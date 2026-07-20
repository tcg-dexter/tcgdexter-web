// Frozen benchmark deck loader. The self-play trainer and the duel both
// otherwise front-slice the LIVE data/meta-decks.json, which a scheduled job
// refreshes AND reorders daily — so a model trained one day and evaluated the
// next silently sees different decks on each side, an uncontrolled train/eval
// mismatch. A `--decks-file` pointing at a frozen fixture (see
// data/ml/benchmark-decks.json) removes that variable: same fixed deck set,
// reproducible across days, the stable ruler every strength comparison needs.

import { readFileSync } from "node:fs";

export interface BenchmarkDeck {
  id: string;
  list: string;
}

interface BenchmarkFixture {
  name?: string;
  snapshot_date?: string;
  decks: BenchmarkDeck[];
}

/** Loads {id, list}[] from a frozen benchmark fixture JSON. The lists are
 *  already resolved deck-list text (not meta-deck card arrays), so no
 *  metaDeckToList conversion — they instantiate exactly as stored. */
export function loadBenchmarkDecks(filePath: string): BenchmarkDeck[] {
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as BenchmarkFixture;
  const decks = (parsed.decks ?? []).filter((d) => d.id && d.list);
  if (decks.length === 0) {
    throw new Error(`benchmark fixture ${filePath} has no usable decks`);
  }
  return decks;
}
