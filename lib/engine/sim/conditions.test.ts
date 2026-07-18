// Special conditions: checkup damage/flips, act-locks, clear-on-leave, and
// the attack-inflicted Confusion path.

import { describe, it, expect } from "vitest";
import { buildSimInitialState, instantiateDeck, toPokemonInPlay } from "./setup";
import { applyMove } from "./driver";
import { legalMoves } from "./moves";
import {
  applyCondition,
  cannotAct,
  clearConditions,
  hasCondition,
  runCheckup,
} from "./conditions";
import { lookupCard } from "../catalog";
import { mintInstanceId } from "../initial";
import { mulberry32 } from "./rng";
import type { CardInstance, GameState, PokemonInPlay } from "../types";

const card = (n: string): CardInstance => ({ id: mintInstanceId("t"), name: n, catalog: lookupCard(n) });
const mon = (n: string, turn = 0): PokemonInPlay => toPokemonInPlay(card(n), turn);

function state(): GameState {
  const deck = instantiateDeck(
    ["Pokémon: 4", "4 Pikachu SVI 62", "Energy: 56", "56 Basic Fire Energy"].join("\n"),
    "t",
  );
  const s = buildSimInitialState(deck, deck, mulberry32(1), "player");
  s.turn = { number: 4, playerTurnNumber: 2, actor: "opponent", phase: "turn" };
  return s;
}

describe("checkup", () => {
  it("Poison places 1 counter each checkup", () => {
    const s = state();
    const poisoned = mon("Snorlax");
    applyCondition(poisoned, "Poisoned");
    s.sides.player.active = poisoned;
    s.sides.opponent.active = mon("Snorlax");
    runCheckup(s, "opponent", mulberry32(1));
    expect(poisoned.damage).toBe(10);
    runCheckup(s, "player", mulberry32(1));
    expect(poisoned.damage).toBe(20);
    expect(hasCondition(poisoned, "Poisoned")).toBe(true); // persists
  });

  it("Burn always places 2 counters; the flip decides recovery", () => {
    // Heads (rng < 0.5) recovers; tails keeps the burn. Both take 20.
    for (const [flip, recovers] of [[() => 0.1, true], [() => 0.9, false]] as const) {
      const burned = mon("Snorlax");
      applyCondition(burned, "Burned");
      const s = state();
      s.sides.player.active = burned;
      runCheckup(s, "player", flip);
      expect(burned.damage).toBe(20);
      expect(hasCondition(burned, "Burned")).toBe(!recovers);
    }
  });

  it("Paralysis clears at the checkup after the paralyzed player's own turn", () => {
    const s = state();
    const par = mon("Snorlax");
    applyCondition(par, "Paralyzed");
    s.sides.player.active = par;
    // Not the player's turn-end checkup → stays.
    runCheckup(s, "opponent", mulberry32(1));
    expect(hasCondition(par, "Paralyzed")).toBe(true);
    // The player's own turn ended → clears.
    runCheckup(s, "player", mulberry32(1));
    expect(hasCondition(par, "Paralyzed")).toBe(false);
  });
});

describe("act locks", () => {
  it("Asleep/Paralyzed can neither attack nor retreat", () => {
    const s = state();
    const sleeper = mon("Pikachu");
    sleeper.attachedEnergy.push(card("Basic Lightning Energy"), card("Basic Lightning Energy"));
    applyCondition(sleeper, "Asleep");
    s.sides.player.active = sleeper;
    s.sides.player.bench = [mon("Snorlax")];
    s.sides.opponent.active = mon("Snorlax");
    s.turn = { number: 5, playerTurnNumber: 3, actor: "player", phase: "turn" };
    const moves = legalMoves(s, "player", { retreated: false });
    expect(moves.some((m) => m.kind === "attack")).toBe(false);
    expect(moves.some((m) => m.kind === "retreat")).toBe(false);
    expect(cannotAct(sleeper)).toBe(true);
  });
});

describe("clear on leave / attack-inflicted", () => {
  it("conditions clear when a Pokémon leaves the Active Spot", () => {
    const m = mon("Snorlax");
    applyCondition(m, "Poisoned");
    applyCondition(m, "Confused");
    expect(m.conditions.length).toBe(2);
    clearConditions(m);
    expect(m.conditions).toEqual([]);
  });

  it("Munkidori's Mind Bend confuses the defending active", () => {
    const s = state();
    s.turn = { number: 5, playerTurnNumber: 3, actor: "player", phase: "turn" };
    const munki = mon("Munkidori");
    munki.attachedEnergy.push(card("Basic Psychic Energy"), card("Basic Fire Energy"));
    s.sides.player.active = munki;
    const defender = mon("Snorlax");
    s.sides.opponent.active = defender;
    s.sides.opponent.bench = [mon("Pikachu")];
    const idx = munki.card.catalog!.attacks.findIndex((a) => a.name === "Mind Bend");
    applyMove(s, "player", { kind: "attack", attackIndex: idx }, { retreated: false }, mulberry32(2));
    expect(hasCondition(defender, "Confused")).toBe(true);
  });

  it("Asleep/Paralyzed/Confused replace one another; Poison coexists", () => {
    const m = mon("Snorlax");
    applyCondition(m, "Poisoned");
    applyCondition(m, "Asleep");
    applyCondition(m, "Paralyzed"); // replaces Asleep
    expect(hasCondition(m, "Asleep")).toBe(false);
    expect(hasCondition(m, "Paralyzed")).toBe(true);
    expect(hasCondition(m, "Poisoned")).toBe(true);
  });
});
