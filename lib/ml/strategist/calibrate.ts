// Turn the search's Q into something that may be quoted as a percentage.
//
// Measured on 271 real logs: Q DISCRIMINATES — the bottom decile of decisions
// is won 41.5% of the time and the top decile 92.9% — but it is not
// CALIBRATED, with mean |predicted - actual| at 27.6 points. The value model
// under it was trained on 50%-base-rate mirror self-play, and the humans who
// log battles here win about 72% of them. So "your play cost 8 points of win
// probability" is not a sentence the raw number earns.
//
// Two separate things are provided, and they are separate on purpose:
//
//   PLATT      a two-parameter monotone map from Q to P(win), fit on real
//              outcomes. Two parameters rather than isotonic bins because the
//              EFFECTIVE sample size is the number of GAMES (~254), not the
//              number of decisions (~4,700) — every decision in a game shares
//              that game's single outcome as its label. Isotonic would happily
//              fit ten bins to a few hundred independent points.
//
//   SEVERITY   quantile buckets of the observed regret distribution. This is
//              what a chess site actually shows, and it needs no calibration
//              at all: it says "this was worse than 95% of your decisions",
//              which is true of an ordinal score. Prefer it for user copy.
//
// Neither converts an ordinal score into a causal claim. A calibrated P(win)
// still says "players in positions like this went on to win X% of the time",
// not "you had an X% chance".

export interface CalibrationArtifact {
  model_type: "coach_calibration";
  trained_at: string;
  /** P(win) = sigmoid(a * logit(q) + b). */
  a: number;
  b: number;
  /** Decisions used, and the GAMES they came from — the honest n. */
  n_decisions: number;
  n_games: number;
  /** Mean |predicted - actual| over deciles, before and after. */
  reliability_before: number;
  reliability_after: number;
  /** Regret quantiles, for severity buckets. */
  severity: { inaccuracy: number; mistake: number; blunder: number };
}

const EPS = 1e-6;

export function logit(p: number): number {
  const c = Math.min(1 - EPS, Math.max(EPS, p));
  return Math.log(c / (1 - c));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Apply a fitted map. */
export function calibrate(artifact: CalibrationArtifact, q: number): number {
  return sigmoid(artifact.a * logit(q) + artifact.b);
}

/**
 * Fit P(win) = sigmoid(a * logit(q) + b) by Newton steps on the log
 * likelihood. Two parameters, so this is stable at the sample sizes here.
 *
 * `groups` identifies which GAME each observation came from. It does not
 * change the fit — it is carried so callers can report the effective n
 * rather than the decision count, which overstates confidence by ~18x.
 */
export function fitPlatt(
  q: number[],
  won: boolean[],
  groups: string[],
): { a: number; b: number; nGames: number } {
  if (q.length !== won.length || q.length !== groups.length) {
    throw new Error("fitPlatt: q, won and groups must be the same length");
  }
  const x = q.map(logit);
  let a = 1;
  let b = 0;
  for (let iter = 0; iter < 100; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < x.length; i++) {
      const p = sigmoid(a * x[i] + b);
      const r = p - (won[i] ? 1 : 0);
      g0 += r * x[i];
      g1 += r;
      const w = p * (1 - p);
      h00 += w * x[i] * x[i];
      h01 += w * x[i];
      h11 += w;
    }
    // Ridge on the Hessian keeps the step finite when the data are separable.
    h00 += 1e-6;
    h11 += 1e-6;
    const det = h00 * h11 - h01 * h01;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det;
    const db = (h00 * g1 - h01 * g0) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b, nGames: new Set(groups).size };
}

/** Mean |predicted - actual| over deciles of `q`, weighted by bin count.
 *  Bins with too few observations are skipped rather than reported as wild
 *  misses — a decile with n=3 says nothing about calibration. */
export function reliability(
  q: number[],
  won: boolean[],
  minBin = 20,
): { error: number; bins: { lo: number; predicted: number; actual: number; n: number }[] } {
  const bins = new Map<number, { sum: number; won: number; n: number }>();
  for (let i = 0; i < q.length; i++) {
    const b = Math.min(9, Math.max(0, Math.floor(q[i] * 10)));
    const cell = bins.get(b) ?? { sum: 0, won: 0, n: 0 };
    cell.sum += q[i];
    cell.won += won[i] ? 1 : 0;
    cell.n += 1;
    bins.set(b, cell);
  }
  let weighted = 0;
  let total = 0;
  const rows: { lo: number; predicted: number; actual: number; n: number }[] = [];
  for (const b of Array.from(bins.keys()).sort((x, y) => x - y)) {
    const cell = bins.get(b)!;
    if (cell.n < minBin) continue;
    const predicted = cell.sum / cell.n;
    const actual = cell.won / cell.n;
    rows.push({ lo: b / 10, predicted, actual, n: cell.n });
    weighted += cell.n * Math.abs(predicted - actual);
    total += cell.n;
  }
  return { error: total > 0 ? weighted / total : 0, bins: rows };
}

/** Severity thresholds from the observed regret distribution. Quantiles, not
 *  fixed point values, because the scale is ordinal and population-dependent:
 *  a "10-point mistake" means nothing until you know what 10 points is here. */
export function severityThresholds(regrets: number[]): {
  inaccuracy: number;
  mistake: number;
  blunder: number;
} {
  const sorted = [...regrets].sort((a, b) => a - b);
  const q = (f: number) =>
    sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  return { inaccuracy: q(0.75), mistake: q(0.9), blunder: q(0.98) };
}

export function severityOf(
  regret: number,
  t: { inaccuracy: number; mistake: number; blunder: number },
): "ok" | "inaccuracy" | "mistake" | "blunder" {
  if (regret >= t.blunder) return "blunder";
  if (regret >= t.mistake) return "mistake";
  if (regret >= t.inaccuracy) return "inaccuracy";
  return "ok";
}
