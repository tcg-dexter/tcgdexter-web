// Two things the engine was deciding, or refusing, on the player's behalf.
//
// 1. Attacks that cost no Energy. The card data spells this two ways — an
//    empty cost array, and the single token "Free" — and the cost solver
//    read every token as a typed Energy requirement. "Free" therefore asked
//    for an Energy type nothing provides, so the attack could NEVER be used.
//    It hits exactly two standard-legal cards, and both exist to attack for
//    nothing on turn one: Budew's Itchy Pollen (the Item lock) and Tyrogue's
//    Pow-Pow Punching.
//
// 2. Copy-an-attack (N's Zoroark ex's Night Joker). "Choose 1 of your
//    Benched Pokémon and use one of its attacks" is TWO choices, and the
//    engine made both — taking the best damage-per-turn pair. Correct for
//    the AI, wrong for a person: Shred (70, no drawback) and Rampaging
//    Thunder (250, locks you out next turn) are a real decision.

import { describe, it, expect } from "vitest";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "./setup";
import { beginTurn, applyMove } from "./driver";
import { legalMoves, usableAttacks, copyChoices } from "./moves";
import { isLegalHumanMove } from "./validate";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState } from "../types";

const card = (n: string): CardInstance => ({
  id: mintInstanceId("z"),
  name: n,
  catalog: lookupCard(n),
});
const mon = (n: string) => toPokemonInPlay(card(n), 0);

describe("attacks that cost no Energy", () => {
  it.each(["Budew", "Smoochum", "Tyrogue"])(
    "%s can attack with nothing attached",
    (name) => {
      const m = mon(name);
      expect(m.attachedEnergy).toHaveLength(0);
      expect(usableAttacks(m).length).toBeGreaterThan(0);
    },
  );

  it('normalizes the "Free" cost token away at the catalog boundary', () => {
    // Fixing it here rather than in the cost solver means legality, the
    // planner's damage estimates, retreat math and the UI's cost pips all
    // see the same shape.
    for (const name of ["Budew", "Tyrogue"]) {
      const attacks = lookupCard(name)?.attacks ?? [];
      expect(attacks.length).toBeGreaterThan(0);
      for (const a of attacks) expect(a.cost).not.toContain("Free");
    }
  });

  it("still requires Energy for an attack that costs some", () => {
    // The guard that says the fix isn't just "everything is free now".
    expect(usableAttacks(mon("Pikachu"))).toHaveLength(0);
  });
});

const ZOROARK_DECK = [
  "Pokémon: 12",
  "4 N's Zorua",
  "4 N's Zoroark ex",
  "4 N's Zekrom",
  "Trainer: 8",
  "8 Nest Ball SVI 181",
  "Energy: 40",
  "40 Basic Darkness Energy",
].join("\n");

/** Zoroark Active with a Zekrom benched — the Night Joker decision. */
function nightJokerState(): GameState {
  const deck = instantiateDeck(ZOROARK_DECK, "z");
  const state = buildSimInitialState(deck, deck, mulberry32(3), "player");
  beginTurn(state, "player", 1);
  beginTurn(state, "opponent", 1);
  beginTurn(state, "player", 2);
  const me = state.sides.player;
  me.active = mon("N's Zoroark ex");
  // Night Joker's own cost still has to be payable.
  for (let i = 0; i < 3; i++) me.active.attachedEnergy.push(card("Basic Darkness Energy"));
  me.bench = [mon("N's Zekrom")];
  // A 280 HP defender, so even the big copy doesn't KO and remove the
  // Pokémon whose damage this test reads.
  state.sides.opponent.active = mon("N's Zoroark ex");
  return state;
}

describe("Night Joker — which attack to copy is the player's", () => {
  it("offers every attack on every legal donor", () => {
    const state = nightJokerState();
    const attacker = state.sides.player.active!;
    const choices = copyChoices(state, "player", attacker, "Night Joker");
    const zekrom = lookupCard("N's Zekrom")!;
    expect(choices.length).toBe(zekrom.attacks.length);
    // Both of Zekrom's attacks, named — the whole point is that the player
    // can tell them apart in the picker.
    expect(choices.map((c) => c.attackName).sort()).toEqual(
      zekrom.attacks.map((a) => a.name).sort(),
    );
    expect(choices.every((c) => c.monName === "N's Zekrom")).toBe(true);
  });

  it("enumerates one attack move per copy option FOR THE HUMAN", () => {
    const state = nightJokerState();
    const expanded = legalMoves(state, "player", { retreated: false }, true).filter(
      (m) => m.kind === "attack" && m.copyPick != null,
    );
    expect(expanded.length).toBeGreaterThan(1);
  });

  it("keeps ONE move for the AI, whose tempo ranking is tuned", () => {
    const state = nightJokerState();
    const narrow = legalMoves(state, "player", { retreated: false }).filter(
      (m) => m.kind === "attack",
    );
    expect(narrow.every((m) => m.kind === "attack" && m.copyPick == null)).toBe(true);
  });

  it("copies the attack the player chose, not the hardest-hitting one", () => {
    const state = nightJokerState();
    const attacker = state.sides.player.active!;
    const choices = copyChoices(state, "player", attacker, "Night Joker");
    const dmgOf = (i: number) =>
      parseInt(lookupCard("N's Zekrom")!.attacks[i].damage, 10) || 0;
    // Deliberately take the WEAKEST option; if the pick were ignored the
    // engine would fall back to bestCopy and deal more.
    const weakest = [...choices].sort((a, b) => dmgOf(a.attackIndex) - dmgOf(b.attackIndex))[0];
    const strongest = [...choices].sort((a, b) => dmgOf(b.attackIndex) - dmgOf(a.attackIndex))[0];
    expect(dmgOf(weakest.attackIndex)).toBeLessThan(dmgOf(strongest.attackIndex));

    const attackIndex = attacker.card.catalog!.attacks.findIndex((a) => a.name === "Night Joker");
    applyMove(
      state,
      "player",
      { kind: "attack", attackIndex, copyPick: weakest },
      { retreated: false },
      mulberry32(1),
    );
    expect(state.sides.opponent.active!.damage).toBe(dmgOf(weakest.attackIndex));
  });

  it("rejects a copy of an attack that was never on offer", () => {
    const state = nightJokerState();
    const attacker = state.sides.player.active!;
    const attackIndex = attacker.card.catalog!.attacks.findIndex((a) => a.name === "Night Joker");
    const ctx = { retreated: false };
    const legal = (copyPick: { monId: string; attackIndex: number }) =>
      isLegalHumanMove(state, "player", ctx, { kind: "attack", attackIndex, copyPick });

    const real = copyChoices(state, "player", attacker, "Night Joker")[0];
    expect(legal(real)).toBe(true);
    // A Pokémon that isn't on our bench at all.
    expect(legal({ monId: "forged-id", attackIndex: 0 })).toBe(false);
    // A real donor, but an attack index it doesn't have.
    expect(legal({ monId: real.monId, attackIndex: 99 })).toBe(false);
  });
});
