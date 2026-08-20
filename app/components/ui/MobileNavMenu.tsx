"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import UnifiedSearch from "@/app/leaderboard/UnifiedSearch";
import AppearanceToggle from "@/app/settings/AppearanceToggle";
import {
  TrophyIcon,
  WrenchIcon,
  ChartBarIcon,
  BookOpenIcon,
  BookmarkIcon,
  CardsIcon,
  UserIcon,
  DiscordIcon,
  GaugeIcon,
  TikTokIcon,
  ShoppingBagIcon,
  VersusIcon,
  PlaymatIcon,
  BellIcon,
} from "./nav-icons";

/** Must match the CSS transition-duration on the panel div below. */
const TRANSITION_MS = 200;

interface Props {
  /** Passed from the server component so the auth item renders correctly. */
  isAuthed: boolean;
  /** User's display name from the profiles table; null for anon users. */
  displayName: string | null;
  /** User's username handle; used to build the profile link. */
  username: string | null;
  /** Whether the user has admin/judge privileges. */
  isAdmin?: boolean;
  /** Unread in-app notification count for the Notifications row badge. */
  unreadCount?: number;
  /** Resolved by SiteNav to the latest published spotlight's URL
   *  (or /spotlight when none are published yet). */
  spotlightHref: string;
}

/**
 * Full-screen nav takeover triggered by the hamburger icon.
 *
 * State model
 * ───────────
 * isOpen    — drives CSS open/closed classes. Flipping this triggers the
 *             CSS transition. Never flip it on the same frame as a DOM
 *             insertion — use double-rAF on enter.
 * isVisible — drives portal mount/unmount. True while the panel is visible
 *             OR still animating out. Unmounted only after the exit transition
 *             finishes (via setTimeout matched to TRANSITION_MS).
 *
 * Scroll lock
 * ───────────
 * Sets overflow:hidden on <html> and <body> (plus touch-action:none on body)
 * while the panel is open. No position:fixed, no top:-scrollY, no scrollTo —
 * so there is zero layout shift on open or close. scrollLockedRef guards
 * against double-lock/unlock so unlockScroll() is safe from any code path.
 */
export default function MobileNavMenu({ isAuthed, displayName, username, isAdmin, unreadCount = 0, spotlightHref }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const pathname = usePathname();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Scroll-lock state
  const prevHtmlOverflowRef = useRef("");
  const prevBodyOverflowRef = useRef("");
  const prevBodyTouchActionRef = useRef("");
  const scrollLockedRef = useRef(false);

  // Pending animation handles
  const rafRef = useRef(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Scroll lock helpers ──────────────────────────────────────────────────────

  const lockScroll = () => {
    if (scrollLockedRef.current) return;
    scrollLockedRef.current = true;
    const html = document.documentElement;
    prevHtmlOverflowRef.current = html.style.overflow;
    prevBodyOverflowRef.current = document.body.style.overflow;
    prevBodyTouchActionRef.current = document.body.style.touchAction;
    html.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
  };

  const unlockScroll = () => {
    if (!scrollLockedRef.current) return;
    scrollLockedRef.current = false;
    document.documentElement.style.overflow = prevHtmlOverflowRef.current;
    document.body.style.overflow = prevBodyOverflowRef.current;
    document.body.style.touchAction = prevBodyTouchActionRef.current;
  };

  // ── Open / close ─────────────────────────────────────────────────────────────

  const openMenu = () => {
    // Cancel any in-flight close
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    cancelAnimationFrame(rafRef.current);

    lockScroll();
    // 1. Mount portal: panel is in DOM but still in closed CSS state.
    setIsVisible(true);
    // 2. Double rAF: browser has now painted the closed state, so the CSS
    //    transition has a valid starting point and won't flash.
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => {
        setIsOpen(true);
      });
    });
  };

  const closeMenu = () => {
    cancelAnimationFrame(rafRef.current);
    unlockScroll();
    // Flip CSS to closed — transition animates out.
    setIsOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
    // Unmount portal only after the exit animation finishes.
    closeTimerRef.current = setTimeout(
      () => setIsVisible(false),
      TRANSITION_MS,
    );
  };

  const toggle = () => {
    // Guard mid-open-animation state with scrollLockedRef (isOpen is still
    // false during the double-rAF window, but the lock is already set).
    if (isOpen || scrollLockedRef.current) closeMenu();
    else openMenu();
  };

  // ── Side effects ─────────────────────────────────────────────────────────────

  // Route change safety net: close menu if it was left open or mid-animation
  // (e.g. programmatic navigation that didn't go through a link).
  useEffect(() => {
    if (!scrollLockedRef.current && !isOpen) return;
    closeMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Bulletproof unmount cleanup — releases scroll lock even if the component
  // tree unmounts while the menu is open (e.g. hard navigation).
  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      unlockScroll();
      document.body.removeAttribute("data-nav-menu-visible");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hide the real sticky toolbar whenever the panel is mounted. The panel's
  // header row is a pixel-perfect replica (same bg-bg/70 backdrop-blur-xl
  // and border), so the swap is invisible — but leaving both rendered at
  // once makes their borders composite during the body's opacity fade,
  // producing a ~1-2px divider jitter on open/close. CSS selector lives
  // in globals.css: body[data-nav-menu-visible] nav[data-site-toolbar].
  useEffect(() => {
    if (isVisible) {
      document.body.setAttribute("data-nav-menu-visible", "");
    } else {
      document.body.removeAttribute("data-nav-menu-visible");
    }
  }, [isVisible]);

  // Escape key + Tab focus trap (active only while open).
  useEffect(() => {
    if (!isOpen || !panelRef.current) return;
    const panel = panelRef.current;

    const getFocusable = () =>
      Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

    // Move focus into the panel immediately, landing on the dialog
    // container itself (tabIndex={-1}) rather than the first focusable
    // descendant — that first descendant is the logo link, and focusing
    // it directly paints a visible focus ring on it (looking like an
    // accidental "selection") even though the user never tabbed there.
    panel.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeMenu();
        return;
      }
      if (e.key === "Tab") {
        const focusable = getFocusable();
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus({ preventScroll: true });
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus({ preventScroll: true });
          }
        }
      }
    };

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Nav link data ─────────────────────────────────────────────────────────────

  // Icons are shared with the desktop sidebars (see ./nav-icons). Keep the
  // icon assignments in sync with SiteSidebar / SiteSidebarRight so the two
  // surfaces tell the same visual story.
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
    ...(isAuthed
      ? [{ href: "/notifications", label: "Notifications", Icon: BellIcon, badge: unreadCount }]
      : []),
    ...(isAdmin ? [{ href: "/admin-tools/deck-mat", label: "Playmat Studio", Icon: PlaymatIcon }] : []),
    // { href: "/leaderboard", label: "Leaderboard", Icon: TrophyIcon },
    { href: spotlightHref, label: "Spotlight", Icon: TrophyIcon },
  ];

  // Grouped with the external links on mobile so the Learn / Shop / Social
  // cluster matches the right rail on desktop.
  const SECONDARY_INTERNAL_LINKS = [
    { href: "/learn", label: "Learn to Play", Icon: BookOpenIcon },
  ];

  const EXTERNAL_LINKS = [
    { href: "https://www.ebay.com/usr/tcgdexter", label: "Card Shop", Icon: ShoppingBagIcon },
    { href: "https://discord.gg/G3VfEzfmJF", label: "Discord", Icon: DiscordIcon },
    { href: "https://www.tiktok.com/@tcgdexter", label: "TikTok", Icon: TikTokIcon },
  ];

  // Admin destinations — replace the external-links block on mobile when
  // the signed-in user is an admin. Admin Tools sits in the same section so
  // every admin destination lives under a single eyebrow.
  const ADMIN_LINKS = [
    { href: "/dashboard", label: "Dashboard", Icon: GaugeIcon },
    { href: "/admin-tools", label: "Admin Tools", Icon: WrenchIcon },
  ];

  const linkClass =
    "flex items-center gap-4 py-2 text-lg font-medium text-text-secondary hover:text-text-primary transition-colors";

  // ── Hamburger icon (reused in trigger + panel close button) ──────────────────

  const HamburgerIcon = () => (
    <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true">
      <path d="M0 1.5H20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M0 8H20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M0 14.5H20" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );

  // ── Panel (rendered into a portal at document.body) ──────────────────────────

  const panel = (
    <div
      ref={panelRef}
      id="site-nav-panel"
      role="dialog"
      aria-label="Site navigation"
      aria-modal="true"
      tabIndex={-1}
      className={[
        // Full-screen takeover. overscroll-contain prevents momentum scroll
        // bleeding to the page behind on iOS Safari.
        "fixed inset-0 z-[110] flex flex-col overscroll-contain outline-none",
        // pointer-events toggles with isOpen so the page under the fading-
        // out body isn't interactable mid-transition.
        isOpen ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
    >
      {/* Header row — styling mirrors the real toolbar exactly (matching
          bg-bg/70 backdrop-blur-xl and border). ALWAYS at full opacity,
          never fades. This avoids the real toolbar's border and this
          replica's border compositing at partial alpha during a fade —
          which produced a ~1-2px divider jitter on open/close. Pair with
          the data-nav-menu-visible attribute below that hides the real
          toolbar, so only one toolbar is ever rendered at a time. */}
      <div className="flex-shrink-0 backdrop-blur-xl bg-bg/70">
        <div className="mx-auto max-w-6xl px-6">
          {/* Header row: logo (home link) absolutely centered, hamburger
              close pinned to the right. Both share the same h-14
              baseline as the closed toolbar, and the logo shares its
              exact centered position with the closed toolbar's
              `MobileToolbarLogo`, so nothing shifts between open and
              closed states. */}
          <div className="h-14 relative flex items-center justify-end">
            <Link
              href="/"
              aria-label="TCG Dexter — home"
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 inline-flex items-center"
              onClick={closeMenu}
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
            <button
              onClick={closeMenu}
              aria-label="Close navigation menu"
            >
              <HamburgerIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Nav body — bg + links + search fade as a unit. At opacity 0 the
          page content is visible beneath; at opacity 1 the takeover is
          fully opaque. Header above stays fixed, so the divider never
          flickers. `flex-col` here is what lets the search footer pin to
          the bottom of the panel via `mt-auto`. */}
      <div
        className={[
          "flex-1 bg-bg overflow-y-auto flex flex-col",
          "transition-opacity duration-200 ease-out",
          isOpen ? "opacity-100" : "opacity-0",
        ].join(" ")}
      >
        <nav className="mx-auto max-w-6xl w-full px-6 pt-4 pb-6">
          <ul className="flex flex-col gap-1">
            {INTERNAL_LINKS.map(({ href, label, Icon, badge }) => (
              <li key={href}>
                <Link href={href} className={linkClass} onClick={closeMenu}>
                  <Icon />
                  <span className="flex-1">{label}</span>
                  {badge != null && badge > 0 && (
                    <span className="ml-auto min-w-[20px] h-5 px-1.5 inline-flex items-center justify-center rounded-full bg-accent text-white text-xs font-bold leading-none tabular-nums">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </Link>
              </li>
            ))}

            <li role="separator" className="my-4" />

            {SECONDARY_INTERNAL_LINKS.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link href={href} className={linkClass} onClick={closeMenu}>
                  <Icon />
                  <span>{label}</span>
                </Link>
              </li>
            ))}

            {isAdmin ? (
              <>
                <li role="presentation" className="pt-2 pb-1">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
                    Admin
                  </span>
                </li>
                {ADMIN_LINKS.map(({ href, label, Icon }) => (
                  <li key={href}>
                    <Link href={href} className={linkClass} onClick={closeMenu}>
                      <Icon />
                      <span>{label}</span>
                    </Link>
                  </li>
                ))}
              </>
            ) : (
              EXTERNAL_LINKS.map(({ href, label, Icon }) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={linkClass}
                    onClick={closeMenu}
                  >
                    <Icon />
                    <span>{label}</span>
                  </a>
                </li>
              ))
            )}

            <li role="separator" className="my-4" />

            <li role="presentation" className="pb-3">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted mb-2">
                Appearance
              </span>
              <AppearanceToggle />
            </li>

            {/* Auth item — anchored at the bottom of the link list, above
                the search bar. */}
            <li>
              {isAuthed ? (
                <Link
                  href={username ? `/u/${username}` : "/settings"}
                  className={linkClass}
                  onClick={closeMenu}
                >
                  <UserIcon />
                  <span>{displayName ?? "Profile"}</span>
                </Link>
              ) : (
                <Link href="/sign-in" className={linkClass} onClick={closeMenu}>
                  <UserIcon />
                  <span>Sign in</span>
                </Link>
              )}
            </li>
          </ul>
        </nav>

        {/* Global search — anchored to the bottom of the panel via
            `mt-auto`. `dropdownPosition="above"` flips the results dropdown
            so it opens upward over the link list instead of off-screen
            past the panel's bottom edge. */}
        <div className="mt-auto mx-auto max-w-6xl w-full px-6 pb-8 pt-2">
          <UnifiedSearch dropdownPosition="above" />
        </div>
      </div>
    </div>
  );

  // ── Trigger + portal ──────────────────────────────────────────────────────────

  return (
    <>
      <button
        ref={triggerRef}
        onClick={toggle}
        aria-label="Toggle navigation menu"
        aria-expanded={isOpen}
        aria-controls="site-nav-panel"
        aria-haspopup="dialog"
      >
        <HamburgerIcon />
      </button>

      {isVisible && createPortal(panel, document.body)}
    </>
  );
}
