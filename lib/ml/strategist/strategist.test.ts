import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parseBattleLog } from "@/lib/battle-log";

import {
  HeuristicPolicy,
  instantiateDeck,
  playGame,
  mulberry32,
  hashSeed,
  legalMoves,
  resumeGame,
  heuristicEvaluator,
  type DecisionObservation,
  type SimMove,
  type TurnContext,
} from "@/lib/engine/sim";
import type { GameState } from "@/lib/engine/types";
import { loadBenchmarkDecks } from "@/lib/ml/benchmarkDecks";

import { analyzeDecision, moveKey, sameMove, semanticMoveKey } from "./regret";
import { outcomeValue, snapshotFor, clampProb } from "./value";
import { determinizeLogSide, revealedSideCards } from "./determinize";
import { coachGame } from "./coachGame";
import { emptyScanStats, scanLog } from "./logDecisions";
import {
  calibrate,
  fitPlatt,
  logit,
  reliability,
  severityOf,
  severityThresholds,
  sigmoid,
} from "./calibrate";

const DECKS = loadBenchmarkDecks("data/ml/benchmark-decks.json");

/** Capture real mid-game decisions to test against, rather than hand-built
 *  fixtures — the engine's legal-move set is what this code consumes. */
function captureDecisions(limit: number): {
  state: GameState;
  actor: "player" | "opponent";
  ctx: TurnContext;
  move: SimMove;
}[] {
  const out: { state: GameState; actor: "player" | "opponent"; ctx: TurnContext; move: SimMove }[] =
    [];
  for (let g = 0; g < 3 && out.length < limit; g++) {
    const d = instantiateDeck(DECKS[g % DECKS.length].list);
    playGame(
      d,
      d,
      { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
      mulberry32(hashSeed(`test:${g}`)),
      "player",
      {
        onDecision: (ev: DecisionObservation) => {
          if (out.length >= limit) return;
          if (ev.legal.length < 3) return;
          out.push({
            state: structuredClone(ev.state),
            actor: ev.actor,
            ctx: { ...ev.ctx },
            move: ev.move,
          });
        },
      },
    );
  }
  return out;
}

describe("resumeGame", () => {
  it("continues a game the driver handed over, and finishes it", () => {
    const [d] = captureDecisions(1);
    expect(d).toBeDefined();
    const state = structuredClone(d.state);
    const { outcome } = resumeGame(
      state,
      d.actor,
      { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
      mulberry32(7),
      { ctx: { ...d.ctx } },
    );
    expect(outcome).not.toBeNull();
    expect(["prizes", "deck_out", "no_active", "turn_cap"]).toContain(outcome!.endReason);
  });

  it("stops on the ply budget with the game still live", () => {
    const [d] = captureDecisions(1);
    const state = structuredClone(d.state);
    const res = resumeGame(
      state,
      d.actor,
      { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
      mulberry32(7),
      { ctx: { ...d.ctx }, maxPlies: 1 },
    );
    expect(res.plies).toBe(1);
    // Either it ran out of budget (outcome null) or the game genuinely ended
    // inside that one turn; both are correct, but it must not run on.
    if (res.outcome === null) expect(state.winner).toBeNull();
  });

  it("is deterministic: the same seed reproduces the same outcome", () => {
    const [d] = captureDecisions(1);
    const run = () =>
      resumeGame(
        structuredClone(d.state),
        d.actor,
        { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
        mulberry32(99),
        { ctx: { ...d.ctx } },
      ).outcome;
    const a = run();
    const b = run();
    expect(a).toEqual(b);
  });

  it("plays a forced first move before consulting the policy", () => {
    const [d] = captureDecisions(1);
    const state = structuredClone(d.state);
    const legal = legalMoves(state, d.actor, d.ctx);
    const forced = legal.find((m) => m.kind === "pass") ?? legal[legal.length - 1];
    const seen: string[] = [];
    resumeGame(
      state,
      d.actor,
      { player: new HeuristicPolicy(), opponent: new HeuristicPolicy() },
      mulberry32(3),
      {
        ctx: { ...d.ctx },
        firstMove: forced,
        maxPlies: 1,
        onDecision: (ev) => {
          if (seen.length === 0) seen.push(ev.forced ? "forced" : "policy");
        },
      },
    );
    expect(seen[0]).toBe("forced");
  });
});

describe("move identity", () => {
  it("moveKey is stable across key order and structural clones", () => {
    const a = {
      kind: "attack",
      attackIndex: 0,
      riderPicks: [{ ref: "t", monIds: ["m1"] }],
    } as unknown as SimMove;
    const b = JSON.parse(JSON.stringify(a)) as SimMove;
    expect(moveKey(a)).toBe(moveKey(b));
    expect(sameMove(a, b)).toBe(true);
  });

  it("compares nested arrays by value, not identity", () => {
    // The shipped bug: a shallow `!==` over keys says these differ, because
    // the arrays are different objects. That silently dropped a third of all
    // decisions from the first calibration run.
    const a = { kind: "attack", attackIndex: 0, benchCounters: ["x"] } as unknown as SimMove;
    const b = { kind: "attack", attackIndex: 0, benchCounters: ["x"] } as unknown as SimMove;
    expect(sameMove(a, b)).toBe(true);
    const c = { kind: "attack", attackIndex: 0, benchCounters: ["y"] } as unknown as SimMove;
    expect(sameMove(a, c)).toBe(false);
  });

  it("semanticMoveKey matches a deck search across different card ids", () => {
    // A ghost rebuilds its deck with synthetic ids, so the same fetch is a
    // different move by id and the same move by name.
    const ghost = {
      kind: "play_trainer",
      cardId: "sim_1",
      deckCardIds: ["ghost-deck-6"],
      deckCardNames: ["Drakloak"],
    } as unknown as SimMove;
    const real = {
      kind: "play_trainer",
      cardId: "sim_1",
      deckCardIds: ["sim_884"],
      deckCardNames: ["Drakloak"],
    } as unknown as SimMove;
    expect(moveKey(ghost)).not.toBe(moveKey(real));
    expect(semanticMoveKey(ghost)).toBe(semanticMoveKey(real));
  });

  it("semanticMoveKey still separates different fetches", () => {
    const a = {
      kind: "effect",
      sourceId: "s",
      card: "Cyrano",
      effectIndex: 0,
      picks: [{ ref: "p", cardIds: ["g1"], cardNames: ["N's Zoroark ex"] }],
    } as unknown as SimMove;
    const b = {
      kind: "effect",
      sourceId: "s",
      card: "Cyrano",
      effectIndex: 0,
      picks: [{ ref: "p", cardIds: ["g1"], cardNames: ["Fezandipiti ex"] }],
    } as unknown as SimMove;
    expect(semanticMoveKey(a)).not.toBe(semanticMoveKey(b));
  });

  it("semanticMoveKey ignores the order of a multi-card fetch", () => {
    const mk = (names: string[]) =>
      ({
        kind: "effect",
        sourceId: "s",
        card: "Cyrano",
        effectIndex: 0,
        picks: [{ ref: "p", cardIds: ["a", "b"], cardNames: names }],
      }) as unknown as SimMove;
    expect(semanticMoveKey(mk(["A", "B"]))).toBe(semanticMoveKey(mk(["B", "A"])));
  });
});

describe("analyzeDecision", () => {
  it("values every legal move and finds the one that was played", () => {
    const [d] = captureDecisions(1);
    const a = analyzeDecision(d.state, d.actor, d.ctx, d.move, {
      rollouts: 4,
      horizon: 3,
      evaluate: heuristicEvaluator,
      seed: 5,
    });
    expect(a).not.toBeNull();
    expect(a!.candidates.length).toBeGreaterThan(1);
    // The played move came from this decision's own legal set; not finding it
    // is a move-identity bug, which is how it failed the first time.
    expect(a!.chosenIndex).not.toBeNull();
    for (const c of a!.candidates) {
      expect(c.samples).toHaveLength(4);
      expect(c.q).toBeGreaterThanOrEqual(0);
      expect(c.q).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic for a given seed", () => {
    const [d] = captureDecisions(1);
    const run = () =>
      analyzeDecision(d.state, d.actor, d.ctx, d.move, {
        rollouts: 4,
        horizon: 3,
        evaluate: heuristicEvaluator,
        seed: 11,
      })!.candidates.map((c) => c.q);
    expect(run()).toEqual(run());
  });

  it("does not mutate the state it is given", () => {
    const [d] = captureDecisions(1);
    const before = JSON.stringify(d.state);
    analyzeDecision(d.state, d.actor, d.ctx, d.move, {
      rollouts: 3,
      horizon: 2,
      evaluate: heuristicEvaluator,
      seed: 1,
    });
    expect(JSON.stringify(d.state)).toBe(before);
  });

  it("uses common random numbers: arms share a rollout's luck", () => {
    // With CRN, two arms that lead to the same state must produce the same
    // sample at the same index. Testing the contract directly: the seed is a
    // function of the rollout index only, so re-running one arm alone
    // reproduces its samples exactly.
    const [d] = captureDecisions(1);
    const full = analyzeDecision(d.state, d.actor, d.ctx, d.move, {
      rollouts: 4,
      horizon: 3,
      evaluate: heuristicEvaluator,
      seed: 21,
    })!;
    const one = analyzeDecision(d.state, d.actor, d.ctx, d.move, {
      rollouts: 4,
      horizon: 3,
      evaluate: heuristicEvaluator,
      seed: 21,
      candidateFilter: (m) => m.kind === full.candidates[0].move.kind,
    });
    expect(one).not.toBeNull();
    const matching = one!.candidates.find(
      (c) => moveKey(c.move) === moveKey(full.candidates[0].move),
    );
    expect(matching!.samples).toEqual(full.candidates[0].samples);
  });

  it("throws rather than inventing a value when a horizon has no evaluator", () => {
    const [d] = captureDecisions(1);
    expect(() =>
      analyzeDecision(d.state, d.actor, d.ctx, d.move, { rollouts: 2, horizon: 3 }),
    ).toThrow(/evaluator/);
  });

  it("returns null when there is no decision to make", () => {
    const [d] = captureDecisions(1);
    const a = analyzeDecision(d.state, d.actor, d.ctx, d.move, {
      rollouts: 2,
      horizon: 2,
      evaluate: heuristicEvaluator,
      candidateFilter: (m) => m.kind === "pass",
    });
    expect(a).toBeNull();
  });

  it("applies `prepare` to every arm identically, preserving pairing", () => {
    const [d] = captureDecisions(1);
    const seen: number[] = [];
    const a = analyzeDecision(d.state, d.actor, d.ctx, d.move, {
      rollouts: 3,
      horizon: 2,
      evaluate: heuristicEvaluator,
      seed: 4,
      prepare: (_clone, r) => seen.push(r),
    })!;
    // One call per arm per rollout, and the rollout indices must repeat
    // across arms rather than advance monotonically.
    expect(seen).toHaveLength(3 * a.candidates.length);
    expect(new Set(seen)).toEqual(new Set([0, 1, 2]));
  });
});

describe("value", () => {
  it("scores a draw as a half, not a loss", () => {
    expect(
      outcomeValue(
        { winner: null, endReason: "turn_cap", turns: 60, prizesTaken: { player: 1, opponent: 1 }, firstKoTurn: null },
        "player",
      ),
    ).toBe(0.5);
  });

  it("snapshots from the asked-for side, not always sides.player", () => {
    const [d] = captureDecisions(1);
    const p = snapshotFor(d.state, "player");
    const o = snapshotFor(d.state, "opponent");
    // toBeCloseTo, not toBe: negating a zero difference gives -0, which
    // Object.is separates from +0.
    expect(p.prize_diff).toBeCloseTo(-o.prize_diff);
    expect(p.bench_diff).toBeCloseTo(-o.bench_diff);
  });

  it("keeps probabilities off the rails", () => {
    expect(clampProb(1.5)).toBeLessThan(1);
    expect(clampProb(-3)).toBeGreaterThan(0);
    expect(clampProb(Number.NaN)).toBe(0.5);
  });
});

describe("determinize", () => {
  it("fills an empty deck so a rollout cannot deck out instantly", () => {
    const [d] = captureDecisions(1);
    const state = structuredClone(d.state);
    state.sides.opponent.deck = [];
    state.sides.opponent.hand = [];
    const res = determinizeLogSide(state, "opponent", mulberry32(3));
    expect(state.sides.opponent.deck.length).toBeGreaterThan(10);
    expect(state.sides.opponent.hand.length).toBeGreaterThanOrEqual(5);
    expect(res.deckNamed).toBeGreaterThan(0);
  });

  it("reads only revealed zones — never the hand or deck it is filling", () => {
    const [d] = captureDecisions(1);
    const state = structuredClone(d.state);
    const secret = { id: "secret", name: "Iono", catalog: null };
    state.sides.opponent.hand = [secret];
    const revealed = revealedSideCards(state, "opponent");
    expect(revealed).not.toContain("Iono");
  });

  it("is reproducible from its rng", () => {
    const [d] = captureDecisions(1);
    const run = () => {
      const s = structuredClone(d.state);
      s.sides.opponent.deck = [];
      determinizeLogSide(s, "opponent", mulberry32(17));
      return s.sides.opponent.deck.map((c) => c.name);
    };
    expect(run()).toEqual(run());
  });
});

describe("calibration", () => {
  it("recovers a known logistic distortion", () => {
    // Generate q values whose true win rate is sigmoid(0.7*logit(q) - 0.4):
    // a miscalibrated-but-monotone score, which is exactly the shape the real
    // logs show. The fit should undo it.
    const rng = mulberry32(9);
    const q: number[] = [];
    const won: boolean[] = [];
    const groups: string[] = [];
    for (let i = 0; i < 4000; i++) {
      const x = 0.02 + rng() * 0.96;
      const p = sigmoid(0.7 * logit(x) - 0.4);
      q.push(x);
      won.push(rng() < p);
      groups.push(`g${i % 200}`);
    }
    const fit = fitPlatt(q, won, groups);
    expect(fit.a).toBeGreaterThan(0.55);
    expect(fit.a).toBeLessThan(0.85);
    expect(fit.b).toBeGreaterThan(-0.6);
    expect(fit.b).toBeLessThan(-0.2);
    expect(fit.nGames).toBe(200);

    const before = reliability(q, won);
    const after = reliability(
      q.map((x) => calibrate({ a: fit.a, b: fit.b } as never, x)),
      won,
    );
    expect(after.error).toBeLessThan(before.error);
  });

  it("does not diverge on separable data with extreme logits", () => {
    // The bug this guards: rollout means of exactly 1.0 and 0.0 are common,
    // and an unregularised Newton step on those leverage points ran to
    // a=6.2e8 / b=2.2e9 — a step function dressed as a probability — while
    // still REPORTING a reliability improvement, because collapsing onto the
    // majority class scores well against a lopsided base rate.
    const q: number[] = [];
    const won: boolean[] = [];
    const groups: string[] = [];
    for (let i = 0; i < 500; i++) {
      const hi = i % 2 === 0;
      q.push(hi ? 1 : 0); // perfectly separable, and exactly on the rails
      won.push(hi);
      groups.push(`g${i % 50}`);
    }
    const fit = fitPlatt(q, won, groups);
    // The UNPENALISED likelihood has no finite optimum here, but the L2 prior
    // makes the penalised objective proper, so a small bounded coefficient is
    // the right answer rather than a failure. What must never happen again is
    // an unbounded one.
    expect(Number.isFinite(fit.a)).toBe(true);
    expect(Number.isFinite(fit.b)).toBe(true);
    expect(Math.abs(fit.a)).toBeLessThan(4);
    expect(Math.abs(fit.b)).toBeLessThan(4);
    expect(fit.converged).toBe(true);
  });

  it("converges on well-behaved data and says so", () => {
    const rng = mulberry32(4);
    const q: number[] = [];
    const won: boolean[] = [];
    const groups: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const x = 0.05 + rng() * 0.9;
      q.push(x);
      won.push(rng() < sigmoid(0.8 * logit(x) + 0.3));
      groups.push(`g${i % 150}`);
    }
    const fit = fitPlatt(q, won, groups);
    expect(fit.converged).toBe(true);
    expect(fit.a).toBeGreaterThan(0.5);
    expect(fit.a).toBeLessThan(1.2);
  });

  it("reports the effective n as games, not decisions", () => {
    const fit = fitPlatt([0.4, 0.6, 0.5], [true, false, true], ["a", "a", "b"]);
    expect(fit.nGames).toBe(2);
  });

  it("skips deciles too thin to say anything about calibration", () => {
    const q = [...Array(50).fill(0.55), 0.95];
    const won = [...Array(50).fill(true), false];
    const r = reliability(q, won, 20);
    // The lone 0.95 observation must not be reported as a 95-point miss.
    expect(r.bins.every((b) => b.n >= 20)).toBe(true);
  });

  it("grades severity by quantile, not by a fixed point value", () => {
    const small = severityThresholds(Array.from({ length: 100 }, (_, i) => i / 1000));
    const large = severityThresholds(Array.from({ length: 100 }, (_, i) => i / 100));
    expect(large.blunder).toBeGreaterThan(small.blunder);
    expect(severityOf(large.blunder, large)).toBe("blunder");
    expect(severityOf(0, large)).toBe("ok");
  });
});

describe("coachGame", () => {
  const RAW = readFileSync(join(process.cwd(), "lib/battle-log/fixtures/example-1.txt"), "utf8");
  const row = {
    id: "fixture-1",
    battle_log_raw: RAW,
    player_handle: parseBattleLog(RAW).handles[0],
    deck_list: null,
  };

  it("grades a real log end to end", () => {
    const game = coachGame(row, {
      evaluate: heuristicEvaluator,
      rollouts: 4,
      horizon: 3,
      seed: 3,
    });
    expect(game.logId).toBe("fixture-1");
    expect(game.decisions.length).toBeGreaterThan(0);
    for (const d of game.decisions) {
      expect(d.legalCount).toBeGreaterThan(1);
      expect(d.regret).toBeGreaterThanOrEqual(-1);
      expect(d.stakes).toBeGreaterThanOrEqual(0);
      if (d.capture !== null) {
        expect(d.capture).toBeGreaterThanOrEqual(0);
        expect(d.capture).toBeLessThanOrEqual(1);
      }
    }
  });

  it("only flags what is statistically separable", () => {
    const game = coachGame(row, {
      evaluate: heuristicEvaluator,
      rollouts: 4,
      horizon: 3,
      seed: 3,
    });
    // A blunder shown to a user must clear its own error bar; the whole point
    // of the paired bars is that they gate the copy.
    for (const b of game.blunders) {
      expect(b.significant).toBe(true);
      expect(b.severity).not.toBe("ok");
    }
  });

  it("is deterministic for a seed", () => {
    const opts = { evaluate: heuristicEvaluator, rollouts: 4, horizon: 3, seed: 11 };
    const a = coachGame(row, opts).decisions.map((d) => d.regret);
    const b = coachGame(row, opts).decisions.map((d) => d.regret);
    expect(a).toEqual(b);
  });

  it("reports capture as null when nothing was at stake", () => {
    const game = coachGame(row, {
      evaluate: heuristicEvaluator,
      rollouts: 4,
      horizon: 3,
      seed: 3,
      // Nothing can clear this, so every capture must be null rather than a
      // number divided by a near-zero spread.
      minStakes: 10,
    });
    expect(game.decisions.every((d) => d.capture === null)).toBe(true);
    expect(game.meanCapture).toBeNull();
  });
});

describe("candidate-set agreement between scanner and analyzer", () => {
  it("analyzeDecision enumerates exactly the moves scanLog offered", () => {
    // coachGame indexes the human's move as `d.legal[d.humanIndex]` from the
    // scanner's enumeration, then hands the SAME state and ctx to
    // analyzeDecision, which enumerates again. If those two sets ever
    // diverged, the coach would grade the wrong move without erroring — the
    // chosenIndex would simply land elsewhere.
    const RAW = readFileSync(join(process.cwd(), "lib/battle-log/fixtures/example-1.txt"), "utf8");
    const row = {
      id: "fixture-1",
      battle_log_raw: RAW,
      player_handle: parseBattleLog(RAW).handles[0],
      deck_list: null,
    };
    const stats = emptyScanStats();
    let checked = 0;
    scanLog(row, stats, (d) => {
      if (checked >= 12) return;
      const again = legalMoves(d.state, "player", d.ctx);
      expect(again.map(moveKey)).toEqual(d.legal.map(moveKey));
      checked += 1;
    });
    expect(checked).toBeGreaterThan(0);
  });
});
