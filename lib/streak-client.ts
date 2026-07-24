import type { StreakState } from "@/lib/streak";

/**
 * Client-side streak helpers. Kept separate from `lib/streak.ts` (which
 * pulls a server Supabase type) so client bundles stay clean.
 */

/** The browser's IANA timezone, for bucketing the daily-logging streak. */
export function clientTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Fire the log-time streak celebration. Any match-logging success handler
 * calls this with the `streak` returned by the API; the single mounted
 * `<StreakToast />` (in the root layout) listens and renders. A null/zero
 * streak is a no-op, so callers can pass through the response unguarded.
 */
export function celebrateStreak(streak: StreakState | null | undefined): void {
  if (!streak || streak.current <= 0 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("dx:streak", { detail: streak }));
}
