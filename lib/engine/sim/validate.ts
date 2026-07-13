// Human move validation. Most moves must match an enumerated legal move
// exactly, but moves that carry a human SELECTION (discard costs, damage-
// counter allocations, ability targets) can't be pre-enumerated in full —
// the legal set holds their "core" shape and the selection is validated
// against constraints here. Keeping this in one place means the API layer
// (which replays untrusted transcripts) has a single trust boundary.

import type { GameState } from "../types";
import { legalMoves, type SimMove, type TurnContext } from "./moves";
import { attackBenchCounterCount, attackBenchDamageTargets } from "./attacks";
import { trainerDiscardCost } from "./trainers";

/** Core (non-selection) fields of a play_trainer move — everything the
 *  enumerator produces. Selection fields (discardCardIds) are excluded so a
 *  human-supplied discard choice still matches its enumerated core. */
function trainerCore(m: Extract<SimMove, { kind: "play_trainer" }>): string {
  const { discardCardIds: _d, ...core } = m;
  return JSON.stringify(core);
}

/** True when `move` is a legal human decision in the current state. */
export function isLegalHumanMove(
  state: GameState,
  actor: "player" | "opponent",
  ctx: TurnContext,
  move: SimMove,
): boolean {
  const legal = legalMoves(state, actor, ctx);

  if (move.kind === "play_trainer") {
    const core = trainerCore(move);
    const match = legal.find(
      (m): m is Extract<SimMove, { kind: "play_trainer" }> =>
        m.kind === "play_trainer" && trainerCore(m) === core,
    );
    if (!match) return false;
    // Validate a supplied discard selection: right count, all in hand, no
    // duplicates, and never the trainer card being played.
    if (move.discardCardIds != null) {
      const side = state.sides[actor];
      const card = side.hand.find((c) => c.id === move.cardId);
      if (!card) return false;
      const need = trainerDiscardCost(card);
      const ids = move.discardCardIds;
      if (ids.length !== need) return false;
      if (new Set(ids).size !== ids.length) return false;
      return ids.every((id) => id !== move.cardId && side.hand.some((c) => c.id === id));
    }
    return true;
  }

  if (move.kind === "attack") {
    const match = legal.find(
      (m): m is Extract<SimMove, { kind: "attack" }> =>
        m.kind === "attack" && m.attackIndex === move.attackIndex,
    );
    if (!match) return false;
    const attacker = state.sides[actor].active;
    if (!attacker) return false;
    const oppBench = state.sides[actor === "player" ? "opponent" : "player"].bench;
    const onBench = (id: string) => oppBench.some((m) => m.id === id);
    // Bench-counter allocation: one entry per counter (repeats allowed),
    // every target on the opponent's bench. Full count required when the
    // bench is non-empty; empty when there's no bench (the counters fizzle).
    if (move.benchCounters != null) {
      const need = attackBenchCounterCount(attacker, move.attackIndex);
      const expected = oppBench.length > 0 ? need : 0;
      if (move.benchCounters.length !== expected) return false;
      if (!move.benchCounters.every(onBench)) return false;
    }
    if (move.benchDamageTargets != null) {
      const targets = attackBenchDamageTargets(attacker, move.attackIndex);
      if (move.benchDamageTargets.length > targets) return false;
      if (new Set(move.benchDamageTargets).size !== move.benchDamageTargets.length) return false;
      if (!move.benchDamageTargets.every(onBench)) return false;
    }
    return true;
  }

  const encoded = JSON.stringify(move);
  return legal.some((m) => JSON.stringify(m) === encoded);
}
