// Staple trainer effects (Milestone D): each registered card resolves per
// its printed rules — searches, hand refreshes, gust, candy — with the
// supporter-per-turn gate and evolution locks enforced.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck } from "./setup";
import { beginTurn, applyMove } from "./driver";
import { legalMoves, type SimMove, type TurnContext } from "./moves";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState, PlayerSide } from "../types";
import type { PlayTrainerMove } from "./trainers";

// Set-code-less lines resolve by name via the catalog (parse pass 2).
const STAPLE_DECK = [
  "Pokémon: 14",
  "4 Pikachu SVI 62",
  "4 Charmander",
  "3 Charmeleon",
  "3 Charizard ex",
  "Trainer: 26",
  "3 Nest Ball SVI 181",
  "3 Ultra Ball SVI 196",
  "3 Rare Candy",
  "3 Switch",
  "3 Boss's Orders",
  "3 Iono",
  "3 Professor's Research",
  "3 Lillie's Determination",
  "2 Night Stretcher",
  "Energy: 20",
  "12 Basic Fire Energy",
  "8 Basic Lightning Energy",
].join("\n");

/** Fresh mid-game state on the acting player's turn 3. */
function freshState(): GameState {
  const deck = instantiateDeck(STAPLE_DECK, "t");
  const state = buildSimInitialState(deck, deck, mulberry32(9), "player");
  beginTurn(state, "player", 1);
  beginTurn(state, "opponent", 1);
  beginTurn(state, "player", 2);
  return state;
}

/** Pull a named card from the deck into the hand (test setup shortcut). */
function grab(side: PlayerSide, name: string): CardInstance {
  const idx = side.deck.findIndex((c) => c.name === name);
  if (idx < 0) throw new Error(`no ${name} left in deck`);
  const [card] = side.deck.splice(idx, 1);
  side.hand.push(card);
  return card;
}

function trainerOptions(state: GameState, cardId: string): PlayTrainerMove[] {
  const ctx: TurnContext = { retreated: false };
  return legalMoves(state, "player", ctx).filter(
    (m): m is PlayTrainerMove => m.kind === "play_trainer" && m.cardId === cardId,
  );
}

function apply(state: GameState, move: SimMove): void {
  applyMove(state, "player", move, { retreated: false }, mulberry32(1));
}

/** Ensure a side has at least one benched Pokémon (bench a Pikachu). */
function ensureBench(state: GameState, side: PlayerSide, actor: "player" | "opponent"): void {
  if (side.bench.length > 0) return;
  const pika = grab(side, "Pikachu");
  applyMove(state, actor, { kind: "bench", cardId: pika.id }, { retreated: false });
}

describe("staple trainer effects", () => {
  it("Nest Ball benches a Basic from the deck", () => {
    const state = freshState();
    const side = state.sides.player;
    const ball = grab(side, "Nest Ball");
    const benchBefore = side.bench.length;
    const deckBefore = side.deck.length;
    const options = trainerOptions(state, ball.id);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((m) => m.deckCardNames?.length === 1)).toBe(true);
    apply(state, options[0]);
    expect(side.bench.length).toBe(benchBefore + 1);
    expect(side.deck.length).toBe(deckBefore - 1);
    expect(side.discard.some((c) => c.id === ball.id)).toBe(true);
  });

  it("Ultra Ball discards 2 and fetches any Pokémon to hand", () => {
    const state = freshState();
    const side = state.sides.player;
    const ball = grab(side, "Ultra Ball");
    const options = trainerOptions(state, ball.id);
    const zard = options.find((m) => m.deckCardNames?.[0] === "Charizard ex");
    expect(zard).toBeDefined();
    const handBefore = side.hand.length;
    apply(state, zard!);
    // -1 played, -2 discarded, +1 fetched
    expect(side.hand.length).toBe(handBefore - 2);
    expect(side.hand.some((c) => c.name === "Charizard ex")).toBe(true);
    expect(side.discard.length).toBeGreaterThanOrEqual(3);
  });

  it("Boss's Orders gusts the chosen bench target and spends the supporter", () => {
    const state = freshState();
    const side = state.sides.player;
    const opp = state.sides.opponent;
    ensureBench(state, opp, "opponent");
    const boss = grab(side, "Boss's Orders");
    const target = opp.bench[0];
    const oldActive = opp.active!;
    const options = trainerOptions(state, boss.id);
    apply(state, options.find((m) => m.oppBenchIndex === 0)!);
    expect(opp.active!.id).toBe(target.id);
    expect(opp.bench[0].id).toBe(oldActive.id);
    expect(side.supporterPlayedThisTurn).toBe(true);
    // Second supporter this turn is gated off.
    const iono = grab(side, "Iono");
    expect(trainerOptions(state, iono.id)).toHaveLength(0);
  });

  it("Rare Candy jumps a Basic straight to Stage 2, honoring the locks", () => {
    const state = freshState();
    const side = state.sides.player;
    const candy = grab(side, "Rare Candy");
    grab(side, "Charizard ex");
    // A Charmander that entered play THIS turn is not a legal target…
    const charmander = grab(side, "Charmander");
    const benchMove = legalMoves(state, "player", { retreated: false }).find(
      (m) => m.kind === "bench" && m.cardId === charmander.id,
    );
    apply(state, benchMove!);
    expect(trainerOptions(state, candy.id)).toHaveLength(0);
    // …but after it has sat a turn, the candy line lights up.
    const mon = side.bench[side.bench.length - 1];
    mon.enteredPlayOnTurn = state.turn.number - 1;
    const options = trainerOptions(state, candy.id);
    expect(options.length).toBeGreaterThan(0);
    apply(state, options.find((m) => m.monId === mon.id)!);
    expect(mon.card.name).toBe("Charizard ex");
    expect(mon.stack.map((c) => c.name)).toContain("Charmander");
    expect(mon.evolvedThisTurn).toBe(true);
  });

  it("Iono sends hands to the bottom and draws prizes-remaining each", () => {
    const state = freshState();
    const side = state.sides.player;
    const opp = state.sides.opponent;
    const iono = grab(side, "Iono");
    apply(state, trainerOptions(state, iono.id)[0]);
    expect(side.hand.length).toBe(side.prizes.length);
    expect(opp.hand.length).toBe(opp.prizes.length);
    expect(side.supporterPlayedThisTurn).toBe(true);
  });

  it("Professor's Research discards the hand and draws 7", () => {
    const state = freshState();
    const side = state.sides.player;
    const prof = grab(side, "Professor's Research");
    const discarded = side.hand.length - 1; // everything except the card itself
    apply(state, trainerOptions(state, prof.id)[0]);
    expect(side.hand.length).toBe(7);
    expect(side.discard.length).toBe(discarded + 1);
  });

  it("Lillie's Determination draws 8 at exactly 6 prizes, else 6", () => {
    for (const [prizes, expected] of [
      [6, 8],
      [5, 6],
    ] as const) {
      const state = freshState();
      const side = state.sides.player;
      side.prizes = side.prizes.slice(0, prizes);
      const lillie = grab(side, "Lillie's Determination");
      apply(state, trainerOptions(state, lillie.id)[0]);
      expect(side.hand.length).toBe(expected);
    }
  });

  it("Switch swaps the active for free", () => {
    const state = freshState();
    const side = state.sides.player;
    ensureBench(state, side, "player");
    const sw = grab(side, "Switch");
    const oldActive = side.active!;
    const target = side.bench[0];
    const energyBefore = oldActive.attachedEnergy.length;
    apply(state, trainerOptions(state, sw.id).find((m) => m.benchIndex === 0)!);
    expect(side.active!.id).toBe(target.id);
    expect(side.bench[0].id).toBe(oldActive.id);
    expect(oldActive.attachedEnergy.length).toBe(energyBefore); // no cost
  });

  it("Night Stretcher recovers a Pokémon or basic energy from the discard", () => {
    const state = freshState();
    const side = state.sides.player;
    const stretcher = grab(side, "Night Stretcher");
    // Nothing eligible in discard → no legal plays.
    side.discard = [];
    expect(trainerOptions(state, stretcher.id)).toHaveLength(0);
    const energy = grab(side, "Basic Fire Energy");
    side.hand.splice(side.hand.indexOf(energy), 1);
    side.discard.push(energy);
    const options = trainerOptions(state, stretcher.id);
    expect(options).toHaveLength(1);
    apply(state, options[0]);
    expect(side.hand.some((c) => c.id === energy.id)).toBe(true);
    expect(side.discard.some((c) => c.id === energy.id)).toBe(false);
  });

  it("unregistered trainers keep the generic cycle behavior", () => {
    const state = freshState();
    const side = state.sides.player;
    // Fabricate an unregistered item in hand.
    const fake: CardInstance = {
      id: "t_fake",
      name: "Some Future Gadget",
      catalog: {
        name: "Some Future Gadget",
        set_id: "x", number: "1",
        supertype: "Trainer", subtypes: ["Item"], types: [],
        hp: null, retreat_cost: 0, evolves_from: null,
        weaknesses: [], resistances: [], attacks: [], abilities: [],
        rules: [], hasStandardVariant: false,
      },
    };
    side.hand.push(fake);
    const moves = legalMoves(state, "player", { retreated: false });
    expect(moves.some((m) => m.kind === "cycle_item" && m.cardId === fake.id)).toBe(true);
    expect(moves.some((m) => m.kind === "play_trainer" && m.cardId === fake.id)).toBe(false);
  });
});
