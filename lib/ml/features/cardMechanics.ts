// What a card DOES, as a fixed-length vector.
//
// The policy features carry 32 hard-coded card NAMES (POLICY_TOP_CARDS, a
// frozen July snapshot), and training drops even those by default because a
// name indicator is pure memorisation: it cannot say anything about a card
// the model has not seen, and with ~20k effective samples it overfits the
// decks in the corpus. So the promoted value model reasons about the board
// in card-agnostic aggregates — `hand_supporters: 3` reads the same whether
// those are three Boss's Orders or three Iono, which are completely
// different turns.
//
// The fix is not a bigger one-hot. W2/W3 already encoded 197 cards as DATA:
// triggers, target slots, and 44 composable ops. That schema is a
// precondition/effect representation, which is exactly what a planner needs
// and exactly what "what would this card do for me" means. This module reads
// it and turns a card name into behaviour.
//
// Why behaviour generalises where names do not: a new gust Supporter that
// nobody has authored a feature for still encodes as `gust: 1`, and the
// model's learned response to gusting applies to it on arrival. A name slot
// would read all-zero and the card would be invisible.
//
// Deliberately COARSE. These are capability buckets, not a faithful
// re-encoding of the schema: "how much draw", "how much acceleration", "can
// it gust", not the exact target filter. A faithful encoding would be as
// wide as the schema itself and would reintroduce the dimensionality problem
// this exists to avoid.

import { lookupCard } from "@/lib/engine/catalog";
import { effectsFor } from "@/lib/engine/sim/effects/cards";
import { TRAINER_EFFECTS, type TrainerSpec } from "@/lib/engine/sim/trainers";
import type { EffectOp, Quantity } from "@/lib/engine/sim/effects/types";
import type { EngineCard } from "@/lib/engine/types";
import { prizeValue } from "@/lib/engine/sim/setup";

/** Bump on any change to the field set or a field's meaning — this rides on
 *  POLICY_SCHEMA_VERSION, which training uses to refuse mixed corpora. */
export const CARD_MECHANICS_VERSION = 1;

/** A state-dependent quantity ("draw until 5", "counters per prize taken")
 *  has no fixed value outside a game. Scoring it as a nominal 2 keeps the
 *  feature finite and ordered against literal counts without pretending to
 *  know the board — the alternative, 0, would read as "does nothing". */
const DYNAMIC_QUANTITY = 2;

function qty(n: Quantity | undefined): number {
  if (n === undefined) return 0;
  return typeof n === "number" ? n : DYNAMIC_QUANTITY;
}

export interface CardMechanics {
  /* ── identity by role, not by name ── */
  is_pokemon: number;
  is_trainer: number;
  is_energy: number;
  is_supporter: number;
  is_item: number;
  is_stadium: number;
  is_tool: number;
  is_basic_energy: number;
  is_ace_spec: number;

  /* ── Pokémon shape ── */
  hp: number;
  retreat_cost: number;
  prize_value: number;
  /** 0 basic, 1 stage 1, 2 stage 2 — how much setup the card costs. */
  stage: number;
  has_ability: number;
  /** Best printed damage, and what it costs to reach it. A route's payoff. */
  max_damage: number;
  max_damage_cost: number;
  /** Damage per energy at the best attack — the efficiency a route buys. */
  damage_per_energy: number;
  /** The attack locks itself out next turn (the price of the big numbers). */
  has_self_lock: number;

  /* ── capabilities, from the declarative schema ── */
  draw_power: number;
  search_power: number;
  retrieve_power: number;
  /** Energy attached from deck/discard — acceleration, not the turn's attach. */
  energy_accel: number;
  gust: number;
  self_switch: number;
  /** Anything that costs the OPPONENT resources from hand. */
  disruption: number;
  /** Damage or counters placed outside the attack's own Active hit. */
  extra_damage: number;
  heal: number;
  /** Applies a special condition or a turn-scoped status. */
  status: number;
  /** Removes something from the board (bounce, shuffle back, KO). */
  removal: number;
  /** Puts a Pokémon into play or evolves one out of the deck. */
  board_growth: number;
  /** Copies another attack (N's Zoroark, Slowking). */
  copies_attack: number;
  /** Changes prizes taken or the prize count. */
  prize_effect: number;
  /** Costs cards out of our OWN hand to play. */
  self_cost: number;
  /** Has any declarative effect at all — separates modelled from vanilla. */
  has_effect: number;
}

const ZERO: CardMechanics = {
  is_pokemon: 0, is_trainer: 0, is_energy: 0, is_supporter: 0, is_item: 0,
  is_stadium: 0, is_tool: 0, is_basic_energy: 0, is_ace_spec: 0,
  hp: 0, retreat_cost: 0, prize_value: 0, stage: 0, has_ability: 0,
  max_damage: 0, max_damage_cost: 0, damage_per_energy: 0, has_self_lock: 0,
  draw_power: 0, search_power: 0, retrieve_power: 0, energy_accel: 0,
  gust: 0, self_switch: 0, disruption: 0, extra_damage: 0, heal: 0,
  status: 0, removal: 0, board_growth: 0, copies_attack: 0, prize_effect: 0,
  self_cost: 0, has_effect: 0,
};

/** Stable field order. Scorers map by NAME, but the vector order must not
 *  drift between encode calls, so it is pinned from the zero value once. */
export const MECHANICS_FIELDS = Object.keys(ZERO) as (keyof CardMechanics)[];

/** Feature names for a mechanics block under `prefix` (e.g. "move_card"). */
export function mechanicsFeatureNames(prefix: string): string[] {
  return MECHANICS_FIELDS.map((f) => `${prefix}_${f}`);
}

function applyOp(m: CardMechanics, op: EffectOp): void {
  switch (op.op) {
    case "draw":
    case "shuffle_hand_draw":
    case "discard_hand_draw":
      m.draw_power += qty(op.n);
      break;
    case "draw_until":
      // "Draw until you have N" is worth roughly the gap, not N.
      m.draw_power += Math.max(1, op.n - 3);
      break;
    case "hand_to_bottom_draw":
      m.draw_power += qty(op.n);
      if (op.who !== "own") m.disruption += 1;
      break;
    case "search":
      // to:"bench" puts a body into play, which is a different service from
      // filling your hand — a route needs the body.
      m.search_power += 1;
      if (op.to === "bench") m.board_growth += 1;
      break;
    case "retrieve":
      m.retrieve_power += 1;
      if (op.to === "bench") m.board_growth += 1;
      break;
    case "attach_energy":
      m.energy_accel += op.from === "hand" ? 0.5 : 1;
      break;
    case "move_energy":
      m.energy_accel += 0.5; // redistributes rather than adds
      break;
    case "discard_to_deck":
      m.retrieve_power += 1;
      break;
    case "discard_hand_down_to":
    case "discard_from_hand":
      if (op.who !== "own") m.disruption += 1;
      else m.self_cost += 1;
      break;
    case "discard_hand_cards":
    case "discard_self_card":
    case "discard_from_mon":
    case "discard_energy":
      m.self_cost += 1;
      break;
    case "gust":
      m.gust += 1;
      break;
    case "opponent_switches_active":
      m.gust += 0.5; // they choose, so it is weaker than a gust
      break;
    case "switch":
      m.self_switch += 1;
      break;
    case "damage_mon":
      m.extra_damage += op.amount;
      break;
    case "place_counters":
      m.extra_damage += qty(op.n) * 10 * (op.per ?? 1);
      break;
    case "counters_on_all":
    case "counters_on_attacker":
    case "damage_opponent_bench":
    case "damage_self":
      m.extra_damage += 10;
      break;
    case "move_counters":
      m.extra_damage += op.n * 10;
      m.heal += op.n * 10;
      break;
    case "heal":
      m.heal += op.n === "all" ? 100 : op.n;
      break;
    case "clear_conditions":
      m.heal += 10;
      break;
    case "apply_condition":
    case "apply_status":
      m.status += 1;
      break;
    case "bounce_to_hand":
    case "shuffle_mons_to_deck":
    case "ko_if_counters":
    case "discard_stadium":
      m.removal += 1;
      break;
    case "ko_self":
      m.self_cost += 2;
      break;
    case "evolve_from_deck":
      m.board_growth += 1;
      break;
    case "use_copied_attack":
      m.copies_attack += 1;
      break;
    case "prize_bonus_this_turn":
    case "reset_prizes":
      m.prize_effect += 1;
      break;
    default:
      // shuffle_deck, reveal_top, coin_flip, swap_with_discard, energy_to_hand
      // and friends: real ops with no capability bucket of their own. They are
      // covered by has_effect rather than given a slot that would be nearly
      // always zero.
      break;
  }
}

/** The LEGACY trainer registry, which the declarative schema deliberately
 *  does not cover.
 *
 *  W2's precedence rule kept the tuned staples on their hand-written path and
 *  gave the declarative registry only the cards the legacy one lacks. The
 *  consequence for THIS module is severe and was caught by reading the
 *  output: 16 trainers are legacy-only, and they are the most-played cards in
 *  the format — Ultra Ball, Iono, Rare Candy, Buddy-Buddy Poffin, Night
 *  Stretcher, Judge, Switch. Encoding only the declarative half would have
 *  left the model blind to exactly the cards it sees most, and an A/B would
 *  have read as "card knowledge does not help" when it was a coverage hole.
 *
 *  So the legacy specs are mapped by hand here. It is a short, closed list
 *  (20 entries) that shrinks as cards migrate to the declarative path, and a
 *  test pins that every entry stays covered. */
function applyLegacySpec(m: CardMechanics, spec: TrainerSpec): void {
  const e = spec.effect;
  switch (e.kind) {
    case "deck_search":
      m.search_power += e.count;
      if (e.to === "bench") m.board_growth += e.count;
      if (e.discardCost) m.self_cost += e.discardCost;
      break;
    case "hilda": // search 2 cards out of the deck to hand
      m.search_power += 2;
      break;
    case "night_stretcher": // a Pokémon OR a basic Energy back from discard
      m.retrieve_power += 1;
      break;
    case "crispin": // an Energy attached from deck + one to hand
      m.energy_accel += 1;
      m.search_power += 1;
      break;
    case "shuffle_hand_draw":
      m.draw_power += e.drawAtSixPrizes ?? e.draw;
      break;
    case "discard_hand_draw":
      m.draw_power += e.draw;
      m.self_cost += 1;
      break;
    case "judge": // both hands to 4 — draw for us, disruption for them
      m.draw_power += 4;
      m.disruption += 1;
      break;
    case "iono": // both shuffle and draw by prizes remaining
      m.draw_power += DYNAMIC_QUANTITY;
      m.disruption += 1;
      break;
    case "gust":
      m.gust += 1;
      break;
    case "switch_active":
      m.self_switch += 1;
      break;
    case "rare_candy": // skips a whole stage of setup — pure board growth
      m.board_growth += 2;
      break;
    case "black_belt": // +40 damage this turn vs an ex
      m.extra_damage += 40;
      break;
    case "ns_pp_up": // basic Energy from the discard onto a Pokémon
      m.energy_accel += 1;
      break;
    case "special_red_card": // opponent's hand to 4
      m.disruption += 1;
      break;
    case "janine": // Poison two of your Darkness Pokémon's targets
      m.status += 1;
      break;
    case "ruffian":
      m.disruption += 1;
      break;
    default:
      break;
  }
}

/** Best printed attack and its cost — the payoff a route is aiming at. */
function attackShape(card: EngineCard): {
  max: number;
  cost: number;
  perEnergy: number;
  selfLock: number;
} {
  let max = 0;
  let cost = 0;
  let selfLock = 0;
  for (const a of card.attacks ?? []) {
    const dmg = parseInt(a.damage, 10);
    const d = Number.isFinite(dmg) ? dmg : 0;
    if (d > max) {
      max = d;
      cost = a.cost?.length ?? 0;
      // "During your next turn, this Pokémon can't use <attack>" — the price
      // the game charges for the biggest numbers, and a route has to plan
      // around it.
      selfLock = /can't use|cannot use/i.test(a.text ?? "") ? 1 : 0;
    }
  }
  return { max, cost, perEnergy: cost > 0 ? max / cost : max, selfLock };
}

const cache = new Map<string, CardMechanics>();

/** Behavioural encoding of a card name. Memoised: the corpus asks for the
 *  same few hundred names millions of times. */
export function mechanicsOf(name: string): CardMechanics {
  const hit = cache.get(name);
  if (hit) return hit;
  const m: CardMechanics = { ...ZERO };
  const card = lookupCard(name);
  if (card) {
    const subs = card.subtypes ?? [];
    m.is_pokemon = card.supertype === "Pokémon" ? 1 : 0;
    m.is_trainer = card.supertype === "Trainer" ? 1 : 0;
    m.is_energy = card.supertype === "Energy" ? 1 : 0;
    m.is_supporter = subs.includes("Supporter") ? 1 : 0;
    m.is_item = subs.includes("Item") ? 1 : 0;
    m.is_stadium = subs.includes("Stadium") ? 1 : 0;
    m.is_tool = subs.includes("Pokémon Tool") ? 1 : 0;
    m.is_basic_energy = m.is_energy && subs.includes("Basic") ? 1 : 0;
    m.is_ace_spec = subs.includes("ACE SPEC") ? 1 : 0;

    if (m.is_pokemon) {
      m.hp = card.hp ?? 0;
      m.retreat_cost = card.retreat_cost ?? 0;
      m.prize_value = prizeValue(name);
      m.stage = subs.includes("Stage 2") ? 2 : subs.includes("Stage 1") ? 1 : 0;
      m.has_ability = (card.abilities ?? []).length > 0 ? 1 : 0;
      const shape = attackShape(card);
      m.max_damage = shape.max;
      m.max_damage_cost = shape.cost;
      m.damage_per_energy = shape.perEnergy;
      m.has_self_lock = shape.selfLock;
    }
  }

  // Every declarative effect the card carries, across all its triggers. An
  // attack rider and an activated ability are both "things this card can do
  // for me", and the distinction is already carried by is_pokemon/stage.
  // The legacy registry WINS: the engine checks TRAINER_EFFECTS first and
  // never reaches the declarative entry, so applying both would encode a card
  // that does not exist. Four names carry both — reading them additively gave
  // Boss's Orders gust=2 and Professor's Research draw_power=14, which is the
  // failure this branch exists to prevent.
  const legacy = TRAINER_EFFECTS[name];
  const effects = legacy ? [] : effectsFor(name);
  if (legacy) applyLegacySpec(m, legacy);
  else for (const e of effects) for (const op of e.ops) applyOp(m, op);
  m.has_effect = legacy != null || effects.length > 0 ? 1 : 0;

  cache.set(name, m);
  return m;
}

/** The mechanics vector, in MECHANICS_FIELDS order. */
export function mechanicsVector(name: string): number[] {
  const m = mechanicsOf(name);
  return MECHANICS_FIELDS.map((f) => m[f]);
}

/** Element-wise sum over a set of cards — the "what can this zone do for me"
 *  aggregate the state encoder needs. Counts, not presence: two Boss's
 *  Orders is a materially different hand from one. */
export function mechanicsSum(names: readonly string[]): number[] {
  const out = new Array<number>(MECHANICS_FIELDS.length).fill(0);
  for (const n of names) {
    const m = mechanicsOf(n);
    for (let i = 0; i < MECHANICS_FIELDS.length; i++) out[i] += m[MECHANICS_FIELDS[i]];
  }
  return out;
}
