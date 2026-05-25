"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getInAppNavCount, subscribeNav } from "./NavigationTracker";

interface Props {
  /** Canonical parent route — used as the fallback when the user landed
   *  here directly (no in-app history to pop). */
  href: string;
  ariaLabel: string;
  className?: string;
}

/**
 * Circular translucent back button. Originated as the banner overlay on
 * meta archetype pages and is now the standard across the site.
 *
 * Navigation model (SwiftUI-style):
 *   - If the user has navigated within the app since this session began,
 *     the button pops the browser history (mirrors a NavigationStack pop
 *     to the sending page).
 *   - On a cold landing (direct URL, refresh, share), there's nothing
 *     to pop — we fall back to the `href` prop, which each call site
 *     declares as the page's canonical parent.
 *
 * Layout:
 *   - On mobile / portrait-tablet (below xl), the button portals into
 *     `#mobile-back-slot` on the sticky toolbar so every page's back
 *     affordance sits inline with the hamburger menu trigger.
 *   - On desktop (xl+), the button renders inline at the call site —
 *     usually overlaying a banner or sitting above a page title — since
 *     the mobile toolbar isn't rendered.
 *
 * Two `<Link>` copies are emitted to keep the layout simple: the inline
 * copy is hidden below xl, and the toolbar's wrapping container is
 * `xl:hidden`, so each viewport sees exactly one rendered button.
 *
 * The underlying element is an `<a href>` so right-click "open in new
 * tab", middle-click, and accessibility tree all behave correctly. The
 * click handler only intercepts a plain left-click.
 */
export default function BackButton({ href, ariaLabel, className = "" }: Props) {
  const router = useRouter();
  const [canPop, setCanPop] = useState(false);
  const [mobileSlot, setMobileSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => setCanPop(getInAppNavCount() > 0);
    sync();
    return subscribeNav(sync);
  }, []);

  useEffect(() => {
    setMobileSlot(document.getElementById("mobile-back-slot"));
  }, []);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle modifier-clicks (new tab / window / download).
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    e.preventDefault();
    if (canPop) {
      router.back();
    } else {
      router.push(href);
    }
  }

  const baseClass =
    "items-center justify-center w-7 h-7 rounded-full bg-black/50 backdrop-blur-md text-white hover:bg-black/70 transition-colors shadow-sm";

  const icon = (
    <svg
      className="w-3 h-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );

  return (
    <>
      {/* Inline render — desktop (xl+) only. Mobile is handled by the
          portaled copy below. */}
      <Link
        href={href}
        onClick={handleClick}
        aria-label={ariaLabel}
        className={`hidden xl:inline-flex ${baseClass} ${className}`}
      >
        {icon}
      </Link>

      {/* Portal render — drops into the sticky mobile toolbar. The toolbar
          itself is `xl:hidden`, so this copy is naturally invisible on
          desktop. */}
      {mobileSlot &&
        createPortal(
          <Link
            href={href}
            onClick={handleClick}
            aria-label={ariaLabel}
            className={`inline-flex ${baseClass} ${className}`}
          >
            {icon}
          </Link>,
          mobileSlot,
        )}
    </>
  );
}
