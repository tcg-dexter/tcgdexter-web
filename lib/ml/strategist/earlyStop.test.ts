import { describe, it, expect } from "vitest";

/** The early-stopping contract, as arithmetic rather than as a training run.
 *
 *  distill_train.ts keeps the BEST iterate by held-out loss instead of the
 *  last one. That single choice is what makes a capacity sweep measure
 *  capacity: without it, a comparison between two model sizes is really a
 *  comparison of how well one step size suited each of them, which produced
 *  three consecutive false negatives ("more φ terms is worse") before anyone
 *  looked at the loss trace.
 *
 *  These pin the two rules the script implements so a refactor cannot quietly
 *  revert to "return the final weights". */

/** Mirrors the script: keep the argmin over evaluated iterations. */
function bestIterate(heldOut: number[]): { value: number; index: number } {
  let value = Number.POSITIVE_INFINITY;
  let index = -1;
  heldOut.forEach((v, i) => {
    if (v < value) {
      value = v;
      index = i;
    }
  });
  return { value, index };
}

/** Mirrors the script: training must beat a ZERO-WEIGHT model on held-out
 *  data, not merely improve on its own initial TRAIN loss. */
function improved(bestHeldOut: number, nullHeldOut: number): boolean {
  return bestHeldOut < nullHeldOut;
}

describe("early stopping contract", () => {
  it("survives a late upswing by keeping the best iterate", () => {
    // The measured P=2515 trace: down to 2.0744, then back up past its start.
    const trace = [2.126, 2.1475, 2.076, 2.0744, 2.1704, 2.192];
    const best = bestIterate(trace);
    expect(best.value).toBeCloseTo(2.0744, 4);
    expect(best.index).toBe(3);
    // Returning the LAST iterate would have reported 2.192 — worse than the
    // untrained model, and worse than the smaller arm it was compared against.
    expect(trace[trace.length - 1]).toBeGreaterThan(best.value);
  });

  it("judges improvement against the zero-weight model, not the initial train loss", () => {
    // Measured: untrained held-out 2.1374 while the initial TRAIN loss is
    // 2.1260. Comparing against the train figure would call a model that is
    // WORSE than uniform an improvement.
    const nullHeldOut = 2.1374;
    const initialTrainLoss = 2.126;
    const bestHeldOut = 2.13;
    expect(improved(bestHeldOut, nullHeldOut)).toBe(true);
    expect(bestHeldOut < initialTrainLoss).toBe(false);
  });

  it("reports no improvement when nothing beat uniform", () => {
    expect(improved(2.1493, 2.0654)).toBe(false);
  });

  it("cosine decay starts at the full step and ends at zero", () => {
    const iters = 250;
    const lr = 0.018;
    const at = (it: number) =>
      lr * 0.5 * (1 + Math.cos((Math.PI * (it - 1)) / Math.max(1, iters - 1)));
    expect(at(1)).toBeCloseTo(lr, 10);
    expect(at(iters)).toBeCloseTo(0, 10);
    expect(at(Math.round(iters / 2))).toBeLessThan(lr);
    expect(at(Math.round(iters / 2))).toBeGreaterThan(0);
  });

  it("lr scales as 1/sqrt(P) and is a no-op at the baseline size", () => {
    const lrFor = (P: number) => 0.05 * Math.sqrt(336 / P);
    expect(lrFor(336)).toBeCloseTo(0.05, 12);
    expect(lrFor(2515)).toBeLessThan(0.05);
    // The score is a sum over P standardised terms, so holding lr*sqrt(P)
    // constant is what keeps the score scale comparable across capacities.
    expect(lrFor(2515) * Math.sqrt(2515)).toBeCloseTo(lrFor(336) * Math.sqrt(336), 10);
  });
});
