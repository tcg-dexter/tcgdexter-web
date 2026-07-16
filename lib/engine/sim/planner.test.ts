// AI player Milestone A acceptance: the information-set boundary leaks
// nothing hidden, planning is deterministic per seed, the difficulty dial
// produces a strict strength ladder, and turn latency fits the budget.
//
// Known v1 ceiling (documented, not asserted): PlannerPolicy(hard) does
// not yet beat the hand-written HeuristicPolicy in mirror matches — the
// one-ply evaluator can't see multi-turn win-condition commitment. The
// product criterion is the ladder below.

import { describe, it, expect } from "vitest";
import {
  instantiateDeck,
  simulateMatchup,
  viewFor,
  PlannerPolicy,
  plannerParamsFor,
  plannerParamsForSkill,
  buildGhostState,
} from "./index";
import { buildSimInitialState } from "./setup";
import { mulberry32 } from "./rng";
import type { Difficulty } from "./difficulty";

const DECK = [
  "Pokémon: 12",
  "4 Miraidon ex SVI 81",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 24",
  "24 Basic Lightning Energy SVE 4",
].join("\n");

const mkPolicies = (a: Difficulty, b: Difficulty) => (seed: number) => ({
  player: new PlannerPolicy({ params: plannerParamsFor(a), seed }),
  opponent: new PlannerPolicy({ params: plannerParamsFor(b), seed: (seed ^ 0xabcdef) >>> 0 }),
});

function duel(a: Difficulty, b: Difficulty, n = 60) {
  return simulateMatchup(DECK, DECK, { n, seed: 4242, policies: mkPolicies(a, b) });
}

/* ─── Information sets ──────────────────────────────────────────── */

describe("PlayerView information boundary", () => {
  const deck = instantiateDeck(DECK);
  const state = buildSimInitialState(deck, deck, mulberry32(9), "player");
  const view = viewFor(state, "player");

  it("never exposes opponent hand or deck identities", () => {
    const opponent = view.opponent as unknown as Record<string, unknown>;
    expect(opponent.hand).toBeUndefined();
    expect(opponent.deck).toBeUndefined();
    expect(typeof opponent.handCount).toBe("number");
    expect(typeof opponent.deckCount).toBe("number");
    expect(typeof opponent.prizeCount).toBe("number");
  });

  it("never exposes own deck order or prize identities", () => {
    const v = view as unknown as Record<string, unknown>;
    expect(v.deck).toBeUndefined();
    expect(v.prizes).toBeUndefined();
    expect(view.deckCount).toBe(state.sides.player.deck.length);
  });

  it("unseenOwn is the deck ∪ prizes multiset, order-free", () => {
    // The perfect-memory inference: 60-list minus every seen zone.
    const expected: Record<string, number> = {};
    for (const c of [...state.sides.player.deck, ...state.sides.player.prizes]) {
      expected[c.name] = (expected[c.name] ?? 0) + 1;
    }
    expect(view.unseenOwn).toEqual(expected);
    const total = Object.values(view.unseenOwn).reduce((a, b) => a + b, 0);
    expect(total).toBe(view.deckCount + view.prizeCount);
    // No unseenOwn for the opponent — their list isn't known.
    expect((view.opponent as unknown as Record<string, unknown>).unseenOwn).toBeUndefined();
  });

  it("exposes Lost Zones (public) and per-turn flags from ctx", () => {
    expect(view.lostZone).toEqual([]);
    expect(view.opponent.lostZone).toEqual([]);
    // Without ctx the flags default to false.
    expect(view.retreatUsedThisTurn).toBe(false);
    expect(view.stadiumPlayedThisTurn).toBe(false);
    expect(view.stadiumEffectUsedThisTurn).toBe(false);
    const withCtx = viewFor(state, "player", {
      retreated: true,
      stadiumPlayed: true,
      stadiumUsed: true,
    });
    expect(withCtx.retreatUsedThisTurn).toBe(true);
    expect(withCtx.stadiumPlayedThisTurn).toBe(true);
    expect(withCtx.stadiumEffectUsedThisTurn).toBe(true);
  });

  it("ghost states hold only placeholders in hidden zones", () => {
    const ghost = buildGhostState(view);
    for (const card of ghost.sides.player.deck) expect(card.unrevealed).toBe(true);
    for (const card of ghost.sides.player.prizes) expect(card.unrevealed).toBe(true);
    for (const card of ghost.sides.opponent.hand) expect(card.unrevealed).toBe(true);
    for (const card of ghost.sides.opponent.deck) expect(card.unrevealed).toBe(true);
    // Public zones keep identities.
    expect(ghost.sides.player.hand.every((c) => !c.unrevealed)).toBe(true);
  });
});

/* ─── Determinism ───────────────────────────────────────────────── */

describe("planner determinism", () => {
  it("same seed reproduces a planner duel exactly", () => {
    const a = duel("hard", "medium", 20);
    const b = duel("hard", "medium", 20);
    const strip = ({ elapsed_ms: _, ...rest }: typeof a) => rest;
    expect(strip(b)).toEqual(strip(a));
  });
});

/* ─── Difficulty ladder ─────────────────────────────────────────── */

describe("difficulty strength ladder", () => {
  it("hard beats easy decisively", () => {
    expect(duel("hard", "easy").win_rate_a).toBeGreaterThan(0.8);
  });

  it("medium sits between: beats easy, loses to hard", () => {
    expect(duel("medium", "easy").win_rate_a).toBeGreaterThan(0.6);
    expect(duel("hard", "medium").win_rate_a).toBeGreaterThan(0.6);
  });

  it("the skill dial is monotone in its parameters", () => {
    let lastTau = Infinity;
    let lastEps = Infinity;
    for (const skill of [0, 0.25, 0.5, 0.75, 1]) {
      const p = plannerParamsForSkill(skill);
      expect(p.temperature).toBeLessThanOrEqual(lastTau);
      expect(p.epsilon).toBeLessThanOrEqual(lastEps);
      lastTau = p.temperature;
      lastEps = p.epsilon;
    }
  });
});

/* ─── Latency ───────────────────────────────────────────────────── */

describe("planner latency", () => {
  it("60 hard-vs-hard games fit the interactive budget", () => {
    const result = duel("hard", "hard", 60);
    // ~25 turns/game ⇒ ~1500 planned turns; interactive play needs a few
    // ms per AI turn, so the whole batch must stay well under 10s.
    expect(result.elapsed_ms).toBeLessThan(10_000);
  });
});
