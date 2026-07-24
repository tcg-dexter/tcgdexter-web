// Simulation setup: deck list text → concrete CardInstances → an initial
// GameState ready for free-running play. This is the "later pass" the
// engine's types.ts header promised: same state shape as replay, but the
// deck arrays are real (60 known cards), not log-inferred.
//
// v2 modelling notes (deliberate simplifications, see SIM_VERSION):
//   * Staple trainers have their real effects (see trainers.ts registry);
//     unregistered trainers fall back to generic cycling (supporter:
//     draw 2 once/turn; item/tool/stadium: draw 1), so trainer counts
//     still buy consistency.
//   * Abilities and attack side-effects are inert; damage is the printed
//     number, plus weakness ×2 / resistance −30.
//   * Special energy provides 1 Colorless.

import { parseDeckListCards } from "@/lib/cardPrinting";
import { basicEnergyAliasKeys } from "@/lib/basicEnergyAlias";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { ENGINE_VERSION } from "../types";
import type { CardInstance, GameState, PlayerSide, PokemonInPlay } from "../types";
import { shuffle, type Rng } from "./rng";

/** Bump when sim behavior changes enough to invalidate cached results
 *  (v2: staple trainer effects replaced generic cycling for the registry
 *  cards; v3: planner tempo fix — flat no-attack penalty + corrected energy
 *  cost-progress — changes which moves the planner chooses, so self-play
 *  rollouts are not comparable across versions). Trainers must filter
 *  policy data on this. */
// v4: coin-flip condition attacks implemented (Bemusing Aroma, Thunder
// Shock) — conditions now actually occur in self-play, changing rollout
// distributions for decks that carry them.
export const SIM_VERSION = 4;

const MAX_MULLIGANS = 20;

export interface SimDeck {
  cards: CardInstance[];
  /** Card names that didn't resolve in the catalog (played as inert). */
  unknownNames: string[];
  deckSize: number;
}

export class SimDeckError extends Error {}

/**
 * @param idPrefix When set, card ids are minted from a LOCAL counter
 *   (`${idPrefix}1`, `${idPrefix}2`, …) so identical inputs yield identical
 *   ids — required for transcript replay (interactive.ts), where recorded
 *   moves reference card ids across process rebuilds. Callers must use
 *   distinct prefixes per side. Defaults to globally-unique ids.
 */
/** Normalize a decklist card name to one the engine catalog understands.
 *  The only real offender is TCG Live's basic-energy shorthand — a decklist
 *  writes "Basic {D} Energy" where the catalog is keyed "Basic Darkness
 *  Energy" / "Darkness Energy". Without this, basic energy resolves to a
 *  null catalog: it can't be attached (no energyProvides) and shows a card
 *  back (no image). Only rewrites names that don't already resolve, so
 *  everything else is passed through untouched. */
export function canonicalCardName(name: string): string {
  if (lookupCard(name)) return name;
  const keys = basicEnergyAliasKeys(name);
  if (!keys) return name;
  for (const key of keys) {
    const proper = key.replace(/\b\w/g, (c) => c.toUpperCase()); // Title Case
    if (lookupCard(proper)) return proper;
  }
  return name;
}

export function instantiateDeck(deckList: string, idPrefix?: string): SimDeck {
  const parsed = parseDeckListCards(deckList);
  if (parsed.length === 0) throw new SimDeckError("Deck list could not be parsed");
  const cards: CardInstance[] = [];
  const unknown = new Set<string>();
  let local = 0;
  const mint = idPrefix ? () => `${idPrefix}${++local}` : () => mintInstanceId("sim");
  for (const entry of parsed) {
    const name = canonicalCardName(entry.name);
    const catalog = lookupCard(name);
    if (!catalog) unknown.add(entry.name);
    for (let i = 0; i < entry.qty; i++) {
      cards.push({ id: mint(), name, catalog });
    }
  }
  const basics = cards.some(
    (c) => c.catalog?.supertype === "Pokémon" && !c.catalog.evolves_from,
  );
  if (!basics) {
    throw new SimDeckError("Deck has no Basic Pokémon the simulator can recognize");
  }
  return { cards, unknownNames: Array.from(unknown), deckSize: cards.length };
}

/* ─── Card helpers shared by moves/policy ───────────────────────── */

export function isBasic(c: CardInstance): boolean {
  return c.catalog?.supertype === "Pokémon" && !c.catalog.evolves_from;
}

/** An "N's Pokémon" — the card name begins with the "N's " prefix. Shared by
 *  N's PP Up (energy accel) and N's Castle (retreat-cost waiver). */
export function isNsPokemon(c: CardInstance): boolean {
  return c.catalog?.supertype === "Pokémon" && c.name.startsWith("N's ");
}

/** A Basic Energy card (not Special Energy). Shared across trainer/attack
 *  effects that count or fetch basic energy. */
export function isBasicEnergyCard(c: CardInstance): boolean {
  return (
    c.catalog?.supertype === "Energy" &&
    (c.catalog.subtypes.includes("Basic") || c.name.startsWith("Basic "))
  );
}

const ENERGY_TYPE_RE =
  /(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy)/;

/** Energy type a card provides for DISPLAY (first unit). Special energy that
 *  provides "every type" shows as Colorless; see energyUnits for cost logic. */
export function energyProvides(c: CardInstance): string | null {
  if (c.catalog?.supertype !== "Energy") return null;
  const units = energyUnits(c);
  const first = units[0];
  return first === "Any" ? "Colorless" : first ?? "Colorless";
}

/** A single energy provided by an attached card: a concrete type, or "Any"
 *  (a wildcard that satisfies any typed cost). */
export type EnergyUnit = string;

/** Special energy that provides a wildcard "every type" unit. */
const ANY_TYPE_SPECIAL = new Set(["Luminous Energy", "Legacy Energy", "Rainbow Energy", "V Guard Energy"]);
/** Special energy providing 2+ Colorless from one card. */
const MULTI_COLORLESS_SPECIAL: Record<string, number> = { "Double Turbo Energy": 2 };

/** Effect-coverage predicate (W1): is this Special Energy's output modeled?
 *  Unmodeled special energy degrades to a single Colorless. */
export function isSpecialEnergyModeled(name: string): boolean {
  return ANY_TYPE_SPECIAL.has(name) || name in MULTI_COLORLESS_SPECIAL;
}

/**
 * Energy units an attached card provides toward attack/retreat costs. One
 * card can provide multiple units (Double Turbo = 2 Colorless) and can be a
 * wildcard (Luminous = 1 Any). Basic energy provides one unit of its type.
 * Unknown special energy provides a single Colorless (conservative default).
 */
export function energyUnits(c: CardInstance): EnergyUnit[] {
  if (c.catalog?.supertype !== "Energy") return [];
  if (isBasicEnergyCard(c)) {
    const m = c.name.match(ENERGY_TYPE_RE);
    return [m ? m[1] : "Colorless"];
  }
  if (ANY_TYPE_SPECIAL.has(c.name)) return ["Any"];
  const multi = MULTI_COLORLESS_SPECIAL[c.name];
  if (multi) return Array(multi).fill("Colorless");
  return ["Colorless"];
}

/** Total energy units attached to a Pokémon (Double Turbo counts as 2). */
export function totalEnergyUnits(mon: PokemonInPlay): number {
  return mon.attachedEnergy.reduce((n, c) => n + energyUnits(c).length, 0);
}

/** Prize cards taken for knocking this Pokémon out. */
export function prizeValue(name: string): number {
  if (/\bVMAX\b/.test(name)) return 3;
  if (/^Mega\b.*\bex\b/i.test(name) || /\bMega\b.*\bex$/i.test(name)) return 3;
  if (/\bVSTAR\b/.test(name)) return 2;
  if (/\bV\b$/.test(name) || /\bex$/i.test(name) || /\bEX$/.test(name)) return 2;
  return 1;
}

export function toPokemonInPlay(card: CardInstance, turnNumber: number): PokemonInPlay {
  return {
    // Derived from the card id (a card enters play at most once), so mon
    // ids are as deterministic as their cards — see instantiateDeck.
    id: `mon_${card.id}`,
    card,
    stack: [],
    damage: 0,
    attachedEnergy: [],
    attachedTools: [],
    conditions: [],
    abilitiesUsedThisTurn: [],
    enteredPlayOnTurn: turnNumber,
    evolvedThisTurn: false,
  };
}

/* ─── Initial state ─────────────────────────────────────────────── */

function bestOpeningBasic(hand: CardInstance[]): CardInstance | null {
  const basics = hand.filter(isBasic);
  if (basics.length === 0) return null;
  // Highest printed attack damage, then HP — a crude "primary attacker"
  // read that at least avoids leading with a support Pokémon.
  const score = (c: CardInstance) => {
    const attacks = c.catalog?.attacks ?? [];
    const best = Math.max(0, ...attacks.map((a) => parseInt(a.damage, 10) || 0));
    return best * 1000 + (c.catalog?.hp ?? 0);
  };
  return basics.reduce((a, b) => (score(b) > score(a) ? b : a));
}

function drawOpeningHand(side: PlayerSide, rng: Rng): number {
  let mulligans = 0;
  for (;;) {
    shuffle(side.deck, rng);
    side.hand = side.deck.splice(0, 7);
    if (side.hand.some(isBasic)) return mulligans;
    // Mulligan: hand back, reshuffle, redraw.
    side.deck.push(...side.hand);
    side.hand = [];
    mulligans += 1;
    if (mulligans >= MAX_MULLIGANS) {
      // Pathological deck (parseable but basically basic-free in practice);
      // give up and keep whatever we drew — the game will resolve fast.
      shuffle(side.deck, rng);
      side.hand = side.deck.splice(0, 7);
      return mulligans;
    }
  }
}

function setupSide(handle: string, deck: SimDeck, rng: Rng): { side: PlayerSide; mulligans: number } {
  const side: PlayerSide = {
    handle,
    deck: shuffle([...deck.cards], rng),
    hand: [],
    discard: [],
    lostZone: [],
    prizes: [],
    active: null,
    bench: [],
    mulligans: 0,
    energyAttachedThisTurn: 0,
    supporterPlayedThisTurn: false,
  };
  const mulligans = drawOpeningHand(side, rng);
  side.mulligans = mulligans;
  side.prizes = side.deck.splice(0, 6);

  // Board: best basic active, remaining basics benched (common line).
  const active = bestOpeningBasic(side.hand);
  if (active) {
    side.hand.splice(side.hand.indexOf(active), 1);
    side.active = toPokemonInPlay(active, 0);
  }
  for (const c of [...side.hand]) {
    if (side.bench.length >= 5) break;
    if (isBasic(c)) {
      side.hand.splice(side.hand.indexOf(c), 1);
      side.bench.push(toPokemonInPlay(c, 0));
    }
  }
  return { side, mulligans };
}

/** Build a ready-to-play state. sides.player = deck A, sides.opponent =
 *  deck B; `firstActor` decides who takes turn 1. */
export function buildSimInitialState(
  deckA: SimDeck,
  deckB: SimDeck,
  rng: Rng,
  firstActor: "player" | "opponent",
): GameState {
  const a = setupSide("sim-a", deckA, rng);
  const b = setupSide("sim-b", deckB, rng);

  // Mulligan compensation: 1 bonus draw per opposing mulligan.
  for (let i = 0; i < a.mulligans; i++) b.side.hand.push(...b.side.deck.splice(0, 1));
  for (let i = 0; i < b.mulligans; i++) a.side.hand.push(...a.side.deck.splice(0, 1));

  return {
    engineVersion: ENGINE_VERSION,
    turn: { number: 0, playerTurnNumber: 0, actor: "system", phase: "setup" },
    firstPlayer: firstActor,
    stadium: null,
    sides: { player: a.side, opponent: b.side },
    prizesTaken: { player: 0, opponent: 0 },
    winner: null,
    endReason: null,
  };
}
