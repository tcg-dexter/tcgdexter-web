import Link from "next/link";
import { BellIcon } from "./nav-icons";

/**
 * Standalone bell button with an unread-count badge — used on the mobile
 * sticky toolbar so the badge is visible without opening the hamburger menu.
 * Server component: the count is resolved by SiteNav on each render (updates
 * on navigation; no client polling). Renders nothing interactive beyond a
 * link to the full /notifications page.
 */
export default function NotificationBell({ count }: { count: number }) {
  return (
    <Link
      href="/notifications"
      aria-label={
        count > 0 ? `Notifications (${count} unread)` : "Notifications"
      }
      className="relative inline-flex items-center justify-center text-text-secondary hover:text-text-primary transition-colors"
    >
      <BellIcon />
      {count > 0 && (
        <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 inline-flex items-center justify-center rounded-full bg-accent text-white text-[10px] font-bold leading-none tabular-nums">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
