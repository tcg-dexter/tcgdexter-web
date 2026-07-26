// Deck effect-coverage (W1) — the measurement backbone for simulation-based
// grading. Reports what fraction of a deck's effect-bearing cards have their
// EFFECTS modeled by the engine (deck ∩ the effect registries), plus a gap
// list of the unmodeled cards. This is distinct from name-resolution coverage
// (coverageOf in replayView.ts), which is ~1.0 even for a deck the engine
// plays as vanilla blanks.

import { parseDeckListCards } from "@/lib/cardPrinting";
import { lookupCard } from "@/lib/engine/catalog";
import { canonicalCardName } from "@/lib/engine/sim/setup";
import { classifyCardEffects, type EffectSlotKind } from "@/lib/engine/sim/coverage";

export interface EffectGap {
  key: string;
  kind: EffectSlotKind;
  /** Copies in the deck whose effect is unmodeled (qty-weighted). */
  copies: number;
}

export interface DeckEffectCoverage {
  /** Effect slots (qty-weighted) the deck asks the engine to model. */
  slots: number;
  implemented: number;
  /** implemented / slots; 1 when the deck is entirely vanilla (no slots). */
  fraction: number;
  /** Names that don't resolve in the catalog at all (a separate problem). */
  unknownCards: string[];
  /** Unmodeled slots, most-copies first. */
  gaps: EffectGap[];
}

/** Effect-coverage of a single deck list. Qty-weighted so multi-copy staples
 *  count proportionally (matches how much of the 60 cards actually works). */
export function deckEffectCoverage(deckList: string): DeckEffectCoverage {
  let slots = 0;
  let implemented = 0;
  const unknownCards: string[] = [];
  const gapMap = new Map<string, EffectGap>();

  for (const entry of parseDeckListCards(deckList)) {
    const name = canonicalCardName(entry.name);
    if (!lookupCard(name)) {
      unknownCards.push(entry.name);
      continue;
    }
    for (const slot of classifyCardEffects(name)) {
      slots += entry.qty;
      if (slot.implemented) {
        implemented += entry.qty;
      } else {
        const existing = gapMap.get(slot.key);
        if (existing) existing.copies += entry.qty;
        else gapMap.set(slot.key, { key: slot.key, kind: slot.kind, copies: entry.qty });
      }
    }
  }

  const gaps = Array.from(gapMap.values()).sort((a, b) => b.copies - a.copies);
  return {
    slots,
    implemented,
    fraction: slots > 0 ? implemented / slots : 1,
    unknownCards,
    gaps,
  };
}
