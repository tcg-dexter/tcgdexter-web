// Staple trainer effects (AI player Milestone D). A declarative registry
// keyed by exact card name gives the top-played trainers their real
// effects; anything unregistered keeps the generic draw-cycle behavior.
// Chosen from corpus + meta-deck frequency (2026-07 pool): Lillie's
// Determination, Poké Pad, Ultra Ball, Boss's Orders, Buddy-Buddy Poffin,
// Night Stretcher, Team Rocket's Petrel, Rare Candy, Hilda, Crispin, plus
// the evergreen Switch / Nest Ball / Judge / Iono / Professor's Research.
//
// The `phase` classifies how the AI planner handles a card:
//   * search  — reveals hidden info (deck/discard); played greedily in the
//     planner's info phase with a heuristic pick, never inside plan search
//     (the ghost state can't see the deck).
//   * draw    — hand-refresh supporters; greedy with hand-size guards.
//   * tactical — public-information effects (gust, switch, rare candy)
//     that enter the plan search and get evaluated like any other line.

import type { CardInstance, GameState, PlayerSide } from "../types";
import { lookupCard } from "../catalog";
import { clearConditions } from "./conditions";
import { shuffle, type Rng } from "./rng";
import { energyProvides, isBasic, prizeValue, toPokemonInPlay } from "./setup";

/* ─── Registry ──────────────────────────────────────────────────── */

export type DeckFilter =
  | "pokemon"
  | "basic_pokemon"
  | "no_rulebox_pokemon"
  | "basic_70hp"
  | "trainer";

export type TrainerEffect =
  | { kind: "deck_search"; filter: DeckFilter; count: number; to: "hand" | "bench"; discardCost?: number }
  | { kind: "hilda" }
  | { kind: "night_stretcher" }
  | { kind: "crispin" }
  | { kind: "shuffle_hand_draw"; draw: number; drawAtSixPrizes?: number }
  | { kind: "discard_hand_draw"; draw: number }
  | { kind: "judge" }
  | { kind: "iono" }
  | { kind: "gust" }
  | { kind: "switch_active" }
  | { kind: "rare_candy" };

export type TrainerPhase = "search" | "draw" | "tactical";

export interface TrainerSpec {
  effect: TrainerEffect;
  phase: TrainerPhase;
}

export const TRAINER_EFFECTS: Record<string, TrainerSpec> = {
  "Nest Ball": { effect: { kind: "deck_search", filter: "basic_pokemon", count: 1, to: "bench" }, phase: "search" },
  "Buddy-Buddy Poffin": { effect: { kind: "deck_search", filter: "basic_70hp", count: 2, to: "bench" }, phase: "search" },
  "Poké Pad": { effect: { kind: "deck_search", filter: "no_rulebox_pokemon", count: 1, to: "hand" }, phase: "search" },
  "Ultra Ball": { effect: { kind: "deck_search", filter: "pokemon", count: 1, to: "hand", discardCost: 2 }, phase: "search" },
  "Team Rocket's Petrel": { effect: { kind: "deck_search", filter: "trainer", count: 1, to: "hand" }, phase: "search" },
  Hilda: { effect: { kind: "hilda" }, phase: "search" },
  "Night Stretcher": { effect: { kind: "night_stretcher" }, phase: "search" },
  Crispin: { effect: { kind: "crispin" }, phase: "search" },
  "Lillie's Determination": { effect: { kind: "shuffle_hand_draw", draw: 6, drawAtSixPrizes: 8 }, phase: "draw" },
  "Professor's Research": { effect: { kind: "discard_hand_draw", draw: 7 }, phase: "draw" },
  Judge: { effect: { kind: "judge" }, phase: "draw" },
  Iono: { effect: { kind: "iono" }, phase: "draw" },
  "Boss's Orders": { effect: { kind: "gust" }, phase: "tactical" },
  Switch: { effect: { kind: "switch_active" }, phase: "tactical" },
  "Rare Candy": { effect: { kind: "rare_candy" }, phase: "tactical" },
};

export function trainerSpec(card: CardInstance): TrainerSpec | null {
  if (card.catalog?.supertype !== "Trainer") return null;
  return TRAINER_EFFECTS[card.name] ?? null;
}

export function isSupporter(card: CardInstance): boolean {
  return card.catalog?.subtypes.includes("Supporter") ?? false;
}

/* ─── The move shape ────────────────────────────────────────────── */

/** One flat optional-field shape keeps serialization/validation simple.
 *  Names ride alongside ids so the move is self-describing — the client
 *  labels search pickers and the AI planner scores fetch targets without
 *  either being handed the hidden deck. */
export interface PlayTrainerMove {
  kind: "play_trainer";
  cardId: string;
  /** Deck-search picks (revealed by the search itself). */
  deckCardIds?: string[];
  deckCardNames?: string[];
  /** Night Stretcher's pick from the (public) discard pile. */
  discardPickId?: string;
  discardPickName?: string;
  /** Own in-play target (Crispin attach, Rare Candy basic). */
  monId?: string;
  /** Rare Candy's Stage 2 from hand. */
  handCardId?: string;
  /** Own bench target (Switch). */
  benchIndex?: number;
  /** Opponent bench target (Boss's Orders). */
  oppBenchIndex?: number;
  /** Human-chosen cards to pay a discard cost (Ultra Ball). When absent,
   *  the AI/auto path picks them (pickDiscards). Not part of the
   *  enumerated legal set — validated separately (see validateTrainerCost). */
  discardCardIds?: string[];
}

/** The number of cards a trainer requires discarding to play (0 = none).
 *  Humans supply the choice via discardCardIds; the count must match. */
export function trainerDiscardCost(card: CardInstance): number {
  return trainerDiscardCostByName(card.name);
}

/** Name-keyed discard cost — for the client, which only knows card names. */
export function trainerDiscardCostByName(name: string): number {
  const spec = TRAINER_EFFECTS[name];
  return spec?.effect.kind === "deck_search" ? (spec.effect.discardCost ?? 0) : 0;
}

/* ─── Filters ───────────────────────────────────────────────────── */

function isBasicEnergy(c: CardInstance): boolean {
  return (
    c.catalog?.supertype === "Energy" &&
    (c.catalog.subtypes.includes("Basic") || c.name.startsWith("Basic "))
  );
}

export function matchesFilter(c: CardInstance, filter: DeckFilter): boolean {
  const cat = c.catalog;
  switch (filter) {
    case "pokemon":
      return cat?.supertype === "Pokémon";
    case "basic_pokemon":
      return isBasic(c);
    case "no_rulebox_pokemon":
      return cat?.supertype === "Pokémon" && prizeValue(c.name) === 1;
    case "basic_70hp":
      return isBasic(c) && (cat?.hp ?? 999) <= 70;
    case "trainer":
      return cat?.supertype === "Trainer";
  }
}

/** Rare Candy chain: stage2 in hand evolves (via a Stage 1) from `basic`. */
export function candyChainMatches(stage2: CardInstance, basicName: string): boolean {
  const stage1Name = stage2.catalog?.evolves_from;
  if (!stage1Name) return false;
  return lookupCard(stage1Name)?.evolves_from === basicName;
}

/* ─── Legal-move enumeration ────────────────────────────────────── */

function dedupeByName(cards: CardInstance[]): CardInstance[] {
  const seen = new Set<string>();
  return cards.filter((c) => (seen.has(c.name) ? false : (seen.add(c.name), true)));
}

/** All concrete plays of a registered trainer. The supporter-per-turn gate
 *  is the caller's job (legalMoves); this enumerates effect targets. */
export function trainerMoves(
  state: GameState,
  actor: "player" | "opponent",
  card: CardInstance,
  spec: TrainerSpec,
): PlayTrainerMove[] {
  const side = state.sides[actor];
  const other = state.sides[actor === "player" ? "opponent" : "player"];
  const base = { kind: "play_trainer" as const, cardId: card.id };
  const effect = spec.effect;

  switch (effect.kind) {
    case "deck_search": {
      if (effect.discardCost && side.hand.length < effect.discardCost + 1) return [];
      const eligible = side.deck.filter((c) => matchesFilter(c, effect.filter));
      if (eligible.length === 0) return [];
      const benchSpace = 5 - side.bench.length;
      const take = Math.min(
        effect.count,
        eligible.length,
        effect.to === "bench" ? benchSpace : Number.POSITIVE_INFINITY,
      );
      if (take <= 0) return [];
      const options = dedupeByName(eligible);
      if (take === 1) {
        return options.map((c) => ({
          ...base,
          deckCardIds: [c.id],
          deckCardNames: [c.name],
        }));
      }
      // take === 2 (Poffin): unordered name-pairs, including doubles when
      // two copies exist. Small: eligible names in these decks are few.
      const moves: PlayTrainerMove[] = [];
      for (let i = 0; i < options.length; i++) {
        for (let j = i; j < options.length; j++) {
          if (i === j) {
            const copies = eligible.filter((c) => c.name === options[i].name);
            if (copies.length < 2) continue;
            moves.push({
              ...base,
              deckCardIds: [copies[0].id, copies[1].id],
              deckCardNames: [copies[0].name, copies[1].name],
            });
          } else {
            moves.push({
              ...base,
              deckCardIds: [options[i].id, options[j].id],
              deckCardNames: [options[i].name, options[j].name],
            });
          }
        }
      }
      return moves;
    }
    case "hilda": {
      const hasEvo = side.deck.some((c) => c.catalog?.supertype === "Pokémon" && c.catalog.evolves_from);
      const hasEnergy = side.deck.some((c) => c.catalog?.supertype === "Energy");
      return hasEvo || hasEnergy ? [base] : [];
    }
    case "night_stretcher": {
      const eligible = side.discard.filter(
        (c) => c.catalog?.supertype === "Pokémon" || isBasicEnergy(c),
      );
      return dedupeByName(eligible).map((c) => ({
        ...base,
        discardPickId: c.id,
        discardPickName: c.name,
      }));
    }
    case "crispin": {
      const energyNames = new Set(
        side.deck.filter(isBasicEnergy).map((c) => c.name),
      );
      if (energyNames.size === 0) return [];
      const targets = [side.active, ...side.bench].filter((m) => m !== null);
      return targets.map((m) => ({ ...base, monId: m!.id }));
    }
    case "shuffle_hand_draw":
    case "discard_hand_draw":
      return side.deck.length > 0 ? [base] : [];
    case "judge":
    case "iono":
      return [base];
    case "gust":
      return other.active
        ? other.bench.map((_, i) => ({ ...base, oppBenchIndex: i }))
        : [];
    case "switch_active":
      return side.active
        ? side.bench.map((_, i) => ({ ...base, benchIndex: i }))
        : [];
    case "rare_candy": {
      if (state.turn.playerTurnNumber <= 1) return [];
      const moves: PlayTrainerMove[] = [];
      const seen = new Set<string>();
      for (const mon of [side.active, ...side.bench]) {
        if (!mon || !isBasic(mon.card)) continue;
        if (mon.enteredPlayOnTurn >= state.turn.number || mon.evolvedThisTurn) continue;
        for (const s2 of side.hand) {
          if (s2.id === card.id || !candyChainMatches(s2, mon.card.name)) continue;
          const key = `${mon.id}→${s2.name}`;
          if (seen.has(key)) continue;
          seen.add(key);
          moves.push({ ...base, monId: mon.id, handCardId: s2.id });
        }
      }
      return moves;
    }
  }
}

/* ─── Resolution ────────────────────────────────────────────────── */

function takeFromHand(side: PlayerSide, cardId: string): CardInstance | null {
  const idx = side.hand.findIndex((c) => c.id === cardId);
  return idx >= 0 ? side.hand.splice(idx, 1)[0] : null;
}

function takeFromDeckById(side: PlayerSide, cardId: string): CardInstance | null {
  const idx = side.deck.findIndex((c) => c.id === cardId);
  return idx >= 0 ? side.deck.splice(idx, 1)[0] : null;
}

function maybeShuffleDeck(side: PlayerSide, rng: Rng | null): void {
  if (rng) shuffle(side.deck, rng);
}

/** Auto-selected discards (Ultra Ball cost): duplicates first, then spare
 *  energy, then trainers — never the card being played. Deterministic. */
export function pickDiscards(side: PlayerSide, n: number, excludeId: string): CardInstance[] {
  const counts = new Map<string, number>();
  for (const c of side.hand) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const energyInHand = side.hand.filter((c) => c.catalog?.supertype === "Energy").length;
  const score = (c: CardInstance): number => {
    if ((counts.get(c.name) ?? 0) > 1) return 0;
    if (c.catalog?.supertype === "Energy" && energyInHand >= 2) return 1;
    if (c.catalog?.supertype === "Trainer") return 2;
    if (c.catalog?.supertype === "Energy") return 3;
    return 4; // singleton Pokémon last
  };
  return side.hand
    .filter((c) => c.id !== excludeId)
    .map((c, i) => ({ c, i, s: score(c) }))
    .sort((a, b) => a.s - b.s || a.i - b.i)
    .slice(0, n)
    .map((e) => e.c);
}

function shuffleHandIntoDeck(side: PlayerSide, rng: Rng | null, toBottom: boolean): number {
  const returned = side.hand.length;
  if (toBottom) side.deck.push(...side.hand); // deck top is index 0
  else side.deck.push(...side.hand);
  side.hand = [];
  if (!toBottom) maybeShuffleDeck(side, rng);
  return returned;
}

function draw(side: PlayerSide, n: number): void {
  side.hand.push(...side.deck.splice(0, n));
}

/** Apply a validated play_trainer move. The trainer card itself always
 *  ends in the discard. `rng` (when present) drives post-search shuffles;
 *  ghost evaluations pass null and skip them (hidden zones are
 *  placeholders there anyway). */
export function applyTrainer(
  state: GameState,
  actor: "player" | "opponent",
  move: PlayTrainerMove,
  rng: Rng | null,
): void {
  const side = state.sides[actor];
  const other = state.sides[actor === "player" ? "opponent" : "player"];
  const card = takeFromHand(side, move.cardId);
  if (!card) return;
  const spec = TRAINER_EFFECTS[card.name];
  if (!spec) {
    side.discard.push(card);
    return;
  }
  if (isSupporter(card)) side.supporterPlayedThisTurn = true;
  // Played card leaves the hand BEFORE hand-wide effects resolve.
  side.discard.push(card);

  const effect = spec.effect;
  switch (effect.kind) {
    case "deck_search": {
      if (effect.discardCost) {
        // Human-chosen discards when supplied and valid; else auto-pick.
        const chosen =
          move.discardCardIds?.length === effect.discardCost &&
          move.discardCardIds.every((id) => side.hand.some((c) => c.id === id))
            ? (move.discardCardIds
                .map((id) => side.hand.find((c) => c.id === id))
                .filter((c): c is CardInstance => c != null))
            : pickDiscards(side, effect.discardCost, "");
        for (const d of chosen) {
          takeFromHand(side, d.id);
          side.discard.push(d);
        }
      }
      for (const id of move.deckCardIds ?? []) {
        const fetched = takeFromDeckById(side, id);
        if (!fetched) continue;
        if (effect.to === "bench" && side.bench.length < 5) {
          side.bench.push(toPokemonInPlay(fetched, state.turn.number));
        } else {
          side.hand.push(fetched);
        }
      }
      maybeShuffleDeck(side, rng);
      break;
    }
    case "hilda": {
      // Auto-picks: an evolution matching something in play (else the
      // deck's first evolution), plus the deck's most common energy.
      const inPlayNames = new Set(
        [side.active, ...side.bench].filter(Boolean).map((m) => m!.card.name),
      );
      const evolutions = side.deck.filter(
        (c) => c.catalog?.supertype === "Pokémon" && c.catalog.evolves_from,
      );
      const evo =
        evolutions.find((c) => inPlayNames.has(c.catalog!.evolves_from!)) ?? evolutions[0];
      if (evo) side.hand.push(takeFromDeckById(side, evo.id)!);
      const energy = side.deck.find((c) => c.catalog?.supertype === "Energy");
      if (energy) side.hand.push(takeFromDeckById(side, energy.id)!);
      maybeShuffleDeck(side, rng);
      break;
    }
    case "night_stretcher": {
      if (move.discardPickId) {
        const idx = side.discard.findIndex((c) => c.id === move.discardPickId);
        if (idx >= 0) side.hand.push(...side.discard.splice(idx, 1));
      }
      break;
    }
    case "crispin": {
      const basics = side.deck.filter(isBasicEnergy);
      const byName = new Map<string, CardInstance>();
      for (const c of basics) if (!byName.has(c.name)) byName.set(c.name, c);
      const distinct = Array.from(byName.values()).slice(0, 2);
      if (distinct.length === 0) break;
      const target = [side.active, ...side.bench].find((m) => m?.id === move.monId) ?? side.active;
      // Attach the one the target's attacks want; the other goes to hand.
      const wanted = new Set(
        (target?.card.catalog?.attacks ?? []).flatMap((a) => a.cost),
      );
      const attachCard =
        distinct.find((c) => {
          const t = energyProvides(c);
          return t !== null && wanted.has(t);
        }) ?? distinct[0];
      const handCard = distinct.find((c) => c !== attachCard);
      const pulled = takeFromDeckById(side, attachCard.id);
      if (pulled && target) target.attachedEnergy.push(pulled);
      else if (pulled) side.hand.push(pulled);
      if (handCard) {
        const pulledHand = takeFromDeckById(side, handCard.id);
        if (pulledHand) side.hand.push(pulledHand);
      }
      maybeShuffleDeck(side, rng);
      break;
    }
    case "shuffle_hand_draw": {
      shuffleHandIntoDeck(side, rng, false);
      const n =
        effect.drawAtSixPrizes != null && side.prizes.length === 6
          ? effect.drawAtSixPrizes
          : effect.draw;
      draw(side, n);
      break;
    }
    case "discard_hand_draw": {
      side.discard.push(...side.hand);
      side.hand = [];
      draw(side, effect.draw);
      break;
    }
    case "judge": {
      for (const s of [side, other]) {
        shuffleHandIntoDeck(s, rng, false);
        draw(s, 4);
      }
      break;
    }
    case "iono": {
      for (const s of [side, other]) {
        const returned = shuffleHandIntoDeck(s, null, true); // to bottom, no shuffle
        if (returned > 0 || s === side) draw(s, s.prizes.length);
      }
      break;
    }
    case "gust": {
      const idx = move.oppBenchIndex ?? 0;
      const target = other.bench[Math.min(idx, other.bench.length - 1)];
      if (target && other.active) {
        clearConditions(other.active); // leaving the Active Spot clears conditions
        other.bench[Math.min(idx, other.bench.length - 1)] = other.active;
        other.active = target;
      }
      break;
    }
    case "switch_active": {
      const idx = move.benchIndex ?? 0;
      const target = side.bench[Math.min(idx, side.bench.length - 1)];
      if (target && side.active) {
        clearConditions(side.active);
        side.bench[Math.min(idx, side.bench.length - 1)] = side.active;
        side.active = target;
      }
      break;
    }
    case "rare_candy": {
      const mon = [side.active, ...side.bench].find((m) => m?.id === move.monId);
      const stage2 = move.handCardId ? takeFromHand(side, move.handCardId) : null;
      if (mon && stage2) {
        mon.stack.push(mon.card);
        mon.card = stage2;
        mon.evolvedThisTurn = true;
        mon.conditions = [];
      } else if (stage2) {
        side.hand.push(stage2);
      }
      break;
    }
  }
}
