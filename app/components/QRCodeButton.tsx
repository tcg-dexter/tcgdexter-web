"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

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
 * Button that generates (or reuses) a share link and presents a QR code
 * in a modal overlay. Matches the existing modal pattern used in ShareButton
 * and SaveDeckButton.
 *
 * Modes:
 *  - shareUrl prop provided → opens immediately, no API call needed.
 *  - deckList + analysis props provided → calls POST /api/deck-share on first
 *    click, then caches the resulting URL for subsequent opens.
 */
export default function QRCodeButton({ shareUrl, deckList, analysis, className }: Props) {
  const [open, setOpen] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(
    shareUrl ?? null
  );
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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

  async function handleCopy() {
    if (!resolvedUrl) return;
    try {
      await navigator.clipboard.writeText(resolvedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silent */
    }
  }

  const qrSrc = resolvedUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(
        resolvedUrl
      )}&color=1a1a1a&bgcolor=ffffff&margin=1`
    : null;

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

      {/* ── Modal overlay ─────────────────────────────────────────── */}
      {mounted && open && resolvedUrl && createPortal(
        <div
          className="fixed z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          style={{
            top: "calc(-1 * env(safe-area-inset-top))",
            right: "calc(-1 * env(safe-area-inset-right))",
            bottom: "calc(-1 * env(safe-area-inset-bottom))",
            left: "calc(-1 * env(safe-area-inset-left))",
          }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white/90 backdrop-blur-xl border border-black/5 p-6 shadow-brand-lg"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-base font-semibold text-text-primary">
                Share Deck
              </h2>
              <button
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-text-muted hover:text-text-primary hover:bg-black/5 transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* QR Code */}
            <div className="flex justify-center mb-5">
              <div className="relative">
                {/* Gradient glow */}
                <div className="absolute -inset-px rounded-xl bg-gradient-brand opacity-60 blur-xl pointer-events-none" />
                <div className="relative rounded-xl border border-black/5 bg-white p-3">
                  {qrSrc && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={qrSrc}
                      alt="QR code for deck share link"
                      width={180}
                      height={180}
                      className="rounded-md block"
                    />
                  )}
                </div>
              </div>
            </div>

            {/* URL + Copy button */}
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={resolvedUrl}
                onFocus={(e) => e.target.select()}
                className="flex-1 min-w-0 rounded-lg border border-black/5 bg-white px-3 py-2 text-xs text-text-secondary focus:outline-none"
              />
              <button
                onClick={handleCopy}
                className="flex-shrink-0 rounded-full bg-accent px-3 py-2 text-xs font-semibold text-white hover:bg-accent-light transition-colors"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Error toast (rare network failure) */}
      {error && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg animate-fade-toast">
          Couldn&apos;t generate share link — try again.
        </div>
      )}
    </>
  );
}
