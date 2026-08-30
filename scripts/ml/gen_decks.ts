// Deck generation CLI — the training funnel's supply side.
//
// Synthesizes legal, playable deck lists from the real corpus (30 meta
// archetypes, 336 recorded variants) and stores them with FULL PROVENANCE in
// feature_store.sqlite, so self-play can draw on them and the meta study can
// afterwards ask which composition choices actually won games.
//
// Why this exists: W5 measured that seven rounds of piloting work moved deck
// calibration not at all, and named per-archetype planning competence as the
// one open path. A pilot that has only ever seen 30 deck shapes has no reason
// to generalize to the 31st. This widens the distribution it trains against.
//
// Idempotent, like the self-play CLI: a run is keyed by the hash of
// everything determining its output (gen/sim/engine versions, seed, count,
// mix, corpus identity). Re-running the same command is a no-op.
//
// Usage:
//   npx tsx scripts/ml/gen_decks.ts [--count N] [--seed S]
//                                   [--skeleton-share 0.25] [--edits 3]
//                                   [--store PATH] [--dry-run] [--out FILE]
//
// --dry-run prints the yield report and writes nothing, which is the right
// way to tune the mix before spending storage or simulation time.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import { ENGINE_VERSION } from "@/lib/engine/types";
import { SIM_VERSION } from "@/lib/engine/sim";
import { buildCorpus, loadMetaCorpus } from "@/lib/ml/deckGen/corpus";
import { DECK_GEN_VERSION, generateDecks } from "@/lib/ml/deckGen/generate";
import { GENERATED_DECKS_SCHEMA } from "@/lib/ml/generatedDecks";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_STORE = path.resolve(REPO_ROOT, "..", "dexter-ml", "feature_store.sqlite");

function argValue(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const storePath = argValue("--store") ?? DEFAULT_STORE;
const count = numOrNull(argValue("--count")) ?? 200;
const seed = numOrNull(argValue("--seed")) ?? 1;
const skeletonShare = numOrNull(argValue("--skeleton-share")) ?? 0.25;
const edits = numOrNull(argValue("--edits")) ?? 3;
const dryRun = process.argv.includes("--dry-run");
const outFile = argValue("--out");

function main(): void {
  const corpus = buildCorpus(loadMetaCorpus());
  if (corpus.decks.length === 0) throw new Error("[gen_decks] empty corpus");

  // The corpus is part of the run identity: the same seed against a refreshed
  // meta list is a DIFFERENT set of decks, and reusing the hash would hand
  // training a stale pool while claiming it was current.
  const corpusHash = createHash("sha256")
    .update(JSON.stringify(corpus.decks.map((d) => [d.id, d.entries])))
    .digest("hex")
    .slice(0, 16);

  const params = {
    seed,
    count,
    skeleton_share: skeletonShare,
    edits,
    corpus_hash: corpusHash,
    corpus_decks: corpus.decks.length,
  };
  const runHash = createHash("sha256")
    .update(
      JSON.stringify({
        gen_version: DECK_GEN_VERSION,
        sim_version: SIM_VERSION,
        engine_version: ENGINE_VERSION,
        ...params,
      }),
    )
    .digest("hex");

  console.log(
    `[gen_decks] gen v${DECK_GEN_VERSION} sim v${SIM_VERSION} engine v${ENGINE_VERSION} ` +
      `corpus=${corpus.decks.length} variants/${corpus.variantsOf.size} archetypes ` +
      `seed=${seed} count=${count} skeleton_share=${skeletonShare} edits=${edits}`,
  );

  const started = Date.now();
  const result = generateDecks({ corpus, count, seed, skeletonShare, edits });
  const byGen: Record<string, number> = {};
  const byArchetype: Record<string, number> = {};
  for (const d of result.decks) {
    byGen[d.generator] = (byGen[d.generator] ?? 0) + 1;
    if (d.archetype) byArchetype[d.archetype] = (byArchetype[d.archetype] ?? 0) + 1;
  }
  console.log(
    `[gen_decks] produced ${result.decks.length}/${count} in ${result.attempts} attempts ` +
      `(${((Date.now() - started) / 1000).toFixed(1)}s) — ${JSON.stringify(byGen)}`,
  );
  // The yield report is a diagnostic, not noise: a generator whose rejects
  // cluster on one gate is describing its own bias.
  const rejects = Object.entries(result.rejected).sort((a, b) => b[1] - a[1]);
  if (rejects.length > 0) {
    console.log("[gen_decks] rejected:");
    for (const [reason, n] of rejects) console.log(`  ${String(n).padStart(5)}  ${reason}`);
  }
  console.log(`[gen_decks] archetypes covered: ${Object.keys(byArchetype).length}`);

  if (outFile) {
    fs.writeFileSync(path.resolve(outFile), JSON.stringify(result.decks, null, 2) + "\n");
    console.log(`[gen_decks] wrote ${outFile}`);
  }
  if (dryRun) {
    console.log("[gen_decks] --dry-run: store untouched");
    return;
  }

  const db = new DatabaseSync(storePath);
  db.exec(GENERATED_DECKS_SCHEMA);
  const existing = db
    .prepare("SELECT produced FROM generated_deck_runs WHERE run_hash = ?")
    .get(runHash) as { produced: number } | undefined;
  if (existing) {
    console.log(
      `[gen_decks] run ${runHash.slice(0, 12)} already in store (${existing.produced} decks) — nothing to do`,
    );
    db.close();
    return;
  }

  const now = new Date().toISOString();
  const insertDeck = db.prepare(
    `INSERT OR IGNORE INTO generated_decks
       (id, run_hash, created_at, generator, parent_id, archetype, seed, list, ops_json, stats_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db.exec("BEGIN");
  try {
    for (const d of result.decks) {
      // INSERT OR IGNORE: ids are content-addressed, so two runs that land on
      // the same list keep the first one's provenance rather than fighting
      // over it. The deck is identical either way.
      insertDeck.run(
        d.id, runHash, now, d.generator, d.parentId, d.archetype, d.seed,
        d.list, JSON.stringify(d.ops), JSON.stringify(d.stats),
      );
    }
    db.prepare(
      `INSERT INTO generated_deck_runs
         (run_hash, created_at, gen_version, sim_version, engine_version, seed,
          requested, produced, attempts, params_json, rejected_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runHash, now, DECK_GEN_VERSION, SIM_VERSION, ENGINE_VERSION, seed,
      count, result.decks.length, result.attempts,
      JSON.stringify(params), JSON.stringify(result.rejected),
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const total = db.prepare("SELECT COUNT(*) AS n FROM generated_decks").get() as { n: number };
  db.close();
  console.log(
    `[gen_decks] stored run ${runHash.slice(0, 12)} → ${storePath} (${total.n} generated decks total)`,
  );
}

main();
