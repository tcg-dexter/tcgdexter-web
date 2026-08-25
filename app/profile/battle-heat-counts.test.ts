import { describe, expect, it } from "vitest";
import { buildHeatCounts } from "./BattleHeatMap";

/**
 * Guards the shape of the heat grid's data.
 *
 * These exist because the grid fails QUIETLY when this is wrong. A wrong
 * week count doesn't throw and doesn't look broken in code review — it
 * renders a correctly-shaped, entirely empty grid, which is what shipped
 * to the trainer directory once. Anything that returns fewer cells than
 * `weeks * 7` should fail here rather than on a page.
 */

const DAYS = 7;

/** Local YYYY-MM-DD, matching the key the grid buckets on. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday, so a timezone shift can't move the date
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

describe("buildHeatCounts", () => {
  it("returns exactly weeks x 7 cells", () => {
    expect(buildHeatCounts([], 7)).toHaveLength(49);
    expect(buildHeatCounts([], 20)).toHaveLength(140);
    expect(buildHeatCounts([], 1)).toHaveLength(7);
  });

  it("fills a grid with no battles with zeroes, not with nothing", () => {
    const counts = buildHeatCounts([], 7);
    // Every cell is either a real zero or a future day (-1); none missing.
    expect(counts.every((c) => c === 0 || c === -1)).toBe(true);
    expect(counts.filter((c) => c === 0).length).toBeGreaterThan(0);
  });

  it("counts a battle on today's cell", () => {
    const counts = buildHeatCounts(
      [{ played_at: daysAgo(0), created_at: daysAgo(0) }],
      7,
    );
    expect(counts.filter((c) => c === 1)).toHaveLength(1);
  });

  it("stacks same-day battles into one cell", () => {
    const day = daysAgo(3);
    const counts = buildHeatCounts(
      [
        { played_at: day, created_at: day },
        { played_at: day, created_at: day },
        { played_at: day, created_at: day },
      ],
      7,
    );
    expect(counts.filter((c) => c > 0)).toEqual([3]);
  });

  it("buckets on played_at, falling back to created_at", () => {
    // Logged today, played six days ago — belongs on the day it was played.
    const viaPlayedAt = buildHeatCounts(
      [{ played_at: daysAgo(6), created_at: daysAgo(0) }],
      7,
    );
    const viaCreatedAt = buildHeatCounts(
      [{ played_at: null, created_at: daysAgo(6) }],
      7,
    );
    expect(viaPlayedAt).toEqual(viaCreatedAt);
  });

  it("drops battles older than the window instead of clamping them in", () => {
    const counts = buildHeatCounts(
      [{ played_at: daysAgo(200), created_at: daysAgo(200) }],
      7,
    );
    expect(counts.every((c) => c <= 0)).toBe(true);
  });

  it("marks days later than today as future, only in the last column", () => {
    const counts = buildHeatCounts([], 7);
    const futureIndexes = counts
      .map((c, i) => (c === -1 ? i : -1))
      .filter((i) => i >= 0);
    // Row-major over 7 columns, so the rightmost column is index % 7 === 6.
    expect(futureIndexes.every((i) => i % DAYS === DAYS - 1)).toBe(true);
  });
});
