import { describe, it, expect } from "vitest";

import { hashSeed } from "@/lib/engine/sim";
import { numOrNull, seedOrLabel } from "./guards";

describe("seedOrLabel", () => {
  it("passes numeric seeds through unchanged", () => {
    expect(seedOrLabel("7", 1, hashSeed)).toBe(7);
    expect(seedOrLabel("0", 5, hashSeed)).toBe(0);
  });

  it("falls back only when the seed is genuinely absent", () => {
    expect(seedOrLabel(null, 11, hashSeed)).toBe(11);
    expect(seedOrLabel(undefined, 11, hashSeed)).toBe(11);
    expect(seedOrLabel("  ", 11, hashSeed)).toBe(11);
  });

  it("hashes a LABEL instead of silently falling back", () => {
    // The bug this exists to prevent: `numOrNull("run-a") ?? 1` is 1, so a
    // sweep over "run-a","run-b",… ran the SAME games every time and pooled
    // them into a confident, TIGHTER-than-real confidence interval. No error,
    // no warning — the only symptom was byte-identical rows.
    expect(numOrNull("run-a")).toBeNull(); // the trap, pinned
    expect(seedOrLabel("run-a", 1, hashSeed)).not.toBe(1);
  });

  it("gives DISTINCT seeds to distinct labels", () => {
    const seeds = ["alpha", "beta", "gamma", "run-a", "run-b"].map((s) =>
      seedOrLabel(s, 1, hashSeed),
    );
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("is deterministic — the same label always gives the same seed", () => {
    expect(seedOrLabel("bo3-main", 1, hashSeed)).toBe(seedOrLabel("bo3-main", 1, hashSeed));
  });
});
