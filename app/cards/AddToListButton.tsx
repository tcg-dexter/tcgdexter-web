"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AddToListOverlay from "./AddToListOverlay";

interface Props {
  setId: string;
  number: string;
  isAuthenticated: boolean;
  /** The card image to wrap — the overlay paints directly on top of it. */
  image: ReactNode;
}

/**
 * Card image wrapper + "+ Add to List" trigger for the card detail page.
 * Signed-out clicks redirect to sign-in (mirrors FollowButton). Signed-in
 * opens AddToListOverlay directly on top of the image — the same in-card
 * overlay treatment the catalog grid tile uses (see GridTile.tsx) — rather
 * than a floating dropdown, so both surfaces share one "add to list"
 * visual language.
 */
export default function AddToListButton({ setId, number, isAuthenticated, image }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  function handleTrigger() {
    if (!isAuthenticated) {
      router.push(`/sign-in?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <div className="relative">
        {image}
        {open && <AddToListOverlay setId={setId} number={number} onClose={() => setOpen(false)} />}
      </div>

      <button
        type="button"
        onClick={handleTrigger}
        aria-label="Add to list"
        aria-expanded={isAuthenticated ? open : undefined}
        className="w-full inline-flex items-center justify-center gap-1.5 h-10 rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-semibold hover:opacity-90 transition-opacity"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="w-4 h-4"
        >
          <path d="M10 4v12M4 10h12" />
        </svg>
        Add to List
      </button>
    </>
  );
}
