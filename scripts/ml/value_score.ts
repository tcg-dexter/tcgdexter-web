// Score value artifacts on a corpus they did not train on.
//
// The ablation's offline metrics cannot be compared directly, and it is worth
// being precise about why. The control model's held-out set holds 30 decks it
// saw ~667 times each; the treatment model's holds decks it saw ~10 times.
// Predicting a winner is intrinsically harder on a wider deck distribution,
// so the two models sat different exams and the lower AUC is partly the exam.
//
// This scores any number of artifacts on the SAME rows, so the comparison is
// like for like. Point it at a corpus built from decks NEITHER model trained
// on and it stops being a fairness fix and becomes the actual hypothesis:
// which model generalizes to decks it has never seen?
//
// Reads stored decisions rather than replaying games — `state_sparse` IS the
// encodeStateFeatures output, so scoring is exact and costs no simulation.
//
// Usage:
//   npx tsx scripts/ml/value_score.ts --runs HASH [--db PATH]
//     --artifacts a.json,b.json [--labels a,b] [--limit N]

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readValueArtifact, scoreGbdt, scoreLinearVector } from "@/lib/ml/botEvaluator";
import { STATE_FEATURE_NAMES } from "@/lib/ml/features/policy";
import { defaultCorpusPath } from "@/lib/ml/corpusStore";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const RUNS = (arg("--runs") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
const ARTIFACTS = (arg("--artifacts") ?? "").split(",").map((a) => a.trim()).filter(Boolean);
const LABELS = (arg("--labels") ?? "").split(",").map((a) => a.trim()).filter(Boolean);
const LIMIT = numOrNull(arg("--limit"));

if (RUNS.length === 0 || ARTIFACTS.length === 0) {
  throw new Error("[value_score] --runs and --artifacts are required");
}

/** AUC by rank-sum — exact, and unbothered by score scale. */
function auc(scores: number[], labels: number[]): number {
  const idx = scores.map((s, i) => [s, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(scores.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j += 1;
    const avg = (i + j) / 2 + 1; // average rank for ties
    for (let k = i; k <= j; k++) ranks[idx[k][1]] = avg;
    i = j + 1;
  }
  const pos = labels.reduce((s, l) => s + l, 0);
  const neg = labels.length - pos;
  if (pos === 0 || neg === 0) return 0.5;
  const rankSumPos = labels.reduce((s, l, k) => s + (l === 1 ? ranks[k] : 0), 0);
  return (rankSumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

function main(): void {
  const db = new DatabaseSync(DB, { readOnly: true });

  // Resolve run-hash prefixes so a 12-char hash from a log line works.
  const all = (
    db.prepare("SELECT run_hash FROM policy_runs").all() as { run_hash: string }[]
  ).map((r) => r.run_hash);
  const hashes = RUNS.map((r) => {
    const hit = all.find((h) => h === r || h.startsWith(r));
    if (!hit) throw new Error(`[value_score] run not found: ${r}`);
    return hit;
  });

  const rows = db
    .prepare(
      `SELECT state_sparse, outcome FROM policy_decisions
       WHERE run_hash IN (${hashes.map(() => "?").join(",")})
         AND outcome != 0.5
       ${LIMIT ? `LIMIT ${LIMIT}` : ""}`,
    )
    .all(...hashes) as { state_sparse: string; outcome: number }[];
  db.close();

  if (rows.length === 0) throw new Error("[value_score] no decided decisions in those runs");

  // Dense vectors once, reused by every artifact — the scoring loop is the
  // cheap part and the decoding is not.
  const width = STATE_FEATURE_NAMES.length;
  const vectors: Float64Array[] = [];
  const labels: number[] = [];
  for (const r of rows) {
    const v = new Float64Array(width);
    const sparse = JSON.parse(r.state_sparse) as Record<string, number>;
    for (const [k, val] of Object.entries(sparse)) v[Number(k)] = val;
    vectors.push(v);
    labels.push(r.outcome >= 0.5 ? 1 : 0);
  }

  console.log(
    `[value_score] ${rows.length.toLocaleString()} decided decisions from ` +
      `${hashes.length} run(s) — every artifact scored on THESE rows`,
  );
  console.log(`  ${"model".padEnd(28)} ${"auc".padStart(7)} ${"log_loss".padStart(9)} ${"brier".padStart(7)} ${"acc".padStart(7)}`);

  for (let a = 0; a < ARTIFACTS.length; a++) {
    const artifact = readValueArtifact(path.resolve(ARTIFACTS[a]));
    if (!artifact) {
      console.log(`  ${(LABELS[a] ?? ARTIFACTS[a]).padEnd(28)}  (unreadable)`);
      continue;
    }
    const nameIndex = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i]));
    const srcIdx = artifact.features.map((n) => nameIndex.get(n) ?? -1);
    const isGbdt = artifact.model_type === "gbdt";
    if (isGbdt && srcIdx.some((j) => j < 0)) {
      // Same refusal createBoardEvaluator makes: a tree routes on exact
      // thresholds, so a missing feature is silent nonsense, not degradation.
      console.log(`  ${(LABELS[a] ?? ARTIFACTS[a]).padEnd(28)}  (feature mismatch — refused)`);
      continue;
    }
    const row = new Float64Array(srcIdx.length);
    const scores: number[] = [];
    let ll = 0;
    let brier = 0;
    let correct = 0;
    for (let i = 0; i < vectors.length; i++) {
      const v = vectors[i];
      let p: number;
      if (isGbdt) {
        for (let k = 0; k < srcIdx.length; k++) row[k] = v[srcIdx[k]];
        p = scoreGbdt(artifact, row);
      } else {
        p = scoreLinearVector(artifact, srcIdx, v);
      }
      scores.push(p);
      const y = labels[i];
      const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
      ll += -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
      brier += (p - y) ** 2;
      if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
    }
    const n = vectors.length;
    console.log(
      `  ${(LABELS[a] ?? path.basename(ARTIFACTS[a])).padEnd(28)} ` +
        `${auc(scores, labels).toFixed(4).padStart(7)} ${(ll / n).toFixed(4).padStart(9)} ` +
        `${(brier / n).toFixed(4).padStart(7)} ${(correct / n).toFixed(4).padStart(7)}`,
    );
  }
}

main();
