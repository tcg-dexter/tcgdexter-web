// Matchup study runner — outcome-only simulation at scale.
//
// Records who won, not how they played. That is the whole trick: a fully
// recorded game costs ~131 KB, so the all-pairs study the naive version of
// this plan called for would have been ~1 TB. An outcome row is ~200 bytes,
// which puts a 100k-pair study inside a few megabytes and moves the binding
// constraint back to compute, where it belongs.
//
// Parallel by child-process fan-out (the sim is CPU-bound and Node is
// single-threaded). Shard k takes pairs where pairIndex % shards === k, and
// every pair's seed is a pure function of (studySeed, pairIndex) — so worker
// count is a performance knob and never a variable in the result. That
// property has a test; see matchupStudy.test.ts.
//
// Usage:
//   npx tsx scripts/ml/matchups.ts --mode panel     [--subjects N] [--panel N]
//   npx tsx scripts/ml/matchups.ts --mode all-pairs [--decks N]
//     [--games 30] [--seed study-1] [--shards 8] [--skill 1]
//     [--pool generated|meta|both] [--with-parents] [--generated-run HASH]
//     [--db PATH] [--dry-run]
//
// --dry-run prints the plan and the cost, which is the right way to find out
// that you just asked for 8 million games before you ask for them.

import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";

import metaDecksRaw from "@/data/meta-decks.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { ENGINE_VERSION } from "@/lib/engine/types";
import { SIM_VERSION, PlannerPolicy, plannerParamsForSkill } from "@/lib/engine/sim";
import { simulateMatchup } from "@/lib/engine/sim/rollout";
import { createBotEvaluator } from "@/lib/ml/botEvaluator";
import { loadGeneratedDecks } from "@/lib/ml/generatedDecks";
import { buildCorpus, loadMetaCorpus } from "@/lib/ml/deckGen/corpus";
import { renderDeck } from "@/lib/ml/deckGen/rules";
import { defaultCorpusPath, openCorpus } from "@/lib/ml/corpusStore";
import {
  allPairs,
  panelPairs,
  shardOf,
  type StudyDeck,
  type StudyPair,
} from "@/lib/ml/matchupStudy";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const MODE = (arg("--mode") ?? "panel") as "panel" | "all-pairs";
const GAMES = numOrNull(arg("--games")) ?? 30;
const SEED = arg("--seed") ?? "study-1";
const SKILL = numOrNull(arg("--skill")) ?? 1;
const SUBJECTS = numOrNull(arg("--subjects")) ?? 200;
const PANEL = numOrNull(arg("--panel")) ?? 30;
const DECKS = numOrNull(arg("--decks")) ?? 100;
const POOL = (arg("--pool") ?? "generated") as "generated" | "meta" | "both";
const GENERATED_RUN = arg("--generated-run");
// Include each generated deck's PARENT as a subject too. Without this a
// parent-vs-child delta is not computable: the parents are corpus VARIANTS
// ("dragapult-ex#v9"), not the 30 canonical archetype lists, so they never
// appear in the panel and never get a row of their own. The paired estimator
// — the one W5 found survives — needs both arms in the same frame.
const WITH_PARENTS = process.argv.includes("--with-parents");
const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const DRY = process.argv.includes("--dry-run");
// Leave headroom: this machine also runs daily_ops and the weekly ML loop.
const SHARDS = numOrNull(arg("--shards")) ?? Math.max(1, Math.min(8, os.cpus().length - 2));
const SHARD_INDEX = numOrNull(arg("--shard-index"));

/* ─── Deck pools ────────────────────────────────────────────────── */

function metaPool(limit: number): StudyDeck[] {
  const raw = metaDecksRaw as (MetaDeckEntry & { variants?: { cards: MetaDeckEntry["cards"] }[] })[];
  return raw
    .slice(0, limit)
    .map((d) => ({
      id: d.id,
      list: metaDeckToList({
        ...d,
        cards: d.cards?.length ? d.cards : d.variants?.[0]?.cards ?? [],
      } as MetaDeckEntry),
      source: "meta" as const,
    }))
    .filter((d) => d.list.length > 0);
}

function generatedPool(limit: number): StudyDeck[] {
  return loadGeneratedDecks(DB, {
    limit,
    ...(GENERATED_RUN ? { runHash: GENERATED_RUN } : {}),
  }).map((d) => ({ id: d.id, list: d.list, source: "generated" as const }));
}

/** The corpus variants that `decks` were mutated from, as study subjects. */
function parentPool(decks: StudyDeck[]): StudyDeck[] {
  const wanted = new Set(
    loadGeneratedDecks(DB, { ...(GENERATED_RUN ? { runHash: GENERATED_RUN } : {}) })
      .filter((d) => decks.some((x) => x.id === d.id))
      .map((d) => d.parentId)
      .filter((id): id is string => id != null),
  );
  if (wanted.size === 0) return [];
  const corpus = buildCorpus(loadMetaCorpus());
  return corpus.decks
    .filter((d) => wanted.has(d.id))
    .map((d) => ({ id: d.id, list: renderDeck(d.entries), source: "meta" as const }));
}

function buildPairs(): { pairs: StudyPair[]; subjects: number; panel: number } {
  if (MODE === "panel") {
    const panel = metaPool(PANEL);
    const base =
      POOL === "meta"
        ? metaPool(SUBJECTS)
        : POOL === "both"
          ? [...generatedPool(SUBJECTS), ...metaPool(SUBJECTS)]
          : generatedPool(SUBJECTS);
    // Parents go in FIRST so pair indices (and therefore seeds) do not shift
    // when the subject count changes — a study is reproducible by its seed,
    // and an unstable index would quietly break that.
    const subjects = WITH_PARENTS ? dedupeById([...parentPool(base), ...base]) : base;
    if (subjects.length === 0) {
      throw new Error(
        `[matchups] no subject decks. Generate some first:\n` +
          `  npm run ml:gen-decks -- --count 2000 --edits-min 1 --edits-max 8`,
      );
    }
    return { pairs: panelPairs(subjects, panel, SEED), subjects: subjects.length, panel: panel.length };
  }
  const decks =
    POOL === "meta"
      ? metaPool(DECKS)
      : POOL === "both"
        ? [...generatedPool(Math.ceil(DECKS / 2)), ...metaPool(Math.floor(DECKS / 2))]
        : generatedPool(DECKS);
  return { pairs: allPairs(decks, SEED), subjects: decks.length, panel: 0 };
}

function dedupeById(decks: StudyDeck[]): StudyDeck[] {
  const seen = new Set<string>();
  return decks.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

/* ─── One shard's work ──────────────────────────────────────────── */

interface ResultRow {
  pair_index: number;
  deck_a: string;
  deck_b: string;
  deck_a_source: string;
  deck_b_source: string;
  n: number;
  wins_a: number;
  wins_b: number;
  draws: number;
  avg_prize_diff_a: number;
  avg_turns: number;
  end_reasons_json: string;
  seed: number;
}

function runShard(pairs: StudyPair[]): void {
  // createBotEvaluator returns null when no value artifact is promoted; the
  // planner falls back to its heuristic evaluator, which is exactly the
  // behaviour every other harness has.
  const evaluator = createBotEvaluator() ?? undefined;
  const params = plannerParamsForSkill(SKILL);
  for (const pair of pairs) {
    const r = simulateMatchup(pair.a.list, pair.b.list, {
      n: GAMES,
      seed: pair.seed,
      policies: (gameSeed: number) => ({
        player: new PlannerPolicy({ params, evaluate: evaluator, seed: gameSeed }),
        opponent: new PlannerPolicy({ params, evaluate: evaluator, seed: gameSeed + 1 }),
      }),
    });
    const row: ResultRow = {
      pair_index: pair.pairIndex,
      deck_a: pair.a.id,
      deck_b: pair.b.id,
      deck_a_source: pair.a.source,
      deck_b_source: pair.b.source,
      n: r.n,
      wins_a: r.wins_a,
      wins_b: r.wins_b,
      draws: r.draws,
      avg_prize_diff_a: r.avg_prize_diff_a,
      avg_turns: r.avg_turns,
      end_reasons_json: JSON.stringify(r.end_reasons),
      seed: r.seed,
    };
    process.stdout.write(JSON.stringify(row) + "\n");
  }
}

/* ─── Coordinator ───────────────────────────────────────────────── */

async function main(): Promise<void> {
  const { pairs, subjects, panel } = buildPairs();

  // A worker: run my shard, stream rows to the parent, say nothing else.
  if (SHARD_INDEX != null) {
    const skip = new Set(
      (arg("--skip-pairs") ?? "").split(",").filter(Boolean).map(Number),
    );
    runShard(shardOf(pairs, SHARD_INDEX, SHARDS).filter((p) => !skip.has(p.pairIndex)));
    return;
  }

  const totalGames = pairs.length * GAMES;
  const studyId = createHash("sha256")
    .update(
      JSON.stringify({
        mode: MODE, seed: SEED, games: GAMES, skill: SKILL, pool: POOL,
        sim_version: SIM_VERSION, engine_version: ENGINE_VERSION,
        deck_ids: pairs.length > 0 ? [pairs[0].a.id, pairs[pairs.length - 1].b.id] : [],
        pairs: pairs.length,
      }),
    )
    .digest("hex")
    .slice(0, 16);

  // An unpinned generated pool is a moving target: loadGeneratedDecks returns
  // NEWEST first, so generating more decks silently changes which ones a
  // rerun picks — a different subject set, a different study_id, and the
  // banked pairs of an interrupted run abandoned rather than resumed.
  // Measured the hard way: 332 subjects unpinned vs the original 328.
  if (POOL !== "meta" && !GENERATED_RUN) {
    console.warn(
      `[matchups] WARNING: no --generated-run. The generated pool is ordered
` +
        `  newest-first, so this study is not reproducible once more decks are
` +
        `  generated, and an interrupted run will not resume into it. Pin it:
` +
        `    --generated-run <hash from gen_decks>`,
    );
  }
  console.log(
    `[matchups] ${MODE} sim v${SIM_VERSION} — ${subjects} subjects` +
      (panel ? ` x ${panel} panel` : "") +
      ` = ${pairs.length.toLocaleString()} pairs x ${GAMES} games ` +
      `= ${totalGames.toLocaleString()} games across ${SHARDS} shards`,
  );
  // Per-worker throughput under load, NOT the single-core figure.
  //
  // One core alone does ~26 games/s, but parallel scaling is poor: 4 workers
  // measured 50 games/s (2.2x, not 4x) and 8 workers ~62 games/s. Each worker
  // holds its own card catalog and 267-tree value model, so the machine is
  // memory-bandwidth bound long before it is core bound. Estimating from the
  // single-core number overstated a real run by 3x, which is exactly the kind
  // of number you only find out is wrong after committing to it.
  const PER_WORKER_GAMES_PER_S = 7.8;
  const estMin = totalGames / (PER_WORKER_GAMES_PER_S * SHARDS) / 60;
  console.log(
    `[matchups] estimate ~${estMin.toFixed(1)} min, ~${((pairs.length * 200) / 1e6).toFixed(1)} MB of results`,
  );
  if (DRY) {
    console.log("[matchups] --dry-run: nothing simulated, store untouched");
    return;
  }

  const db = openCorpus(DB);
  const done = db
    .prepare("SELECT pairs, completed_at FROM matchup_studies WHERE study_id = ?")
    .get(studyId) as { pairs: number; completed_at: string | null } | undefined;
  if (done?.completed_at) {
    console.log(`[matchups] study ${studyId} already complete (${done.pairs} pairs) — nothing to do`);
    db.close();
    return;
  }

  // Resume. A study of this size runs for hours, and hours is long enough for
  // a machine to sleep, a power cut, or an impatient ^C. Results are keyed by
  // (study_id, pair_index) and each pair's seed depends only on its index, so
  // a pair already in the table is a pair that never needs simulating again —
  // the restart is exact, not approximate.
  const already = new Set(
    (
      db
        .prepare("SELECT pair_index FROM matchup_results WHERE study_id = ?")
        .all(studyId) as { pair_index: number }[]
    ).map((r) => r.pair_index),
  );
  if (already.size > 0) {
    console.log(
      `[matchups] resuming: ${already.size.toLocaleString()} pairs already stored, ` +
        `${(pairs.length - already.size).toLocaleString()} to go`,
    );
  }

  // Claim the study up front so its rows are never orphans. An interrupted
  // run leaves completed_at NULL, which is exactly the signal to resume.
  if (!done) {
    db.prepare(
      `INSERT INTO matchup_studies
         (study_id, created_at, completed_at, mode, sim_version, engine_version, seed,
          games_per_pair, pairs, games, skill, shards, elapsed_ms, params_json)
       VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, ?, 0, ?)`,
    ).run(
      studyId, new Date().toISOString(), MODE, SIM_VERSION, ENGINE_VERSION, SEED, GAMES,
      SKILL, SHARDS,
      JSON.stringify({ pool: POOL, subjects, panel, generated_run: GENERATED_RUN, with_parents: WITH_PARENTS }),
    );
  }

  const started = Date.now();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO matchup_results
       (study_id, pair_index, deck_a, deck_b, deck_a_source, deck_b_source,
        n, wins_a, wins_b, draws, avg_prize_diff_a, avg_turns, end_reasons_json, seed)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let received = already.size;
  let pending: ResultRow[] = [];
  const flush = () => {
    if (pending.length === 0) return;
    db.exec("BEGIN");
    try {
      for (const r of pending) {
        insert.run(
          studyId, r.pair_index, r.deck_a, r.deck_b, r.deck_a_source, r.deck_b_source,
          r.n, r.wins_a, r.wins_b, r.draws, r.avg_prize_diff_a, r.avg_turns,
          r.end_reasons_json, r.seed,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    pending = [];
  };

  await Promise.all(
    Array.from({ length: SHARDS }, (_, k) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            ...process.execArgv,
            __filename,
            ...process.argv.slice(2).filter((a) => a !== "--dry-run"),
            "--shard-index", String(k),
            "--shards", String(SHARDS),
            // Only this shard's completed indices — the full list would blow
            // the argv limit on a big resume.
            ...(already.size > 0
              ? [
                  "--skip-pairs",
                  Array.from(already)
                    .filter((i) => i % SHARDS === k)
                    .join(","),
                ]
              : []),
          ],
          { stdio: ["ignore", "pipe", "inherit"] },
        );
        let buf = "";
        child.stdout.on("data", (chunk: Buffer) => {
          buf += chunk.toString();
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            pending.push(JSON.parse(line) as ResultRow);
            received += 1;
            if (pending.length >= 500) flush();
            if (received % 1000 === 0) {
              const pct = ((received / pairs.length) * 100).toFixed(0);
              const rate = received / ((Date.now() - started) / 1000);
              console.log(
                `[matchups] ${received.toLocaleString()}/${pairs.length.toLocaleString()} pairs (${pct}%) ` +
                  `— ${(rate * GAMES).toFixed(0)} games/s`,
              );
            }
          }
        });
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve() : reject(new Error(`shard ${k} exited ${code}`)),
        );
      }),
    ),
  );
  flush();

  const elapsed = Date.now() - started;
  db.prepare(
    `UPDATE matchup_studies
        SET completed_at = ?, pairs = ?, games = ?, elapsed_ms = ?
      WHERE study_id = ?`,
  ).run(new Date().toISOString(), received, received * GAMES, elapsed, studyId);
  db.close();
  console.log(
    `[matchups] study ${studyId}: ${received.toLocaleString()} pairs, ` +
      `${(received * GAMES).toLocaleString()} games in ${(elapsed / 1000 / 60).toFixed(1)} min ` +
      `(${((received * GAMES) / (elapsed / 1000)).toFixed(0)} games/s) → ${DB}`,
  );
}

void main();
