"use client";

import { useFollowPanel, type FollowPanelKind } from "./FollowPanel";

interface Props {
  followerCount: number;
  followingCount: number;
}

/**
 * Compact "N Followers · M Following" row under the @handle. Each count is a
 * button that swaps the profile body for the matching list (see
 * FollowPanelBody). The open list's trigger stays highlighted so the two
 * counts read like tabs. Replaces the previously-static markup in page.tsx.
 */
export default function FollowStats({ followerCount, followingCount }: Props) {
  const { openKind, open } = useFollowPanel();

  return (
    <p className="text-sm text-text-secondary">
      <CountButton
        kind="followers"
        active={openKind === "followers"}
        onOpen={open}
        count={followerCount}
        label={followerCount === 1 ? "Follower" : "Followers"}
      />
      <span className="mx-2 text-text-muted/60">·</span>
      <CountButton
        kind="following"
        active={openKind === "following"}
        onOpen={open}
        count={followingCount}
        label="Following"
      />
    </p>
  );
}

function CountButton({
  kind,
  active,
  onOpen,
  count,
  label,
}: {
  kind: FollowPanelKind;
  active: boolean;
  onOpen: (kind: FollowPanelKind) => void;
  count: number;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(kind)}
      aria-pressed={active}
      className={`group -mx-0.5 px-0.5 rounded transition-colors ${
        active ? "text-text-primary" : "hover:text-text-primary"
      }`}
    >
      <span
        className={`font-semibold tabular-nums text-text-primary underline-offset-4 ${
          active ? "underline decoration-accent" : "group-hover:underline"
        }`}
      >
        {(count ?? 0).toLocaleString()}
      </span>{" "}
      <span className="text-text-muted group-hover:text-text-secondary">
        {label}
      </span>
    </button>
  );
}
