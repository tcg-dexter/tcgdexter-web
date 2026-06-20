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
 * resolved later.
 *
 * Tolerant of source-wrapping mangling. When a list is copied from a narrow
 * column (Twitter post, mobile share sheet, chat message), the original
 * newlines often land mid-card or run multiple cards onto a single line.
 * To handle both cases, we buffer everything within a section and globally
 * extract `<qty> <name> <SETCODE> <number>` tokens — so a paste like
 *   "1 Chien-Pao\nPR-SV 152 2 Lillie's Clefairy ex JTG 173"
 * still resolves to two distinct cards. Any trailing fragment that doesn't
 * include a set code falls back to the simple "<qty> <name>" form.
 */
export function parseDeckListCards(raw: string): Card[] {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const cards: Card[] = [];
  let currentSection: Card["section"] | null = null;
  let buffer = "";

  const flush = () => {
    if (!currentSection || !buffer.trim()) return;
    const text = buffer.trim();
    // Pass 1: globally match each <qty> <name> <SETCODE> <number> token.
    // Name is non-greedy so it stops at the first uppercase-led set code
    // followed by digits; the lookahead ends each match at the next card
    // boundary (whitespace + qty + whitespace + non-digit) or end-of-buffer,
    // so we don't accidentally fold a downstream card's qty into the
    // previous card's number.
    const setCodeRe = /(\d+)\s+(.+?)\s+([A-Z][A-Z0-9-]+)\s+(\d+)(?=\s+\d+\s+\S|\s*$)/g;
    let m: RegExpExecArray | null;
    let lastEnd = 0;
    while ((m = setCodeRe.exec(text)) !== null) {
      cards.push({
        qty: parseInt(m[1], 10),
        name: m[2].trim(),
        number: m[4],
        setCode: m[3],
        section: currentSection,
      });
      lastEnd = m.index + m[0].length;
    }
    // Pass 2: any tail the set-code regex didn't consume (or the whole
    // buffer if pass 1 found nothing) gets re-scanned for set-code-less
    // <qty> <name> tokens — same boundary lookahead so multiple name-only
    // cards on the same line still split correctly.
    const leftover = text.slice(lastEnd).trim();
    if (leftover) {
      const nameOnlyRe = /(\d+)\s+(.+?)(?=\s+\d+\s+\S|\s*$)/g;
      let n: RegExpExecArray | null;
      while ((n = nameOnlyRe.exec(leftover)) !== null) {
        cards.push({
          qty: parseInt(n[1], 10),
          name: n[2].trim(),
          number: "",
          setCode: "",
          section: currentSection,
        });
      }
    }
    buffer = "";
  };

  for (const line of lines) {
    const headerMatch = line.match(/^(Pok[eé]mon|Trainer|Energy)\s*:/i);
    if (headerMatch) {
      flush();
      const h = headerMatch[1].toLowerCase();
      if (h.startsWith("pok")) currentSection = "pokemon";
      else if (h === "trainer") currentSection = "trainer";
      else currentSection = "energy";
      continue;
    }

    if (/^total\s+cards?\s*:/i.test(line)) {
      flush();
      continue;
    }

    buffer += " " + line;
  }
  flush();

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
