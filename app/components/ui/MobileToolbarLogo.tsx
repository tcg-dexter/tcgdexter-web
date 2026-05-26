"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Persistent site-logo home button rendered on the mobile sticky toolbar
 * for top-level pages only. The markup mirrors the logo Link inside
 * `MobileNavMenu`'s open panel header exactly (same href, aria-label,
 * className, and `<img>` props), and the parent slot in `SiteNav` uses
 * the same `h-14 flex items-center justify-between` row — so the logo
 * sits at pixel-identical coordinates whether the menu is open or
 * closed, and toggling the menu never shifts it.
 *
 * Top-level == the routes the nav menu links to from a "front door"
 * (Card Catalog, Deck Collection, Top 30 Meta Decks, Learn to Play),
 * plus the root user-profile page (`/u/<username>`, not its sub-routes).
 * These pages never render a `BackButton` portaled into the mobile
 * back-slot, so the logo and back button are mutually exclusive in
 * practice — when one is visible, the other is empty.
 *
 * Returns `null` for any other route (home, deck detail, card detail,
 * settings, etc.) so the closed toolbar's left side falls back to
 * whatever the page portals into `#mobile-back-slot`.
 */

const TOP_LEVEL_EXACT = new Set<string>([
  "/cards",
  "/my-decks",
  "/meta-decks",
  "/learn",
]);

function isTopLevelPath(pathname: string): boolean {
  if (TOP_LEVEL_EXACT.has(pathname)) return true;
  // User profile root: /u/<username> with no further path segments.
  return /^\/u\/[^/]+$/.test(pathname);
}

export default function MobileToolbarLogo() {
  const pathname = usePathname();
  if (!isTopLevelPath(pathname)) return null;
  return (
    <Link
      href="/"
      aria-label="TCG Dexter — home"
      className="inline-flex items-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-wordmark.png"
        alt="TCG Dexter"
        width={1920}
        height={453}
        className="h-8 w-auto"
      />
    </Link>
  );
}
