// Free-running game driver: applies policy-chosen SimMoves to a mutable
// GameState until someone wins. Unlike the replay reducer (which trusts
// the log), this enforces outcomes itself — damage math, KOs, prizes,
// promotion, deck-out, and the turn cap.
//
// Promotion after a KO is a CALLER decision (returned as pendingPromotion,
// resolved via promote()): playGame answers it with the defender's policy
// immediately; the interactive runner pauses and asks the human.

import type { GameState, PokemonInPlay } from "../types";
import { applyWeaknessResistance, legalMoves, sideOf, type SimMove, type TurnContext } from "./moves";
import { activeDamageBonus, attackBaseDamage, attackEffect, discardAllEnergy } from "./attacks";
import { applyAbility, hasOnEvolveTrigger, onEvolve } from "./abilities";
import {
  applyCondition,
  attackInflictedConditions,
  attackSelfClears,
  cannotAct,
  clearConditions,
  hasCondition,
  runCheckup,
} from "./conditions";
import { dealRawDamage, placeAttackCounters, placeBenchDamage, resolveKnockouts } from "./damage";
import type { DecisionPolicy } from "./policy";
import { buildSimInitialState, energyUnits, toPokemonInPlay, type SimDeck } from "./setup";
import { retreatCost } from "./tools";
import { applyTrainer } from "./trainers";
import { applyEffect } from "./effects/runtime";
import { effectsFor } from "./effects/cards";
import { applyStadium, benchCap, enforceBenchCap } from "./stadiums";
import { viewFor } from "./view";
import { shuffle, type Rng } from "./rng";

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
  // The opponent's comeback window (were THEY KO'd during this turn?) opens
  // fresh now — clear the flag they read at the start of their last turn.
  state.sides[otherActor(actor)].koedLastOppTurn = false;
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

/** Resolve a pending promotion: move bench[index] to the active spot. The
 *  newly-Active Pokémon starts free of Special Conditions. */
export function promote(state: GameState, actor: "player" | "opponent", benchIndex: number): void {
  const side = sideOf(state, actor);
  if (side.active !== null || side.bench.length === 0) return;
  const idx = Math.min(Math.max(0, benchIndex), side.bench.length - 1);
  const [promoted] = side.bench.splice(idx, 1);
  if (promoted.conditions.length > 0) promoted.conditions = [];
  side.active = promoted;
}

/** Applies one move. Never promotes — see ApplyOutcome.pendingPromotion.
 *  `rng` drives post-search/hand-shuffle effects; callers that replay a
 *  fixed stream (game loop, sessions) must always pass the same instance
 *  so transcripts stay deterministic. Ghost evaluations pass null. */
export function applyMove(
  state: GameState,
  actor: "player" | "opponent",
  move: SimMove,
  ctx: TurnContext,
  rng: Rng | null = null,
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
      if (card && side.bench.length < benchCap(state, actor)) {
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
        // On-evolve abilities (Charizard ex's Infernal Reign) fire now.
        if (hasOnEvolveTrigger(card)) {
          onEvolve(state, actor, target, rng ? () => shuffle(side.deck, rng) : null);
        }
      }
      return done(false);
    }
    case "use_ability": {
      applyAbility(state, actor, move);
      const ko = resolveKnockouts(state);
      if (ko.winner) {
        state.winner = ko.winner;
        state.endReason = ko.endReason;
        return done(false, null, ko.koTurn);
      }
      // Cursed Blast self-KOs the user; if it was our active, we promote.
      const pending = ko.pendingPromotions.includes(actor) ? actor : null;
      return done(false, pending, ko.koTurn);
    }
    case "retreat": {
      const active = side.active;
      const promoted = side.bench[move.benchIndex];
      if (!active || !promoted) return done(false);
      // Pay the (tool-reduced) retreat cost by discarding whole Energy
      // cards until the units discarded meet the cost (Double Turbo = 2).
      let owed = retreatCost(active, state);
      while (owed > 0 && active.attachedEnergy.length > 0) {
        const [card] = active.attachedEnergy.splice(0, 1);
        side.discard.push(card);
        owed -= energyUnits(card).length;
      }
      clearConditions(active); // leaving the Active Spot clears conditions
      side.bench[move.benchIndex] = active;
      side.active = promoted;
      ctx.retreated = true;
      return done(false);
    }
    case "attach_tool": {
      const card = takeFromHand(move.cardId);
      const target = findMon(move.targetId);
      if (card && target && target.attachedTools.length === 0) {
        target.attachedTools.push(card);
      } else if (card) {
        side.discard.push(card); // no legal target — shouldn't happen
      }
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
    case "play_trainer": {
      applyTrainer(state, actor, move, rng);
      return done(false);
    }
    case "effect": {
      // Declarative-effect move (universal encoding). applyEffect does the
      // trainer/ability housekeeping and runs the ops. Effects can place
      // counters / conditions, so resolve KOs like an activated ability.
      const effect = effectsFor(move.card)[move.effectIndex];
      if (effect) applyEffect(state, actor, effect, move, rng);
      const ko = resolveKnockouts(state);
      if (ko.winner) {
        state.winner = ko.winner;
        state.endReason = ko.endReason;
        return done(false, null, ko.koTurn);
      }
      const pending = ko.pendingPromotions.includes(actor) ? actor : null;
      return done(false, pending, ko.koTurn);
    }
    case "play_stadium": {
      const card = takeFromHand(move.cardId);
      if (card) {
        // The outgoing Stadium goes to its owner's discard; the new one
        // sits next to the board. A lower bench cap forces excess discards.
        if (state.stadium) {
          state.sides[state.stadium.owner].discard.push(state.stadium.card);
        }
        state.stadium = { card, owner: actor };
        ctx.stadiumPlayed = true;
        enforceBenchCap(state);
      }
      return done(false);
    }
    case "use_stadium": {
      applyStadium(state, actor, move, rng);
      ctx.stadiumUsed = true;
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

      // Confusion: flip on attacking; tails puts 30 on the attacker and the
      // attack fails (the turn still ends).
      if (hasCondition(attacker, "Confused") && rng && rng() < 0.5) {
        dealRawDamage(attacker, 30);
        const ko = resolveKnockouts(state);
        if (ko.winner) {
          state.winner = ko.winner;
          state.endReason = ko.endReason;
          return done(true, null, ko.koTurn);
        }
        return done(true, ko.pendingPromotions.includes(actor) ? actor : null, ko.koTurn);
      }

      // Miracle Force and the like: the attacker clears its own conditions.
      if (attackSelfClears(attacker.card.name, attack.name)) clearConditions(attacker);

      // Damage to the active: state-scaled base (attacks.ts) + flat bonuses
      // (Black Belt's Training, Binding Mochi), then W/R.
      const base =
        attackBaseDamage(state, actor, attacker, move.attackIndex) +
        activeDamageBonus(state, actor, attacker, defender);
      dealRawDamage(defender, applyWeaknessResistance(base, attacker, defender));

      // Attack-inflicted conditions on the defending active (Mind Bend,
      // Bemusing Aroma, Thunder Shock — coin flips resolve via rng).
      for (const c of attackInflictedConditions(attacker.card.name, attack.name, rng ?? undefined)) {
        applyCondition(defender, c);
      }

      // Placement / self-cost side effects (no Weakness/Resistance on bench).
      const effect = attackEffect(attacker, move.attackIndex);
      if (effect?.kind === "bench_counters") {
        placeAttackCounters(defSide, effect.counters, move.benchCounters);
      } else if (effect?.kind === "bench_damage") {
        if (effect.discardSelfEnergy) discardAllEnergy(attacker, side.discard);
        placeBenchDamage(defSide, effect.amount, effect.targets, move.benchDamageTargets);
      }

      const ko = resolveKnockouts(state);
      if (ko.winner) {
        state.winner = ko.winner;
        state.endReason = ko.endReason;
        return done(true, null, ko.koTurn);
      }
      // The attacking side's own active can't be promotion-pending from a
      // normal attack; the defender promotes if its active fell.
      const pending = ko.pendingPromotions.includes(defActor) ? defActor : null;
      return done(true, pending, ko.koTurn);
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
      const move = policies[actor].chooseMove(viewFor(state, actor, ctx), legal, ctx);
      const result = applyMove(state, actor, move, ctx, rng);
      if (result.koTurn !== null && firstKoTurn === null) firstKoTurn = result.koTurn;
      if (result.pendingPromotion && state.winner === null) {
        const pending = result.pendingPromotion;
        promote(state, pending, policies[pending].choosePromotion(viewFor(state, pending)));
      }
      if (result.turnEnded || state.winner !== null) break;
    }

    // Pokémon Checkup between turns: poison/burn/sleep/paralysis on both
    // actives, then resolve any KOs (auto-promote via each side's policy).
    if (state.winner === null) {
      runCheckup(state, actor, rng);
      const ko = resolveKnockouts(state);
      if (ko.koTurn !== null && firstKoTurn === null) firstKoTurn = ko.koTurn;
      if (ko.winner) {
        state.winner = ko.winner;
        state.endReason = ko.endReason;
      } else {
        for (const side of ko.pendingPromotions) {
          promote(state, side, policies[side].choosePromotion(viewFor(state, side)));
        }
      }
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
