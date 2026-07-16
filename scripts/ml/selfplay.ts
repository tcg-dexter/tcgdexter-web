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

import path from "node:path";
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
import { DEFAULT_SKILLS, generateSelfPlayGames } from "@/lib/ml/selfplay";
import { readWinProbArtifact } from "@/lib/ml/winprob";
import { numOrNull } from "@/lib/ml/features";

/* ─── CLI args ──────────────────────────────────────────────────── */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_STORE = path.resolve(REPO_ROOT, "..", "dexter-ml", "feature_store.sqlite");

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

function main(): void {
  const metaDecks = (metaDecksRaw as unknown as (MetaDeckEntry & {
    variants?: { cards: MetaDeckEntry["cards"] }[];
  })[])
    .slice(0, deckCount)
    .map((d) => ({
      id: d.id,
      list: metaDeckToList({ ...d, cards: d.cards?.length ? d.cards : d.variants?.[0]?.cards ?? [] }),
    }))
    .filter((d) => d.list.length > 0);

  const effectiveSkills = skills.length ? skills : DEFAULT_SKILLS;
  const artifact = readWinProbArtifact();
  const params = {
    seed,
    games,
    skills: effectiveSkills,
    max_turns: maxTurns ?? null,
    decks: metaDecks.map((d) => ({
      id: d.id,
      list_hash: createHash("sha256").update(d.list).digest("hex").slice(0, 16),
    })),
    value_model: artifact ? artifact.model_version : null,
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

  const db = new DatabaseSync(storePath);
  db.exec(SCHEMA);

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
      `seed=${seed} games=${games} decks=${metaDecks.length} skills=${effectiveSkills.join("/")} ` +
      `value_model=${params.value_model ?? "heuristic-only"}`,
  );
  const startedAt = Date.now();
  const records = generateSelfPlayGames({
    decks: metaDecks,
    games,
    seed,
    skills: effectiveSkills,
    maxTurns,
  });

  const insertGame = db.prepare(
    `INSERT INTO policy_games (run_hash, game_index, seed, deck_a, deck_b, skill_a, skill_b, winner, end_reason, turns, decisions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
  db.exec("BEGIN");
  try {
    for (const game of records) {
      insertGame.run(
        runHash,
        game.gameIndex,
        game.seed,
        game.deckAId,
        game.deckBId,
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
    `[selfplay] run ${runHash.slice(0, 12)}: ${records.length} games, ${decisions} decisions, ` +
      `${candidates} candidates in ${elapsed}s → ${storePath}`,
  );
}

main();
