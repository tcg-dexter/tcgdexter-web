// Damage subsystem: the careful part. Verifies the rules distinction —
// attack damage to the active applies Weakness/Resistance, while bench
// damage and damage counters never do — plus bench-aware KO resolution
// with multi-prize awards, and the named attack effects.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "./setup";
import { applyMove } from "./driver";
import { placeCounters, moveCounters, isKnockedOut, resolveKnockouts, maxHp } from "./damage";
import { applyWeaknessResistance } from "./moves";
import { activeDamageBonus, projectedAttackDamage } from "./attacks";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState, PokemonInPlay } from "../types";

function card(name: string): CardInstance {
  return { id: mintInstanceId("t"), name, catalog: lookupCard(name) };
}
function mon(name: string, turn = 0): PokemonInPlay {
  return toPokemonInPlay(card(name), turn);
}

/** Minimal two-side state on turn 3, player to act. */
function blankState(): GameState {
  const deck = instantiateDeck(
    ["Pokémon: 4", "4 Pikachu SVI 62", "Energy: 56", "56 Basic Fire Energy"].join("\n"),
    "t",
  );
  const state = buildSimInitialState(deck, deck, mulberry32(1), "player");
  state.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  return state;
}

describe("flat damage bonuses to the Active (before W/R)", () => {
  it("Black Belt's Training adds 40 vs an Active ex, only the turn it's played", () => {
    const s = blankState();
    const attacker = mon("Pikachu");
    const defenderEx = mon("N's Zoroark ex"); // has the ex subtype
    const defenderPlain = mon("Snorlax");
    expect(activeDamageBonus(s, "player", attacker, defenderEx)).toBe(0);

    s.sides.player.blackBeltTrainingTurn = s.turn.number;
    expect(activeDamageBonus(s, "player", attacker, defenderEx)).toBe(40);
    // Not an ex ⇒ no bonus.
    expect(activeDamageBonus(s, "player", attacker, defenderPlain)).toBe(0);
    // A later turn ⇒ the buff has expired.
    s.turn.number += 1;
    expect(activeDamageBonus(s, "player", attacker, defenderEx)).toBe(0);
  });

  it("Binding Mochi adds 40 only while the attached attacker is Poisoned", () => {
    const s = blankState();
    const attacker = mon("Pikachu");
    const defender = mon("Snorlax");
    attacker.attachedTools = [card("Binding Mochi")];
    expect(activeDamageBonus(s, "player", attacker, defender)).toBe(0); // not poisoned
    attacker.conditions = ["Poisoned"];
    expect(activeDamageBonus(s, "player", attacker, defender)).toBe(40);
    // Poisoned but no Binding Mochi ⇒ no bonus.
    attacker.attachedTools = [];
    expect(activeDamageBonus(s, "player", attacker, defender)).toBe(0);
  });
});

describe("damage vs damage counters", () => {
  it("counters are 10 HP each and never apply weakness", () => {
    const hoot = mon("Hoothoot"); // Colorless, weak to Lightning
    placeCounters(hoot, 3);
    expect(hoot.damage).toBe(30);
    // The counter placement is flat regardless of any type interaction.
    placeCounters(hoot, 2);
    expect(hoot.damage).toBe(50);
  });

  it("weakness doubles, resistance subtracts 30 — active attacks only", () => {
    const pikachu = mon("Pikachu"); // Lightning attacker
    const hoot = mon("Hoothoot");
    const weak = hoot.card.catalog!.weaknesses.some((w) => w.type === "Lightning");
    expect(applyWeaknessResistance(30, pikachu, hoot)).toBe(weak ? 60 : 30);
  });

  it("moveCounters is bounded by what the source carries", () => {
    const a = mon("Snorlax");
    const b = mon("Pikachu");
    placeCounters(a, 2); // 20 damage = 2 counters
    expect(moveCounters(a, b, 3)).toBe(2); // only 2 available
    expect(a.damage).toBe(0);
    expect(b.damage).toBe(20);
  });
});

describe("bench-aware knockout resolution", () => {
  it("KOs a benched Pokémon and awards its prizes to the opponent", () => {
    const state = blankState();
    state.sides.player.active = mon("Snorlax");
    const target = mon("Pikachu"); // 70 HP, 1 prize
    state.sides.opponent.active = mon("Snorlax");
    state.sides.opponent.bench = [target, mon("Snorlax")];
    placeCounters(target, 7); // 70 = KO
    const before = state.prizesTaken.player;
    const result = resolveKnockouts(state);
    expect(state.sides.opponent.bench.some((m) => m.id === target.id)).toBe(false);
    expect(state.prizesTaken.player).toBe(before + 1);
    expect(result.pendingPromotions).toEqual([]); // bench KO ⇒ no promotion
  });

  it("multi-prize Pokémon award their full prize value", () => {
    const state = blankState();
    const ex = mon("Miraidon ex"); // ex ⇒ 2 prizes
    state.sides.opponent.active = ex;
    state.sides.opponent.bench = [mon("Pikachu")];
    placeCounters(ex, maxHp(ex) / 10);
    const result = resolveKnockouts(state);
    expect(state.prizesTaken.player).toBe(2);
    expect(result.pendingPromotions).toEqual(["opponent"]); // active fell, bench remains
  });

  it("declares a winner at 6 prizes", () => {
    const state = blankState();
    state.prizesTaken.player = 5;
    state.sides.player.prizes = state.sides.player.prizes.slice(0, 1);
    const ex = mon("Miraidon ex");
    state.sides.opponent.active = ex;
    placeCounters(ex, maxHp(ex) / 10);
    const result = resolveKnockouts(state);
    expect(result.winner).toBe("player");
    expect(result.endReason).toBe("prizes");
  });
});

describe("named attack effects", () => {
  function attackWith(attacker: string, defenderActive: string, bench: string[], attackName: string) {
    const state = blankState();
    const atk = mon(attacker);
    // Load the attacker with plenty of energy to satisfy any cost.
    for (let i = 0; i < 4; i++) atk.attachedEnergy.push(card("Basic Fire Energy"));
    state.sides.player.active = atk;
    state.sides.opponent.active = mon(defenderActive);
    state.sides.opponent.bench = bench.map((n) => mon(n));
    const idx = atk.card.catalog!.attacks.findIndex((a) => a.name === attackName);
    return { state, idx };
  }

  it("Phantom Dive places 6 counters on the opponent's bench", () => {
    const { state, idx } = attackWith("Dragapult ex", "Snorlax", ["Pikachu", "Snorlax"], "Phantom Dive");
    applyMove(state, "player", { kind: "attack", attackIndex: idx }, { retreated: false }, mulberry32(2));
    // 6 counters = 60 damage. Auto-allocation piles them on the low-HP
    // Pikachu (70) — 60 < 70, so it survives with 60 damage on it.
    const pika = state.sides.opponent.bench.find((m) => m.card.name === "Pikachu");
    expect(pika?.damage).toBe(60);
    const benchDamage = state.sides.opponent.bench.reduce((s, m) => s + m.damage, 0);
    expect(benchDamage).toBe(60); // all 6 counters landed on the bench
  });

  it("Phantom Dive honors a human bench-counter allocation", () => {
    const { state, idx } = attackWith("Dragapult ex", "Snorlax", ["Pikachu", "Snorlax"], "Phantom Dive");
    const [pika, snor] = state.sides.opponent.bench;
    // Split: 3 on each.
    const alloc = [pika.id, pika.id, pika.id, snor.id, snor.id, snor.id];
    applyMove(state, "player", { kind: "attack", attackIndex: idx, benchCounters: alloc }, { retreated: false }, mulberry32(2));
    expect(pika.damage).toBe(30);
    expect(snor.damage).toBe(30);
  });

  it("Flamebody Cannon discards the attacker's energy and hits the bench (no W/R)", () => {
    const { state, idx } = attackWith("N's Darmanitan", "Snorlax", ["Hoothoot"], "Flamebody Cannon");
    const benchMon = state.sides.opponent.bench[0];
    applyMove(state, "player", { kind: "attack", attackIndex: idx }, { retreated: false }, mulberry32(3));
    // 90 to the benched Hoothoot with no weakness doubling.
    expect(benchMon.damage).toBe(90);
    // Attacker discarded all its energy.
    expect(state.sides.player.active!.attachedEnergy.length).toBe(0);
  });

  it("Back Draft scales with basic energy in the opponent's discard", () => {
    const { state, idx } = attackWith("N's Darmanitan", "Snorlax", [], "Back Draft");
    for (let i = 0; i < 3; i++) state.sides.opponent.discard.push(card("Basic Fire Energy"));
    const target = state.sides.opponent.active!;
    applyMove(state, "player", { kind: "attack", attackIndex: idx }, { retreated: false }, mulberry32(4));
    expect(target.damage).toBe(90); // 30 × 3 basic energy
  });
});

// The number the UI puts on an attack row is the number the driver deals —
// because they are the same function. Before the extraction the driver had
// the pipeline inline and any label would have been a second implementation
// of scaling + Weakness + tools + reduction auras, free to drift.
describe("projected damage is what actually lands", () => {
  function attackSetup(attacker: string, defenderActive: string, attackName: string) {
    const state = blankState();
    const atk = mon(attacker);
    for (let i = 0; i < 4; i++) atk.attachedEnergy.push(card("Basic Fire Energy"));
    state.sides.player.active = atk;
    state.sides.opponent.active = mon(defenderActive);
    const idx = atk.card.catalog!.attacks.findIndex((a) => a.name === attackName);
    return { state, idx };
  }

  it.each([
    ["Snorlax", "Collapse", "Pikachu"],
    ["N's Darmanitan", "Flamebody Cannon", "N's Zoroark ex"],
  ])("%s's %s", (attacker, attackName, defenderName) => {
    const { state, idx } = attackSetup(attacker, defenderName, attackName);
    const projected = projectedAttackDamage(
      state,
      "player",
      state.sides.player.active!,
      state.sides.opponent.active!,
      idx,
    );
    expect(projected).toBeGreaterThan(0); // else the comparison is vacuous
    const defender = state.sides.opponent.active!;
    applyMove(state, "player", { kind: "attack", attackIndex: idx }, { retreated: false }, mulberry32(5));
    expect(defender.damage).toBe(projected);
  });

  it("reflects a damage bonus the printed number knows nothing about", () => {
    const { state, idx } = attackSetup("Snorlax", "N's Zoroark ex", "Collapse");
    const before = projectedAttackDamage(
      state, "player", state.sides.player.active!, state.sides.opponent.active!, idx,
    );
    state.sides.player.blackBeltTrainingTurn = state.turn.number; // +40 vs ex
    const after = projectedAttackDamage(
      state, "player", state.sides.player.active!, state.sides.opponent.active!, idx,
    );
    expect(after).toBeGreaterThan(before);
  });
});
