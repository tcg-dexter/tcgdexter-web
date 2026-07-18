// PlayerView — the information-set boundary for the AI player.
//
// At any point a player knows: their own hand, both boards (public), both
// discard piles and Lost Zones (public), and COUNTS of everything hidden
// (opponent hand, both decks, prize cards). Policies consume a PlayerView,
// never the raw GameState, so a policy structurally cannot peek at the
// opponent's hand or either deck's order. The no-leak test in
// planner.test.ts pins this.
//
// unseenOwn is the perfect-memory inference: a player knows their own
// 60-card list, so subtracting every seen zone (hand, board, discard,
// Lost Zone) leaves the combined deck ∪ prizes composition — "these cards
// are somewhere in my deck or prizes". It exposes no order and no
// deck-vs-prize split, exactly matching what a real player can deduce.
//
// Views hold references into the live state (cheap, policies are internal
// code) — the discipline is the interface shape, not defensive copying.
// The API layer serializes views separately (serialize.ts) for clients.

import type { CardInstance, GameState, PokemonInPlay, TurnState } from "../types";
import type { TurnContext } from "./moves";

export interface OpponentView {
  board: { active: PokemonInPlay | null; bench: PokemonInPlay[] };
  /** Discards are public knowledge. */
  discard: CardInstance[];
  /** Lost Zone is public knowledge. */
  lostZone: CardInstance[];
  handCount: number;
  deckCount: number;
  prizeCount: number;
  prizesTaken: number;
  mulligans: number;
}

export interface PlayerView {
  /** Which side this view belongs to. */
  actor: "player" | "opponent";
  turn: TurnState;
  /** Did THIS side go first (null before the coin resolves). */
  wentFirst: boolean | null;
  /** Own hand — full identities. */
  hand: CardInstance[];
  board: { active: PokemonInPlay | null; bench: PokemonInPlay[] };
  discard: CardInstance[];
  lostZone: CardInstance[];
  deckCount: number;
  prizeCount: number;
  prizesTaken: number;
  mulligans: number;
  /** Own cards not yet seen: name → count across deck ∪ prizes. */
  unseenOwn: Record<string, number>;
  energyAttachedThisTurn: number;
  supporterPlayedThisTurn: boolean;
  /** True once this side has retreated this turn (one per turn). */
  retreatUsedThisTurn: boolean;
  /** True once a Stadium card was played this turn (one per turn). */
  stadiumPlayedThisTurn: boolean;
  /** True once the current Stadium's activated effect was used this turn. */
  stadiumEffectUsedThisTurn: boolean;
  /** Stadium in play (public), with which side owns it. */
  stadium: { name: string; owner: "player" | "opponent" } | null;
  opponent: OpponentView;
}

/** Combined deck ∪ prizes composition — what a perfect-memory player knows
 *  about their own unseen cards. Never expose this for the opponent. */
function unseenOwnCounts(deck: CardInstance[], prizes: CardInstance[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const card of deck) counts[card.name] = (counts[card.name] ?? 0) + 1;
  for (const card of prizes) counts[card.name] = (counts[card.name] ?? 0) + 1;
  return counts;
}

/** Build the actor's information set. `ctx` is the acting side's per-turn
 *  bookkeeping; omit it outside that side's turn (flags default false). */
export function viewFor(
  state: GameState,
  actor: "player" | "opponent",
  ctx?: TurnContext,
): PlayerView {
  const self = state.sides[actor];
  const otherActor = actor === "player" ? "opponent" : "player";
  const other = state.sides[otherActor];
  return {
    actor,
    turn: state.turn,
    wentFirst: state.firstPlayer === null ? null : state.firstPlayer === actor,
    hand: self.hand,
    board: { active: self.active, bench: self.bench },
    discard: self.discard,
    lostZone: self.lostZone,
    deckCount: self.deck.length,
    prizeCount: self.prizes.length,
    prizesTaken: state.prizesTaken[actor],
    mulligans: self.mulligans,
    unseenOwn: unseenOwnCounts(self.deck, self.prizes),
    energyAttachedThisTurn: self.energyAttachedThisTurn,
    supporterPlayedThisTurn: self.supporterPlayedThisTurn,
    retreatUsedThisTurn: ctx?.retreated ?? false,
    stadiumPlayedThisTurn: ctx?.stadiumPlayed ?? false,
    stadiumEffectUsedThisTurn: ctx?.stadiumUsed ?? false,
    stadium: state.stadium
      ? { name: state.stadium.card.name, owner: state.stadium.owner }
      : null,
    opponent: {
      board: { active: other.active, bench: other.bench },
      discard: other.discard,
      lostZone: other.lostZone,
      handCount: other.hand.length,
      deckCount: other.deck.length,
      prizeCount: other.prizes.length,
      prizesTaken: state.prizesTaken[otherActor],
      mulligans: other.mulligans,
    },
  };
}
