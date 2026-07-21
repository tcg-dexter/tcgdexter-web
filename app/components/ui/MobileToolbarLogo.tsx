"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Persistent site-logo home button rendered on the mobile sticky toolbar
 * for top-level pages only. The markup mirrors the logo Link inside
 * `MobileNavMenu`'s open panel header exactly (same href, aria-label,
 * className, and `<img>` props) — both apply the absolute-centering
 * classes directly on the `<Link>` itself, with no wrapping element, so
 * the logo sits at pixel-identical coordinates whether the menu is open
 * or closed. (An earlier version wrapped this in a plain `<div>` in the
 * parent — that div's shrink-to-fit height included the block-vs-inline
 * line-box gap below the inline-flex child, landing ~4px taller than
 * the image itself and shifting the centered logo up by half that. Keep
 * the absolute classes on the Link/img wrapper directly, not on an
 * external block-level wrapper, to avoid reintroducing that.)
 *
 * Where it shows up:
 *  - Home (`/`) — the hero no longer has its own logo, so this is the
 *    only logo mobile/tablet visitors see there.
 *  - The "front door" pages the nav menu links to (Card Catalog,
 *    Deck Collection, Meta Archetypes, Matches, Learn to Play).
 *  - Every page inside the Learn UX (`/learn/*`) — lessons, quiz, etc.
 *    Lesson pages don't render a `BackButton` portaled into the mobile
 *    back-slot, so the logo sits centered with no conflict.
 *  - The root user-profile page (`/u/<username>`, not its sub-routes).
 *  - Meta archetype detail pages (`/meta-archetypes/<slug>`, not the
 *    variant/decklist sub-route) — these DO render a `BackButton`
 *    portaled into `#mobile-back-slot`, overlaying the banner; the logo
 *    sits centered between it and the hamburger menu.
 *
 * Returns `null` for any other route (deck detail, card detail,
 * settings, etc.) so the closed toolbar's left side falls back to
 * whatever the page portals into `#mobile-back-slot`.
 */

const TOP_LEVEL_EXACT = new Set<string>([
  "/",
  "/cards",
  "/my-decks",
  "/meta-archetypes",
  "/matches",
  "/learn",
]);

function isTopLevelPath(pathname: string): boolean {
  if (TOP_LEVEL_EXACT.has(pathname)) return true;
  // Entire Learn UX — lesson detail (/learn/[slug]), quiz, etc.
  if (pathname.startsWith("/learn/")) return true;
  // User profile root: /u/<username> with no further path segments.
  if (/^\/u\/[^/]+$/.test(pathname)) return true;
  // Meta archetype detail (banner page), but not its variant/decklist
  // sub-route (/meta-archetypes/<slug>/<variantIndex>).
  return /^\/meta-archetypes\/[^/]+$/.test(pathname);
}

export default function MobileToolbarLogo() {
  const pathname = usePathname();
  if (!isTopLevelPath(pathname)) return null;
  return (
    <Link
      href="/"
      aria-label="TCG Dexter — home"
      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-wordmark-light.png"
        alt="TCG Dexter"
        width={1920}
        height={453}
        className="h-8 w-auto dark:hidden"
      />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo-wordmark-dark.png"
        alt="TCG Dexter"
        width={1920}
        height={453}
        className="h-8 w-auto hidden dark:block"
      />
    </Link>
  );
}
