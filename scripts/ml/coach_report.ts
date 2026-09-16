// Battle log in, skilled and unskilled plays out.
//
// For every decision a real player made, value every move they COULD have
// made, and report what the one they chose gave up. That is the coaching
// product: signed, per-decision, in win-probability points.
//
// THE VALIDATION THIS RUNS, AND WHY IT IS THE RIGHT ONE
//
// A regret number is easy to produce and hard to trust. The check with real
// ground truth is that WINNERS should play with lower mean regret than
// LOSERS, across logs the instrument never saw. `matches.result` supplies
// that label independently of anything computed here. If the two groups do
// not separate, the number is not measuring skill, whatever its error bars
// say — and this prints that comparison before it prints any advice.
//
// Both sides of the reconstructed board are determinized from the meta prior.
// A log replay knows only what surfaced, so the opponent's deck array is
// empty; rolled forward untreated they deck out immediately, every candidate
// move "wins", and the report is confident nonsense.
//
// Usage:
//   npx tsx scripts/ml/coach_report.ts [--limit 40] [--rollouts 24]
//     [--horizon 6] [--seed 1] [--top 12] [--db PATH] [--artifact PATH]

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { HeuristicPolicy, hashSeed, describeMove, type StateEvaluator } from "@/lib/engine/sim";
import { sameMove } from "@/lib/ml/strategist/regret";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";
import { seedOrLabel } from "@/lib/ml/features/guards";
import { determinizeLogSide, determinizeRng } from "@/lib/ml/strategist/determinize";
import { emptyScanStats, scanLog, type LogRow } from "@/lib/ml/strategist/logDecisions";
import { coachGame } from "@/lib/ml/strategist/coachGame";
import { RankerPolicy } from "@/lib/ml/rankerPolicy";
import { readPolicyArtifactFile } from "@/lib/ml/policyModel";
import {
  calibrate,
  fitPlatt,
  reliability,
  severityOf,
  severityThresholds,
  type CalibrationArtifact,
} from "@/lib/ml/strategist/calibrate";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function numArg(flag: string, fallback: number): number {
  const raw = arg(flag);
  if (raw === null) return fallback;
  const n = numOrNull(raw);
  if (n === null) {
    console.error(`[coach] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const DB = arg("--db") ?? path.resolve(REPO_ROOT, "..", "dexter-ml", "feature_store.sqlite");
const LIMIT = numArg("--limit", 40);
const ROLLOUTS = numArg("--rollouts", 24);
const HORIZON_RAW = arg("--horizon");
const HORIZON = HORIZON_RAW === "none" ? null : numArg("--horizon", 6);
const SEED = seedOrLabel(arg("--seed"), 1, hashSeed);
const TOP = numArg("--top", 12);
const ARTIFACT = arg("--artifact");
// Swap the rollout pilot. Q means "the value of this move if play continues
// like THIS", so the pilot is part of the definition, not a detail.
const PILOT = arg("--pilot");

interface Row extends LogRow {
  result: string | null;
}

/** Is this log a win for the logging player? null when unlabelled. */
function wonLog(result: string | null): boolean | null {
  const r = (result ?? "").toLowerCase();
  if (r === "win" || r === "won" || r === "w") return true;
  if (r === "loss" || r === "lost" || r === "l") return false;
  return null;
}

interface Blunder {
  logId: string;
  turn: number | null;
  played: string;
  instead: string;
  regret: number;
  se: number;
}

/** A play worth praising, not just one worth not-punishing.
 *
 *  Three conditions together, because any one alone is cheap:
 *    1. the human took (essentially) the best move available,
 *    2. the decision MATTERED — a wide spread between best and worst,
 *    3. a competent reference policy would have played something materially
 *       worse. Without this a forced-looking "best move" counts as genius.
 *
 *  This is the same shape as a chess engine's "brilliant" label, and it falls
 *  out of machinery the blunder side already needs: one analysis values every
 *  arm, so asking what another policy would have picked is free. */
interface Highlight {
  logId: string;
  turn: number | null;
  played: string;
  ratherThan: string;
  edge: number;
  se: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length;
}
function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1));
}
const pts = (x: number) => `${(x * 100).toFixed(2)}`;

function main(): void {
  const evaluate = createBoardEvaluator(ARTIFACT ?? undefined);
  if (HORIZON !== null && !evaluate) {
    console.error("[coach] no usable value artifact — refusing to score with a fallback.");
    process.exit(1);
  }

  const pilotArtifact = PILOT ? readPolicyArtifactFile(path.resolve(REPO_ROOT, PILOT)) : null;
  if (PILOT && !pilotArtifact) {
    console.error(`[coach] no usable pilot artifact at ${PILOT}`);
    process.exit(1);
  }
  if (pilotArtifact) console.log(`[coach] rollout pilot: ${pilotArtifact.model_version}`);

  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT m.id, m.battle_log_raw, m.player_handle, m.result, d.deck_list
         FROM matches m
         LEFT JOIN saved_decks d ON d.id = m.saved_deck_id
        WHERE m.battle_log_raw IS NOT NULL AND m.player_handle IS NOT NULL
        ORDER BY m.id LIMIT ?`,
    )
    .all(LIMIT) as unknown as Row[];
  db.close();

  console.log(`[coach] ${rows.length} battle logs, ${ROLLOUTS} rollouts, horizon ${HORIZON ?? "end"}`);

  const stats = emptyScanStats();
  const blunders: Blunder[] = [];
  const highlights: Highlight[] = [];
  const perLog = new Map<
    string,
    {
      regrets: number[];
      captures: number[];
      options: number[];
      turns: number[];
      result: string | null;
    }
  >();
  // Regret scales mechanically with how many alternatives existed (more arms
  // = a higher max) and with how volatile the position is. Both differ
  // systematically between a player who is flooded with resources and one who
  // is bricking, so a raw won/lost comparison can be a confound wearing a
  // finding's clothes. Binned here so that is visible rather than assumed.
  const byOptions = new Map<number, number[]>();
  // Mean regret by the KIND of move the human played, and by the kind the
  // search preferred instead. A systematic penalty on one kind is a bias in
  // the rollout, not a finding about human play — e.g. if every attack scores
  // as a blunder, the horizon is mispricing turn-ending moves.
  const byPlayedKind = new Map<string, number[]>();
  const bySuggestedKind = new Map<string, number>();
  // CALIBRATION. Everything here is denominated in "points of win
  // probability", and that unit is only meaningful if the underlying Q is
  // calibrated: decisions the model values at 0.70 should be won about 70%
  // of the time. This is the highest-powered check available — thousands of
  // decisions rather than the ~50 labelled logs the winners/losers test gets
  // — and it validates the UNIT that every coaching sentence is quoted in.
  const calib = new Map<number, { n: number; won: number }>();
  // Raw (q_chosen, won, game) triples, for fitting the calibration map.
  const calQ: number[] = [];
  const calWon: boolean[] = [];
  const calGame: string[] = [];
  // Between-player: one player's wins vs their own losses differ mostly by
  // luck, but different players differ by skill. 202 of 271 logs come from
  // two handles, so the within-player test is weak by construction.
  const byHandle = new Map<string, { caps: number[]; wins: number; games: number }>();
  const allRegrets: number[] = [];
  let significantCount = 0;
  let analyzed = 0;
  const startedAt = Date.now();

  for (const row of rows) {
    perLog.set(row.id, { regrets: [], captures: [], options: [], turns: [], result: row.result });
    const hcell = byHandle.get(row.player_handle) ?? { caps: [], wins: 0, games: 0 };
    const w = wonLog(row.result);
    if (w !== null) {
      hcell.games += 1;
      hcell.wins += w ? 1 : 0;
    }
    byHandle.set(row.player_handle, hcell);

    // One shared implementation with the app. This script is a pure
    // AGGREGATOR over coachGame's records — the same argument that pulled
    // logDecisions.ts out of move_agreement.ts.
    const game = coachGame(row, {
      evaluate: evaluate as StateEvaluator,
      rollouts: ROLLOUTS,
      horizon: HORIZON,
      seed: SEED,
      ...(pilotArtifact
        ? { rolloutPolicy: () => new RankerPolicy(pilotArtifact, { seed: SEED }) }
        : {}),
    });
    for (const k of ["logsUsed", "logsFailed", "decisions", "matched", "trivial", "yielded"] as const) {
      stats[k] += game.stats[k];
    }
    for (const [k, v] of Array.from(game.stats.missBy)) {
      stats.missBy.set(k, (stats.missBy.get(k) ?? 0) + v);
    }
    for (const [k, v] of Array.from(game.stats.unmatchedBy)) {
      stats.unmatchedBy.set(k, (stats.unmatchedBy.get(k) ?? 0) + v);
    }

    for (const d of game.decisions) {
      analyzed += 1;
      allRegrets.push(d.regret);
      const rec = perLog.get(row.id)!;
      rec.regrets.push(d.regret);
      rec.options.push(d.legalCount);
      rec.turns.push(d.turn ?? 0);
      if (d.capture !== null) rec.captures.push(d.capture);

      const bucket = Math.min(6, Math.floor(d.legalCount / 5));
      const arr = byOptions.get(bucket) ?? [];
      arr.push(d.regret);
      byOptions.set(bucket, arr);

      const kindArr = byPlayedKind.get(d.playedKind) ?? [];
      kindArr.push(d.regret);
      byPlayedKind.set(d.playedKind, kindArr);
      if (d.bestAlternative) {
        const sk = d.bestAlternative.split(" ")[0];
        bySuggestedKind.set(sk, (bySuggestedKind.get(sk) ?? 0) + 1);
      }

      const outcome = wonLog(row.result);
      if (outcome !== null) {
        calQ.push(d.qChosen);
        calWon.push(outcome);
        calGame.push(row.id);
        const b = Math.min(9, Math.max(0, Math.floor(d.qChosen * 10)));
        const cell = calib.get(b) ?? { n: 0, won: 0 };
        cell.n += 1;
        cell.won += outcome ? 1 : 0;
        calib.set(b, cell);
      }
      if (d.significant) significantCount += 1;
    }
    for (const b of game.blunders) {
      blunders.push({
        logId: row.id,
        turn: b.turn,
        played: b.played,
        instead: b.bestAlternative ?? "—",
        regret: b.regret,
        se: b.regretSe,
      });
    }
    for (const h of game.highlights) {
      highlights.push({
        logId: row.id,
        turn: h.turn,
        played: h.played,
        ratherThan: h.bestAlternative ?? "—",
        edge: h.stakes,
        se: h.regretSe,
      });
    }
  }

  const elapsed = (Date.now() - startedAt) / 1000;
  console.log(
    `  logs ${stats.logsUsed} used / ${stats.logsFailed} unusable; ` +
      `${stats.decisions} decisions, ${stats.matched} matched ` +
      `(${((100 * stats.matched) / Math.max(1, stats.decisions)).toFixed(1)}% coverage), ` +
      `${analyzed} valued`,
  );

  console.log("REGRET DISTRIBUTION (points of win probability given up)");
  const sorted = [...allRegrets].sort((a, b) => a - b);
  const q = (f: number) => (sorted.length ? sorted[Math.floor(f * (sorted.length - 1))] : 0);
  console.log(
    `  mean ${pts(mean(allRegrets))}  sd ${pts(sd(allRegrets))}  ` +
      `median ${pts(q(0.5))}  p90 ${pts(q(0.9))}  p99 ${pts(q(0.99))}`,
  );
  console.log(
    `  flagged as significant (regret > 2 SE): ${significantCount} / ${analyzed} = ` +
      `${((100 * significantCount) / Math.max(1, analyzed)).toFixed(1)}%\n`,
  );

  // ── The validation ────────────────────────────────────────────────
  console.log("CALIBRATION — does the Q every regret is built from predict the result?");
  {
    let sumAbs = 0;
    let tot = 0;
    for (const b of Array.from(calib.keys()).sort((a, z) => a - z)) {
      const { n, won } = calib.get(b)!;
      if (n < 20) continue;
      const predicted = b / 10 + 0.05;
      const actual = won / n;
      sumAbs += n * Math.abs(predicted - actual);
      tot += n;
      const bar = "#".repeat(Math.round(actual * 30));
      console.log(
        `  Q ${(b / 10).toFixed(1)}-${(b / 10 + 0.1).toFixed(1)}  n=${String(n).padStart(5)}  ` +
          `actual ${(100 * actual).toFixed(1)}%  ${bar}`,
      );
    }
    console.log(
      `  mean |predicted - actual| = ${(100 * (tot ? sumAbs / tot : 0)).toFixed(1)} pts  ` +
        `(the log's result is per-MATCH, so some spread is the label, not the model)\n`,
    );
  }

  // ── Calibration fit ───────────────────────────────────────────────
  if (calQ.length >= 200) {
    const before = reliability(calQ, calWon);
    const { a, b, nGames, converged } = fitPlatt(calQ, calWon, calGame);
    const mapped = calQ.map((x) => calibrate({ a, b } as CalibrationArtifact, x));
    const after = reliability(mapped, calWon);
    const sev = severityThresholds(allRegrets);
    console.log("CALIBRATION FIT — P(win) = sigmoid(a*logit(q) + b)");
    if (!converged) {
      // A diverged fit still "improves" reliability by collapsing everything
      // onto the majority class, so the convergence flag has to gate the
      // report rather than sit beside it.
      console.log(
        `  DID NOT CONVERGE (a=${a.toFixed(2)}, b=${b.toFixed(2)}) — refusing to ` +
          `report a map. Use the severity buckets, which need no calibration.`,
      );
    } else {
      // Out-of-fold, split by GAME. An in-sample reliability number for a map
      // fit on the same points is a statement about the fit, not about
      // whether it will hold on the next battle.
      const gameIds = Array.from(new Set(calGame));
      const foldOf = new Map(gameIds.map((id, i) => [id, i % 2] as const));
      const oofPred: number[] = [];
      const oofWon: boolean[] = [];
      let bothFolds = true;
      for (const fold of [0, 1]) {
        const trQ: number[] = [];
        const trW: boolean[] = [];
        const trG: string[] = [];
        for (let i = 0; i < calQ.length; i++) {
          if (foldOf.get(calGame[i]) !== fold) {
            trQ.push(calQ[i]);
            trW.push(calWon[i]);
            trG.push(calGame[i]);
          }
        }
        const f = fitPlatt(trQ, trW, trG);
        if (!f.converged) {
          bothFolds = false;
          break;
        }
        for (let i = 0; i < calQ.length; i++) {
          if (foldOf.get(calGame[i]) === fold) {
            oofPred.push(calibrate({ a: f.a, b: f.b } as CalibrationArtifact, calQ[i]));
            oofWon.push(calWon[i]);
          }
        }
      }
      console.log(`  a=${a.toFixed(3)}  b=${b.toFixed(3)}`);
      console.log(
        `  mean |predicted - actual| over deciles: ${(100 * before.error).toFixed(1)} pts ` +
          `-> ${(100 * after.error).toFixed(1)} pts in-sample`,
      );
      if (bothFolds && oofPred.length > 0) {
        const oof = reliability(oofPred, oofWon);
        console.log(
          `  OUT-OF-FOLD (2-fold split by game): ${(100 * oof.error).toFixed(1)} pts — ` +
            `this is the number that generalises.`,
        );
      } else {
        console.log(`  out-of-fold check unavailable (a fold failed to converge)`);
      }
    }
    console.log(
      `  fit on ${calQ.length} decisions from ${nGames} games — the EFFECTIVE n is ` +
        `${nGames}, since every decision in a game shares one outcome label.`,
    );
    console.log(
      `  severity (regret quantiles): inaccuracy >=${pts(sev.inaccuracy)} ` +
        `mistake >=${pts(sev.mistake)} blunder >=${pts(sev.blunder)} pts`,
    );
    const counts = { ok: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    for (const r of allRegrets) counts[severityOf(r, sev)] += 1;
    console.log(
      `  distribution: ok ${counts.ok}, inaccuracy ${counts.inaccuracy}, ` +
        `mistake ${counts.mistake}, blunder ${counts.blunder}\n`,
    );
  }

  console.log("REGRET BY MOVE KIND PLAYED (a per-kind bias is a rollout defect)");
  for (const [k, xs] of Array.from(byPlayedKind).sort((a, b) => mean(b[1]) - mean(a[1]))) {
    console.log(`  ${k.padEnd(16)} n=${String(xs.length).padStart(5)}  mean ${pts(mean(xs))} pts`);
  }
  console.log("\n  what the search preferred instead:");
  const totSug = Array.from(bySuggestedKind.values()).reduce((a, b) => a + b, 0);
  for (const [k, n] of Array.from(bySuggestedKind).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(16)} ${String(n).padStart(5)}  ${((100 * n) / totSug).toFixed(1)}%`);
  }
  console.log("");

  console.log("REGRET vs NUMBER OF ALTERNATIVES (the mechanical confound)");
  for (const b of Array.from(byOptions.keys()).sort((a, z) => a - z)) {
    const xs = byOptions.get(b)!;
    const label = b >= 6 ? "30+" : `${b * 5}-${b * 5 + 4}`;
    console.log(`  ${label.padStart(6)} options  n=${String(xs.length).padStart(5)}  mean ${pts(mean(xs))} pts`);
  }
  console.log("");

  const won: number[] = [];
  const lost: number[] = [];
  const wonOpts: number[] = [];
  const lostOpts: number[] = [];
  const wonN: number[] = [];
  const lostN: number[] = [];
  const wonCap: number[] = [];
  const lostCap: number[] = [];
  for (const [, v] of Array.from(perLog)) {
    if (v.regrets.length < 5) continue;
    const m = mean(v.regrets);
    const r = (v.result ?? "").toLowerCase();
    if (r === "win" || r === "won" || r === "w") {
      won.push(m);
      wonOpts.push(mean(v.options));
      wonN.push(v.regrets.length);
      if (v.captures.length >= 5) wonCap.push(mean(v.captures));
    } else if (r === "loss" || r === "lost" || r === "l") {
      lost.push(m);
      lostOpts.push(mean(v.options));
      lostN.push(v.regrets.length);
      if (v.captures.length >= 5) lostCap.push(mean(v.captures));
    }
  }
  console.log(
    `  winners: ${mean(wonOpts).toFixed(1)} mean options, ${mean(wonN).toFixed(0)} valued decisions\n` +
      `  losers : ${mean(lostOpts).toFixed(1)} mean options, ${mean(lostN).toFixed(0)} valued decisions`,
  );
  console.log("VALIDATION — do winners give up less than losers?");
  if (won.length < 3 || lost.length < 3) {
    console.log(
      `  not enough labelled logs (won ${won.length}, lost ${lost.length}) — ` +
        `raise --limit before reading this.`,
    );
  } else {
    const diff = mean(lost) - mean(won);
    const se = Math.sqrt(sd(won) ** 2 / won.length + sd(lost) ** 2 / lost.length);
    const z = se > 0 ? diff / se : 0;
    console.log(`  winners  n=${won.length}  mean regret ${pts(mean(won))} pts`);
    console.log(`  losers   n=${lost.length}  mean regret ${pts(mean(lost))} pts`);
    console.log(
      `  losers - winners: ${pts(diff)} pts  z=${z.toFixed(2)}  ` +
        (z > 1.96
          ? "SEPARABLE — regret tracks the real result."
          : z < -1.96
            ? "SEPARABLE IN THE WRONG DIRECTION — winners look worse. Do not ship."
            : "not separable at this n."),
    );
  }

  if (wonCap.length >= 3 && lostCap.length >= 3) {
    const diff = mean(wonCap) - mean(lostCap);
    const se = Math.sqrt(sd(wonCap) ** 2 / wonCap.length + sd(lostCap) ** 2 / lostCap.length);
    const z = se > 0 ? diff / se : 0;
    console.log("\nVALIDATION (stakes-normalised) — share of available value captured");
    console.log(`  winners  n=${wonCap.length}  capture ${(100 * mean(wonCap)).toFixed(1)}%`);
    console.log(`  losers   n=${lostCap.length}  capture ${(100 * mean(lostCap)).toFixed(1)}%`);
    console.log(
      `  winners - losers: ${(100 * diff).toFixed(1)} pts  z=${z.toFixed(2)}  ` +
        (z > 1.96
          ? "SEPARABLE — capture tracks the real result."
          : z < -1.96
            ? "SEPARABLE IN THE WRONG DIRECTION. Do not ship."
            : "not separable at this n."),
    );
  }

  // Attach each log's captures to its handle now that they are all computed.
  for (const [id, v] of Array.from(perLog)) {
    const row = rows.find((r) => r.id === id);
    if (!row) continue;
    const h = byHandle.get(row.player_handle);
    if (h) for (const c of v.captures) h.caps.push(c);
  }
  const players = Array.from(byHandle)
    .filter(([, v]) => v.games >= 5 && v.caps.length >= 40)
    .map(([h, v]) => ({ h, cap: mean(v.caps), wr: v.wins / v.games, games: v.games }));
  if (players.length >= 3) {
    console.log("\nBETWEEN-PLAYER — does mean capture track that player's win rate?");
    players.sort((a, b) => b.cap - a.cap);
    for (const p of players) {
      console.log(
        `  ${p.h.slice(0, 16).padEnd(18)} capture ${(100 * p.cap).toFixed(1)}%  ` +
          `win rate ${(100 * p.wr).toFixed(1)}%  (${p.games} logs)`,
      );
    }
    const mc = mean(players.map((p) => p.cap));
    const mw = mean(players.map((p) => p.wr));
    const cov = mean(players.map((p) => (p.cap - mc) * (p.wr - mw)));
    const r = cov / (sd(players.map((p) => p.cap)) * sd(players.map((p) => p.wr)) || 1);
    console.log(`  correlation r = ${r.toFixed(2)} over ${players.length} players`);
  }

  console.log(
    `\nTOP ${TOP} SKILLED PLAYS (best move, decision mattered, reference ` +
      `policy would have played worse) — ${highlights.length} found`,
  );
  highlights.sort((a, b) => b.edge - a.edge);
  for (const h of highlights.slice(0, TOP)) {
    console.log(
      `  +${pts(h.edge)} pts (±${pts(1.96 * h.se)})  log ${h.logId.slice(0, 8)} ` +
        `turn ${h.turn ?? "?"}\n      played:      ${h.played}\n` +
        `      rather than: ${h.ratherThan}`,
    );
  }

  console.log(`\nTOP ${TOP} FLAGGED PLAYS`);
  blunders.sort((a, b) => b.regret - a.regret);
  for (const b of blunders.slice(0, TOP)) {
    console.log(
      `  -${pts(b.regret)} pts (±${pts(1.96 * b.se)})  log ${b.logId.slice(0, 8)} ` +
        `turn ${b.turn ?? "?"}\n      played:  ${b.played}\n      instead: ${b.instead}`,
    );
  }
  console.log(
    `\n${elapsed.toFixed(0)}s  (${(elapsed / Math.max(1, analyzed)).toFixed(2)}s per decision)`,
  );
}

main();
