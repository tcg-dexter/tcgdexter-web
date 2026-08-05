// Free-running game driver: applies policy-chosen SimMoves to a mutable
// GameState until someone wins. Unlike the replay reducer (which trusts
// the log), this enforces outcomes itself — damage math, KOs, prizes,
// promotion, deck-out, and the turn cap.
//
// Promotion after a KO is a CALLER decision (returned as pendingPromotions,
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
import { applyAttackSelfLock, damageTakenReduction, hasStatus, statusAmount } from "./statuses";
import { auraDamageReduction, auraPreventsEffects } from "./auras";
import { fireCheckup, fireEndOfTurn, fireOnDamaged } from "./hooks";
import { specialEnergyPreventsEffects } from "./effects/energy";
import { applyTrainer } from "./trainers";
import { applyEffect } from "./effects/runtime";
import { attackRiderEffect, damageScaleEffect, effectsFor, onAttachEffect, triggerEffect } from "./effects/cards";
import { applyStadium, benchCap, enforceBenchCap, stadiumBenchEntryCounters } from "./stadiums";
import { viewFor } from "./view";
import { shuffle, type Rng } from "./rng";

export interface GameOptions {
  /** Global turn cap; the game is scored on prizes if it hits this. */
  maxTurns?: number;
  /** Safety valve on policy loops within a single turn. */
  maxMovesPerTurn?: number;
  /** Diagnostic observer, called once per completed turn with the live
   *  state. Read-only by contract — calibration probes use it to see WHY a
   *  game stalls without forking the turn loop (a forked loop drifts from
   *  the real one and then measures the wrong thing). Never set in
   *  production paths, so it cannot affect the rng stream or determinism. */
  observer?: (ev: TurnObservation) => void;
}

/** One turn's worth of diagnostic telemetry. */
export interface TurnObservation {
  turn: number;
  actor: "player" | "opponent";
  /** Move kinds the policy chose this turn, in order. */
  moves: string[];
  /** Times the "must have an Active" backstop had to step in — should be 0
   *  once every KO site hands its promotions back. */
  invariantFixes: number;
  deckCount: number;
  handCount: number;
  benchCount: number;
  prizesTaken: { player: number; opponent: number };
  /** Did this side attack this turn? */
  attacked: boolean;
  /** Attack moves that were LEGAL on the final decision of the turn. */
  attacksAvailable: number;
  /** Energy in play on this side (active + bench). */
  energyInPlay: number;
  /** Was an attach move legal at any decision point this turn? */
  attachAvailable: boolean;
  /** Energy on the single best-loaded Pokémon — spread vs concentration. */
  maxEnergyOnOneMon: number;
  /** Distinct Pokémon carrying at least one energy. */
  monsWithEnergy: number;
  /** Energy cards sitting in hand at end of turn. */
  energyInHand: number;
  /** Move kinds that were still LEGAL at the moment the policy passed —
   *  i.e. value the heuristic declined. Empty when the turn ended by attack. */
  declinedAtPass: string[];
  activeName: string | null;
  /** Names of Pokémon on the bench — diagnostic only. */
  benchNames: string[];
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
  /** Sides whose active was knocked out and must promote from their bench.
   *  A LIST, not one side: a single move can knock out both actives (an
   *  attack with recoil, an effect that damages across the board), and one
   *  slot silently dropped the other. Because nothing ever retries a dropped
   *  promotion, that side sat with no Active — unable to attack or retreat —
   *  for the rest of the game. The probe caught it on 17% of turns. */
  pendingPromotions: ("player" | "opponent")[];
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
  side.supporterNamePlayedThisTurn = undefined;
  // Roll this side's prize counter: what it took last turn is now history.
  side.prizesTakenLastTurn = side.prizesTakenThisTurn ?? 0;
  side.prizesTakenThisTurn = 0;
  // The opponent's comeback window (were THEY KO'd during this turn?) opens
  // fresh now — clear the flag they read at the start of their last turn.
  state.sides[otherActor(actor)].koedLastOppTurn = false;
  for (const mon of [side.active, ...side.bench]) {
    if (!mon) continue;
    mon.evolvedThisTurn = false;
    // "Once during your turn" — per TURN, not per game. This was never
    // cleared in the simulator (the replay reducer always did), so every
    // activated ability fired exactly ONCE PER GAME: N's Zoroark's Trade,
    // which is that deck's whole draw engine, Pecharunt ex's Subjugating
    // Chains, Flip the Script, Attract Customers, Adrena-Brain, and all ~30
    // declarative abilities W3 authored. Reported from real play as "used
    // Subjugating Chains one turn, never offered again".
    if (mon.abilitiesUsedThisTurn.length > 0) mon.abilitiesUsedThisTurn = [];
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
  promoted.movedToActiveOnTurn = state.turn.number;
  side.active = promoted;
}

/** Applies one move. Never promotes — see ApplyOutcome.pendingPromotions.
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
  const done = (turnEnded: boolean, pendingPromotions: ApplyOutcome["pendingPromotions"] = [], koTurn: number | null = null): ApplyOutcome =>
    ({ turnEnded, pendingPromotions, koTurn });
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
        // On-attach Energy effects (Jet's switch, Enriching's draw, Telepathic's
        // search) resolve AFTER the card is attached, so `self` sees it.
        const onAttach = onAttachEffect(card.name);
        if (onAttach) {
          applyEffect(
            state,
            actor,
            onAttach.effect,
            {
              kind: "effect",
              sourceId: target.id,
              card: card.name,
              effectIndex: onAttach.index,
              picks: move.attachPicks ?? [],
            },
            rng,
            target,
          );
        }
      }
      return done(false);
    }
    case "bench": {
      const card = takeFromHand(move.cardId);
      if (card && side.bench.length < benchCap(state, actor)) {
        const placed = toPokemonInPlay(card, state.turn.number);
        side.bench.push(placed);
        // Risky Ruins punishes Basics entering the Bench.
        const entry = stadiumBenchEntryCounters(placed, state);
        if (entry > 0) placed.damage += entry * 10;
        // On-play abilities (Meowth ex's Last-Ditch Catch) fire as it lands.
        const onPlay = triggerEffect(card.name, "on_play");
        if (onPlay) {
          applyEffect(state, actor, onPlay.effect,
            { kind: "effect", sourceId: placed.id, card: card.name, effectIndex: onPlay.index, picks: move.triggerPicks ?? [] },
            rng, placed);
        }
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
        // On-evolve abilities fire now — the legacy hand-written trigger
        // (Charizard ex) and the declarative ones (Alakazam, Punk Up).
        if (hasOnEvolveTrigger(card)) {
          onEvolve(state, actor, target, rng ? () => shuffle(side.deck, rng) : null);
        }
        const onEvo = triggerEffect(card.name, "on_evolve");
        if (onEvo) {
          applyEffect(state, actor, onEvo.effect,
            { kind: "effect", sourceId: target.id, card: card.name, effectIndex: onEvo.index, picks: move.triggerPicks ?? [] },
            rng, target);
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
        return done(false, [], ko.koTurn);
      }
      // Cursed Blast self-KOs the user, and its 13 counters can knock out the
      // OPPONENT's active at the same time — both sides promote.
      return done(false, ko.pendingPromotions, ko.koTurn);
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
      promoted.movedToActiveOnTurn = state.turn.number;
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
        side.supporterNamePlayedThisTurn = card.name;
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
        return done(false, [], ko.koTurn);
      }
      return done(false, ko.pendingPromotions, ko.koTurn);
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
          return done(true, [], ko.koTurn);
        }
        return done(true, ko.pendingPromotions, ko.koTurn);
      }

      // Miracle Force and the like: the attacker clears its own conditions.
      if (attackSelfClears(attacker.card.name, attack.name)) clearConditions(attacker);

      // Damage to the active: state-scaled base (attacks.ts) + flat bonuses
      // (Black Belt's Training, Binding Mochi), then W/R.
      // "During your next turn, this Pokémon can't attack" — the attack fizzles
      // but the turn still ends.
      if (hasStatus(attacker, "cannot_attack", state)) return done(true);

      const rawBase =
        attackBaseDamage(state, actor, attacker, move.attackIndex, rng) +
        activeDamageBonus(state, actor, attacker, defender) -
        statusAmount(attacker, "damage_dealt_reduction", state);
      // Attack-level exemptions ("damage isn't affected by Weakness or
      // Resistance, or by any effects on your opponent's Active").
      const ignore = damageScaleEffect(attacker.card.name, attack.name)?.damage?.ignore;
      const skipWr =
        ignore?.weakness === true || hasStatus(defender, "no_weakness", state);
      const afterWr = skipWr
        ? Math.max(0, rawBase)
        : applyWeaknessResistance(Math.max(0, rawBase), attacker, defender);
      // "…or by any effects on your opponent's Active" also bypasses the
      // defender's damage-reduction statuses.
      const auraCut = ignore?.defenderEffects ? 0 : auraDamageReduction(defender, attacker, state);
      const reduced =
        auraCut === Infinity
          ? 0 // an aura prevents the damage entirely (Mysterious Rock Inn)
          : ignore?.defenderEffects
            ? afterWr
            : Math.max(0, afterWr - damageTakenReduction(defender, attacker, state) - auraCut);
      const dealt = hasStatus(defender, "prevent_all", state) ? 0 : reduced;
      dealRawDamage(defender, dealt);

      // Attack-inflicted conditions on the defending active (Mind Bend,
      // Bemusing Aroma, Thunder Shock — coin flips resolve via rng).
      if (!auraPreventsEffects(defender, state) && !specialEnergyPreventsEffects(defender)) {
        for (const c of attackInflictedConditions(attacker.card.name, attack.name, rng ?? undefined)) {
          applyCondition(defender, c, state);
        }
      }

      // Placement / self-cost side effects (no Weakness/Resistance on bench).
      const effect = attackEffect(attacker, move.attackIndex);
      if (effect?.kind === "bench_counters") {
        placeAttackCounters(defSide, effect.counters, move.benchCounters, state);
      } else if (effect?.kind === "bench_damage") {
        if (effect.discardSelfEnergy) discardAllEnergy(attacker, side.discard);
        placeBenchDamage(defSide, effect.amount, effect.targets, move.benchDamageTargets);
      }

      // On-damaged hooks fire for the DEFENDER's side (Lucky Helmet's draw,
      // Spiky Energy's counters) — before knockouts, per "even if this Pokémon
      // is Knocked Out".
      if (dealt > 0) fireOnDamaged(state, defActor, defender, attacker, rng);

      // Declarative attack rider (W2-fin): resolves AFTER damage and placement,
      // BEFORE knockouts — so rider damage can contribute to a KO this turn.
      const rider = attackRiderEffect(attacker.card.name, attack.name);
      if (rider) {
        applyEffect(
          state,
          actor,
          rider.effect,
          {
            kind: "effect",
            sourceId: attacker.id,
            card: attacker.card.name,
            effectIndex: rider.index,
            picks: move.riderPicks ?? [],
            discardCardIds: move.riderDiscardCardIds,
          },
          rng,
          attacker,
        );
      }

      // "During your next turn, this Pokémon can't use <this attack>" — the
      // cost the game charges for enormous cheap attacks. Applied AFTER the
      // attack resolves so it never blocks the attack that imposes it.
      applyAttackSelfLock(attacker, attack.name, attack.text, state.turn.number);

      const ko = resolveKnockouts(state);
      if (ko.winner) {
        state.winner = ko.winner;
        state.endReason = ko.endReason;
        return done(true, [], ko.koTurn);
      }
      // Both sides promote: the defender whose active fell, and the attacker
      // if a self-damaging rider or recoil knocked its own active out too.
      return done(true, ko.pendingPromotions, ko.koTurn);
    }
    case "pass":
      return done(true);
  }
}

/** "A player must always have an Active Pokémon" is a rule, not a bookkeeping
 *  detail — a side stuck with an empty Active spot cannot attack or retreat
 *  and simply loses in slow motion. Rather than rely on every KO site
 *  remembering to hand back a promotion, enforce the invariant in one place
 *  after every move. Returns the sides it had to fix, so a probe can tell
 *  whether a path is still dropping promotions. */
function enforceActiveInvariant(
  state: GameState,
  policies: { player: DecisionPolicy; opponent: DecisionPolicy },
): ("player" | "opponent")[] {
  const fixed: ("player" | "opponent")[] = [];
  if (state.winner !== null) return fixed;
  for (const actor of ["player", "opponent"] as const) {
    const side = sideOf(state, actor);
    if (side.active === null && side.bench.length > 0) {
      promote(state, actor, policies[actor].choosePromotion(viewFor(state, actor)));
      fixed.push(actor);
    }
  }
  return fixed;
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
    const observed: string[] = [];
    let invariantFixes = 0;
    let lastAttacksAvailable = 0;
    let attachSeen = false;
    let declined: string[] = [];
    for (let i = 0; i < maxMoves; i++) {
      const legal = legalMoves(state, actor, ctx);
      if (options.observer) {
        lastAttacksAvailable = legal.filter((m) => m.kind === "attack").length;
        if (legal.some((m) => m.kind === "attach")) attachSeen = true;
      }
      const move = policies[actor].chooseMove(viewFor(state, actor, ctx), legal, ctx);
      if (options.observer) {
        observed.push(move.kind);
        declined = move.kind === "pass" ? legal.map((m) => m.kind) : [];
      }
      const result = applyMove(state, actor, move, ctx, rng);
      if (result.koTurn !== null && firstKoTurn === null) firstKoTurn = result.koTurn;
      if (state.winner === null) {
        for (const pending of result.pendingPromotions) {
          promote(state, pending, policies[pending].choosePromotion(viewFor(state, pending)));
        }
      }
      // Backstop: whatever the move did, nobody may be left without an Active.
      if (options.observer && enforceActiveInvariant(state, policies).length > 0) {
        invariantFixes += 1;
      } else if (!options.observer) {
        enforceActiveInvariant(state, policies);
      }
      if (result.turnEnded || state.winner !== null) break;
    }

    // Pokémon Checkup between turns: poison/burn/sleep/paralysis on both
    // actives, then resolve any KOs (auto-promote via each side's policy).
    if (state.winner === null) {
      // End-of-turn hooks (Powerglass's attach, Ignition Energy's self-discard)
      // fire for the player whose turn just ended, before the Checkup.
      fireEndOfTurn(state, actor, rng);
      runCheckup(state, actor, rng);
      fireCheckup(state, rng); // Freezing Shroud and friends
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
      enforceActiveInvariant(state, policies);
    }

    if (options.observer) {
      const side = sideOf(state, actor);
      const mons = [side.active, ...side.bench].filter((m): m is PokemonInPlay => m !== null);
      options.observer({
        turn: state.turn.number,
        actor,
        moves: observed,
        invariantFixes,
        deckCount: side.deck.length,
        handCount: side.hand.length,
        benchCount: side.bench.length,
        prizesTaken: { ...state.prizesTaken },
        attacked: observed.includes("attack"),
        attacksAvailable: lastAttacksAvailable,
        energyInPlay: mons.reduce((s, m) => s + m.attachedEnergy.length, 0),
        attachAvailable: attachSeen,
        maxEnergyOnOneMon: mons.reduce((s, m) => Math.max(s, m.attachedEnergy.length), 0),
        monsWithEnergy: mons.filter((m) => m.attachedEnergy.length > 0).length,
        energyInHand: side.hand.filter((c) => energyUnits(c, null).length > 0).length,
        declinedAtPass: declined,
        activeName: side.active?.card.name ?? null,
        benchNames: side.bench.map((m) => m.card.name),
      });
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
