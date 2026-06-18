"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { getInAppNavCount, subscribeNav } from "./NavigationTracker";

interface Props {
  /** Canonical parent route — fallback when there is no in-app history. */
  href: string;
  title: string;
}

/**
 * Portals a compact `[←] [Title]` row into `#mobile-back-slot` on the
 * sticky mobile toolbar (xl:hidden). Used by inner admin-tool pages that
 * want their page title inline with the nav bar rather than as a
 * standalone h1 block below it.
 *
 * Back-navigation matches BackButton's SwiftUI-style model: pop history
 * if available, else navigate to `href`.
 *
 * Renders nothing in the component tree — purely a portal side-effect.
 */
export default function MobilePageTitle({ href, title }: Props) {
  const router = useRouter();
  const [canPop, setCanPop] = useState(false);
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => setCanPop(getInAppNavCount() > 0);
    sync();
    return subscribeNav(sync);
  }, []);

  useEffect(() => {
    setSlot(document.getElementById("mobile-back-slot"));
  }, []);

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    )
      return;
    e.preventDefault();
    if (canPop) router.back();
    else router.push(href);
  }

  if (!slot) return null;

  return createPortal(
    <Link
      href={href}
      onClick={handleClick}
      aria-label={`Back to ${title}`}
      className="flex items-center gap-2 group"
    >
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-black/8 group-hover:bg-black/12 transition-colors">
        <svg
          className="w-3 h-3 text-text-primary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15.75 19.5L8.25 12l7.5-7.5"
          />
        </svg>
      </span>
      <span className="text-sm font-semibold text-text-primary">{title}</span>
    </Link>,
    slot,
  );
}
