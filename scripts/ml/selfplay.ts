// Self-play policy dataset CLI.
//
// Runs N seeded planner-vs-planner games across meta-deck pairs and skill
// levels, recording every decision point of both players — encoded state,
// every legal candidate's action features, the chosen action, and the game
// outcome from the actor's perspective — into feature_store.sqlite
// (policy_runs / policy_games / policy_decisions / policy_candidates).
//
// Idempotent: a run is keyed by the hash of everything that determines its
// output (schema/engine/sim versions, seed, games, decks, skills, turn cap,
// value-artifact identity). Re-running the same command is a no-op; the
// same tuple can never produce duplicate rows.
//
// Feature vectors are stored SPARSE: a JSON object of {index: value} for
// nonzero entries. Dense order + names live on the run row
// (state_feature_names / action_feature_names), so trainers reconstruct
// exactly and the mapping can never drift from the code that wrote it.
//
// Usage:
//   npm run ml:selfplay -- [--games N] [--seed S] [--decks M]
//                          [--skills 0.35,0.65,1] [--max-turns T]
//                          [--store PATH]
//                          [--matchup meta|meta-vs-community|community
//                                    |meta-vs-generated|generated]
//                          [--community-decks N] [--decks-file PATH]
//                          [--generated-decks N] [--generated-run HASH]
//                          [--record candidates|decisions]
//                          [--shards N --shard-index K]
//
// --decks-file swaps the live meta-archetype slice for a frozen benchmark
// fixture (data/ml/benchmark-decks.json) so training decks match the duel
// gauntlet exactly — no daily-meta drift between train and eval.
//
// --matchup controls which deck pools play each other (default meta, i.e.
// today's meta-archetype-only behavior, unchanged run_hash for old
// invocations). meta-vs-community and community draw from the PUBLIC,
// legal, deduplicated community deck pool (see lib/ml/communityDecks.ts) —
// user-saved decks, not the curated meta list. Community decks are content-
// addressed (id = community:<hash>); no user_id/name ever reaches this
// script's params/logs/store.
//
// meta-vs-generated and generated draw on SYNTHESIZED decks (scripts/ml/
// gen_decks.ts), also content-addressed (id = gen:<hash>). Their provenance
// — parent deck, generator, the exact edits — lives in generated_decks, so
// a policy_games row can be joined back to what the deck actually IS. That
// join is the whole point: a corpus of outcomes with no record of what was
// changed teaches nothing.

import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import metaDecksRaw from "@/data/meta-decks.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { ENGINE_VERSION } from "@/lib/engine/types";
import { SIM_VERSION } from "@/lib/engine/sim";
import {
  POLICY_SCHEMA_VERSION,
  STATE_FEATURE_NAMES,
  ACTION_FEATURE_NAMES,
} from "@/lib/ml/features";
import { DEFAULT_SKILLS, generateSelfPlayGames, type SelfPlayGameRecord } from "@/lib/ml/selfplay";
import { loadCommunityDecks } from "@/lib/ml/communityDecks";
import { loadGeneratedDecks } from "@/lib/ml/generatedDecks";
import { defaultCorpusPath, openCorpus } from "@/lib/ml/corpusStore";
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import { readWinProbArtifact } from "@/lib/ml/winprob";
import { readValueArtifact } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";

/* ─── CLI args ──────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
// Self-play data is generated data — it lives in the corpus store, not in
// the Supabase snapshot ml_export.py rewrites weekly. --store still points
// wherever you like; the default just stopped being the wrong file.
const DEFAULT_STORE = defaultCorpusPath(REPO_ROOT);

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 && idx + 1 < process.argv.length ? process.argv[idx + 1] : null;
}

const storePath = argValue("--store") ?? DEFAULT_STORE;
const games = numOrNull(argValue("--games")) ?? 50;
const seed = numOrNull(argValue("--seed")) ?? 1;
const deckCount = numOrNull(argValue("--decks")) ?? 8;
const maxTurns = numOrNull(argValue("--max-turns")) ?? undefined;
const skillsArg = argValue("--skills");
const skills = skillsArg
  ? skillsArg
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s !== "")
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 1)
  : [];

type Matchup =
  | "meta"
  | "meta-vs-community"
  | "community"
  | "meta-vs-generated"
  | "generated"
  | "mixed";
const MATCHUPS: Matchup[] = [
  "meta",
  "meta-vs-community",
  "community",
  "meta-vs-generated",
  "generated",
  "mixed",
];
const matchupArg = argValue("--matchup") ?? "meta";
if (!MATCHUPS.includes(matchupArg as Matchup)) {
  throw new Error(`--matchup must be one of ${MATCHUPS.join("/")}, got "${matchupArg}"`);
}
const matchup = matchupArg as Matchup;
const communityDeckCount = numOrNull(argValue("--community-decks")) ?? 30;
const generatedDeckCount = numOrNull(argValue("--generated-decks")) ?? 30;
// Pin a specific generation run, so a training corpus stays reproducible
// even after gen_decks.ts has added newer decks to the store.
const generatedRun = argValue("--generated-run");
const decksFile = argValue("--decks-file");
// Candidate rows are 853 a game against 99 decisions (~131 KB vs ~38 KB) and
// cost CPU to encode. Only the policy RANKER reads them; the value model
// does not. Default stays "candidates" so existing run hashes reproduce.
const record = (argValue("--record") ?? "candidates") as "candidates" | "decisions";
if (record !== "candidates" && record !== "decisions") {
  throw new Error(`--record must be candidates|decisions, got "${record}"`);
}
const shards = numOrNull(argValue("--shards")) ?? 1;
const shardIndex = numOrNull(argValue("--shard-index"));

/* ─── Sparse encoding ───────────────────────────────────────────── */

function sparse(values: number[]): string {
  const out: Record<number, number> = {};
  for (let i = 0; i < values.length; i++) if (values[i] !== 0) out[i] = values[i];
  return JSON.stringify(out);
}

/* ─── Schema ────────────────────────────────────────────────────── */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS policy_runs (
  run_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  policy_schema_version INTEGER NOT NULL,
  engine_version INTEGER NOT NULL,
  sim_version INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  games INTEGER NOT NULL,
  params_json TEXT NOT NULL,
  state_feature_names TEXT NOT NULL,
  action_feature_names TEXT NOT NULL,
  decisions INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS policy_games (
  run_hash TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  deck_a TEXT NOT NULL,
  deck_b TEXT NOT NULL,
  deck_a_source TEXT,
  deck_b_source TEXT,
  skill_a REAL NOT NULL,
  skill_b REAL NOT NULL,
  winner TEXT,
  end_reason TEXT NOT NULL,
  turns INTEGER NOT NULL,
  decisions INTEGER NOT NULL,
  PRIMARY KEY (run_hash, game_index)
);
CREATE TABLE IF NOT EXISTS policy_decisions (
  run_hash TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  decision_index INTEGER NOT NULL,
  actor TEXT NOT NULL,
  turn_number INTEGER NOT NULL,
  player_turn_number INTEGER NOT NULL,
  skill REAL NOT NULL,
  chosen_index INTEGER NOT NULL,
  chosen_kind TEXT NOT NULL,
  n_candidates INTEGER NOT NULL,
  value_estimate REAL,
  outcome REAL NOT NULL,
  state_sparse TEXT NOT NULL,
  PRIMARY KEY (run_hash, game_index, decision_index)
);
CREATE TABLE IF NOT EXISTS policy_candidates (
  run_hash TEXT NOT NULL,
  game_index INTEGER NOT NULL,
  decision_index INTEGER NOT NULL,
  candidate_index INTEGER NOT NULL,
  kind TEXT NOT NULL,
  features_sparse TEXT NOT NULL,
  PRIMARY KEY (run_hash, game_index, decision_index, candidate_index)
);
`;

/* ─── Main ──────────────────────────────────────────────────────── */

/** Spawn one worker per shard, handing each streamed game record to `sink`.
 *
 *  Streamed, not collected: 20,000 games of decision records is ~760 MB on
 *  disk and several GB as live JS objects, which a 16 GB machine does not
 *  have to spare next to eight simulator processes. The sink writes each game
 *  as it lands, so peak memory is one game.
 *
 *  Games therefore arrive in worker-completion order rather than index order.
 *  That is fine — every row carries its game_index, and nothing downstream
 *  reads insertion order — but it is why the caller must not assume it. */
async function fanOut(sink: (g: SelfPlayGameRecord) => void): Promise<void> {
  await Promise.all(
    Array.from({ length: shards }, (_, k) =>
      new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            ...process.execArgv,
            __filename,
            ...process.argv.slice(2).filter((a) => a !== "--shard-index"),
            "--shard-index", String(k),
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
            if (line) sink(JSON.parse(line) as SelfPlayGameRecord);
          }
        });
        child.on("error", reject);
        child.on("exit", (c) => (c === 0 ? resolve() : reject(new Error(`shard ${k} exited ${c}`))));
      }),
    ),
  );
}

async function main(): Promise<void> {
  // The "meta" pool: a frozen benchmark fixture when --decks-file is given
  // (drift-free, matches the duel gauntlet), else the top --decks live meta
  // archetypes (which the daily refresh reorders).
  const metaDecks = decksFile
    ? loadBenchmarkDecks(path.resolve(REPO_ROOT, decksFile))
    : (metaDecksRaw as unknown as (MetaDeckEntry & {
        variants?: { cards: MetaDeckEntry["cards"] }[];
      })[])
        .slice(0, deckCount)
        .map((d) => ({
          id: d.id,
          list: metaDeckToList({ ...d, cards: d.cards?.length ? d.cards : d.variants?.[0]?.cards ?? [] }),
        }))
        .filter((d) => d.list.length > 0);

  const needsCommunity = matchup === "meta-vs-community" || matchup === "community";
  const needsGenerated =
    matchup === "meta-vs-generated" || matchup === "generated" || matchup === "mixed";
  const communityDecks = needsCommunity
    ? loadCommunityDecks(storePath).slice(0, communityDeckCount)
    : [];
  if (needsCommunity && communityDecks.length === 0) {
    throw new Error(
      `[selfplay] --matchup ${matchup} needs at least one public, legal community deck, but ` +
        `none are available in ${storePath} (today's pool is small — check saved_decks.is_public ` +
        `rows and re-run dexter-ml's ml_export.py if the store is stale)`,
    );
  }

  // Generated decks: synthesized from the real corpus with full provenance
  // in the store (scripts/ml/gen_decks.ts). The pilot only ever meeting 30
  // deck shapes is the distribution problem W5 left open; this is the pool
  // that widens it.
  const generatedDecks = needsGenerated
    ? loadGeneratedDecks(storePath, {
        limit: generatedDeckCount,
        ...(generatedRun ? { runHash: generatedRun } : {}),
      }).map((d) => ({ id: d.id, list: d.list }))
    : [];
  if (needsGenerated && generatedDecks.length === 0) {
    throw new Error(
      `[selfplay] --matchup ${matchup} needs generated decks, but none are in ${storePath}. ` +
        `Run: npx tsx scripts/ml/gen_decks.ts --count 200 --seed 1`,
    );
  }

  // poolA/poolB: which deck pool plays which side, per matchup mode. "meta",
  // "community" and "generated" use the SAME pool both sides (so schedule()'s
  // built-in anti-mirror trick applies); the "-vs-" modes use two distinct
  // pools, with the META side as pool A so a generated deck is always
  // measured against a real one.
  // "mixed" is the ablation arm: meta UNION generated on BOTH sides. It is
  // deliberately not "meta-vs-generated" — that changes the matchup
  // STRUCTURE as well as the deck pool, so a difference in the trained model
  // could not be attributed to diversity. Here the only thing that changes
  // between arms is which decks are in the hat.
  const mixedPool = matchup === "mixed" ? [...metaDecks, ...generatedDecks] : [];
  const poolA =
    matchup === "community"
      ? communityDecks
      : matchup === "generated"
        ? generatedDecks
        : matchup === "mixed"
          ? mixedPool
          : metaDecks;
  const poolB =
    matchup === "meta-vs-community"
      ? communityDecks
      : matchup === "meta-vs-generated"
        ? generatedDecks
        : poolA;
  const sourceOf = (id: string): "meta" | "community" | "generated" =>
    id.startsWith("community:") ? "community" : id.startsWith("gen:") ? "generated" : "meta";

  const effectiveSkills = skills.length ? skills : DEFAULT_SKILLS;
  const artifact = readWinProbArtifact();
  // The evaluator that actually drives the planner during these games (see
  // createBotEvaluator: board-aware value model when promoted, else winprob).
  // It MUST be part of the run identity — otherwise regenerating after
  // promoting a new value model collides with the old run_hash and the
  // idempotency check silently returns stale data from a weaker planner.
  // Omitted when absent so pre-value-model run hashes stay reproducible.
  const valueArtifact = readValueArtifact();
  const listHash = (list: string) => createHash("sha256").update(list).digest("hex").slice(0, 16);
  const params = {
    seed,
    games,
    skills: effectiveSkills,
    max_turns: maxTurns ?? null,
    // Part of the run identity: a decisions-only corpus is not the same
    // dataset as a full one, and reusing the hash would hand a policy
    // trainer a corpus with no candidates in it.
    ...(record !== "candidates" ? { record } : {}),
    decks: metaDecks.map((d) => ({ id: d.id, list_hash: listHash(d.list) })),
    // Only present for non-default matchups — keeps run_hash byte-identical
    // to before this flag existed for the default `meta` mode, so old
    // invocations stay idempotent against already-generated runs.
    ...(matchup !== "meta"
      ? {
          matchup,
          ...(needsCommunity
            ? { community_decks: communityDecks.map((d) => ({ id: d.id, list_hash: listHash(d.list) })) }
            : {}),
          // Generated decks are content-addressed, so their ids ARE their
          // list hashes — but the pairing is recorded the same way so the
          // run identity names exactly which decks played.
          ...(needsGenerated
            ? { generated_decks: generatedDecks.map((d) => ({ id: d.id, list_hash: listHash(d.list) })) }
            : {}),
        }
      : {}),
    value_model: artifact ? artifact.model_version : null,
    ...(valueArtifact ? { evaluator_model: valueArtifact.model_version } : {}),
  };
  const runHash = createHash("sha256")
    .update(
      JSON.stringify({
        policy_schema_version: POLICY_SCHEMA_VERSION,
        engine_version: ENGINE_VERSION,
        sim_version: SIM_VERSION,
        ...params,
      }),
    )
    .digest("hex");

  // Worker: generate this shard's games, stream them to the parent, and open
  // no database at all. One writer keeps sqlite out of lock contention, and
  // keeps the run row a single atomic fact rather than N partial ones.
  if (shardIndex != null) {
    for (const game of generateSelfPlayGames({
      decks: poolA,
      opponentDecks: poolB === poolA ? undefined : poolB,
      games,
      seed,
      skills: effectiveSkills,
      maxTurns,
      recordCandidates: record === "candidates",
      shard: { index: shardIndex, count: shards },
    })) {
      process.stdout.write(JSON.stringify(game) + "\n");
    }
    return;
  }

  const db = openCorpus(storePath);
  db.exec(SCHEMA);
  // policy_games predates deck_a_source/deck_b_source; CREATE TABLE IF NOT
  // EXISTS won't add columns to an already-existing table, so add them here,
  // guarded against re-running on a db that already has them.
  for (const col of ["deck_a_source", "deck_b_source"]) {
    try {
      db.exec(`ALTER TABLE policy_games ADD COLUMN ${col} TEXT`);
    } catch (e) {
      if (!(e instanceof Error) || !/duplicate column/i.test(e.message)) throw e;
    }
  }

  const existing = db
    .prepare("SELECT decisions FROM policy_runs WHERE run_hash = ?")
    .get(runHash) as { decisions: number } | undefined;
  if (existing) {
    console.log(
      `[selfplay] run ${runHash.slice(0, 12)} already in store (${existing.decisions} decisions) — nothing to do`,
    );
    db.close();
    return;
  }

  console.log(
    `[selfplay] schema v${POLICY_SCHEMA_VERSION} engine v${ENGINE_VERSION} sim v${SIM_VERSION} ` +
      `matchup=${matchup} seed=${seed} games=${games} meta_decks=${metaDecks.length} ` +
      `community_decks=${communityDecks.length} generated_decks=${generatedDecks.length} ` +
      `skills=${effectiveSkills.join("/")} ` +
      `evaluator=${valueArtifact ? valueArtifact.model_version : params.value_model ?? "heuristic-only"}`,
  );
  const startedAt = Date.now();
  // Every game's seed is hashSeed("selfplay:<seed>:<gameIndex>") — a pure
  // function of the index — so splitting the index range across processes
  // produces exactly the games one process would have produced. Worker count
  // is a performance knob, never a variable in the data.
  const insertGame = db.prepare(
    `INSERT INTO policy_games (run_hash, game_index, seed, deck_a, deck_b, deck_a_source, deck_b_source, skill_a, skill_b, winner, end_reason, turns, decisions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertDecision = db.prepare(
    `INSERT INTO policy_decisions (run_hash, game_index, decision_index, actor, turn_number, player_turn_number, skill, chosen_index, chosen_kind, n_candidates, value_estimate, outcome, state_sparse)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertCandidate = db.prepare(
    `INSERT INTO policy_candidates (run_hash, game_index, decision_index, candidate_index, kind, features_sparse)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  let decisions = 0;
  let candidates = 0;
  let gameCount = 0;
  const writeGame = (game: SelfPlayGameRecord): void => {
    {
      gameCount += 1;
      insertGame.run(
        runHash,
        game.gameIndex,
        game.seed,
        game.deckAId,
        game.deckBId,
        sourceOf(game.deckAId),
        sourceOf(game.deckBId),
        game.skillA,
        game.skillB,
        game.winner,
        game.endReason,
        game.turns,
        game.decisions.length,
      );
      for (const d of game.decisions) {
        insertDecision.run(
          runHash,
          game.gameIndex,
          d.decisionIndex,
          d.actor,
          d.turnNumber,
          d.playerTurnNumber,
          d.skill,
          d.chosenIndex,
          d.chosenKind,
          d.candidates.length,
          d.valueEstimate,
          d.outcome,
          sparse(d.stateFeatures),
        );
        decisions += 1;
        for (let c = 0; c < d.candidates.length; c++) {
          insertCandidate.run(
            runHash,
            game.gameIndex,
            d.decisionIndex,
            c,
            d.candidates[c].kind,
            sparse(d.candidates[c].features),
          );
          candidates += 1;
        }
      }
    }
  };

  db.exec("BEGIN");
  try {
    if (shards > 1) {
      await fanOut(writeGame);
    } else {
      for (const game of generateSelfPlayGames({
        decks: poolA,
        opponentDecks: poolB === poolA ? undefined : poolB,
        games,
        seed,
        skills: effectiveSkills,
        maxTurns,
        recordCandidates: record === "candidates",
      })) {
        writeGame(game);
      }
    }
    db.prepare(
      `INSERT INTO policy_runs (run_hash, created_at, policy_schema_version, engine_version, sim_version, seed, games, params_json, state_feature_names, action_feature_names, decisions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      runHash,
      new Date().toISOString(),
      POLICY_SCHEMA_VERSION,
      ENGINE_VERSION,
      SIM_VERSION,
      seed,
      games,
      JSON.stringify(params),
      JSON.stringify(STATE_FEATURE_NAMES),
      JSON.stringify(ACTION_FEATURE_NAMES),
      decisions,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.close();

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `[selfplay] run ${runHash.slice(0, 12)}: ${gameCount} games, ${decisions} decisions, ` +
      `${candidates} candidates in ${elapsed}s → ${storePath}`,
  );
}

void main();
