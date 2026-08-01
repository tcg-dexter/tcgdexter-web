// Declarative card registry (W2). Each card's non-vanilla behavior expressed
// as CardEffect data. This begins with representative cards spanning the shapes
// (search→bench, gust, no-target refresh, multi-target attach); the full ~35
// migration + the meta engines (W3) extend this table. A card here is NOT in
// the legacy TRAINER_EFFECTS/ACTIVATED registries — the two are mutually
// exclusive during cutover so nothing double-lists.

import type { PokemonInPlay } from "../../types";
import { bestCopy, DECK_TOP_NOMINAL } from "./copy";
import { DEFENDER_REF, OWN_ACTIVE_REF, SELF_REF } from "./types";
import type { CardEffect } from "./types";

export const EFFECT_CARDS: Record<string, CardEffect[]> = {
  /* ── W3 final: copy-attack, prize effects, multi-card play ──── */

  // Night Joker / Gemstone Mimicry / Seek Inspiration all "use another
  // Pokémon's attack as this attack". Bounded by the copyDepth guard in
  // primitives: a copied attack cannot itself copy.
  "N's Zoroark ex": [
    { card: "N's Zoroark ex", trigger: { kind: "attack_rider", attackName: "Night Joker" },
      ops: [{ op: "use_copied_attack", from: "own_bench", filter: { side: "own", zone: "bench", namePrefix: "N's " } }] },
  ],
  "Team Rocket's Mimikyu": [
    { card: "Team Rocket's Mimikyu", trigger: { kind: "attack_rider", attackName: "Gemstone Mimicry" },
      ops: [{ op: "use_copied_attack", from: "opponent_active", filter: { side: "opponent", zone: "active", subtype: "Tera" } }] },
  ],
  Slowking: [
    { card: "Slowking", trigger: { kind: "attack_rider", attackName: "Seek Inspiration" },
      ops: [{ op: "use_copied_attack", from: "deck_top" }] },
  ],

  // Briar: only when the opponent is at exactly 2 Prizes; the extra Prize is
  // claimed at the knockout site and only for a Tera attacker.
  Briar: [
    { card: "Briar", trigger: { kind: "trainer", subtype: "Supporter" },
      guards: [{ cond: "opp_prizes_lte", n: 2 }],
      ops: [{ op: "prize_bonus_this_turn", amount: 1, requiresAttackerSubtype: "Tera" }] },
  ],

  "Redeemable Ticket": [
    { card: "Redeemable Ticket", trigger: { kind: "trainer", subtype: "Item" },
      ops: [{ op: "reset_prizes" }] },
  ],

  // Transformation Tome must be played TWO at a time, so the guard demands a
  // second copy in hand and the effect discards it as a cost.
  "Transformation Tome": [
    { card: "Transformation Tome", trigger: { kind: "trainer", subtype: "Item" },
      guards: [{ cond: "hand_has", filter: { nameContains: "Transformation Tome" }, n: 1 }],
      targets: [
        { ref: "d", select: "card", card: { zone: "discard", filter: { basicPokemon: true } }, chooser: "player" },
        { ref: "m", select: "mon", mon: { side: "own", zone: "in_play", basic: true }, chooser: "player" },
      ],
      ops: [
        { op: "discard_from_hand", who: "own", filter: { nameContains: "Transformation Tome" }, max: 1 },
        { op: "swap_with_discard", cardRef: "d", monRef: "m" },
      ] },
  ],

  // Boomerang Energy re-attaches itself after an attack discarded it.
  "Boomerang Energy": [
    { card: "Boomerang Energy", trigger: { kind: "end_of_turn" },
      targets: [{ ref: "e", upTo: true, select: "card", card: { zone: "discard", filter: { nameContains: "Boomerang Energy" } }, chooser: "auto" }],
      ops: [{ op: "attach_energy", energyRef: "e", monRef: SELF_REF, from: "discard" }] },
  ],

  "Cornerstone Mask Ogerpon ex": [
    { card: "Cornerstone Mask Ogerpon ex", trigger: { kind: "damage_scale", attackName: "Demolish" },
      damage: { base: 140, ignore: { weakness: true, resistance: true, defenderEffects: true } }, ops: [] },
  ],
  "Mega Starmie ex": [
    { card: "Mega Starmie ex", trigger: { kind: "damage_scale", attackName: "Nebula Beam" },
      damage: { base: 210, ignore: { weakness: true, resistance: true, defenderEffects: true } }, ops: [] },
    { card: "Mega Starmie ex", trigger: { kind: "attack_rider", attackName: "Jetting Blow" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }], ops: [{ op: "damage_mon", monRef: "t", amount: 50 }] },
  ],
  Crustle: [
    { card: "Crustle", trigger: { kind: "damage_scale", attackName: "Superb Scissors" },
      damage: { base: 120, ignore: { defenderEffects: true } }, ops: [] },
  ],
  "Dudunsparce ex": [
    { card: "Dudunsparce ex", trigger: { kind: "damage_scale", attackName: "Destructive Drill" },
      damage: { base: 150, ignore: { defenderEffects: true } }, ops: [] },
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
  "Mega Lopunny ex": [
    { card: "Mega Lopunny ex", trigger: { kind: "damage_scale", attackName: "Spiky Hopper" },
      damage: { base: 160, ignore: { defenderEffects: true } }, ops: [] },
{ card: "Mega Lopunny ex", trigger: { kind: "damage_scale", attackName: "Gale Thrust" },
    damage: { base: 60, bonuses: [{ amount: 170, when: { cond: "moved_to_active_this_turn" } }] }, ops: [] },
  ],
  "N's Zekrom": [
    { card: "N's Zekrom", trigger: { kind: "damage_scale", attackName: "Shred" },
      damage: { base: 70, ignore: { defenderEffects: true } }, ops: [] },
    { card: "N's Zekrom", trigger: { kind: "attack_rider", attackName: "Rampaging Thunder" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
  ],
  "Cynthia's Gible": [
    { card: "Cynthia's Gible", trigger: { kind: "damage_scale", attackName: "Rock Hurl" },
      damage: { base: 20, ignore: { resistance: true } }, ops: [] },
  ],
  "Fan Rotom": [
    { card: "Fan Rotom", trigger: { kind: "damage_scale", attackName: "Assault Landing" },
      damage: { base: 0, bonuses: [{ amount: 70, when: { cond: "stadium_in_play" } }] }, ops: [] },
{ card: "Fan Rotom", ability: "Fan Call", trigger: { kind: "activated" },
    targets: [{ ref: "p", select: "card", count: 3, upTo: true, card: { zone: "deck", filter: { supertype: "Pokémon", pokemonType: "Colorless", maxHp: 100 } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "hand" }] },
  ],
  Victini: [
    { card: "Victini", trigger: { kind: "damage_scale", attackName: "V-Force" },
      damage: { base: 0, bonuses: [{ amount: 120, when: { cond: "own_bench_gte", n: 5 } }] }, ops: [] },
  ],
  Solrock: [
    { card: "Solrock", trigger: { kind: "damage_scale", attackName: "Cosmic Beam" },
      damage: { base: 0, ignore: { weakness: true, resistance: true },
        bonuses: [{ amount: 70, when: { cond: "own_has_mon", filter: { side: "own", zone: "bench", nameContains: "Lunatone" } } }] }, ops: [] },
  ],
  "Hop's Cramorant": [
    { card: "Hop's Cramorant", trigger: { kind: "damage_scale", attackName: "Fickle Spitting" },
      damage: { base: 0, bonuses: [{ amount: 120, when: { cond: "opp_prizes_lte", n: 4 } }] }, ops: [] },
  ],
  "Iron Boulder": [
    { card: "Iron Boulder", trigger: { kind: "damage_scale", attackName: "Adjusted Horn" },
      damage: { base: 0, bonuses: [{ amount: 170, when: { cond: "hands_equal" } }] }, ops: [] },
  ],
  "Mega Mawile ex": [
    { card: "Mega Mawile ex", trigger: { kind: "damage_scale", attackName: "Huge Bite" },
      damage: { base: 260, bonuses: [{ amount: -230, when: { cond: "opp_active_damaged" } }] }, ops: [] },
{ card: "Mega Mawile ex", trigger: { kind: "damage_scale", attackName: "Gobble Down" },
    damage: { base: 0, per: 80, count: { of: "self_prizes_taken" } }, ops: [] },
  ],
  "Archaludon ex": [
    { card: "Archaludon ex", trigger: { kind: "attack_rider", attackName: "Metal Defender" },
      ops: [{ op: "apply_status", monRef: SELF_REF, status: "no_weakness" }] },
{ card: "Archaludon ex", ability: "Assemble Alloy", trigger: { kind: "on_evolve" },
    targets: [
      { ref: "e", select: "card", count: 2, upTo: true, card: { zone: "discard", filter: { basicEnergy: true, energyType: "Metal" } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "in_play", type: "Metal" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }] },
  ],
  "Hop's Phantump": [
    { card: "Hop's Phantump", trigger: { kind: "attack_rider", attackName: "Splashing Dodge" },
      ops: [{ op: "coin_flip", heads: [{ op: "apply_status", monRef: SELF_REF, status: "prevent_all" }] }] },
  ],
  Petilil: [
    { card: "Petilil", trigger: { kind: "attack_rider", attackName: "Hide" },
      ops: [{ op: "coin_flip", heads: [{ op: "apply_status", monRef: SELF_REF, status: "prevent_all" }] }] },
  ],
  Duskull: [
    { card: "Duskull", trigger: { kind: "attack_rider", attackName: "Come and Get You" },
      targets: [{ ref: "d", select: "card", count: 3, upTo: true, card: { zone: "discard", filter: { nameContains: "Duskull" } }, chooser: "player" }],
      ops: [{ op: "retrieve", targetRef: "d", to: "bench" }] },
  ],
  Elgyem: [
    { card: "Elgyem", trigger: { kind: "attack_rider", attackName: "Slight Shift" },
      targets: [{ ref: "f", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" },
                { ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
      ops: [{ op: "move_energy", fromRef: "f", toRef: "t", filter: {}, count: 1 }] },
  ],
  "Eevee ex": [
    { card: "Eevee ex", ability: "Rainbow DNA", trigger: { kind: "static" }, ops: [] },
  ],
  Kyurem: [
    { card: "Kyurem", ability: "Plasma Bane", trigger: { kind: "static" }, ops: [] },
    { card: "Kyurem", trigger: { kind: "attack_rider", attackName: "Trifrost" }, targets: [{ ref: "t", select: "mon", count: 3, upTo: true, mon: { side: "opponent", zone: "in_play" }, chooser: "player" }], ops: [{ op: "discard_energy", monRef: SELF_REF, n: "all" }, { op: "damage_mon", monRef: "t", amount: 110 }] },
  ],
  Budew: [
    { card: "Budew", trigger: { kind: "attack_rider", attackName: "Itchy Pollen" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "cannot_retreat" }] },
  ],
  "Team Rocket's Murkrow": [
    { card: "Team Rocket's Murkrow", trigger: { kind: "attack_rider", attackName: "Torment" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "cannot_attack" }] },
    { card: "Team Rocket's Murkrow", trigger: { kind: "attack_rider", attackName: "Deceit" }, targets: [{ ref: "s", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Supporter" } }, chooser: "player" }], ops: [{ op: "search", targetRef: "s", to: "hand" }] },
  ],
  "Mega Audino ex": [
    { card: "Mega Audino ex", trigger: { kind: "attack_rider", attackName: "Kaleidowaltz" }, targets: [{ ref: "e", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { basicEnergy: true } }, chooser: "player" }, { ref: "m", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "deck" }] },
{ card: "Mega Audino ex", trigger: { kind: "damage_scale", attackName: "Ear Force" },
    damage: { base: 20, per: 80, count: { of: "energy_on_active", side: "opponent" } }, ops: [] },
  ],
  Dedenne: [
    { card: "Dedenne", trigger: { kind: "attack_rider", attackName: "Tail Generator" }, targets: [{ ref: "e", select: "card", count: 3, upTo: true, card: { zone: "discard", filter: { basicEnergy: true, energyType: "Lightning" } }, chooser: "player" }, { ref: "m", select: "mon", mon: { side: "own", zone: "in_play", type: "Lightning" }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }] },
  ],
  Seaking: [
    { card: "Seaking", trigger: { kind: "attack_rider", attackName: "Hydro Jet" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }], ops: [{ op: "damage_mon", monRef: "t", amount: 30 }] },
  ],
  Genesect: [
    { card: "Genesect", trigger: { kind: "attack_rider", attackName: "Bug's Cannon" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }], ops: [{ op: "damage_mon", monRef: "t", amount: 20 }] },
  ],
  "Arboliva ex": [
    { card: "Arboliva ex", trigger: { kind: "attack_rider", attackName: "Oil Salvo" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }], ops: [{ op: "damage_mon", monRef: "t", amount: 120 }] },
    { card: "Arboliva ex", trigger: { kind: "attack_rider", attackName: "Aroma Shot" }, ops: [{ op: "clear_conditions", monRef: SELF_REF }] },
  ],
  "Wellspring Mask Ogerpon ex": [
    { card: "Wellspring Mask Ogerpon ex", trigger: { kind: "attack_rider", attackName: "Torrential Pump" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }], ops: [{ op: "discard_energy", monRef: SELF_REF, n: 3 }, { op: "damage_mon", monRef: "t", amount: 120 }] },
    { card: "Wellspring Mask Ogerpon ex", trigger: { kind: "attack_rider", attackName: "Sob" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "cannot_retreat" }] },
  ],
  Zeraora: [
    { card: "Zeraora", trigger: { kind: "attack_rider", attackName: "Thunder Raid" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench", isEx: true }, chooser: "player" }], ops: [{ op: "discard_energy", monRef: SELF_REF, n: "all" }, { op: "damage_mon", monRef: "t", amount: 210 }] },
  ],
  "Mega Skarmory ex": [
    { card: "Mega Skarmory ex", trigger: { kind: "attack_rider", attackName: "Sonic Ripper" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }], ops: [{ op: "discard_energy", monRef: SELF_REF, n: "all" }, { op: "damage_mon", monRef: "t", amount: 220 }] },
  ],
  "Greninja ex": [
    { card: "Greninja ex", trigger: { kind: "attack_rider", attackName: "Mirage Barrage" }, targets: [{ ref: "t", select: "mon", count: 2, upTo: true, mon: { side: "opponent", zone: "in_play" }, chooser: "player" }], ops: [{ op: "discard_energy", monRef: SELF_REF, n: 2 }, { op: "damage_mon", monRef: "t", amount: 120 }] },
    { card: "Greninja ex", trigger: { kind: "attack_rider", attackName: "Shinobi Blade" }, targets: [{ ref: "c", upTo: true, select: "card", card: { zone: "deck", filter: {} }, chooser: "player" }], ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  "Ting-Lu": [
    { card: "Ting-Lu", trigger: { kind: "attack_rider", attackName: "Ground Crasher" }, guards: [{ cond: "stadium_in_play" }], ops: [{ op: "damage_opponent_bench", amount: 30 }, { op: "discard_stadium" }] },
  ],
  "Mega Absol ex": [
    { card: "Mega Absol ex", trigger: { kind: "attack_rider", attackName: "Terminal Period" }, ops: [{ op: "ko_if_counters", monRef: DEFENDER_REF, counters: 6 }] },
    { card: "Mega Absol ex", trigger: { kind: "attack_rider", attackName: "Claw of Darkness" }, ops: [{ op: "discard_from_hand", who: "opponent", filter: {}, max: 1 }] },
  ],
  "Sylveon ex": [
    { card: "Sylveon ex", trigger: { kind: "attack_rider", attackName: "Angelite" }, targets: [{ ref: "t", select: "mon", count: 2, upTo: true, mon: { side: "opponent", zone: "bench" }, chooser: "player" }], ops: [{ op: "shuffle_mons_to_deck", monRef: "t" }] },
    { card: "Sylveon ex", trigger: { kind: "attack_rider", attackName: "Magical Charm" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "damage_dealt_reduction", amount: 100 }] },
  ],
  "Lucky Helmet": [
    { card: "Lucky Helmet", trigger: { kind: "on_damaged" }, guards: [{ cond: "is_active" }],
      ops: [{ op: "draw", n: 2 }] },
  ],
  "Handheld Fan": [
    { card: "Handheld Fan", trigger: { kind: "on_damaged" }, guards: [{ cond: "is_active" }],
      ops: [{ op: "discard_energy", monRef: "attacker", n: 1 }] },
  ],
  "Spiky Energy": [
    { card: "Spiky Energy", trigger: { kind: "on_damaged" }, guards: [{ cond: "is_active" }],
      ops: [{ op: "counters_on_attacker", n: 2 }] },
  ],
  Powerglass: [
    { card: "Powerglass", trigger: { kind: "end_of_turn" }, guards: [{ cond: "is_active" }],
      targets: [{ ref: "e", upTo: true, select: "card", card: { zone: "discard", filter: { basicEnergy: true } }, chooser: "auto" }],
      ops: [{ op: "attach_energy", energyRef: "e", monRef: SELF_REF, from: "discard" }] },
  ],
  "Ignition Energy": [
    { card: "Ignition Energy", trigger: { kind: "end_of_turn" }, ops: [{ op: "discard_self_card" }] },
  ],
  Froslass: [
    { card: "Froslass", ability: "Freezing Shroud", trigger: { kind: "checkup" },
      ops: [{ op: "counters_on_all", filter: { side: "own", zone: "in_play" }, n: 1, exceptSelfName: true }] },
  ],
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
  "Fezandipiti ex": [
    {
      card: "Fezandipiti ex",
      trigger: { kind: "attack_rider", attackName: "Cruel Arrow" },
      targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
      ops: [{ op: "damage_mon", monRef: "t", amount: 100 }],
    },
  ],
  "Crushing Hammer": [
    {
      card: "Crushing Hammer",
      trigger: { kind: "trainer", subtype: "Item" },
      targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
      ops: [{ op: "coin_flip", heads: [{ op: "discard_from_mon", monRef: "t", category: "energy" }] }],
    },
  ],
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
  Abra: [
    { card: "Abra", trigger: { kind: "attack_rider", attackName: "Teleportation Attack" }, targets: [{ ref: "b", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }], ops: [{ op: "switch", monRef: "b" }] },
  ],
  Dunsparce: [
    { card: "Dunsparce", trigger: { kind: "attack_rider", attackName: "Trading Places" }, targets: [{ ref: "b", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }], ops: [{ op: "switch", monRef: "b" }] },
  ],
  "Chien-Pao": [
    { card: "Chien-Pao", trigger: { kind: "attack_rider", attackName: "Strafe" }, targets: [{ ref: "b", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }], ops: [{ op: "switch", monRef: "b" }] },
    // (second authoring batch)
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
  Binacle: [
    { card: "Binacle", trigger: { kind: "attack_rider", attackName: "Double Draw" }, ops: [{ op: "draw", n: 2 }] },
  ],
  Froakie: [
    { card: "Froakie", trigger: { kind: "attack_rider", attackName: "Collect" }, ops: [{ op: "draw", n: 1 }] },
  ],
  "Marnie's Impidimp": [
    { card: "Marnie's Impidimp", trigger: { kind: "attack_rider", attackName: "Filch" }, ops: [{ op: "draw", n: 1 }] },
  ],
  "Cynthia's Garchomp ex": [
    { card: "Cynthia's Garchomp ex", trigger: { kind: "attack_rider", attackName: "Corkscrew Dive" }, ops: [{ op: "draw_until", n: 6 }] },
    // (second authoring batch)
    { card: "Cynthia's Garchomp ex", trigger: { kind: "attack_rider", attackName: "Draconic Buster" }, ops: [{ op: "discard_energy", monRef: SELF_REF, n: "all" }] },
  ],
  "Bloodmoon Ursaluna ex": [
    { card: "Bloodmoon Ursaluna ex", trigger: { kind: "attack_rider", attackName: "Blood Moon" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
  ],
  Bouffalant: [
    { card: "Bouffalant", trigger: { kind: "attack_rider", attackName: "Boundless Power" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
  ],
  "Flareon ex": [
    { card: "Flareon ex", trigger: { kind: "attack_rider", attackName: "Carnelian" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
    // (second authoring batch)
    { card: "Flareon ex", trigger: { kind: "attack_rider", attackName: "Burning Charge" }, targets: [{ ref: "e", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { basicEnergy: true } }, chooser: "player" }, { ref: "m", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "deck" }] },
  ],
  "Iron Leaves ex": [
    { card: "Iron Leaves ex", trigger: { kind: "attack_rider", attackName: "Prism Edge" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
    // (second authoring batch)
{ card: "Iron Leaves ex", ability: "Rapid Vernier", trigger: { kind: "on_play" },
    ops: [{ op: "switch", monRef: SELF_REF }] },
  ],
  "Latias ex": [
    { card: "Latias ex", trigger: { kind: "attack_rider", attackName: "Eon Blade" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
  ],
  "Steven's Metang": [
    { card: "Steven's Metang", trigger: { kind: "attack_rider", attackName: "Metal Slash" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
  ],
  "Koraidon ex": [
    { card: "Koraidon ex", trigger: { kind: "attack_rider", attackName: "Impact Blow" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
    // (second authoring batch)
{ card: "Koraidon ex", trigger: { kind: "damage_scale", attackName: "Orichalcum Fang" },
    damage: { base: 50, bonuses: [{ amount: 120, when: { cond: "koed_last_opp_turn" } }] }, ops: [] },
  ],
  "Mega Lucario ex": [
    { card: "Mega Lucario ex", trigger: { kind: "attack_rider", attackName: "Mega Brave" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
    // (second authoring batch)
    { card: "Mega Lucario ex", trigger: { kind: "attack_rider", attackName: "Aura Jab" }, targets: [{ ref: "e", select: "card", count: 3, upTo: true, card: { zone: "discard", filter: { basicEnergy: true, energyType: "Fighting" } }, chooser: "player" }, { ref: "m", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }] },
  ],
  Riolu: [
    { card: "Riolu", trigger: { kind: "attack_rider", attackName: "Accelerating Stab" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "cannot_attack" }] },
  ],
  Dusknoir: [
    { card: "Dusknoir", trigger: { kind: "attack_rider", attackName: "Shadow Bind" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "cannot_retreat" }] },
  ],
  "Hop's Trevenant": [
    { card: "Hop's Trevenant", trigger: { kind: "attack_rider", attackName: "Corner" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "cannot_retreat" }] },
    // (second authoring batch)
{ card: "Hop's Trevenant", trigger: { kind: "damage_scale", attackName: "Horrifying Revenge" },
    damage: { base: 30, bonuses: [{ amount: 100, when: { cond: "koed_last_opp_turn" } }] }, ops: [] },
  ],
  Yveltal: [
    { card: "Yveltal", trigger: { kind: "attack_rider", attackName: "Clutch" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "cannot_retreat" }] },
  ],
  Buneary: [
    { card: "Buneary", trigger: { kind: "attack_rider", attackName: "Charm" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "damage_dealt_reduction", amount: 20 }] },
  ],
  Chikorita: [
    { card: "Chikorita", trigger: { kind: "attack_rider", attackName: "Growl" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "damage_dealt_reduction", amount: 20 }] },
  ],
  "Empoleon ex": [
    { card: "Empoleon ex", trigger: { kind: "attack_rider", attackName: "Iron Feathers" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "damage_taken_reduction", amount: 60 }] },
  ],
  "Genesect ex": [
    { card: "Genesect ex", trigger: { kind: "attack_rider", attackName: "Protect Charge" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "damage_taken_reduction", amount: 30 }] },
    // (second authoring batch)
{ card: "Genesect ex", ability: "Metallic Signal", trigger: { kind: "activated" },
    targets: [{ ref: "p", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { supertype: "Pokémon", pokemonType: "Metal" } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "hand" }] },
  ],
  Bronzong: [
    { card: "Bronzong", trigger: { kind: "attack_rider", attackName: "Metal Block" }, ops: [{ op: "apply_status", monRef: SELF_REF, status: "damage_taken_reduction", amount: 100, fromEvolutionOnly: true }] },
  ],
  "Ethan's Cyndaquil": [
    { card: "Ethan's Cyndaquil", trigger: { kind: "attack_rider", attackName: "Ember" }, ops: [{ op: "discard_energy", monRef: SELF_REF, n: 1 }] },
  ],
  "Hop's Snorlax": [
    { card: "Hop's Snorlax", trigger: { kind: "attack_rider", attackName: "Dynamic Press" }, ops: [{ op: "damage_self", amount: 80 }] },
  ],
  Rillaboom: [
    { card: "Rillaboom", trigger: { kind: "attack_rider", attackName: "Wood Hammer" }, ops: [{ op: "damage_self", amount: 50 }] },
      { card: "Rillaboom", trigger: { kind: "attack_rider", attackName: "Drum Beating" }, ops: [{ op: "apply_status", monRef: DEFENDER_REF, status: "attack_cost_extra", amount: 1 }, { op: "apply_status", monRef: DEFENDER_REF, status: "retreat_cost_extra", amount: 1 }] },
  ],
  "Tapu Bulu": [
    { card: "Tapu Bulu", trigger: { kind: "attack_rider", attackName: "Wood Hammer" }, ops: [{ op: "damage_self", amount: 30 }] },
  ],
  "Team Rocket's Tarountula": [
    { card: "Team Rocket's Tarountula", trigger: { kind: "attack_rider", attackName: "Take Down" }, ops: [{ op: "damage_self", amount: 10 }] },
  ],
  Dipplin: [
    { card: "Dipplin", trigger: { kind: "attack_rider", attackName: "Energy Loop" }, ops: [{ op: "energy_to_hand", monRef: SELF_REF, n: 1 }] },
  ],
  Dolliv: [
    { card: "Dolliv", trigger: { kind: "attack_rider", attackName: "Nutrients" }, targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "in_play", damaged: true }, chooser: "player" }], ops: [{ op: "heal", monRef: "m", n: 40 }] },
  ],
  Duraludon: [
    { card: "Duraludon", trigger: { kind: "attack_rider", attackName: "Hyper Beam" }, ops: [{ op: "discard_energy", monRef: DEFENDER_REF, n: 1 }] },
  ],
  "Leafeon ex": [
    { card: "Leafeon ex", trigger: { kind: "attack_rider", attackName: "Moss Agate" }, targets: [{ ref: "b", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "all" }], ops: [{ op: "heal", monRef: "b", n: 100 }] },
    // (second authoring batch)
{ card: "Leafeon ex", trigger: { kind: "damage_scale", attackName: "Verdant Storm" },
    damage: { base: 0, per: 60, count: { of: "energy_attached_all", side: "opponent" } }, ops: [] },
  ],
  "Raging Bolt ex": [
    { card: "Raging Bolt ex", trigger: { kind: "attack_rider", attackName: "Burst Roar" }, ops: [{ op: "discard_hand_draw", n: 6 }] },
    // (second authoring batch)
{ card: "Raging Bolt ex", trigger: { kind: "damage_scale", attackName: "Bellowing Thunder" },
    damage: { base: 0, discardBoost: { from: "own_bench", filter: { basicEnergy: true }, per: 70 } }, ops: [] },
  ],
  "Marnie's Grimmsnarl ex": [
    { card: "Marnie's Grimmsnarl ex", trigger: { kind: "attack_rider", attackName: "Shadow Bullet" }, targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }], ops: [{ op: "damage_mon", monRef: "t", amount: 30 }] },
    // (second authoring batch)
{ card: "Marnie's Grimmsnarl ex", ability: "Punk Up", trigger: { kind: "on_evolve" },
    targets: [
      { ref: "e", select: "card", count: 5, upTo: true, card: { zone: "deck", filter: { basicEnergy: true, energyType: "Darkness" } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "in_play", namePrefix: "Marnie's " }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "deck" }] },
  ],
  "Mega Froslass ex": [
    { card: "Mega Froslass ex", trigger: { kind: "attack_rider", attackName: "Absolute Snow" }, ops: [{ op: "apply_condition", monRef: DEFENDER_REF, condition: "Asleep" }] },
    // (second authoring batch)
{ card: "Mega Froslass ex", trigger: { kind: "damage_scale", attackName: "Resentful Refrain" },
    damage: { base: 0, per: 50, count: { of: "opp_hand_size" } }, ops: [] },
  ],
  Piplup: [
    { card: "Piplup", trigger: { kind: "attack_rider", attackName: "Call for Support" }, targets: [{ ref: "s", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Supporter" } }, chooser: "player" }], ops: [{ op: "search", targetRef: "s", to: "hand" }] },
  ],
  Frogadier: [
    { card: "Frogadier", trigger: { kind: "attack_rider", attackName: "Summoning Jutsu" }, targets: [{ ref: "p", select: "card", count: 3, upTo: true, card: { zone: "deck", filter: { supertype: "Pokémon" } }, chooser: "player" }], ops: [{ op: "search", targetRef: "p", to: "hand" }] },
  ],
  Noctowl: [
    { card: "Noctowl", trigger: { kind: "attack_rider", attackName: "Talon Hunt" }, targets: [{ ref: "c", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: {} }, chooser: "player" }], ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  Smoochum: [
    { card: "Smoochum", trigger: { kind: "attack_rider", attackName: "Delightful Kiss" }, targets: [{ ref: "e", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { basicEnergy: true, energyType: "Psychic" } }, chooser: "player" }, { ref: "m", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "deck" }] },
  ],
  Shaymin: [
    { card: "Shaymin", trigger: { kind: "attack_rider", attackName: "Send Flowers" }, targets: [{ ref: "e", select: "card", card: { zone: "deck", filter: { supertype: "Energy" } }, chooser: "player" }, { ref: "m", select: "mon", mon: { side: "own", zone: "bench", type: "Grass" }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "deck" }] },
  ],
  Celebi: [
    { card: "Celebi", trigger: { kind: "attack_rider", attackName: "Traverse Time" }, targets: [{ ref: "c", select: "card", count: 3, upTo: true, card: { zone: "deck", filter: { anyOf: [{ supertype: "Pokémon", pokemonType: "Grass" }, { supertype: "Trainer", subtype: "Stadium" }] } }, chooser: "player" }], ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  Dwebble: [
    { card: "Dwebble", trigger: { kind: "attack_rider", attackName: "Ascension" }, ops: [{ op: "evolve_from_deck", monRef: SELF_REF, filter: { supertype: "Pokémon" } }] },
  ],
  Slowpoke: [
    { card: "Slowpoke", trigger: { kind: "attack_rider", attackName: "All-You-Can-Yeet" }, ops: [{ op: "discard_hand_down_to", who: "own", n: 0 }] },
  ],
  "Team Rocket's Porygon": [
    { card: "Team Rocket's Porygon", trigger: { kind: "attack_rider", attackName: "Hacking" }, ops: [{ op: "discard_hand_cards", n: 1 }, { op: "discard_hand_down_to", who: "opponent", n: 4 }] },
  ],
  Hoothoot: [
    { card: "Hoothoot", trigger: { kind: "attack_rider", attackName: "Silent Wing" }, ops: [] },
  ],
  Alakazam: [
{ card: "Alakazam", ability: "Psychic Draw", trigger: { kind: "on_evolve" }, ops: [{ op: "draw", n: 3 }] },
    { card: "Alakazam", trigger: { kind: "attack_rider", attackName: "Powerful Hand" }, ops: [{ op: "place_counters", monRef: DEFENDER_REF, n: "own_hand_size", per: 2 }] },
  ],
  Kadabra: [
{ card: "Kadabra", ability: "Psychic Draw", trigger: { kind: "on_evolve" }, ops: [{ op: "draw", n: 2 }] },
  ],
  "Hop's Dubwool": [
{ card: "Hop's Dubwool", ability: "Defiant Horn", trigger: { kind: "on_evolve" },
    targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }],
    ops: [{ op: "gust", monRef: "t" }] },
  ],
  "Meowth ex": [
{ card: "Meowth ex", ability: "Last-Ditch Catch", trigger: { kind: "on_play" },
    targets: [{ ref: "s", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Supporter" } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "s", to: "hand" }] },
    { card: "Meowth ex", trigger: { kind: "attack_rider", attackName: "Tuck Tail" },
      ops: [{ op: "bounce_to_hand", monRef: SELF_REF }] },
  ],
  "Bloodmoon Ursaluna": [
{ card: "Bloodmoon Ursaluna", ability: "Battle-Hardened", trigger: { kind: "on_play" },
    targets: [{ ref: "e", select: "card", count: 2, upTo: true, card: { zone: "hand", filter: { basicEnergy: true, energyType: "Fighting" } }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: SELF_REF, from: "hand" }] },
    { card: "Bloodmoon Ursaluna", trigger: { kind: "damage_scale", attackName: "Mad Bite" },
      damage: { base: 100, per: 30, count: { of: "damage_counters_on", side: "opponent", zone: "active" } }, ops: [] },
  ],
  Barbaracle: [
{ card: "Barbaracle", ability: "Stone Arms", trigger: { kind: "activated" },
    targets: [
      { ref: "e", select: "card", card: { zone: "hand", filter: { basicEnergy: true, energyType: "Fighting" } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "in_play", type: "Fighting" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "hand" }] },
  ],
  "Cynthia's Gabite": [
{ card: "Cynthia's Gabite", ability: "Champion's Call", trigger: { kind: "activated" },
    targets: [{ ref: "p", select: "card", card: { zone: "deck", filter: { supertype: "Pokémon", namePrefix: "Cynthia's " } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "hand" }] },
  ],
  Drakloak: [
{ card: "Drakloak", ability: "Recon Directive", trigger: { kind: "activated" },
    ops: [{ op: "reveal_top", n: 2, count: 1, filter: {}, to: "hand" }] },
  ],
  Dudunsparce: [
{ card: "Dudunsparce", ability: "Run Away Draw", trigger: { kind: "activated" },
    ops: [{ op: "draw", n: 3 }, { op: "bounce_to_hand", monRef: SELF_REF }] },
  ],
  Dusclops: [
{ card: "Dusclops", ability: "Cursed Blast", trigger: { kind: "activated" },
    targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "place_counters", monRef: "t", n: 5 }, { op: "ko_self" }] },
  ],
  "Ethan's Quilava": [
{ card: "Ethan's Quilava", ability: "Bonded by the Journey", trigger: { kind: "activated" },
    targets: [{ ref: "c", select: "card", card: { zone: "deck", filter: { nameContains: "Ethan's Adventure" } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  "Hydrapple ex": [
{ card: "Hydrapple ex", ability: "Ripening Charge", trigger: { kind: "activated" },
    targets: [
      { ref: "e", select: "card", card: { zone: "hand", filter: { basicEnergy: true, energyType: "Grass" } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "hand" }, { op: "heal", monRef: "m", n: 30 }] },
    { card: "Hydrapple ex", trigger: { kind: "damage_scale", attackName: "Syrup Storm" },
      damage: { base: 30, per: 30, count: { of: "energy_attached_all", side: "own", energyType: "Grass" } }, ops: [] },
  ],
  Lunatone: [
{ card: "Lunatone", ability: "Lunar Cycle", trigger: { kind: "activated" },
    guards: [{ cond: "own_has_mon", filter: { side: "own", zone: "in_play", nameContains: "Solrock" } }, { cond: "hand_size_gte", n: 1 }],
    ops: [{ op: "discard_hand_cards", n: 1 }, { op: "draw", n: 3 }] },
  ],
  "Pecharunt ex": [
{ card: "Pecharunt ex", ability: "Subjugating Chains", trigger: { kind: "activated" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "bench", type: "Darkness", excludeName: "Pecharunt ex" }, chooser: "player" }],
    ops: [{ op: "switch", monRef: "m" }, { op: "apply_condition", monRef: "m", condition: "Poisoned" }] },
    { card: "Pecharunt ex", trigger: { kind: "damage_scale", attackName: "Irritated Outburst" },
      damage: { base: 0, per: 60, count: { of: "opp_prizes_taken" } }, ops: [] },
  ],
  "Steven's Metagross ex": [
{ card: "Steven's Metagross ex", ability: "X-Boot", trigger: { kind: "activated" },
    targets: [
      { ref: "e", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { anyOf: [{ basicEnergy: true, energyType: "Psychic" }, { basicEnergy: true, energyType: "Metal" }] } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "deck" }] },
  ],
  "Teal Mask Ogerpon ex": [
{ card: "Teal Mask Ogerpon ex", ability: "Teal Dance", trigger: { kind: "activated" },
    targets: [{ ref: "e", select: "card", card: { zone: "hand", filter: { basicEnergy: true, energyType: "Grass" } }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: SELF_REF, from: "hand" }, { op: "draw", n: 1 }] },
    { card: "Teal Mask Ogerpon ex", trigger: { kind: "damage_scale", attackName: "Myriad Leaf Shower" },
      damage: { base: 30, per: 30, count: { of: "energy_on_active", side: "both" } }, ops: [] },
  ],
  "Team Rocket's Spidops": [
{ card: "Team Rocket's Spidops", ability: "Charging Up", trigger: { kind: "activated" },
    targets: [{ ref: "e", select: "card", card: { zone: "discard", filter: { basicEnergy: true } }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: SELF_REF, from: "discard" }] },
    { card: "Team Rocket's Spidops", trigger: { kind: "damage_scale", attackName: "Rocket Rush" },
      damage: { base: 0, per: 30, count: { of: "mons_in_play", side: "own", filter: { side: "own", zone: "in_play", namePrefix: "Team Rocket's " } } }, ops: [] },
  ],
  Thwackey: [
{ card: "Thwackey", ability: "Boom Boom Groove", trigger: { kind: "activated" },
    targets: [{ ref: "c", select: "card", card: { zone: "deck", filter: {} }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  "Bianca's Devotion": [
{ card: "Bianca's Devotion", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "in_play", damaged: true }, chooser: "player" }],
    ops: [{ op: "heal", monRef: "m", n: "all" }] },
  ],
  "Brock's Scouting": [
{ card: "Brock's Scouting", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "p", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { basicPokemon: true } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "hand" }] },
  ],
  "Colress's Tenacity": [
{ card: "Colress's Tenacity", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [
      { ref: "st", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Stadium" } }, chooser: "auto" },
      { ref: "e", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Energy" } }, chooser: "auto" }],
    ops: [{ op: "search", targetRef: "st", to: "hand" }, { op: "search", targetRef: "e", to: "hand" }] },
  ],
  Drayton: [
{ card: "Drayton", trigger: { kind: "trainer", subtype: "Supporter" },
    ops: [{ op: "reveal_top", n: 7, count: 1, filter: { supertype: "Pokémon" }, to: "hand" },
          { op: "reveal_top", n: 7, count: 1, filter: { supertype: "Trainer" }, to: "hand" }] },
  ],
  "Dusk Ball": [
{ card: "Dusk Ball", trigger: { kind: "trainer", subtype: "Item" },
    ops: [{ op: "reveal_top", n: 7, count: 1, filter: { supertype: "Pokémon" }, to: "hand", from: "bottom" }] },
  ],
  "Energy Recycler": [
{ card: "Energy Recycler", trigger: { kind: "trainer", subtype: "Item" },
    ops: [{ op: "discard_to_deck", filter: { basicEnergy: true }, max: 5 }] },
  ],
  "Energy Retrieval": [
{ card: "Energy Retrieval", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "e", select: "card", count: 2, upTo: true, card: { zone: "discard", filter: { basicEnergy: true } }, chooser: "player" }],
    ops: [{ op: "retrieve", targetRef: "e", to: "hand" }] },
  ],
  "Energy Search": [
{ card: "Energy Search", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "e", upTo: true, select: "card", card: { zone: "deck", filter: { basicEnergy: true } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "e", to: "hand" }] },
  ],
  "Energy Switch": [
{ card: "Energy Switch", trigger: { kind: "trainer", subtype: "Item" },
    targets: [
      { ref: "from", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" },
      { ref: "to", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "move_energy", fromRef: "from", toRef: "to", filter: { basicEnergy: true }, count: 1 }] },
  ],
  "Enhanced Hammer": [
{ card: "Enhanced Hammer", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play", hasSpecialEnergy: true }, chooser: "player" }],
    ops: [{ op: "discard_from_mon", monRef: "t", category: "special_energy" }] },
  ],
  Eri: [
{ card: "Eri", trigger: { kind: "trainer", subtype: "Supporter" },
    ops: [{ op: "discard_from_hand", who: "opponent", filter: { supertype: "Trainer", subtype: "Item" }, max: 2 }] },
  ],
  "Ethan's Adventure": [
{ card: "Ethan's Adventure", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "c", select: "card", count: 3, upTo: true,
      card: { zone: "deck", filter: { anyOf: [{ supertype: "Pokémon", namePrefix: "Ethan's " }, { basicEnergy: true, energyType: "Fire" }] } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  "Fighting Gong": [
{ card: "Fighting Gong", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "c", upTo: true, select: "card",
      card: { zone: "deck", filter: { anyOf: [{ basicEnergy: true, energyType: "Fighting" }, { basicPokemon: true, pokemonType: "Fighting" }] } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "c", to: "hand" }] },
  ],
  "Hand Trimmer": [
{ card: "Hand Trimmer", trigger: { kind: "trainer", subtype: "Item" },
    ops: [{ op: "discard_hand_down_to", who: "both", n: 5 }] },
  ],
  Hassel: [
{ card: "Hassel", trigger: { kind: "trainer", subtype: "Supporter" },
    guards: [{ cond: "koed_last_opp_turn" }],
    ops: [{ op: "reveal_top", n: 8, count: 3, filter: {}, to: "hand" }] },
  ],
  "Hop's Bag": [
{ card: "Hop's Bag", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "p", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { basicPokemon: true, namePrefix: "Hop's " } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "bench" }] },
  ],
  "Iris's Fighting Spirit": [
{ card: "Iris's Fighting Spirit", trigger: { kind: "trainer", subtype: "Supporter" },
    guards: [{ cond: "hand_size_gte", n: 2 }],
    ops: [{ op: "discard_hand_cards", n: 1 }, { op: "draw_until", n: 6 }] },
  ],
  "Jumbo Ice Cream": [
{ card: "Jumbo Ice Cream", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "active", damaged: true }, chooser: "player" }],
    ops: [{ op: "heal", monRef: "m", n: 80 }] },
  ],
  Kieran: [
{ card: "Kieran", trigger: { kind: "trainer", subtype: "Supporter" },
    ops: [{ op: "buff_damage_this_turn", amount: 30, vsTarget: "ex_or_v" }] },
  ],
  "Lana's Aid": [
{ card: "Lana's Aid", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "c", select: "card", count: 3, upTo: true,
      card: { zone: "discard", filter: { anyOf: [{ supertype: "Pokémon", singlePrize: true }, { basicEnergy: true }] } }, chooser: "player" }],
    ops: [{ op: "retrieve", targetRef: "c", to: "hand" }] },
  ],
  "Larry's Skill": [
{ card: "Larry's Skill", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [
      { ref: "p", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Pokémon" } }, chooser: "auto" },
      { ref: "s", upTo: true, select: "card", card: { zone: "deck", filter: { supertype: "Trainer", subtype: "Supporter" } }, chooser: "auto" },
      { ref: "e", upTo: true, select: "card", card: { zone: "deck", filter: { basicEnergy: true } }, chooser: "auto" }],
    ops: [{ op: "discard_hand_cards", n: 99 }, { op: "search", targetRef: "p", to: "hand" },
          { op: "search", targetRef: "s", to: "hand" }, { op: "search", targetRef: "e", to: "hand" }] },
  ],
  "Lisia's Appeal": [
{ card: "Lisia's Appeal", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench", basic: true }, chooser: "player" }],
    ops: [{ op: "gust", monRef: "t" }, { op: "apply_condition", monRef: "t", condition: "Confused" }] },
  ],
  "Miracle Headset": [
{ card: "Miracle Headset", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "s", select: "card", count: 2, upTo: true, card: { zone: "discard", filter: { supertype: "Trainer", subtype: "Supporter" } }, chooser: "player" }],
    ops: [{ op: "retrieve", targetRef: "s", to: "hand" }] },
  ],
  "Morty's Conviction": [
{ card: "Morty's Conviction", trigger: { kind: "trainer", subtype: "Supporter" },
    guards: [{ cond: "hand_size_gte", n: 2 }],
    ops: [{ op: "discard_hand_cards", n: 1 }, { op: "draw", n: "opp_bench_count" }] },
  ],
  Philippe: [
{ card: "Philippe", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [
      { ref: "e", select: "card", count: 2, upTo: true, card: { zone: "discard", filter: { basicEnergy: true, energyType: "Metal" } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "in_play", type: "Metal" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }] },
  ],
  "Pokémon Catcher": [
{ card: "Pokémon Catcher", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }],
    ops: [{ op: "coin_flip", heads: [{ op: "gust", monRef: "t" }] }] },
  ],
  "Pokémon Center Lady": [
{ card: "Pokémon Center Lady", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "heal", monRef: "m", n: 60 }, { op: "clear_conditions", monRef: "m" }] },
  ],
  "Precious Trolley": [
{ card: "Precious Trolley", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "p", select: "card", count: 5, upTo: true, card: { zone: "deck", filter: { basicPokemon: true } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "bench" }] },
  ],
  "Premium Power Pro": [
{ card: "Premium Power Pro", trigger: { kind: "trainer", subtype: "Supporter" },
    ops: [{ op: "buff_damage_this_turn", amount: 30, attackerType: "Fighting" }] },
  ],
  "Prime Catcher": [
{ card: "Prime Catcher", trigger: { kind: "trainer", subtype: "Item" },
    targets: [
      { ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" },
      { ref: "s", upTo: true, select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }],
    ops: [{ op: "gust", monRef: "t" }, { op: "switch", monRef: "s" }] },
  ],
  "Roto-Stick": [
{ card: "Roto-Stick", trigger: { kind: "trainer", subtype: "Item" },
    ops: [{ op: "reveal_top", n: 4, count: 4, filter: { supertype: "Trainer", subtype: "Supporter" }, to: "hand" }] },
  ],
  "Sacred Ash": [
{ card: "Sacred Ash", trigger: { kind: "trainer", subtype: "Item" },
    ops: [{ op: "discard_to_deck", filter: { supertype: "Pokémon" }, max: 5 }] },
  ],
  Salvatore: [
{ card: "Salvatore", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "evolve_from_deck", monRef: "m", filter: { supertype: "Pokémon" } }] },
  ],
  "Scoop Up Cyclone": [
{ card: "Scoop Up Cyclone", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "bench" }, chooser: "player" }],
    ops: [{ op: "bounce_to_hand", monRef: "m" }] },
  ],
  Tarragon: [
{ card: "Tarragon", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "c", select: "card", count: 4, upTo: true,
      card: { zone: "discard", filter: { anyOf: [{ supertype: "Pokémon", pokemonType: "Fighting" }, { basicEnergy: true, energyType: "Fighting" }] } }, chooser: "player" }],
    ops: [{ op: "retrieve", targetRef: "c", to: "hand" }] },
  ],
  "Team Rocket's Archer": [
{ card: "Team Rocket's Archer", trigger: { kind: "trainer", subtype: "Supporter" },
    guards: [{ cond: "koed_last_opp_turn" }],
    ops: [{ op: "shuffle_hand_draw", n: 5 }, { op: "hand_to_bottom_draw", n: 3, who: "opponent" }] },
  ],
  "Team Rocket's Ariana": [
{ card: "Team Rocket's Ariana", trigger: { kind: "trainer", subtype: "Supporter" },
    ops: [{ op: "draw_until", n: 5, bonus: { n: 8, when: { cond: "all_own_mons_match", filter: { side: "own", zone: "in_play", namePrefix: "Team Rocket's " } } } }] },
  ],
  "Team Rocket's Giovanni": [
{ card: "Team Rocket's Giovanni", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [
      { ref: "s", select: "mon", mon: { side: "own", zone: "bench", namePrefix: "Team Rocket's " }, chooser: "player" },
      { ref: "t", select: "mon", mon: { side: "opponent", zone: "bench" }, chooser: "player" }],
    ops: [{ op: "switch", monRef: "s" }, { op: "gust", monRef: "t" }] },
  ],
  "Team Rocket's Proton": [
{ card: "Team Rocket's Proton", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "p", select: "card", count: 3, upTo: true, card: { zone: "deck", filter: { basicPokemon: true, namePrefix: "Team Rocket's " } }, chooser: "player" }],
    ops: [{ op: "search", targetRef: "p", to: "hand" }] },
  ],
  "Team Rocket's Venture Bomb": [
{ card: "Team Rocket's Venture Bomb", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "t", select: "mon", mon: { side: "opponent", zone: "in_play" }, chooser: "player" }],
    ops: [{ op: "coin_flip", heads: [{ op: "place_counters", monRef: "t", n: 2 }], tails: [{ op: "place_counters", monRef: OWN_ACTIVE_REF, n: 2 }] }] },
  ],
  "Tool Scrapper": [
{ card: "Tool Scrapper", trigger: { kind: "trainer", subtype: "Item" },
    targets: [{ ref: "t", select: "mon", count: 2, upTo: true, mon: { side: "opponent", zone: "in_play", hasTool: true }, chooser: "player" }],
    ops: [{ op: "discard_from_mon", monRef: "t", category: "tool" }] },
  ],
  "Unfair Stamp": [
{ card: "Unfair Stamp", trigger: { kind: "trainer", subtype: "Item" },
    guards: [{ cond: "koed_last_opp_turn" }],
    ops: [{ op: "shuffle_hand_draw", n: 5 }, { op: "hand_to_bottom_draw", n: 2, who: "opponent" }] },
  ],
  "Wally's Compassion": [
{ card: "Wally's Compassion", trigger: { kind: "trainer", subtype: "Supporter" },
    targets: [{ ref: "m", select: "mon", mon: { side: "own", zone: "in_play", isEx: true, damaged: true }, chooser: "player" }],
    ops: [{ op: "heal", monRef: "m", n: "all" }] },
  ],
  "Wondrous Patch": [
{ card: "Wondrous Patch", trigger: { kind: "trainer", subtype: "Item" },
    targets: [
      { ref: "e", select: "card", card: { zone: "discard", filter: { basicEnergy: true, energyType: "Psychic" } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "bench", type: "Psychic" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }] },
  ],
  "Xerosic's Machinations": [
{ card: "Xerosic's Machinations", trigger: { kind: "trainer", subtype: "Supporter" },
    ops: [{ op: "discard_hand_down_to", who: "opponent", n: 3 }] },
  ],
  "Glass Trumpet": [
{ card: "Glass Trumpet", trigger: { kind: "trainer", subtype: "Item" },
    guards: [{ cond: "own_has_mon", filter: { side: "own", zone: "in_play", subtype: "Tera" } }],
    targets: [
      { ref: "e", select: "card", count: 2, upTo: true, card: { zone: "discard", filter: { basicEnergy: true } }, chooser: "player" },
      { ref: "m", select: "mon", mon: { side: "own", zone: "bench", type: "Colorless" }, chooser: "player" }],
    ops: [{ op: "attach_energy", energyRef: "e", monRef: "m", from: "discard" }] },
  ],
  Bronzor: [
{ card: "Bronzor", trigger: { kind: "damage_scale", attackName: "Mirror Attack" },
    damage: { base: 10, bonuses: [{ amount: 30, when: { cond: "opp_active_is", filter: { side: "opponent", zone: "active", type: "Metal" } } }] }, ops: [] },
  ],
  "Cynthia's Spiritomb": [
{ card: "Cynthia's Spiritomb", trigger: { kind: "damage_scale", attackName: "Raging Curse" },
    damage: { base: 0, per: 10, count: { of: "damage_counters_on", side: "own", zone: "bench", filter: { side: "own", zone: "bench", namePrefix: "Cynthia's " } } }, ops: [] },
  ],
  Deoxys: [
{ card: "Deoxys", trigger: { kind: "damage_scale", attackName: "Psychic" },
    damage: { base: 80, per: 20, count: { of: "energy_on_active", side: "opponent" } }, ops: [] },
    { card: "Deoxys", trigger: { kind: "attack_rider", attackName: "Genome Charge" }, targets: [{ ref: "e", select: "card", count: 2, upTo: true, card: { zone: "deck", filter: { basicEnergy: true, energyType: "Psychic" } }, chooser: "player" }], ops: [{ op: "attach_energy", energyRef: "e", monRef: SELF_REF, from: "deck" }] },
  ],
  Dialga: [
{ card: "Dialga", trigger: { kind: "damage_scale", attackName: "Chrono Burst" },
    damage: { base: 80, discardBoost: { from: "self", filter: { supertype: "Energy" }, per: 0, flat: 80, to: "deck" } }, ops: [] },
  ],
  Eevee: [
{ card: "Eevee", trigger: { kind: "damage_scale", attackName: "Quick Attack" },
    damage: { base: 20, per: 20, count: { of: "coin_flips", n: 1 } }, ops: [] },
    { card: "Eevee", trigger: { kind: "attack_rider", attackName: "Ascension" }, ops: [{ op: "evolve_from_deck", monRef: SELF_REF, filter: { supertype: "Pokémon" } }] },
  ],
  "Ethan's Typhlosion": [
{ card: "Ethan's Typhlosion", trigger: { kind: "damage_scale", attackName: "Buddy Blast" },
    damage: { base: 40, per: 60, count: { of: "cards_in_zone", zone: "discard", side: "own", filter: { nameContains: "Ethan's Adventure" } } }, ops: [] },
  ],
  Glalie: [
{ card: "Glalie", trigger: { kind: "damage_scale", attackName: "Damage Beat" },
    damage: { base: 0, per: 20, count: { of: "damage_counters_on", side: "opponent", zone: "active" } }, ops: [] },
    { card: "Glalie", trigger: { kind: "attack_rider", attackName: "Crazy Headbutt" }, ops: [{ op: "discard_energy", monRef: SELF_REF, n: 1 }] },
  ],
  "Mega Diancie ex": [
{ card: "Mega Diancie ex", trigger: { kind: "damage_scale", attackName: "Garland Ray" },
    damage: { base: 0, discardBoost: { from: "self", filter: { supertype: "Energy" }, max: 2, per: 120 } }, ops: [] },
  ],
  Metagross: [
{ card: "Metagross", trigger: { kind: "damage_scale", attackName: "Metallic Hammer" },
    damage: { base: 150, discardBoost: { from: "self", filter: { supertype: "Energy", energyType: "Metal" }, exactly: 3, per: 0, flat: 150 } }, ops: [] },
    { card: "Metagross", trigger: { kind: "attack_rider", attackName: "Bounce Back" }, ops: [{ op: "opponent_switches_active" }] },
  ],
  Okidogi: [
{ card: "Okidogi", trigger: { kind: "damage_scale", attackName: "Settle the Score" },
    damage: { base: 80, per: 60, count: { of: "opp_prizes_taken_last_turn" } }, ops: [] },
  ],
  Passimian: [
{ card: "Passimian", trigger: { kind: "damage_scale", attackName: "Coordinated Throwing" },
    damage: { base: 0, per: 20, count: { of: "mons_in_play", side: "own", filter: { side: "own", zone: "in_play", basic: true } } }, ops: [] },
  ],
  Relicanth: [
{ card: "Relicanth", trigger: { kind: "damage_scale", attackName: "Fossil Beatdown" },
    damage: { base: 10, per: 30, count: { of: "mons_in_play", side: "own", filter: { side: "own", zone: "bench", nameContains: "Antique" } } }, ops: [] },
  ],
  "Team Rocket's Honchkrow": [
{ card: "Team Rocket's Honchkrow", trigger: { kind: "damage_scale", attackName: "Rocket Feathers" },
    damage: { base: 0, discardBoost: { from: "hand", filter: { supertype: "Trainer", subtype: "Supporter", nameContains: "Team Rocket" }, per: 60 } }, ops: [] },
  ],
  "Team Rocket's Kangaskhan ex": [
    { card: "Team Rocket's Kangaskhan ex", trigger: { kind: "damage_scale", attackName: "Comet Punch" },
      damage: { base: 0, per: 30, count: { of: "coin_flips", n: 4 } }, ops: [] },
    { card: "Team Rocket's Kangaskhan ex", trigger: { kind: "damage_scale", attackName: "Wicked Impact" },
      damage: { base: 120, bonuses: [{ amount: 100, when: { cond: "supporter_played_contains", text: "Team Rocket" } }] }, ops: [] },
  ],
  "Team Rocket's Mewtwo ex": [
{ card: "Team Rocket's Mewtwo ex", trigger: { kind: "damage_scale", attackName: "Erasure Ball" },
    damage: { base: 160, discardBoost: { from: "own_bench", filter: { supertype: "Energy" }, max: 2, per: 60 } }, ops: [] },
  ],
  "Team Rocket's Porygon2": [
{ card: "Team Rocket's Porygon2", trigger: { kind: "damage_scale", attackName: "R Command" },
    damage: { base: 0, per: 20, count: { of: "cards_in_zone", zone: "discard", side: "own", filter: { supertype: "Trainer", subtype: "Supporter", nameContains: "Team Rocket" } } }, ops: [] },
  ],
  "Jet Energy": [
    {
      card: "Jet Energy",
      trigger: { kind: "on_attach" },
      ops: [{ op: "switch", monRef: SELF_REF }],
    },
  ],
  "Enriching Energy": [
    {
      card: "Enriching Energy",
      trigger: { kind: "on_attach" },
      ops: [{ op: "draw", n: 4 }],
    },
  ],
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
  "Lillie's Clefairy ex": [
    {
      card: "Lillie's Clefairy ex",
      trigger: { kind: "damage_scale", attackName: "Full Moon Rondo" },
      damage: { base: 20, per: 20, count: { of: "bench_count", side: "both" } },
      ops: [],
    },
  ],
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

/** The first effect on `cardName` with the given trigger kind, plus its
 *  ORIGINAL index. Shared by the on-play / on-evolve / on-attach paths, which
 *  all resolve INSIDE another move rather than as moves of their own. */
export function triggerEffect(
  cardName: string,
  kind: "on_play" | "on_evolve" | "on_attach",
): { effect: CardEffect; index: number } | null {
  const effects = effectsFor(cardName);
  for (let index = 0; index < effects.length; index++) {
    if (effects[index].trigger.kind === kind) return { effect: effects[index], index };
  }
  return null;
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

/** Damage an attack's RIDER contributes, for AI evaluation only. Sums the
 *  damage_mon / place_counters ops it would apply to an opponent's Pokémon.
 *  Rider damage never shows in the printed number, so without this the
 *  policies score Cruel Arrow (100 to any Pokémon) and Powerful Hand as 0 and
 *  refuse to arm or use those attackers at all. */
export function riderDamageEstimate(
  cardName: string,
  attackName: string,
  /** Board context for ops whose damage depends on it. Copy-an-attack needs
   *  the donor pool: without it Night Joker / Gemstone Mimicry / Seek
   *  Inspiration estimate 0 and the AI never arms the attack that IS the
   *  deck. Callers with no board pass nothing and get the conservative read. */
  ctx?: { ownBench?: readonly (PokemonInPlay | null)[]; oppActive?: PokemonInPlay | null },
): number {
  const hit = attackRiderEffect(cardName, attackName);
  if (!hit) return 0;
  let dmg = 0;
  for (const op of hit.effect.ops) {
    if (op.op === "damage_mon") dmg += op.amount;
    else if (op.op === "place_counters") {
      // A dynamic count (hand size, bench count) can't be resolved without the
      // board, so assume a typical mid-game value. Without SOME estimate these
      // attacks score 0 and the AI never arms them at all.
      const NOMINAL_DYNAMIC = 5;
      const n = typeof op.n === "number" ? op.n : NOMINAL_DYNAMIC;
      dmg += n * (op.per ?? 1) * 10;
    }
    else if (op.op === "damage_opponent_bench") dmg += op.amount;
    else if (op.op === "use_copied_attack") {
      if (op.from === "deck_top") dmg += DECK_TOP_NOMINAL;
      else if (ctx) {
        const pool = op.from === "own_bench" ? ctx.ownBench ?? [] : [ctx.oppActive ?? null];
        dmg += bestCopy(pool, op.filter)?.damage ?? 0;
      }
    }
  }
  return dmg;
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

/** Does this effect ATTACH ENERGY — i.e. is it acceleration?
 *
 *  Acceleration is not a nicety, it is how half the format gets to attack at
 *  all. Manual attachment is once per turn, so a deck whose attacker costs
 *  three is two turns behind unless it accelerates. But an effect that only
 *  attaches energy classifies as `tactical`, which both policies played DEAD
 *  LAST — after the attack branch had already ended the turn. So the AI
 *  essentially never accelerated, and the decks that depend on it had a legal
 *  attack on only ~25% of their turns versus ~65% for the aggro decks that
 *  need no help. That is the whole shape of the calibration residual: every
 *  engine archetype under-rated, every simple aggro one over-rated. */
export function isEnergyAccelEffect(cardName: string, effectIndex: number): boolean {
  const effect = effectsFor(cardName)[effectIndex];
  return effect ? effect.ops.some((o) => o.op === "attach_energy") : false;
}

/** The coarse phase of a declarative-effect move, or null for other moves.
 *  The shared seam the AI policies use to handle effect moves generically. */
export function effectMovePhase(cardName: string, effectIndex: number): "draw" | "search" | "tactical" | null {
  const effect = effectsFor(cardName)[effectIndex];
  return effect ? effectPhase(effect) : null;
}
