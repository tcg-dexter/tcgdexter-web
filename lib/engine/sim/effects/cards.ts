// Declarative card registry (W2). Each card's non-vanilla behavior expressed
// as CardEffect data. This begins with representative cards spanning the shapes
// (search→bench, gust, no-target refresh, multi-target attach); the full ~35
// migration + the meta engines (W3) extend this table. A card here is NOT in
// the legacy TRAINER_EFFECTS/ACTIVATED registries — the two are mutually
// exclusive during cutover so nothing double-lists.

import { SELF_REF } from "./types";
import type { CardEffect } from "./types";

export const EFFECT_CARDS: Record<string, CardEffect[]> = {
  "Nest Ball": [
    {
      card: "Nest Ball",
      trigger: { kind: "trainer", subtype: "Item" },
      targets: [
        { ref: "p", select: "card", card: { zone: "deck", filter: { basicPokemon: true } }, chooser: "player" },
      ],
      ops: [{ op: "search", targetRef: "p", to: "bench" }],
    },
  ],

  "Boss's Orders": [
    {
      card: "Boss's Orders",
      trigger: { kind: "trainer", subtype: "Supporter" },
      targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }],
      ops: [{ op: "gust", monRef: "t" }],
    },
  ],

  "Professor's Research": [
    {
      card: "Professor's Research",
      trigger: { kind: "trainer", subtype: "Supporter" },
      ops: [{ op: "discard_hand_draw", n: 7 }],
    },
  ],

  "N's PP Up": [
    {
      card: "N's PP Up",
      trigger: { kind: "trainer", subtype: "Item" },
      targets: [
        { ref: "e", select: "card", card: { zone: "discard", filter: { basicEnergy: true } }, chooser: "player" },
        { ref: "m", select: "mon", mon: { side: "own", zone: "bench", namePrefix: "N's " }, chooser: "player" },
      ],
      ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }],
    },
  ],

  // First DECLARATIVE-ONLY card (not in the legacy registry) — the effect path
  // goes live for it. Item: search deck for a "Team Rocket's" Supporter → hand,
  // then shuffle (the `search` op shuffles). Fully expressed with existing ops.
  "Team Rocket's Transceiver": [
    {
      card: "Team Rocket's Transceiver",
      trigger: { kind: "trainer", subtype: "Item" },
      targets: [
        {
          ref: "s",
          select: "card",
          card: {
            zone: "deck",
            filter: { supertype: "Trainer", subtype: "Supporter", namePrefix: "Team Rocket's " },
          },
          chooser: "player",
        },
      ],
      ops: [{ op: "search", targetRef: "s", to: "hand" }],
    },
  ],

  // Mega Kangaskhan ex — Run Errand: once during your turn, if this Pokémon
  // is in the Active Spot, draw 2. (The printed "no more than 1 Run Errand
  // per turn" cap across copies is not modeled — the per-Pokémon once-per-turn
  // gate covers the single-copy case decks actually run. First ACTIVATED-
  // trigger record: proves the ability path end to end.)
  "Mega Kangaskhan ex": [
    {
      card: "Mega Kangaskhan ex",
      ability: "Run Errand",
      trigger: { kind: "activated" },
      guards: [{ cond: "is_active" }],
      ops: [{ op: "draw", n: 2 }],
    },
    // Rapid-Fire Combo: 200+, flip a coin until tails, 50 more per heads.
    // (Appended AFTER Run Errand so that ability keeps effect index 0.)
    {
      card: "Mega Kangaskhan ex",
      trigger: { kind: "damage_scale", attackName: "Rapid-Fire Combo" },
      damage: { base: 200, per: 50, count: { of: "coin_flips_until_tails" } },
      ops: [],
    },
  ],

  // Fezandipiti ex — Cruel Arrow: this attack does 100 damage to 1 of your
  // opponent's Pokémon. (No Weakness/Resistance for Benched Pokémon — the
  // damage_mon op applies W/R in the Active spot only.) The attack has no
  // printed damage, so the rider IS the whole attack. Highest-impact
  // unmodeled rider in the field (17 decks). Fezandipiti ex's Flip the Script
  // ABILITY stays in the legacy registry — different slot, no conflict.
  "Fezandipiti ex": [
    {
      card: "Fezandipiti ex",
      trigger: { kind: "attack_rider", attackName: "Cruel Arrow" },
      targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
      ops: [{ op: "damage_mon", monRef: "t", amount: 100 }],
    },
  ],

  // Crushing Hammer: flip a coin; if heads, discard an Energy from 1 of your
  // opponent's Pokémon. The TARGET is chosen before the flip (that's how the
  // card plays), so the pick is enumerated normally and the coin_flip op
  // gates only the discard.
  "Crushing Hammer": [
    {
      card: "Crushing Hammer",
      trigger: { kind: "trainer", subtype: "Item" },
      targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
      ops: [{ op: "coin_flip", heads: [{ op: "discard_from_mon", monRef: "t", category: "energy" }] }],
    },
  ],

  // Dawn: search your deck for a Basic, a Stage 1, AND a Stage 2. Three target
  // slots — the enumerator's cartesian product across slots handles this; each
  // is `auto` because the full cross-product of three deck slots would be
  // hundreds of moves per play (a real 3-way choice is a W4 chooser).
  // `upTo` on every slot because a search may legally FAIL to find: without it
  // a required empty slot would make the whole card unplayable.
  Dawn: [
    {
      card: "Dawn",
      trigger: { kind: "trainer", subtype: "Supporter" },
      targets: [
        { ref: "b", upTo: true, select: "card", card: { zone: "deck", filter: { stage: "Basic" } }, chooser: "auto" },
        { ref: "s1", upTo: true, select: "card", card: { zone: "deck", filter: { stage: "Stage 1" } }, chooser: "auto" },
        { ref: "s2", upTo: true, select: "card", card: { zone: "deck", filter: { stage: "Stage 2" } }, chooser: "auto" },
      ],
      ops: [
        { op: "search", targetRef: "b", to: "hand" },
        { op: "search", targetRef: "s1", to: "hand" },
        { op: "search", targetRef: "s2", to: "hand" },
      ],
    },
  ],

  // Pokégear 3.0: look at the top 7, reveal a Supporter and take it, shuffle
  // the rest back.
  "Pokégear 3.0": [
    {
      card: "Pokégear 3.0",
      trigger: { kind: "trainer", subtype: "Item" },
      ops: [
        {
          op: "reveal_top",
          n: 7,
          count: 1,
          filter: { supertype: "Trainer", subtype: "Supporter" },
          to: "hand",
        },
      ],
    },
  ],

  // Bug Catching Set: top 7, take up to 2 in any combination of Grass Pokémon
  // and Basic Grass Energy. The one disjunctive filter in the schema (anyOf).
  "Bug Catching Set": [
    {
      card: "Bug Catching Set",
      trigger: { kind: "trainer", subtype: "Item" },
      ops: [
        {
          op: "reveal_top",
          n: 7,
          count: 2,
          filter: {
            anyOf: [
              { supertype: "Pokémon", pokemonType: "Grass" },
              { basicEnergy: true, energyType: "Grass" },
            ],
          },
          to: "hand",
        },
      ],
    },
  ],

  // Secret Box (ACE SPEC): discard 3 OTHER cards from hand, then search for an
  // Item, a Tool, a Supporter, and a Stadium. Four `auto`/`upTo` slots for the
  // same reasons as Dawn. The guard needs 4 (3 to discard + Secret Box itself,
  // which is still in hand when guards are checked).
  "Secret Box": [
    {
      card: "Secret Box",
      trigger: { kind: "trainer", subtype: "Item" },
      guards: [{ cond: "hand_size_gte", n: 4 }],
      targets: [
        { ref: "i", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Item" } }, chooser: "auto" },
        { ref: "t", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Pokémon Tool" } }, chooser: "auto" },
        { ref: "s", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Supporter" } }, chooser: "auto" },
        { ref: "st", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Stadium" } }, chooser: "auto" },
      ],
      // Discard cost FIRST, then the searches (order matters: the cost must
      // not be able to discard a card the search just fetched).
      ops: [
        { op: "discard_hand_cards", n: 3 },
        { op: "search", targetRef: "i", to: "hand" },
        { op: "search", targetRef: "t", to: "hand" },
        { op: "search", targetRef: "s", to: "hand" },
        { op: "search", targetRef: "st", to: "hand" },
      ],
    },
  ],

  /* ── On-attach Special Energy (W2-fin.6) ─────────────────────── */

  // Jet Energy: when attached from hand to a BENCHED Pokémon, switch it into
  // the Active Spot. The `self` ref is the mon it was just attached to.
  "Jet Energy": [
    {
      card: "Jet Energy",
      trigger: { kind: "on_attach" },
      ops: [{ op: "switch", monRef: SELF_REF }],
    },
  ],

  // Enriching Energy (ACE SPEC): when attached from hand, draw 4.
  "Enriching Energy": [
    {
      card: "Enriching Energy",
      trigger: { kind: "on_attach" },
      ops: [{ op: "draw", n: 4 }],
    },
  ],

  // Telepathic Psychic Energy: when attached from hand to a PSYCHIC Pokémon,
  // search the deck for up to 2 Basic Psychic Pokémon and bench them.
  "Telepathic Psychic Energy": [
    {
      card: "Telepathic Psychic Energy",
      trigger: { kind: "on_attach" },
      guards: [{ cond: "self_is", filter: { side: "own", zone: "in_play", type: "Psychic" } }],
      targets: [
        {
          ref: "p",
          select: "card",
          count: 2,
          upTo: true,
          card: { zone: "deck", filter: { basicPokemon: true, pokemonType: "Psychic" } },
          chooser: "player",
        },
      ],
      ops: [{ op: "search", targetRef: "p", to: "bench" }],
    },
  ],

  /* ── Multi-pick searches (W2-fin.5) ──────────────────────────── */

  // Cyrano: search your deck for up to 3 Pokémon ex. The first true multi-pick
  // slot — count 3 with upTo, so the enumerator offers 3/2/1/0 and may take
  // several copies of the SAME ex (legal, and often what you want).
  Cyrano: [
    {
      card: "Cyrano",
      trigger: { kind: "trainer", subtype: "Supporter" },
      targets: [
        {
          ref: "p",
          select: "card",
          count: 3,
          upTo: true,
          card: { zone: "deck", filter: { supertype: "Pokémon", subtype: "ex" } },
          chooser: "player",
        },
      ],
      ops: [{ op: "search", targetRef: "p", to: "hand" }],
    },
  ],

  // Ciphermaniac's Codebreaking: search for 2 cards, shuffle, then put them on
  // TOP of the deck. No filter — any 2 cards — so the slot is capped by
  // MAX_SLOT_OPTIONS rather than by the filter.
  "Ciphermaniac's Codebreaking": [
    {
      card: "Ciphermaniac's Codebreaking",
      trigger: { kind: "trainer", subtype: "Supporter" },
      targets: [
        {
          ref: "c",
          select: "card",
          count: 2,
          upTo: true,
          card: { zone: "deck", filter: {} },
          chooser: "player",
        },
      ],
      ops: [{ op: "search", targetRef: "c", to: "deck_top" }],
    },
  ],

  // Arven: search for an Item AND a Pokémon Tool. Two slots rather than a
  // multi-pick — the categories differ, so the cartesian product is right.
  Arven: [
    {
      card: "Arven",
      trigger: { kind: "trainer", subtype: "Supporter" },
      targets: [
        {
          ref: "i",
          upTo: true,
          select: "card",
          card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Item" } },
          chooser: "player",
        },
        {
          ref: "t",
          upTo: true,
          select: "card",
          card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Pokémon Tool" } },
          chooser: "player",
        },
      ],
      ops: [
        { op: "search", targetRef: "i", to: "hand" },
        { op: "search", targetRef: "t", to: "hand" },
      ],
    },
  ],

  /* ── State-dependent damage (damage_scale) ───────────────────── */

  // MIGRATED from the legacy DAMAGE_SCALERS registry (attacks.ts). Behavior is
  // identical — the existing damage tests are the regression net.
  "Charizard ex": [
    {
      card: "Charizard ex",
      trigger: { kind: "damage_scale", attackName: "Burning Darkness" },
      // 180 + 30 for each Prize the opponent has taken.
      damage: { base: 180, per: 30, count: { of: "opp_prizes_taken" } },
      ops: [],
    },
  ],

  "N's Darmanitan": [
    {
      card: "N's Darmanitan",
      trigger: { kind: "damage_scale", attackName: "Back Draft" },
      // 30 for each Basic Energy in the opponent's discard pile.
      damage: {
        base: 0,
        per: 30,
        count: { of: "cards_in_zone", zone: "discard", side: "opponent", filter: { basicEnergy: true } },
      },
      ops: [],
    },
  ],

  // Full Moon Rondo: 20+, 20 more for each Benched Pokémon (BOTH sides').
  "Lillie's Clefairy ex": [
    {
      card: "Lillie's Clefairy ex",
      trigger: { kind: "damage_scale", attackName: "Full Moon Rondo" },
      damage: { base: 20, per: 20, count: { of: "bench_count", side: "both" } },
      ops: [],
    },
  ],

  // Myriad Leaf Shower: 30+, 30 more for each Energy attached to BOTH Actives.
  "Teal Mask Ogerpon ex": [
    {
      card: "Teal Mask Ogerpon ex",
      trigger: { kind: "damage_scale", attackName: "Myriad Leaf Shower" },
      damage: { base: 30, per: 30, count: { of: "energy_on_active", side: "both" } },
      ops: [],
    },
  ],

  // Irritated Outburst: 60× — 60 for each Prize the opponent has taken.
  "Pecharunt ex": [
    {
      card: "Pecharunt ex",
      trigger: { kind: "damage_scale", attackName: "Irritated Outburst" },
      damage: { base: 0, per: 60, count: { of: "opp_prizes_taken" } },
      ops: [],
    },
  ],

  // Tenacious Tail: 60× — 60 for each of your opponent's Pokémon ex in play.
  "Dudunsparce ex": [
    {
      card: "Dudunsparce ex",
      trigger: { kind: "damage_scale", attackName: "Tenacious Tail" },
      damage: {
        base: 0,
        per: 60,
        count: { of: "mons_in_play", side: "opponent", filter: { side: "opponent", zone: "in_play", isEx: true } },
      },
      ops: [],
    },
  ],

  // Rising Blade: 80+, 80 more if the opponent's Active is a Pokémon ex.
  "Chien-Pao": [
    {
      card: "Chien-Pao",
      trigger: { kind: "damage_scale", attackName: "Rising Blade" },
      damage: {
        base: 80,
        bonuses: [{ amount: 80, when: { cond: "opp_active_is", filter: { side: "opponent", zone: "active", isEx: true } } }],
      },
      ops: [],
    },
  ],

  // Fighting Wings: 20+, 90 more if the opponent's Active is a Pokémon ex.
  Moltres: [
    {
      card: "Moltres",
      trigger: { kind: "damage_scale", attackName: "Fighting Wings" },
      damage: {
        base: 20,
        bonuses: [{ amount: 90, when: { cond: "opp_active_is", filter: { side: "opponent", zone: "active", isEx: true } } }],
      },
      ops: [],
    },
  ],

  // Dark Frost: 60+, 60 more if this Pokémon has any Team Rocket's Energy.
  "Team Rocket's Articuno": [
    {
      card: "Team Rocket's Articuno",
      trigger: { kind: "damage_scale", attackName: "Dark Frost" },
      damage: {
        base: 60,
        bonuses: [
          {
            amount: 60,
            when: { cond: "self_has_energy", filter: { supertype: "Energy", namePrefix: "Team Rocket's " } },
          },
        ],
      },
      ops: [],
    },
  ],

  // Applin — Mini Drain: heal 10 damage from this Pokémon. The simplest
  // possible rider: no target slot, resolved entirely through the reserved
  // `self` ref.
  Applin: [
    {
      card: "Applin",
      trigger: { kind: "attack_rider", attackName: "Mini Drain" },
      ops: [{ op: "heal", monRef: SELF_REF, n: 10 }],
    },
  ],
};

export function effectsFor(cardName: string): CardEffect[] {
  return EFFECT_CARDS[cardName] ?? [];
}

/** Declarative ability effects for a card, paired with their ORIGINAL index in
 *  effectsFor(card) so validate/driver resolve the same record. Only effects
 *  that NAME an ability qualify: applyEffect marks `effect.ability` as spent,
 *  so an unnamed one could never be used up and would loop forever. */
export function abilityEffects(
  cardName: string,
  trigger: "activated" | "on_play" | "on_evolve" = "activated",
): { effect: CardEffect; index: number }[] {
  const out: { effect: CardEffect; index: number }[] = [];
  effectsFor(cardName).forEach((effect, index) => {
    if (effect.trigger.kind === trigger && effect.ability) out.push({ effect, index });
  });
  return out;
}

/** The on-attach effect for an Energy card (Jet, Enriching, Telepathic), with
 *  its ORIGINAL index. Resolves inside the `attach` move, not as its own. */
export function onAttachEffect(cardName: string): { effect: CardEffect; index: number } | null {
  const effects = effectsFor(cardName);
  for (let index = 0; index < effects.length; index++) {
    if (effects[index].trigger.kind === "on_attach") return { effect: effects[index], index };
  }
  return null;
}

/** The declarative rider for an attack, with its ORIGINAL index in
 *  effectsFor(card) so validate/driver resolve the same record. Riders are not
 *  moves of their own — they resolve inside the attack that names them. */
export function attackRiderEffect(
  cardName: string,
  attackName: string,
): { effect: CardEffect; index: number } | null {
  const effects = effectsFor(cardName);
  for (let index = 0; index < effects.length; index++) {
    const { trigger } = effects[index];
    if (trigger.kind === "attack_rider" && trigger.attackName === attackName) {
      return { effect: effects[index], index };
    }
  }
  return null;
}

/** The declarative damage-scaling record for an attack, or null. Read by
 *  attackBaseDamage before damage is dealt — not a move and not an op. */
export function damageScaleEffect(cardName: string, attackName: string): CardEffect | null {
  for (const effect of effectsFor(cardName)) {
    const { trigger } = effect;
    if (trigger.kind === "damage_scale" && trigger.attackName === attackName && effect.damage) {
      return effect;
    }
  }
  return null;
}

/** Effect-coverage predicate (W1): is this ability covered declaratively?
 *  Lives here rather than abilities.ts to keep that module free of an
 *  effects-registry import. */
export function hasDeclarativeAbility(cardName: string, abilityName: string): boolean {
  return effectsFor(cardName).some((e) => e.ability === abilityName);
}

/** Coarse planner phase for a declarative effect, mirroring the legacy
 *  TrainerPhase vocabulary so the AI policies can slot effect moves alongside
 *  registry trainers: `draw` (hand refresh), `search` (reveals a hidden zone),
 *  `tactical` (public board action). Derived from the effect's ops. */
export function effectPhase(effect: CardEffect): "draw" | "search" | "tactical" {
  const ops = new Set(effect.ops.map((o) => o.op));
  if (ops.has("draw") || ops.has("shuffle_hand_draw") || ops.has("discard_hand_draw") || ops.has("hand_to_bottom_draw")) {
    return "draw";
  }
  if (ops.has("search") || ops.has("retrieve")) return "search";
  return "tactical";
}

/** The coarse phase of a declarative-effect move, or null for other moves.
 *  The shared seam the AI policies use to handle effect moves generically. */
export function effectMovePhase(cardName: string, effectIndex: number): "draw" | "search" | "tactical" | null {
  const effect = effectsFor(cardName)[effectIndex];
  return effect ? effectPhase(effect) : null;
}
