// Deck composition, legality and playability — the gates every generated
// deck passes before it is allowed to cost us simulation time.
//
// Legality and playability are deliberately SEPARATE. Legality is the rule
// book: a 61-card list is not a deck, and no amount of tuning makes it one.
// Playability is judgement: a legal list with two Basics and no draw
// Supporter is a deck the way a car with no wheels is a car. Keeping them
// apart means the meta study can ask "did the playability heuristics
// actually predict anything?" — if they turn out to be wrong, only the
// second gate moves, and the first is never in question.
//
// Nothing here is user-facing. This is training-corpus infrastructure.

import { parseDeckListCards } from "@/lib/cardPrinting";
import { lookupCard } from "@/lib/engine/catalog";
import { canonicalCardName } from "@/lib/engine/sim/setup";
import type { EngineCard } from "@/lib/engine/types";

/** One deck-list line, with the printing token kept so the rendered list
 *  still resolves to the same physical card the corpus used. */
export interface DeckEntry {
  qty: number;
  name: string;
  /** "SVI 181", or null for lines that never carried one. */
  printing: string | null;
}

export type CardRole =
  | "basic_pokemon"
  | "evolution"
  | "supporter"
  | "item"
  | "tool"
  | "stadium"
  | "basic_energy"
  | "special_energy"
  | "unknown";

export function roleOf(catalog: EngineCard | null | undefined): CardRole {
  if (!catalog) return "unknown";
  const subs = catalog.subtypes ?? [];
  if (catalog.supertype === "Pokémon") {
    return catalog.evolves_from ? "evolution" : "basic_pokemon";
  }
  if (catalog.supertype === "Energy") {
    return subs.includes("Basic") ? "basic_energy" : "special_energy";
  }
  if (subs.includes("Supporter")) return "supporter";
  if (subs.includes("Stadium")) return "stadium";
  if (subs.includes("Pokémon Tool")) return "tool";
  if (subs.includes("Item")) return "item";
  return "unknown";
}

const SECTION_OF: Record<CardRole, "pokemon" | "trainer" | "energy"> = {
  basic_pokemon: "pokemon",
  evolution: "pokemon",
  supporter: "trainer",
  item: "trainer",
  tool: "trainer",
  stadium: "trainer",
  basic_energy: "energy",
  special_energy: "energy",
  unknown: "trainer",
};

export function isAceSpec(catalog: EngineCard | null | undefined): boolean {
  return (catalog?.subtypes ?? []).includes("ACE SPEC");
}

/* ─── Parse / render ────────────────────────────────────────────── */

export function parseDeck(list: string): DeckEntry[] {
  const out: DeckEntry[] = [];
  for (const c of parseDeckListCards(list)) {
    const name = canonicalCardName(c.name);
    const printing =
      c.setCode && c.number ? `${c.setCode} ${c.number}` : null;
    // Merge duplicate lines of the same (name, printing) — hand-edited and
    // mutated lists both produce them, and a deck is a multiset of cards,
    // not of lines.
    const same = out.find((e) => e.name === name && e.printing === printing);
    if (same) same.qty += c.qty;
    else out.push({ qty: c.qty, name, printing });
  }
  return out;
}

/** Back to the sectioned text `parseDeckListCards` expects. */
export function renderDeck(entries: DeckEntry[]): string {
  const sections: Record<string, DeckEntry[]> = { pokemon: [], trainer: [], energy: [] };
  for (const e of entries) {
    if (e.qty <= 0) continue;
    sections[SECTION_OF[roleOf(lookupCard(e.name))]].push(e);
  }
  const titles: Record<string, string> = {
    pokemon: "Pokémon",
    trainer: "Trainer",
    energy: "Energy",
  };
  const lines: string[] = [];
  for (const key of ["pokemon", "trainer", "energy"]) {
    const cards = sections[key];
    if (cards.length === 0) continue;
    lines.push(`${titles[key]}: ${cards.reduce((s, c) => s + c.qty, 0)}`);
    for (const c of cards) {
      lines.push(`${c.qty} ${c.name}${c.printing ? ` ${c.printing}` : ""}`);
    }
  }
  return lines.join("\n");
}

export const deckSize = (entries: DeckEntry[]): number =>
  entries.reduce((n, e) => n + Math.max(0, e.qty), 0);

/* ─── Composition ───────────────────────────────────────────────── */

export interface DeckStats {
  size: number;
  /** Card counts by role — the meta study's independent variables. */
  roles: Record<CardRole, number>;
  basics: number;
  energy: number;
  /** Trainers that draw or search (the consistency engine). */
  drawSupporters: number;
  /** Distinct Pokémon lines that can attack for damage. */
  attackers: number;
  aceSpecs: number;
  /** Evolutions with no pre-evolution in the deck. NOT an error — see
   *  orphanEvolutions. Recorded so the meta study can test whether it
   *  predicts anything. */
  orphans: number;
  distinctNames: number;
}

/** Does this card's text move cards from deck or draw them? A crude but
 *  stable read of "consistency engine", taken from the printed rules rather
 *  than a hand-maintained card list, so new sets are covered on arrival. */
function isDrawOrSearch(catalog: EngineCard | null | undefined): boolean {
  const text = (catalog?.rules ?? []).join(" ");
  return /\bdraw\b|\bsearch your deck\b/i.test(text);
}

function hasDamagingAttack(catalog: EngineCard | null | undefined): boolean {
  return (catalog?.attacks ?? []).some((a: EngineCard["attacks"][number]) => {
    const n = parseInt(a.damage, 10);
    // An attack with no printed number can still be the payoff (Night Joker
    // copies, formula damage), so text mentioning damage counts too.
    return (Number.isFinite(n) && n > 0) || /damage/i.test(a.text ?? "");
  });
}

export function deckStats(entries: DeckEntry[]): DeckStats {
  const roles = {
    basic_pokemon: 0, evolution: 0, supporter: 0, item: 0, tool: 0,
    stadium: 0, basic_energy: 0, special_energy: 0, unknown: 0,
  } as Record<CardRole, number>;
  let drawSupporters = 0;
  let attackers = 0;
  let aceSpecs = 0;
  for (const e of entries) {
    if (e.qty <= 0) continue;
    const cat = lookupCard(e.name);
    const role = roleOf(cat);
    roles[role] += e.qty;
    if ((role === "supporter" || role === "item") && isDrawOrSearch(cat)) drawSupporters += e.qty;
    if (cat?.supertype === "Pokémon" && hasDamagingAttack(cat)) attackers += 1;
    if (isAceSpec(cat)) aceSpecs += e.qty;
  }
  return {
    size: deckSize(entries),
    roles,
    basics: roles.basic_pokemon,
    energy: roles.basic_energy + roles.special_energy,
    drawSupporters,
    attackers,
    aceSpecs,
    orphans: orphanEvolutions(entries).length,
    distinctNames: new Set(entries.filter((e) => e.qty > 0).map((e) => e.name)).size,
  };
}

/* ─── Gate 1: legality (the rule book) ──────────────────────────── */

export function legalityIssues(entries: DeckEntry[]): string[] {
  const issues: string[] = [];
  const size = deckSize(entries);
  if (size !== 60) issues.push(`deck has ${size} cards, not 60`);

  const byName = new Map<string, number>();
  for (const e of entries) {
    if (e.qty <= 0) continue;
    byName.set(e.name, (byName.get(e.name) ?? 0) + e.qty);
  }
  let aceSpecs = 0;
  let basics = 0;
  for (const [name, qty] of Array.from(byName)) {
    const cat = lookupCard(name);
    if (!cat) {
      // Not in the standard catalog: unplayable AND unsimulatable. Rejecting
      // here is what keeps a generator from quietly filling slots with cards
      // the engine renders as blanks.
      issues.push(`unknown card "${name}"`);
      continue;
    }
    if (roleOf(cat) !== "basic_energy" && qty > 4) {
      issues.push(`${qty} copies of ${name} (max 4)`);
    }
    if (isAceSpec(cat)) aceSpecs += qty;
    if (roleOf(cat) === "basic_pokemon") basics += qty;
  }
  if (aceSpecs > 1) issues.push(`${aceSpecs} ACE SPEC cards (max 1 per deck)`);
  if (basics === 0) issues.push("no Basic Pokémon");
  return issues;
}

/* ─── Gate 2: playability (judgement, tunable) ──────────────────── */

/** Thresholds are deliberately LOOSE. The point is to reject decks that
 *  cannot function at all — not to encode a metagame opinion, which would
 *  make the generated corpus a mirror of our own priors and teach the pilot
 *  nothing it does not already believe. Every bound here is a hypothesis the
 *  meta study can test against real outcomes. */
export const PLAYABILITY = {
  minBasics: 5,
  minEnergy: 4,
  minDrawOrSearch: 4,
  minAttackerLines: 1,
} as const;

// Deliberately NOT in the gate: orphan evolutions (see orphanEvolutions),
// energy-type coherence, and any "curve" opinion. Each would encode a belief
// about deck quality that this corpus exists to TEST.

export function playabilityIssues(entries: DeckEntry[]): string[] {
  const s = deckStats(entries);
  const issues: string[] = [];
  if (s.basics < PLAYABILITY.minBasics) {
    issues.push(`${s.basics} Basic Pokémon (<${PLAYABILITY.minBasics}: mulligans away its own game)`);
  }
  if (s.energy < PLAYABILITY.minEnergy) {
    issues.push(`${s.energy} Energy (<${PLAYABILITY.minEnergy}: nothing ever attacks)`);
  }
  if (s.drawSupporters < PLAYABILITY.minDrawOrSearch) {
    issues.push(`${s.drawSupporters} draw/search cards (<${PLAYABILITY.minDrawOrSearch}: bricks)`);
  }
  if (s.attackers < PLAYABILITY.minAttackerLines) issues.push("no Pokémon that can deal damage");
  return issues;
}

/** Evolutions with nothing to evolve FROM — a DESCRIPTION, not a defect.
 *
 *  This was a hard playability gate until it rejected an entire real
 *  archetype. Slowking's Seek Inspiration discards the top card of the deck
 *  and uses a no-rule-box Pokémon's attack as its own, so the list runs a
 *  lone Metagross (150+) it never intends to evolve into — the orphan IS the
 *  payoff. 26 of 340 recorded meta variants "fail" this check, and they are
 *  decks people won with.
 *
 *  The lesson generalizes: a gate encoding what we believe a good deck looks
 *  like would filter the generated corpus down to decks we already agree
 *  with, and teach the pilot nothing. Legality is the rule book; everything
 *  else is a hypothesis, and hypotheses belong in DeckStats where the meta
 *  study can test them against outcomes. */
export function orphanEvolutions(entries: DeckEntry[]): string[] {
  const present = new Set(entries.filter((e) => e.qty > 0).map((e) => e.name));
  const hasRareCandy = present.has("Rare Candy");
  const issues: string[] = [];
  for (const e of entries) {
    if (e.qty <= 0) continue;
    const cat = lookupCard(e.name);
    if (!cat?.evolves_from) continue;
    const from = canonicalCardName(cat.evolves_from);
    if (present.has(from)) continue;
    const isStage2 = (cat.subtypes ?? []).includes("Stage 2");
    // A Stage 2 whose Stage 1 is missing is still playable off Rare Candy,
    // provided the BASIC at the bottom of the line is in the deck.
    if (isStage2 && hasRareCandy) {
      const mid = lookupCard(from);
      const basal = mid?.evolves_from ? canonicalCardName(mid.evolves_from) : null;
      if (basal && present.has(basal)) continue;
    }
    issues.push(`${e.name} has no ${from} to evolve from`);
  }
  return issues;
}

/** Both gates. Empty = this deck is worth simulating. */
export function deckIssues(entries: DeckEntry[]): { legality: string[]; playability: string[] } {
  return { legality: legalityIssues(entries), playability: playabilityIssues(entries) };
}
