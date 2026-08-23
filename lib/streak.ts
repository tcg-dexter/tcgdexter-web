import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Daily battle-logging streak — shared types + day-math.
 *
 * The streak counts consecutive calendar days on which the user logged a
 * battle, bucketed by `matches.created_at` in the user's timezone. The DB
 * function `bump_match_streak` (security definer, keyed off auth.uid())
 * owns the write; this module owns the read-side "is it still alive?"
 * logic so the profile and the at-risk nudge agree with the celebration.
 */

export interface StreakState {
  current: number;
  longest: number;
  /** True when this log actually advanced/started the streak (vs. a second
   *  battle the same day, which maintains it) — drives celebration copy. */
  changed: boolean;
}

export interface StreakRow {
  current_streak: number;
  longest_streak: number;
  last_logged_date: string | null; // 'YYYY-MM-DD'
  timezone: string;
}

/** 'YYYY-MM-DD' for `date` in the given IANA timezone (falls back to UTC
 *  for an empty/invalid zone). */
export function localDateInTz(date: Date, tz: string): string {
  const fmt = (zone: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  try {
    return fmt(tz || "UTC");
  } catch {
    return fmt("UTC");
  }
}

/** Add `delta` days to a 'YYYY-MM-DD' string (calendar math, tz-agnostic). */
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

/** A streak is "alive" only if the last logged day is today or yesterday
 *  in its stored timezone; otherwise it has lapsed and reads as 0. This is
 *  why no nightly reset job is needed. */
export function isStreakAlive(
  lastLoggedDate: string | null,
  tz: string,
  now: Date = new Date(),
): boolean {
  if (!lastLoggedDate) return false;
  const today = localDateInTz(now, tz);
  return lastLoggedDate === today || lastLoggedDate === addDays(today, -1);
}

/** The current streak to DISPLAY: the stored value while alive, else 0. */
export function displayCurrentStreak(
  row: StreakRow | null | undefined,
  now: Date = new Date(),
): number {
  if (!row) return 0;
  return isStreakAlive(row.last_logged_date, row.timezone, now)
    ? row.current_streak
    : 0;
}

/** Alive but today isn't logged yet — the "log today to keep it" state. */
export function isStreakAtRisk(
  row: StreakRow | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!row?.last_logged_date) return false;
  const today = localDateInTz(now, row.timezone);
  return row.last_logged_date === addDays(today, -1);
}

/**
 * Record today's activity for the authenticated caller and return the
 * resulting streak. Streaks are non-critical: any failure resolves to
 * `null` so it can never break battle logging.
 */
export async function bumpBattleStreak(
  supabase: SupabaseClient,
  localDate: string,
  tz: string,
): Promise<StreakState | null> {
  try {
    const { data, error } = await supabase.rpc("bump_match_streak", {
      p_local_date: localDate,
      p_tz: tz || "UTC",
    });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    const row = data[0] as {
      out_current: number;
      out_longest: number;
      out_changed: boolean;
    };
    return {
      current: row.out_current,
      longest: row.out_longest,
      changed: row.out_changed,
    };
  } catch {
    return null;
  }
}
