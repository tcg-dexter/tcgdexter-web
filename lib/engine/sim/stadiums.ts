// Stadiums — one is in play at a time (state.stadium), affecting BOTH
// players. Two kinds of effect:
//   * passive — read where the rule applies (bench cap).
//   * activated — a `use_stadium` move any player may take once per turn
//     (Artazon: search a Basic to your Bench).
//
// Registry keyed by exact card name; unknown stadiums sit inertly.

import type { CardInstance, GameState, PlayerSide, PokemonInPlay } from "../types";
import { isBasic, prizeValue, toPokemonInPlay } from "./setup";
import { pickDiscards } from "./trainers";
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

/* ─── Static stadium passives (W2-fin.6) ────────────────────────── */

/** A Stadium's passive rule, read at the site where the rule applies rather
 *  than enumerated as a move. Each field maps to exactly one call site, which
 *  is what keeps these honest: a passive with no site is not "implemented". */
interface StadiumPassive {
  /** Flat max-HP delta for matching Pokémon (Gravity Mountain: Stage 2 −30). */
  hpDelta?: { amount: number; stage?: "Basic" | "Stage 1" | "Stage 2" };
  /** Attacks cost this many extra Colorless (Nighttime Mine: Tera +1). */
  attackCostExtra?: { amount: number; subtype?: string };
  /** Pokémon matching this have no Abilities (Team Rocket's Watchtower). */
  abilitiesOffFor?: { type?: string };
  /** All attached Pokémon Tools do nothing (Jamming Tower). */
  toolsDisabled?: boolean;
  /** Pokémon with any Energy can't be affected by Special Conditions
   *  (Festival Grounds). */
  conditionImmuneWithEnergy?: boolean;
  /** Damage counters can't be PLACED on Benched Pokémon by attack/ability
   *  effects — attack damage still applies (Battle Cage). */
  preventBenchCounters?: boolean;
  /** Attacks by matching Pokémon (BOTH sides) hit the Active harder. */
  damageBonus?: { amount: number; attacker: { namePrefix?: string } };
  /** Matching Pokémon may evolve the turn they are played. */
  evolveSameTurn?: { type: string };
  /** Counters placed on a Basic as it hits the Bench (Risky Ruins). */
  benchEntryCounters?: { n: number; exceptType?: string };
}

const STADIUM_PASSIVES: Record<string, StadiumPassive> = {
  "Gravity Mountain": { hpDelta: { amount: -30, stage: "Stage 2" } },
  "Nighttime Mine": { attackCostExtra: { amount: 1, subtype: "Tera" } },
  "Team Rocket's Watchtower": { abilitiesOffFor: { type: "Colorless" } },
  "Jamming Tower": { toolsDisabled: true },
  "Festival Grounds": { conditionImmuneWithEnergy: true },
  "Battle Cage": { preventBenchCounters: true },
  Postwick: { damageBonus: { amount: 30, attacker: { namePrefix: "Hop's " } } },
  "Forest of Vitality": { evolveSameTurn: { type: "Grass" } },
  "Risky Ruins": { benchEntryCounters: { n: 2, exceptType: "Darkness" } },
};

function passive(state: GameState | undefined): StadiumPassive | null {
  const name = state?.stadium?.card.name;
  return name ? (STADIUM_PASSIVES[name] ?? null) : null;
}

function stageOf(mon: PokemonInPlay): string | null {
  const cat = mon.card.catalog;
  if (cat?.supertype !== "Pokémon") return null;
  if (cat.subtypes.includes("Stage 2")) return "Stage 2";
  if (cat.subtypes.includes("Stage 1")) return "Stage 1";
  return cat.evolves_from ? null : "Basic";
}

/** Max-HP delta the current Stadium imposes on this Pokémon. */
export function stadiumHpDelta(mon: PokemonInPlay, state?: GameState): number {
  const p = passive(state)?.hpDelta;
  if (!p) return 0;
  return !p.stage || stageOf(mon) === p.stage ? p.amount : 0;
}

/** Extra Colorless the current Stadium adds to this Pokémon's attack costs. */
export function stadiumAttackCostExtra(mon: PokemonInPlay, state?: GameState): number {
  const p = passive(state)?.attackCostExtra;
  if (!p) return 0;
  const subs = mon.card.catalog?.subtypes ?? [];
  return !p.subtype || subs.includes(p.subtype) ? p.amount : 0;
}

/** True when the current Stadium switches this Pokémon's Abilities off. */
export function stadiumSuppressesAbility(mon: PokemonInPlay, state?: GameState): boolean {
  const p = passive(state)?.abilitiesOffFor;
  if (!p) return false;
  return !p.type || (mon.card.catalog?.types.includes(p.type) ?? false);
}

/** True when the current Stadium nullifies attached Pokémon Tools. */
export function stadiumDisablesTools(state?: GameState): boolean {
  return passive(state)?.toolsDisabled === true;
}

/** True when the current Stadium makes this Pokémon immune to Special
 *  Conditions (Festival Grounds — any Energy attached). */
export function stadiumBlocksConditions(mon: PokemonInPlay, state?: GameState): boolean {
  return passive(state)?.conditionImmuneWithEnergy === true && mon.attachedEnergy.length > 0;
}

/** True when the current Stadium prevents counters being PLACED on the Bench
 *  (Battle Cage). Attack damage to the Bench is unaffected. */
export function stadiumPreventsBenchCounters(state?: GameState): boolean {
  return passive(state)?.preventBenchCounters === true;
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
  return MODELED_STADIUMS.has(name) || name in STADIUM_PASSIVES || name in STADIUM_ACTIVATED;
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
  /** Cards the PLAYER chose out of their own hand — Academy at Night's
   *  top-deck, Prism Tower's two discards. Absent means the AI/auto path
   *  picks (pickDiscards). Like a trainer's discard cost this is a selection
   *  rather than an enumerated variant, so validate checks it separately
   *  (see stadiumHandCost). */
  handCardIds?: string[];
}

/** True when the Stadium's hand pick goes on TOP OF THE DECK rather than to
 *  the discard pile — the client must not label it "discard". */
export function stadiumTopDecks(name: string): boolean {
  return STADIUM_ACTIVATED[name]?.handToDeckTop === true;
}

/** How many cards from hand a Stadium's activated effect makes the player
 *  choose (0 = none). The client asks for exactly this many. */
export function stadiumHandCost(name: string, handSize: number): number {
  const spec = STADIUM_ACTIVATED[name];
  if (!spec) return 0;
  if (spec.handToDeckTop) return Math.min(1, handSize);
  if (spec.discardThenDraw) return Math.min(spec.discardThenDraw.discard, handSize);
  return 0;
}

function dedupeByName(cards: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

/** Activated Stadium effects, once during EACH player's turn. Artazon keeps
 *  its hand-written search (it picks a card, so it needs the pickers); the
 *  rest are simple enough to declare as data. */
interface StadiumActivated {
  /** Search own deck for a card matching this name prefix -> hand. */
  searchNamePrefix?: string;
  /** Put a card from hand on top of the deck (Academy at Night). */
  handToDeckTop?: boolean;
  /** Discard N from hand, then draw M (Prism Tower). */
  discardThenDraw?: { discard: number; draw: number };
  /** Draw N if a Supporter whose name contains this was played this turn
   *  (Team Rocket's Factory). */
  drawIfSupporterPlayed?: { contains: string; draw: number };
  /** Heal N from every one of your Pokémon, gated on having played a
   *  Supporter this turn (Community Center). */
  healAllIfSupporterPlayed?: number;
  /** Discard an Energy from hand, then draw up to your Psychic-Pokémon count
   *  (Mystery Garden). */
  discardEnergyDrawToPsychicCount?: boolean;
  /** Evolve a Basic from the deck, then that Stage 1 into its Stage 2
   *  (Grand Tree). */
  evolveChainFromDeck?: boolean;
}

export const STADIUM_ACTIVATED: Record<string, StadiumActivated> = {
  "Spikemuth Gym": { searchNamePrefix: "Marnie's " },
  // Heal 10 from each of your Pokémon, if you played a Supporter this turn.
  "Community Center": { healAllIfSupporterPlayed: 10 },
  // Discard an Energy from hand, then draw up to your Psychic count.
  "Mystery Garden": { discardEnergyDrawToPsychicCount: true },
  // Evolve a Basic straight out of the deck, then its Stage 2.
  "Grand Tree": { evolveChainFromDeck: true },
  "Academy at Night": { handToDeckTop: true },
  "Prism Tower": { discardThenDraw: { discard: 2, draw: 1 } },
  "Team Rocket's Factory": { drawIfSupporterPlayed: { contains: "Team Rocket", draw: 2 } },
};

/** Once-per-turn activated Stadium moves for `actor` (empty if none). */
export function stadiumMoves(
  state: GameState,
  actor: "player" | "opponent",
  alreadyUsed: boolean,
): UseStadiumMove[] {
  if (alreadyUsed) return [];
  const name = state.stadium?.card.name;
  if (!name) return [];
  const side = state.sides[actor];

  if (name === "Artazon") {
    if (side.bench.length >= benchCap(state, actor)) return [];
    const eligible = side.deck.filter((c) => isBasic(c) && prizeValue(c.name) === 1);
    return dedupeByName(eligible).map((c) => ({
      kind: "use_stadium",
      stadiumName: "Artazon",
      deckCardId: c.id,
      deckCardName: c.name,
    }));
  }

  const spec = STADIUM_ACTIVATED[name];
  if (!spec) return [];
  const one = (extra: Partial<UseStadiumMove> = {}): UseStadiumMove[] => [
    { kind: "use_stadium", stadiumName: name, ...extra },
  ];

  if (spec.searchNamePrefix) {
    const eligible = side.deck.filter((c) => c.name.startsWith(spec.searchNamePrefix!));
    return dedupeByName(eligible).map((c) => ({
      kind: "use_stadium",
      stadiumName: name,
      deckCardId: c.id,
      deckCardName: c.name,
    }));
  }
  if (spec.handToDeckTop) return side.hand.length > 0 ? one() : [];
  if (spec.discardThenDraw) {
    return side.hand.length >= spec.discardThenDraw.discard && side.deck.length > 0 ? one() : [];
  }
  if (spec.drawIfSupporterPlayed) {
    // Gated on the supporter actually played this turn, tracked on the side.
    const played = side.supporterNamePlayedThisTurn ?? "";
    const ok = played.includes(spec.drawIfSupporterPlayed.contains) && side.deck.length > 0;
    return ok ? one() : [];
  }
  if (spec.healAllIfSupporterPlayed != null) {
    return side.supporterPlayedThisTurn ? one() : [];
  }
  if (spec.discardEnergyDrawToPsychicCount) {
    return side.hand.some((c) => c.catalog?.supertype === "Energy") ? one() : [];
  }
  if (spec.evolveChainFromDeck) {
    const basics = [side.active, ...side.bench].filter(
      (m): m is PokemonInPlay => m !== null && !m.card.catalog?.evolves_from,
    );
    return basics.length > 0 && side.deck.length > 0 ? one() : [];
  }
  return [];
}

/** Apply a validated use_stadium move (Artazon: bench the chosen Basic). */
export function applyStadium(
  state: GameState,
  actor: "player" | "opponent",
  move: UseStadiumMove,
  rng: Rng | null,
): void {
  const name = state.stadium?.card.name;
  if (!name || move.stadiumName !== name) return;
  const side = state.sides[actor];

  if (name === "Artazon") {
    if (side.bench.length >= benchCap(state, actor)) return;
    const idx = move.deckCardId ? side.deck.findIndex((c) => c.id === move.deckCardId) : -1;
    if (idx < 0) return;
    const [pulled] = side.deck.splice(idx, 1);
    side.bench.push(toPokemonInPlay(pulled, state.turn.number));
    if (rng) shuffle(side.deck, rng);
    return;
  }

  const spec = STADIUM_ACTIVATED[name];
  if (!spec) return;

  if (spec.searchNamePrefix) {
    const idx = move.deckCardId ? side.deck.findIndex((c) => c.id === move.deckCardId) : -1;
    if (idx < 0) return;
    side.hand.push(...side.deck.splice(idx, 1));
    if (rng) shuffle(side.deck, rng);
    return;
  }
  // The player's own hand picks when they made them, else the heuristic.
  const fromHand = (n: number): CardInstance[] => {
    const chosen = (move.handCardIds ?? [])
      .map((id) => side.hand.find((c) => c.id === id))
      .filter((c): c is CardInstance => c !== undefined);
    return chosen.length >= n ? chosen.slice(0, n) : pickDiscards(side, n, "");
  };

  if (spec.handToDeckTop) {
    const [chosen] = fromHand(1);
    const i = chosen ? side.hand.findIndex((c) => c.id === chosen.id) : -1;
    if (i >= 0) side.deck.unshift(...side.hand.splice(i, 1));
    return;
  }
  if (spec.discardThenDraw) {
    const { discard, draw } = spec.discardThenDraw;
    if (side.hand.length < discard) return;
    for (const c of fromHand(discard)) {
      const i = side.hand.findIndex((h) => h.id === c.id);
      if (i >= 0) side.discard.push(...side.hand.splice(i, 1));
    }
    side.hand.push(...side.deck.splice(0, draw));
    return;
  }
  if (spec.drawIfSupporterPlayed) {
    const played = side.supporterNamePlayedThisTurn ?? "";
    if (!played.includes(spec.drawIfSupporterPlayed.contains)) return;
    side.hand.push(...side.deck.splice(0, spec.drawIfSupporterPlayed.draw));
    return;
  }
  if (spec.healAllIfSupporterPlayed != null) {
    if (!side.supporterPlayedThisTurn) return;
    for (const m of [side.active, ...side.bench]) {
      if (m) m.damage = Math.max(0, m.damage - spec.healAllIfSupporterPlayed);
    }
    return;
  }
  if (spec.discardEnergyDrawToPsychicCount) {
    const i = side.hand.findIndex((c) => c.catalog?.supertype === "Energy");
    if (i < 0) return;
    side.discard.push(...side.hand.splice(i, 1));
    const psychic = [side.active, ...side.bench].filter(
      (m) => m?.card.catalog?.types.includes("Psychic"),
    ).length;
    side.hand.push(...side.deck.splice(0, Math.max(0, psychic - side.hand.length)));
    return;
  }
  if (spec.evolveChainFromDeck) {
    // Basic -> Stage 1 -> Stage 2, each pulled from the deck.
    const target = [side.active, ...side.bench].find(
      (m): m is PokemonInPlay => m !== null && !m.card.catalog?.evolves_from,
    );
    if (!target) return;
    for (let step = 0; step < 2; step++) {
      const idx = side.deck.findIndex((c) => c.catalog?.evolves_from === target.card.name);
      if (idx < 0) break;
      const [evo] = side.deck.splice(idx, 1);
      target.stack.push(target.card);
      target.card = evo;
      target.evolvedThisTurn = true;
    }
    if (rng) shuffle(side.deck, rng);
  }
}

/** Extra Active-spot damage from the current Stadium (Postwick). */
export function stadiumDamageBonus(attacker: PokemonInPlay, state?: GameState): number {
  const b = passive(state)?.damageBonus;
  if (!b) return 0;
  const pre = b.attacker.namePrefix;
  return !pre || attacker.card.name.startsWith(pre) ? b.amount : 0;
}

/** True when the Stadium lets this Pokémon evolve the turn it was played. */
export function stadiumAllowsSameTurnEvolve(mon: PokemonInPlay, state?: GameState): boolean {
  const e = passive(state)?.evolveSameTurn;
  return Boolean(e && (mon.card.catalog?.types.includes(e.type) ?? false));
}

/** Counters placed on a Basic as it enters the Bench (Risky Ruins). */
export function stadiumBenchEntryCounters(mon: PokemonInPlay, state?: GameState): number {
  const b = passive(state)?.benchEntryCounters;
  if (!b) return 0;
  if (mon.card.catalog?.evolves_from) return 0; // Basics only
  if (b.exceptType && (mon.card.catalog?.types.includes(b.exceptType) ?? false)) return 0;
  return b.n;
}
