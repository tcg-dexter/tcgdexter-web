// RankerPolicy — the learned next-action policy behind the DecisionPolicy
// seam. Encodes the PlayerView once per decision, encodes every legal move,
// scores all candidates with the policy-ranker artifact, and plays the
// argmax (deterministic default) or samples the softmax at a temperature.
//
// Lives in lib/ml (which already depends on lib/engine) so the sim layer
// stays ML-free — same layering as botEvaluator.ts.

import {
  mulberry32,
  promoteBest,
  type DecisionPolicy,
  type PlayerView,
  type SimMove,
  type TurnContext,
} from "@/lib/engine/sim";
import { encodeActionFeatures, encodeStateFeatures } from "./features/policy";
import { scoreCandidates, softmax, type PolicyRankerArtifact } from "./policyModel";

export interface RankerPolicyOptions {
  /** Softmax sampling temperature. 0 / omitted = deterministic argmax. */
  temperature?: number;
  /** Seed for the sampling stream (only used when temperature > 0). */
  seed?: number;
}

export class RankerPolicy implements DecisionPolicy {
  private readonly temperature: number;
  private readonly rng: () => number;

  constructor(
    private readonly artifact: PolicyRankerArtifact,
    options: RankerPolicyOptions = {},
  ) {
    this.temperature = options.temperature ?? 0;
    this.rng = mulberry32(options.seed ?? 1);
  }

  chooseMove(view: PlayerView, legal: SimMove[], _ctx: TurnContext): SimMove {
    if (legal.length === 0) return { kind: "pass" }; // driver guarantee; belt-and-braces
    if (legal.length === 1) return legal[0];

    const state = encodeStateFeatures(view);
    const { scores } = scoreCandidates(
      this.artifact,
      state,
      legal.map((move) => encodeActionFeatures(view, move)),
    );

    if (this.temperature > 0) {
      const probs = softmax(scores, this.temperature);
      let r = this.rng();
      for (let i = 0; i < probs.length; i++) {
        r -= probs[i];
        if (r <= 0) return legal[i];
      }
      return legal[legal.length - 1]; // float underflow tail
    }

    // Argmax; first-best wins ties so the pick is deterministic.
    let best = 0;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] > scores[best]) best = i;
    }
    return legal[best];
  }

  choosePromotion(view: PlayerView): number {
    // Promotions aren't in the training data yet (see lib/ml/selfplay.ts);
    // reuse the shared heuristic until the policy learns them.
    return promoteBest(view.board.bench);
  }
}
