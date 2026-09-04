// The deck corpus: every real list we can learn composition from.
//
// 30 meta archetypes with ~340 recorded variants, plus (optionally) the
// PUBLIC community pool. This is the prior the generators sample from, and
// it matters more than any heuristic we could write: it encodes which cards
// appear together, at what counts, in lists humans actually won with — the
// exact structure the simulator is measurably bad at inferring (W5).
//
// Community decks keep the public-only boundary of lib/ml/communityDecks.ts.
// Nothing here reads a private list or carries a user id.

import metaDecksRaw from "@/data/meta-decks.json";
import metaArchetypesRaw from "@/data/meta-archetypes.json";
import { metaDeckToList, type MetaDeckEntry } from "@/lib/metaDeckList";
import { legalityIssues, parseDeck, roleOf, type CardRole, type DeckEntry } from "./rules";
import { lookupCard } from "@/lib/engine/catalog";

export interface CorpusDeck {
  id: string;
  /** Archetype id for a meta list; null for community decks. */
  archetype: string | null;
  /** Share of the real field this archetype holds (0 for community). */
  representation: number;
  entries: DeckEntry[];
}

export interface CardFacts {
  name: string;
  role: CardRole;
  /** Printing token seen most often for this name — kept so a generated
   *  line resolves to the same physical card the corpus used. */
  printing: string | null;
  /** Decks containing it / decks in the corpus. */
  frequency: number;
  /** Counts seen, most common first ("3 Iono" is a different card from
   *  "1 Iono" as far as a deck's function is concerned). */
  modalQty: number;
  decks: Set<string>;
}

export interface Corpus {
  decks: CorpusDeck[];
  cards: Map<string, CardFacts>;
  /** Card names grouped by role, for role-preserving swaps. */
  byRole: Map<CardRole, string[]>;
  /** Archetype id → its recorded variants. */
  variantsOf: Map<string, CorpusDeck[]>;
}

interface RawMetaDeck extends MetaDeckEntry {
  variants?: { cards: MetaDeckEntry["cards"] }[];
}

/** Every recorded variant of every archetype, as parsed entry lists.
 *
 *  Variants that fail LEGALITY are dropped: 4 of the 340 recorded lists hold
 *  a card outside the standard catalog (Battle Compressor) or come to 59
 *  cards, and mutating an illegal parent can only produce illegal children —
 *  it burned attempts and skewed which archetypes reached the corpus.
 *  Playability is NOT filtered here; a real deck that looks odd to our
 *  heuristics is exactly what we want the pilot to meet. */
export function loadMetaCorpus(): CorpusDeck[] {
  const rep = new Map(
    (metaArchetypesRaw as { id: string; representation_pct: number }[]).map((a) => [
      a.id,
      a.representation_pct,
    ]),
  );
  const out: CorpusDeck[] = [];
  for (const raw of metaDecksRaw as RawMetaDeck[]) {
    const variants = raw.variants?.length
      ? raw.variants.map((v) => v.cards)
      : raw.cards?.length
        ? [raw.cards]
        : [];
    variants.forEach((cards, i) => {
      const list = metaDeckToList({ ...raw, cards } as MetaDeckEntry);
      if (!list) return;
      const entries = parseDeck(list);
      if (entries.length === 0) return;
      if (legalityIssues(entries).length > 0) return;
      out.push({
        id: `${raw.id}#v${i}`,
        archetype: raw.id,
        representation: rep.get(raw.id) ?? 0,
        entries,
      });
    });
  }
  return out;
}

export function buildCorpus(decks: CorpusDeck[]): Corpus {
  const cards = new Map<string, CardFacts>();
  const qtySeen = new Map<string, Map<number, number>>();
  for (const deck of decks) {
    for (const e of deck.entries) {
      if (e.qty <= 0) continue;
      let facts = cards.get(e.name);
      if (!facts) {
        facts = {
          name: e.name,
          role: roleOf(lookupCard(e.name)),
          printing: e.printing,
          frequency: 0,
          modalQty: e.qty,
          decks: new Set(),
        };
        cards.set(e.name, facts);
      }
      if (facts.printing == null && e.printing) facts.printing = e.printing;
      facts.decks.add(deck.id);
      const counts = qtySeen.get(e.name) ?? new Map<number, number>();
      counts.set(e.qty, (counts.get(e.qty) ?? 0) + 1);
      qtySeen.set(e.name, counts);
    }
  }
  for (const facts of Array.from(cards.values())) {
    facts.frequency = decks.length > 0 ? facts.decks.size / decks.length : 0;
    const counts = qtySeen.get(facts.name);
    if (counts) {
      facts.modalQty = Array.from(counts).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    }
  }
  const byRole = new Map<CardRole, string[]>();
  for (const facts of Array.from(cards.values())) {
    const list = byRole.get(facts.role) ?? [];
    list.push(facts.name);
    byRole.set(facts.role, list);
  }
  // Frequency order, so a weighted draw that truncates still sees the cards
  // the field actually plays.
  for (const [role, names] of Array.from(byRole)) {
    names.sort((a, b) => (cards.get(b)!.frequency - cards.get(a)!.frequency) || a.localeCompare(b));
    byRole.set(role, names);
  }
  const variantsOf = new Map<string, CorpusDeck[]>();
  for (const deck of decks) {
    if (!deck.archetype) continue;
    const list = variantsOf.get(deck.archetype) ?? [];
    list.push(deck);
    variantsOf.set(deck.archetype, list);
  }
  return { decks, cards, byRole, variantsOf };
}

/** How often each card appears across one archetype's variants, and at what
 *  count. The skeleton generator's prior: cards near 1.0 are the archetype,
 *  the rest are its flex slots — which is exactly the distinction a deck
 *  builder is making when they ask "what else could go here". */
export function archetypeProfile(
  corpus: Corpus,
  archetype: string,
): { name: string; frequency: number; modalQty: number; printing: string | null }[] {
  const variants = corpus.variantsOf.get(archetype) ?? [];
  if (variants.length === 0) return [];
  const seen = new Map<string, { decks: number; qty: Map<number, number>; printing: string | null }>();
  for (const v of variants) {
    for (const e of v.entries) {
      if (e.qty <= 0) continue;
      const rec = seen.get(e.name) ?? { decks: 0, qty: new Map<number, number>(), printing: e.printing };
      rec.decks += 1;
      rec.qty.set(e.qty, (rec.qty.get(e.qty) ?? 0) + 1);
      if (rec.printing == null) rec.printing = e.printing;
      seen.set(e.name, rec);
    }
  }
  return Array.from(seen, ([name, rec]) => ({
    name,
    frequency: rec.decks / variants.length,
    modalQty: Array.from(rec.qty).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0],
    printing: rec.printing,
  })).sort((a, b) => b.frequency - a.frequency || a.name.localeCompare(b.name));
}
