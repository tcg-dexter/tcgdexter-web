// Golden round-trip harness for the dexter-ml export job (Phase 0 acceptance).
// dexter-ml exports a golden match (battle_log_raw + the summary columns the
// import flow stored on `matches`, read back from feature_store.sqlite) to a
// JSON file and invokes this test with ML_GOLDEN_JSON pointing at it. The
// test re-parses the exported log and asserts the summary is identical —
// proving export → parse round-trips losslessly.
//
// Self-skips when ML_GOLDEN_JSON is unset so plain `npm test` stays green.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseBattleLog } from "./parse";
import { normalizePerspective } from "./normalize";
import { summarize } from "./summarize";

interface GoldenFile {
  match_id: string;
  battle_log_raw: string;
  player_handle: string | null;
  stored_result: string | null;
  expected: {
    went_first: boolean | null;
    player_mulligans: number;
    opponent_mulligans: number;
    total_turns: number;
    prizes_taken_player: number;
    prizes_taken_opponent: number;
    end_reason: string | null;
  };
}

const goldenPath = process.env.ML_GOLDEN_JSON;

describe.skipIf(!goldenPath)("ml golden match round-trip", () => {
  it("re-parse of exported battle_log_raw matches the stored summary", () => {
    const golden: GoldenFile = JSON.parse(readFileSync(goldenPath!, "utf8"));
    expect(golden.battle_log_raw).toBeTruthy();
    expect(golden.player_handle).toBeTruthy();

    const parsed = parseBattleLog(golden.battle_log_raw);
    const normalized = normalizePerspective(parsed, golden.player_handle!);
    const summary = summarize(normalized);

    expect(summary.went_first).toBe(golden.expected.went_first);
    expect(summary.player_mulligans).toBe(golden.expected.player_mulligans);
    expect(summary.opponent_mulligans).toBe(golden.expected.opponent_mulligans);
    expect(summary.total_turns).toBe(golden.expected.total_turns);
    expect(summary.prizes_taken_player).toBe(golden.expected.prizes_taken_player);
    expect(summary.prizes_taken_opponent).toBe(golden.expected.prizes_taken_opponent);
    expect(summary.end_reason).toBe(golden.expected.end_reason);

    // matches.result can legitimately diverge (BO3 game results, manual
    // edits), so it's informational only.
    if (golden.stored_result && summary.result !== golden.stored_result) {
      console.warn(
        `[golden] stored result "${golden.stored_result}" differs from re-parsed "${summary.result}" for match ${golden.match_id} (warn-only)`,
      );
    }
  });
});
