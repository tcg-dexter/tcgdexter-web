// The diversity ablation — the experiment this whole pipeline exists to run.
//
// Question: does training the pilot on a WIDER distribution of decks make it
// better, or is 30 archetypes already enough?
//
// This is not the same question as "does more data help". That one has been
// answered, in the negative: value-gbm v19 trained on more games (2,660 vs
// 1,985), scored better on every offline metric, and lost end to end
// (out-of-sample skill -6% -> -9%). Volume is not the lever.
//
// So the two arms are held at IDENTICAL game counts, seeds, skills, engine
// and evaluator. The only thing that differs is which decks are in the hat:
//
//   control     meta pool only            (30 archetypes)
//   treatment   meta UNION generated      (30 + N synthesized)
//
// Note "treatment" is not `--matchup meta-vs-generated`. That would change
// the matchup STRUCTURE as well as the pool — generated decks would only
// ever be seen from across the table, never piloted — and any difference in
// the trained model could not be attributed to diversity. `mixed` draws both
// seats from the union, so the control's distribution is a strict subset of
// the treatment's.
//
// This script runs the two self-play arms. Training and scoring are separate
// commands (they live in dexter-ml, in Python) and are printed at the end,
// with the run hashes filled in — because `--runs` is what stops the trainer
// pooling both arms into one dataset and measuring nothing.
//
// Usage:
//   npx tsx scripts/ml/ablation.ts [--games 20000] [--seed 1] [--shards 8]
//     [--generated-decks 2000] [--decks 30] [--dry-run]

import path from "node:path";
import { spawnSync } from "node:child_process";

import { defaultCorpusPath, openCorpus } from "@/lib/ml/corpusStore";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const GAMES = numOrNull(arg("--games")) ?? 20000;
const SEED = numOrNull(arg("--seed")) ?? 1;
const SHARDS = numOrNull(arg("--shards")) ?? 8;
const GENERATED = numOrNull(arg("--generated-decks")) ?? 2000;
const DECKS = numOrNull(arg("--decks")) ?? 30;
const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const DRY = process.argv.includes("--dry-run");

interface Arm {
  name: string;
  matchup: string;
  why: string;
}

const ARMS: Arm[] = [
  { name: "control", matchup: "meta", why: "30 meta archetypes, both seats" },
  {
    name: "treatment",
    matchup: "mixed",
    why: `meta UNION ${GENERATED} generated, both seats`,
  },
];

/** Run one self-play arm, sharded, and return its run hash. */
function runArm(arm: Arm): string | null {
  const args = [
    "tsx", "scripts/ml/selfplay.ts",
    "--matchup", arm.matchup,
    "--games", String(GAMES),
    "--seed", String(SEED),
    "--decks", String(DECKS),
    "--generated-decks", String(GENERATED),
    // Decisions only: the value model never reads candidate rows, and they
    // are 853 a game against 99 — the difference between ~1.5 GB and ~5 GB
    // for this experiment, plus the CPU to encode every one.
    "--record", "decisions",
    "--store", DB,
    "--shards", String(SHARDS),
  ];
  console.log(`\n[ablation] ${arm.name}: ${arm.why}`);
  console.log(`[ablation]   npx ${args.join(" ")}`);
  if (DRY) return null;

  const started = Date.now();
  const res = spawnSync("npx", args, { cwd: REPO_ROOT, encoding: "utf8" });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  if (res.status !== 0) {
    console.error(out.slice(-2000));
    throw new Error(`[ablation] ${arm.name} arm failed (exit ${res.status})`);
  }
  for (const line of out.split("\n")) {
    if (line.includes("[selfplay]")) console.log(`  ${line.trim()}`);
  }
  console.log(`[ablation]   ${((Date.now() - started) / 1000 / 60).toFixed(1)} min`);
  const m = out.match(/run ([0-9a-f]{12,})/);
  return m ? m[1] : null;
}

function main(): void {
  console.log(
    `[ablation] diversity ablation — ${ARMS.length} arms x ${GAMES.toLocaleString()} games, ` +
      `identical seed/skills/engine. Only the deck pool differs.`,
  );

  const hashes: Record<string, string | null> = {};
  for (const arm of ARMS) hashes[arm.name] = runArm(arm);
  if (DRY) {
    console.log("\n[ablation] --dry-run: nothing simulated");
    return;
  }

  // Report what each arm actually saw. A treatment arm that drew mostly meta
  // decks anyway would look like a null result while being a setup error, so
  // the deck coverage is part of the output, not an afterthought.
  const db = openCorpus(DB);
  console.log("\n[ablation] corpus summary");
  for (const arm of ARMS) {
    const h = hashes[arm.name];
    if (!h) continue;
    const row = db
      .prepare(
        `SELECT COUNT(*) AS games,
                COUNT(DISTINCT deck_a) + COUNT(DISTINCT deck_b) AS deck_slots,
                SUM(CASE WHEN deck_a_source='generated' OR deck_b_source='generated'
                         THEN 1 ELSE 0 END) AS with_generated,
                AVG(turns) AS avg_turns
         FROM policy_games WHERE run_hash LIKE ?`,
      )
      .get(`${h}%`) as Record<string, number>;
    const ends = db
      .prepare(
        `SELECT end_reason, COUNT(*) AS n FROM policy_games
         WHERE run_hash LIKE ? GROUP BY end_reason ORDER BY n DESC`,
      )
      .all(`${h}%`) as { end_reason: string; n: number }[];
    console.log(
      `  ${arm.name.padEnd(10)} run ${h.slice(0, 12)}  games=${row.games}  ` +
        `distinct decks≈${row.deck_slots}  with_generated=${row.with_generated}  ` +
        `avg_turns=${Number(row.avg_turns).toFixed(1)}`,
    );
    console.log(
      `             end reasons: ${ends.map((e) => `${e.end_reason} ${e.n}`).join(", ")}`,
    );
  }
  db.close();

  const mlRoot = path.resolve(REPO_ROOT, "..", "dexter-ml");
  console.log(`\n[ablation] next — train each arm SEPARATELY (--runs is what keeps them apart):`);
  for (const arm of ARMS) {
    const h = hashes[arm.name];
    if (!h) continue;
    console.log(
      `  (cd ${mlRoot} && scripts/.venv/bin/python3 scripts/ml_train_value_gbm.py \\\n` +
        `      --db ${DB} --sim-version 24 --runs ${h.slice(0, 16)} \\\n` +
        // No --publish: promotion is earned by the duel, not by training.
        `      --out artifacts/value/value-gbm-${arm.name}.json)`,
    );
  }
  // Both scorers read the PROMOTED artifact by default. DEXTER_VALUE_ARTIFACT
  // (see readValueArtifact) points them at a candidate instead — the seam that
  // makes it possible to score a model without promoting it first.
  const cand = (arm: string) =>
    path.resolve(mlRoot, `artifacts/value/value-gbm-${arm}.json`);
  console.log(`\n[ablation] then score BOTH on the REAL archetypes:`);
  for (const arm of ARMS) {
    console.log(
      `  DEXTER_VALUE_ARTIFACT="${cand(arm.name)}" \\\n` +
        `    npx tsx scripts/ml/pilot_competence.ts --n 12 --decks 12 --json ${arm.name}-competence.json`,
    );
  }
  console.log(
    `  npx tsx scripts/ml/value_duel.ts --a "${cand("treatment")}" --b "${cand("control")}" ` +
      `--games 240 --seed d1`,
  );
  console.log(
    `\n[ablation] gate: treatment must not regress pilotCompetence on the REAL\n` +
      `  archetypes, and must win the duel across >=3 seeds. Anything less and\n` +
      `  diversity did not help — which is a result worth having, not a failure.`,
  );
}

main();
