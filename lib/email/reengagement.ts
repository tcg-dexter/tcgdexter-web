import type { SupabaseClient } from "@supabase/supabase-js";
import { isStreakAtRisk, localDateInTz, type StreakRow } from "@/lib/streak";
import { nearBadgeFor } from "@/lib/email/near-badge";
import { sendEmail } from "@/lib/email/send";
import { streakAtRiskEmail, nearBadgeEmail } from "@/lib/email/templates";
import { signUnsubToken } from "@/lib/email/unsubscribe";

/**
 * Re-engagement mailer — the core job, decoupled from any trigger.
 *
 * Run by `scripts/reengagement.ts` on the mac mini (hourly via launchd),
 * NOT by a Vercel cron. Two passes:
 *   • streak-at-risk — every run, timezone-aware: users with current_streak
 *     >= 2 whose streak is alive but today is unlogged, in their local
 *     evening. Once per user per local day (dedup on the local date).
 *   • near-next-badge — once per day (NEAR_BADGE_UTC_HOUR): users exactly
 *     one milestone-step away. Once per badge ever (dedup on the badge key).
 *
 * Best-effort: `sendEmail` no-ops without a Resend key, and every claim is
 * rolled back if the send doesn't succeed, so a transient failure retries.
 * Pass `{ dry: true }` to compute the target list without claiming/sending.
 */

const EVENING_START = 18; // local-hour window (inclusive) for streak sends
const EVENING_END = 21; // exclusive
const NEAR_BADGE_UTC_HOUR = 16; // near-badge pass runs once/day at this UTC hour
const NEAR_BADGE_WINDOW = 1; // "1 away" from the next milestone

export type ReengagementTarget = {
  userId: string;
  kind: "streak_at_risk" | "near_badge";
  streak?: number;
  badge?: string;
  remaining?: number;
  localHour?: number;
};

export type ReengagementSummary = {
  dry: boolean;
  utcHour: number;
  nearBadgePass: boolean;
  targetCount: number;
  sent: number;
  targets?: ReengagementTarget[];
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://tcgdexter.com").replace(/\/$/, "");
}

function unsubUrlFor(userId: string): string {
  return `${baseUrl()}/api/email/unsubscribe?token=${encodeURIComponent(signUnsubToken(userId))}`;
}

function unsubHeaders(userId: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${unsubUrlFor(userId)}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Local hour (0–23) for `now` in an IANA timezone; UTC on failure. */
function localHourInTz(now: Date, tz: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || "UTC",
      hour: "2-digit",
      hour12: false,
    }).format(now);
    const h = parseInt(s, 10);
    return Number.isFinite(h) ? h % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

/** userId → email map, paginated (one pass, matches the CRM contacts sync). */
async function buildEmailMap(admin: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const perPage = 1000;
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) break;
    for (const u of data.users) if (u.email) map.set(u.id, u.email);
    if (data.users.length < perPage) break;
  }
  return map;
}

export async function runReengagement(
  admin: SupabaseClient,
  opts: { now?: Date; dry?: boolean } = {},
): Promise<ReengagementSummary> {
  const now = opts.now ?? new Date();
  const dry = opts.dry ?? false;
  const utcHour = now.getUTCHours();

  const targets: ReengagementTarget[] = [];
  let sent = 0;
  const streakedUsers = new Set<string>();

  // Emails are only needed for live sends — build the map lazily so a dry
  // run (and a run with no eligible users) never lists the whole user base.
  let emailMap: Map<string, string> | null = null;
  const emailFor = async (userId: string): Promise<string | null> => {
    if (!emailMap) emailMap = await buildEmailMap(admin);
    return emailMap.get(userId) ?? null;
  };

  const optedIn = async (ids: string[]): Promise<Set<string>> => {
    if (ids.length === 0) return new Set();
    const { data } = await admin
      .from("profiles")
      .select("id")
      .eq("email_reengagement", true)
      .in("id", ids);
    return new Set(((data ?? []) as { id: string }[]).map((r) => r.id));
  };

  // Claim a dedup slot (on conflict do nothing). Returns the new row id, or
  // null if this (user, kind, key) was already sent.
  const claim = async (
    userId: string,
    kind: ReengagementTarget["kind"],
    dedupKey: string,
  ): Promise<string | null> => {
    const { data, error } = await admin
      .from("reengagement_emails")
      .upsert(
        { user_id: userId, kind, dedup_key: dedupKey },
        { onConflict: "user_id,kind,dedup_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.error("[reengagement] claim failed:", error);
      return null;
    }
    return data && data.length > 0 ? (data[0] as { id: string }).id : null;
  };

  const finalize = async (rowId: string, res: { id: string } | null) => {
    if (res?.id) {
      await admin
        .from("reengagement_emails")
        .update({ provider_message_id: res.id })
        .eq("id", rowId);
      sent++;
    } else {
      // Roll back the claim so a transient failure retries next run.
      await admin.from("reengagement_emails").delete().eq("id", rowId);
    }
  };

  // ── Streak-at-risk pass (every run) ──────────────────────────────
  {
    const { data: rows } = await admin
      .from("user_streaks")
      .select("user_id, current_streak, longest_streak, last_logged_date, timezone")
      .gte("current_streak", 2);

    const candidates: { userId: string; streak: number; tz: string; localDate: string }[] = [];
    for (const r of (rows ?? []) as (StreakRow & { user_id: string })[]) {
      if (!isStreakAtRisk(r, now)) continue;
      const lh = localHourInTz(now, r.timezone);
      if (lh < EVENING_START || lh >= EVENING_END) continue;
      candidates.push({
        userId: r.user_id,
        streak: r.current_streak,
        tz: r.timezone,
        localDate: localDateInTz(now, r.timezone),
      });
    }

    const opted = await optedIn(candidates.map((c) => c.userId));
    for (const c of candidates) {
      if (!opted.has(c.userId)) continue;
      streakedUsers.add(c.userId);
      targets.push({
        userId: c.userId,
        kind: "streak_at_risk",
        streak: c.streak,
        localHour: localHourInTz(now, c.tz),
      });
      if (dry) continue;

      const rowId = await claim(c.userId, "streak_at_risk", c.localDate);
      if (!rowId) continue; // already sent today
      const to = await emailFor(c.userId);
      if (!to) {
        await admin.from("reengagement_emails").delete().eq("id", rowId);
        continue;
      }
      const { subject, html } = streakAtRiskEmail({
        siteUrl: baseUrl(),
        streak: c.streak,
        ctaUrl: `${baseUrl()}/my-decks`,
        unsubUrl: unsubUrlFor(c.userId),
      });
      const res = await sendEmail({ to, subject, html, headers: unsubHeaders(c.userId) });
      await finalize(rowId, res);
    }
  }

  // ── Near-badge pass (once per day) ───────────────────────────────
  if (utcHour === NEAR_BADGE_UTC_HOUR) {
    const { data: counts } = await admin.rpc("get_activity_counts");
    const eligible: {
      userId: string;
      near: NonNullable<ReturnType<typeof nearBadgeFor>>;
    }[] = [];
    for (const row of (counts ?? []) as {
      user_id: string;
      deck_count: number;
      match_count: number;
    }[]) {
      if (streakedUsers.has(row.user_id)) continue; // one email per user per run
      const near = nearBadgeFor(Number(row.deck_count), Number(row.match_count), NEAR_BADGE_WINDOW);
      if (near) eligible.push({ userId: row.user_id, near });
    }

    const opted = await optedIn(eligible.map((e) => e.userId));
    for (const e of eligible) {
      if (!opted.has(e.userId)) continue;
      targets.push({
        userId: e.userId,
        kind: "near_badge",
        badge: e.near.key,
        remaining: e.near.remaining,
      });
      if (dry) continue;

      const rowId = await claim(e.userId, "near_badge", e.near.key);
      if (!rowId) continue; // already nudged for this badge
      const to = await emailFor(e.userId);
      if (!to) {
        await admin.from("reengagement_emails").delete().eq("id", rowId);
        continue;
      }
      const isDecks = e.near.metric === "decks";
      const n = e.near.remaining;
      const action = isDecks
        ? `save ${n} more deck${n === 1 ? "" : "s"}`
        : `log ${n} more match${n === 1 ? "" : "es"}`;
      const { subject, html } = nearBadgeEmail({
        siteUrl: baseUrl(),
        badgeName: e.near.badgeName,
        badgeImageUrl: `${baseUrl()}/badges/${e.near.key}.png`,
        remaining: n,
        action,
        ctaUrl: isDecks ? `${baseUrl()}/` : `${baseUrl()}/my-decks`,
        ctaLabel: isDecks ? "Build a deck" : "Log a match",
        unsubUrl: unsubUrlFor(e.userId),
      });
      const res = await sendEmail({ to, subject, html, headers: unsubHeaders(e.userId) });
      await finalize(rowId, res);
    }
  }

  return {
    dry,
    utcHour,
    nearBadgePass: utcHour === NEAR_BADGE_UTC_HOUR,
    targetCount: targets.length,
    sent,
    ...(dry ? { targets } : {}),
  };
}
