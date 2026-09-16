// The current Standard format, as a queryable object.
//
// WHY THIS EXISTS
//
// `data/cards-standard.json` is not a Standard-legal pool. It spans regulation
// marks D through J plus thousands of printings carrying no mark at all, so
// "is this name in the catalog" answers whether a card EXISTS — never whether
// it is playable. Everything downstream inherited that confusion: the deck
// generator's legality gate passed Iono (mark G, no reprint), 34 of the 337
// recorded meta variants are stale pre-rotation tournament lists, and every
// generated child mutated from one of those parents inherited the illegality.
//
// Legality is a property of a NAME across all its printings, not of the one
// printing `pickPrinting` happens to select — Judge, Boss's Orders and Ultra
// Ball each pair a rotated original with a current reprint. `isCurrentStandard`
// in lib/engine/catalog.ts is the single predicate; this module builds the
// derived structures on top of it that planning needs.
//
// The mark floor itself lives in lib/cardPrinting's ROTATING_MARKS, so a
// rotation is a one-line change in one file.

import cardsRaw from "@/data/cards-standard.json";
import { isCurrentStandard, lookupCard } from "@/lib/engine/catalog";
import type { EngineCard } from "@/lib/engine/types";

interface PrintingRaw {
  name: string;
  supertype: string;
  subtypes?: string[];
  evolves_from?: string | null;
  regulation_mark?: string | null;
}

const RAW = cardsRaw as unknown as Record<string, PrintingRaw[]>;

/** Bump when the legal pool changes shape (a rotation, a new set). Cached
 *  artifacts and corpora record it so a stale pool cannot silently train. */
export const FORMAT_VERSION = 1;

interface FormatIndex {
  names: string[];
  pokemon: string[];
  /** basic/lower-stage name -> the legal cards that evolve FROM it. */
  evolvesInto: Map<string, string[]>;
}

let INDEX: FormatIndex | null = null;

function build(): FormatIndex {
  const names: string[] = [];
  const pokemon: string[] = [];
  const evolvesInto = new Map<string, string[]>();
  for (const name of Object.keys(RAW)) {
    if (!isCurrentStandard(name)) continue;
    names.push(name);
    const card = lookupCard(name);
    if (!card || card.supertype !== "Pokémon") continue;
    pokemon.push(name);
    // Read evolves_from off the printings rather than the canonical card:
    // a name can be reprinted across marks and we want the edge to exist if
    // ANY legal printing carries it.
    const from = new Set<string>();
    for (const p of RAW[name]) if (p.evolves_from) from.add(p.evolves_from);
    for (const base of Array.from(from)) {
      // The base must itself be legal, or the line is unplayable — a Stage 1
      // whose Basic rotated cannot appear on a board no matter what the
      // evolution edge says.
      if (!isCurrentStandard(base)) continue;
      evolvesInto.set(base, [...(evolvesInto.get(base) ?? []), name]);
    }
  }
  names.sort();
  pokemon.sort();
  return { names, pokemon, evolvesInto };
}

function index(): FormatIndex {
  if (!INDEX) INDEX = build();
  return INDEX;
}

/** Every card name legal in the current Standard format. */
export function currentStandardNames(): readonly string[] {
  return index().names;
}

/** Every Pokémon name legal in the current Standard format. */
export function currentStandardPokemon(): readonly string[] {
  return index().pokemon;
}

/** The legal cards that evolve directly from `name`.
 *
 *  This is the edge the threat model walks: an opponent showing N's Zorua is
 *  showing a 70 HP Basic that attacks for 20, AND the possibility of N's
 *  Zoroark ex next turn. Reading only what is on the board scores that board
 *  as harmless, which is precisely the misread a route planner must not make. */
export function evolutionsOf(name: string): readonly string[] {
  return index().evolvesInto.get(name) ?? [];
}

/** True when the card is a legal Pokémon with at least one legal evolution. */
export function canEvolve(name: string): boolean {
  return evolutionsOf(name).length > 0;
}

/** Resolve a name to its EngineCard, but only if it is format-legal.
 *  Callers that must not reason about rotated cards use this instead of
 *  lookupCard, so the legality check cannot be forgotten. */
export function legalCard(name: string): EngineCard | null {
  return isCurrentStandard(name) ? lookupCard(name) : null;
}
