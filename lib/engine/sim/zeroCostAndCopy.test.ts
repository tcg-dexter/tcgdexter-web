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

// A copied attack brings its WHOLE text along, not just its printed number.
// N's Zoroark ex copying N's Darmanitan's Flamebody Cannon has to discard N's
// Zoroark's own Energy ("this Pokémon" is the copier) and hit the opponent's
// Bench for 90 — and the Bench target is the player's to choose, on both the
// direct and the copied path.
describe("Flamebody Cannon — the Bench hit and the Energy cost", () => {
  /** Darmanitan Active (or benched, for the copy) with two Pokémon to aim at:
   *  a fat one the auto-picker prefers, and a small one it wouldn't touch. */
  function cannonState(copier: boolean): GameState {
    const deck = instantiateDeck(
      [
        "Pokémon: 12",
        "4 N's Darumaka",
        "4 N's Darmanitan",
        "4 N's Zoroark ex",
        "Trainer: 8",
        "8 Nest Ball SVI 181",
        "Energy: 40",
        "40 Basic Fire Energy",
      ].join("\n"),
      "f",
    );
    const state = buildSimInitialState(deck, deck, mulberry32(7), "player");
    beginTurn(state, "player", 1);
    beginTurn(state, "opponent", 1);
    beginTurn(state, "player", 2);
    const me = state.sides.player;
    me.active = mon(copier ? "N's Zoroark ex" : "N's Darmanitan");
    // Whatever the attacker's own attack costs — Night Joker is Darkness,
    // Flamebody Cannon is Fire — has to be payable, or there is no legal
    // attack for the validator to compare against.
    const fuel = copier ? "Basic Darkness Energy" : "Basic Fire Energy";
    for (let i = 0; i < 3; i++) me.active.attachedEnergy.push(card(fuel));
    if (copier) me.bench = [mon("N's Darmanitan")];
    state.sides.opponent.active = mon("N's Zoroark ex"); // 280 HP, survives
    // Snorlax (90 HP) is what the auto-picker takes: 90 damage KOs it.
    state.sides.opponent.bench = [mon("Snorlax"), mon("N's Zoroark ex")];
    return state;
  }

  const cannonIndex = () =>
    lookupCard("N's Darmanitan")!.attacks.findIndex((a) => a.name === "Flamebody Cannon");

  it("aims at the Pokémon the player chose, not the one the AI would take", () => {
    const state = cannonState(false);
    const attackIndex = cannonIndex();
    const [snorlax, zoroark] = state.sides.opponent.bench;
    // The auto-picker prefers Snorlax (90 damage KOs it), so choosing the
    // Zoroark is a result the fallback could not have produced.
    applyMove(
      state,
      "player",
      { kind: "attack", attackIndex, benchDamageTargets: [zoroark.id] },
      { retreated: false },
      mulberry32(1),
    );
    expect(zoroark.damage).toBe(90);
    expect(snorlax.damage).toBe(0);
    expect(state.sides.player.active!.attachedEnergy).toHaveLength(0);
  });

  it("still auto-aims when nobody chose (the AI path is unchanged)", () => {
    const state = cannonState(false);
    applyMove(
      state,
      "player",
      { kind: "attack", attackIndex: cannonIndex() },
      { retreated: false },
      mulberry32(1),
    );
    const hit = state.sides.opponent.bench.filter((m) => m.damage > 0);
    expect(hit).toHaveLength(1);
  });

  it("copying it discards the COPIER's Energy and hits the Bench", () => {
    const state = cannonState(true);
    const attacker = state.sides.player.active!;
    const attackIndex = attacker.card.catalog!.attacks.findIndex((a) => a.name === "Night Joker");
    const pick = copyChoices(state, "player", attacker, "Night Joker").find(
      (c) => c.attackName === "Flamebody Cannon",
    )!;
    expect(pick).toBeTruthy();
    const [, zoroark] = state.sides.opponent.bench;
    applyMove(
      state,
      "player",
      { kind: "attack", attackIndex, copyPick: pick, benchDamageTargets: [zoroark.id] },
      { retreated: false },
      mulberry32(1),
    );
    // Printed 90 to the Active, 90 to the chosen Bench Pokémon.
    expect(state.sides.opponent.active!.damage).toBe(90);
    expect(zoroark.damage).toBe(90);
    // "This Pokémon" is N's Zoroark, the copier — not the donor Darmanitan.
    expect(attacker.attachedEnergy).toHaveLength(0);
    expect(state.sides.player.bench[0].attachedEnergy).toHaveLength(0);
    expect(state.sides.player.discard.filter((c) => c.name.includes("Energy"))).toHaveLength(3);
  });

  it("validates the Bench target against the COPIED attack's budget", () => {
    const state = cannonState(true);
    const attacker = state.sides.player.active!;
    const attackIndex = attacker.card.catalog!.attacks.findIndex((a) => a.name === "Night Joker");
    const copyPick = copyChoices(state, "player", attacker, "Night Joker").find(
      (c) => c.attackName === "Flamebody Cannon",
    )!;
    const ctx = { retreated: false };
    const bench = state.sides.opponent.bench;
    // Night Joker itself places nothing; the budget comes from the copy.
    expect(
      isLegalHumanMove(state, "player", ctx, {
        kind: "attack",
        attackIndex,
        copyPick,
        benchDamageTargets: [bench[0].id],
      }),
    ).toBe(true);
    // One target is all the copied attack allows, and it must be on the bench.
    expect(
      isLegalHumanMove(state, "player", ctx, {
        kind: "attack",
        attackIndex,
        copyPick,
        benchDamageTargets: [bench[0].id, bench[1].id],
      }),
    ).toBe(false);
    expect(
      isLegalHumanMove(state, "player", ctx, {
        kind: "attack",
        attackIndex,
        copyPick,
        benchDamageTargets: [state.sides.opponent.active!.id],
      }),
    ).toBe(false);
  });
});
