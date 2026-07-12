// Free-running game driver: applies policy-chosen SimMoves to a mutable
// GameState until someone wins. Unlike the replay reducer (which trusts
// the log), this enforces outcomes itself — damage math, KOs, prizes,
// promotion, deck-out, and the turn cap.
//
// Promotion after a KO is a CALLER decision (returned as pendingPromotion,
// resolved via promote()): playGame answers it with the defender's policy
// immediately; the interactive runner pauses and asks the human.

import type { GameState, PokemonInPlay } from "../types";
import { computeDamage, legalMoves, remainingHp, sideOf, type SimMove, type TurnContext } from "./moves";
import type { DecisionPolicy } from "./policy";
import { buildSimInitialState, prizeValue, toPokemonInPlay, type SimDeck } from "./setup";
import { viewFor } from "./view";
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

export const DEFAULT_MAX_TURNS = 60;
export const DEFAULT_MAX_MOVES = 60;

export function otherActor(actor: "player" | "opponent"): "player" | "opponent" {
  return actor === "player" ? "opponent" : "player";
}

export interface ApplyOutcome {
  turnEnded: boolean;
  /** Side whose active was knocked out and must promote from its bench. */
  pendingPromotion: "player" | "opponent" | null;
  /** Global turn number of a KO this move caused, else null. */
  koTurn: number | null;
}

/** Advance to `actor`'s turn: bump counters, reset per-turn flags, draw.
 *  Sets winner (deck-out) when the draw is impossible. Returns false when
 *  the game ended at turn start. Shared by playGame and the interactive
 *  runner so turn structure can't drift between them. */
export function beginTurn(
  state: GameState,
  actor: "player" | "opponent",
  playerTurnNumber: number,
): boolean {
  state.turn = {
    number: state.turn.number + 1,
    playerTurnNumber,
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
    state.winner = otherActor(actor);
    state.endReason = "deck_out";
    return false;
  }
  side.hand.push(...side.deck.splice(0, 1));
  return true;
}

/** Resolve a pending promotion: move bench[index] to the active spot. */
export function promote(state: GameState, actor: "player" | "opponent", benchIndex: number): void {
  const side = sideOf(state, actor);
  if (side.active !== null || side.bench.length === 0) return;
  const idx = Math.min(Math.max(0, benchIndex), side.bench.length - 1);
  const [promoted] = side.bench.splice(idx, 1);
  side.active = promoted;
}

/** Applies one move. Never promotes — see ApplyOutcome.pendingPromotion. */
export function applyMove(
  state: GameState,
  actor: "player" | "opponent",
  move: SimMove,
  ctx: TurnContext,
): ApplyOutcome {
  const side = sideOf(state, actor);
  const done = (turnEnded: boolean, pendingPromotion: ApplyOutcome["pendingPromotion"] = null, koTurn: number | null = null): ApplyOutcome =>
    ({ turnEnded, pendingPromotion, koTurn });
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
      return done(false);
    }
    case "bench": {
      const card = takeFromHand(move.cardId);
      if (card && side.bench.length < 5) {
        side.bench.push(toPokemonInPlay(card, state.turn.number));
      }
      return done(false);
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
      return done(false);
    }
    case "retreat": {
      const active = side.active;
      const promoted = side.bench[move.benchIndex];
      if (!active || !promoted) return done(false);
      const cost = active.card.catalog?.retreat_cost ?? 0;
      side.discard.push(...active.attachedEnergy.splice(0, cost));
      side.bench[move.benchIndex] = active;
      side.active = promoted;
      ctx.retreated = true;
      return done(false);
    }
    case "cycle_supporter": {
      const card = takeFromHand(move.cardId);
      if (card) {
        side.discard.push(card);
        side.hand.push(...side.deck.splice(0, 2));
        side.supporterPlayedThisTurn = true;
      }
      return done(false);
    }
    case "cycle_item": {
      const card = takeFromHand(move.cardId);
      if (card) {
        side.discard.push(card);
        side.hand.push(...side.deck.splice(0, 1));
      }
      return done(false);
    }
    case "attack": {
      const attacker = side.active;
      const defActor = otherActor(actor);
      const defSide = sideOf(state, defActor);
      const defender = defSide.active;
      if (!attacker || !defender) return done(true);
      const attack = attacker.card.catalog?.attacks[move.attackIndex];
      if (!attack) return done(true);

      defender.damage += computeDamage(attacker, attack, defender);
      if (remainingHp(defender) > 0) return done(true);

      // KO: pile to discard, prizes to the attacker, promotion or loss.
      defSide.discard.push(
        defender.card,
        ...defender.stack,
        ...defender.attachedEnergy,
        ...defender.attachedTools,
      );
      defSide.active = null;
      const koTurn = state.turn.number;

      const taken = side.prizes.splice(0, prizeValue(defender.card.name));
      side.hand.push(...taken);
      state.prizesTaken[actor] += taken.length;
      if (state.prizesTaken[actor] >= 6) {
        state.winner = actor;
        state.endReason = "prizes";
        return done(true, null, koTurn);
      }
      if (defSide.bench.length === 0) {
        state.winner = actor;
        state.endReason = "no_active";
        return done(true, null, koTurn);
      }
      return done(true, defActor, koTurn);
    }
    case "pass":
      return done(true);
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
  let firstKoTurn: number | null = null;

  let actor = firstActor;
  const playerTurnCounts = { player: 0, opponent: 0 };

  while (state.winner === null && state.turn.number < maxTurns) {
    playerTurnCounts[actor] += 1;
    if (!beginTurn(state, actor, playerTurnCounts[actor])) break;

    const ctx: TurnContext = { retreated: false };
    for (let i = 0; i < maxMoves; i++) {
      const legal = legalMoves(state, actor, ctx);
      const move = policies[actor].chooseMove(viewFor(state, actor), legal, ctx);
      const result = applyMove(state, actor, move, ctx);
      if (result.koTurn !== null && firstKoTurn === null) firstKoTurn = result.koTurn;
      if (result.pendingPromotion && state.winner === null) {
        const pending = result.pendingPromotion;
        promote(state, pending, policies[pending].choosePromotion(viewFor(state, pending)));
      }
      if (result.turnEnded || state.winner !== null) break;
    }

    actor = otherActor(actor);
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
    firstKoTurn,
  };
}
