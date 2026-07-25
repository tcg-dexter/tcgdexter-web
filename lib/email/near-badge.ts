import { CATALOG, CATALOG_BY_KEY, type AchievementKey } from "@/lib/learn/achievements";

/**
 * "Near next badge" computation for the re-engagement cron. Milestone
 * thresholds are derived from the achievements catalog (the numeric
 * `decks_N` / `matches_N` keys); the `first_*` onboarding badges and the
 * quiz badge are intentionally excluded — we only nudge users who already
 * have traction and are close to the next tier.
 */

export type MetricKind = "decks" | "matches";

export interface NearBadge {
  key: AchievementKey;
  badgeName: string;
  metric: MetricKind;
  threshold: number;
  remaining: number;
}

function tiers(prefix: MetricKind): { key: AchievementKey; threshold: number }[] {
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  return CATALOG.map((d) => {
    const m = re.exec(d.key);
    return m ? { key: d.key, threshold: Number(m[1]) } : null;
  })
    .filter((x): x is { key: AchievementKey; threshold: number } => x !== null)
    .sort((a, b) => a.threshold - b.threshold);
}

const DECK_TIERS = tiers("decks");
const MATCH_TIERS = tiers("matches");

function nextTier(
  arr: { key: AchievementKey; threshold: number }[],
  count: number,
): { key: AchievementKey; threshold: number } | null {
  for (const t of arr) if (count < t.threshold) return t;
  return null;
}

/**
 * The single best near-badge nudge for a user, or null. Eligible only when
 * the user is within `window` of (and at least 1 away from) the next
 * milestone. When both a deck and a match badge qualify, the closer one
 * wins (ties break to decks).
 */
export function nearBadgeFor(
  deckCount: number,
  matchCount: number,
  window = 1,
): NearBadge | null {
  const candidates: NearBadge[] = [];
  const dt = nextTier(DECK_TIERS, deckCount);
  if (dt) {
    candidates.push({
      key: dt.key,
      badgeName: CATALOG_BY_KEY[dt.key].name,
      metric: "decks",
      threshold: dt.threshold,
      remaining: dt.threshold - deckCount,
    });
  }
  const mt = nextTier(MATCH_TIERS, matchCount);
  if (mt) {
    candidates.push({
      key: mt.key,
      badgeName: CATALOG_BY_KEY[mt.key].name,
      metric: "matches",
      threshold: mt.threshold,
      remaining: mt.threshold - matchCount,
    });
  }
  const eligible = candidates
    .filter((c) => c.remaining >= 1 && c.remaining <= window)
    .sort((a, b) => a.remaining - b.remaining);
  return eligible[0] ?? null;
}
