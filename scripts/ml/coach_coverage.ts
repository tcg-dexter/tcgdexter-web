// Where does the coach's coverage actually go? Measured against GROUND TRUTH.
//
// The coach can only grade a decision it can reconstruct, and on real imported
// logs it reconstructs about half. That number has always been attributed to
// the replay reducer, and it could never be checked, because on a real log we
// do not know what the board really was — which is the whole problem.
//
// On a GENERATED log we do. `lib/engine/sim/battleLog.ts` emits TCG Live
// format deliberately, so "a log a user pastes and a log we generated are
// interchangeable everywhere downstream", and `battleLog.test.ts` enforces it
// by parsing every emitted line with the real parser. So the round trip is
// available:
//
//     play a game, recording what the human ACTUALLY did
//       -> battleLogText()   -> TCG Live text
//       -> scanLog()         -> reconstructed decisions
//       -> difference against the recorded truth
//
// That separates three things one number currently hides:
//
//   1. the human made a move the LOG never recorded       (emitter gap)
//   2. the log recorded it, the REDUCER could not rebuild (reducer gap)
//   3. rebuilt, but the engine offered no matching move   (engine fidelity)
//
// SCOPE, because it bounds every number below. The emitter gap is measured on
// OUR emitter, so it applies to AI Player battles — which reach `matches` via
// recordAiBattle — and NOT to logs pasted from TCG Live, where their fidelity
// governs instead. The reducer gap transfers to both. And "truth" counts
// interactive decisions with >=2 options while scanLog counts log actions;
// those units are close but not identical, so treat the emitter gap as
// indicative and the reducer gap as the solid number.
//
// Usage:
//   npx tsx scripts/ml/coach_coverage.ts [--games 12] [--seed 1] [--top 20]

import {
  startGame,
  autoSetup,
  humanOptions,
  applyHumanMove,
  battleLogText,
  HeuristicPolicy,
  viewFor,
  hashSeed,
  type GameSession,
  type InteractiveMove,
} from "@/lib/engine/sim";
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";
import { seedOrLabel } from "@/lib/ml/features/guards";
import { emptyScanStats, scanLog, type ScanStats } from "@/lib/ml/strategist/logDecisions";

import path from "node:path";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function numArg(flag: string, fallback: number): number {
  const raw = arg(flag);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    console.error(`[coverage] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const GAMES = numArg("--games", 12);
const TOP = numArg("--top", 20);
const SEED = seedOrLabel(arg("--seed"), 1, hashSeed);
const DECKS_FILE =
  arg("--decks-file") ?? path.resolve(REPO_ROOT, "data/ml/benchmark-decks.json");

interface Truth {
  kind: string;
  card: string | null;
  /** How many moves the human REALLY had, and how big their hand REALLY was.
   *  Reconstruction can only ever be a subset, and the size of that shortfall
   *  is what decides whether a recovered decision is graded against the real
   *  alternatives or against an impoverished stub of them. */
  options: number;
  handSize: number;
}

/** Play a whole game with a scripted human, recording what the human actually
 *  did. Mirrors battleLog.test.ts's playFullGame, which is the file that
 *  guarantees the emitted text parses at all. */
function playAndRecord(deck: string, seed: number): { session: GameSession; truth: Truth[] } {
  const session = startGame({
    deckHuman: deck,
    deckAi: deck,
    skill: 0.9,
    seed,
    handles: { player: "TestTrainer", opponent: "Dexter" },
  });
  autoSetup(session);
  const policy = new HeuristicPolicy();
  const truth: Truth[] = [];
  for (let i = 0; i < 600 && session.status !== "over"; i++) {
    const options = humanOptions(session);
    if (options.length === 0) break;
    const move: InteractiveMove =
      session.status === "human_promotion"
        ? options[0]
        : ((policy.chooseMove(
            viewFor(session.state, "player"),
            options as never,
            session.ctx,
          ) as InteractiveMove) ?? { kind: "pass" });
    // Only real decisions: a forced single option carries no judgement, and
    // is excluded everywhere else in this pipeline too.
    if (session.status !== "human_promotion" && options.length >= 2) {
      const m = move as unknown as Record<string, unknown>;
      truth.push({
        kind: String(m.kind ?? "?"),
        card: typeof m.card === "string" ? m.card : null,
        options: options.length,
        handSize: session.state.sides.player.hand.length,
      });
    }
    applyHumanMove(session, move);
  }
  return { session, truth };
}

function merge(into: Map<string, number>, from: Map<string, number>): void {
  for (const [k, v] of Array.from(from)) into.set(k, (into.get(k) ?? 0) + v);
}

function table(title: string, m: Map<string, number>, total: number, top: number): void {
  const rows = Array.from(m).sort((a, b) => b[1] - a[1]);
  if (rows.length === 0) return;
  console.log(`\n${title}`);
  let shown = 0;
  for (const [k, v] of rows.slice(0, top)) {
    const [name, why] = k.split(/:(?=[^:]*$)/);
    console.log(
      `  ${String(v).padStart(4)}  ${((100 * v) / Math.max(1, total)).toFixed(1).padStart(5)}%  ` +
        `${(why ?? "").padEnd(18)}${name}`,
    );
    shown += v;
  }
  if (rows.length > top) {
    const rest = rows.slice(top).reduce((s, r) => s + r[1], 0);
    console.log(`  ${String(rest).padStart(4)}         (${rows.length - top} more causes)`);
    shown += rest;
  }
  void shown;
}

function main(): void {
  const decks = loadBenchmarkDecks(DECKS_FILE);
  let totalTruth = 0;
  let totalFound = 0;
  let totalMatched = 0;
  let totalTrivial = 0;
  let failed = 0;
  const missBy = new Map<string, number>();
  const unmatchedBy = new Map<string, number>();
  const unmatchedCards = new Map<string, number>();
  const truthKinds = new Map<string, number>();
  const trueOptions: number[] = [];
  const trueHand: number[] = [];
  const reconOptions: number[] = [];
  const reconHand: number[] = [];

  console.log(`[coverage] ${GAMES} games over ${decks.length} benchmark decks, seed ${SEED}`);

  for (let g = 0; g < GAMES; g++) {
    const deck = decks[g % decks.length];
    const seed = hashSeed(`coverage:${SEED}:${g}`);
    const { session, truth } = playAndRecord(deck.list, seed);
    const text = battleLogText(session);
    const stats: ScanStats = emptyScanStats();
    scanLog(
      {
        id: `synthetic-${g}`,
        battle_log_raw: text,
        player_handle: "TestTrainer",
        // The deck list matters: without it the reconstruction is weaker and
        // coverage drops, so withholding it would measure the wrong thing.
        deck_list: deck.list,
      },
      stats,
      (d) => {
        reconOptions.push(d.legal.length);
        reconHand.push(d.state.sides.player.hand.length);
      },
    );
    totalTruth += truth.length;
    totalFound += stats.decisions;
    totalMatched += stats.matched;
    totalTrivial += stats.trivial;
    failed += stats.logsFailed;
    merge(missBy, stats.missBy);
    merge(unmatchedBy, stats.unmatchedBy);
    merge(unmatchedCards, stats.unmatchedCards);
    for (const t of truth) {
      truthKinds.set(t.kind, (truthKinds.get(t.kind) ?? 0) + 1);
      trueOptions.push(t.options);
      trueHand.push(t.handSize);
    }
  }

  const emitterGap = totalTruth - totalFound;
  const reducerGap = totalFound - totalMatched;

  console.log(`\nWHERE THE COVERAGE GOES  (${GAMES} games, ${failed} logs failed to parse)`);
  console.log(`  decisions the human actually made      ${String(totalTruth).padStart(5)}   100.0%`);
  console.log(
    `  ...that the LOG records                ${String(totalFound).padStart(5)}   ` +
      `${((100 * totalFound) / Math.max(1, totalTruth)).toFixed(1).padStart(5)}%   ` +
      `EMITTER GAP ${emitterGap}`,
  );
  console.log(
    `  ...that the REDUCER reconstructs       ${String(totalMatched).padStart(5)}   ` +
      `${((100 * totalMatched) / Math.max(1, totalTruth)).toFixed(1).padStart(5)}%   ` +
      `REDUCER GAP ${reducerGap}`,
  );
  console.log(
    `  ...that are real decisions (>=2 moves) ${String(totalMatched - totalTrivial).padStart(5)}   ` +
      `${((100 * (totalMatched - totalTrivial)) / Math.max(1, totalTruth)).toFixed(1).padStart(5)}%   ` +
      `(${totalTrivial} were forced)`,
  );

  // RECOVERING a decision is not the same as grading it well. The coach values
  // every legal move, so if the reconstructed hand is a stub of the real one
  // the alternatives are incomplete: `regret` is biased DOWN (fewer arms, a
  // lower max) and `capture` biased UP (a larger share of a smaller range).
  // Coverage that rose while this gap widened would be a worse instrument
  // wearing a better number, so the two are always reported together.
  const avg = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((s, x) => s + x, 0) / xs.length);
  console.log(`\n  ARE RECOVERED DECISIONS GRADED AGAINST THE REAL ALTERNATIVES?`);
  console.log(
    `    legal moves   true ${avg(trueOptions).toFixed(1).padStart(5)}   ` +
      `reconstructed ${avg(reconOptions).toFixed(1).padStart(5)}   ` +
      `(${((100 * avg(reconOptions)) / Math.max(0.01, avg(trueOptions))).toFixed(0)}% of the real choice set)`,
  );
  console.log(
    `    hand size     true ${avg(trueHand).toFixed(1).padStart(5)}   ` +
      `reconstructed ${avg(reconHand).toFixed(1).padStart(5)}   ` +
      `(${((100 * avg(reconHand)) / Math.max(0.01, avg(trueHand))).toFixed(0)}% of the real hand)`,
  );

  console.log(`\n  the reducer gap, by reason:`);
  for (const [k, v] of Array.from(missBy).sort((a, b) => b[1] - a[1])) {
    console.log(
      `    ${k.padEnd(22)}${String(v).padStart(4)}  ` +
        `${((100 * v) / Math.max(1, reducerGap)).toFixed(1)}% of the gap`,
    );
  }

  table(
    `THE WORK QUEUE — what to fix, most expensive first (count, share of gap, reason, card)`,
    unmatchedCards,
    reducerGap,
    TOP,
  );
  table(`BY ACTION TYPE`, unmatchedBy, reducerGap, 12);

  console.log(`\n  what the human actually did, by move kind:`);
  for (const [k, v] of Array.from(truthKinds).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(18)}${String(v).padStart(4)}`);
  }
  // Exit 0 regardless. A coverage number is a result, not a pass/fail.
}

main();
