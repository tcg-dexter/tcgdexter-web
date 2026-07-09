"use client";

import { useState } from "react";

interface Props {
  /**
   * Optional className override for the trigger button. Defaults to a
   * small inline (i) icon that matches text-muted color.
   */
  className?: string;
}

/**
 * Inline (i) info button + modal explaining the 2026 Standard Format
 * rotation. Drop next to any "Not legal in Standard Format" text where
 * a user might want to know what changed and why.
 */
export default function StandardFormatInfo({ className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label="What is Standard Format?"
        className={
          className ??
          "inline-flex items-center justify-center text-text-muted hover:text-text-primary transition-colors"
        }
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
            d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
          />
        </svg>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-border bg-surface p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-4">
              <h2 className="text-lg font-semibold text-text-primary">
                Standard Format
              </h2>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-text-muted hover:text-text-primary transition-colors -mt-1 -mr-1 p-1"
              >
                <svg
                  className="w-5 h-5"
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

            <p className="text-sm text-text-secondary leading-relaxed">
              2026 Standard Format went into effect on April 10, 2026.
              Cards with a G-mark and earlier are no longer legal — with
              one exception: a Trainer card is legal on any printing as
              long as it&apos;s also been reprinted with a current
              regulation mark. Boss&apos;s Orders, for example, is still
              legal even on an older G-mark copy, since it has since
              been reprinted with a current mark.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
