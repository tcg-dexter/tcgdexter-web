import { describe, it, expect } from "vitest";
import { nearBadgeFor } from "./near-badge";

describe("nearBadgeFor", () => {
  it("returns null when nothing is within the window", () => {
    expect(nearBadgeFor(0, 0)).toBeNull(); // 5 / 10 away
    expect(nearBadgeFor(3, 0)).toBeNull(); // 2 decks away, 10 battles away
  });

  it("nudges one deck before the next deck tier", () => {
    const n = nearBadgeFor(4, 0);
    expect(n).toMatchObject({ key: "decks_5", metric: "decks", remaining: 1, badgeName: "Developer" });
  });

  it("nudges one battle before the next battle tier", () => {
    const n = nearBadgeFor(0, 9);
    expect(n).toMatchObject({ key: "battles_10", metric: "battles", remaining: 1, badgeName: "Hobbyist" });
  });

  it("works at higher tiers (49 → Dexter, 99 → Tabletop Titan)", () => {
    expect(nearBadgeFor(49, 0)).toMatchObject({ key: "decks_50", remaining: 1 });
    expect(nearBadgeFor(0, 99)).toMatchObject({ key: "battles_100", remaining: 1 });
  });

  it("returns null once past the top tier", () => {
    expect(nearBadgeFor(50, 100)).toBeNull();
    expect(nearBadgeFor(120, 250)).toBeNull();
  });

  it("picks the closer of two eligible badges; ties break to decks", () => {
    // both 1 away → decks wins the tie
    expect(nearBadgeFor(4, 9)).toMatchObject({ key: "decks_5" });
    // battles strictly closer with a wider window
    expect(nearBadgeFor(3, 9, 2)).toMatchObject({ key: "battles_10", remaining: 1 });
  });

  it("respects a wider window", () => {
    expect(nearBadgeFor(3, 0, 2)).toMatchObject({ key: "decks_5", remaining: 2 });
  });

  it("never surfaces first_* onboarding badges", () => {
    // 0 decks is 1 away from first_save (threshold 1) but that's excluded,
    // and 5 decks away from the first milestone → null.
    expect(nearBadgeFor(0, 0)).toBeNull();
  });
});
