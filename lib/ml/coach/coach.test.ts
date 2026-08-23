// Coach v1 heuristics: rule-trigger units over synthetic rows + an
// end-to-end report over the committed golden log.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { extractBattleFeatures, turnQualityFlags } from "@/lib/ml/features";
import type { BattleLogFeatures } from "@/lib/ml/features";
import { buildCoachReport } from "./heuristics";
import type { FlaggedTurn } from "./heuristics";

/* ─── Factories ─────────────────────────────────────────────────── */

function turn(overrides: Partial<FlaggedTurn> = {}): FlaggedTurn {
  return {
    turn_number: 1,
    player_turn_number: 1,
    actor: "player",
    attacked: 1,
    attack_damage: 100,
    energy_attached: 1,
    supporter_played: 1,
    items_played: 0,
    tools_played: 0,
    stadium_played: 0,
    evolutions: 0,
    retreats: 0,
    retreat_energy_discarded: 0,
    abilities_used: 0,
    kos_scored: 0,
    prizes_taken: 0,
    prizes_player: 0,
    prizes_opponent: 0,
    prize_diff: 0,
    bench_player: 2,
    bench_opponent: 2,
    hand_player: 5,
    hand_player_known: 0,
    hand_opponent: 5,
    bench_delta: 0,
    flag_missed_energy_attach: 0,
    flag_no_supporter: 0,
    flag_over_retreat: 0,
    flag_passive_turn: 0,
    flag_missed_evolution: 0,
    ...overrides,
  };
}

function battle(overrides: Partial<BattleLogFeatures> = {}): BattleLogFeatures {
  return {
    went_first: 1,
    player_mulligans: 0,
    opponent_mulligans: 0,
    total_turns: 10,
    player_turns: 5,
    opponent_turns: 5,
    first_attack_turn_player: 3,
    first_attack_turn_opponent: 2,
    first_prize_turn_player: 5,
    first_prize_turn_opponent: 4,
    prizes_player: 3,
    prizes_opponent: 6,
    prize_diff: -3,
    kos_by_player: 2,
    kos_by_opponent: 3,
    retreats_player: 1,
    retreats_opponent: 1,
    retreat_energy_discarded_player: 1,
    retreat_energy_discarded_opponent: 1,
    energy_attached_player: 5,
    energy_attached_opponent: 5,
    supporters_player: 4,
    supporters_opponent: 4,
    turns_no_energy_player: 0,
    turns_no_supporter_player: 1,
    stranded_energy_final_player: 0,
    stranded_energy_final_opponent: 0,
    avg_prize_diff: -1,
    max_prize_lead: 0,
    max_prize_deficit: -3,
    avg_bench_player: 2,
    avg_bench_opponent: 2,
    end_reason: "prizes",
    engine_error_count: 0,
    engine_warn_count: 0,
    unmatched_line_count: 0,
    ...overrides,
  };
}

const codes = (m: BattleLogFeatures, ts: FlaggedTurn[]) =>
  buildCoachReport(m, ts).insights.map((i) => i.code);

/* ─── Rule triggers ─────────────────────────────────────────────── */

describe("buildCoachReport rules", () => {
  it("escalates repeated missed energy to a warning", () => {
    const ts = [
      turn({ turn_number: 1, flag_missed_energy_attach: 1, energy_attached: 0 }),
      turn({ turn_number: 3, flag_missed_energy_attach: 1, energy_attached: 0 }),
      turn({ turn_number: 5 }),
    ];
    const report = buildCoachReport(battle(), ts);
    const insight = report.insights.find((i) => i.code === "missed_energy");
    expect(insight?.severity).toBe("warning");
    expect(insight?.detail).toContain("1, 3");
    expect(report.summary.turns_missed_energy).toBe(2);
  });

  it("ignores opponent turns for player-side rules", () => {
    const ts = [
      turn({ actor: "opponent", flag_missed_energy_attach: 1, flag_passive_turn: 1 }),
    ];
    expect(codes(battle(), ts)).not.toContain("missed_energy");
    expect(codes(battle(), ts)).not.toContain("passive_turns");
  });

  it("flags a supporter drought only with enough turns", () => {
    const drought = [1, 2, 3, 4].map((n) =>
      turn({ turn_number: n, flag_no_supporter: n <= 2 ? 1 : 0 }),
    );
    expect(codes(battle(), drought)).toContain("supporter_drought");
    // 1 of 2 turns is not enough signal
    const short = [turn({ flag_no_supporter: 1 }), turn({ turn_number: 2 })];
    expect(codes(battle(), short)).not.toContain("supporter_drought");
  });

  it("calls out bad prize trades and multi-prize giveaways", () => {
    const m = battle({ kos_by_opponent: 3, prizes_opponent: 6, kos_by_player: 3, prizes_player: 3 });
    const ts = [turn({ actor: "opponent", turn_number: 6, prizes_taken: 2 })];
    const report = buildCoachReport(m, ts);
    expect(report.insights.map((i) => i.code)).toContain("prize_trade");
    const giveaway = report.insights.find((i) => i.code === "multi_prize_ko");
    expect(giveaway?.turn_number).toBe(6);
  });

  it("does not flag prize trades when the player trades evenly", () => {
    const m = battle({ kos_by_opponent: 6, prizes_opponent: 6, kos_by_player: 5, prizes_player: 5 });
    expect(codes(m, [])).not.toContain("prize_trade");
  });

  it("flags slow starts, stranded energy, mulligans and comebacks", () => {
    const m = battle({
      first_attack_turn_player: 7,
      first_attack_turn_opponent: 2,
      stranded_energy_final_player: 4,
      player_mulligans: 2,
      max_prize_deficit: -4,
      prizes_player: 6,
      prizes_opponent: 4,
    });
    const got = codes(m, []);
    expect(got).toEqual(expect.arrayContaining(["slow_start", "stranded_energy", "mulligans", "comeback"]));
  });

  it("sorts warnings before suggestions before info", () => {
    const m = battle({ player_mulligans: 2, stranded_energy_final_player: 3 });
    const ts = [
      turn({ turn_number: 2, flag_passive_turn: 1 }),
      turn({ turn_number: 4, flag_over_retreat: 1, retreat_energy_discarded: 2 }),
    ];
    const severities = buildCoachReport(m, ts).insights.map((i) => i.severity);
    const order = { warning: 0, suggestion: 1, info: 2 } as const;
    for (let i = 1; i < severities.length; i++) {
      expect(order[severities[i]]).toBeGreaterThanOrEqual(order[severities[i - 1]]);
    }
  });
});

/* ─── End to end over the golden log ────────────────────────────── */

describe("buildCoachReport (example-1)", () => {
  const raw = readFileSync(
    join(__dirname, "..", "..", "battle-log", "fixtures", "example-1.txt"),
    "utf8",
  );
  const parsed = normalizePerspective(parseBattleLog(raw), "MoonSheikah");
  const { battle: m, turns } = extractBattleFeatures(parsed, replay(parsed));
  const flagged = turns.map((t) => ({ ...t.features, ...turnQualityFlags(t.features, t.endState) }));
  const report = buildCoachReport(m, flagged);

  it("produces a deterministic, well-formed report", () => {
    expect(buildCoachReport(m, flagged)).toEqual(report);
    const validTurns = new Set(flagged.map((t) => t.turn_number));
    for (const insight of report.insights) {
      expect(["warning", "suggestion", "info"]).toContain(insight.severity);
      expect(insight.title.length).toBeGreaterThan(0);
      expect(insight.detail.length).toBeGreaterThan(0);
      if (insight.turn_number !== null) expect(validTurns.has(insight.turn_number)).toBe(true);
    }
  });

  it("summary matches the flag counts", () => {
    const playerTurns = flagged.filter((t) => t.actor === "player");
    expect(report.summary.player_turns).toBe(playerTurns.length);
    expect(report.summary.turns_missed_energy).toBe(
      playerTurns.filter((t) => t.flag_missed_energy_attach).length,
    );
    expect(report.summary.prizes_player).toBe(2);
    expect(report.summary.prizes_opponent).toBe(6);
  });
});
