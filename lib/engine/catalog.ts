// Card catalog adapter.
//
// The engine speaks in EngineCard records — a small slice of cards-standard.json
// trimmed to the fields the reducer actually inspects (HP, attack costs,
// weaknesses, evolves_from). The full JSON is the source of truth; this
// module just normalizes it once per name.
//
// Resolution model:
//   * Catalog is name-keyed. Multiple printings collapse to a single
//     canonical EngineCard. For modern Standard, attack costs and HP are
//     identical across printings of a given name, so picking the most
//     recent printing is fine.
//   * Catalog misses don't throw — they return null. The reducer surfaces
//     a "catalog_miss" diagnostic and continues with name-only tracking.

import cardsRaw from "@/data/cards-standard.json";
import { isStandardMark } from "@/lib/cardPrinting";
import type { EngineAbility, EngineAttack, EngineCard } from "./types";

interface PrintingRaw {
  name: string;
  set_id: string;
  set_name?: string;
  number: string;
  supertype: string;
  subtypes?: string[];
  types?: string[];
  hp?: string | number | null;
  retreat_cost?: number | null;
  evolves_from?: string | null;
  weaknesses?: { type: string; value: string }[] | null;
  resistances?: { type: string; value: string }[] | null;
  attacks?: EngineAttack[] | null;
  abilities?: EngineAbility[] | null;
  rules?: string[] | null;
  // Regulation mark drives our "newest printing" tiebreak. G/H/I represent
  // current Standard; later marks sort first.
  regulation_mark?: string | null;
  // Baked by scripts/bake-standard-variants.mjs. True when 2+ Standard-
  // legal printings of this name differ mechanically.
  hasStandardVariant?: boolean | null;
}

const RAW = cardsRaw as Record<string, PrintingRaw[]>;

const CACHE = new Map<string, EngineCard | null>();

function regulationRank(mark: string | null | undefined): number {
  if (!mark) return 0;
  // A=1, B=2, ..., Z=26 — keep it simple, later marks sort higher.
  const ch = mark.toUpperCase().charCodeAt(0);
  if (ch >= 65 && ch <= 90) return ch - 64;
  return 0;
}

function pickPrinting(prints: PrintingRaw[]): PrintingRaw {
  // Prefer highest regulation_mark; fall back to last (most-recently appended).
  let best = prints[0];
  let bestRank = regulationRank(best.regulation_mark);
  for (let i = 1; i < prints.length; i++) {
    const r = regulationRank(prints[i].regulation_mark);
    if (r > bestRank) {
      best = prints[i];
      bestRank = r;
    }
  }
  return best;
}

/** Two spellings of "this attack costs no Energy" exist in the card data:
 *  an empty cost array, and the single token "Free". The engine's cost
 *  solver reads every token as a typed Energy requirement, so "Free" asked
 *  for an Energy type nothing provides and the attack could NEVER be used.
 *
 *  It affects two standard-legal cards — Budew's Itchy Pollen (the Item
 *  lock) and Tyrogue's Pow-Pow Punching — both of which exist precisely to
 *  attack for nothing on turn one. Normalizing here rather than in the cost
 *  solver fixes it once for every consumer: legality, the planner's damage
 *  estimates, retreat math and the UI's cost pips all read this shape. */
function normalizeAttackCost(attack: EngineAttack): EngineAttack {
  const cost = attack.cost ?? [];
  if (!cost.some((c) => c === "Free")) return attack;
  return { ...attack, cost: cost.filter((c) => c !== "Free") };
}

function normalize(printing: PrintingRaw): EngineCard {
  const hpNum =
    typeof printing.hp === "number"
      ? printing.hp
      : printing.hp != null
        ? Number(printing.hp) || null
        : null;
  return {
    name: printing.name,
    set_id: printing.set_id,
    number: printing.number,
    supertype: printing.supertype,
    subtypes: printing.subtypes ?? [],
    types: printing.types ?? [],
    hp: hpNum,
    retreat_cost: printing.retreat_cost ?? 0,
    evolves_from: printing.evolves_from ?? null,
    weaknesses: printing.weaknesses ?? [],
    resistances: printing.resistances ?? [],
    attacks: (printing.attacks ?? []).map(normalizeAttackCost),
    abilities: printing.abilities ?? [],
    rules: printing.rules ?? [],
    hasStandardVariant: Boolean(printing.hasStandardVariant),
  };
}

/** Resolve a card name to a canonical EngineCard. Returns null when the
 *  name doesn't appear in cards-standard.json (e.g. typo, retired card). */
export function lookupCard(name: string): EngineCard | null {
  if (CACHE.has(name)) return CACHE.get(name) ?? null;
  const prints = RAW[name];
  if (!prints || prints.length === 0) {
    CACHE.set(name, null);
    return null;
  }
  const card = normalize(pickPrinting(prints));
  CACHE.set(name, card);
  return card;
}

/** Resolve a card to the EXACT printing named by a TCG Live id from the
 *  verbose battle-log export (e.g. "me2-5_155" or "me2-5_154_ph2"). The
 *  verbose export's set codes differ from the catalog's only in how "point"
 *  sets are spelled — TCG Live "me2-5" ↔ catalog "me2pt5" — and the number
 *  may carry a variant suffix ("_ph2") that we drop. Returns null when no
 *  printing matches, so callers fall back to the name-only lookup. */
export function lookupPrintingByLiveId(
  name: string,
  liveId: string,
): EngineCard | null {
  const prints = RAW[name];
  if (!prints || prints.length === 0) return null;
  const underscore = liveId.indexOf("_");
  if (underscore < 0) return null;
  const setCode = liveId
    .slice(0, underscore)
    .replace(/-(\d+)/g, "pt$1")
    .toLowerCase();
  const number = liveId.slice(underscore + 1).split("_")[0].toLowerCase();
  const hit = prints.find(
    (p) => p.set_id.toLowerCase() === setCode && p.number.toLowerCase() === number,
  );
  return hit ? normalize(hit) : null;
}

/** Returns the supertype of a card by name. Convenience for handlers that
 *  need to branch on Pokémon vs Trainer vs Energy without holding the row. */
export function supertypeOf(name: string): EngineCard["supertype"] | null {
  return lookupCard(name)?.supertype ?? null;
}

/** True if the named card is a Basic Pokémon (no `evolves_from`). Used by
 *  setup handlers to validate "play_to_active" / "play_to_bench" targets. */
export function isBasicPokemon(name: string): boolean {
  const c = lookupCard(name);
  if (!c) return false;
  if (c.supertype !== "Pokémon") return false;
  return !c.evolves_from && (c.subtypes.includes("Basic") || c.subtypes.length === 0);
}

/** True if the named card is an Energy (Basic or Special). */
export function isEnergy(name: string): boolean {
  return supertypeOf(name) === "Energy";
}

/** Quick check used by the match-import disambiguation pass: does this
 *  Pokémon name resolve to multiple Standard-legal printings that differ
 *  mechanically? When true, the importer needs the user (or their deck
 *  list) to pick a specific printing. Always false for Trainer / Energy
 *  names. */
export function hasStandardVariant(name: string): boolean {
  return Boolean(lookupCard(name)?.hasStandardVariant);
}

/** All Standard-legal printings of a name, raw — the importer feeds these
 *  into the disambiguation form so the user can pick one. Returns []
 *  for names not in the catalog. */
export function standardPrintingsOf(name: string): PrintingRaw[] {
  const prints = RAW[name];
  if (!prints) return [];
  return prints.filter(
    (p) => p.supertype === "Pokémon" && isStandardMark(p.regulation_mark),
  );
}

/** True if the named card is a Trainer of the given subtype. */
export function isTrainerSubtype(name: string, subtype: string): boolean {
  const c = lookupCard(name);
  if (!c || c.supertype !== "Trainer") return false;
  return c.subtypes.includes(subtype);
}

/* ─── Printing disambiguation from gameplay ───────────────────── */
//
// `pickPrinting` above resolves a bare name by "newest regulation mark
// wins". That is the only thing available when the log is the STANDARD
// TCG Live export, which names cards by name alone — but for a Pokémon
// with several Standard-legal printings it is a coin flip, and it loses:
// Bronzong's newest print (me5-64, "Gentle Slap") is not the one anybody
// is playing (sv5-69, "Evolution Jammer"), so the board rendered the wrong
// art and listed attacks the card in play does not have.
//
// The log does tell us which card it was, just not by id: it names every
// attack and ability as it is used, and those names are close to unique
// across a species' printings. Scoring printings against the moves the log
// actually saw recovers the exact card from the standard export — no
// verbose-export setting required on the player's end.

/** Case/whitespace-insensitive key for a move name, so "Evolution Jammer"
 *  from the log matches the catalog's spelling regardless of casing. */
function moveKey(move: string): string {
  return move.trim().toLowerCase();
}

function attackKeys(p: PrintingRaw): Set<string> {
  return new Set((p.attacks ?? []).map((a) => moveKey(a.name)));
}

function abilityKeys(p: PrintingRaw): Set<string> {
  return new Set((p.abilities ?? []).map((a) => moveKey(a.name)));
}

/**
 * True when `move` is an ATTACK on this Pokémon and never an Ability, across
 * every printing of the name.
 *
 * The battle log writes a targetless attack and an ability with the exact
 * same shape — "<handle>'s <Pokémon> used <move>." — so the parser cannot
 * tell them apart from the text alone. The catalog can. Requiring that NO
 * printing calls the move an Ability keeps the answer conservative: a name
 * that is an attack on one print and an ability on another stays
 * unclassified and the parser leaves it as an ability, exactly as before.
 */
export function isAttackName(pokemon: string, move: string): boolean {
  const prints = RAW[pokemon];
  if (!prints || prints.length === 0) return false;
  const key = moveKey(move);
  let seenAsAttack = false;
  for (const p of prints) {
    if (abilityKeys(p).has(key)) return false;
    if (attackKeys(p).has(key)) seenAsAttack = true;
  }
  return seenAsAttack;
}

/**
 * Resolve the exact printing of `name` whose attacks + abilities account for
 * every move the log saw it use.
 *
 * Full cover is required rather than best-effort overlap: a partial match
 * means we are looking at the wrong card, and a wrong card confidently
 * rendered is worse than the name-only fallback the caller already has.
 * Among printings that do cover everything (same card, reprinted), the
 * existing newest-regulation-mark preference breaks the tie.
 *
 * Returns null when there is no signal (no moves seen) or no printing
 * covers them, so callers fall back to `lookupCard`.
 */
export function lookupPrintingByMoves(
  name: string,
  moves: readonly string[],
): EngineCard | null {
  const prints = RAW[name];
  if (!prints || prints.length === 0) return null;
  const wanted = Array.from(new Set(moves.map(moveKey))).filter(Boolean);
  if (wanted.length === 0) return null;
  const covering = prints.filter((p) => {
    const known = attackKeys(p);
    abilityKeys(p).forEach((k) => known.add(k));
    return wanted.every((w) => known.has(w));
  });
  if (covering.length === 0) return null;
  return normalize(pickPrinting(covering));
}
