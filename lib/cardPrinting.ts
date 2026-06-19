/**
 * cardPrinting.ts — Shared deck-list parsing + printing resolution.
 *
 * Single source of truth used by BOTH the home analyzer (/api/analyze) and
 * the live re-pricing path for saved/shared decks (lib/reprice-deck.ts).
 * Keeping these in one place ensures legality and price are computed against
 * the SAME printing in both — previously reprice-deck guessed from the first
 * DB printing (entries[0]) and could flag a legal card (e.g. JTG Dunsparce,
 * mark "I") as "not legal".
 */

import cardData from "@/data/cards-standard.json";
import { basicEnergyAliasKeys } from "@/lib/basicEnergyAlias";

/* ─── Card DB ────────────────────────────────────────────────── */

export interface CardDataEntry {
  name: string;
  set_id: string;
  set_name: string;
  /** ptcgo set code as it appears in deck lists (e.g. "POR" for Perfect Order). */
  ptcgo_code?: string;
  number: string;
  supertype: string;
  subtypes: string[];
  /** Elemental types on Pokémon cards (e.g. ["Darkness"]). Empty/absent on Trainer/Energy. */
  types?: string[];
  hp: string | null;
  abilities: Array<{ name: string; text: string; type: string }>;
  attacks: Array<{
    name: string;
    cost: string[];
    damage: string;
    text: string;
    convertedEnergyCost: number;
  }>;
  rules: string[];
  regulation_mark: string | null;
  retreat_cost: number | null;
  market_price: number | null;
}

export const CARD_DB = cardData as unknown as Record<string, CardDataEntry[]>;
export const CARD_DB_LOWER = new Map(
  Object.entries(CARD_DB).map(([k, v]) => [k.toLowerCase(), v])
);

/* ─── Parsed deck-list card ──────────────────────────────────── */

export interface Card {
  qty: number;
  name: string;
  number: string;  // card number from deck list (e.g. "284")
  setCode: string; // ptcgo set code from deck list (e.g. "POR"); "" if absent
  section: "pokemon" | "trainer" | "energy";
}

/* ─── Parser ─────────────────────────────────────────────────── */

/**
 * Parse a raw PTCGO/PTCGL-style deck list into structured cards, preserving
 * the set code + collector number on each line so the correct printing can be
 * resolved later. Lines without a set code fall back to name-only.
 */
export function parseDeckListCards(raw: string): Card[] {
  const lines = raw.split("\n").map((l) => l.trim());
  const cards: Card[] = [];
  let currentSection: Card["section"] | null = null;

  for (const line of lines) {
    if (!line) continue;

    const headerMatch = line.match(/^(Pok[eé]mon|Trainer|Energy)\s*:/i);
    if (headerMatch) {
      const h = headerMatch[1].toLowerCase();
      if (h.startsWith("pok")) currentSection = "pokemon";
      else if (h === "trainer") currentSection = "trainer";
      else currentSection = "energy";
      continue;
    }

    if (/^total\s+cards?\s*:/i.test(line)) continue;

    const cardMatch = line.match(/^(\d+)\s+(.+?)\s+([A-Z0-9-]{2,10})\s+(\d+)$/);
    if (cardMatch && currentSection) {
      cards.push({
        qty: parseInt(cardMatch[1], 10),
        name: cardMatch[2],
        number: cardMatch[4],
        setCode: cardMatch[3],
        section: currentSection,
      });
      continue;
    }

    const simpleMatch = line.match(/^(\d+)\s+(.+)$/);
    if (simpleMatch && currentSection) {
      cards.push({
        qty: parseInt(simpleMatch[1], 10),
        name: simpleMatch[2].trim(),
        number: "",
        setCode: "",
        section: currentSection,
      });
    }
  }

  return cards;
}

/* ─── Printing resolution ────────────────────────────────────── */

/**
 * Pick the right printing for a card given the optional set code and
 * collector number from the deck list. Falls back to number-only match,
 * then to the first printing, mirroring how decklists are typed:
 *   "4 Charizard ex POR 247" → match by ptcgo_code + number
 *   "4 Charizard ex"         → first printing (best-effort)
 *
 * When a set code IS present but matches no printing of this card, we fall
 * straight back to the first printing rather than a cross-set number-only
 * match — a number match across sets can land on an older, rotating printing
 * and produce a false "not legal" for a card that's actually fine.
 */
/**
 * Pull every DB entry that could match `name`. For most cards that's just
 * the single name key; for basic energies it also walks the aliased keys
 * (see basicEnergyAlias) so legacy / gold prints like SUM, GRI, swsh7
 * resolve instead of falling back to SVE.
 */
function lookupEntries(name: string): CardDataEntry[] {
  const direct = CARD_DB_LOWER.get(name.toLowerCase()) ?? [];
  const aliasKeys = basicEnergyAliasKeys(name);
  if (!aliasKeys) return direct;

  const seen = new Set<string>();
  const merged: CardDataEntry[] = [];
  const push = (e: CardDataEntry) => {
    const k = `${e.set_id}:${e.number}`;
    if (!seen.has(k)) {
      seen.add(k);
      merged.push(e);
    }
  };
  for (const e of direct) push(e);
  for (const key of aliasKeys) {
    const pool = CARD_DB_LOWER.get(key);
    if (pool) for (const e of pool) push(e);
  }
  return merged;
}

export function pickPrinting(
  name: string,
  number = "",
  setCode = ""
): CardDataEntry | null {
  const entries = lookupEntries(name);
  if (!entries.length) return null;
  if (setCode) {
    const codeUpper = setCode.toUpperCase();
    const bySetAndNum = entries.find(
      (e) =>
        e.ptcgo_code?.toUpperCase() === codeUpper &&
        (!number || e.number === number)
    );
    if (bySetAndNum) return bySetAndNum;
    const bySet = entries.find(
      (e) => e.ptcgo_code?.toUpperCase() === codeUpper
    );
    if (bySet) return bySet;
    // Set code given but unknown for this card — prefer the first printing
    // over a cross-set number match (avoids false rotation flags).
    return entries[0];
  }
  if (number) {
    const byNum = entries.find((e) => e.number === number);
    if (byNum) return byNum;
  }
  return entries[0];
}

export function pickPrintingForCard(c: Card): CardDataEntry | null {
  return pickPrinting(c.name, c.number, c.setCode);
}
