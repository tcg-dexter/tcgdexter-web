// Choices that spend cards out of the player's OWN HAND.
//
// Three places resolved these with pickDiscards — the engine's "least useful
// card" heuristic — because there was no channel to carry a human's pick:
// a Stadium's activated effect, an attack RIDER's cost, and "discard down to
// N". Each now reads a player-supplied selection and falls back to the
// heuristic only for the AI (or for the opponent's own half of a symmetric
// trim, which is genuinely not ours to choose).
//
// The validator is the point of these tests as much as the behaviour: a
// selection is not part of the enumerated legal set, so if it isn't checked
// here a forged move discards cards the player never held.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck } from "./setup";
import { beginTurn, applyMove } from "./driver";
import { isLegalHumanMove } from "./validate";
import { applyStadium, stadiumHandCost, stadiumTopDecks } from "./stadiums";
import { mulberry32 } from "./rng";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import type { CardInstance, GameState } from "../types";

const card = (n: string): CardInstance => ({
  id: mintInstanceId("hc"),
  name: n,
  catalog: lookupCard(n),
});

const DECK = [
  "Pokémon: 12",
  "4 Pikachu SVI 62",
  "4 Charmander",
  "4 Charizard ex",
  "Trainer: 24",
  "12 Nest Ball SVI 181",
  "12 Switch",
  "Energy: 24",
  "24 Basic Fire Energy",
].join("\n");

function freshState(): GameState {
  const deck = instantiateDeck(DECK, "hc");
  const state = buildSimInitialState(deck, deck, mulberry32(4), "player");
  beginTurn(state, "player", 1);
  beginTurn(state, "opponent", 1);
  beginTurn(state, "player", 2);
  return state;
}

describe("Stadium effects that spend cards from hand", () => {
  it("Academy at Night top-decks the card the PLAYER chose", () => {
    const state = freshState();
    const me = state.sides.player;
    state.stadium = { card: card("Academy at Night"), owner: "player" };
    const keeper = me.hand[0];
    const giveUp = me.hand[1];
    expect(stadiumHandCost("Academy at Night", me.hand.length)).toBe(1);
    expect(stadiumTopDecks("Academy at Night")).toBe(true); // NOT a discard

    applyStadium(
      state,
      "player",
      { kind: "use_stadium", stadiumName: "Academy at Night", handCardIds: [giveUp.id] },
      mulberry32(1),
    );
    expect(me.deck[0].id).toBe(giveUp.id); // on TOP of the deck, not discarded
    expect(me.discard.some((c) => c.id === giveUp.id)).toBe(false);
    expect(me.hand.some((c) => c.id === keeper.id)).toBe(true);
    expect(me.hand.some((c) => c.id === giveUp.id)).toBe(false);
  });

  it("Prism Tower discards the two the player chose, then draws", () => {
    const state = freshState();
    const me = state.sides.player;
    state.stadium = { card: card("Prism Tower"), owner: "player" };
    const [a, b] = me.hand;
    const before = me.hand.length;
    expect(stadiumHandCost("Prism Tower", me.hand.length)).toBe(2);

    applyStadium(
      state,
      "player",
      { kind: "use_stadium", stadiumName: "Prism Tower", handCardIds: [a.id, b.id] },
      mulberry32(1),
    );
    expect(me.discard.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    expect(me.hand.length).toBe(before - 2 + 1); // -2 discarded, +1 drawn
  });

  it("rejects a hand selection the player doesn't hold, or the wrong count", () => {
    const state = freshState();
    const me = state.sides.player;
    state.stadium = { card: card("Prism Tower"), owner: "player" };
    const ctx = { retreated: false };
    const legal = (handCardIds: string[]) =>
      isLegalHumanMove(state, "player", ctx, {
        kind: "use_stadium",
        stadiumName: "Prism Tower",
        handCardIds,
      });

    const [a, b] = me.hand;
    expect(legal([a.id, b.id])).toBe(true);
    expect(legal([a.id])).toBe(false); // too few
    expect(legal([a.id, a.id])).toBe(false); // the same card twice
    expect(legal([a.id, "forged-id"])).toBe(false); // not in hand
  });
});

describe("discard-down-to trims OUR hand by our choice, theirs by theirs", () => {
  it("Hand Trimmer discards the cards we picked and leaves the rest", () => {
    const state = freshState();
    const me = state.sides.player;
    const opp = state.sides.opponent;
    const trimmer = card("Hand Trimmer");
    // A hand of 8 (+ the Trimmer) trims to 5 ⇒ 3 of OUR choosing.
    me.hand = [...me.deck.splice(0, 8), trimmer];
    opp.hand = [...opp.deck.splice(0, 8)];
    const doomed = me.hand.slice(0, 3);
    const keep = me.hand.slice(3, 8);

    applyMove(
      state,
      "player",
      {
        kind: "effect",
        sourceId: trimmer.id,
        card: "Hand Trimmer",
        effectIndex: 0,
        picks: [],
        discardCardIds: doomed.map((c) => c.id),
      },
      { retreated: false },
      mulberry32(1),
    );

    expect(me.hand.length).toBe(5);
    for (const c of doomed) expect(me.discard.some((d) => d.id === c.id)).toBe(true);
    for (const c of keep) expect(me.hand.some((h) => h.id === c.id)).toBe(true);
    // The opponent is trimmed too, but WE do not choose their cards.
    expect(opp.hand.length).toBe(5);
  });
});
