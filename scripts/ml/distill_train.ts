// Distil the rolled-out search into a conditional-logit ranker.
//
// THE EXPERIMENT THIS IS DESIGNED AS
//
// The φ space, the encoder and the model class are taken UNCHANGED from the
// incumbent ranker artifact (115 pure action features + 223 state x action
// crosses = 338 terms). Only the TARGET differs. So this is not "a new model
// beat the old one" — it is a controlled comparison in which the features,
// the architecture and the scoring path are held fixed and the supervision is
// the single manipulated variable:
//
//   imitate the planner   one-hot on the priority list's choice   top-1 .5038, duel 43.2%
//   imitate the search    one-hot on the search's choice          --target hard
//   distil the search     softmax(Q/τ) over every candidate       --target soft
//
// The third is the one with no teacher ceiling: it carries MAGNITUDES, so the
// model learns that two moves were nearly equal and a third was catastrophic,
// which a one-hot label throws away. Comparing hard against soft separates
// "a better teacher" from "a richer signal", and those are different claims
// with different implications for scaling.
//
// The output is a PolicyRankerArtifact that `lib/ml/rankerPolicy.ts` loads
// unchanged, so the existing duel harnesses gate it without modification.
//
// Usage:
//   npx tsx scripts/ml/distill_train.ts --corpus c.jsonl --out artifact.json
//     [--target soft|hard] [--tau 0.05] [--l2 1e-4] [--iters 400]
//     [--holdout 0.2] [--phi-from PATH | --cross-state N --cross-action M]
//
// CAPACITY
//
// The incumbent φ is 13 move-kind one-hots crossed with ~17 state features
// plus 115 pure action terms. That can say "benching is good when the bench
// is empty"; it cannot say anything about WHICH Pokémon to bench, because
// card identity appears only as a pure action term with a state-independent
// weight. --cross-state/--cross-action build φ by crossing the top-N state
// and top-M action features by variance, so capacity becomes a dial and the
// "is the ceiling representational" question becomes a sweep rather than an
// argument. N=17, M=13 reproduces the incumbent's size.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { numOrNull } from "@/lib/ml/features";
import {
  ACTION_FEATURE_NAMES,
  POLICY_SCHEMA_VERSION,
  STATE_FEATURE_NAMES,
} from "@/lib/ml/features/policy";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}
function numArg(flag: string, fallback: number): number {
  const raw = arg(flag);
  if (raw === null) return fallback;
  const n = numOrNull(raw);
  if (n === null) {
    console.error(`[distill-train] ${flag} expects a number, got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return n;
}

const CORPUS = arg("--corpus") ?? "distill_corpus.jsonl";
const OUT = arg("--out") ?? "distilled_policy.json";
const TARGET = arg("--target") ?? "soft";
const TAU = numArg("--tau", 0.05);
const L2 = numArg("--l2", 1e-4);
const ITERS = numArg("--iters", 400);
const HOLDOUT = numArg("--holdout", 0.2);
const PHI_FROM = arg("--phi-from");
const CROSS_STATE = numArg("--cross-state", 0);
const CROSS_ACTION = numArg("--cross-action", 0);
const DEFAULT_PHI = path.resolve(
  REPO_ROOT,
  "..",
  "dexter-ml",
  "artifacts",
  "policy_v6_match.json",
);

if (TARGET !== "soft" && TARGET !== "hard") {
  console.error(`[distill-train] --target expects soft|hard, got ${JSON.stringify(TARGET)}`);
  process.exit(1);
}

interface Row {
  g: number;
  state: Record<string, number>;
  cands: { kind: string; a: Record<string, number> }[];
  q: number[];
  chosen: number;
}

interface Term {
  name: string;
  stateIndex: number; // -1 for a pure action feature
  actionIndex: number;
}

/** Reuse the incumbent's φ term list verbatim, so the comparison is about
 *  supervision and nothing else. Names are "a:ACTION" and "x:STATE|ACTION". */
function loadPhi(): Term[] {
  const artifact = JSON.parse(readFileSync(PHI_FROM ?? DEFAULT_PHI, "utf8")) as {
    features: string[];
    policy_schema_version: number;
    state_feature_names: string[];
    action_feature_names: string[];
  };
  if (artifact.policy_schema_version !== POLICY_SCHEMA_VERSION) {
    throw new Error(
      `[distill-train] φ source is schema v${artifact.policy_schema_version}, live is v${POLICY_SCHEMA_VERSION}`,
    );
  }
  // The encoder's name arrays are part of the contract: a renamed or
  // reordered feature silently remaps every coefficient.
  const same = (a: string[], b: readonly string[]) =>
    a.length === b.length && a.every((n, i) => n === b[i]);
  if (
    !same(artifact.state_feature_names, STATE_FEATURE_NAMES) ||
    !same(artifact.action_feature_names, ACTION_FEATURE_NAMES)
  ) {
    throw new Error("[distill-train] φ source's feature names differ from the live encoder");
  }
  const sIdx = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i] as const));
  const aIdx = new Map(ACTION_FEATURE_NAMES.map((n, i) => [n, i] as const));
  return artifact.features.map((name) => {
    if (name.startsWith("a:")) {
      const a = aIdx.get(name.slice(2));
      if (a === undefined) throw new Error(`[distill-train] unknown action feature ${name}`);
      return { name, stateIndex: -1, actionIndex: a };
    }
    const body = name.slice(2);
    const bar = body.indexOf("|");
    const s = sIdx.get(body.slice(0, bar));
    const a = aIdx.get(body.slice(bar + 1));
    if (s === undefined || a === undefined) {
      throw new Error(`[distill-train] unknown cross term ${name}`);
    }
    return { name, stateIndex: s, actionIndex: a };
  });
}

function softmax(xs: Float64Array | number[], out: Float64Array): void {
  let max = -Infinity;
  for (let i = 0; i < xs.length; i++) if (xs[i] > max) max = xs[i];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    const e = Math.exp(xs[i] - max);
    out[i] = e;
    sum += e;
  }
  for (let i = 0; i < xs.length; i++) out[i] /= sum;
}

/** Build φ from the corpus itself: the top-N state and top-M action features
 *  by variance, fully crossed, plus every pure action term.
 *
 *  Variance, not a hand-picked list, because the point of the sweep is to
 *  vary CAPACITY rather than to smuggle in feature selection. A constant
 *  feature contributes nothing to a within-decision ranking, so ordering by
 *  variance is the cheapest honest proxy for "might matter". */
function buildPhi(rows: Row[], nState: number, nAction: number): Term[] {
  const S = STATE_FEATURE_NAMES.length;
  const A = ACTION_FEATURE_NAMES.length;
  const sSum = new Float64Array(S);
  const sSq = new Float64Array(S);
  const aSum = new Float64Array(A);
  const aSq = new Float64Array(A);
  let sN = 0;
  let aN = 0;
  for (const r of rows) {
    sN += 1;
    for (const k of Object.keys(r.state)) {
      const i = Number(k);
      sSum[i] += r.state[k];
      sSq[i] += r.state[k] * r.state[k];
    }
    for (const c of r.cands) {
      aN += 1;
      for (const k of Object.keys(c.a)) {
        const i = Number(k);
        aSum[i] += c.a[k];
        aSq[i] += c.a[k] * c.a[k];
      }
    }
  }
  const varOf = (sum: Float64Array, sq: Float64Array, n: number, i: number) =>
    n > 1 ? sq[i] / n - (sum[i] / n) * (sum[i] / n) : 0;
  const topS = Array.from({ length: S }, (_, i) => i)
    .filter((i) => varOf(sSum, sSq, sN, i) > 0)
    .sort((a, b) => varOf(sSum, sSq, sN, b) - varOf(sSum, sSq, sN, a))
    .slice(0, nState);
  const topA = Array.from({ length: A }, (_, i) => i)
    .filter((i) => varOf(aSum, aSq, aN, i) > 0)
    .sort((a, b) => varOf(aSum, aSq, aN, b) - varOf(aSum, aSq, aN, a))
    .slice(0, nAction);

  const terms: Term[] = [];
  for (let a = 0; a < A; a++) {
    terms.push({ name: `a:${ACTION_FEATURE_NAMES[a]}`, stateIndex: -1, actionIndex: a });
  }
  for (const si of topS) {
    for (const ai of topA) {
      terms.push({
        name: `x:${STATE_FEATURE_NAMES[si]}|${ACTION_FEATURE_NAMES[ai]}`,
        stateIndex: si,
        actionIndex: ai,
      });
    }
  }
  return terms;
}

function main(): void {
  const text = readFileSync(path.resolve(REPO_ROOT, CORPUS), "utf8");
  const rows: Row[] = [];
  for (const line of text.split("\n")) {
    if (!line) continue;
    rows.push(JSON.parse(line) as Row);
  }
  console.log(`[distill-train] ${rows.length} decisions from ${CORPUS}`);

  const phi =
    CROSS_STATE > 0 && CROSS_ACTION > 0
      ? buildPhi(rows, CROSS_STATE, CROSS_ACTION)
      : loadPhi();
  const P = phi.length;
  console.log(
    `[distill-train] φ = ${P} terms ` +
      (CROSS_STATE > 0
        ? `(115 pure + ${CROSS_STATE} state x ${CROSS_ACTION} action crosses)`
        : `from ${path.basename(PHI_FROM ?? DEFAULT_PHI)}`),
  );

  // Store the RAW state and action vectors and compute φ on the fly. A
  // materialised design matrix is rows x candidates x P doubles, which is
  // 5 GB at P=3300 on a 17 GB machine; this is ~280 MB regardless of P, and
  // the recompute costs one multiply per term per score, which the scoring
  // loop was already paying.
  const stIdx = phi.map((t) => t.stateIndex);
  const acIdx = phi.map((t) => t.actionIndex);

  interface Sample {
    state: Float32Array;
    actions: Float32Array[];
    target: Float64Array;
    q: number[];
    best: number;
    game: number;
  }
  const design: Sample[] = [];
  for (const r of rows) {
    if (r.cands.length < 2) continue;
    const state = new Float32Array(STATE_FEATURE_NAMES.length);
    for (const k of Object.keys(r.state)) state[Number(k)] = r.state[k];
    const actions = r.cands.map((c) => {
      const a = new Float32Array(ACTION_FEATURE_NAMES.length);
      for (const k of Object.keys(c.a)) a[Number(k)] = c.a[k];
      return a;
    });
    let best = 0;
    for (let i = 1; i < r.q.length; i++) if (r.q[i] > r.q[best]) best = i;
    const target = new Float64Array(r.q.length);
    if (TARGET === "hard") {
      // The search's own choice, one-hot. Imitation of a stronger teacher —
      // the control that separates "better teacher" from "richer signal".
      target[best] = 1;
    } else {
      softmax(r.q.map((q) => q / TAU), target);
    }
    design.push({ state, actions, target, q: r.q, best, game: r.g });
  }

  // Target sharpness. A soft target whose entropy sits near ln(K) is almost
  // uniform, which means τ is large relative to the Q spread and the gradient
  // carries little information — which looks like a representational ceiling
  // but is a temperature bug.
  let entSum = 0;
  let maxEntSum = 0;
  let spreadSum = 0;
  for (const d of design) {
    let h = 0;
    for (let i = 0; i < d.target.length; i++) {
      if (d.target[i] > 0) h -= d.target[i] * Math.log(d.target[i]);
    }
    entSum += h;
    maxEntSum += Math.log(d.target.length);
    spreadSum += Math.max(...d.q) - Math.min(...d.q);
  }
  console.log(
    `[distill-train] ${design.length} usable decisions, target=${TARGET}` +
      `${TARGET === "soft" ? ` τ=${TAU}` : ""}`,
  );
  console.log(
    `  mean Q spread within a decision ${((100 * spreadSum) / design.length).toFixed(2)} pts; ` +
      `target entropy ${(entSum / design.length).toFixed(3)} of max ` +
      `${(maxEntSum / design.length).toFixed(3)} ` +
      `(${((100 * entSum) / maxEntSum).toFixed(0)}%)`,
  );

  /** φ value for term i of one candidate. */
  const phiAt = (st: Float32Array, ac: Float32Array, i: number): number =>
    stIdx[i] === -1 ? ac[acIdx[i]] : st[stIdx[i]] * ac[acIdx[i]];

  // Standardize over every candidate row, matching the artifact contract.
  const means = new Float64Array(P);
  const stds = new Float64Array(P);
  let n = 0;
  for (const d of design) {
    for (const ac of d.actions) {
      n += 1;
      for (let i = 0; i < P; i++) means[i] += phiAt(d.state, ac, i);
    }
  }
  for (let i = 0; i < P; i++) means[i] /= Math.max(1, n);
  for (const d of design) {
    for (const ac of d.actions) {
      for (let i = 0; i < P; i++) {
        const z = phiAt(d.state, ac, i) - means[i];
        stds[i] += z * z;
      }
    }
  }
  for (let i = 0; i < P; i++) stds[i] = Math.sqrt(stds[i] / Math.max(1, n)) || 1;
  const invStd = new Float64Array(P);
  for (let i = 0; i < P; i++) invStd[i] = 1 / stds[i];

  // Split by GAME, never by decision: decisions inside one game share board
  // states and would leak across the split.
  const games = Array.from(new Set(design.map((d) => d.game))).sort((a, b) => a - b);
  const cut = games[Math.floor(games.length * (1 - HOLDOUT))];
  const train = design.filter((d) => d.game < cut);
  const test = design.filter((d) => d.game >= cut);
  console.log(
    `[distill-train] ${train.length} train / ${test.length} held-out decisions ` +
      `(split by game at ${cut} of ${games.length})`,
  );

  const w = new Float64Array(P);
  const mom = new Float64Array(P);
  const vel = new Float64Array(P);
  const grad = new Float64Array(P);
  const lr = 0.05;
  const b1 = 0.9;
  const b2 = 0.999;

  const scoreOne = (st: Float32Array, ac: Float32Array): number => {
    let z = 0;
    for (let i = 0; i < P; i++) z += w[i] * (phiAt(st, ac, i) - means[i]) * invStd[i];
    return z;
  };

  for (let it = 1; it <= ITERS; it++) {
    grad.fill(0);
    let loss = 0;
    for (const d of train) {
      const K = d.actions.length;
      const sc = new Float64Array(K);
      const pr = new Float64Array(K);
      for (let k = 0; k < K; k++) sc[k] = scoreOne(d.state, d.actions[k]);
      softmax(sc, pr);
      for (let k = 0; k < K; k++) {
        if (d.target[k] > 0) loss -= d.target[k] * Math.log(Math.max(1e-12, pr[k]));
        const g = pr[k] - d.target[k];
        if (g === 0) continue;
        const ac = d.actions[k];
        for (let i = 0; i < P; i++) {
          grad[i] += g * (phiAt(d.state, ac, i) - means[i]) * invStd[i];
        }
      }
    }
    const scale = 1 / Math.max(1, train.length);
    for (let i = 0; i < P; i++) {
      const g = grad[i] * scale + L2 * w[i];
      mom[i] = b1 * mom[i] + (1 - b1) * g;
      vel[i] = b2 * vel[i] + (1 - b2) * g * g;
      const mh = mom[i] / (1 - Math.pow(b1, it));
      const vh = vel[i] / (1 - Math.pow(b2, it));
      w[i] -= (lr * mh) / (Math.sqrt(vh) + 1e-8);
    }
    if (it % 50 === 0 || it === 1) {
      console.log(`  iter ${String(it).padStart(4)}  loss ${(loss * scale).toFixed(4)}`);
    }
  }

  const evaluate = (set: Sample[]) => {
    let top1 = 0;
    let top3 = 0;
    let uniform = 0;
    // Q-REGRET: how much of the teacher's own value the student gives up.
    // top-1 is NOT a proxy for playing strength — measured here, the hard
    // target has the BEST top-1 and the WORST Q-regret.
    let regret = 0;
    let regretRandom = 0;
    for (const d of set) {
      const K = d.actions.length;
      const sc = new Float64Array(K);
      for (let k = 0; k < K; k++) sc[k] = scoreOne(d.state, d.actions[k]);
      const order = Array.from({ length: K }, (_, i) => i).sort((a, b) => sc[b] - sc[a]);
      if (order[0] === d.best) top1 += 1;
      if (order.slice(0, 3).includes(d.best)) top3 += 1;
      uniform += 1 / K;
      const qBest = d.q[d.best];
      regret += qBest - d.q[order[0]];
      regretRandom += qBest - d.q.reduce((a, b) => a + b, 0) / K;
    }
    return {
      top1: top1 / set.length,
      top3: top3 / set.length,
      uniform: uniform / set.length,
      regret: regret / set.length,
      regretRandom: regretRandom / set.length,
    };
  };

  const tr = evaluate(train);
  const te = evaluate(test);
  console.log(
    `\n  train  top1 ${tr.top1.toFixed(4)}  top3 ${tr.top3.toFixed(4)}\n` +
      `  HELD-OUT  top1 ${te.top1.toFixed(4)}  top3 ${te.top3.toFixed(4)}  ` +
      `(uniform baseline ${te.uniform.toFixed(4)})`,
  );
  console.log(
    `  HELD-OUT Q-REGRET ${(100 * te.regret).toFixed(2)} pts per decision  ` +
      `(a random legal move gives up ${(100 * te.regretRandom).toFixed(2)})`,
  );
  console.log(
    `  => the student recovers ` +
      `${(100 * (1 - te.regret / Math.max(1e-9, te.regretRandom))).toFixed(1)}% of the ` +
      `value a random choice would lose.`,
  );
  console.log(
    `  train-vs-held-out top1 gap ${(tr.top1 - te.top1).toFixed(4)} ` +
      `(a widening gap as P grows is overfitting, not capacity)`,
  );

  const artifact = {
    model_type: "policy_ranker" as const,
    model_version: `distill-${TARGET}${TARGET === "soft" ? `-tau${TAU}` : ""}-p${P}`,
    trained_at: new Date().toISOString(),
    policy_schema_version: POLICY_SCHEMA_VERSION,
    state_feature_names: [...STATE_FEATURE_NAMES],
    action_feature_names: [...ACTION_FEATURE_NAMES],
    features: phi.map((t) => t.name),
    means: Array.from(means),
    stds: Array.from(stds),
    coefficients: Array.from(w),
    l2_lambda: L2,
    n_decisions: design.length,
    n_games: games.length,
    data_hash: `${CORPUS}:${design.length}`,
    metrics: {
      top1_accuracy: Number(te.top1.toFixed(4)),
      top3_accuracy: Number(te.top3.toFixed(4)),
      holdout_q_regret: Number(te.regret.toFixed(5)),
      holdout_q_regret_random: Number(te.regretRandom.toFixed(5)),
      train_top1: Number(tr.top1.toFixed(4)),
      baseline_uniform_top1: Number(te.uniform.toFixed(4)),
      tau: TARGET === "soft" ? TAU : null,
      phi_terms: P,
    },
  };
  writeFileSync(path.resolve(REPO_ROOT, OUT), JSON.stringify(artifact));
  console.log(`\n  wrote ${OUT}`);
}

main();
