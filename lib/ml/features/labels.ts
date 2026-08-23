// Training labels: battle outcome + deterministic turn-quality heuristics.
// The flags are weak labels for the coach — explainable, conservative, and
// derived only from what the log can actually support (e.g. hand-aware
// checks apply to the player side only; the opponent's hand is hidden).

import type { GameState, PokemonInPlay } from "@/lib/engine/types";
import { bool01 } from "./guards";
import type { BattleLabels, TurnFeatures, TurnQualityFlags } from "./types";

/* ─── Battle outcome ────────────────────────────────────────────── */

function outcomeValue(result: string | null | undefined): number | null {
  switch ((result ?? "").toLowerCase()) {
    case "win":
      return 1;
    case "loss":
      return 0;
    case "draw":
    case "tie":
      return 0.5;
    default:
      return null;
  }
}

/**
 * Prefer the stored matches.result (the user-confirmed outcome, and the only
 * signal for BO3 sets and manual edits); fall back to the log-derived result.
 */
export function deriveBattleLabels(
  storedResult: string | null,
  logResult: string | null,
  prizeDiff: number | null,
): BattleLabels {
  const stored = outcomeValue(storedResult);
  if (stored !== null) {
    return { outcome: stored, outcome_source: "stored", label_prize_diff: prizeDiff };
  }
  const fromLog = outcomeValue(logResult);
  return {
    outcome: fromLog,
    outcome_source: fromLog !== null ? "log" : null,
    label_prize_diff: prizeDiff,
  };
}

/* ─── Turn-quality heuristics ───────────────────────────────────── */

/** A Pokémon can evolve this turn if it was already in play at the start of
 *  the turn and hasn't evolved yet this turn. (enteredPlayOnTurn and
 *  evolvedThisTurn survive until the NEXT turn_start, so the end-of-turn
 *  snapshot is safe to read.) */
function evolutionEligible(mon: PokemonInPlay, turnNumber: number): boolean {
  return mon.enteredPlayOnTurn < turnNumber && !mon.evolvedThisTurn;
}

function missedEvolution(endState: GameState, turnNumber: number): boolean {
  const side = endState.sides.player;
  const inPlay = [side.active, ...side.bench].filter((m): m is PokemonInPlay => m !== null);
  if (inPlay.length === 0) return false;
  for (const card of side.hand) {
    const evolvesFrom = card.catalog?.evolves_from;
    if (!evolvesFrom) continue;
    if (inPlay.some((mon) => mon.card.name === evolvesFrom && evolutionEligible(mon, turnNumber))) {
      return true;
    }
  }
  return false;
}

/**
 * Deterministic quality flags for one turn. `turn` and `endState` must come
 * from the same TurnExtraction (see battle.ts).
 */
export function turnQualityFlags(turn: TurnFeatures, endState: GameState): TurnQualityFlags {
  const isPlayerTurn = turn.actor === "player";
  return {
    flag_missed_energy_attach: bool01(turn.energy_attached === 0),
    flag_no_supporter: bool01(turn.supporter_played === 0),
    // Multiple retreats in one turn, or burning 2+ energy on retreat cost,
    // is the classic over-retreat tempo leak.
    flag_over_retreat: bool01(turn.retreats >= 2 || turn.retreat_energy_discarded >= 2),
    flag_passive_turn: bool01(
      turn.attacked === 0 &&
        turn.energy_attached === 0 &&
        turn.evolutions === 0 &&
        turn.abilities_used === 0,
    ),
    // Hand-aware: player turns only — the opponent's hand is hidden, so the
    // flag is structurally 0 on their turns rather than falsely "clean".
    flag_missed_evolution: bool01(
      isPlayerTurn && missedEvolution(endState, turn.turn_number),
    ),
  };
}
