// Win-prob scorer math + the cross-language feature-vector contract.
// (Artifact loading is exercised end-to-end once training publishes;
// registry-gated readWinProbArtifact simply returns null before that.)

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { archetypePrior, scoreFeatures, turnFeatureVector, winProbCurve } from "./winprob";
import type { WinProbArtifact } from "./winprob";
import type { TurnFeatures } from "./features";

const artifact: WinProbArtifact = {
  model_type: "logistic_regression",
  model_version: "winprob-test",
  trained_at: "2026-07-11T00:00:00Z",
  feature_schema_version: 1,
  n_samples: 10,
  n_matches: 5,
  data_hash: "test",
  features: ["prize_diff", "went_first"],
  means: [0, 0.5],
  stds: [2, 0.5],
  coefficients: [1, 0.5],
  intercept: 0,
  l2_lambda: 1,
  archetype_priors: { "Charizard ex": 0.7 },
  global_prior: 0.6,
  metrics: {},
  validation_examples: [],
};

function turnRow(overrides: Partial<TurnFeatures> = {}): TurnFeatures {
  return {
    turn_number: 4,
    player_turn_number: 2,
    actor: "player",
    attacked: 1,
    attack_damage: 90,
    energy_attached: 1,
    supporter_played: 1,
    items_played: 1,
    tools_played: 0,
    stadium_played: 0,
    evolutions: 1,
    retreats: 0,
    retreat_energy_discarded: 0,
    abilities_used: 0,
    kos_scored: 1,
    prizes_taken: 1,
    prizes_player: 2,
    prizes_opponent: 1,
    prize_diff: 1,
    bench_player: 3,
    bench_opponent: 2,
    hand_player: 5,
    hand_player_known: 2,
    hand_opponent: 6,
    bench_delta: 1,
    ...overrides,
  };
}

describe("scoreFeatures", () => {
  it("computes the standardized logistic score", () => {
    // z = 1 * (2 - 0)/2 + 0.5 * (1 - 0.5)/0.5 = 1 + 0.5 = 1.5
    const p = scoreFeatures(artifact, { prize_diff: 2, went_first: 1 });
    expect(p).toBeCloseTo(1 / (1 + Math.exp(-1.5)), 10);
  });

  it("imputes missing/non-finite features at the training mean", () => {
    // Missing prize_diff → mean (0) → contributes 0; went_first NaN → mean.
    const p = scoreFeatures(artifact, { went_first: NaN } as Record<string, number>);
    expect(p).toBeCloseTo(0.5, 10);
  });

  it("is monotone in a positive-coefficient feature", () => {
    const low = scoreFeatures(artifact, { prize_diff: -4, went_first: 0 });
    const high = scoreFeatures(artifact, { prize_diff: 4, went_first: 0 });
    expect(high).toBeGreaterThan(low);
  });
});

describe("turnFeatureVector (cross-language contract)", () => {
  it("produces exactly the named features the trainer standardizes", () => {
    const vec = turnFeatureVector({ went_first: 1, archetype_name: null }, turnRow(), 0.6);
    expect(Object.keys(vec).sort()).toEqual([
      "archetype_prior",
      "bench_diff",
      "hand_diff",
      "is_player_turn",
      "prize_diff",
      "prizes_total",
      "turn_number",
      "went_first",
    ]);
    expect(vec.prize_diff).toBe(1);
    expect(vec.prizes_total).toBe(3);
    expect(vec.bench_diff).toBe(1);
    expect(vec.hand_diff).toBe(-1);
    expect(vec.is_player_turn).toBe(1);
    expect(vec.archetype_prior).toBe(0.6);
  });

  it("encodes unknown went_first as 0.5", () => {
    expect(
      turnFeatureVector({ went_first: null, archetype_name: null }, turnRow(), 0.5).went_first,
    ).toBe(0.5);
  });

  it("looks up archetype priors with a global fallback", () => {
    expect(archetypePrior(artifact, "Charizard ex")).toBe(0.7);
    expect(archetypePrior(artifact, "Unheard-of Deck")).toBe(0.6);
    expect(archetypePrior(artifact, null)).toBe(0.6);
  });
});

/* ─── Published-artifact contract (skips until training publishes) ── */

const PUBLISHED = path.join(process.cwd(), "data", "ml", "winprob.json");

describe.skipIf(!existsSync(PUBLISHED))("published winprob.json", () => {
  it("reproduces the trainer's embedded validation examples", () => {
    const real = JSON.parse(readFileSync(PUBLISHED, "utf8")) as WinProbArtifact;
    expect(real.validation_examples.length).toBeGreaterThan(0);
    expect(real.features.length).toBe(real.coefficients.length);
    for (const example of real.validation_examples) {
      const p = scoreFeatures(real, example.features);
      expect(p).toBeCloseTo(example.expected_p, 8);
    }
  });
});

describe("winProbCurve", () => {
  it("maps every turn to a probability in (0, 1)", () => {
    const turns = [turnRow({ turn_number: 1, prize_diff: 0 }), turnRow({ turn_number: 2, prize_diff: -3, actor: "opponent" })];
    const curve = winProbCurve(artifact, { went_first: 0, archetype_name: null }, turns);
    expect(curve).toHaveLength(2);
    expect(curve[0].turn_number).toBe(1);
    expect(curve[1].actor).toBe("opponent");
    for (const point of curve) {
      expect(point.p_win).toBeGreaterThan(0);
      expect(point.p_win).toBeLessThan(1);
    }
    // Falling behind on prizes lowers the estimate.
    expect(curve[1].p_win).toBeLessThan(curve[0].p_win);
  });
});
