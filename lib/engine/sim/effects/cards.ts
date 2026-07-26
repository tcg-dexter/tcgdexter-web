// Declarative card registry (W2). Each card's non-vanilla behavior expressed
// as CardEffect data. This begins with representative cards spanning the shapes
// (search→bench, gust, no-target refresh, multi-target attach); the full ~35
// migration + the meta engines (W3) extend this table. A card here is NOT in
// the legacy TRAINER_EFFECTS/ACTIVATED registries — the two are mutually
// exclusive during cutover so nothing double-lists.

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
};

export function effectsFor(cardName: string): CardEffect[] {
  return EFFECT_CARDS[cardName] ?? [];
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
