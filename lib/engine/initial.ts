// Initial GameState construction.
//
// The engine accepts an already-normalized BattleLogParseResult (player /
// opponent handles resolved) and returns a blank board with:
//   * Both sides keyed by handle
//   * 6 unrevealed prize placeholders per side
//   * Empty deck, hand, discard, lost zone, bench, no active, no stadium
//   * Turn metadata sitting at "setup" before any action has applied
//
// Deck lists are not required in v0 — the reducer learns about cards as
// they enter visible zones. When deck lists are supplied later, this is
// where we'd seed each side's `deck` array with concrete CardInstances.

import type { BattleLogParseResult } from "@/lib/battle-log/types";
import { ENGINE_VERSION, type CardInstance, type GameState, type PlayerSide } from "./types";

let _instanceCounter = 0;

/** Mint a fresh CardInstance id. Module-local counter is fine — we never
 *  persist engine state across processes, and ids only need to be unique
 *  within a single replay. */
export function mintInstanceId(prefix = "c"): string {
  _instanceCounter += 1;
  return `${prefix}_${_instanceCounter}`;
}

/** Make a CardInstance placeholder for a card whose identity isn't yet
 *  revealed (deck top, opponent hand pre-mulligan reveal, prize slot). */
export function makeUnrevealed(prefix = "u"): CardInstance {
  return {
    id: mintInstanceId(prefix),
    name: "(unrevealed)",
    catalog: null,
    unrevealed: true,
  };
}

function blankSide(handle: string | null): PlayerSide {
  return {
    handle,
    deck: [],
    hand: [],
    discard: [],
    lostZone: [],
    // 6 prize placeholders. Each takes an instance id so the UI can
    // animate individual prize cards as they're taken.
    prizes: Array.from({ length: 6 }, () => makeUnrevealed("prize")),
    active: null,
    bench: [],
    mulligans: 0,
    energyAttachedThisTurn: 0,
    supporterPlayedThisTurn: false,
  };
}

export function buildInitialState(parseResult: BattleLogParseResult): GameState {
  return {
    engineVersion: ENGINE_VERSION,
    turn: {
      number: 0,
      playerTurnNumber: 0,
      // Setup belongs to neither player; the parser marks setup-phase
      // actions with the actor that performed them, so the reducer
      // updates this when turn_start fires.
      actor: "system",
      phase: "setup",
    },
    firstPlayer: null,
    stadium: null,
    sides: {
      player: blankSide(parseResult.player_handle),
      opponent: blankSide(parseResult.opponent_handle),
    },
    prizesTaken: { player: 0, opponent: 0 },
    winner: null,
    endReason: null,
  };
}
