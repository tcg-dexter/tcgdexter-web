// Free-running game driver: applies policy-chosen SimMoves to a mutable
// GameState until someone wins. Unlike the replay reducer (which trusts
// the log), this enforces outcomes itself — damage math, KOs, prizes,
// promotion, deck-out, and the turn cap.

import type { GameState, PokemonInPlay } from "../types";
import { computeDamage, legalMoves, remainingHp, sideOf, type SimMove, type TurnContext } from "./moves";
import type { DecisionPolicy } from "./policy";
import { buildSimInitialState, prizeValue, toPokemonInPlay, type SimDeck } from "./setup";
import type { Rng } from "./rng";

export interface GameOptions {
  /** Global turn cap; the game is scored on prizes if it hits this. */
  maxTurns?: number;
  /** Safety valve on policy loops within a single turn. */
  maxMovesPerTurn?: number;
}

export interface GameOutcome {
  winner: "player" | "opponent" | null;
  endReason: "prizes" | "no_active" | "deck_out" | "turn_cap";
  turns: number;
  prizesTaken: { player: number; opponent: number };
  /** Global turn of the game's first knockout, null if none happened. */
  firstKoTurn: number | null;
}

const DEFAULT_MAX_TURNS = 60;
const DEFAULT_MAX_MOVES = 60;

function other(actor: "player" | "opponent"): "player" | "opponent" {
  return actor === "player" ? "opponent" : "player";
}

/** Applies one move. Returns true when the move ends the turn. */
function applyMove(
  state: GameState,
  actor: "player" | "opponent",
  move: SimMove,
  ctx: TurnContext,
  policies: { player: DecisionPolicy; opponent: DecisionPolicy },
  outcome: { firstKoTurn: number | null },
): boolean {
  const side = sideOf(state, actor);
  const takeFromHand = (cardId: string) => {
    const idx = side.hand.findIndex((c) => c.id === cardId);
    return idx >= 0 ? side.hand.splice(idx, 1)[0] : null;
  };
  const findMon = (id: string): PokemonInPlay | null =>
    [side.active, ...side.bench].find((m) => m?.id === id) ?? null;

  switch (move.kind) {
    case "attach": {
      const card = takeFromHand(move.cardId);
      const target = findMon(move.targetId);
      if (card && target) {
        target.attachedEnergy.push(card);
        side.energyAttachedThisTurn += 1;
      }
      return false;
    }
    case "bench": {
      const card = takeFromHand(move.cardId);
      if (card && side.bench.length < 5) {
        side.bench.push(toPokemonInPlay(card, state.turn.number));
      }
      return false;
    }
    case "evolve": {
      const card = takeFromHand(move.cardId);
      const target = findMon(move.targetId);
      if (card && target) {
        target.stack.push(target.card);
        target.card = card;
        target.evolvedThisTurn = true;
        target.conditions = [];
      }
      return false;
    }
    case "retreat": {
      const active = side.active;
      const promoted = side.bench[move.benchIndex];
      if (!active || !promoted) return false;
      const cost = active.card.catalog?.retreat_cost ?? 0;
      side.discard.push(...active.attachedEnergy.splice(0, cost));
      side.bench[move.benchIndex] = active;
      side.active = promoted;
      ctx.retreated = true;
      return false;
    }
    case "cycle_supporter": {
      const card = takeFromHand(move.cardId);
      if (card) {
        side.discard.push(card);
        side.hand.push(...side.deck.splice(0, 2));
        side.supporterPlayedThisTurn = true;
      }
      return false;
    }
    case "cycle_item": {
      const card = takeFromHand(move.cardId);
      if (card) {
        side.discard.push(card);
        side.hand.push(...side.deck.splice(0, 1));
      }
      return false;
    }
    case "attack": {
      const attacker = side.active;
      const defSide = sideOf(state, other(actor));
      const defender = defSide.active;
      if (!attacker || !defender) return true;
      const attack = attacker.card.catalog?.attacks[move.attackIndex];
      if (!attack) return true;

      defender.damage += computeDamage(attacker, attack, defender);
      if (remainingHp(defender) <= 0) {
        // KO: pile to discard, prizes to the attacker, promotion or loss.
        defSide.discard.push(
          defender.card,
          ...defender.stack,
          ...defender.attachedEnergy,
          ...defender.attachedTools,
        );
        defSide.active = null;
        if (outcome.firstKoTurn === null) outcome.firstKoTurn = state.turn.number;

        const taken = side.prizes.splice(0, prizeValue(defender.card.name));
        side.hand.push(...taken);
        state.prizesTaken[actor] += taken.length;
        if (state.prizesTaken[actor] >= 6) {
          state.winner = actor;
          state.endReason = "prizes";
          return true;
        }
        if (defSide.bench.length === 0) {
          state.winner = actor;
          state.endReason = "no_active";
          return true;
        }
        const idx = policies[other(actor)].choosePromotion(defSide);
        const [promoted] = defSide.bench.splice(Math.min(idx, defSide.bench.length - 1), 1);
        defSide.active = promoted;
      }
      return true;
    }
    case "pass":
      return true;
  }
}

export function playGame(
  deckA: SimDeck,
  deckB: SimDeck,
  policies: { player: DecisionPolicy; opponent: DecisionPolicy },
  rng: Rng,
  firstActor: "player" | "opponent",
  options: GameOptions = {},
): GameOutcome {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const maxMoves = options.maxMovesPerTurn ?? DEFAULT_MAX_MOVES;
  const state = buildSimInitialState(deckA, deckB, rng, firstActor);
  const outcome = { firstKoTurn: null as number | null };

  let actor = firstActor;
  const playerTurnCounts = { player: 0, opponent: 0 };

  while (state.winner === null && state.turn.number < maxTurns) {
    // ── Turn start: advance, reset per-turn flags, draw. ──
    state.turn.number += 1;
    playerTurnCounts[actor] += 1;
    state.turn = {
      number: state.turn.number,
      playerTurnNumber: playerTurnCounts[actor],
      actor,
      phase: "turn",
    };
    const side = sideOf(state, actor);
    side.energyAttachedThisTurn = 0;
    side.supporterPlayedThisTurn = false;
    for (const mon of [side.active, ...side.bench]) {
      if (mon) mon.evolvedThisTurn = false;
    }
    if (side.deck.length === 0) {
      state.winner = other(actor);
      state.endReason = "deck_out";
      break;
    }
    side.hand.push(...side.deck.splice(0, 1));

    // ── Policy loop until the turn ends. ──
    const ctx: TurnContext = { retreated: false };
    for (let i = 0; i < maxMoves; i++) {
      const legal = legalMoves(state, actor, ctx);
      const move = policies[actor].chooseMove(state, actor, legal, ctx);
      const ended = applyMove(state, actor, move, ctx, policies, outcome);
      if (ended || state.winner !== null) break;
    }

    actor = other(actor);
  }

  const endReason =
    state.winner !== null
      ? (state.endReason as GameOutcome["endReason"]) ?? "prizes"
      : "turn_cap";
  let winner = state.winner;
  if (winner === null) {
    // Turn cap: score on prizes taken; equal prizes is a draw.
    if (state.prizesTaken.player > state.prizesTaken.opponent) winner = "player";
    else if (state.prizesTaken.opponent > state.prizesTaken.player) winner = "opponent";
  }

  return {
    winner,
    endReason,
    turns: state.turn.number,
    prizesTaken: { ...state.prizesTaken },
    firstKoTurn: outcome.firstKoTurn,
  };
}
