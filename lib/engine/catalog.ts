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
    attacks: printing.attacks ?? [],
    abilities: printing.abilities ?? [],
    rules: printing.rules ?? [],
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

/** True if the named card is a Trainer of the given subtype. */
export function isTrainerSubtype(name: string, subtype: string): boolean {
  const c = lookupCard(name);
  if (!c || c.supertype !== "Trainer") return false;
  return c.subtypes.includes(subtype);
}
