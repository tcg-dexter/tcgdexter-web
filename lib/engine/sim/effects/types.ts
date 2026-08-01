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
  /** Evolution stage (Dawn asks for one of each). */
  stage?: "Basic" | "Stage 1" | "Stage 2";
  /** Matches when ANY sub-filter matches. The rest of this filter's fields
   *  still apply (AND), so `anyOf` is the one disjunctive escape hatch —
   *  Bug Catching Set's "Grass Pokémon OR Basic Grass Energy". */
  anyOf?: CardFilter[];
  basicEnergy?: boolean; // a Basic Energy card
  energyType?: string; // ENERGY card providing this type (Darkness, Fire, …)
  pokemonType?: string; // POKÉMON card of this type (Bug Catching Set's Grass)
  namePrefix?: string; // e.g. "N's "
  nameContains?: string; // e.g. "Team Rocket", "Antique"
  maxHp?: number;
  singlePrize?: boolean; // prizeValue === 1 (no rule box)
}

/** Matches a Pokémon in play for a target slot. */
export interface MonFilter {
  side: "own" | "opponent";
  zone: "active" | "bench" | "in_play";
  type?: string; // catalog type (Darkness, …)
  namePrefix?: string; // "N's "
  nameContains?: string;
  basic?: boolean;
  isEx?: boolean; // a Pokémon ex (rule-box; Rising Blade's "+80 vs ex")
  subtype?: string; // catalog subtype (Tera, Stage 2, …)
  hasTool?: boolean;
  hasSpecialEnergy?: boolean;
  damaged?: boolean; // damage >= 10
  excludeName?: string; // e.g. "Pecharunt ex" (can't switch into itself)
}

/* ─── Targets ───────────────────────────────────────────────────── */

/** Reserved target ref, always bound by the runtime (never declared as a
 *  TargetSpec): the effect's SOURCE Pokémon — the ability's owner, or the
 *  attacker for an `attack_rider`. Riders lean on it constantly ("heal this
 *  Pokémon", "switch this Pokémon"), and binding it avoids enumerating a
 *  one-candidate target slot on every attack. */
export const SELF_REF = "self";

/** Reserved ref for the ACTING player's own Active Pokémon, bound by the
 *  runtime. Needed by effects that can rebound onto you (Venture Bomb's
 *  tails) where there is no `self` source Pokémon. */
export const OWN_ACTIVE_REF = "own_active";

/** Reserved ref for the OPPONENT's Active — the Defending Pokémon. Bound by
 *  the runtime so riders can debuff it without declaring a target slot. */
export const DEFENDER_REF = "defender";

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
  // Fires when this card is attached from hand to a Pokémon (Jet Energy's
  // switch, Enriching Energy's draw). Not a move of its own — it resolves
  // inside the `attach` move, like an attack rider inside its attack.
  | { kind: "on_attach" }
  /** The holder was damaged by an opponent's attack (Lucky Helmet, Handheld
   *  Fan, Spiky Energy). Fires even if the holder is knocked out. */
  | { kind: "on_damaged" }
  /** End of the holder's controller's turn, after the attack (Powerglass,
   *  Ignition Energy's self-discard). */
  | { kind: "end_of_turn" }
  /** Pokémon Checkup between turns (Froslass's Freezing Shroud). */
  | { kind: "checkup" }
  | { kind: "on_evolve" }
  | { kind: "attack_rider"; attackName: string } // resolves after the attack's damage
  // Computes the attack's BASE damage when the printed value is state-dependent
  // ("180+", "60×"). Carries `damage`, not `ops` — it returns a number rather
  // than mutating, and is read before damage is dealt.
  | { kind: "damage_scale"; attackName: string }
  | { kind: "static" }; // passive; read where the rule applies

/** Availability conditions, all public-information. */
export type Guard =
  | { cond: "opp_prizes_lte"; n: number }
  | { cond: "self_prizes_lte"; n: number }
  | { cond: "is_active" } // the source Pokémon is the Active
  | { cond: "koed_last_opp_turn" }
  | { cond: "has_energy_type"; type: string } // source has this energy attached
  | { cond: "deck_has"; filter: CardFilter }
  | { cond: "discard_has"; filter: CardFilter }
  /** The OPPONENT's Active matches (Rising Blade / Fighting Wings vs an ex). */
  | { cond: "opp_active_is"; filter: MonFilter }
  /** The source Pokémon has a matching Energy attached (Dark Frost's
   *  "Team Rocket's Energy"); broader than has_energy_type, which is by type. */
  | { cond: "self_has_energy"; filter: CardFilter }
  /** Enough cards in hand BESIDES the card being played, for a discard cost
   *  ("you can use this only if you discard 3 other cards" — Secret Box). */
  | { cond: "hand_size_gte"; n: number }
  /** A Supporter whose name contains this was played this turn (Wicked
   *  Impact, Team Rocket's Factory). */
  | { cond: "supporter_played_contains"; text: string }
  /** The source Pokémon moved from the Bench into the Active Spot this turn
   *  (Gale Thrust). */
  | { cond: "moved_to_active_this_turn" }
  /** ANY of the acting player's Pokémon in play matches (Glass Trumpet needs
   *  a Tera Pokémon on board). */
  | { cond: "own_has_mon"; filter: MonFilter }
  /** A Stadium is in play at all (Assault Landing). */
  | { cond: "stadium_in_play" }
  /** Both players hold the same number of cards (Adjusted Horn). */
  | { cond: "hands_equal" }
  /** At least `n` OTHER matching cards in hand besides the one being played
   *  (Transformation Tome's second copy). */
  | { cond: "hand_has"; filter: CardFilter; n: number }
  /** The opponent's Active already has damage on it (Huge Bite). */
  | { cond: "opp_active_damaged" }
  /** The acting player has at least `n` Benched Pokémon (V-Force). */
  | { cond: "own_bench_gte"; n: number }
  /** EVERY one of the acting player's Pokémon in play matches (Ariana draws
   *  more when the whole board is Team Rocket's). */
  | { cond: "all_own_mons_match"; filter: MonFilter }
  /** The SOURCE Pokémon itself matches (Telepathic Psychic Energy only
   *  triggers when attached to a Psychic Pokémon). `side`/`zone` on the
   *  filter are ignored — the subject is always the source. */
  | { cond: "self_is"; filter: MonFilter };

/* ─── State-dependent damage ────────────────────────────────────── */

/** A quantity the board supplies, counted at damage time. */
export type DamageCount =
  /** Prizes the OPPONENT has taken (Burning Darkness, Irritated Outburst). */
  | { of: "opp_prizes_taken" }
  /** Benched Pokémon (Full Moon Rondo counts both sides'). */
  | { of: "bench_count"; side: "own" | "opponent" | "both" }
  /** Energy attached to the Active(s) (Myriad Leaf Shower counts both). */
  | { of: "energy_on_active"; side: "own" | "opponent" | "both" }
  /** Pokémon in play matching a filter (Tenacious Tail: opponent's ex). */
  | { of: "mons_in_play"; side: "own" | "opponent"; filter?: MonFilter }
  /** Cards in a zone matching a filter (Back Draft: basic energy in the
   *  opponent's discard). */
  | { of: "cards_in_zone"; zone: "discard" | "hand"; side: "own" | "opponent"; filter: CardFilter }
  /** Heads on "flip a coin until you get tails" (Rapid-Fire Combo). Consumes
   *  the rng — only ever evaluated once, at real damage resolution. */
  | { of: "coin_flips_until_tails" }
  /** Heads out of a FIXED number of flips (Comet Punch: flip 4). */
  | { of: "coin_flips"; n: number }
  /** Damage counters already on a Pokémon (Mad Bite, Damage Beat). */
  | { of: "damage_counters_on"; side: "own" | "opponent"; zone: "active" | "bench" | "in_play"; filter?: MonFilter }
  /** Energy attached across every matching Pokémon (Syrup Storm, Verdant
   *  Storm). `energyType` narrows to one provided type. */
  | { of: "energy_attached_all"; side: "own" | "opponent"; energyType?: string }
  /** Prizes THIS player has taken (Gobble Down). */
  | { of: "self_prizes_taken" }
  /** Prizes the opponent took during their last turn (Settle the Score). */
  | { of: "opp_prizes_taken_last_turn" }
  /** Cards in the opponent's hand (Resentful Refrain). */
  | { of: "opp_hand_size" };

/** Base damage for an attack whose printed value is state-dependent ("180+",
 *  "60×"): `base + per × count`, plus each bonus whose guard holds. */
export interface DamageFormula {
  base: number;
  per?: number;
  count?: DamageCount;
  /** Flat conditional additions (Rising Blade's "+80 if the Active is an ex"). */
  bonuses?: { amount: number; when: Guard }[];
  /** Damage-calculation exemptions ("this attack's damage isn't affected by
   *  Weakness or Resistance, or by any effects on your opponent's Active"). */
  ignore?: { weakness?: boolean; resistance?: boolean; defenderEffects?: boolean };
  /** "You MAY discard X … and this attack does N more for each" (Metallic
   *  Hammer, Bellowing Thunder, Garland Ray, Erasure Ball, Rocket Feathers).
   *  Modeled as always taking the boost when the resource is there — these
   *  attacks are used at maximum in practice. Unlike the rest of the formula
   *  this MUTATES (it pays the cost), so it runs only at real resolution
   *  (rng non-null), never during ghost evaluation. */
  discardBoost?: {
    from: "self" | "own_bench" | "hand";
    filter: CardFilter;
    /** Cards discarded, at most. Omit for "any amount". */
    max?: number;
    /** Extra damage per card discarded. */
    per: number;
    /** Flat extra damage added ONCE if the cost was paid at all — for the
     *  all-or-nothing wording ("discard 3 … and do 150 more"). */
    flat?: number;
    /** Discard exactly this many or nothing (Metallic Hammer's 3). */
    exactly?: number;
    /** Where the paid cards go. Chrono Burst SHUFFLES them into the deck
     *  rather than discarding, which matters for later recursion. */
    to?: "discard" | "deck";
  };
}

/* ─── Effect primitives ─────────────────────────────────────────── */

/** `n` can be a fixed count or a dynamic quantity read at apply time. */
export type Quantity = number | "own_prizes" | "opp_prizes" | "opp_bench_count" | "own_hand_size";

export type EffectOp =
  | { op: "draw"; n: Quantity }
  | { op: "shuffle_hand_draw"; n: Quantity } // shuffle own hand into deck, draw n
  | { op: "discard_hand_draw"; n: Quantity } // discard own hand, draw n
  | { op: "hand_to_bottom_draw"; n: Quantity; who: "own" | "opponent" | "both" }
  // Route resolved picks (a card TargetSpec) into a destination zone. `search`
  // pulls from the deck (then shuffles), `retrieve` from the discard pile.
  | { op: "search"; targetRef: string; to: "hand" | "bench" | "deck_top" }
  | { op: "retrieve"; targetRef: string; to: "hand" | "bench" }
  // Move resolved energy cards (a card TargetSpec) onto a resolved mon.
  | { op: "attach_energy"; energyRef: string; monRef: string; from: "deck" | "discard" | "hand" }
  | { op: "shuffle_deck" }
  /** Shuffle matching cards from the discard back INTO the deck (Energy
   *  Recycler, Sacred Ash). */
  | { op: "discard_to_deck"; filter: CardFilter; max: number }
  /** Move attached Energy between two resolved Pokémon (Energy Switch). */
  | { op: "move_energy"; fromRef: string; toRef: string; filter: CardFilter; count: number }
  /** Draw until the hand holds `n` (Iris's Fighting Spirit, Ariana). `bonus`
   *  raises the target when its guard holds. */
  | { op: "draw_until"; n: number; bonus?: { n: number; when: Guard } }
  /** A player discards down to `n` cards in hand (Xerosic, Hand Trimmer). */
  | { op: "discard_hand_down_to"; who: "own" | "opponent" | "both"; n: number }
  /** Discard matching cards out of a hand (Eri: up to 2 Items from the
   *  opponent's). */
  | { op: "discard_from_hand"; who: "own" | "opponent"; filter: CardFilter; max: number }
  /** Return a Pokémon and everything attached to its owner's hand (Scoop Up
   *  Cyclone). */
  | { op: "bounce_to_hand"; monRef: string }
  /** Evolve a resolved own Pokémon straight out of the deck (Salvatore). */
  | { op: "evolve_from_deck"; monRef: string; filter: CardFilter }
  | { op: "gust"; monRef: string } // swap opponent's chosen Bench mon to Active
  | { op: "switch"; monRef: string } // swap own chosen Bench mon to Active
  // Raw damage to the resolved Pokémon ("this attack does N damage to 1 of
  // your opponent's Pokémon"). Weakness/Resistance apply only in the Active
  // spot, matching the printed reminder text on these attacks.
  | { op: "damage_mon"; monRef: string; amount: number }
  | { op: "place_counters"; monRef: string; n: Quantity }
  | { op: "move_counters"; fromRef: string; toRef: string; n: number }
  | { op: "apply_condition"; monRef: string; condition: SpecialCondition }
  | { op: "heal"; monRef: string; n: number | "all" }
  | { op: "clear_conditions"; monRef: string }
  /** The source Pokémon knocks ITSELF out (Cursed Blast). Marked lethally so
   *  the driver's resolveKnockouts handles prizes and promotion normally. */
  | { op: "ko_self" }
  /** Apply a turn-scoped status. `turns: 1` means "during the next turn".
   *  monRef may be a target ref, SELF_REF, or DEFENDER_REF. */
  | {
      op: "apply_status";
      monRef: string;
      status:
        | "cannot_attack"
        | "cannot_retreat"
        | "damage_taken_reduction"
        | "damage_dealt_reduction"
        | "attack_cost_extra"
        | "retreat_cost_extra"
        | "no_weakness"
        | "prevent_all";
      amount?: number;
      turns?: number;
      fromEvolutionOnly?: boolean;
    }
  /** Discard attached Energy from a resolved Pokémon ("all" for every card). */
  | { op: "discard_energy"; monRef: string; n: number | "all" }
  /** Return attached Energy from a resolved Pokémon to its owner's hand. */
  | { op: "energy_to_hand"; monRef: string; n: number }
  /** Self-inflicted recoil (Wood Hammer). */
  | { op: "damage_self"; amount: number }
  /** Counters onto the Pokémon that just attacked this one (Spiky Energy).
   *  Only meaningful inside an `on_damaged` trigger. */
  | { op: "counters_on_attacker"; n: number }
  /** Place counters on every matching Pokémon across both boards (Freezing
   *  Shroud). */
  | { op: "counters_on_all"; filter: MonFilter; n: number; exceptSelfName?: boolean }
  /** Discard this card (the Energy/Tool carrying the effect) from its holder. */
  | { op: "discard_self_card" }
  /** Shuffle resolved Pokémon (and everything attached) into their owner's
   *  deck (Sylveon ex's Angelite). */
  | { op: "shuffle_mons_to_deck"; monRef: string }
  /** Knock the resolved Pokémon out outright when it has exactly `counters`
   *  damage counters (Mega Absol ex's Terminal Period). */
  | { op: "ko_if_counters"; monRef: string; counters: number }
  /** Send the opponent's Active to the Bench; they choose the replacement
   *  (Metagross's Bounce Back — modeled as the engine's promotion heuristic). */
  | { op: "opponent_switches_active" }
  /** Discard the Stadium in play (Ting-Lu's Ground Crasher). */
  | { op: "discard_stadium" }
  /** Damage every Pokémon on the opponent's Bench (no W/R). */
  | { op: "damage_opponent_bench"; amount: number }
  /** Use another Pokémon's attack as this attack (Night Joker, Gemstone
   *  Mimicry, Seek Inspiration). `from` picks whose attack is copied. The
   *  copy resolves damage + its own rider, but a copied attack may NOT copy
   *  again — that recursion guard is what keeps this bounded. */
  | { op: "use_copied_attack"; from: "own_bench" | "opponent_active" | "deck_top" ; filter?: MonFilter }
  /** Extra Prize taken when this attack knocks the Active out (Briar). */
  | { op: "prize_bonus_this_turn"; amount: number; requiresAttackerSubtype?: string }
  /** Shuffle your Prize cards into the deck and draw fresh ones (Redeemable
   *  Ticket). */
  | { op: "reset_prizes" }
  /** Swap a Basic in the discard with one in play, carrying over everything
   *  attached (Transformation Tome). */
  | { op: "swap_with_discard"; cardRef: string; monRef: string }
  | { op: "discard_from_mon"; monRef: string; category: "tool" | "special_energy" | "energy" }
  /** Look at the top `n` of your own deck, take up to `count` matching cards
   *  to hand, shuffle the rest back (Pokégear 3.0, Bug Catching Set). v1
   *  auto-picks the first matches — a real reveal choice is a W4 chooser. */
  | { op: "reveal_top"; n: number; count: number; filter: CardFilter; to: "hand"; from?: "top" | "bottom" }
  /** Discard `n` cards from your own hand as a COST (Secret Box). Auto-picks
   *  the least useful cards via the shared pickDiscards heuristic. */
  | { op: "discard_hand_cards"; n: number }
  /** Flip a coin and branch. The nested ops run in the same target context,
   *  so a heads branch can use the same picks the parent enumerated
   *  (Crushing Hammer's chosen Pokémon). Consumes the rng. */
  | { op: "coin_flip"; heads: EffectOp[]; tails?: EffectOp[] }
  /** Turn-scoped damage buff to the opponent's ACTIVE, before W/R. Scoped by
   *  what the DEFENDER is (vsTarget) and/or what the ATTACKER is
   *  (attackerType) — Black Belt's Training, Kieran, Premium Power Pro. */
  | { op: "buff_damage_this_turn"; amount: number; vsTarget?: "ex" | "ex_or_v"; attackerType?: string };

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
  /** Required by (and only meaningful for) the `damage_scale` trigger. */
  damage?: DamageFormula;
}
