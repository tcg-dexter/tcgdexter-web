import { createAdminClient } from "@/lib/supabase/admin";
import { CATALOG, type AchievementKey } from "@/lib/learn/achievements";

/**
 * In-app notification writers. Fire-and-forget, mirroring lib/analytics/track.ts:
 * every function resolves to void, awaits its own writes, and swallows + logs
 * any error so a notification can never fail the user request that triggered it.
 *
 * Writes go through the service-role admin client because the common case is a
 * CROSS-user insert — a liker writing a row for the deck OWNER — which no RLS
 * INSERT policy can sanely permit. Recipients only ever SELECT/mark-read their
 * own rows (see the notifications RLS policies).
 *
 * A future opt-out (notification_prefs) would slot in as an early return at the
 * top of each notify* function; v1 is always-on (low volume).
 */

export type NotificationType = "deck_liked" | "badge_unlocked";

/** Shape of the `data` jsonb, discriminated by notification type. Snapshotted
 *  at write time so the feed renders without joins. */
export interface DeckLikedData {
  actor_display_name: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
  deck_name: string;
  deck_short_id: string | null;
}

export interface BadgeUnlockedData {
  badge_key: string;
  badge_name: string;
}

export interface NotificationRow {
  id: string;
  recipient_user_id: string;
  actor_user_id: string | null;
  type: string;
  saved_deck_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

/**
 * Someone liked a public deck → notify the deck's owner. Suppressed when the
 * liker is the owner (you can like your own public deck) or the deck can't be
 * resolved. Upserts on the (recipient, actor, deck, type) dedup index so a
 * re-like refreshes the row and re-surfaces it as unread rather than stacking.
 */
export async function notifyDeckLiked(args: {
  deckId: string;
  actorId: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: deck } = await admin
      .from("saved_decks")
      .select("user_id, name, short_id")
      .eq("id", args.deckId)
      .maybeSingle();

    const ownerId = deck?.user_id as string | undefined;
    // No owner, or you liked your own deck → nothing to notify.
    if (!ownerId || ownerId === args.actorId) return;

    const { data: actor } = await admin
      .from("profiles")
      .select("display_name, username, avatar_url")
      .eq("id", args.actorId)
      .maybeSingle();

    const data: DeckLikedData = {
      actor_display_name: actor?.display_name ?? null,
      actor_username: actor?.username ?? null,
      actor_avatar_url: actor?.avatar_url ?? null,
      deck_name: (deck?.name as string) ?? "your deck",
      deck_short_id: (deck?.short_id as string | null) ?? null,
    };

    const { error } = await admin.from("notifications").upsert(
      {
        recipient_user_id: ownerId,
        actor_user_id: args.actorId,
        type: "deck_liked" satisfies NotificationType,
        saved_deck_id: args.deckId,
        data,
        read_at: null,
        created_at: new Date().toISOString(),
      },
      { onConflict: "recipient_user_id,actor_user_id,saved_deck_id,type" },
    );
    if (error) {
      console.error("[notify] deck_liked upsert failed:", error);
    }
  } catch (err) {
    console.error("[notify] notifyDeckLiked threw:", err);
  }
}

/**
 * A user earned an achievement badge → notify them. Recipient is the user
 * themselves (badges are self-earned), but we still use the admin client for
 * a uniform write path. Callers pass only newly-awarded keys (reconcile
 * returns exactly those), so no dedup is needed.
 */
export async function notifyBadgeUnlocked(args: {
  recipientId: string;
  badgeKey: AchievementKey;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const badgeName =
      CATALOG.find((d) => d.key === args.badgeKey)?.name ?? "a new";

    const data: BadgeUnlockedData = {
      badge_key: args.badgeKey,
      badge_name: badgeName,
    };

    const { error } = await admin.from("notifications").insert({
      recipient_user_id: args.recipientId,
      actor_user_id: null,
      type: "badge_unlocked" satisfies NotificationType,
      saved_deck_id: null,
      data,
    });
    if (error) {
      console.error("[notify] badge_unlocked insert failed:", error);
    }
  } catch (err) {
    console.error("[notify] notifyBadgeUnlocked threw:", err);
  }
}

/**
 * Fan a batch of newly-awarded badge keys out to notifications. Convenience
 * for the reconcile call sites, which get back the freshly-inserted keys and
 * want one notification each. Fire-and-forget; each write is error-swallowed.
 */
export async function notifyBadgesUnlocked(
  recipientId: string,
  badgeKeys: AchievementKey[],
): Promise<void> {
  for (const badgeKey of badgeKeys) {
    await notifyBadgeUnlocked({ recipientId, badgeKey });
  }
}

/**
 * Human-readable one-line message for a notification. Pure (no DB) so it's
 * shared by the list UI and unit tests. Renders from the snapshotted `data`.
 */
export function formatNotificationMessage(n: {
  type: string;
  data: Record<string, unknown>;
}): string {
  if (n.type === "deck_liked") {
    const d = n.data as unknown as DeckLikedData;
    const who = d.actor_display_name || d.actor_username || "Someone";
    return `${who} liked your deck ${d.deck_name}`;
  }
  if (n.type === "badge_unlocked") {
    const d = n.data as unknown as BadgeUnlockedData;
    return `You earned the ${d.badge_name} badge`;
  }
  return "You have a new notification";
}
