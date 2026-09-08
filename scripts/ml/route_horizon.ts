// How far ahead is a ROUTE worth planning?
//
// Everything the pilot learns today is labelled with the game's final result.
// That is why `effective_label_samples` equals the number of GAMES: a setup
// move on turn 3 and a blunder on turn 20 carry the same label, so ~100
// decisions collapse into one unit of information. We proved this session
// that adding games does not help and adding deck diversity does not help.
// The corpus is data-rich and LABEL-poor.
//
// A route reframes the label. Instead of "did this game end in a win", ask
// "did the next k turns take prizes". Each game then contributes ~10
// quasi-independent labels instead of 1 — a bigger change to effective
// sample size than any amount of extra simulation could buy.
//
// But k has to come from the data, not from taste. Two forces pull against
// each other:
//
//   too short  the answer is almost always "no prizes yet". No variance,
//              nothing to learn, and setup plays look identical to bad ones.
//   too long   the window swallows the opponent's turns and our own later
//              decisions, so the credit no longer belongs to the state we
//              are scoring. That is just the game outcome again, relabelled.
//
// So this measures, for k = 1..K player-turns and split by game phase:
//   * how much prize movement a k-turn window actually contains, and
//   * how strongly that movement predicts winning — i.e. whether short-horizon
//     prize progress is a valid SURROGATE for the outcome at all.
//
// If a short window both moves and predicts, routes are learnable at that
// length and the label problem has a fix. If prize movement only predicts
// the result at k large enough to be the whole game, then routes buy nothing
// over what we already do, and this direction should be abandoned early and
// cheaply — which is the other reason to measure before building.
//
// Usage:
//   npx tsx scripts/ml/route_horizon.ts --runs HASH[,HASH] [--db PATH]
//     [--max-k 10] [--json out.json]

import path from "node:path";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

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
const MAX_K = numOrNull(arg("--max-k")) ?? 10;
const JSON_OUT = arg("--json");
if (RUNS.length === 0) throw new Error("[route_horizon] --runs is required");

const IDX = {
  turn: STATE_FEATURE_NAMES.indexOf("player_turn_number"),
  mine: STATE_FEATURE_NAMES.indexOf("my_prizes_taken"),
  theirs: STATE_FEATURE_NAMES.indexOf("opp_prizes_taken"),
};
for (const [k, v] of Object.entries(IDX)) {
  if (v < 0) throw new Error(`[route_horizon] feature "${k}" not in STATE_FEATURE_NAMES`);
}

/** One acting side's view of one game, in turn order. */
interface Step {
  turn: number;
  prizeDiff: number;
}
interface Trajectory {
  steps: Step[];
  won: number; // 1 / 0, from THIS side's perspective
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
function sd(xs: number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
}
/** Point-biserial correlation between a continuous x and a 0/1 y. */
function corr(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
}

const PHASES: { name: string; test: (turn: number) => boolean }[] = [
  { name: "early (t<=4)", test: (t) => t <= 4 },
  { name: "mid (5-9)", test: (t) => t >= 5 && t <= 9 },
  { name: "late (t>=10)", test: (t) => t >= 10 },
];

function main(): void {
  const db = new DatabaseSync(DB, { readOnly: true });
  const all = (db.prepare("SELECT run_hash FROM policy_runs").all() as { run_hash: string }[]).map(
    (r) => r.run_hash,
  );
  const hashes = RUNS.map((r) => {
    const hit = all.find((h) => h === r || h.startsWith(r));
    if (!hit) throw new Error(`[route_horizon] run not found: ${r}`);
    return hit;
  });

  const rows = db
    .prepare(
      `SELECT run_hash, game_index, actor, outcome, state_sparse
         FROM policy_decisions
        WHERE run_hash IN (${hashes.map(() => "?").join(",")})
          AND outcome != 0.5
        ORDER BY run_hash, game_index, decision_index`,
    )
    .all(...hashes) as {
    run_hash: string;
    game_index: number;
    actor: string;
    outcome: number;
    state_sparse: string;
  }[];
  db.close();
  if (rows.length === 0) throw new Error("[route_horizon] no decided decisions in those runs");

  // A trajectory is one SIDE of one game. The stored features are always from
  // the acting player's view, so mixing the two seats would flip the sign of
  // every prize differential halfway through.
  const trajectories = new Map<string, Trajectory>();
  for (const r of rows) {
    const key = `${r.run_hash}:${r.game_index}:${r.actor}`;
    const sparse = JSON.parse(r.state_sparse) as Record<string, number>;
    const turn = sparse[IDX.turn] ?? 0;
    const prizeDiff = (sparse[IDX.mine] ?? 0) - (sparse[IDX.theirs] ?? 0);
    const t = trajectories.get(key) ?? { steps: [], won: r.outcome >= 0.5 ? 1 : 0 };
    // One step per TURN, not per decision: a turn with 12 decisions is still
    // one unit of route progress, and keeping all 12 would weight long turns
    // more heavily for no reason.
    const last = t.steps[t.steps.length - 1];
    if (!last || last.turn !== turn) t.steps.push({ turn, prizeDiff });
    else last.prizeDiff = prizeDiff; // end-of-turn value
    trajectories.set(key, t);
  }

  const trs = Array.from(trajectories.values()).filter((t) => t.steps.length >= 2);
  console.log(
    `[route_horizon] ${rows.length.toLocaleString()} decisions -> ` +
      `${trs.length.toLocaleString()} side-trajectories, ` +
      `median length ${median(trs.map((t) => t.steps.length))} turns`,
  );

  interface Cell {
    k: number;
    n: number;
    moved: number; // fraction of windows where the prize diff changed
    absMean: number;
    sd: number;
    corrWin: number;
  }
  const overall: Cell[] = [];
  const byPhase = new Map<string, Cell[]>();

  for (let k = 1; k <= MAX_K; k++) {
    const deltas: number[] = [];
    const wins: number[] = [];
    const phaseBuf = new Map<string, { d: number[]; w: number[] }>();
    for (const p of PHASES) phaseBuf.set(p.name, { d: [], w: [] });

    for (const t of trs) {
      for (let i = 0; i < t.steps.length; i++) {
        // The window is k PLAYER-TURNS forward, found by turn number rather
        // than by index — a side does not always record a step every turn.
        const from = t.steps[i];
        const target = from.turn + k;
        let j = i + 1;
        while (j < t.steps.length && t.steps[j].turn < target) j += 1;
        if (j >= t.steps.length) continue; // window runs past the end of the game
        const delta = t.steps[j].prizeDiff - from.prizeDiff;
        deltas.push(delta);
        wins.push(t.won);
        const phase = PHASES.find((p) => p.test(from.turn));
        if (phase) {
          const buf = phaseBuf.get(phase.name)!;
          buf.d.push(delta);
          buf.w.push(t.won);
        }
      }
    }
    const cell = (d: number[], w: number[]): Cell => ({
      k,
      n: d.length,
      moved: d.length ? d.filter((x) => x !== 0).length / d.length : 0,
      absMean: mean(d.map(Math.abs)),
      sd: sd(d),
      corrWin: corr(d, w),
    });
    overall.push(cell(deltas, wins));
    for (const p of PHASES) {
      const buf = phaseBuf.get(p.name)!;
      byPhase.set(p.name, [...(byPhase.get(p.name) ?? []), cell(buf.d, buf.w)]);
    }
  }

  const table = (cells: Cell[], title: string) => {
    console.log(`\n  ${title}`);
    console.log(
      `    ${"k".padStart(2)} ${"windows".padStart(9)} ${"moved".padStart(7)} ` +
        `${"mean|Δ|".padStart(8)} ${"sd".padStart(6)} ${"corr(Δ,win)".padStart(12)}`,
    );
    for (const c of cells) {
      console.log(
        `    ${String(c.k).padStart(2)} ${c.n.toLocaleString().padStart(9)} ` +
          `${(c.moved * 100).toFixed(0).padStart(6)}% ${c.absMean.toFixed(2).padStart(8)} ` +
          `${c.sd.toFixed(2).padStart(6)} ${c.corrWin.toFixed(3).padStart(12)}`,
      );
    }
  };

  table(overall, "ALL PHASES — prize movement in a k-turn window");
  for (const p of PHASES) table(byPhase.get(p.name)!, p.name);

  // The headline: the shortest k whose window both MOVES and PREDICTS. That is
  // the horizon at which a route label carries information the game-outcome
  // label does not already give for free.
  const best = overall
    .filter((c) => c.moved >= 0.5)
    .sort((a, b) => b.corrWin / Math.sqrt(b.k) - a.corrWin / Math.sqrt(a.k))[0];
  console.log(
    `\n  Shortest window that both moves (>=50% of the time) and predicts:\n` +
      (best
        ? `    k=${best.k} turns — moves ${(best.moved * 100).toFixed(0)}% of windows, ` +
          `corr with winning ${best.corrWin.toFixed(3)}`
        : `    none — prize movement never fills half the windows at k<=${MAX_K}`),
  );
  console.log(
    `\n  Read it as: at k where corr(Δ,win) is already high, short-horizon prize\n` +
      `  progress is a valid surrogate for the game result — and each game yields\n` +
      `  ~length/k labels instead of 1. Where corr stays near 0 until k is the\n` +
      `  whole game, routes buy nothing over the outcome label we already use.`,
  );

  if (JSON_OUT) {
    writeFileSync(
      path.resolve(JSON_OUT),
      JSON.stringify({ runs: hashes, overall, byPhase: Object.fromEntries(byPhase) }, null, 2) + "\n",
    );
    console.log(`\n[route_horizon] wrote ${JSON_OUT}`);
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

main();
