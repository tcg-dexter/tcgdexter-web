// Effect primitives (W2) — the apply-side library. Each op mutates game state
// given already-resolved targets (the runtime resolves TargetSpecs into
// concrete Pokémon/cards from the move's picks, then calls these). These
// mirror the semantics of the hand-written applyTrainer/applyAbility switch
// arms exactly, so the migration is behavior-preserving.

import type { CardInstance, GameState, PlayerSide, PokemonInPlay } from "../../types";
import { shuffle, type Rng } from "../rng";
import { benchCap } from "../stadiums";
import { toPokemonInPlay } from "../setup";
import { applyCondition, clearConditions } from "../conditions";
import { placeCounters, moveCounters, dealRawDamage } from "../damage";
import { applyWeaknessResistance } from "../moves";
import { pickDiscards } from "../trainers";
import { cardMatches } from "./match";
import { guardsPass } from "./guards";
import type { EffectOp, Quantity } from "./types";

type Actor = "player" | "opponent";
const other = (a: Actor): Actor => (a === "player" ? "opponent" : "player");

export interface ResolvedMon {
  mon: PokemonInPlay;
  side: Actor;
}
export interface ResolvedTarget {
  mons: ResolvedMon[];
  cards: CardInstance[];
}
export type ResolvedTargets = Record<string, ResolvedTarget>;

export interface OpContext {
  state: GameState;
  actor: Actor;
  targets: ResolvedTargets;
  rng: Rng | null;
  /** The effect's source Pokémon (ability owner / attacker), when there is
   *  one. Also bound as the reserved `self` target ref. */
  source?: PokemonInPlay | null;
}

/* ─── Zone helpers (mirror trainers.ts semantics) ───────────────── */

function draw(side: PlayerSide, n: number): void {
  side.hand.push(...side.deck.splice(0, Math.max(0, n)));
}
function spliceById(zone: CardInstance[], id: string): CardInstance | null {
  const i = zone.findIndex((c) => c.id === id);
  return i >= 0 ? zone.splice(i, 1)[0] : null;
}
function resolveQty(q: Quantity, side: PlayerSide): number {
  if (q === "own_prizes" || q === "opp_prizes") return side.prizes.length;
  return q;
}
function mons(ctx: OpContext, ref: string): ResolvedMon[] {
  return ctx.targets[ref]?.mons ?? [];
}
function cards(ctx: OpContext, ref: string): CardInstance[] {
  return ctx.targets[ref]?.cards ?? [];
}

/** Move a Bench Pokémon into the Active Spot, swapping the old Active to the
 *  vacated Bench slot. Leaving the Active Spot clears Special Conditions. */
function promoteFromBench(side: PlayerSide, benchMon: PokemonInPlay, turn?: number): void {
  const idx = side.bench.indexOf(benchMon);
  if (idx < 0 || !side.active) return;
  clearConditions(side.active);
  side.bench[idx] = side.active;
  if (turn != null) benchMon.movedToActiveOnTurn = turn;
  side.active = benchMon;
}

/* ─── Op interpreter ────────────────────────────────────────────── */

export function applyOp(op: EffectOp, ctx: OpContext): void {
  const { state, actor, rng } = ctx;
  const side = state.sides[actor];
  const opp = state.sides[other(actor)];

  switch (op.op) {
    case "draw":
      draw(side, resolveQty(op.n, side));
      break;

    case "shuffle_hand_draw": {
      side.deck.push(...side.hand);
      side.hand = [];
      if (rng) shuffle(side.deck, rng);
      draw(side, resolveQty(op.n, side));
      break;
    }

    case "discard_hand_draw": {
      side.discard.push(...side.hand);
      side.hand = [];
      draw(side, resolveQty(op.n, side));
      break;
    }

    case "hand_to_bottom_draw": {
      const sides: Actor[] =
        op.who === "both" ? [actor, other(actor)] : op.who === "own" ? [actor] : [other(actor)];
      for (const s of sides) {
        const ps = state.sides[s];
        const n = resolveQty(op.n, ps);
        ps.deck.push(...ps.hand); // to the bottom (deck top is index 0)
        ps.hand = [];
        draw(ps, n);
      }
      break;
    }

    case "search":
    case "retrieve": {
      const zone = op.op === "search" ? side.deck : side.discard;
      const pulledCards: CardInstance[] = [];
      for (const card of cards(ctx, op.targetRef)) {
        const pulled = spliceById(zone, card.id);
        if (!pulled) continue;
        if (op.to === "bench" && side.bench.length < benchCap(state, actor)) {
          side.bench.push(toPokemonInPlay(pulled, state.turn.number));
        } else if (op.to === "deck_top") {
          pulledCards.push(pulled); // placed AFTER the shuffle, below
        } else {
          side.hand.push(pulled);
        }
      }
      if (op.op === "search" && rng) shuffle(side.deck, rng);
      // "Shuffle your deck, THEN put those cards on top" (Ciphermaniac's
      // Codebreaking) — the order matters, or the setup gets shuffled away.
      if (pulledCards.length > 0) side.deck.unshift(...pulledCards);
      break;
    }

    case "attach_energy": {
      const target = mons(ctx, op.monRef)[0];
      const zone = op.from === "deck" ? side.deck : side.discard;
      for (const energy of cards(ctx, op.energyRef)) {
        const pulled = spliceById(zone, energy.id);
        if (pulled && target) target.mon.attachedEnergy.push(pulled);
      }
      if (op.from === "deck" && rng) shuffle(side.deck, rng);
      break;
    }

    case "shuffle_deck":
      if (rng) shuffle(side.deck, rng);
      break;

    case "gust": {
      const picked = mons(ctx, op.monRef)[0];
      if (picked && picked.side === other(actor)) promoteFromBench(opp, picked.mon, state.turn.number);
      break;
    }
    case "switch": {
      const picked = mons(ctx, op.monRef)[0];
      if (picked && picked.side === actor) promoteFromBench(side, picked.mon, state.turn.number);
      break;
    }

    case "damage_mon":
      for (const { mon, side: monSide } of mons(ctx, op.monRef)) {
        // W/R applies in the Active spot only — Benched Pokémon take the raw
        // number (the parenthetical on Cruel Arrow and its kin).
        const isActive = state.sides[monSide].active === mon;
        const amount =
          isActive && ctx.source
            ? applyWeaknessResistance(op.amount, ctx.source, mon)
            : op.amount;
        dealRawDamage(mon, amount);
      }
      break;

    case "place_counters":
      for (const { mon } of mons(ctx, op.monRef)) placeCounters(mon, op.n);
      break;

    case "move_counters": {
      const from = mons(ctx, op.fromRef)[0];
      const to = mons(ctx, op.toRef)[0];
      if (from && to) moveCounters(from.mon, to.mon, op.n);
      break;
    }

    case "apply_condition":
      for (const { mon } of mons(ctx, op.monRef)) applyCondition(mon, op.condition);
      break;

    case "heal":
      for (const { mon } of mons(ctx, op.monRef)) {
        mon.damage = op.n === "all" ? 0 : Math.max(0, mon.damage - op.n);
      }
      break;

    case "clear_conditions":
      for (const { mon } of mons(ctx, op.monRef)) clearConditions(mon);
      break;

    case "discard_to_deck": {
      // Shuffle matching cards from the discard back into the deck.
      let moved = 0;
      for (const card of [...side.discard]) {
        if (moved >= op.max) break;
        if (!cardMatches(card, op.filter)) continue;
        const pulled = spliceById(side.discard, card.id);
        if (pulled) {
          side.deck.push(pulled);
          moved++;
        }
      }
      if (moved > 0 && rng) shuffle(side.deck, rng);
      break;
    }

    case "move_energy": {
      const from = mons(ctx, op.fromRef)[0];
      const to = mons(ctx, op.toRef)[0];
      if (!from || !to || from.mon === to.mon) break;
      let moved = 0;
      for (const card of [...from.mon.attachedEnergy]) {
        if (moved >= op.count) break;
        if (!cardMatches(card, op.filter)) continue;
        const i = from.mon.attachedEnergy.findIndex((c) => c.id === card.id);
        if (i >= 0) {
          to.mon.attachedEnergy.push(...from.mon.attachedEnergy.splice(i, 1));
          moved++;
        }
      }
      break;
    }

    case "draw_until": {
      let target = op.n;
      if (op.bonus && guardsPass(state, actor, ctx.source ?? null, [op.bonus.when])) {
        target = op.bonus.n;
      }
      draw(side, Math.max(0, target - side.hand.length));
      break;
    }

    case "discard_hand_down_to": {
      const who: Actor[] =
        op.who === "both" ? [other(actor), actor] : op.who === "own" ? [actor] : [other(actor)];
      for (const w of who) {
        const ps = state.sides[w];
        while (ps.hand.length > op.n) {
          const chosen = pickDiscards(ps, 1, "")[0] ?? ps.hand[0];
          const i = ps.hand.findIndex((c) => c.id === chosen.id);
          if (i < 0) break;
          ps.discard.push(...ps.hand.splice(i, 1));
        }
      }
      break;
    }

    case "discard_from_hand": {
      const ps = op.who === "own" ? side : opp;
      let n = 0;
      for (const card of [...ps.hand]) {
        if (n >= op.max) break;
        if (!cardMatches(card, op.filter)) continue;
        const pulled = spliceById(ps.hand, card.id);
        if (pulled) {
          ps.discard.push(pulled);
          n++;
        }
      }
      break;
    }

    case "bounce_to_hand": {
      for (const { mon, side: monSide } of mons(ctx, op.monRef)) {
        const ps = state.sides[monSide];
        // Everything attached rides along: the card, its evolution stack,
        // energy and tools all return to hand.
        const returned = [mon.card, ...mon.stack, ...mon.attachedEnergy, ...mon.attachedTools];
        if (ps.active === mon) {
          ps.active = null;
        } else {
          const i = ps.bench.indexOf(mon);
          if (i >= 0) ps.bench.splice(i, 1);
        }
        ps.hand.push(...returned);
      }
      break;
    }

    case "evolve_from_deck": {
      const target = mons(ctx, op.monRef)[0];
      if (!target) break;
      const idx = side.deck.findIndex(
        (c) => cardMatches(c, op.filter) && c.catalog?.evolves_from === target.mon.card.name,
      );
      if (idx >= 0) {
        const [evo] = side.deck.splice(idx, 1);
        target.mon.stack.push(target.mon.card);
        target.mon.card = evo;
        target.mon.evolvedThisTurn = true;
        target.mon.conditions = [];
      }
      if (rng) shuffle(side.deck, rng);
      break;
    }

    case "discard_from_mon": {
      for (const { mon, side: monSide } of mons(ctx, op.monRef)) {
        const ownerDiscard = state.sides[monSide].discard;
        if (op.category === "tool") {
          if (mon.attachedTools.length > 0) ownerDiscard.push(...mon.attachedTools.splice(0, 1));
        } else if (op.category === "energy") {
          // Any Energy (Crushing Hammer) — take the first attached.
          if (mon.attachedEnergy.length > 0) ownerDiscard.push(...mon.attachedEnergy.splice(0, 1));
        } else {
          const i = mon.attachedEnergy.findIndex(
            (c) => c.catalog?.supertype === "Energy" && !isBasicEnergyName(c),
          );
          if (i >= 0) ownerDiscard.push(...mon.attachedEnergy.splice(i, 1));
        }
      }
      break;
    }

    case "reveal_top": {
      // Look at the top n, take up to `count` matches, rest back to the deck
      // (then shuffled, matching "shuffle the other cards back into your deck").
      const top = side.deck.splice(0, Math.max(0, op.n));
      let taken = 0;
      const rest: CardInstance[] = [];
      for (const c of top) {
        if (taken < op.count && cardMatches(c, op.filter)) {
          side.hand.push(c);
          taken++;
        } else {
          rest.push(c);
        }
      }
      side.deck.unshift(...rest);
      if (rng) shuffle(side.deck, rng);
      break;
    }

    case "discard_hand_cards": {
      // A cost: the played card has already left the hand by this point, so
      // every remaining card is fair game.
      for (const c of pickDiscards(side, op.n, "")) {
        const pulled = spliceById(side.hand, c.id);
        if (pulled) side.discard.push(pulled);
      }
      break;
    }

    case "coin_flip": {
      // No rng (ghost evaluation) reads as tails — the conservative branch,
      // so a speculative evaluation never over-credits the flip.
      const heads = rng ? rng() < 0.5 : false;
      applyOps(heads ? op.heads : (op.tails ?? []), ctx);
      break;
    }

    case "buff_damage_this_turn":
      (side.damageBuffs ??= []).push({
        turn: state.turn.number,
        amount: op.amount,
        vsTarget: op.vsTarget,
        attackerType: op.attackerType,
      });
      break;
  }
}

function isBasicEnergyName(c: CardInstance): boolean {
  return (
    c.catalog?.supertype === "Energy" &&
    (c.catalog.subtypes.includes("Basic") || c.name.startsWith("Basic "))
  );
}

/** Apply a card effect's full op list in order. */
export function applyOps(ops: EffectOp[], ctx: OpContext): void {
  for (const op of ops) applyOp(op, ctx);
}
