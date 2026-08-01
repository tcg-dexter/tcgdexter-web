import { describe, expect, it } from "vitest";
import { evaluateCalibration, fitLinear, type CalibrationPoint } from "./deckGradeCalibration";

const pts = (pairs: [number, number][]): CalibrationPoint[] =>
  pairs.map(([sim, real], i) => ({ sim, real, label: `d${i}` }));

describe("fitLinear", () => {
  it("recovers a clean linear relationship", () => {
    const f = fitLinear(pts([[0.2, 0.45], [0.4, 0.50], [0.6, 0.55], [0.8, 0.60]]));
    expect(f.slope).toBeCloseTo(0.25, 5);
    expect(f.intercept).toBeCloseTo(0.40, 5);
  });

  it("collapses to slope 0 when the simulator has no signal", () => {
    // This IS the null model, and the reason scoring must be out-of-sample.
    const f = fitLinear(pts([[0.2, 0.52], [0.8, 0.52], [0.3, 0.52], [0.9, 0.52]]));
    expect(f.slope).toBeCloseTo(0, 6);
  });
});

describe("evaluateCalibration (leave-one-out)", () => {
  it("reports positive skill when the simulator genuinely ranks decks", () => {
    const r = evaluateCalibration(
      pts([[0.20, 0.46], [0.35, 0.49], [0.50, 0.52], [0.65, 0.55], [0.80, 0.58]]),
    );
    expect(r.skill).toBeGreaterThan(0);
    expect(r.rmsePoints).toBeLessThan(r.nullRmsePoints);
  });

  it("reports NEGATIVE skill when sim order is unrelated to reality", () => {
    // The case that matters: a fit on all points would still look tidy, but
    // leave-one-out exposes that it predicts nothing a mean wouldn't — in
    // fact worse, because it spends a degree of freedom estimating a slope
    // that is noise.
    //
    // Note these are UNCORRELATED, not inversely correlated. An inverse
    // relationship is still signal (you would simply flip it), and my first
    // attempt at this test used one and correctly reported positive skill.
    const r = evaluateCalibration(
      pts([[0.20, 0.55], [0.40, 0.48], [0.60, 0.56], [0.80, 0.49], [0.50, 0.52]]),
    );
    expect(r.skill).toBeLessThan(0);
  });

  it("never scores a deck with a model that saw it", () => {
    // A single wild outlier must not be able to fit itself. With LOO its own
    // prediction comes from the other four, so the error stays large.
    const r = evaluateCalibration(
      pts([[0.50, 0.52], [0.51, 0.52], [0.49, 0.52], [0.50, 0.53], [0.99, 0.30]]),
    );
    const outlier = r.predictions[4];
    expect(Math.abs(outlier.predicted - outlier.real)).toBeGreaterThan(0.1);
  });
});
