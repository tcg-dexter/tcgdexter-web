// The card picker's trust boundary.
//
// Enumeration is the wrong shape for a person choosing cards. It produces one
// move per COMBINATION, so Secret Box's four slots multiply into hundreds and
// MAX_EFFECT_MOVES truncates them — which meant the choice a player wanted was
// usually not on the menu, and the engine picked for them. The manifest
// (effectCardSlots) asks the card's question instead: here is every eligible
// card, take what the rule allows. cardPicksLegal is what makes that safe.

import { describe, it, expect } from "vitest";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "./setup";
import { beginTurn, applyMove } from "./driver";
import { legalMoves } from "./moves";
import { isLegalHumanMove } from "./validate";
import { cardPicksLegal, effectCardSlots, describeCardFilter } from "./effects/runtime";
import { effectsFor } from "./effects/cards";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState } from "../types";

const card = (n: string): CardInstance => ({ id: mintInstanceId("s"), name: n, catalog: lookupCard(n) });
const mon = (n: string) => toPokemonInPlay(card(n), 0);

/** A deck holding something for each of Secret Box's four slots. */
const BOX_DECK = [
  "Pokémon: 4",
  "4 Pikachu SVI 62",
  "Trainer: 19",
  "4 Secret Box TWM 163",
  "3 Nest Ball SVI 181",
  "3 Rare Candy SVI 191",
  "3 Vitality Band SVI 197",
  "3 Iono PAL 185",
  "3 Artazon PAL 171",
  "Energy: 37",
  "37 Basic Fire Energy",
].join("\n");

function boxState(): { state: GameState; boxId: string } {
  const deck = instantiateDeck(BOX_DECK, "s");
  const state = buildSimInitialState(deck, deck, mulberry32(11), "player");
  beginTurn(state, "player", 1);
  const me = state.sides.player;
  me.active = mon("Pikachu");
  state.sides.opponent.active = mon("Pikachu");
  // Guarantee the card and a payable cost in hand.
  const box = card("Secret Box");
  me.hand.push(box, card("Basic Fire Energy"), card("Basic Fire Energy"), card("Basic Fire Energy"));
  return { state, boxId: box.id };
}

const boxEffect = () => effectsFor("Secret Box")[0];

describe("Secret Box — the player picks, from everything eligible", () => {
  it("offers one slot per search, with every eligible card in it", () => {
    const { state } = boxState();
    const slots = effectCardSlots(state, "player", boxEffect());
    expect(slots).toHaveLength(4);
    for (const slot of slots) {
      expect(slot.options.length).toBeGreaterThan(0);
      expect(slot.count).toBe(1);
      // Every option is really in the deck and really matches the slot.
      for (const o of slot.options) {
        expect(o.ids.length).toBeGreaterThan(0);
        for (const id of o.ids) expect(state.sides.player.deck.some((c) => c.id === id)).toBe(true);
      }
    }
    // The slots read as the card's own words rather than a list of outcomes.
    expect(slots.map((s) => s.label)).toEqual([
      "an Item",
      "a Pokémon Tool",
      "a Supporter",
      "a Stadium",
    ]);
  });

  it("accepts a hand-picked combination the enumeration never offered", () => {
    const { state, boxId } = boxState();
    const slots = effectCardSlots(state, "player", boxEffect());
    // Deliberately take the LAST option of each slot; enumeration ranks and
    // truncates, so this is exactly the sort of choice it used to drop.
    const picks = slots.map((s) => ({
      ref: s.ref,
      cardIds: [s.options[s.options.length - 1].ids[0]],
    }));
    expect(cardPicksLegal(state, "player", boxEffect(), picks)).toBe(true);

    const hand = state.sides.player.hand.filter((c) => c.id !== boxId).slice(0, 3);
    const move = {
      kind: "effect" as const,
      sourceId: boxId,
      card: "Secret Box",
      effectIndex: 0,
      picks,
      discardCardIds: hand.map((c) => c.id),
    };
    expect(isLegalHumanMove(state, "player", { retreated: false }, move)).toBe(true);

    applyMove(state, "player", move, { retreated: false }, mulberry32(2));
    // All four chosen cards are now in hand, and none of them is still in the deck.
    for (const p of picks) {
      const id = p.cardIds[0];
      expect(state.sides.player.hand.some((c) => c.id === id)).toBe(true);
      expect(state.sides.player.deck.some((c) => c.id === id)).toBe(false);
    }
  });

  it("rejects a card that doesn't satisfy the slot it was put in", () => {
    const { state, boxId } = boxState();
    const slots = effectCardSlots(state, "player", boxEffect());
    // The Supporter, offered for the Item slot.
    const supporter = slots[2].options[0].ids[0];
    const picks = slots.map((s, i) => ({
      ref: s.ref,
      cardIds: [i === 0 ? supporter : s.options[0].ids[0]],
    }));
    expect(cardPicksLegal(state, "player", boxEffect(), picks)).toBe(false);
    expect(
      isLegalHumanMove(state, "player", { retreated: false }, {
        kind: "effect",
        sourceId: boxId,
        card: "Secret Box",
        effectIndex: 0,
        picks,
        discardCardIds: state.sides.player.hand.filter((c) => c.id !== boxId).slice(0, 3).map((c) => c.id),
      }),
    ).toBe(false);
  });

  it("rejects a card that is not in the deck at all, and over-taking a slot", () => {
    const { state } = boxState();
    const effect = boxEffect();
    const slots = effectCardSlots(state, "player", effect);
    const base = slots.map((s) => ({ ref: s.ref, cardIds: [s.options[0].ids[0]] }));
    const forged = base.map((p, i) => (i === 0 ? { ...p, cardIds: ["not-a-real-id"] } : p));
    expect(cardPicksLegal(state, "player", effect, forged)).toBe(false);
    // Two cards into a one-card slot.
    const greedy = base.map((p, i) =>
      i === 0 && slots[0].options.length > 1
        ? { ...p, cardIds: [slots[0].options[0].ids[0], slots[0].options[1].ids[0]] }
        : p,
    );
    expect(cardPicksLegal(state, "player", effect, greedy)).toBe(false);
    // Leaving a slot EMPTY is legal here, and deliberately so: every Secret
    // Box slot is `upTo`, because "search your deck for..." may legally fail
    // to find (and a deck can simply hold no Stadium). The picker says
    // "optional" rather than pretending otherwise.
    expect(cardPicksLegal(state, "player", effect, base.slice(1))).toBe(true);
  });

  it("never lets one physical card fill two slots", () => {
    const { state } = boxState();
    const effect = boxEffect();
    const slots = effectCardSlots(state, "player", effect);
    const one = slots[0].options[0].ids[0];
    const picks = slots.map((s) => ({ ref: s.ref, cardIds: [one] }));
    expect(cardPicksLegal(state, "player", effect, picks)).toBe(false);
  });

  it("the AI still gets exactly one auto-picked move per copy", () => {
    const { state, boxId } = boxState();
    // Scoped to ONE copy: an opening hand may hold another, and each is its
    // own source card.
    const narrow = legalMoves(state, "player", { retreated: false }).filter(
      (m) => m.kind === "effect" && m.card === "Secret Box" && m.sourceId === boxId,
    );
    expect(narrow.length).toBe(1);
    // ...and it fills every slot it can, rather than shrugging.
    const picked = narrow[0].kind === "effect" ? narrow[0].picks : [];
    expect(picked.flatMap((p) => p.cardIds ?? []).length).toBeGreaterThan(0);
  });
});

describe("slot labels read as the card's rule", () => {
  it.each([
    [{ supertype: "Trainer" as const, subtype: "Item" }, "an Item"],
    [{ supertype: "Pokémon" as const, basicPokemon: true }, "a Basic Pokémon"],
    [{ basicEnergy: true, energyType: "Darkness" }, "a Basic Darkness"],
    [{ supertype: "Pokémon" as const, namePrefix: "N's " }, "a N's Pokémon"],
  ])("%o → %s", (filter, expected) => {
    expect(describeCardFilter(filter)).toBe(expected);
  });
});
