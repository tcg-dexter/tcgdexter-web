import { describe, it, expect } from "vitest";
import {
  localDateInTz,
  isStreakAlive,
  displayCurrentStreak,
  isStreakAtRisk,
  type StreakRow,
} from "./streak";

const row = (last: string | null, tz = "UTC", current = 5, longest = 9): StreakRow => ({
  current_streak: current,
  longest_streak: longest,
  last_logged_date: last,
  timezone: tz,
});

describe("localDateInTz", () => {
  it("formats the calendar day in the given zone", () => {
    const t = new Date("2026-07-22T12:00:00Z");
    expect(localDateInTz(t, "UTC")).toBe("2026-07-22");
  });

  it("respects timezone day boundaries", () => {
    // 02:00 UTC on the 22nd is still the 21st in Los Angeles (PDT, UTC-7).
    const t = new Date("2026-07-22T02:00:00Z");
    expect(localDateInTz(t, "UTC")).toBe("2026-07-22");
    expect(localDateInTz(t, "America/Los_Angeles")).toBe("2026-07-21");
  });

  it("falls back to UTC for an invalid zone", () => {
    const t = new Date("2026-07-22T12:00:00Z");
    expect(localDateInTz(t, "Not/AZone")).toBe(localDateInTz(t, "UTC"));
  });
});

describe("isStreakAlive", () => {
  const now = new Date("2026-07-22T12:00:00Z"); // today = 2026-07-22 (UTC)
  it("alive for today", () => expect(isStreakAlive("2026-07-22", "UTC", now)).toBe(true));
  it("alive for yesterday", () => expect(isStreakAlive("2026-07-21", "UTC", now)).toBe(true));
  it("lapsed for two days ago", () => expect(isStreakAlive("2026-07-20", "UTC", now)).toBe(false));
  it("dead when never logged", () => expect(isStreakAlive(null, "UTC", now)).toBe(false));
});

describe("displayCurrentStreak", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  it("shows the stored value while alive", () =>
    expect(displayCurrentStreak(row("2026-07-21"), now)).toBe(5));
  it("reads 0 once lapsed", () =>
    expect(displayCurrentStreak(row("2026-07-20"), now)).toBe(0));
  it("reads 0 with no row", () => expect(displayCurrentStreak(null, now)).toBe(0));
});

describe("isStreakAtRisk", () => {
  const now = new Date("2026-07-22T12:00:00Z");
  it("at risk when last logged was yesterday", () =>
    expect(isStreakAtRisk(row("2026-07-21"), now)).toBe(true));
  it("not at risk when already logged today", () =>
    expect(isStreakAtRisk(row("2026-07-22"), now)).toBe(false));
  it("not at risk once already lapsed", () =>
    expect(isStreakAtRisk(row("2026-07-20"), now)).toBe(false));
  it("not at risk with no row", () => expect(isStreakAtRisk(null, now)).toBe(false));
});
