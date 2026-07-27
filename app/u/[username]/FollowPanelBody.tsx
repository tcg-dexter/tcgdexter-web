"use client";

import type { ReactNode } from "react";
import { useFollowPanel } from "./FollowPanel";
import FollowList from "./FollowList";

interface Props {
  targetUserId: string;
  username: string;
  displayName: string;
  /** The normal profile body (stat grid, achievements, deck feed). */
  children: ReactNode;
}

/**
 * Wraps the profile's main body. When a follower/following count is clicked
 * (FollowStats → shared FollowPanel state), the body is swapped in place for
 * the matching list — no navigation. Keying FollowList by kind resets its
 * fetch state cleanly when toggling between the two lists.
 */
export default function FollowPanelBody({
  targetUserId,
  username,
  displayName,
  children,
}: Props) {
  const { openKind, close } = useFollowPanel();

  if (openKind) {
    return (
      <div className="px-4 sm:px-8 mt-6">
        <FollowList
          key={openKind}
          kind={openKind}
          targetUserId={targetUserId}
          username={username}
          displayName={displayName}
          onClose={close}
        />
      </div>
    );
  }

  return <>{children}</>;
}
