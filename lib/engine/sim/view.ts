// PlayerView — the information-set boundary for the AI player.
//
// At any point a player knows: their own hand, both boards (public), both
// discard piles (public), and COUNTS of everything hidden (opponent hand,
// both decks, prize cards). Policies consume a PlayerView, never the raw
// GameState, so a policy structurally cannot peek at the opponent's hand
// or either deck's order. The no-leak test in planner.test.ts pins this.
//
// Views hold references into the live state (cheap, policies are internal
// code) — the discipline is the interface shape, not defensive copying.
// The API layer serializes views separately (serialize.ts) for clients.

import type { CardInstance, GameState, PokemonInPlay, TurnState } from "../types";

export interface OpponentView {
  board: { active: PokemonInPlay | null; bench: PokemonInPlay[] };
  /** Discards are public knowledge. */
  discard: CardInstance[];
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
  deckCount: number;
  prizeCount: number;
  prizesTaken: number;
  mulligans: number;
  energyAttachedThisTurn: number;
  supporterPlayedThisTurn: boolean;
  /** Stadium in play (public), with which side owns it. */
  stadium: { name: string; owner: "player" | "opponent" } | null;
  opponent: OpponentView;
}

export function viewFor(state: GameState, actor: "player" | "opponent"): PlayerView {
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
    deckCount: self.deck.length,
    prizeCount: self.prizes.length,
    prizesTaken: state.prizesTaken[actor],
    mulligans: self.mulligans,
    energyAttachedThisTurn: self.energyAttachedThisTurn,
    supporterPlayedThisTurn: self.supporterPlayedThisTurn,
    stadium: state.stadium
      ? { name: state.stadium.card.name, owner: state.stadium.owner }
      : null,
    opponent: {
      board: { active: other.active, bench: other.bench },
      discard: other.discard,
      handCount: other.hand.length,
      deckCount: other.deck.length,
      prizeCount: other.prizes.length,
      prizesTaken: state.prizesTaken[otherActor],
      mulligans: other.mulligans,
    },
  };
}
