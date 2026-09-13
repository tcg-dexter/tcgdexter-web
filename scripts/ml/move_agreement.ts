// Does the pilot choose what a real player chose?
//
// WHY THIS EXISTS
//
// Every gate we have is a win-rate duel on the 12-deck frozen benchmark, and
// that instrument has a resolution floor. Measured 2026-09-08 at n~2300 per
// comparison: it separates a 4.5-point effect (planner+model vs the planner's
// built-in evaluator, 54.52% CI [52.5,56.5]) and CANNOT separate anything
// under ~2 points. Six consecutive interventions — more games, more deck
// diversity, denser route labels, richer card-detail features, deeper search —
// all landed inside that floor and reported nothing.
//
// The floor is structural, not fixable by running more games: a duel yields
// ONE bit per GAME, and a game is ~100 decisions. Real battle logs invert
// that. 271 imported logs hold tens of thousands of DECISIONS, each with a
// recorded human choice, so the effective sample size is two orders of
// magnitude larger for the same wall-clock cost.
//
// WHAT IT MEASURES, AND WHAT IT DOES NOT
//
// Agreement with a human is NOT optimality. These logs come from TCG Live
// players of unknown and varying skill, and a pilot that agreed 100% would
// merely have cloned an average ladder player. Read it as a HIGH-RESOLUTION
// SIMILARITY signal, useful for detecting that a change moved play at all —
// which the duel cannot do — and never as a quality score on its own.
//
// COVERAGE IS REPORTED SEPARATELY, AND THAT IS THE POINT
//
// A human move the engine cannot enumerate is an ENGINE FIDELITY gap, not a
// disagreement. Folding the two together would let missing card support
// masquerade as bad judgement — and quietly reward a change that made the
// engine worse at representing the game. So every decision is classified:
//
//   matched    the engine offered a legal move corresponding to the human's
//   unmatched  it did not — fidelity gap, excluded from the agreement rate
//   trivial    only one legal move existed — excluded, it measures nothing
//
// Agreement is computed over MATCHED, NON-TRIVIAL decisions only, and the
// coverage rate is printed alongside so a change in one cannot hide in the
// other.
//
// Usage:
//   npx tsx scripts/ml/move_agreement.ts [--limit N] [--artifact PATH]
//     [--skill 1] [--db PATH] [--verbose]

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  emptyScanStats,
  matches,
  scanLog,
  type LogRow,
} from "@/lib/ml/strategist/logDecisions";
import { HeuristicPolicy, type DecisionPolicy } from "@/lib/engine/sim/policy";
import { PlannerPolicy } from "@/lib/engine/sim/planner";
import { RoutePlannerPolicy } from "@/lib/engine/sim/routePlanner";
import { plannerParamsForSkill } from "@/lib/engine/sim/difficulty";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB =
  arg("--db") ?? path.resolve(REPO_ROOT, "..", "dexter-ml", "feature_store.sqlite");
const LIMIT = numOrNull(arg("--limit")) ?? 271;
const ARTIFACT = arg("--artifact");
const SKILL = numOrNull(arg("--skill")) ?? 1;
const VERBOSE = process.argv.includes("--verbose");
// Second policy for a PAIRED comparison. This is the mode that makes the
// instrument worth building: both policies are asked the SAME decisions, so
// the comparison is paired and only DISCORDANT decisions (one agrees, the
// other does not) carry information. An unpaired win-rate duel throws that
// structure away, which is why it needs thousands of games to resolve two
// points; McNemar's test on the discordant pairs resolves far less.
const ARTIFACT_B = arg("--vs");
// Which PLANNER each side uses: "template" (the four-slot enumeration) or
// "route" (the sequence beam search). Comparing SEARCH here rather than only
// in the duel matters: agreement can say whether two pilots play DIFFERENTLY
// at all, which a win rate cannot — two policies can tie at 50% either
// because they play alike or because they differ and are equally good.
const PLANNER_A = arg("--planner-a") ?? "template";
const PLANNER_B = arg("--planner-b") ?? "template";
const BEAM = numOrNull(arg("--beam")) ?? 6;

function makePolicy(
  spec: string | null,
  planner = "template",
): { label: string; policy: () => DecisionPolicy } {
  const ARTIFACT = spec;
  if (ARTIFACT === "heuristic") {
    return { label: "HeuristicPolicy", policy: () => new HeuristicPolicy() };
  }
  const params = plannerParamsForSkill(SKILL);
  const kind = planner === "route" ? ` [route beam=${BEAM}]` : "";
  const build = (evaluate?: ReturnType<typeof createBoardEvaluator>) =>
    planner === "route"
      ? new RoutePlannerPolicy({
          params,
          seed: 1,
          beam: BEAM,
          ...(evaluate ? { evaluate } : {}),
        })
      : new PlannerPolicy({ params, seed: 1, ...(evaluate ? { evaluate } : {}) });
  // "none" = the planner's built-in evaluator, matching value_duel.ts's
  // convention. It isolates the MODEL's contribution from the SEARCH's.
  if (!ARTIFACT || ARTIFACT === "none") {
    return {
      label: `planner (built-in evaluator)${kind}`,
      policy: () => build(),
    };
  }
  const evaluate = createBoardEvaluator(ARTIFACT);
  if (!evaluate) throw new Error(`[move_agreement] no usable artifact at ${ARTIFACT}`);
  return {
    label: `planner + ${path.basename(ARTIFACT)}${kind}`,
    policy: () => build(evaluate),
  };
}

interface Tally {
  decisions: number;
  matched: number;
  trivial: number;
  agreed: number;
  scored: number;
  optionsSum: number;
  randomBaseline: number;
}

function main(): void {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db
    .prepare(
      // The deck list is not optional. replayViewAt needs it to synthesize
      // unseenOwn; without it a board-aware evaluator scores every position
      // with deckCount 0 and no unseen cards, its output flattens, and every
      // policy picks the same move from the planner's tactical terms alone.
      `SELECT m.id, m.battle_log_raw, m.player_handle, d.deck_list
         FROM matches m
         LEFT JOIN saved_decks d ON d.id = m.saved_deck_id
        WHERE m.battle_log_raw IS NOT NULL AND m.player_handle IS NOT NULL
        ORDER BY m.id LIMIT ?`,
    )
    .all(LIMIT) as {
    id: string;
    battle_log_raw: string;
    player_handle: string;
    deck_list: string | null;
  }[];
  db.close();

  const a = makePolicy(ARTIFACT, PLANNER_A);
  const b = ARTIFACT_B ? makePolicy(ARTIFACT_B, PLANNER_B) : null;
  console.log(`[move_agreement] ${rows.length} battle logs`);
  console.log(`  A: ${a.label}`);
  if (b) console.log(`  B: ${b.label}`);
  console.log("");
  const { label, policy } = a;

  const t: Tally = {
    decisions: 0,
    matched: 0,
    trivial: 0,
    agreed: 0,
    scored: 0,
    optionsSum: 0,
    randomBaseline: 0,
  };
  const agreedBy = new Map<string, [number, number]>();
  // McNemar 2x2 on the discordant cells only.
  let bothAgree = 0;
  let onlyA = 0;
  let onlyB = 0;
  let neither = 0;

  const stats = emptyScanStats();
  for (const row of rows) {
    scanLog(row as LogRow, stats, (d) => {
      const { state: before, ctx, legal, action } = d;
      let chosen;
      try {
        chosen = policy().chooseMove(d.view, legal, ctx);
      } catch {
        return;
      }
      t.scored += 1;
      t.optionsSum += legal.length;
      t.randomBaseline += 1 / legal.length;
      const hit = matches(before, chosen, action);
      if (hit) t.agreed += 1;
      if (b) {
        let hitB = false;
        try {
          const chosenB = b.policy().chooseMove(d.view, legal, ctx);
          hitB = matches(before, chosenB, action);
        } catch {
          // Fall through as a non-agreement rather than dropping the pair:
          // dropping only A-failures or only B-failures would bias McNemar.
        }
        if (hit && hitB) bothAgree += 1;
        else if (hit) onlyA += 1;
        else if (hitB) onlyB += 1;
        else neither += 1;
      }
      const cell = agreedBy.get(action.action_type) ?? [0, 0];
      cell[0] += hit ? 1 : 0;
      cell[1] += 1;
      agreedBy.set(action.action_type, cell);
    });
  }
  t.decisions = stats.decisions;
  t.matched = stats.matched;
  t.trivial = stats.trivial;
  const logsUsed = stats.logsUsed;
  const logsFailed = stats.logsFailed;
  const missBy = stats.missBy;
  const unmatchedBy = stats.unmatchedBy;

  const pct = (a: number, b: number) => `${((100 * a) / (b || 1)).toFixed(1)}%`;
  console.log(`  logs replayed        : ${logsUsed} (${logsFailed} unusable)`);
  console.log(`  player decisions     : ${t.decisions.toLocaleString()}`);
  console.log(
    `  COVERAGE (engine could represent the human's move): ` +
      `${t.matched.toLocaleString()} / ${t.decisions.toLocaleString()} = ${pct(t.matched, t.decisions)}`,
  );
  console.log(`  trivial (1 legal move, excluded)         : ${t.trivial.toLocaleString()}`);
  console.log(`  scored (matched, >=2 options)            : ${t.scored.toLocaleString()}`);
  console.log(
    `  mean options per scored decision         : ${(t.optionsSum / (t.scored || 1)).toFixed(1)}`,
  );
  console.log(
    `\n  AGREEMENT : ${t.agreed.toLocaleString()} / ${t.scored.toLocaleString()} = ` +
      `${pct(t.agreed, t.scored)}`,
  );
  console.log(
    `  random baseline (1/n per decision)       : ${pct(t.randomBaseline, t.scored)}`,
  );
  // Binomial SE on the agreement rate — the whole reason for this instrument
  // is that this number is small where the duel's was not.
  const p = t.agreed / (t.scored || 1);
  const se = Math.sqrt((p * (1 - p)) / (t.scored || 1));
  console.log(
    `  95% CI                                   : ` +
      `[${(100 * (p - 1.96 * se)).toFixed(1)}, ${(100 * (p + 1.96 * se)).toFixed(1)}]  ` +
      `(±${(196 * se).toFixed(2)} pts)`,
  );

  if (b) {
    const disc = onlyA + onlyB;
    // McNemar with a normal approximation on the discordant pairs. Only
    // disagreements carry information: decisions both policies get right (or
    // both get wrong) tell us nothing about which is better, and including
    // them is exactly the dilution an unpaired duel suffers.
    const z = disc > 0 ? (onlyA - onlyB) / Math.sqrt(disc) : 0;
    const pRate = (x: number) => `${((100 * x) / (t.scored || 1)).toFixed(1)}%`;
    console.log(`\n  PAIRED COMPARISON (same ${t.scored.toLocaleString()} decisions)`);
    console.log(`    A agrees            : ${(bothAgree + onlyA).toLocaleString()}  ${pRate(bothAgree + onlyA)}`);
    console.log(`    B agrees            : ${(bothAgree + onlyB).toLocaleString()}  ${pRate(bothAgree + onlyB)}`);
    console.log(`    both agree          : ${bothAgree.toLocaleString()}`);
    console.log(`    both disagree       : ${neither.toLocaleString()}`);
    console.log(`    DISCORDANT  A only  : ${onlyA.toLocaleString()}`);
    console.log(`                B only  : ${onlyB.toLocaleString()}`);
    console.log(`    McNemar z = ${z.toFixed(2)}  ${Math.abs(z) > 1.96 ? "SEPARABLE at 95%" : "not separable"}`);
    if (disc > 0) {
      console.log(
        `    (a paired test sees ${disc.toLocaleString()} informative decisions here; an\n` +
          `     unpaired win-rate duel would need thousands of GAMES for the same power)`,
      );
    }
  }

  console.log(`\n  by action type (agreement / scored):`);
  for (const [k, [a, n]] of Array.from(agreedBy).sort((x, y) => y[1][1] - x[1][1])) {
    console.log(`    ${k.padEnd(16)} ${String(a).padStart(6)} / ${String(n).padStart(6)}  ${pct(a, n)}`);
  }
  if (missBy.size > 0) {
    const totalMiss = Array.from(missBy.values()).reduce((a, b) => a + b, 0);
    console.log(`\n  WHY the engine offered no matching move (${totalMiss.toLocaleString()} misses):`);
    for (const [k, n] of Array.from(missBy).sort((x, y) => y[1] - x[1])) {
      console.log(`    ${k.padEnd(20)} ${String(n).padStart(6)}  ${pct(n, totalMiss)}`);
    }
  }
  if (unmatchedBy.size > 0 && VERBOSE) {
    console.log(`\n  unmatched detail:`);
    for (const [k, n] of Array.from(unmatchedBy).sort((x, y) => y[1] - x[1])) {
      console.log(`    ${k.padEnd(16)} ${String(n).padStart(6)}`);
    }
  }
}

main();
