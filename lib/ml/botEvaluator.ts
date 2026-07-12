// Wires the trained win-prob artifact into the AI player's turn planner.
// Lives in lib/ml (which already depends on lib/engine) so the sim layer
// stays ML-free; callers inject the evaluator into PlannerPolicy.

import type { PlanSnapshot, StateEvaluator } from "@/lib/engine/sim";
import { readWinProbArtifact, scoreFeatures } from "./winprob";

/**
 * StateEvaluator backed by the live winprob artifact, or null when no
 * model is promoted in the registry (callers fall back to the planner's
 * built-in heuristic evaluator). The bot's judgment therefore improves
 * automatically as the weekly training loop promotes better models.
 */
export function createBotEvaluator(): StateEvaluator | null {
  const artifact = readWinProbArtifact();
  if (!artifact) return null;
  const prior = artifact.global_prior;
  return (snapshot: PlanSnapshot) =>
    scoreFeatures(artifact, {
      prize_diff: snapshot.prize_diff,
      prizes_total: snapshot.prizes_total,
      turn_number: snapshot.turn_number,
      bench_diff: snapshot.bench_diff,
      hand_diff: snapshot.hand_diff,
      went_first: snapshot.went_first,
      is_player_turn: snapshot.is_player_turn,
      archetype_prior: prior,
    });
}
