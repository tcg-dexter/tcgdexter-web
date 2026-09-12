// Is the archetype prior confidently RIGHT, or confidently wrong?
//
// A posterior that is always ~certain is not automatically good news. Naive
// Bayes assumes card independence, which is false — cards come in engines,
// not singly — and the failure mode of a wrong independence assumption is
// exactly an over-sharp posterior. On the recorded corpus the mean confidence
// is 0.91, which is either a well-identified opponent or a model that has
// talked itself into one. Those are opposite situations for a planner: a
// confidently wrong prior actively misleads it, while the true-but-uncertain
// case merely wastes a feature.
//
// The check is possible because generated decks carry their PARENT archetype
// as ground truth, and they are 1-8 random edits away from it — so this asks
// the real question: can the prior name the deck through the noise a mutation
// introduces, and does its stated confidence match how often it is right?
//
// Read the two columns together. Accuracy alone says nothing about
// calibration: 95% accurate at 0.98 confidence is mildly over-confident, and
// 62% accurate at 0.29 confidence is honest.
//
// Caveat this cannot fix: these decks descend from the same corpus the prior
// was built on, so the archetype is always IN the hypothesis set. It measures
// identification through mutation noise, not generalization to an unseen
// archetype.
//
// Usage:
//   npx tsx scripts/ml/prior_calibration.ts [--run HASH] [--limit N] [--db PATH]

import path from "node:path";

import { defaultCorpusPath, openCorpus } from "@/lib/ml/corpusStore";
import { metaPrior, topArchetypes } from "@/lib/ml/features/metaPrior";
import { parseDeck } from "@/lib/ml/deckGen/rules";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const RUN = arg("--run");
const LIMIT = numOrNull(arg("--limit")) ?? 500;
const REVEAL_STEPS = [1, 2, 3, 6, 12, 20];

function main(): void {
  const db = openCorpus(DB);
  const rows = (
    RUN
      ? db
          .prepare(
            `SELECT id, archetype, edit_distance, list FROM generated_decks
              WHERE run_hash LIKE ? LIMIT ?`,
          )
          .all(`${RUN}%`, LIMIT)
      : db
          .prepare(
            `SELECT id, archetype, edit_distance, list FROM generated_decks
              ORDER BY created_at DESC LIMIT ?`,
          )
          .all(LIMIT)
  ) as { id: string; archetype: string; edit_distance: number; list: string }[];
  db.close();

  if (rows.length === 0) throw new Error("[prior_calibration] no generated decks found");

  console.log(
    `[prior_calibration] ${rows.length} generated decks, parent archetype as ground truth`,
  );
  console.log(
    `  ${"revealed".padStart(8)} ${"top-1".padStart(7)} ${"top-3".padStart(7)} ` +
      `${"confidence".padStart(11)} ${"gap".padStart(7)}`,
  );

  const parsed = rows.map((r) => ({ ...r, names: parseDeck(r.list).map((e) => e.name) }));

  for (const k of REVEAL_STEPS) {
    let top1 = 0;
    let top3 = 0;
    let conf = 0;
    for (const d of parsed) {
      const revealed = d.names.slice(0, k);
      const t = topArchetypes(revealed, 3);
      conf += metaPrior(revealed).confidence;
      if (t[0]?.id === d.archetype) top1 += 1;
      if (t.some((x) => x.id === d.archetype)) top3 += 1;
    }
    const n = parsed.length;
    const acc = top1 / n;
    const c = conf / n;
    console.log(
      `  ${String(k).padStart(8)} ${(100 * acc).toFixed(1).padStart(6)}% ` +
        `${((100 * top3) / n).toFixed(1).padStart(6)}% ${c.toFixed(2).padStart(11)} ` +
        // Positive gap = over-confident: it claims more certainty than it earns.
        `${(c - acc >= 0 ? "+" : "") + (c - acc).toFixed(2)}`,
    );
  }

  // Accuracy by how far the deck was mutated from its parent. If it collapses
  // with edit distance, the prior is matching decklists rather than reading
  // archetypes, and would be useless against a list it has not memorised.
  console.log(`\n  top-1 at 6 revealed cards, by edit distance from parent:`);
  const byDist = new Map<number, { hit: number; n: number }>();
  for (const d of parsed) {
    const t = topArchetypes(d.names.slice(0, 6), 1);
    const b = byDist.get(d.edit_distance) ?? { hit: 0, n: 0 };
    b.n += 1;
    if (t[0]?.id === d.archetype) b.hit += 1;
    byDist.set(d.edit_distance, b);
  }
  for (const [dist, b] of Array.from(byDist).sort((a, b2) => a[0] - b2[0])) {
    console.log(
      `    ${String(dist).padStart(2)} edits  n=${String(b.n).padStart(4)}  ` +
        `${((100 * b.hit) / b.n).toFixed(1)}%`,
    );
  }
}

main();
