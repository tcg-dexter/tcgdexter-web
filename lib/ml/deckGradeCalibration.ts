// Turning a raw simulated win rate into a PREDICTED real win rate.
//
// The simulator outputs 26%-83% where the real meta spans 46.6%-58.1%. That
// is not a 30-point error in the simulator's understanding so much as an
// uncalibrated scale: a model's raw score is not a prediction until it has a
// link function, and every serious forecasting system fits one.
//
// The danger is obvious and I want it written down rather than discovered
// later: fitting `real ~ a + b*sim` on all 16 archetypes and then reporting
// the fit's error is circular, and when the simulator has no signal the fit
// degenerates to b=0 — i.e. it reproduces the null model ("every deck is
// 52.8%"), which scores a flattering RMSE of 3.16 while knowing nothing.
//
// So the fit is evaluated LEAVE-ONE-OUT: each archetype is predicted by a
// model that never saw it. The null model is scored the same way (predict the
// mean of the OTHER decks). If the calibrated simulator beats the null model
// out-of-sample, it carries real information; if it does not, we have learned
// that it doesn't, which is the answer we needed either way.

export interface CalibrationPoint {
  /** Raw simulated win rate vs the field, 0..1. */
  sim: number;
  /** Observed real win rate, 0..1. */
  real: number;
  label?: string;
}

export interface LinearFit {
  intercept: number;
  slope: number;
}

/** Ordinary least squares of `real` on `sim`. Slope collapses to 0 when the
 *  simulator has no signal — which is exactly the null model, and precisely
 *  why this must be scored out-of-sample. */
export function fitLinear(points: CalibrationPoint[]): LinearFit {
  const n = points.length;
  if (n === 0) return { intercept: 0.5, slope: 0 };
  const mx = points.reduce((s, p) => s + p.sim, 0) / n;
  const my = points.reduce((s, p) => s + p.real, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.sim - mx) * (p.real - my);
    den += (p.sim - mx) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return { intercept: my - slope * mx, slope };
}

export function applyFit(fit: LinearFit, sim: number): number {
  return fit.intercept + fit.slope * sim;
}

export interface CalibrationReport {
  /** Out-of-sample RMSE of the calibrated simulator, in win-rate POINTS. */
  rmsePoints: number;
  /** Out-of-sample RMSE of the null model, same protocol, in POINTS. */
  nullRmsePoints: number;
  /** 1 - rmse/nullRmse. Positive means the simulator carries information. */
  skill: number;
  /** Fit over ALL points — for reporting the relationship, never for scoring. */
  fullFit: LinearFit;
  /** Per-deck out-of-sample predictions, for inspection. */
  predictions: { label?: string; sim: number; real: number; predicted: number }[];
}

/** Leave-one-out evaluation. Every prediction comes from a fit that excluded
 *  the deck being predicted, and the null baseline is held to the same rule. */
export function evaluateCalibration(points: CalibrationPoint[]): CalibrationReport {
  const n = points.length;
  const predictions: CalibrationReport["predictions"] = [];
  let se = 0;
  let nullSe = 0;
  for (let i = 0; i < n; i++) {
    const rest = points.filter((_, j) => j !== i);
    const fit = fitLinear(rest);
    const predicted = applyFit(fit, points[i].sim);
    const nullPredicted = rest.reduce((s, p) => s + p.real, 0) / Math.max(1, rest.length);
    se += (predicted - points[i].real) ** 2;
    nullSe += (nullPredicted - points[i].real) ** 2;
    predictions.push({
      label: points[i].label,
      sim: points[i].sim,
      real: points[i].real,
      predicted,
    });
  }
  const rmse = Math.sqrt(se / Math.max(1, n)) * 100;
  const nullRmse = Math.sqrt(nullSe / Math.max(1, n)) * 100;
  return {
    rmsePoints: rmse,
    nullRmsePoints: nullRmse,
    skill: nullRmse === 0 ? 0 : 1 - rmse / nullRmse,
    fullFit: fitLinear(points),
    predictions,
  };
}
