"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export type FollowPanelKind = "followers" | "following";

interface FollowPanelValue {
  /** Which list is currently open in place of the profile body, or null. */
  openKind: FollowPanelKind | null;
  open: (kind: FollowPanelKind) => void;
  close: () => void;
}

const FollowPanelContext = createContext<FollowPanelValue | null>(null);

/**
 * Shares the "which follow list is open" state between the trigger (the
 * clickable follower/following counts in the header) and the body region
 * that swaps to show the list — two sibling client subtrees on the same
 * server-rendered profile page. See FollowStats + FollowPanelBody.
 */
export function FollowPanelProvider({ children }: { children: ReactNode }) {
  const [openKind, setOpenKind] = useState<FollowPanelKind | null>(null);
  return (
    <FollowPanelContext.Provider
      value={{
        openKind,
        open: (kind) => setOpenKind(kind),
        close: () => setOpenKind(null),
      }}
    >
      {children}
    </FollowPanelContext.Provider>
  );
}

export function useFollowPanel(): FollowPanelValue {
  const ctx = useContext(FollowPanelContext);
  if (!ctx) {
    throw new Error("useFollowPanel must be used within a FollowPanelProvider");
  }
  return ctx;
}
