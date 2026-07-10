import { parseDeckListCards, type Card } from "@/lib/cardPrinting";

/**
 * Card-level diff between two deck lists, GitHub-style. Cards are keyed by
 * name within their section (printings aggregated — swapping a card's set
 * stamp isn't a gameplay change), so the output reads like a decklist
 * changelog: +2 Judge, −2 Iono, 3→4 Rare Candy.
 */

export type DeckSection = Card["section"];

export interface DiffEntry {
  name: string;
  section: DeckSection;
  /** Copy count in the "from" list (0 for added cards). */
  fromQty: number;
  /** Copy count in the "to" list (0 for removed cards). */
  toQty: number;
}

export interface DeckDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  changed: DiffEntry[];
  /** True when the two lists have identical card counts. */
  empty: boolean;
}

const SECTION_ORDER: Record<DeckSection, number> = {
  pokemon: 0,
  trainer: 1,
  energy: 2,
};

function countByName(list: string): Map<string, { qty: number; section: DeckSection; name: string }> {
  const out = new Map<string, { qty: number; section: DeckSection; name: string }>();
  for (const c of parseDeckListCards(list)) {
    const key = `${c.section}|${c.name.toLowerCase()}`;
    const prev = out.get(key);
    if (prev) prev.qty += c.qty;
    else out.set(key, { qty: c.qty, section: c.section, name: c.name });
  }
  return out;
}

function bySection(a: DiffEntry, b: DiffEntry): number {
  return (
    SECTION_ORDER[a.section] - SECTION_ORDER[b.section] ||
    a.name.localeCompare(b.name)
  );
}

export function diffDeckLists(from: string, to: string): DeckDiff {
  const fromCounts = countByName(from);
  const toCounts = countByName(to);

  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const changed: DiffEntry[] = [];

  toCounts.forEach((entry, key) => {
    const prev = fromCounts.get(key);
    if (!prev) {
      added.push({ name: entry.name, section: entry.section, fromQty: 0, toQty: entry.qty });
    } else if (prev.qty !== entry.qty) {
      changed.push({ name: entry.name, section: entry.section, fromQty: prev.qty, toQty: entry.qty });
    }
  });

  fromCounts.forEach((entry, key) => {
    if (!toCounts.has(key)) {
      removed.push({ name: entry.name, section: entry.section, fromQty: entry.qty, toQty: 0 });
    }
  });

  added.sort(bySection);
  removed.sort(bySection);
  changed.sort(bySection);

  return {
    added,
    removed,
    changed,
    empty: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}
