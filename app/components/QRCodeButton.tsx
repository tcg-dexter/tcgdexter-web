"use client";

import { useState } from "react";
import ShareQRModal from "./ShareQRModal";

interface Props {
  /** Pre-known share URL (e.g. on the public /d/[shortId] page). */
  shareUrl?: string;
  /** Deck list to generate a share link from, when no shareUrl is provided. */
  deckList?: string;
  /** Full analysis object — passed as-is to the share API. */
  analysis?: unknown;
  /** Extra classes appended to the trigger button (e.g. `flex-1`). */
  className?: string;
}

/**
 * Button that presents a QR code for sharing a deck. The QR is rendered
 * client-side from `resolvedUrl` (no external image service).
 *
 * Modes:
 *  - shareUrl prop provided → opens immediately, no network call. Used for
 *    publicly-reachable URLs (the current /d/[shortId] page, public user
 *    deck profiles, or saved decks already flipped public).
 *  - deckList + analysis props provided → calls POST /api/deck-share on
 *    first click to mint a /d/[shortId] snapshot, then caches the URL.
 *    Only the *private saved deck* case needs this — every other surface
 *    passes a stable shareUrl directly.
 */
export default function QRCodeButton({ shareUrl, deckList, analysis, className }: Props) {
  const [open, setOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    shareUrl ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleOpen() {
    setError(false);

    if (resolvedUrl) {
      setOpen(true);
      return;
    }

    if (!deckList || !analysis) return;

    setLoading(true);
    try {
      const res = await fetch("/api/deck-share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deckList, analysis }),
      });
      const data = await res.json();
      if (res.ok && data.url) {
        setResolvedUrl(data.url);
        setOpen(true);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  const baseClasses =
    className ??
    "inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent bg-gradient-brand-reverse bg-origin-border px-3 py-1.5 text-xs font-semibold text-white shadow-brand hover:shadow-brand-lg transition disabled:opacity-50";

  return (
    <>
      <button
        onClick={handleOpen}
        disabled={loading}
        title="Share via QR code"
        className={baseClasses}
      >
        {loading ? (
          <>
            <svg
              className="w-3.5 h-3.5 animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Sharing…
          </>
        ) : (
          <>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.75}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 3.75 9.375v-4.5ZM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 0 1-1.125-1.125v-4.5ZM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0 1 13.5 9.375v-4.5Z"
              />
              <path d="M6.75 6.75h.75v.75h-.75v-.75ZM6.75 16.5h.75v.75h-.75V16.5ZM16.5 6.75h.75v.75h-.75v-.75ZM13.5 13.5h.75v.75h-.75V13.5ZM13.5 19.5h.75v.75h-.75V19.5ZM19.5 13.5h.75v.75h-.75V13.5ZM19.5 19.5h.75v.75h-.75V19.5ZM16.5 13.5h.75v.75h-.75V13.5ZM16.5 19.5h.75v.75h-.75V19.5Z" />
            </svg>
            Share
          </>
        )}
      </button>

      <ShareQRModal open={open && !!resolvedUrl} onClose={() => setOpen(false)} url={resolvedUrl ?? ""} />

      {/* Error toast (rare network failure) */}
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg animate-fade-toast">
          Couldn&apos;t generate share link — try again.
        </div>
      )}
    </>
  );
}
