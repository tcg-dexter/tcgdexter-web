// Calibration sanity for the review value-curve on REAL battle logs.
//
// The value model has only ever seen self-play sim states; this script is
// the honesty check before its curve is shown to users: over a set of real
// imported logs with known results, the FINAL-turn p_win should mostly land
// on the correct side of 50%, and wins should average higher than losses.
// This is a direction check, not a calibration fit — grossly mis-signed
// output means the sim→real distribution shift is fatal and the UI should
// stay admin-only until a log-compatible retrain.
//
// Input: a JSON file of [{ id, result, player_handle, battle_log_raw,
// deck_list }] — typically a read-only export of a few matches rows.
//
// Usage: npx tsx scripts/ml/log_calibration.ts <matches.json>

import { readFileSync } from "node:fs";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { replayTurnViews } from "@/lib/ml/features/replayView";
import { cachedValueArtifact, valueCurve } from "@/lib/ml/valueCurve";

interface MatchInput {
  id: string;
  result: string | null;
  player_handle: string | null;
  battle_log_raw: string | null;
  deck_list: string | null;
}

function main(): void {
  const file = process.argv[2];
  if (!file) throw new Error("usage: log_calibration.ts <matches.json>");
  const matches = JSON.parse(readFileSync(file, "utf8")) as MatchInput[];
  const artifact = cachedValueArtifact();
  if (!artifact) throw new Error("no value artifact available");
  console.log(`[calib] model=${artifact.model_version} matches=${matches.length}`);

  const winPs: number[] = [];
  const lossPs: number[] = [];
  let correct = 0;
  let scored = 0;

  for (const m of matches) {
    if (!m.battle_log_raw || !m.player_handle || (m.result !== "win" && m.result !== "loss")) {
      console.log(`  ${m.id.slice(0, 8)}  SKIP (no log/handle or drawn)`);
      continue;
    }
    try {
      const normalized = normalizePerspective(parseBattleLog(m.battle_log_raw), m.player_handle);
      const replayResult = replay(normalized);
      const { views, cardCoverage } = replayTurnViews(normalized, replayResult, m.deck_list);
      const curve = valueCurve(artifact, views);
      if (curve.length === 0) {
        console.log(`  ${m.id.slice(0, 8)}  SKIP (empty curve)`);
        continue;
      }
      const final = curve[curve.length - 1].p_win;
      const won = m.result === "win";
      (won ? winPs : lossPs).push(final);
      const right = won === final > 0.5;
      correct += right ? 1 : 0;
      scored += 1;
      console.log(
        `  ${m.id.slice(0, 8)}  ${m.result!.padEnd(4)}  final p_win=${(100 * final).toFixed(0).padStart(3)}%  ` +
          `${right ? "OK " : "MISS"}  coverage=${(100 * cardCoverage).toFixed(0)}%  turns=${curve.length}`,
      );
    } catch (e) {
      console.log(`  ${m.id.slice(0, 8)}  ERROR ${e instanceof Error ? e.message : e}`);
    }
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
  console.log("");
  console.log(`[calib] direction accuracy: ${correct}/${scored}`);
  console.log(
    `[calib] mean final p_win — wins: ${(100 * mean(winPs)).toFixed(0)}% (n=${winPs.length}), ` +
      `losses: ${(100 * mean(lossPs)).toFixed(0)}% (n=${lossPs.length})`,
  );
  console.log(
    mean(winPs) > mean(lossPs)
      ? "[calib] SANE: wins score higher than losses."
      : "[calib] NOT SANE: keep the UI admin-only and revisit with a log-trained model.",
  );
}

main();
