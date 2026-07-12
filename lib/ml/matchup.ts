// Statistical archetype-matchup prior — the simulator's instant fast path.
// Combines the two archetypes' historical winrates (from the win-prob
// artifact's shrunk priors) with the Bradley–Terry rule:
//
//   P(A beats B) = pA(1−pB) / (pA(1−pB) + pB(1−pA))
//
// Cheap, explainable, and available before any rollout finishes. Null when
// no model artifact is live.

import { archetypePrior, readWinProbArtifact } from "./winprob";

export interface MatchupPrior {
  p_a_wins: number;
  prior_a: number;
  prior_b: number;
  model_version: string;
  archetype_a: string | null;
  archetype_b: string | null;
}

export function matchupPrior(
  archetypeA: string | null,
  archetypeB: string | null,
): MatchupPrior | null {
  const artifact = readWinProbArtifact();
  if (!artifact) return null;
  const pA = archetypePrior(artifact, archetypeA);
  const pB = archetypePrior(artifact, archetypeB);
  const numerator = pA * (1 - pB);
  const denominator = numerator + pB * (1 - pA);
  return {
    p_a_wins: denominator > 0 ? numerator / denominator : 0.5,
    prior_a: pA,
    prior_b: pB,
    model_version: artifact.model_version,
    archetype_a: archetypeA,
    archetype_b: archetypeB,
  };
}
