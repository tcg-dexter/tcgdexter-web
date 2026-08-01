// Legal-move generation for the free-running simulator. Encodes the core
// turn-structure rules: one energy attachment per turn, evolution lock,
// no attacking on the game's first turn, one retreat per turn, bench cap,
// supporter once per turn. Trainer effects are generalized to cycling
// (see setup.ts header).

import type { EngineAttack, GameState, PlayerSide, PokemonInPlay } from "../types";
import { energyProvides, energyUnits, isBasic, toPokemonInPlay } from "./setup";
import { unitPaysType } from "./effects/energy";
import { isSupporter, trainerMoves, trainerSpec, type PlayTrainerMove } from "./trainers";
import { abilityMoves, hasLegacyActivated, type UseAbilityMove } from "./abilities";
import { cannotAct } from "./conditions";
import { canRetreat, effectiveMaxHp, isTool, toolCostReduction } from "./tools";
import { benchCap, stadiumAttackCostExtra, stadiumMoves, type UseStadiumMove } from "./stadiums";
import { enumerateEffect, type EffectMove, type EffectPick } from "./effects/runtime";
import { abilityEffects, attackRiderEffect, effectsFor, onAttachEffect, triggerEffect } from "./effects/cards";

export type SimMove =
  | {
      kind: "attach";
      cardId: string;
      targetId: string;
      /** Picks for this Energy's ON-ATTACH effect (Telepathic Psychic Energy's
       *  2 Basics). Like riderPicks, it resolves inside the attach move. */
      attachPicks?: EffectPick[];
    }
  | { kind: "bench"; cardId: string; triggerPicks?: EffectPick[] }
  | { kind: "evolve"; cardId: string; targetId: string; triggerPicks?: EffectPick[] }
  | { kind: "retreat"; benchIndex: number }
  | { kind: "cycle_supporter"; cardId: string }
  | { kind: "cycle_item"; cardId: string }
  | PlayTrainerMove
  | UseAbilityMove
  // Universal declarative-effect move (W2 cutover). Card-agnostic: the source
  // is a hand card (trainer) or an in-play Pokémon (ability); `picks` records
  // the chosen ids per target slot. Enumerated by enumerateEffect for cards in
  // the declarative registry (effects/cards.ts); applied by applyEffect.
  | EffectMove
  | { kind: "play_stadium"; cardId: string }
  | { kind: "attach_tool"; cardId: string; targetId: string }
  | UseStadiumMove
  | {
      kind: "attack";
      attackIndex: number;
      /** Opponent-bench monIds, one per counter placed (Phantom Dive). */
      benchCounters?: string[];
      /** Opponent-bench monIds hit by bench damage (Flamebody Cannon). */
      benchDamageTargets?: string[];
      /** Target picks for this attack's DECLARATIVE rider (Cruel Arrow's
       *  "1 of your opponent's Pokémon"). Enumerated alongside the attack —
       *  a rider is never a move of its own; it resolves after damage. */
      riderPicks?: EffectPick[];
    }
  | { kind: "pass" };

/** Per-turn bookkeeping the PlayerSide shape doesn't carry (replay never
 *  needed it): the acting side's single retreat per turn. */
export interface TurnContext {
  retreated: boolean;
  /** The current Stadium's activated effect was used this turn (Artazon). */
  stadiumUsed?: boolean;
  /** A Stadium card was played this turn (one per turn). */
  stadiumPlayed?: boolean;
}

export function sideOf(state: GameState, actor: "player" | "opponent"): PlayerSide {
  return state.sides[actor];
}

/* ─── Energy cost satisfaction ──────────────────────────────────── */

/** Greedy typed-cost check: typed requirements consume matching attached
 *  energy first, Colorless consumes whatever remains. */
export function canPayCost(mon: PokemonInPlay, cost: string[]): boolean {
  if (cost.length === 0) return true;
  // One card can provide several units (Double Turbo = 2) and a unit can be
  // a wildcard "Any" (Luminous) that pays any typed requirement.
  const pool = mon.attachedEnergy.flatMap((c) => energyUnits(c, mon));
  if (pool.length < cost.length) return false;

  // Typed requirements first: spend an exact-type unit before any wildcard, so
  // a restricted wildcard (Team Rocket's "Psychic or Darkness") isn't wasted on
  // a cost a plain unit could have paid.
  for (const req of cost) {
    if (req === "Colorless") continue;
    let idx = pool.indexOf(req);
    if (idx === -1) idx = pool.findIndex((u) => unitPaysType(u, req));
    if (idx === -1) return false;
    pool.splice(idx, 1);
  }
  const colorless = cost.filter((c) => c === "Colorless").length;
  return pool.length >= colorless; // Colorless pays from anything left
}

/** Attack cost after passive Stadium modifiers (Nighttime Mine taxes Tera
 *  Pokémon a Colorless). Pass `state` so those apply. */
export function effectiveCost(
  mon: PokemonInPlay,
  cost: string[],
  state?: GameState,
): string[] {
  const extra = stadiumAttackCostExtra(mon, state);
  let out = extra > 0 ? [...cost, ...Array(extra).fill("Colorless")] : cost;
  // Tool discounts (Counter Gain, Sparkling Crystal, Hop's Choice Band) strip
  // Colorless first — a typed requirement can't be discounted away.
  const cut = toolCostReduction(mon, state, hasPrizeLead(mon, state));
  for (let i = 0; i < cut; i++) {
    const idx = out.lastIndexOf("Colorless");
    if (idx === -1) break;
    out = [...out.slice(0, idx), ...out.slice(idx + 1)];
  }
  return out;
}

/** Does the side owning `mon` have MORE prizes left than its opponent? */
function hasPrizeLead(mon: PokemonInPlay, state?: GameState): boolean {
  if (!state) return false;
  const mine = [state.sides.player, state.sides.opponent].find((s) =>
    [s.active, ...s.bench].some((m) => m?.id === mon.id),
  );
  if (!mine) return false;
  const theirs = mine === state.sides.player ? state.sides.opponent : state.sides.player;
  return mine.prizes.length > theirs.prizes.length;
}

export function usableAttacks(
  mon: PokemonInPlay,
  state?: GameState,
): { attack: EngineAttack; index: number }[] {
  const attacks = mon.card.catalog?.attacks ?? [];
  return attacks
    .map((attack, index) => ({ attack, index }))
    .filter(({ attack }) => canPayCost(mon, effectiveCost(mon, attack.cost, state)));
}

/* ─── Damage math ───────────────────────────────────────────────── */

/** Printed damage number ("180+", "30×" → 180, 30; text-only → 0). */
export function baseDamage(attack: EngineAttack): number {
  const n = parseInt(attack.damage, 10);
  return Number.isFinite(n) ? n : 0;
}

export function remainingHp(mon: PokemonInPlay): number {
  return effectiveMaxHp(mon) - mon.damage;
}

/** Apply Weakness (×2) / Resistance (−30) for the attacker's type against a
 *  defending ACTIVE. Damage to Benched Pokémon and damage counters never
 *  call this (core rule). Floored at 0. */
export function applyWeaknessResistance(
  base: number,
  attacker: PokemonInPlay,
  defender: PokemonInPlay,
): number {
  if (base <= 0) return 0;
  let dmg = base;
  const attackerType = attacker.card.catalog?.types[0];
  const defCatalog = defender.card.catalog;
  if (attackerType && defCatalog) {
    if (defCatalog.weaknesses.some((w) => w.type === attackerType)) dmg *= 2;
    if (defCatalog.resistances.some((r) => r.type === attackerType)) dmg = Math.max(0, dmg - 30);
  }
  return dmg;
}

/** Fraction of an attack's cost payable right now — the typed mirror of
 *  canPayCost. Count-based progress credited dead energy: a Psychic on a
 *  Lightning attacker read as investment, so the planner happily banked
 *  energy its attacker could never spend. Shared by the planner's
 *  investment term and the ML state encoder (schema v3). */
export function costProgress(mon: PokemonInPlay, cost: string[]): number {
  if (cost.length === 0) return 0;
  const pool = mon.attachedEnergy.flatMap((c) => energyUnits(c, mon));
  let paid = 0;
  for (const req of cost) {
    if (req === "Colorless") continue;
    let idx = pool.indexOf(req);
    if (idx === -1) idx = pool.findIndex((u) => unitPaysType(u, req));
    if (idx === -1) continue;
    pool.splice(idx, 1);
    paid += 1;
  }
  const colorless = cost.filter((c) => c === "Colorless").length;
  paid += Math.min(pool.length, colorless);
  return paid / cost.length;
}

/** v1 damage model: printed number + weakness/resistance. Attacks with
 *  state-scaled damage (Burning Darkness, Back Draft) go through
 *  attackBaseDamage in attacks.ts before this; plain attacks use the
 *  printed number here. */
export function computeDamage(
  attacker: PokemonInPlay,
  attack: EngineAttack,
  defender: PokemonInPlay,
): number {
  return applyWeaknessResistance(baseDamage(attack), attacker, defender);
}

/* ─── Evolution eligibility ─────────────────────────────────────── */

export function evolutionTargets(
  side: PlayerSide,
  evolvesFrom: string,
  turnNumber: number,
): PokemonInPlay[] {
  const inPlay = [side.active, ...side.bench].filter(
    (m): m is PokemonInPlay => m !== null,
  );
  return inPlay.filter(
    (mon) =>
      mon.card.name === evolvesFrom &&
      mon.enteredPlayOnTurn < turnNumber &&
      !mon.evolvedThisTurn,
  );
}

/* ─── Legal moves ───────────────────────────────────────────────── */

export function legalMoves(
  state: GameState,
  actor: "player" | "opponent",
  ctx: TurnContext,
): SimMove[] {
  const side = sideOf(state, actor);
  const moves: SimMove[] = [];
  const inPlay = [side.active, ...side.bench].filter(
    (m): m is PokemonInPlay => m !== null,
  );

  // A player cannot evolve on their own first turn of the game (global
  // turns 1 and 2). Per-mon "in play since last turn" is enforced in
  // evolutionTargets; this is the additional game-opening ban.
  const canEvolve = state.turn.playerTurnNumber > 1;
  // The very first turn of the game bans Supporters outright.
  const supporterBanned = state.turn.number === 1;

  const cap = benchCap(state, actor);
  for (const card of side.hand) {
    // Bench a basic.
    if (isBasic(card) && side.bench.length < cap) {
      // An ON-PLAY ability (Meowth ex, Bloodmoon Ursaluna) resolves as this
      // Pokémon hits the Bench, so its picks ride on the bench move. The
      // Pokémon isn't in play yet, so enumerate against a provisional instance.
      const onPlay = triggerEffect(card.name, "on_play");
      const combos = onPlay
        ? enumerateEffect(
            state,
            actor,
            { id: card.id, name: card.name },
            onPlay.effect,
            onPlay.index,
            toPokemonInPlay(card, state.turn.number),
          )
        : [];
      if (onPlay && combos.length > 0 && (onPlay.effect.targets?.length ?? 0) > 0) {
        for (const combo of combos) {
          moves.push({ kind: "bench", cardId: card.id, triggerPicks: combo.picks });
        }
      } else {
        moves.push({ kind: "bench", cardId: card.id });
      }
    }
    // Evolve.
    const from = card.catalog?.evolves_from;
    if (from && canEvolve) {
      for (const target of evolutionTargets(side, from, state.turn.number)) {
        // ON-EVOLVE abilities (Alakazam's Psychic Draw, Marnie's Grimmsnarl's
        // Punk Up) fire as the evolution lands; picks ride on the evolve move.
        const onEvo = triggerEffect(card.name, "on_evolve");
        const combos = onEvo
          ? enumerateEffect(
              state,
              actor,
              { id: card.id, name: card.name },
              onEvo.effect,
              onEvo.index,
              target,
            )
          : [];
        if (onEvo && combos.length > 0 && (onEvo.effect.targets?.length ?? 0) > 0) {
          for (const combo of combos) {
            moves.push({ kind: "evolve", cardId: card.id, targetId: target.id, triggerPicks: combo.picks });
          }
        } else {
          moves.push({ kind: "evolve", cardId: card.id, targetId: target.id });
        }
      }
    }
    // Attach energy (one per turn).
    if (side.energyAttachedThisTurn === 0 && energyProvides(card) !== null) {
      // An Energy with an ON-ATTACH effect (Telepathic, Jet, Enriching) may
      // need picks; those are enumerated per candidate target, since the
      // effect's guards read the Pokémon it lands on.
      const onAttach = onAttachEffect(card.name);
      for (const target of inPlay) {
        if (!onAttach) {
          moves.push({ kind: "attach", cardId: card.id, targetId: target.id });
          continue;
        }
        const combos = enumerateEffect(
          state,
          actor,
          { id: card.id, name: card.name },
          onAttach.effect,
          onAttach.index,
          target,
        );
        if (combos.length === 0) {
          // Guards fail on this target (Telepathic on a non-Psychic) — the
          // attach itself is still perfectly legal, just without the bonus.
          moves.push({ kind: "attach", cardId: card.id, targetId: target.id });
        } else if ((onAttach.effect.targets?.length ?? 0) === 0) {
          moves.push({ kind: "attach", cardId: card.id, targetId: target.id });
        } else {
          for (const combo of combos) {
            moves.push({
              kind: "attach",
              cardId: card.id,
              targetId: target.id,
              attachPicks: combo.picks,
            });
          }
        }
      }
    }
    // Stadium: one per turn, into play, unless one of the same name already
    // is (you may not replace a Stadium with an identical one).
    if (card.catalog?.supertype === "Trainer" && card.catalog.subtypes.includes("Stadium")) {
      if (!ctx.stadiumPlayed && state.stadium?.card.name !== card.name) {
        moves.push({ kind: "play_stadium", cardId: card.id });
      }
      continue;
    }
    // Pokémon Tool: attach to a Pokémon that isn't already holding one.
    if (isTool(card)) {
      for (const target of inPlay) {
        if (target.attachedTools.length === 0) {
          moves.push({ kind: "attach_tool", cardId: card.id, targetId: target.id });
        }
      }
      continue;
    }
    // Trainers: registered staples get their real effect; anything else
    // keeps the generic draw-cycle behavior.
    if (card.catalog?.supertype === "Trainer") {
      const supporter = isSupporter(card);
      const supporterOk = !supporter || (!side.supporterPlayedThisTurn && !supporterBanned);
      const spec = trainerSpec(card);
      const effects = spec ? [] : effectsFor(card.name);
      if (spec) {
        // Legacy staple registry takes precedence (tuned handling the AI
        // policies already understand); declarative records are consulted
        // only for cards the legacy registry doesn't cover.
        if (supporterOk) {
          moves.push(...trainerMoves(state, actor, card, spec));
        }
      } else if (effects.length > 0) {
        // Declarative-effect trainer (W2). Enumerate concrete moves with the
        // ORIGINAL effect index so validate/driver resolve the same record.
        if (supporterOk) {
          effects.forEach((effect, i) => {
            if (effect.trigger.kind !== "trainer") return;
            moves.push(...enumerateEffect(state, actor, { id: card.id, name: card.name }, effect, i));
          });
        }
      } else if (side.deck.length > 0) {
        if (supporter) {
          if (supporterOk) {
            moves.push({ kind: "cycle_supporter", cardId: card.id });
          }
        } else {
          moves.push({ kind: "cycle_item", cardId: card.id });
        }
      }
    }
  }

  // Activated abilities (once per turn per Pokémon; conditions checked).
  moves.push(...abilityMoves(state, actor));

  // Declarative activated abilities (W2) — same precedence rule as trainers:
  // the legacy ACTIVATED registry wins (its tuned moves are what the policies'
  // use_ability branches understand), and declarative records cover only the
  // abilities it doesn't. Source id is the MON's id, which is what validate
  // and applyEffect resolve the ability against.
  for (const mon of inPlay) {
    for (const ability of mon.card.catalog?.abilities ?? []) {
      if (hasLegacyActivated(mon.card.name, ability.name)) continue;
      for (const { effect, index } of abilityEffects(mon.card.name)) {
        if (effect.ability !== ability.name) continue;
        if (mon.abilitiesUsedThisTurn.includes(ability.name)) continue; // once per turn
        moves.push(
          ...enumerateEffect(state, actor, { id: mon.id, name: mon.card.name }, effect, index, mon),
        );
      }
    }
  }

  // Activated Stadium effect (Artazon), once per turn.
  moves.push(...stadiumMoves(state, actor, ctx.stadiumUsed ?? false));

  // Asleep / Paralyzed active can neither attack nor retreat this turn.
  const activeCanAct = side.active ? !cannotAct(side.active) : false;

  // Retreat (once per turn, cost payable, somewhere to go).
  if (
    activeCanAct &&
    !ctx.retreated &&
    side.active &&
    side.bench.length > 0 &&
    canRetreat(side.active, state)
  ) {
    for (let i = 0; i < side.bench.length; i++) {
      moves.push({ kind: "retreat", benchIndex: i });
    }
  }

  // Attack (ends the turn). Nobody attacks on the game's very first turn.
  if (activeCanAct && side.active && state.turn.number > 1) {
    for (const { index, attack } of usableAttacks(side.active, state)) {
      // A declarative rider with target slots multiplies the attack into one
      // move per pick combination; riderPicks rides on the attack move so the
      // whole attack (damage + rider) stays a single atomic decision.
      const rider = attackRiderEffect(side.active.card.name, attack.name);
      const combos = rider
        ? enumerateEffect(
            state,
            actor,
            { id: side.active.id, name: side.active.card.name },
            rider.effect,
            rider.index,
            side.active,
          )
        : [];
      if (rider && combos.length > 0 && (rider.effect.targets?.length ?? 0) > 0) {
        for (const combo of combos) {
          moves.push({ kind: "attack", attackIndex: index, riderPicks: combo.picks });
        }
      } else {
        // No rider, a target-less rider (resolved via `self`), or a rider whose
        // required target has no candidate — the attack itself is still legal.
        moves.push({ kind: "attack", attackIndex: index });
      }
    }
  }

  moves.push({ kind: "pass" });
  return moves;
}
