"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

interface Props {
  deckId: string;
  initialLiked: boolean;
  initialCount: number;
  /** When false, clicks redirect to /sign-in instead of calling the API. */
  isAuthenticated: boolean;
}

/**
 * Heart toggle for a public saved-deck.
 *
 * Optimistic: flips the visual state immediately, then reconciles with
 * the API response (or rolls back on error). Idempotent server-side, so
 * a fast double-tap can't desync the count.
 */
export default function LikeButton({
  deckId,
  initialLiked,
  initialCount,
  isAuthenticated,
}: Props) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!isAuthenticated) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (isPending) return;

    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => c + (nextLiked ? 1 : -1));
    setError(null);

    startTransition(async () => {
      try {
        const res = await fetch(`/api/saved-decks/${deckId}/like`, {
          method: nextLiked ? "POST" : "DELETE",
        });
        const body = (await res.json()) as { liked?: boolean; like_count?: number; error?: string };
        if (!res.ok) throw new Error(body.error ?? "Couldn't update like.");
        if (typeof body.liked === "boolean") setLiked(body.liked);
        if (typeof body.like_count === "number") setCount(body.like_count);
      } catch (err) {
        setLiked(!nextLiked);
        setCount((c) => c + (nextLiked ? -1 : 1));
        setError(err instanceof Error ? err.message : "Couldn't update like.");
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={liked}
        aria-label={liked ? "Unlike deck" : "Like deck"}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
          liked
            ? "border-accent bg-accent/10 text-accent"
            : "border-black/10 bg-white dark:bg-surface-2 text-text-secondary hover:border-black/20"
        }`}
      >
        <svg
          className="w-3.5 h-3.5"
          viewBox="0 0 24 24"
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
          />
        </svg>
        <span className="tabular-nums">{count}</span>
      </button>
      {error && <span className="text-[10px] text-rose-700">{error}</span>}
    </div>
  );
}
