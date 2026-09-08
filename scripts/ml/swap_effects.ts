// What did that card swap actually do?
//
// Reads a panel study (scripts/ml/matchups.ts --mode panel --with-parents)
// and turns it into paired deck deltas: a generated deck's record against the
// reference panel, minus its PARENT's record against the same panel on the
// same seeds.
//
// Why paired: W5 established that an absolute simulated win rate carries
// essentially no information about the real one (fit slope 0.012, worse than
// assuming every deck is average). The bias is the pilot — it is good at
// "attach and swing" decks and bad at engine decks, so the simulated meta
// takes the shape of the AI rather than the format. That bias lands in FULL
// on an absolute rate and largely CANCELS on a difference between two decks
// the same pilot played against the same opponents. The delta is the only
// estimator here with a claim to meaning; this script computes nothing else.
//
// Per-CARD attribution is restricted to edit distance 1 by default. A deck
// four swaps from its parent has one delta and four candidate explanations,
// and spreading the credit evenly across them is a way of manufacturing
// signal rather than measuring it. --max-distance widens it if you want the
// noisier view.
//
// Usage:
//   npx tsx scripts/ml/swap_effects.ts [--study HASH] [--min-games 60]
//     [--max-distance 1] [--top 25] [--db PATH] [--json out.json]

import path from "node:path";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { defaultCorpusPath } from "@/lib/ml/corpusStore";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const STUDY = arg("--study");
const MIN_GAMES = numOrNull(arg("--min-games")) ?? 60;
const MAX_DISTANCE = numOrNull(arg("--max-distance")) ?? 1;
const TOP = numOrNull(arg("--top")) ?? 25;
const JSON_OUT = arg("--json");

interface Record_ {
  games: number;
  wins: number;
  /** Opponent ids faced, so two decks can be checked for a shared frame. */
  panel: Set<string>;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const pts = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}`;

/** Standard error of a difference of two independent proportions, in points.
 *  Common random numbers make the arms POSITIVELY correlated, so this is a
 *  conservative (over-wide) interval — the honest direction to err. */
function seDiff(a: Record_, b: Record_): number {
  const p1 = a.wins / a.games;
  const p2 = b.wins / b.games;
  return Math.sqrt((p1 * (1 - p1)) / a.games + (p2 * (1 - p2)) / b.games);
}

function main(): void {
  const db = new DatabaseSync(DB, { readOnly: true });

  const study =
    STUDY ??
    (
      db
        .prepare(
          "SELECT study_id FROM matchup_studies WHERE mode='panel' ORDER BY created_at DESC LIMIT 1",
        )
        .get() as { study_id: string } | undefined
    )?.study_id;
  if (!study) throw new Error(`[swap_effects] no panel study in ${DB}`);

  // Every deck's record against the panel, both seat orders folded together.
  const records = new Map<string, Record_>();
  const bump = (id: string, opp: string, games: number, wins: number) => {
    const r = records.get(id) ?? { games: 0, wins: 0, panel: new Set<string>() };
    r.games += games;
    r.wins += wins;
    r.panel.add(opp);
    records.set(id, r);
  };
  const rows = db
    .prepare(
      `SELECT deck_a, deck_b, n, wins_a, wins_b FROM matchup_results WHERE study_id = ?`,
    )
    .all(study) as { deck_a: string; deck_b: string; n: number; wins_a: number; wins_b: number }[];
  for (const r of rows) {
    bump(r.deck_a, r.deck_b, r.n, r.wins_a);
    bump(r.deck_b, r.deck_a, r.n, r.wins_b);
  }

  const decks = db
    .prepare(
      `SELECT id, parent_id, archetype, edit_distance, ops_json FROM generated_decks
       WHERE parent_id IS NOT NULL`,
    )
    .all() as {
    id: string;
    parent_id: string;
    archetype: string | null;
    edit_distance: number;
    ops_json: string;
  }[];

  interface Delta {
    child: string;
    parent: string;
    archetype: string | null;
    distance: number;
    childRate: number;
    parentRate: number;
    delta: number;
    se: number;
    games: number;
    ops: string[];
  }
  const deltas: Delta[] = [];
  let skippedNoParent = 0;
  let skippedThin = 0;
  let skippedFrame = 0;

  for (const d of decks) {
    const c = records.get(d.id);
    const p = records.get(d.parent_id);
    if (!c || !p) {
      skippedNoParent += 1;
      continue;
    }
    if (c.games < MIN_GAMES || p.games < MIN_GAMES) {
      skippedThin += 1;
      continue;
    }
    // The comparison is only paired if both arms faced the same opponents.
    // Anything else is two absolute rates wearing a delta's clothes.
    const shared = Array.from(c.panel).filter((o) => p.panel.has(o)).length;
    if (shared < Math.min(c.panel.size, p.panel.size)) {
      skippedFrame += 1;
      continue;
    }
    const childRate = c.wins / c.games;
    const parentRate = p.wins / p.games;
    deltas.push({
      child: d.id,
      parent: d.parent_id,
      archetype: d.archetype,
      distance: d.edit_distance,
      childRate,
      parentRate,
      delta: childRate - parentRate,
      se: seDiff(c, p),
      games: c.games,
      ops: JSON.parse(d.ops_json) as string[],
    });
  }

  console.log(`[swap_effects] study ${study.slice(0, 12)} — ${rows.length.toLocaleString()} pairs`);
  console.log(
    `[swap_effects] ${deltas.length} paired deltas ` +
      `(skipped: ${skippedNoParent} no parent record, ${skippedThin} thin, ${skippedFrame} unshared panel)`,
  );
  if (deltas.length === 0) {
    console.log(
      "[swap_effects] nothing to report. Was the study run --with-parents? " +
        "Without it the parents never played the panel and no delta exists.",
    );
    db.close();
    return;
  }

  // Deck-level: the biggest movers, which is the honest unit of measurement.
  const sorted = [...deltas].sort((a, b) => b.delta - a.delta);
  const show = (d: Delta) =>
    `${pts(d.delta)} pts (±${(d.se * 100 * 1.96).toFixed(1)})  ${pct(d.parentRate)}→${pct(d.childRate)}  ` +
    `d=${d.distance}  ${d.archetype ?? "?"}\n      ${d.ops.slice(0, 6).join(", ")}`;
  console.log(`\n  ── biggest improvements ──`);
  for (const d of sorted.slice(0, 5)) console.log(`  ${show(d)}`);
  console.log(`\n  ── biggest regressions ──`);
  for (const d of sorted.slice(-5).reverse()) console.log(`  ${show(d)}`);

  // Does wandering further from a real list help or hurt? This is the curve
  // the graduated pool exists to produce.
  console.log(`\n  ── effect by edit distance ──`);
  const byDist = new Map<number, number[]>();
  for (const d of deltas) byDist.set(d.distance, [...(byDist.get(d.distance) ?? []), d.delta]);
  for (const dist of Array.from(byDist.keys()).sort((a, b) => a - b)) {
    const xs = byDist.get(dist)!;
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1));
    console.log(
      `  ${String(dist).padStart(2)} edits  n=${String(xs.length).padStart(4)}  ` +
        `mean ${pts(mean)} pts  sd ${(sd * 100).toFixed(1)}`,
    );
  }

  // Per-card, single-swap decks only. Anything wider cannot attribute.
  const clean = deltas.filter((d) => d.distance <= MAX_DISTANCE);
  const byCard = new Map<string, number[]>();
  for (const d of clean) {
    for (const op of d.ops) {
      const m = op.match(/^([+-])\d+ (.+)$/);
      if (!m) continue;
      const key = `${m[1] === "+" ? "in " : "out"} ${m[2]}`;
      byCard.set(key, [...(byCard.get(key) ?? []), d.delta]);
    }
  }
  const cards = Array.from(byCard)
    .filter(([, xs]) => xs.length >= 3)
    .map(([card, xs]) => ({
      card,
      n: xs.length,
      mean: xs.reduce((s, x) => s + x, 0) / xs.length,
    }))
    .sort((a, b) => b.mean - a.mean);
  console.log(
    `\n  ── per-card effect (edit distance <= ${MAX_DISTANCE}, n>=3) — ` +
      `${clean.length} single-swap decks ──`,
  );
  if (cards.length === 0) {
    console.log("  not enough single-swap decks yet; widen with --max-distance");
  } else {
    for (const c of cards.slice(0, TOP)) {
      console.log(`  ${pts(c.mean).padStart(6)} pts  n=${String(c.n).padStart(3)}  ${c.card}`);
    }
    if (cards.length > TOP) {
      console.log(`  … and ${cards.length - TOP} more`);
    }
  }

  console.log(
    `\n  NOTE: these are deltas within the SIMULATOR, paired so the pilot's\n` +
      `  bias cancels. They are not claims about the real format, and an\n` +
      `  absolute win rate from this study means nothing (W5: slope 0.012).`,
  );

  if (JSON_OUT) {
    writeFileSync(path.resolve(JSON_OUT), JSON.stringify({ study, deltas }, null, 2) + "\n");
    console.log(`\n[swap_effects] wrote ${JSON_OUT}`);
  }
  db.close();
}

main();
