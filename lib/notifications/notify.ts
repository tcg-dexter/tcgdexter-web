import { createAdminClient } from "@/lib/supabase/admin";
import { CATALOG, type AchievementKey } from "@/lib/learn/achievements";
import { deckAvatarInfo, pokemonSlug } from "@/lib/primaryCardImage";
import { typeColor } from "@/lib/metaPrimaryCard";

/** Limitless sprite host — same source the deck-collection avatars use. */
const SPRITE_BASE = "https://r2.limitlesstcg.net/pokemon/gen9";

interface DeckAvatarCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

/**
 * Resolve a saved deck's hero Pokémon to a sprite URL + type-colored
 * background, mirroring the deck-collection avatar (deckAvatarInfo → same
 * primary-card pick, honoring an explicit cover override). Snapshotted into
 * the notification so the feed shows the deck's face — not the liker's —
 * without a re-derive at read time. Returns nulls when the deck has no
 * resolvable Pokémon (renderer falls back to an initial).
 */
function deckHeroSprite(
  analysis: unknown,
  coverUrl: string | null,
): { url: string | null; bg: string | null } {
  const cards = (analysis as { cards?: unknown } | null)?.cards;
  if (!Array.isArray(cards)) return { url: null, bg: null };
  const info = deckAvatarInfo(cards as DeckAvatarCard[], coverUrl);
  if (!info) return { url: null, bg: null };
  const slug = pokemonSlug(info.name);
  if (!slug) return { url: null, bg: null };
  return { url: `${SPRITE_BASE}/${slug}.png`, bg: typeColor(info.types) };
}

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

export type NotificationType = "deck_liked" | "badge_unlocked" | "new_follower";

/** Shape of the `data` jsonb, discriminated by notification type. Snapshotted
 *  at write time so the feed renders without joins. */
export interface DeckLikedData {
  actor_display_name: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
  deck_name: string;
  deck_short_id: string | null;
  /** Deck's hero-Pokémon sprite + type-colored bg, snapshotted so the feed
   *  icon shows the liked deck's face. Null when unresolvable. */
  deck_hero_image_url: string | null;
  deck_hero_bg: string | null;
}

export interface BadgeUnlockedData {
  badge_key: string;
  badge_name: string;
}

export interface NewFollowerData {
  actor_display_name: string | null;
  actor_username: string | null;
  actor_avatar_url: string | null;
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
      .select("user_id, name, short_id, analysis, cover_image_url")
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

    const hero = deckHeroSprite(
      deck?.analysis,
      (deck?.cover_image_url as string | null) ?? null,
    );

    const data: DeckLikedData = {
      actor_display_name: actor?.display_name ?? null,
      actor_username: actor?.username ?? null,
      actor_avatar_url: actor?.avatar_url ?? null,
      deck_name: (deck?.name as string) ?? "your deck",
      deck_short_id: (deck?.short_id as string | null) ?? null,
      deck_hero_image_url: hero.url,
      deck_hero_bg: hero.bg,
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
 * Someone followed a user → notify the followed user. Suppressed on a
 * self-follow (also blocked by the user_follows CHECK constraint). Snapshots
 * the follower's name/handle/avatar so the feed renders without a join.
 *
 * Dedup — one row per (recipient, actor, 'new_follower'): a genuine refollow
 * (unfollow then follow again) should REFRESH that row, not stack a second.
 * We deliberately do NOT upsert-on-conflict here: the dedup index is PARTIAL
 * (where type = 'new_follower'), and Postgres can't infer a partial index from
 * a bare ON CONFLICT (cols) — the trap that silently broke deck_liked (see
 * 20260727_notifications_dedup_fix.sql). Instead we insert and, on the 23505
 * that the partial unique index raises for a duplicate, update the existing
 * row. Race-safe (the index enforces uniqueness) and never touches inference.
 */
export async function notifyNewFollower(args: {
  recipientId: string; // the user who was followed
  actorId: string; // the follower
}): Promise<void> {
  try {
    // Defensive: never notify yourself (the CHECK constraint blocks the
    // follow row too, so this should be unreachable from the route).
    if (args.recipientId === args.actorId) return;

    const admin = createAdminClient();

    const { data: actor } = await admin
      .from("profiles")
      .select("display_name, username, avatar_url")
      .eq("id", args.actorId)
      .maybeSingle();

    const data: NewFollowerData = {
      actor_display_name: actor?.display_name ?? null,
      actor_username: actor?.username ?? null,
      actor_avatar_url: actor?.avatar_url ?? null,
    };

    const createdAt = new Date().toISOString();
    const { error } = await admin.from("notifications").insert({
      recipient_user_id: args.recipientId,
      actor_user_id: args.actorId,
      type: "new_follower" satisfies NotificationType,
      saved_deck_id: null,
      data,
      read_at: null,
      created_at: createdAt,
    });

    if (error) {
      if (error.code === "23505") {
        // A prior new_follower row exists (they refollowed) — refresh it so
        // it re-surfaces as unread rather than leaving a stale read entry.
        const { error: updateError } = await admin
          .from("notifications")
          .update({ data, read_at: null, created_at: createdAt })
          .eq("recipient_user_id", args.recipientId)
          .eq("actor_user_id", args.actorId)
          .eq("type", "new_follower");
        if (updateError) {
          console.error("[notify] new_follower refresh failed:", updateError);
        }
      } else {
        console.error("[notify] new_follower insert failed:", error);
      }
    }
  } catch (err) {
    console.error("[notify] notifyNewFollower threw:", err);
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
  if (n.type === "new_follower") {
    const d = n.data as unknown as NewFollowerData;
    const who = d.actor_display_name || d.actor_username || "Someone";
    return `${who} started following you`;
  }
  return "You have a new notification";
}
