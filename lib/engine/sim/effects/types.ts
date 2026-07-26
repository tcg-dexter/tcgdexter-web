// Declarative effect schema (W2). A card's non-vanilla behavior is DATA — a
// CardEffect assembled from composable primitives — instead of a hand-written
// switch arm in the driver. The interpreter (runtime.ts) compiles a CardEffect
// into the engine's existing enumerate-then-validate move model.
//
// Grounded in the ~35 effects hand-written to date (trainers/abilities/attacks/
// stadiums/tools): the triggers, guards, target shapes, and primitives below
// are exactly what those cards decompose into, not a speculative superset.

import type { SpecialCondition } from "@/lib/battle-log/types";

/* ─── Filters ───────────────────────────────────────────────────── */

/** Matches a card in a hidden/known zone (deck, discard, hand) for search /
 *  retrieve / attach-source selection. */
export interface CardFilter {
  supertype?: "Pokémon" | "Trainer" | "Energy";
  subtype?: string; // e.g. "Supporter", "Item", "Basic", "ex"
  basicPokemon?: boolean; // Basic (no evolves_from)
  basicEnergy?: boolean; // a Basic Energy card
  energyType?: string; // provides this type (Darkness, Fire, …)
  namePrefix?: string; // e.g. "N's "
  maxHp?: number;
  singlePrize?: boolean; // prizeValue === 1 (no rule box)
}

/** Matches a Pokémon in play for a target slot. */
export interface MonFilter {
  side: "own" | "opponent";
  zone: "active" | "bench" | "in_play";
  type?: string; // catalog type (Darkness, …)
  namePrefix?: string; // "N's "
  basic?: boolean;
  hasTool?: boolean;
  hasSpecialEnergy?: boolean;
  damaged?: boolean; // damage >= 10
  excludeName?: string; // e.g. "Pecharunt ex" (can't switch into itself)
}

/* ─── Targets ───────────────────────────────────────────────────── */

/** A named target slot the interpreter resolves. `player` choosers enumerate
 *  concrete moves; `auto` collapses to a heuristic pick; `all` hits every
 *  match with no choice. */
export interface TargetSpec {
  ref: string; // referenced by ops (e.g. "mon", "energy")
  select: "mon" | "card"; // in-play Pokémon vs a card in a zone
  mon?: MonFilter; // when select === "mon"
  card?: { zone: "deck" | "discard" | "hand"; side?: "own" | "opponent"; filter: CardFilter };
  count?: number; // default 1
  upTo?: boolean; // "up to N" (0..N) vs exactly N
  chooser: "player" | "auto" | "all";
}

/* ─── Triggers & guards ─────────────────────────────────────────── */

export type Trigger =
  | { kind: "trainer"; subtype: "Supporter" | "Item" | "Stadium" | "Tool" }
  | { kind: "activated" } // once/turn/Pokémon ability
  | { kind: "on_play" } // played from hand onto the Bench (Meowth ex)
  | { kind: "on_evolve" }
  | { kind: "attack_rider"; attackName: string } // resolves after the attack's damage
  | { kind: "static" }; // passive; read where the rule applies

/** Availability conditions, all public-information. */
export type Guard =
  | { cond: "opp_prizes_lte"; n: number }
  | { cond: "self_prizes_lte"; n: number }
  | { cond: "is_active" } // the source Pokémon is the Active
  | { cond: "koed_last_opp_turn" }
  | { cond: "has_energy_type"; type: string } // source has this energy attached
  | { cond: "deck_has"; filter: CardFilter }
  | { cond: "discard_has"; filter: CardFilter };

/* ─── Effect primitives ─────────────────────────────────────────── */

/** `n` can be a fixed count or a dynamic quantity read at apply time. */
export type Quantity = number | "own_prizes" | "opp_prizes";

export type EffectOp =
  | { op: "draw"; n: Quantity }
  | { op: "shuffle_hand_draw"; n: Quantity } // shuffle own hand into deck, draw n
  | { op: "discard_hand_draw"; n: Quantity } // discard own hand, draw n
  | { op: "hand_to_bottom_draw"; n: Quantity; who: "own" | "opponent" | "both" }
  // Route resolved picks (a card TargetSpec) into a destination zone. `search`
  // pulls from the deck (then shuffles), `retrieve` from the discard pile.
  | { op: "search"; targetRef: string; to: "hand" | "bench" }
  | { op: "retrieve"; targetRef: string; to: "hand" | "bench" }
  // Move resolved energy cards (a card TargetSpec) onto a resolved mon.
  | { op: "attach_energy"; energyRef: string; monRef: string; from: "deck" | "discard" }
  | { op: "shuffle_deck" }
  | { op: "gust"; monRef: string } // swap opponent's chosen Bench mon to Active
  | { op: "switch"; monRef: string } // swap own chosen Bench mon to Active
  | { op: "place_counters"; monRef: string; n: number }
  | { op: "move_counters"; fromRef: string; toRef: string; n: number }
  | { op: "apply_condition"; monRef: string; condition: SpecialCondition }
  | { op: "heal"; monRef: string; n: number }
  | { op: "discard_from_mon"; monRef: string; category: "tool" | "special_energy" }
  | { op: "buff_damage_this_turn"; amount: number; vsTarget?: "ex" }; // Black Belt's Training

/* ─── Card effect ───────────────────────────────────────────────── */

export interface CardEffect {
  /** Exact card name (Pokémon effects also carry `ability`/attack in trigger). */
  card: string;
  /** Ability name when the trigger is `activated` / `on_play` / `on_evolve`. */
  ability?: string;
  trigger: Trigger;
  guards?: Guard[];
  targets?: TargetSpec[];
  ops: EffectOp[];
}
