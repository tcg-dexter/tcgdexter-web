// Difficulty — a continuous skill dial mapped onto the planner's selection
// parameters (chess.com model: one engine, strength = how faithfully it
// picks the best-scored plan). Presets are just named points on the dial.

import type { PlannerParams } from "./planner";

export type Difficulty = "easy" | "medium" | "hard";

/** Named skill points. The dial is continuous — UIs can expose any 0..1. */
export const DIFFICULTY_SKILL: Record<Difficulty, number> = {
  easy: 0.15,
  medium: 0.55,
  hard: 0.95,
};

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * skill 0 → sloppy: hot softmax (τ ≈ 0.57) barely favors good plans, 45%
 * outright blunders. skill 1 → τ 0.02 ≈ argmax, no blunders. The quadratic
 * keeps mid-skill meaningfully competent: score gaps between "attack" and
 * "pass" are ~0.03–0.1, so τ must sit well below that at the top end.
 */
export function plannerParamsForSkill(skill: number): PlannerParams {
  const s = clamp01(skill);
  return {
    temperature: 0.015 + 0.35 * Math.pow(1 - s, 2.5),
    epsilon: 0.45 * Math.pow(1 - s, 1.5),
    maxCandidates: 256,
  };
}

export function plannerParamsFor(difficulty: Difficulty): PlannerParams {
  return plannerParamsForSkill(DIFFICULTY_SKILL[difficulty]);
}
