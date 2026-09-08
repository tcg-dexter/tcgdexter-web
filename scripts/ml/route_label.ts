// Route labels: re-label a decision by where the next few turns GO, not by
// how the game eventually ended.
//
// The problem this attacks is measured, not suspected. Every decision in a
// game currently carries the final result, so `effective_label_samples`
// equals the GAME count — ~100 decisions collapse into one unit of
// information, and a turn-3 setup play is labelled identically to a turn-20
// blunder. This session showed that neither more games nor more deck
// diversity moves the trained model. The corpus was never data-poor. It is
// LABEL-poor.
//
// route_horizon.ts measured where the signal lives (1.94M decisions):
//
//     phase          best k    corr(prize delta, win)
//     early t<=4        6-7            0.455
//     mid   5-9          4             0.401
//     late  t>=10      flat            ~0.30 at every k
//
// So k is phase-conditioned, from that table rather than from taste.
//
// THE TIE PROBLEM, which decides the whole design: at k=4 roughly half of
// windows contain no prize movement at all. Dropping them would be the
// obvious thing and would ruin the experiment — flat windows are exactly the
// quiet setup turns, the positions where a pilot most needs to know whether
// to develop or to swing. A model trained only on windows that produced a
// prize swing learns about swings and nothing about earning them.
//
// So a flat window BOOTSTRAPS onto the eventual result instead. That is an
// n-step return with terminal bootstrapping, in binary form: dense where
// short-horizon signal exists, correct where it does not, and no row thrown
// away. The label keeps the same [0,1] meaning the planner already consumes,
// so nothing downstream needs to know this happened.
//
// Usage:
//   npx tsx scripts/ml/route_label.ts --runs HASH [--db PATH] [--dry-run]

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { STATE_FEATURE_NAMES } from "@/lib/ml/features/policy";
import { defaultCorpusPath } from "@/lib/ml/corpusStore";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const RUNS = (arg("--runs") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
const DRY = process.argv.includes("--dry-run");
if (RUNS.length === 0) throw new Error("[route_label] --runs is required");

const IDX = {
  turn: STATE_FEATURE_NAMES.indexOf("player_turn_number"),
  mine: STATE_FEATURE_NAMES.indexOf("my_prizes_taken"),
  theirs: STATE_FEATURE_NAMES.indexOf("opp_prizes_taken"),
};

/** Route length by phase, straight off route_horizon.ts's measurement. */
export function horizonFor(playerTurn: number): number {
  if (playerTurn <= 4) return 6; // early predicts best, and wants the longest window
  return 4; // mid peaks here; late is flat at every k, so 4 costs nothing
}

interface Row {
  runHash: string;
  gameIndex: number;
  decisionIndex: number;
  actor: string;
  outcome: number;
  turn: number;
  prizeDiff: number;
}

function main(): void {
  const db = new DatabaseSync(DB);
  const all = (db.prepare("SELECT run_hash FROM policy_runs").all() as { run_hash: string }[]).map(
    (r) => r.run_hash,
  );
  const hashes = RUNS.map((r) => {
    const hit = all.find((h) => h === r || h.startsWith(r));
    if (!hit) throw new Error(`[route_label] run not found: ${r}`);
    return hit;
  });

  try {
    db.exec("ALTER TABLE policy_decisions ADD COLUMN route_outcome REAL");
    console.log("[route_label] added policy_decisions.route_outcome");
  } catch (e) {
    if (!(e instanceof Error) || !/duplicate column/i.test(e.message)) throw e;
  }

  const raw = db
    .prepare(
      `SELECT run_hash, game_index, decision_index, actor, outcome, state_sparse
         FROM policy_decisions
        WHERE run_hash IN (${hashes.map(() => "?").join(",")})
        ORDER BY run_hash, game_index, actor, decision_index`,
    )
    .all(...hashes) as {
    run_hash: string;
    game_index: number;
    decision_index: number;
    actor: string;
    outcome: number;
    state_sparse: string;
  }[];
  if (raw.length === 0) throw new Error("[route_label] no decisions in those runs");

  const rows: Row[] = raw.map((r) => {
    const s = JSON.parse(r.state_sparse) as Record<string, number>;
    return {
      runHash: r.run_hash,
      gameIndex: r.game_index,
      decisionIndex: r.decision_index,
      actor: r.actor,
      outcome: r.outcome,
      turn: s[IDX.turn] ?? 0,
      prizeDiff: (s[IDX.mine] ?? 0) - (s[IDX.theirs] ?? 0),
    };
  });

  // Group into per-side trajectories. The stored features are from the ACTING
  // player's view, so mixing seats would flip the sign of every differential
  // halfway through a game.
  const traj = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.runHash}:${r.gameIndex}:${r.actor}`;
    traj.set(key, [...(traj.get(key) ?? []), r]);
  }

  const updates: { label: number; runHash: string; gameIndex: number; decisionIndex: number }[] = [];
  let fromWindow = 0;
  let fromBootstrap = 0;
  let dropped = 0;
  const byPhase = { early: [0, 0], mid: [0, 0], late: [0, 0] } as Record<string, [number, number]>;

  for (const steps of Array.from(traj.values())) {
    // End-of-turn prize differential for each turn this side acted on.
    const endOfTurn = new Map<number, number>();
    for (const s of steps) endOfTurn.set(s.turn, s.prizeDiff);
    const turns = Array.from(endOfTurn.keys()).sort((a, b) => a - b);

    for (const s of steps) {
      if (s.outcome === 0.5) {
        dropped += 1; // a drawn game has no direction to bootstrap onto
        continue;
      }
      const k = horizonFor(s.turn);
      const target = turns.find((t) => t >= s.turn + k);
      let label: number;
      if (target != null) {
        const delta = endOfTurn.get(target)! - s.prizeDiff;
        if (delta > 0) {
          label = 1;
          fromWindow += 1;
        } else if (delta < 0) {
          label = 0;
          fromWindow += 1;
        } else {
          // Flat window: no short-horizon signal, so fall back to the truth
          // we do have rather than discarding the position.
          label = s.outcome;
          fromBootstrap += 1;
        }
      } else {
        // The window runs past the end of the game — the result IS the window.
        label = s.outcome;
        fromBootstrap += 1;
      }
      const phase = s.turn <= 4 ? "early" : s.turn <= 9 ? "mid" : "late";
      byPhase[phase][label >= 0.5 ? 0 : 1] += 1;
      updates.push({
        label,
        runHash: s.runHash,
        gameIndex: s.gameIndex,
        decisionIndex: s.decisionIndex,
      });
    }
  }

  const total = fromWindow + fromBootstrap;
  console.log(
    `[route_label] ${rows.length.toLocaleString()} decisions across ` +
      `${traj.size.toLocaleString()} side-trajectories`,
  );
  console.log(
    `  from a k-turn window : ${fromWindow.toLocaleString()} (${((100 * fromWindow) / total).toFixed(1)}%)`,
  );
  console.log(
    `  bootstrapped on result: ${fromBootstrap.toLocaleString()} (${((100 * fromBootstrap) / total).toFixed(1)}%)`,
  );
  console.log(`  dropped (drawn games) : ${dropped.toLocaleString()}`);
  console.log(`  class balance by phase (pos/neg):`);
  for (const [name, [pos, neg]] of Object.entries(byPhase)) {
    const n = pos + neg;
    console.log(
      `    ${name.padEnd(6)} ${String(n).padStart(9)}  ${((100 * pos) / (n || 1)).toFixed(1)}% positive`,
    );
  }
  // A label that is ~100% one class carries no information no matter how many
  // rows it has; worth seeing before spending an hour training on it.
  const overallPos = Object.values(byPhase).reduce((s, [p]) => s + p, 0);
  console.log(`  overall positive rate : ${((100 * overallPos) / total).toFixed(1)}%`);

  if (DRY) {
    console.log("[route_label] --dry-run: nothing written");
    db.close();
    return;
  }

  const stmt = db.prepare(
    `UPDATE policy_decisions SET route_outcome = ?
      WHERE run_hash = ? AND game_index = ? AND decision_index = ?`,
  );
  db.exec("BEGIN");
  try {
    for (const u of updates) stmt.run(u.label, u.runHash, u.gameIndex, u.decisionIndex);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.close();
  console.log(`[route_label] wrote ${updates.length.toLocaleString()} route labels`);
}

main();
