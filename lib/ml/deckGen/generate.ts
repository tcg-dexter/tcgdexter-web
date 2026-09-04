// Deck generators — the training funnel's supply side.
//
// Why generate at all: W5 measured that seven rounds of piloting work moved
// calibration not at all, and named the one open path as PER-ARCHETYPE
// planning competence. A pilot that has only ever seen 30 deck shapes has no
// reason to generalize to the 31st. Widening the deck distribution is the
// cheapest way to make the policy learn "how to play a deck like this"
// rather than "how to play THIS deck".
//
// Two generators, deliberately conservative:
//
//   mutate    — take a real list and change a few cards, role-preserving.
//               Stays near the manifold of decks that function, so most
//               outputs are playable and the DELTA from the parent is the
//               interesting variable for the meta study.
//   skeleton  — rebuild an archetype from its core (cards in nearly every
//               recorded variant) plus flex slots sampled from the corpus.
//               Wanders further; the core keeps it coherent.
//
// Both are seeded: (seed, params) reproduces the same decks byte-for-byte,
// which is what lets a generated corpus be an idempotent input to training
// the way the meta list already is.
//
// Every output carries its PROVENANCE — parent, generator, the exact edits.
// That is not bookkeeping: it is the meta study's independent variable. A
// win rate with no record of what changed teaches nothing.

import { createHash } from "node:crypto";
import { mulberry32, type Rng } from "@/lib/engine/sim";
import { lookupCard } from "@/lib/engine/catalog";
import { canonicalCardName } from "@/lib/engine/sim/setup";
import {
  deckIssues,
  deckSize,
  deckStats,
  renderDeck,
  roleOf,
  isAceSpec,
  type CardRole,
  type DeckEntry,
  type DeckStats,
} from "./rules";
import { archetypeProfile, type Corpus, type CorpusDeck } from "./corpus";

export const DECK_GEN_VERSION = 1;

export interface GeneratedDeck {
  /** Content-addressed: the same list always has the same id, so two
   *  generators that stumble onto one deck do not double-count it. */
  id: string;
  list: string;
  generator: "mutate" | "skeleton";
  parentId: string | null;
  archetype: string | null;
  /** Human-readable edit log: "-1 Iono", "+1 Arven". */
  ops: string[];
  seed: number;
  stats: DeckStats;
}

const deckId = (list: string): string =>
  `gen:${createHash("sha256").update(list).digest("hex").slice(0, 16)}`;

/* ─── Weighted sampling ─────────────────────────────────────────── */

function weightedPick<T>(items: T[], weight: (t: T) => number, rng: Rng): T | null {
  const total = items.reduce((s, it) => s + Math.max(0, weight(it)), 0);
  if (total <= 0) return null;
  let r = rng() * total;
  for (const it of items) {
    r -= Math.max(0, weight(it));
    if (r <= 0) return it;
  }
  return items[items.length - 1] ?? null;
}

const clone = (entries: DeckEntry[]): DeckEntry[] => entries.map((e) => ({ ...e }));

function add(entries: DeckEntry[], name: string, printing: string | null, qty = 1): void {
  const found = entries.find((e) => e.name === name);
  if (found) found.qty += qty;
  else entries.push({ name, printing, qty });
}

function remove(entries: DeckEntry[], name: string, qty = 1): boolean {
  const found = entries.find((e) => e.name === name && e.qty > 0);
  if (!found) return false;
  found.qty -= Math.min(qty, found.qty);
  return true;
}

/* ─── Mutation ──────────────────────────────────────────────────── */

/** Cards this deck could add in place of `role`, weighted by how much of the
 *  real field plays them. Excludes anything that would break the copy limit
 *  or bring a second ACE SPEC. */
function candidatesFor(
  corpus: Corpus,
  entries: DeckEntry[],
  role: CardRole,
): { name: string; printing: string | null; weight: number }[] {
  const held = new Map(entries.map((e) => [e.name, e.qty]));
  const hasAce = entries.some((e) => e.qty > 0 && isAceSpec(lookupCard(e.name)));
  const out: { name: string; printing: string | null; weight: number }[] = [];
  for (const name of corpus.byRole.get(role) ?? []) {
    const facts = corpus.cards.get(name)!;
    const cat = lookupCard(name);
    if (!cat) continue;
    if (isAceSpec(cat) && hasAce) continue;
    if (role !== "basic_energy" && (held.get(name) ?? 0) >= 4) continue;
    out.push({ name, printing: facts.printing, weight: facts.frequency });
  }
  return out;
}

/** One deck, a few edits away from its parent.
 *
 *  Role-preserving by construction: a Supporter is replaced by a Supporter,
 *  an Energy by an Energy. Cross-role edits (cutting Energy for Items) are
 *  where decks stop functioning, and a corpus of broken decks would teach
 *  the pilot only that broken decks lose. */
export function mutateDeck(
  parent: CorpusDeck,
  corpus: Corpus,
  seed: number,
  edits = 3,
): FinalizeResult {
  const rng = mulberry32(seed >>> 0);
  const entries = clone(parent.entries);
  const ops: string[] = [];

  // Two things a mutation must never do to its parent, because the result
  // is not a VARIANT of that deck — it is a broken deck, and it pollutes the
  // parent-delta signal the meta study is built on:
  //
  //   1. cut the last copy of the deck's own attacker (removes the win
  //      condition), and
  //   2. cut the last copy of something an evolution in the deck needs.
  //
  // (2) was found by measurement, not foresight: without it, 49 of every 279
  // attempts died on the orphan-evolution gate — a fifth of the compute, and
  // a silent bias toward decks with no evolution lines at all.
  const attackerNames = new Set(
    entries
      .filter((e) => {
        const cat = lookupCard(e.name);
        return cat?.supertype === "Pokémon" && (cat.attacks ?? []).length > 0;
      })
      .map((e) => e.name),
  );
  const evolvedFrom = new Set(
    entries
      .map((e) => lookupCard(e.name)?.evolves_from)
      .filter((n): n is string => typeof n === "string")
      .map((n) => canonicalCardName(n)),
  );

  for (let i = 0; i < edits; i++) {
    const cuttable = entries.filter((e) => {
      if (e.qty <= 0) return false;
      const role = roleOf(lookupCard(e.name));
      if (role === "unknown") return false;
      // Keep at least one copy of an attacker line, and of anything the
      // deck's evolutions need underneath them.
      if (e.qty <= 1 && (attackerNames.has(e.name) || evolvedFrom.has(e.name))) return false;
      return true;
    });
    if (cuttable.length === 0) break;
    // Cut from the thickest lines first — a 4-of has a spare copy, a 1-of is
    // usually a deliberate tech and cutting it is a bigger claim.
    const victim = weightedPick(cuttable, (e) => e.qty, rng);
    if (!victim) break;
    const role = roleOf(lookupCard(victim.name));
    const options = candidatesFor(corpus, entries, role).filter((c) => c.name !== victim.name);
    if (options.length === 0) continue;
    const replacement = weightedPick(options, (c) => c.weight, rng);
    if (!replacement) continue;
    remove(entries, victim.name, 1);
    add(entries, replacement.name, replacement.printing, 1);
    ops.push(`-1 ${victim.name}`, `+1 ${replacement.name}`);
  }

  if (ops.length === 0) return { ok: false, issues: ["no edit was possible"] };
  return finalize(entries, {
    generator: "mutate",
    parentId: parent.id,
    archetype: parent.archetype,
    ops,
    seed,
  });
}

/* ─── Skeleton fill ─────────────────────────────────────────────── */

/** An archetype rebuilt from its core plus corpus-sampled flex slots.
 *
 *  `coreThreshold` is the line between "this card IS the deck" and "this
 *  card is a choice". At 0.8, a card in 4 of 5 recorded variants is core. */
export function skeletonDeck(
  corpus: Corpus,
  archetype: string,
  seed: number,
  coreThreshold = 0.8,
): FinalizeResult {
  const profile = archetypeProfile(corpus, archetype);
  if (profile.length === 0) return { ok: false, issues: ["archetype has no recorded variants"] };
  const rng = mulberry32(seed >>> 0);
  const entries: DeckEntry[] = [];
  const ops: string[] = [];

  for (const card of profile) {
    if (card.frequency < coreThreshold) continue;
    if (deckSize(entries) + card.modalQty > 60) continue;
    add(entries, card.name, card.printing, card.modalQty);
  }
  ops.push(`core: ${entries.length} cards at >=${coreThreshold} frequency`);
  // An evolution line is atomic. The frequency threshold cuts across it —
  // Dusknoir can clear 0.8 while Duskull sits at 0.7 — and a Stage 1 with
  // nothing under it is not a deck. Pull the rest of the line in regardless
  // of its own frequency.
  ops.push(...completeLines(entries, profile));

  // Flex slots, drawn from what this archetype's own variants play — the
  // corpus deciding what belongs here, rather than us.
  const flex = profile.filter((c) => c.frequency < coreThreshold);
  let guard = 0;
  while (deckSize(entries) < 60 && guard++ < 200) {
    const room = 60 - deckSize(entries);
    const options = flex.filter((c) => {
      const held = entries.find((e) => e.name === c.name)?.qty ?? 0;
      const cat = lookupCard(c.name);
      if (!cat) return false;
      if (isAceSpec(cat) && entries.some((e) => e.qty > 0 && isAceSpec(lookupCard(e.name)))) return false;
      return roleOf(cat) === "basic_energy" ? true : held < 4;
    });
    const pick = options.length > 0 ? weightedPick(options, (c) => c.frequency, rng) : null;
    if (!pick) break;
    const qty = Math.min(pick.modalQty, room);
    add(entries, pick.name, pick.printing, qty);
    ops.push(`flex: +${qty} ${pick.name}`);
  }

  // Pad any remainder with the archetype's own Basic Energy, the one card a
  // deck can always hold more of.
  const filler = profile.find((c) => roleOf(lookupCard(c.name)) === "basic_energy");
  if (deckSize(entries) < 60 && filler) {
    const need = 60 - deckSize(entries);
    add(entries, filler.name, filler.printing, need);
    ops.push(`pad: +${need} ${filler.name}`);
  }

  return finalize(entries, {
    generator: "skeleton",
    parentId: null,
    archetype,
    ops,
    seed,
  });
}

/** Add whatever the deck's evolutions need underneath them. Returns the ops
 *  it performed, so the provenance records that these cards came from line
 *  completion rather than from the corpus prior. */
function completeLines(
  entries: DeckEntry[],
  profile: { name: string; modalQty: number; printing: string | null }[],
): string[] {
  const ops: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    // Two passes: adding a Stage 1 can itself demand a Basic.
    for (const e of [...entries]) {
      if (e.qty <= 0) continue;
      const from = lookupCard(e.name)?.evolves_from;
      if (!from) continue;
      const name = canonicalCardName(from);
      if (entries.some((x) => x.name === name && x.qty > 0)) continue;
      const known = profile.find((p) => p.name === name);
      const qty = Math.min(known?.modalQty ?? e.qty, 4);
      if (deckSize(entries) + qty > 60) continue;
      add(entries, name, known?.printing ?? null, qty);
      ops.push(`line: +${qty} ${name}`);
    }
  }
  return ops;
}

/* ─── Finalize + gate ───────────────────────────────────────────── */

/** A rejected attempt carries WHY. The yield report is a diagnostic: a
 *  generator whose rejects are all "no draw/search" is describing its own
 *  bias, and collapsing that to a single counter would hide it. */
export type FinalizeResult =
  | { ok: true; deck: GeneratedDeck }
  | { ok: false; issues: string[] };

function finalize(
  entries: DeckEntry[],
  meta: Omit<GeneratedDeck, "id" | "list" | "stats">,
): FinalizeResult {
  const live = entries.filter((e) => e.qty > 0);
  const issues = deckIssues(live);
  const all = [...issues.legality, ...issues.playability];
  if (all.length > 0) return { ok: false, issues: all };
  const list = renderDeck(live);
  return { ok: true, deck: { ...meta, id: deckId(list), list, stats: deckStats(live) } };
}

/** Collapse an issue to a countable class ("3 Basic Pokémon (<5: …)" and
 *  "4 Basic Pokémon (<5: …)" are the same finding). */
function issueClass(issue: string): string {
  if (/Basic Pokémon \(</.test(issue)) return "too_few_basics";
  if (/Energy \(</.test(issue)) return "too_few_energy";
  if (/draw\/search/.test(issue)) return "too_few_draw_search";
  if (/no Pokémon that can deal damage/.test(issue)) return "no_attacker";
  if (/evolve from/.test(issue)) return "orphan_evolution";
  if (/max 4/.test(issue)) return "over_copy_limit";
  if (/ACE SPEC/.test(issue)) return "two_ace_specs";
  if (/not 60/.test(issue)) return "wrong_size";
  if (/unknown card/.test(issue)) return "unknown_card";
  return "other";
}

/* ─── Batch ─────────────────────────────────────────────────────── */

export interface GenerateOptions {
  corpus: Corpus;
  count: number;
  seed: number;
  /** Share of output from the skeleton generator (the rest are mutations). */
  skeletonShare?: number;
  /** Edits per mutation. More edits wander further from the parent. */
  edits?: number;
}

export interface GenerateResult {
  decks: GeneratedDeck[];
  /** Attempts that failed a gate, by reason — the yield report. A generator
   *  whose rejects are all "no Basic Pokémon" is telling us something about
   *  itself, and silently dropping them would hide it. */
  rejected: Record<string, number>;
  attempts: number;
}

export function generateDecks(options: GenerateOptions): GenerateResult {
  const { corpus, count, seed } = options;
  const skeletonShare = options.skeletonShare ?? 0.25;
  const edits = options.edits ?? 3;
  const rng = mulberry32(seed >>> 0);
  const archetypes = Array.from(corpus.variantsOf.keys()).sort();
  const parents = corpus.decks.filter((d) => d.archetype !== null);

  const decks: GeneratedDeck[] = [];
  const seen = new Set<string>();
  const rejected: Record<string, number> = {};
  let attempts = 0;
  // Bounded: a corpus with few parents can run out of distinct outputs, and
  // an unbounded loop would spin forever rather than reporting a short yield.
  const maxAttempts = Math.max(count * 20, 100);

  while (decks.length < count && attempts < maxAttempts) {
    attempts += 1;
    const childSeed = (seed + Math.imul(attempts, 0x9e3779b1)) >>> 0;
    const useSkeleton = rng() < skeletonShare && archetypes.length > 0;
    const made: FinalizeResult = useSkeleton
      ? skeletonDeck(corpus, archetypes[Math.floor(rng() * archetypes.length)], childSeed)
      : parents.length > 0
        ? mutateDeck(parents[Math.floor(rng() * parents.length)], corpus, childSeed, edits)
        : { ok: false, issues: ["no parent decks in corpus"] };
    if (!made.ok) {
      const gen = useSkeleton ? "skeleton" : "mutate";
      for (const cls of Array.from(new Set(made.issues.map(issueClass)))) {
        const key = `${gen}:${cls}`;
        rejected[key] = (rejected[key] ?? 0) + 1;
      }
      continue;
    }
    if (seen.has(made.deck.id)) {
      rejected.duplicate = (rejected.duplicate ?? 0) + 1;
      continue;
    }
    seen.add(made.deck.id);
    decks.push(made.deck);
  }
  return { decks, rejected, attempts };
}
