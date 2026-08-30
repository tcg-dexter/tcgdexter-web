"use client";

import { useState } from "react";
import ShareQRModal from "@/app/components/ShareQRModal";

interface Props {
  /** Canonical, publicly-reachable URL for this card's detail page. */
  shareUrl: string;
}

/**
 * "Share Card" trigger for the card detail page. Card pages are public for
 * everyone, so unlike the list and deck share flows there's no visibility
 * check or short-link minting to do first — the canonical URL is already
 * shareable, and the modal opens straight away.
 *
 * Sits beside Add to List and matches its height, taking the site gradient
 * so the pair reads as one action row (Add to List is the black/ink button,
 * this is the gradient one).
 */
export default function ShareCardButton({ shareUrl }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Share card"
        className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full gradient-brand text-sm font-semibold shadow-brand hover:shadow-brand-lg transition-shadow"
      >
        <svg
          aria-hidden="true"
          className="w-4 h-4"
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
        Share Card
      </button>

      <ShareQRModal
        open={open}
        onClose={() => setOpen(false)}
        url={shareUrl}
        title="Share Card"
      />
    </>
  );
}
