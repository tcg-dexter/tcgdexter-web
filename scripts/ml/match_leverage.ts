// How much does a MATCH label actually differ from a GAME label?
//
// This is a pre-registration step, not an analysis. The route-label A/B came
// back null and the post-mortem showed why: only 10.1% of the new labels
// differed from the old ones, so the experiment never had the leverage to
// move a 2-point effect. Measuring the disagreement rate BEFORE spending
// hours of training is cheap, and it turns "the idea didn't work" into
// "the instrument was too weak", which are different findings with different
// next steps.
//
// The quantity that matters is the fraction of decisions whose label FLIPS:
// a decision in a game the pilot lost, inside a match it won (or vice versa).
// Those are exactly the rows where the two arms disagree, and nothing else in
// the corpus can produce a difference between them.
//
// Usage:
//   npx tsx scripts/ml/match_leverage.ts --runs HASH [--db PATH]

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { defaultCorpusPath } from "@/lib/ml/corpusStore";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB = arg("--db") ?? defaultCorpusPath(REPO_ROOT);
const RUNS = (arg("--runs") ?? "").split(",").map((r) => r.trim()).filter(Boolean);
if (RUNS.length === 0) throw new Error("[match_leverage] --runs is required");

function main(): void {
  const db = new DatabaseSync(DB, { readOnly: true });
  const all = (db.prepare("SELECT run_hash FROM policy_runs").all() as { run_hash: string }[]).map(
    (r) => r.run_hash,
  );
  const hashes = RUNS.map((r) => {
    const hit = all.find((h) => h === r || h.startsWith(r));
    if (!hit) throw new Error(`[match_leverage] run not found: ${r}`);
    return hit;
  });
  const ph = hashes.map(() => "?").join(",");

  const games = db
    .prepare(
      `SELECT match_index, game_in_match, winner, match_winner, decisions
         FROM policy_games
        WHERE run_hash IN (${ph}) AND match_index IS NOT NULL`,
    )
    .all(...hashes) as {
    match_index: number;
    game_in_match: number;
    winner: string | null;
    match_winner: string | null;
    decisions: number;
  }[];

  if (games.length === 0) {
    console.log("[match_leverage] no match-mode games in those runs — was the corpus built with --best-of?");
    db.close();
    return;
  }

  const matches = new Set(games.map((g) => g.match_index)).size;
  const perGame = games.length / matches;
  const deciders = games.filter((g) => g.game_in_match === 2).length;

  // A decision's label flips when the game result and the match result
  // disagree from the ACTING side's view. Both seats sit in every game, so a
  // game whose winner differs from the match winner flips the label for the
  // decisions of BOTH sides — one from win to loss, one from loss to win.
  let flippedDecisions = 0;
  let totalDecisions = 0;
  let flippedGames = 0;
  let drawnMatchDecisions = 0;
  for (const g of games) {
    totalDecisions += g.decisions;
    if (g.match_winner === null) {
      drawnMatchDecisions += g.decisions; // dropped by --match-outcome
      continue;
    }
    if (g.winner === null) continue; // a drawn game inside a decided match
    if (g.winner !== g.match_winner) {
      flippedGames += 1;
      flippedDecisions += g.decisions;
    }
  }

  const pct = (a: number, b: number) => `${((100 * a) / (b || 1)).toFixed(1)}%`;
  console.log(`[match_leverage] ${matches.toLocaleString()} matches, ${games.length.toLocaleString()} games`);
  console.log(`  games per match       : ${perGame.toFixed(2)}`);
  console.log(`  went to a decider     : ${deciders.toLocaleString()} (${pct(deciders, matches)})`);
  console.log(`  games on the losing side of a won match: ${flippedGames.toLocaleString()} (${pct(flippedGames, games.length)})`);
  console.log(`  decisions whose label FLIPS: ${flippedDecisions.toLocaleString()} of ${totalDecisions.toLocaleString()} (${pct(flippedDecisions, totalDecisions)})`);
  console.log(`  decisions dropped (drawn match): ${drawnMatchDecisions.toLocaleString()}`);
  console.log(
    `\n  Read it against the route-label A/B, where 10.1% of labels differed\n` +
      `  and the duel came back 50.17%. A materially larger flip rate is a\n` +
      `  reason to expect leverage; a similar one is a reason to expect another\n` +
      `  null and to say so before training rather than after.`,
  );
  db.close();
}

main();
