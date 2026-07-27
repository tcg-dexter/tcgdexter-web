"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  /** auth.users id of the profile being viewed (the follow target). */
  targetUserId: string;
  initialFollowing: boolean;
  /** When false, clicks redirect to /sign-in instead of calling the API. */
  isAuthenticated: boolean;
}

/**
 * Follow / Following toggle on a public profile.
 *
 * Optimistic: flips the visual state immediately, then reconciles with the
 * API response (or rolls back on error). Idempotent server-side, so a fast
 * double-tap can't desync. On success we router.refresh() so the server-
 * rendered follower/following counts (and the bell) re-fetch.
 */
export default function FollowButton({
  targetUserId,
  initialFollowing,
  isAuthenticated,
}: Props) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!isAuthenticated) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (isPending) return;

    const nextFollowing = !following;
    setFollowing(nextFollowing);
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/follows/${targetUserId}`, {
          method: nextFollowing ? "POST" : "DELETE",
        });
        const body = (await res.json()) as { following?: boolean; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Couldn't update follow.");
        if (typeof body.following === "boolean") setFollowing(body.following);
        // Re-fetch the server component so the follower/following counts and
        // the recipient's notification bell reflect the change.
        router.refresh();
      } catch (err) {
        setFollowing(!nextFollowing);
        setError(err instanceof Error ? err.message : "Couldn't update follow.");
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={following}
        aria-label={following ? "Unfollow" : "Follow"}
        className={`inline-flex items-center justify-center rounded-full px-5 py-1.5 text-sm font-semibold transition-all disabled:opacity-60 ${
          following
            ? "border border-black/15 dark:border-white/20 bg-white dark:bg-surface-2 text-text-secondary hover:border-black/30 dark:hover:border-white/35"
            : "border border-transparent bg-black dark:bg-white text-white dark:text-black hover:bg-black/85 dark:hover:bg-white/85"
        }`}
      >
        {following ? "Following" : "Follow"}
      </button>
      {error && <span className="text-[10px] text-rose-700">{error}</span>}
    </div>
  );
}
