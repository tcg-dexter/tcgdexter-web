// Phase 1 acceptance: feature extraction over the committed golden logs.
// Covers schema stability (key sets are part of the contract — changing
// them requires a FEATURE_SCHEMA_VERSION bump), NaN guards, determinism,
// and internal consistency against summarize().

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog, summarize } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import {
  extractDeckFeatures,
  extractBattleFeatures,
  deriveBattleLabels,
  turnQualityFlags,
  findInvalidValues,
} from "./index";
import type { BattleExtraction } from "./index";

const FIXTURES = join(__dirname, "..", "..", "battle-log", "fixtures");

function extractFixture(file: string, playerHandle: string): BattleExtraction {
  const raw = readFileSync(join(FIXTURES, file), "utf8");
  const parsed = normalizePerspective(parseBattleLog(raw), playerHandle);
  return extractBattleFeatures(parsed, replay(parsed));
}

const BATTLE_FEATURE_KEYS = [
  "avg_bench_opponent",
  "avg_bench_player",
  "avg_prize_diff",
  "end_reason",
  "energy_attached_opponent",
  "energy_attached_player",
  "engine_error_count",
  "engine_warn_count",
  "first_attack_turn_opponent",
  "first_attack_turn_player",
  "first_prize_turn_opponent",
  "first_prize_turn_player",
  "kos_by_opponent",
  "kos_by_player",
  "max_prize_deficit",
  "max_prize_lead",
  "opponent_mulligans",
  "opponent_turns",
  "player_mulligans",
  "player_turns",
  "prize_diff",
  "prizes_opponent",
  "prizes_player",
  "retreat_energy_discarded_opponent",
  "retreat_energy_discarded_player",
  "retreats_opponent",
  "retreats_player",
  "stranded_energy_final_opponent",
  "stranded_energy_final_player",
  "supporters_opponent",
  "supporters_player",
  "total_turns",
  "turns_no_energy_player",
  "turns_no_supporter_player",
  "unmatched_line_count",
  "went_first",
];

const TURN_FEATURE_KEYS = [
  "abilities_used",
  "actor",
  "attack_damage",
  "attacked",
  "bench_delta",
  "bench_opponent",
  "bench_player",
  "energy_attached",
  "evolutions",
  "hand_opponent",
  "hand_player",
  "hand_player_known",
  "items_played",
  "kos_scored",
  "player_turn_number",
  "prize_diff",
  "prizes_opponent",
  "prizes_player",
  "prizes_taken",
  "retreat_energy_discarded",
  "retreats",
  "stadium_played",
  "supporter_played",
  "tools_played",
  "turn_number",
];

const FLAG_KEYS = [
  "flag_missed_energy_attach",
  "flag_missed_evolution",
  "flag_no_supporter",
  "flag_over_retreat",
  "flag_passive_turn",
];

describe.each([
  { file: "example-1.txt", player: "MoonSheikah" },
  { file: "example-2-verbose.txt", player: null as string | null },
])("extractBattleFeatures ($file)", ({ file, player }) => {
  const raw = readFileSync(join(FIXTURES, file), "utf8");
  const handle = player ?? parseBattleLog(raw).handles[0];
  const parsed = normalizePerspective(parseBattleLog(raw), handle);
  const summary = summarize(parsed);
  const { battle, turns } = extractBattleFeatures(parsed, replay(parsed));

  it("has the stable v1 schema", () => {
    expect(Object.keys(battle).sort()).toEqual(BATTLE_FEATURE_KEYS);
    for (const t of turns) {
      expect(Object.keys(t.features).sort()).toEqual(TURN_FEATURE_KEYS);
    }
  });

  it("contains no NaN / Infinity / undefined values", () => {
    expect(findInvalidValues({ ...battle })).toEqual([]);
    for (const t of turns) {
      expect(findInvalidValues({ ...t.features })).toEqual([]);
      expect(findInvalidValues({ ...turnQualityFlags(t.features, t.endState) })).toEqual([]);
    }
  });

  it("agrees with summarize() on the shared aggregates", () => {
    expect(battle.total_turns).toBe(summary.total_turns);
    expect(battle.prizes_player).toBe(summary.prizes_taken_player);
    expect(battle.prizes_opponent).toBe(summary.prizes_taken_opponent);
    expect(battle.player_mulligans).toBe(summary.player_mulligans);
    expect(battle.opponent_mulligans).toBe(summary.opponent_mulligans);
    expect(battle.end_reason).toBe(summary.end_reason);
    if (summary.went_first !== null) {
      expect(battle.went_first).toBe(summary.went_first ? 1 : 0);
    }
  });

  it("emits one row per playable turn with consistent prize accounting", () => {
    expect(turns.length).toBe(summary.total_turns);
    expect(battle.player_turns! + battle.opponent_turns!).toBe(summary.total_turns);
    let lastPlayer = 0;
    let lastOpponent = 0;
    for (const { features: t } of turns) {
      expect(t.prize_diff).toBe(t.prizes_player - t.prizes_opponent);
      // Prizes only ever accumulate.
      expect(t.prizes_player).toBeGreaterThanOrEqual(lastPlayer);
      expect(t.prizes_opponent).toBeGreaterThanOrEqual(lastOpponent);
      lastPlayer = t.prizes_player;
      lastOpponent = t.prizes_opponent;
    }
    expect(lastPlayer).toBe(summary.prizes_taken_player);
    expect(lastOpponent).toBe(summary.prizes_taken_opponent);
  });

  it("is deterministic", () => {
    const again = extractFixture(file, handle);
    expect(again.battle).toEqual(battle);
    expect(again.turns.map((t) => t.features)).toEqual(turns.map((t) => t.features));
  });
});

describe("extractBattleFeatures (example-1 specifics)", () => {
  // Known fixture facts (see lib/engine/replay.test.ts): the opponent
  // a11father prizes out 6-2.
  const { battle, turns } = extractFixture("example-1.txt", "MoonSheikah");

  it("captures the 6-2 prize-out against the player", () => {
    expect(battle.prizes_opponent).toBe(6);
    expect(battle.prizes_player).toBe(2);
    expect(battle.prize_diff).toBe(-4);
    expect(battle.end_reason).toBe("prizes");
  });

  it("re-tags supporters out of the parser's generic play_item bucket", () => {
    // parse.ts can't tell supporters from items without a catalog and
    // marks everything play_item; extraction must resolve them. Both
    // sides play supporters in every real game.
    expect(battle.supporters_player!).toBeGreaterThan(0);
    expect(battle.supporters_opponent!).toBeGreaterThan(0);
    // ...and not by double-counting: some plain items must remain.
    const itemTurns = turns.reduce((s, t) => s + t.features.items_played, 0);
    expect(itemTurns).toBeGreaterThan(0);
  });

  it("orders first-blood correctly", () => {
    expect(battle.first_prize_turn_player).not.toBeNull();
    expect(battle.first_prize_turn_opponent).not.toBeNull();
    expect(battle.first_attack_turn_player).not.toBeNull();
    // Nobody attacks before their turn exists.
    expect(battle.first_attack_turn_player!).toBeGreaterThanOrEqual(1);
  });

  it("produces quality flags with the stable key set", () => {
    const flags = turnQualityFlags(turns[0].features, turns[0].endState);
    expect(Object.keys(flags).sort()).toEqual(FLAG_KEYS);
    // missed_evolution is structurally 0 on opponent turns.
    for (const t of turns) {
      const f = turnQualityFlags(t.features, t.endState);
      if (t.features.actor === "opponent") expect(f.flag_missed_evolution).toBe(0);
    }
  });

  it("rejects a snapshot-less replay", () => {
    const raw = readFileSync(join(FIXTURES, "example-1.txt"), "utf8");
    const parsed = normalizePerspective(parseBattleLog(raw), "MoonSheikah");
    const noSnapshots = replay(parsed, { keepSnapshots: false });
    expect(() => extractBattleFeatures(parsed, noSnapshots)).toThrow(/keepSnapshots/);
  });
});

describe("deriveBattleLabels", () => {
  it("prefers the stored result over the log", () => {
    expect(deriveBattleLabels("win", "loss", -2)).toEqual({
      outcome: 1,
      outcome_source: "stored",
      label_prize_diff: -2,
    });
  });

  it("falls back to the log result", () => {
    expect(deriveBattleLabels(null, "loss", -4)).toEqual({
      outcome: 0,
      outcome_source: "log",
      label_prize_diff: -4,
    });
  });

  it("encodes draws as 0.5 and unknowns as null", () => {
    expect(deriveBattleLabels("draw", null, 0).outcome).toBe(0.5);
    expect(deriveBattleLabels(null, null, null)).toEqual({
      outcome: null,
      outcome_source: null,
      label_prize_diff: null,
    });
  });
});

describe("extractDeckFeatures", () => {
  // Real printings from data/cards-standard.json (same cards the reprice
  // tests rely on), so counts resolve against the catalog.
  const deck = [
    "Pokémon: 2",
    "2 Dunsparce JTG 120",
    "Trainer: 4",
    "4 Ultra Ball SVI 196",
    "Energy: 3",
    "3 Basic Psychic Energy SVE 5",
  ].join("\n");
  const features = extractDeckFeatures(deck);

  it("counts sections and sizes from the list", () => {
    expect(features.deck_size).toBe(9);
    expect(features.pokemon_count).toBe(2);
    expect(features.trainer_count).toBe(4);
    expect(features.energy_count).toBe(3);
    expect(
      features.pokemon_ratio + features.trainer_ratio + features.energy_ratio,
    ).toBeCloseTo(1);
  });

  it("contains no NaN / Infinity / undefined values", () => {
    expect(findInvalidValues({ ...features })).toEqual([]);
  });

  it("is deterministic", () => {
    expect(extractDeckFeatures(deck)).toEqual(features);
  });

  it("throws DeckParseError on garbage", () => {
    expect(() => extractDeckFeatures("not a deck list")).toThrow();
  });
});
