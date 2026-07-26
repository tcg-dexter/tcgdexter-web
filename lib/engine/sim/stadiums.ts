// Stadiums — one is in play at a time (state.stadium), affecting BOTH
// players. Two kinds of effect:
//   * passive — read where the rule applies (bench cap).
//   * activated — a `use_stadium` move any player may take once per turn
//     (Artazon: search a Basic to your Bench).
//
// Registry keyed by exact card name; unknown stadiums sit inertly.

import type { CardInstance, GameState, PlayerSide, PokemonInPlay } from "../types";
import { isBasic, prizeValue, toPokemonInPlay } from "./setup";
import type { Rng } from "./rng";
import { shuffle } from "./rng";

const DEFAULT_BENCH_CAP = 5;

function hasTera(side: PlayerSide): boolean {
  return [side.active, ...side.bench].some(
    (m) => m?.card.catalog?.subtypes.includes("Tera"),
  );
}

/** Passive bench-size cap for a side under the current Stadium. */
export function benchCap(state: GameState, actor: "player" | "opponent"): number {
  switch (state.stadium?.card.name) {
    case "Collapsed Stadium":
      return 4;
    case "Area Zero Underdepths":
      return hasTera(state.sides[actor]) ? 8 : DEFAULT_BENCH_CAP;
    default:
      return DEFAULT_BENCH_CAP;
  }
}

/** After a Stadium that lowers the cap enters, each player discards excess
 *  Benched Pokémon (lowest value first) down to the new cap. */
export function enforceBenchCap(state: GameState): void {
  for (const actor of ["player", "opponent"] as const) {
    const side = state.sides[actor];
    const cap = benchCap(state, actor);
    while (side.bench.length > cap) {
      // Auto-discard the least valuable bench Pokémon (fewest prizes, least
      // energy) — a reasonable default; a full UI choice is a future refinement.
      let worst = 0;
      let worstScore = Infinity;
      side.bench.forEach((mon, i) => {
        const score = prizeValue(mon.card.name) * 100 + mon.attachedEnergy.length * 10 + (mon.card.catalog?.hp ?? 0) / 10;
        if (score < worstScore) {
          worstScore = score;
          worst = i;
        }
      });
      const [removed] = side.bench.splice(worst, 1);
      side.discard.push(removed.card, ...removed.stack, ...removed.attachedEnergy, ...removed.attachedTools);
    }
  }
}

/** Effect-coverage predicate (W1): stadiums with a modeled passive or
 *  activated effect (others sit inertly). */
const MODELED_STADIUMS = new Set([
  "Artazon",
  "Collapsed Stadium",
  "Area Zero Underdepths",
  "N's Castle",
]);
export function isStadiumModeled(name: string): boolean {
  return MODELED_STADIUMS.has(name);
}

/* ─── Activated stadium effects ─────────────────────────────────── */

/** A move to use the current Stadium's activated effect. `deckCardId` /
 *  `deckCardName` carry the search choice (Artazon) — revealed by the
 *  search, so surfacing them here doesn't leak hidden information. */
export interface UseStadiumMove {
  kind: "use_stadium";
  stadiumName: string;
  deckCardId?: string;
  deckCardName?: string;
}

function dedupeByName(cards: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

/** Once-per-turn activated Stadium moves for `actor` (empty if none). */
export function stadiumMoves(
  state: GameState,
  actor: "player" | "opponent",
  alreadyUsed: boolean,
): UseStadiumMove[] {
  if (alreadyUsed || state.stadium?.card.name !== "Artazon") return [];
  const side = state.sides[actor];
  if (side.bench.length >= benchCap(state, actor)) return [];
  const eligible = side.deck.filter((c) => isBasic(c) && prizeValue(c.name) === 1);
  return dedupeByName(eligible).map((c) => ({
    kind: "use_stadium",
    stadiumName: "Artazon",
    deckCardId: c.id,
    deckCardName: c.name,
  }));
}

/** Apply a validated use_stadium move (Artazon: bench the chosen Basic). */
export function applyStadium(
  state: GameState,
  actor: "player" | "opponent",
  move: UseStadiumMove,
  rng: Rng | null,
): void {
  if (state.stadium?.card.name !== "Artazon" || move.stadiumName !== "Artazon") return;
  const side = state.sides[actor];
  if (side.bench.length >= benchCap(state, actor)) return;
  const idx = move.deckCardId ? side.deck.findIndex((c) => c.id === move.deckCardId) : -1;
  if (idx < 0) return;
  const [pulled] = side.deck.splice(idx, 1);
  side.bench.push(toPokemonInPlay(pulled, state.turn.number));
  if (rng) shuffle(side.deck, rng);
}
