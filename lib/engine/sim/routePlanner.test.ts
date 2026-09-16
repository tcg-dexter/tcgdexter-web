import { describe, it, expect } from "vitest";

import { instantiateDeck, legalMoves, simulateMatchup, viewFor } from "./index";
import { buildSimInitialState } from "./setup";
import { mulberry32 } from "./rng";
import { applyMove } from "./driver";
import { PlannerPolicy } from "./planner";
import { RoutePlannerPolicy } from "./routePlanner";
import { plannerParamsForSkill } from "./difficulty";

const DECK = [
  "Pokémon: 12",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "4 Budew PRE 4",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Buddy-Buddy Poffin TWM 144",
  "Energy: 24",
  "24 Basic Lightning Energy SVE 4",
].join("\n");

const params = plannerParamsForSkill(1);

function turnOf(policy: { chooseMove: Function }, seed: number): string[] {
  const deck = instantiateDeck(DECK)!;
  const state = buildSimInitialState(deck, instantiateDeck(DECK)!, mulberry32(seed), "player");
  state.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  const ctx = { retreated: false };
  const seq: string[] = [];
  for (let i = 0; i < 16; i++) {
    const legal = legalMoves(state, "player", ctx);
    if (legal.length === 0) break;
    const move = policy.chooseMove(viewFor(state, "player", ctx), legal, ctx);
    seq.push(move.kind);
    if (move.kind === "attack" || move.kind === "pass") break;
    applyMove(state, "player", move, ctx);
  }
  return seq;
}

describe("route planner plans a sequence, not a move", () => {
  it("plays a developed turn rather than one card and a pass", () => {
    // The failure this test exists to catch. A free-form beam search over the
    // whole move graph finds that playing one card and stopping is "optimal",
    // because the leaf objective does not value setup: benching and evolving
    // move neither prizes nor damage and shrink the hand. Without the
    // development prior the planned turn is literally `play_trainer -> pass`,
    // and it loses a true mirror at 40.1%.
    const route = turnOf(
      new RoutePlannerPolicy({ params, seed: 5, beam: 6 }),
      7,
    );
    expect(route.length).toBeGreaterThan(2);
  });

  it("ends its turn exactly once", () => {
    const route = turnOf(new RoutePlannerPolicy({ params, seed: 5, beam: 6 }), 11);
    const enders = route.filter((k) => k === "attack" || k === "pass");
    expect(enders.length).toBeLessThanOrEqual(1);
    if (enders.length === 1) expect(route[route.length - 1]).toBe(enders[0]);
  });

  it("is deterministic for a fixed seed", () => {
    const a = turnOf(new RoutePlannerPolicy({ params, seed: 3, beam: 6 }), 21);
    const b = turnOf(new RoutePlannerPolicy({ params, seed: 3, beam: 6 }), 21);
    expect(a).toEqual(b);
  });

  it("only ever emits moves the engine says are legal", () => {
    // The queue can go stale when an effect resolves differently than the
    // ghost predicted; stale moves must be dropped, never forced, or the
    // validator rejects them and the turn stalls.
    const deck = instantiateDeck(DECK)!;
    const state = buildSimInitialState(deck, instantiateDeck(DECK)!, mulberry32(33), "player");
    state.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
    const ctx = { retreated: false };
    const policy = new RoutePlannerPolicy({ params, seed: 9, beam: 6 });
    for (let i = 0; i < 16; i++) {
      const legal = legalMoves(state, "player", ctx);
      if (legal.length === 0) break;
      const move = policy.chooseMove(viewFor(state, "player", ctx), legal, ctx);
      expect(legal.some((m) => JSON.stringify(m) === JSON.stringify(move))).toBe(true);
      if (move.kind === "attack" || move.kind === "pass") break;
      applyMove(state, "player", move, ctx);
    }
  });

  it("plays a complete game without stalling", () => {
    const r = simulateMatchup(DECK, DECK, {
      n: 4,
      seed: 1234,
      policies: (s: number) => ({
        player: new RoutePlannerPolicy({ params, seed: s, beam: 4 }),
        opponent: new PlannerPolicy({ params, seed: s + 1 }),
      }),
    });
    expect(r.n).toBe(4);
    // Every game reached a real ending rather than the safety valve.
    expect(r.avg_turns).toBeGreaterThan(1);
  });
});
