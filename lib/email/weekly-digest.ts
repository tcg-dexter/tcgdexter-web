import type { SupabaseClient } from "@supabase/supabase-js";
import { put } from "@vercel/blob";
import { sendEmail } from "@/lib/email/send";
import { signUnsubToken } from "@/lib/email/unsubscribe";
import { weeklyDigestEmail } from "@/lib/email/digest-templates";
import {
  gatherSiteModules,
  gatherUserRecap,
  type SiteModules,
} from "@/lib/email/digest-data";
import { renderPlaymatPng } from "@/lib/email/playmat-render";

/**
 * Weekly digest mailer — the core job, decoupled from any trigger.
 *
 * Run by `scripts/weekly-digest.ts` on the mac mini (hourly via launchd).
 * Sends each opted-in user one digest per ISO week, gated to fire in their
 * local **Friday 7am** (timezone from user_streaks, else DEFAULT_TZ). The
 * per-user recap (follower/following gains, decks added, battles logged)
 * rides atop three site-wide modules (Battle of the Week, a new public
 * deck rendered in Playmat Studio, a newly released set).
 *
 * Best-effort + idempotent: dedup on (user, 'weekly_digest', ISO-week) in
 * reengagement_emails; a failed send rolls back its claim to retry next run.
 * Pass `{ dry: true }` to list targets without claiming/sending.
 */

const DIGEST_DOW = 5; // Friday (0 = Sunday)
const DIGEST_HOUR = 7; // 7am local
const DEFAULT_TZ = "America/New_York"; // for users with no stored timezone
const WINDOW_DAYS = 7;

export type WeeklyDigestSummary = {
  dry: boolean;
  isoWeek: string;
  candidateCount: number;
  sent: number;
  targets?: string[];
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://www.tcgdexter.com").replace(/\/$/, "");
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

/** Local weekday (0–6) + hour (0–23) for `now` in an IANA timezone. */
function localParts(now: Date, tz: string): { dow: number; hour: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz || DEFAULT_TZ,
      weekday: "short",
      hour: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(now);
    const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
    const hourStr = parts.find((p) => p.type === "hour")?.value ?? "0";
    const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return { dow: dowMap[wd] ?? 0, hour: parseInt(hourStr, 10) % 24 };
  } catch {
    return { dow: now.getUTCDay(), hour: now.getUTCHours() };
  }
}

/** ISO week key like "2026-W31" — the digest dedup key. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7; // Mon=1..Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - day); // nearest Thursday
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

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

export async function runWeeklyDigest(
  admin: SupabaseClient,
  opts: { now?: Date; dry?: boolean; forceSetId?: string; ignoreSchedule?: boolean } = {},
): Promise<WeeklyDigestSummary> {
  const now = opts.now ?? new Date();
  const dry = opts.dry ?? false;
  const isoWeek = isoWeekKey(now);
  const sinceIso = new Date(now.getTime() - WINDOW_DAYS * 86400_000).toISOString();

  // Opted-in recipients + their timezones (from user_streaks; else default).
  const { data: profiles } = await admin
    .from("profiles")
    .select("id")
    .eq("email_reengagement", true);
  const candidateIds = ((profiles ?? []) as { id: string }[]).map((p) => p.id);
  if (candidateIds.length === 0) {
    return { dry, isoWeek, candidateCount: 0, sent: 0, ...(dry ? { targets: [] } : {}) };
  }

  const { data: streakRows } = await admin
    .from("user_streaks")
    .select("user_id, timezone")
    .in("user_id", candidateIds);
  const tzByUser = new Map<string, string>();
  for (const r of (streakRows ?? []) as { user_id: string; timezone: string }[]) {
    if (r.timezone) tzByUser.set(r.user_id, r.timezone);
  }

  // Gate to users in their local Friday 7am — unless ignoreSchedule (a
  // manual one-time trigger), which targets every opted-in user now. Dedup
  // on the ISO week still prevents this from double-sending with the cron.
  const targets = opts.ignoreSchedule
    ? candidateIds
    : candidateIds.filter((id) => {
        const { dow, hour } = localParts(now, tzByUser.get(id) ?? DEFAULT_TZ);
        return dow === DIGEST_DOW && hour === DIGEST_HOUR;
      });

  if (dry) {
    return { dry, isoWeek, candidateCount: candidateIds.length, sent: 0, targets };
  }
  if (targets.length === 0) {
    return { dry, isoWeek, candidateCount: candidateIds.length, sent: 0 };
  }

  // Site-wide modules + Playmat PNG: computed once, reused for everyone this run.
  const site: SiteModules = await gatherSiteModules(admin, sinceIso, { forceSetId: opts.forceSetId });
  let deckWithImage: (NonNullable<SiteModules["deck"]> & { playmatImageUrl: string }) | null = null;
  if (site.deck) {
    try {
      const mat = await renderPlaymatPng(site.deck.deckList, { width: 960, siteUrl: baseUrl() });
      if (mat) {
        const key = `email/playmat-${isoWeek}-${site.deck.shortId ?? "deck"}.png`;
        const { url } = await put(key, mat.png, {
          access: "public",
          addRandomSuffix: false,
          allowOverwrite: true,
          token: process.env.BLOB_READ_WRITE_TOKEN,
        });
        deckWithImage = { ...site.deck, playmatImageUrl: url };
      }
    } catch (err) {
      console.error("[weekly-digest] playmat render/upload failed:", err);
    }
  }

  const emailMap = await buildEmailMap(admin);
  let sent = 0;

  const claim = async (userId: string): Promise<string | null> => {
    const { data, error } = await admin
      .from("reengagement_emails")
      .upsert(
        { user_id: userId, kind: "weekly_digest", dedup_key: isoWeek },
        { onConflict: "user_id,kind,dedup_key", ignoreDuplicates: true },
      )
      .select("id");
    if (error) {
      console.error("[weekly-digest] claim failed:", error);
      return null;
    }
    return data && data.length > 0 ? (data[0] as { id: string }).id : null;
  };

  for (const userId of targets) {
    const rowId = await claim(userId); // dedup: one digest per user per ISO week
    if (!rowId) continue;
    const to = emailMap.get(userId);
    if (!to) {
      await admin.from("reengagement_emails").delete().eq("id", rowId);
      continue;
    }
    const { data: prof } = await admin
      .from("profiles")
      .select("display_name, username")
      .eq("id", userId)
      .maybeSingle();
    const recipientName = prof?.display_name || prof?.username || "there";
    const recap = await gatherUserRecap(admin, userId, sinceIso);

    const { subject, html } = weeklyDigestEmail({
      siteUrl: baseUrl(),
      recipientName,
      recap,
      battle: site.battle,
      deck: deckWithImage,
      set: site.set,
      unsubUrl: unsubUrlFor(userId),
    });
    const res = await sendEmail({ to, subject, html, headers: unsubHeaders(userId) });
    if (res?.id) {
      await admin.from("reengagement_emails").update({ provider_message_id: res.id }).eq("id", rowId);
      sent++;
    } else {
      await admin.from("reengagement_emails").delete().eq("id", rowId);
    }
  }

  return { dry, isoWeek, candidateCount: candidateIds.length, sent };
}
