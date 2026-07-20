// Cross-language contract for the board-aware value model.
//
// The Python trainer (dexter-ml/scripts/ml_train_value.py) and this repo's
// scorer must agree exactly. The artifact embeds validation examples
// (feature map + expected probability) computed on the Python side; these
// tests reproduce them through the TypeScript path. A mismatch means the
// standardization/feature-order contract drifted and the bot is being
// steered by a model it is mis-evaluating.
//
// The artifact-dependent block is skipped when data/ml/value.json is absent
// (same idiom as policyModel.test.ts) so a fresh clone still runs green.

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import { scoreFeatures } from "./winprob";
import { createBoardEvaluator, readValueArtifact } from "./botEvaluator";
import { STATE_FEATURE_NAMES, encodeStateFeatures } from "./features/policy";
import { instantiateDeck, viewFor } from "@/lib/engine/sim";
import { buildSimInitialState } from "@/lib/engine/sim/setup";
import { mulberry32 } from "@/lib/engine/sim/rng";

const ARTIFACT = path.join(process.cwd(), "data", "ml", "value.json");

const DECK = [
  "Pokémon: 12",
  "4 Miraidon ex SVI 81",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 24",
  "24 Basic Lightning Energy SVE 4",
].join("\n");

describe.skipIf(!existsSync(ARTIFACT))("value model contract", () => {
  const artifact = readValueArtifact(ARTIFACT)!;

  it("loads with aligned coefficient/feature arrays", () => {
    expect(artifact).not.toBeNull();
    expect(artifact.model_type).toBe("logistic_regression");
    expect(artifact.features.length).toBe(artifact.coefficients.length);
    expect(artifact.features.length).toBe(artifact.means.length);
    expect(artifact.features.length).toBe(artifact.stds.length);
  });

  it("names only features the state encoder actually produces", () => {
    const known = new Set(STATE_FEATURE_NAMES);
    for (const name of artifact.features) expect(known.has(name)).toBe(true);
  });

  it("reproduces the trainer's embedded validation examples to 8 dp", () => {
    expect(artifact.validation_examples.length).toBeGreaterThan(0);
    for (const ex of artifact.validation_examples) {
      expect(scoreFeatures(artifact, ex.features)).toBeCloseTo(ex.expected_p, 8);
    }
  });

  it("the fast evaluator path matches the generic scorer on a real view", () => {
    // createBoardEvaluator scores straight off the encoded array for speed;
    // that shortcut must stay numerically identical to scoreFeatures.
    const deck = instantiateDeck(DECK);
    const state = buildSimInitialState(deck, deck, mulberry32(11), "player");
    const view = viewFor(state, "player", { retreated: false });
    const evaluate = createBoardEvaluator(ARTIFACT)!;

    const nameIndex = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i]));
    const vec = encodeStateFeatures(view);
    const asRecord: Record<string, number> = {};
    for (const name of artifact.features) {
      asRecord[name] = vec[nameIndex.get(name)!];
    }

    const snapshot = {
      prize_diff: 0, prizes_total: 0, turn_number: 1,
      bench_diff: 0, hand_diff: 0, went_first: 1, is_player_turn: 1,
    };
    expect(evaluate(snapshot, view)).toBeCloseTo(scoreFeatures(artifact, asRecord), 8);
  });

  it("returns a probability in (0, 1)", () => {
    const deck = instantiateDeck(DECK);
    const state = buildSimInitialState(deck, deck, mulberry32(3), "player");
    const view = viewFor(state, "player", { retreated: false });
    const evaluate = createBoardEvaluator(ARTIFACT)!;
    const p = evaluate(
      { prize_diff: 0, prizes_total: 0, turn_number: 1, bench_diff: 0,
        hand_diff: 0, went_first: 1, is_player_turn: 1 },
      view,
    );
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });
});
