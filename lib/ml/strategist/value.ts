// One number, one meaning: P(this actor wins) in [0, 1].
//
// Everything in the strategist is quoted in this unit, because it is the unit
// a coaching sentence needs ("that play cost you 8 points of win probability")
// and the unit a training label needs. The planner's own leaf score is NOT
// this — it mixes an evaluator probability with hand-tuned tactical bonuses
// and ±10 terminal sentinels, so it is an ordering, not a probability. Mixing
// the two would produce regrets in nonsense units.

import { viewFor, type PlanSnapshot, type StateEvaluator } from "@/lib/engine/sim";
import type { GameOutcome } from "@/lib/engine/sim";
import type { GameState } from "@/lib/engine/types";

export type Actor = "player" | "opponent";

export function other(actor: Actor): Actor {
  return actor === "player" ? "opponent" : "player";
}

/** Snapshot from `actor`'s perspective. Mirrors PlannerPolicy.leafScore's
 *  construction field for field; the planner can only build it for a ghost
 *  that seats the acting side at `sides.player`, and a real game state has
 *  the actor on either side. */
export function snapshotFor(state: GameState, actor: Actor): PlanSnapshot {
  const self = state.sides[actor];
  const opp = state.sides[other(actor)];
  const wentFirst = viewFor(state, actor).wentFirst;
  return {
    prize_diff: state.prizesTaken[actor] - state.prizesTaken[other(actor)],
    prizes_total: state.prizesTaken.player + state.prizesTaken.opponent,
    turn_number: state.turn.number,
    bench_diff: self.bench.length - opp.bench.length,
    hand_diff: self.hand.length - opp.hand.length,
    went_first: wentFirst === null ? 0.5 : wentFirst ? 1 : 0,
    is_player_turn: state.turn.actor === actor ? 1 : 0,
  };
}

/** Terminal value of a finished game for `actor`. A draw is 0.5, not a loss:
 *  turn-cap games with equal prizes are genuinely undecided, and scoring them
 *  as losses would make every slow line look like a blunder. */
export function outcomeValue(outcome: GameOutcome, actor: Actor): number {
  if (outcome.winner === null) return 0.5;
  return outcome.winner === actor ? 1 : 0;
}

/** Static value of a live state for `actor`. */
export function stateValue(
  state: GameState,
  actor: Actor,
  evaluate: StateEvaluator,
): number {
  if (state.winner !== null) return state.winner === actor ? 1 : 0;
  return clampProb(evaluate(snapshotFor(state, actor), viewFor(state, actor)));
}

/** Keep values off the 0/1 rails so a regret can never be reported as a
 *  certainty the evaluator does not have. */
export function clampProb(p: number): number {
  if (!Number.isFinite(p)) return 0.5;
  return Math.min(0.995, Math.max(0.005, p));
}
