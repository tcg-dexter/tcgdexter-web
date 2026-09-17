// Fit the per-item gate: given a recommendation the coach is about to
// surface, how likely is an independent oracle to confirm it?
//
// Consumes coach_trust.ts's --json. Production pays NOTHING at request time —
// every feature here is already present on `CoachedDecision` before the advice
// is rendered, which is the whole point of fitting offline rather than
// perturbing live.
//
// TWO LABELS, because they are different product questions.
//   CORRECTNESS  confirmed vs contradicted, on resolved items only.
//                "When we can tell, is the advice right?"
//   WORTHWHILE   confirmed vs everything else, on all items.
//                "Is surfacing this a good use of the player's attention?"
//                An outcome-equivalent recommendation is worthless even
//                though it is not wrong, so it belongs in the negative class
//                here and nowhere near the correctness question.
//
// HELD-OUT AUC IS SPLIT BY GAME, NOT BY DECISION. Every decision in a game
// shares a position lineage — the same deck, the same shuffle, often the same
// board two plies apart. A decision-level split leaks that lineage across the
// fold boundary and will overstate the AUC.
//
// WHAT THIS DOES NOT MEASURE. Whether a gated coach is BETTER to use. Raising
// precision by staying quiet costs recall, and which trade a player prefers is
// a product question this script cannot answer — it reports the curve, not
// the operating point.
//
// Usage:
//   npx tsx scripts/ml/coach_gate.ts --json out.json [--folds 5] [--l2 1e-3]

import fs from "node:fs";

import { hashSeed } from "@/lib/engine/sim";

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function numArg(flag: string, fallback: number): number {
  const raw = arg(flag);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`[coach-gate] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const JSON_IN = arg("--json");
const FOLDS = numArg("--folds", 5);
const L2 = numArg("--l2", 1e-3);
const ITERS = numArg("--iters", 400);

if (!JSON_IN) {
  console.error("[coach-gate] --json PATH is required (coach_trust.ts --json output)");
  process.exit(1);
}

interface Item {
  gameId: string;
  turn: number;
  playedKind: string;
  suggestedKind: string;
  legalCount: number;
  stakes: number;
  regret: number;
  regretSe: number;
  severity: string;
  capture: number | null;
  verdict: string;
}

const SEVERITY_RANK: Record<string, number> = { ok: 0, inaccuracy: 1, mistake: 2, blunder: 3 };

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}

/** Every one of these is on CoachedDecision before the advice is rendered. */
function featurize(items: Item[]): { X: number[][]; names: string[] } {
  const kinds = Array.from(new Set(items.map((i) => i.suggestedKind))).sort();
  const played = Array.from(new Set(items.map((i) => i.playedKind))).sort();
  const names = [
    "regret",
    "regret_over_se",
    "log_stakes",
    "legal_count",
    "capture",
    "severity_rank",
    "turn",
    ...kinds.map((k) => `suggest_${k}`),
    ...played.map((k) => `played_${k}`),
  ];
  const X = items.map((i) => [
    i.regret,
    i.regretSe > 0 ? i.regret / i.regretSe : 0,
    Math.log1p(Math.max(0, i.stakes)),
    i.legalCount,
    i.capture ?? 0.5,
    SEVERITY_RANK[i.severity] ?? 0,
    i.turn,
    ...kinds.map((k) => (i.suggestedKind === k ? 1 : 0)),
    ...played.map((k) => (i.playedKind === k ? 1 : 0)),
  ]);
  return { X, names };
}

function standardize(X: number[][]): { Z: number[][]; mu: number[]; sg: number[] } {
  const p = X[0].length;
  const mu = Array.from({ length: p }, (_, j) => mean(X.map((r) => r[j])));
  const sg = Array.from({ length: p }, (_, j) => {
    const s = sd(X.map((r) => r[j]));
    return s > 1e-9 ? s : 1;
  });
  return { Z: X.map((r) => r.map((v, j) => (v - mu[j]) / sg[j])), mu, sg };
}

function fit(Z: number[][], y: number[], l2: number, iters: number): number[] {
  const p = Z[0].length;
  const w = new Array<number>(p + 1).fill(0);
  // Intercept starts at the base log-odds so the fit does not spend its early
  // iterations rediscovering the class balance.
  const base = mean(y);
  w[p] = Math.log(Math.max(1e-6, base) / Math.max(1e-6, 1 - base));
  const lr = 0.5;
  for (let t = 0; t < iters; t++) {
    const g = new Array<number>(p + 1).fill(0);
    for (let i = 0; i < Z.length; i++) {
      let z = w[p];
      for (let j = 0; j < p; j++) z += w[j] * Z[i][j];
      const pr = 1 / (1 + Math.exp(-z));
      const e = pr - y[i];
      for (let j = 0; j < p; j++) g[j] += e * Z[i][j];
      g[p] += e;
    }
    const scale = lr / Z.length;
    for (let j = 0; j < p; j++) w[j] -= scale * g[j] + lr * l2 * w[j];
    w[p] -= scale * g[p];
  }
  return w;
}

function score(w: number[], z: number[]): number {
  let s = w[w.length - 1];
  for (let j = 0; j < z.length; j++) s += w[j] * z[j];
  return 1 / (1 + Math.exp(-s));
}

/** Rank-based AUC, ties averaged. */
function auc(scores: number[], y: number[]): number {
  const pos = y.filter((v) => v === 1).length;
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) return 0.5;
  const idx = scores.map((s, i) => ({ s, y: y[i] })).sort((a, b) => a.s - b.s);
  const ranks = new Array<number>(idx.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].s === idx[i].s) j++;
    const r = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[k] = r;
    i = j + 1;
  }
  let sumPos = 0;
  for (let k = 0; k < idx.length; k++) if (idx[k].y === 1) sumPos += ranks[k];
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Fold assignment keyed on the GAME, so a game's decisions never straddle
 *  the boundary. Hashed rather than round-robin so fold size does not alias
 *  with the order games were generated in. */
function foldOf(gameId: string, folds: number): number {
  return hashSeed(`coach-gate:${gameId}`) % folds;
}

function evaluate(items: Item[], y: number[], label: string): void {
  if (items.length < 50) {
    console.log(`\n${label}: only ${items.length} items — too few to fit. Skipped.`);
    return;
  }
  const { X, names } = featurize(items);
  const folds = items.map((i) => foldOf(i.gameId, FOLDS));
  const oof = new Array<number>(items.length).fill(0.5);

  for (let f = 0; f < FOLDS; f++) {
    const trIdx = items.map((_, i) => i).filter((i) => folds[i] !== f);
    const teIdx = items.map((_, i) => i).filter((i) => folds[i] === f);
    if (trIdx.length < 20 || teIdx.length === 0) continue;
    const { Z, mu, sg } = standardize(trIdx.map((i) => X[i]));
    const w = fit(
      Z,
      trIdx.map((i) => y[i]),
      L2,
      ITERS,
    );
    for (const i of teIdx) {
      oof[i] = score(
        w,
        X[i].map((v, j) => (v - mu[j]) / sg[j]),
      );
    }
  }

  const a = auc(oof, y);
  const base = mean(y);
  console.log(`\n${label}`);
  console.log(
    `  n=${items.length}  positives ${(100 * base).toFixed(1)}%  ` +
      `HELD-OUT AUC ${a.toFixed(3)} (split by game, ${FOLDS} folds)  ` +
      (a > 0.6 ? "usable" : a > 0.55 ? "weak" : "NOT USABLE — gate on the class prior instead"),
  );

  // The operating curve. Precision is what a gate buys; recall is what it
  // costs. Reported together because quoting either alone sells the gate.
  console.log(`  keep-rate   precision   recall   (threshold on P(confirm))`);
  for (const keep of [1.0, 0.9, 0.75, 0.5, 0.25]) {
    const sorted = oof.slice().sort((x, z) => z - x);
    const cut = sorted[Math.min(sorted.length - 1, Math.floor(keep * sorted.length))] ?? 0;
    const kept = items.map((_, i) => i).filter((i) => oof[i] >= cut);
    if (kept.length === 0) continue;
    const tp = kept.filter((i) => y[i] === 1).length;
    const allPos = y.filter((v) => v === 1).length;
    console.log(
      `    ${(100 * keep).toFixed(0).padStart(3)}%       ` +
        `${((100 * tp) / kept.length).toFixed(1)}%      ` +
        `${((100 * tp) / allPos).toFixed(1)}%`,
    );
  }

  // Fit once on everything for the reported coefficients. These are for
  // reading, not for scoring — the AUC above is the honest number.
  const { Z, mu, sg } = standardize(X);
  void mu;
  void sg;
  const w = fit(Z, y, L2, ITERS);
  const ranked = names
    .map((n, j) => ({ n, w: w[j] }))
    .sort((p, q) => Math.abs(q.w) - Math.abs(p.w))
    .slice(0, 8);
  console.log(`  strongest standardized coefficients:`);
  for (const r of ranked) {
    console.log(`    ${r.n.padEnd(24)}${r.w >= 0 ? "+" : ""}${r.w.toFixed(3)}`);
  }
}

function main(): void {
  const raw = JSON.parse(fs.readFileSync(JSON_IN as string, "utf8")) as { items: Item[] };
  const items = raw.items;
  console.log(`[coach-gate] ${items.length} graded recommendations from ${JSON_IN}`);
  const games = new Set(items.map((i) => i.gameId)).size;
  console.log(`[coach-gate] ${games} distinct games, ${FOLDS} folds, L2 ${L2}`);

  const resolved = items.filter(
    (i) => i.verdict === "CONFIRMED" || i.verdict === "CONTRADICTED",
  );
  evaluate(
    resolved,
    resolved.map((i) => (i.verdict === "CONFIRMED" ? 1 : 0)),
    "CORRECTNESS — confirmed vs contradicted (resolved items only)",
  );
  evaluate(
    items,
    items.map((i) => (i.verdict === "CONFIRMED" ? 1 : 0)),
    "WORTHWHILE — confirmed vs everything else (all surfaced items)",
  );
  // Exit 0 regardless. A gate that does not work is a result.
}

main();
