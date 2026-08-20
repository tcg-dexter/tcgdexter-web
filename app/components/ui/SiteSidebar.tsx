"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrophyIcon,
  ChartBarIcon,
  BookmarkIcon,
  CardsIcon,
  UserIcon,
  VersusIcon,
  PlaymatIcon,
  BellIcon,
} from "./nav-icons";
import AppearanceToggle from "@/app/settings/AppearanceToggle";

interface Props {
  /** Passed from the server component so the auth item renders correctly. */
  isAuthed: boolean;
  /** User's display name from the profiles table; null for anon users. */
  displayName: string | null;
  /** User's username handle; used to build the profile link. */
  username: string | null;
  /** Whether the user has admin/judge privileges. */
  isAdmin?: boolean;
  /** Unread in-app notification count for the bell row badge (authed only). */
  unreadCount?: number;
  /** Resolved by SiteNav to the latest published spotlight's URL
   *  (or /spotlight when none are published yet). */
  spotlightHref: string;
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
  isAdmin,
  unreadCount = 0,
  spotlightHref,
}: Props) {
  const pathname = usePathname();

  // Each row pairs a route with the icon that fronts its label. Adding a
  // new internal route? Pick an icon from ./nav-icons (or add one there)
  // and append below. `badge` renders a trailing count pill (Notifications).
  // My Decks shows for everyone — the /my-decks route redirects anon
  // visitors to /sign-in, so the nav row doubles as a sign-in funnel.
  const INTERNAL_LINKS: Array<{
    href: string;
    label: string;
    Icon: (props: { className?: string }) => JSX.Element;
    badge?: number;
  }> = [
    { href: "/battles", label: "Battles", Icon: VersusIcon },
    { href: "/cards", label: "Card Catalog", Icon: CardsIcon },
    { href: "/my-decks", label: "Deck Collection", Icon: BookmarkIcon },
    { href: "/meta-archetypes", label: "Meta Archetypes", Icon: ChartBarIcon },
    // Notifications — authed only; badge shows unread count.
    ...(isAuthed
      ? [{ href: "/notifications", label: "Notifications", Icon: BellIcon, badge: unreadCount }]
      : []),
    ...(isAdmin ? [{ href: "/admin-tools/deck-mat", label: "Playmat Studio", Icon: PlaymatIcon }] : []),
    // { href: "/leaderboard", label: "Leaderboard", Icon: TrophyIcon },
    { href: spotlightHref, label: "Spotlight", Icon: TrophyIcon },
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
            src="/logo-wordmark-light.png"
            alt="TCG Dexter"
            width={1920}
            height={453}
            className="w-full h-auto dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo-wordmark-dark.png"
            alt="TCG Dexter"
            width={1920}
            height={453}
            className="w-full h-auto hidden dark:block"
          />
        </Link>
      </div>

      {/* Link well — internal routes stack at top, auth pinned at bottom
          via `mt-auto` on the trailing list. `flex flex-col` on <nav> is
          what lets `mt-auto` do its work. */}
      <nav className="flex-1 flex flex-col overflow-y-auto px-3 pt-4 pb-4">
        <ul className="flex flex-col gap-0.5">
          {INTERNAL_LINKS.map(({ href, label, Icon, badge }) => (
            <li key={href}>
              <Link
                href={href}
                className={`${linkBase} ${isActive(href) ? linkActive : linkInactive}`}
              >
                <Icon />
                <span className="flex-1">{label}</span>
                {badge != null && badge > 0 && (
                  <span className="ml-auto min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center rounded-full bg-accent text-white text-[11px] font-bold leading-none tabular-nums">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>

        {/* Appearance + auth row — anchored to the bottom. Admin
            destinations live in the trailing-edge sidebar's Admin
            section, not here. */}
        <div className="mt-auto pt-4">
          <div className="px-3 mb-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-2">
              Appearance
            </p>
            <AppearanceToggle />
          </div>
          <ul className="flex flex-col gap-0.5">
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
        </div>
      </nav>
    </aside>
  );
}
