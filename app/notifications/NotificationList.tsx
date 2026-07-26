import Link from "next/link";
import {
  formatNotificationMessage,
  type NotificationRow,
  type DeckLikedData,
  type BadgeUnlockedData,
} from "@/lib/notifications/notify";

/**
 * Renders the recipient's notification feed. Server component — no
 * interactivity (mark-read happens on page load). Unread rows (captured
 * before the mark-read update) get an accent treatment.
 */
export default function NotificationList({
  notifications,
  unreadIds,
  viewerUsername,
}: {
  notifications: NotificationRow[];
  unreadIds: Set<string>;
  viewerUsername: string | null;
}) {
  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-8 text-center">
        <p className="text-sm text-text-secondary">
          No notifications yet. Likes on your public decks and badges you earn
          will show up here.
        </p>
      </div>
    );
  }

  return (
    <ul className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden">
      {notifications.map((n, i) => (
        <li key={n.id}>
          <NotificationRowItem
            n={n}
            unread={unreadIds.has(n.id)}
            viewerUsername={viewerUsername}
            isLast={i === notifications.length - 1}
          />
        </li>
      ))}
    </ul>
  );
}

function NotificationRowItem({
  n,
  unread,
  viewerUsername,
  isLast,
}: {
  n: NotificationRow;
  unread: boolean;
  viewerUsername: string | null;
  isLast: boolean;
}) {
  const href = notificationHref(n, viewerUsername);
  const message = formatNotificationMessage(n);

  const inner = (
    <div
      className={`flex items-center gap-3 px-4 py-3 transition-colors ${
        unread ? "bg-accent/[0.05] border-l-2 border-accent" : "border-l-2 border-transparent"
      } ${isLast ? "" : "border-b border-black/[0.06] dark:border-white/[0.06]"} hover:bg-black/[0.02] dark:hover:bg-white/[0.03]`}
    >
      <NotificationIcon n={n} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-text-primary leading-snug">{message}</p>
        <p className="text-xs text-text-muted mt-0.5">{timeAgo(n.created_at)}</p>
      </div>
      {unread && (
        <span className="shrink-0 w-2 h-2 rounded-full bg-accent" aria-label="Unread" />
      )}
    </div>
  );

  return href ? (
    <Link href={href} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function NotificationIcon({ n }: { n: NotificationRow }) {
  if (n.type === "badge_unlocked") {
    const d = n.data as unknown as BadgeUnlockedData;
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/badges/${d.badge_key}.png`}
        alt=""
        width={40}
        height={40}
        className="shrink-0 w-10 h-10 object-contain"
      />
    );
  }
  // deck_liked → actor avatar (Pokémon sprite) or initial fallback.
  const d = n.data as unknown as DeckLikedData;
  const initial = (d.actor_display_name || d.actor_username || "?")
    .charAt(0)
    .toUpperCase();
  return d.actor_avatar_url ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={d.actor_avatar_url}
      alt=""
      className="shrink-0 w-10 h-10 rounded-full object-cover bg-surface"
    />
  ) : (
    <span className="shrink-0 w-10 h-10 rounded-full bg-surface inline-flex items-center justify-center text-sm font-semibold text-text-secondary">
      {initial}
    </span>
  );
}

/** Target route for a notification, or null when it can't be built. */
function notificationHref(
  n: NotificationRow,
  viewerUsername: string | null,
): string | null {
  if (n.type === "deck_liked") {
    const d = n.data as unknown as DeckLikedData;
    if (viewerUsername && d.deck_short_id) {
      return `/u/${viewerUsername}/${d.deck_short_id}`;
    }
    return "/my-decks";
  }
  if (n.type === "badge_unlocked") {
    return viewerUsername ? `/u/${viewerUsername}` : "/my-decks";
  }
  return null;
}

/** Compact relative time, matching the app's inline "…ago" style. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.floor((Date.now() - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (days < 30) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (days < 365) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
