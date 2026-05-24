"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Tracks in-app (client-side) navigation so the shared `BackButton` can
 * decide whether `router.back()` will land on a same-origin page.
 *
 * The browser exposes a single linear history stack, not per-tab stacks,
 * so we can't perfectly replicate SwiftUI's per-tab navigation. What we
 * *can* do is distinguish "the user got here by clicking links inside
 * the app" (back-button-safe) from "the user landed directly via deep
 * link, refresh, or external share" (back-button would exit the site).
 *
 * Implementation: a module-level counter increments on every pathname
 * change *after* the initial mount. Components read it via
 * `getInAppNavCount()` (snapshotting `> 0` means we have at least one
 * popable entry from this session) and subscribe via `subscribeNav` so
 * they stay in sync as the count grows.
 */

let inAppNavCount = 0;
const listeners = new Set<() => void>();

export function getInAppNavCount(): number {
  return inAppNavCount;
}

export function subscribeNav(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export default function NavigationTracker() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    inAppNavCount += 1;
    listeners.forEach((l) => l());
  }, [pathname]);

  return null;
}
