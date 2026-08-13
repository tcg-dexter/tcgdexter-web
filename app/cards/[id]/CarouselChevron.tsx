"use client";

/**
 * Prev/next control for the card detail page's horizontal carousels.
 * `noun` names what's being scrolled so the aria-label reads naturally
 * ("Previous decks", "Next lists").
 */
export default function CarouselChevron({
  direction,
  noun,
  disabled,
  onClick,
}: {
  direction: "left" | "right";
  noun: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${direction === "left" ? "Previous" : "Next"} ${noun}`}
      className="inline-flex items-center justify-center w-8 h-8 rounded-full border border-black/10 bg-white dark:bg-surface-2 text-text-primary disabled:text-text-muted disabled:bg-surface disabled:cursor-not-allowed hover:bg-surface transition-colors"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {direction === "left" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}
