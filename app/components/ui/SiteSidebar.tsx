"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrophyIcon,
  ChartBarIcon,
  BookOpenIcon,
  BookmarkIcon,
  CardsIcon,
  UserIcon,
} from "./nav-icons";

interface Props {
  /** Passed from the server component so the auth item renders correctly. */
  isAuthed: boolean;
  /** User's display name from the profiles table; null for anon users. */
  displayName: string | null;
  /** User's username handle; used to build the profile link. */
  username: string | null;
  /** Whether the user has admin/judge privileges. (Reserved for future use.) */
  isAdmin?: boolean;
}

/**
 * Leading-edge (left) sidebar — desktop only (xl+, 1280 px).
 *
 * Paired with SiteSidebarRight, which carries the external links. Both rails
 * are `hidden xl:flex`; the mobile toolbar is `xl:hidden`, so the three
 * surfaces never overlap. Root layout reserves space with `xl:pl-[230px]
 * xl:pr-[230px]` on the page wrapper. Landscape iPad and smaller laptops
 * stay on the mobile hamburger.
 *
 * Layout follows the x.com signed-in shell: the brand mark hugs the
 * leading edge of the rail (aligning with the icon column of the nav
 * rows below), the internal app routes stack at the top, and the auth
 * row is anchored at the bottom via `mt-auto`.
 *
 * Keep the internal link list in sync with MobileNavMenu when nav items
 * change.
 */
export default function SiteSidebar({
  isAuthed,
  displayName,
  username,
}: Props) {
  const pathname = usePathname();

  // Each row pairs a route with the icon that fronts its label. Adding a
  // new internal route? Pick an icon from ./nav-icons (or add one there)
  // and append below.
  // My Decks shows for everyone — the /my-decks route redirects anon
  // visitors to /sign-in, so the nav row doubles as a sign-in funnel.
  const INTERNAL_LINKS = [
    { href: "/cards", label: "Card Catalog", Icon: CardsIcon },
    { href: "/my-decks", label: "Deck Collection", Icon: BookmarkIcon },
    { href: "/meta-archetypes", label: "Meta Archetypes", Icon: ChartBarIcon },
    // { href: "/leaderboard", label: "Leaderboard", Icon: TrophyIcon },
    { href: "/learn", label: "Learn to Play", Icon: BookOpenIcon },
  ];

  // "/" gets exact match so it doesn't light up on every page; others match
  // by prefix so nested routes (e.g. /meta-archetypes/[slug]) still highlight.
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  // Rows are icon + label. `gap-3` pairs the icon column with the
  // text-base label. `rounded-full` matches the capsule shape used
  // elsewhere in the chrome (search input, result chips, Share button)
  // so hover/active states read as part of the same family.
  const linkBase =
    "flex items-center gap-3 px-3 py-2 rounded-full text-base font-medium transition-colors";
  const linkInactive = "text-text-secondary hover:text-text-primary hover:bg-surface";
  const linkActive = "text-text-primary bg-surface";

  const profileHref = username ? `/u/${username}` : "/settings";
  const profileActive = username ? isActive(`/u/${username}`) : isActive("/settings");

  return (
    <aside
      aria-label="Primary navigation"
      className="hidden xl:flex fixed inset-y-0 left-0 z-30 w-[230px] flex-col bg-bg border-r border-[var(--border)] pt-8"
    >
      {/* Brand mark — wordmark logo spanning the same inner width as the
          right rail's search bar (rail width minus pl-3 + pr-6 = 194px). */}
      <div className="flex-shrink-0 h-20 pl-5 pr-6 flex items-center">
        <Link href="/" aria-label="TCG Dexter — home" className="block w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-wordmark.png"
            alt="TCG Dexter"
            width={1920}
            height={453}
            className="w-full h-auto"
          />
        </Link>
      </div>

      {/* Link well — internal routes stack at top, auth pinned at bottom
          via `mt-auto` on the trailing list. `flex flex-col` on <nav> is
          what lets `mt-auto` do its work. */}
      <nav className="flex-1 flex flex-col overflow-y-auto px-3 pt-4 pb-4">
        <ul className="flex flex-col gap-0.5">
          {INTERNAL_LINKS.map(({ href, label, Icon }) => (
            <li key={href}>
              <Link
                href={href}
                className={`${linkBase} ${isActive(href) ? linkActive : linkInactive}`}
              >
                <Icon />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>

        {/* Auth row — anchored to the bottom of the rail. */}
        <ul className="mt-auto flex flex-col gap-0.5 pt-4">
          <li>
            {isAuthed ? (
              <Link
                href={profileHref}
                className={`${linkBase} ${profileActive ? linkActive : linkInactive}`}
              >
                <UserIcon />
                <span>{displayName ?? "Profile"}</span>
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className={`${linkBase} ${isActive("/sign-in") ? linkActive : linkInactive}`}
              >
                <UserIcon />
                <span>Sign in</span>
              </Link>
            )}
          </li>
        </ul>
      </nav>
    </aside>
  );
}
