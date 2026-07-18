// Policy-ranker scorer math + the cross-language φ contract, and the
// RankerPolicy seam. The in-test artifact's expected scores are computed by
// hand — any change here means the trainer contract changed too.
// (Registry loading is exercised end-to-end once training publishes;
// readPolicyArtifact simply returns null before a `policy` entry exists.)

import { describe, it, expect } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildPhiPlan,
  readPolicyArtifactFile,
  scoreCandidates,
  softmax,
  validatePolicyArtifact,
  type PolicyRankerArtifact,
} from "./policyModel";
import { RankerPolicy } from "./rankerPolicy";
import {
  ACTION_FEATURE_NAMES,
  POLICY_SCHEMA_VERSION,
  STATE_FEATURE_NAMES,
} from "./features/policy";
import {
  HeuristicPolicy,
  instantiateDeck,
  legalMoves,
  playGame,
  viewFor,
  type DecisionPolicy,
  type SimMove,
  type TurnContext,
} from "@/lib/engine/sim";
import type { PlayerView } from "@/lib/engine/sim/view";
import { buildSimInitialState } from "@/lib/engine/sim/setup";
import { mulberry32 } from "@/lib/engine/sim/rng";

/* ─── Hand-made artifact fixture ────────────────────────────────── */

const PHI = [
  "a:kind_attack",
  "a:attack_would_ko",
  "a:ends_turn",
  "x:my_prizes_remaining|attack_ko_prizes",
];

function makeArtifact(overrides: Partial<PolicyRankerArtifact> = {}): PolicyRankerArtifact {
  return {
    model_type: "policy_ranker",
    model_version: "policy-test",
    trained_at: "2026-07-16T00:00:00Z",
    policy_schema_version: POLICY_SCHEMA_VERSION,
    state_feature_names: [...STATE_FEATURE_NAMES],
    action_feature_names: [...ACTION_FEATURE_NAMES],
    features: [...PHI],
    means: [0.2, 0.1, 0.5, 1],
    stds: [0.4, 0.3, 0.5, 2],
    coefficients: [1, 2, -0.5, 0.75],
    l2_lambda: 1,
    n_decisions: 10,
    n_games: 2,
    data_hash: "test",
    metrics: {},
    validation_examples: [],
    ...overrides,
  };
}

/** Dense vector over `names` with the given entries set, zeros elsewhere. */
function dense(names: readonly string[], entries: Record<string, number>): number[] {
  const vec = new Array<number>(names.length).fill(0);
  for (const [name, value] of Object.entries(entries)) {
    const idx = names.indexOf(name);
    if (idx < 0) throw new Error(`unknown feature ${name}`);
    vec[idx] = value;
  }
  return vec;
}

// State: 4 prizes remaining. Candidates: a KO attack, a pass, a bench play.
const STATE = dense(STATE_FEATURE_NAMES, { my_prizes_remaining: 4 });
const ATTACK = dense(ACTION_FEATURE_NAMES, {
  kind_attack: 1,
  attack_would_ko: 1,
  ends_turn: 1,
  attack_ko_prizes: 2,
});
const PASS = dense(ACTION_FEATURE_NAMES, { kind_pass: 1, ends_turn: 1 });
const BENCH = dense(ACTION_FEATURE_NAMES, { kind_bench: 1, card_present: 1 });

// Hand-computed: score = Σ coef·(φ − mean)/std, φ₄ = state·action = 4·2 = 8.
//   attack: 1·(1−0.2)/0.4 + 2·(1−0.1)/0.3 − 0.5·(1−0.5)/0.5 + 0.75·(8−1)/2
//         = 2 + 6 − 0.5 + 2.625                       = 10.125
//   pass:   1·(−0.2)/0.4 + 2·(−0.1)/0.3 − 0.5·(0.5)/0.5 + 0.75·(−1)/2
//         = −0.5 − 2/3 − 0.5 − 0.375                   ≈ −2.0416667
//   bench:  −0.5 − 2/3 + 0.5 − 0.375                   ≈ −1.0416667
const EXPECTED_SCORES = [10.125, -0.5 - 2 / 3 - 0.5 - 0.375, -0.5 - 2 / 3 + 0.5 - 0.375];

describe("buildPhiPlan (φ construction)", () => {
  it("resolves action and interaction terms to dense encoder indices", () => {
    const plan = buildPhiPlan(makeArtifact());
    expect(plan).not.toBeNull();
    expect(plan).toEqual([
      { stateIndex: -1, actionIndex: ACTION_FEATURE_NAMES.indexOf("kind_attack") },
      { stateIndex: -1, actionIndex: ACTION_FEATURE_NAMES.indexOf("attack_would_ko") },
      { stateIndex: -1, actionIndex: ACTION_FEATURE_NAMES.indexOf("ends_turn") },
      {
        stateIndex: STATE_FEATURE_NAMES.indexOf("my_prizes_remaining"),
        actionIndex: ACTION_FEATURE_NAMES.indexOf("attack_ko_prizes"),
      },
    ]);
  });

  it("rejects φ names that are not a:/x: forms or reference unknown features", () => {
    const one = { means: [0], stds: [1], coefficients: [1] };
    expect(buildPhiPlan(makeArtifact({ features: ["ends_turn"], ...one }))).toBeNull();
    expect(buildPhiPlan(makeArtifact({ features: ["a:not_a_feature"], ...one }))).toBeNull();
    expect(buildPhiPlan(makeArtifact({ features: ["x:no_such_state|ends_turn"], ...one }))).toBeNull();
    expect(buildPhiPlan(makeArtifact({ features: ["x:turn_number|no_such_action"], ...one }))).toBeNull();
    expect(buildPhiPlan(makeArtifact({ features: ["x:turn_number"], ...one }))).toBeNull();
  });

  it("rejects misaligned coefficient arrays", () => {
    expect(buildPhiPlan(makeArtifact({ coefficients: [1, 2, -0.5] }))).toBeNull();
    expect(buildPhiPlan(makeArtifact({ means: [0.2, 0.1, 0.5, NaN] }))).toBeNull();
  });
});

describe("validatePolicyArtifact (fail-closed loading)", () => {
  it("accepts the well-formed fixture", () => {
    expect(validatePolicyArtifact(makeArtifact())).not.toBeNull();
  });

  it("rejects a schema-version mismatch", () => {
    expect(
      validatePolicyArtifact(makeArtifact({ policy_schema_version: POLICY_SCHEMA_VERSION + 1 })),
    ).toBeNull();
  });

  it("rejects name-array drift against the live encoder", () => {
    expect(
      validatePolicyArtifact(makeArtifact({ state_feature_names: [...STATE_FEATURE_NAMES].slice(0, -1) })),
    ).toBeNull();
    const renamed = [...ACTION_FEATURE_NAMES];
    renamed[0] = "renamed_feature";
    expect(validatePolicyArtifact(makeArtifact({ action_feature_names: renamed }))).toBeNull();
  });

  it("rejects the wrong model_type and non-objects", () => {
    expect(validatePolicyArtifact(makeArtifact({ model_type: "logistic_regression" as never }))).toBeNull();
    expect(validatePolicyArtifact(null)).toBeNull();
    expect(validatePolicyArtifact("nope")).toBeNull();
  });
});

describe("scoreCandidates", () => {
  it("reproduces hand-computed scores and softmax probabilities", () => {
    const { scores, probabilities } = scoreCandidates(makeArtifact(), STATE, [ATTACK, PASS, BENCH]);
    expect(scores).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(scores[i]).toBeCloseTo(EXPECTED_SCORES[i], 10);

    const max = Math.max(...EXPECTED_SCORES);
    const exps = EXPECTED_SCORES.map((s) => Math.exp(s - max));
    const sum = exps.reduce((a, b) => a + b, 0);
    for (let i = 0; i < 3; i++) expect(probabilities[i]).toBeCloseTo(exps[i] / sum, 10);
    expect(probabilities.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("treats a zero std as 1 (winprob idiom)", () => {
    const artifact = makeArtifact({
      features: ["a:ends_turn"],
      means: [0],
      stds: [0],
      coefficients: [2],
    });
    const { scores } = scoreCandidates(artifact, STATE, [PASS, BENCH]);
    expect(scores[0]).toBeCloseTo(2, 10); // 2·(1 − 0)/1
    expect(scores[1]).toBeCloseTo(0, 10);
  });

  it("handles an empty candidate list", () => {
    expect(scoreCandidates(makeArtifact(), STATE, [])).toEqual({ scores: [], probabilities: [] });
  });
});

describe("softmax", () => {
  it("is temperature-scaled and numerically stable for large scores", () => {
    const p = softmax([1000, 999], 1);
    expect(p[0]).toBeCloseTo(Math.exp(1) / (Math.exp(1) + 1), 10);
    const flat = softmax([1000, 999], 100);
    expect(flat[0]).toBeCloseTo(Math.exp(0.01) / (Math.exp(0.01) + 1), 10);
  });
});

describe("readPolicyArtifactFile", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "policy-artifact-"));

  it("round-trips a written artifact", () => {
    const file = path.join(dir, "policy.json");
    writeFileSync(file, JSON.stringify(makeArtifact()));
    const loaded = readPolicyArtifactFile(file);
    expect(loaded?.model_version).toBe("policy-test");
  });

  it("returns null for missing or invalid files", () => {
    expect(readPolicyArtifactFile(path.join(dir, "nope.json"))).toBeNull();
    const bad = path.join(dir, "bad.json");
    writeFileSync(bad, "not json");
    expect(readPolicyArtifactFile(bad)).toBeNull();
    const drifted = path.join(dir, "drifted.json");
    writeFileSync(drifted, JSON.stringify(makeArtifact({ policy_schema_version: 99 })));
    expect(readPolicyArtifactFile(drifted)).toBeNull();
  });
});

/* ─── RankerPolicy over a real game state ───────────────────────── */

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

function gameFixture() {
  const deck = instantiateDeck(DECK);
  const state = buildSimInitialState(deck, deck, mulberry32(11), "player");
  state.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  const ctx: TurnContext = { retreated: false };
  const view = viewFor(state, "player", ctx);
  const legal = legalMoves(state, "player", ctx);
  return { view, legal, ctx };
}

describe("RankerPolicy", () => {
  const artifact = makeArtifact();

  it("always returns a member of legal, deterministically (argmax)", () => {
    const { view, legal, ctx } = gameFixture();
    const policy = new RankerPolicy(artifact);
    const first = policy.chooseMove(view, legal, ctx);
    expect(legal).toContain(first);
    expect(policy.chooseMove(view, legal, ctx)).toBe(first);
    expect(new RankerPolicy(artifact).chooseMove(view, legal, ctx)).toBe(first);
  });

  it("samples a legal move reproducibly under a temperature + seed", () => {
    const { view, legal, ctx } = gameFixture();
    const a = new RankerPolicy(artifact, { temperature: 5, seed: 42 });
    const b = new RankerPolicy(artifact, { temperature: 5, seed: 42 });
    const moveA = a.chooseMove(view, legal, ctx);
    expect(legal).toContain(moveA);
    expect(b.chooseMove(view, legal, ctx)).toBe(moveA);
  });

  it("promotes a valid bench index", () => {
    const { view } = gameFixture();
    const idx = new RankerPolicy(artifact).choosePromotion(view);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(Math.max(1, view.board.bench.length));
  });

  it("drives a full seeded game, returning only legal moves throughout", () => {
    // Wrap the ranker so every decision is asserted against the legal set —
    // the driver applies whatever the policy returns without re-checking.
    const inner = new RankerPolicy(artifact);
    let decisions = 0;
    const checked: DecisionPolicy = {
      chooseMove(view: PlayerView, legal: SimMove[], ctx: TurnContext): SimMove {
        const move = inner.chooseMove(view, legal, ctx);
        expect(legal).toContain(move);
        decisions += 1;
        return move;
      },
      choosePromotion: (view: PlayerView) => inner.choosePromotion(view),
    };
    const outcome = playGame(
      instantiateDeck(DECK),
      instantiateDeck(DECK),
      { player: checked, opponent: new HeuristicPolicy() },
      mulberry32(7),
      "player",
      { maxTurns: 30 },
    );
    expect(decisions).toBeGreaterThan(0);
    expect(outcome.turns).toBeGreaterThan(0);
  });
});

/* ─── Published-artifact contract (skips until training publishes) ── */

const PUBLISHED = path.join(process.cwd(), "data", "ml", "policy.json");

function densify(sparse: Record<string, number>, length: number): number[] {
  const vec = new Array<number>(length).fill(0);
  for (const [idx, value] of Object.entries(sparse)) vec[Number(idx)] = value;
  return vec;
}

describe.skipIf(!existsSync(PUBLISHED))("published policy.json", () => {
  it("reproduces the trainer's embedded validation examples", () => {
    const real = readPolicyArtifactFile(PUBLISHED);
    expect(real).not.toBeNull();
    expect(real!.validation_examples.length).toBeGreaterThan(0);
    for (const example of real!.validation_examples) {
      const state = densify(example.state_sparse, STATE_FEATURE_NAMES.length);
      const candidates = example.candidates.map((c) =>
        densify(c.features_sparse, ACTION_FEATURE_NAMES.length),
      );
      const { scores, probabilities } = scoreCandidates(real!, state, candidates);
      for (let i = 0; i < scores.length; i++) {
        expect(scores[i]).toBeCloseTo(example.expected_scores[i], 8);
        expect(probabilities[i]).toBeCloseTo(example.expected_probabilities[i], 8);
      }
    }
  });
});
