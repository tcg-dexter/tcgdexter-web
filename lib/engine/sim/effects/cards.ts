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
};

export function effectsFor(cardName: string): CardEffect[] {
  return EFFECT_CARDS[cardName] ?? [];
}
