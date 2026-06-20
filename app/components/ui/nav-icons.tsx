/**
 * Shared inline-SVG icon set for the desktop sidebar rails.
 *
 * Conventions:
 *   - 20×20 render size, 24-unit viewBox.
 *   - currentColor for stroke (outline icons) or fill (brand marks) so the
 *     icon inherits text-text-secondary / hover:text-text-primary from the
 *     link wrapper.
 *   - aria-hidden because the adjacent text label is the accessible name.
 *
 * Keep icons stroke-based at 1.5 width unless they're brand marks (Discord,
 * TikTok), which use their official filled forms.
 */

type IconProps = { className?: string };

/** Base props shared by every outline icon. */
const outlineProps = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

/** Two stacked rectangles — "Create a Deck Profile". */
export function StackIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <rect x="3.5" y="7.5" width="13" height="13" rx="2" />
      <path d="M7.5 7.5V5.5a2 2 0 012-2h9a2 2 0 012 2v10a2 2 0 01-2 2h-2" />
    </svg>
  );
}

/** Wrench — "Admin Tools". */
export function WrenchIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M14.7 6.3a4 4 0 105.0 5.0L20 11l-7.6 7.6a2.5 2.5 0 11-3.5-3.5L16.5 7.5l-.8-1.2z" />
    </svg>
  );
}

/** Trophy — "Meta Archetypes". */
export function TrophyIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M8 21h8M12 17v4M7 4h10v3a5 5 0 01-10 0V4z" />
      <path d="M17 4h3v3a3 3 0 01-3 3M7 4H4v3a3 3 0 003 3" />
    </svg>
  );
}

/** Speedometer / gauge — "Mission control" / Dashboard. */
export function GaugeIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M4 17a8 8 0 0116 0" />
      <path d="M12 17l4-5" />
      <circle cx="12" cy="17" r="1" />
    </svg>
  );
}

/** Envelope — "CRM" / mail campaigns. */
export function MailIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3.5 7l8.5 6.5L20.5 7" />
    </svg>
  );
}

/** Vertical bars — "Leaderboard". */
export function ChartBarIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M3 21h18M7 17V11M12 17V5M17 17v-7" />
    </svg>
  );
}

/** Open book — "Learn to Play". */
export function BookOpenIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M12 6.5C10 5 6.5 4 3 5v13c3.5-1 7 0 9 1.5" />
      <path d="M12 6.5C14 5 17.5 4 21 5v13c-3.5-1-7 0-9 1.5" />
    </svg>
  );
}

/** Person — auth row (Sign in / Profile). */
export function UserIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5" />
    </svg>
  );
}

/** Shopping bag — "Card Shop". */
export function ShoppingBagIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M5 7h14l-1.5 13H6.5L5 7z" />
      <path d="M9 7V5a3 3 0 016 0v2" />
    </svg>
  );
}

/** Discord brand mark — filled, currentColor. */
export function DiscordIcon({ className }: IconProps) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M19.27 5.33c-1.45-.65-3-1.13-4.61-1.4-.07-.01-.14.02-.18.07-.2.36-.42.83-.58 1.2-1.74-.26-3.47-.26-5.16 0-.16-.38-.39-.84-.59-1.2-.04-.05-.11-.08-.18-.07-1.61.27-3.16.75-4.61 1.4-.03.01-.05.03-.07.06C.42 9.78-.32 14.09.04 18.34c0 .04.03.08.06.11 1.86 1.37 3.66 2.2 5.43 2.74.07.02.14 0 .19-.06.42-.57.79-1.18 1.11-1.81.02-.04 0-.09-.04-.1-.6-.22-1.16-.49-1.71-.81-.04-.02-.05-.08-.01-.11.12-.09.23-.18.34-.27.02-.02.05-.02.07-.01 3.59 1.65 7.47 1.65 11.02 0 .02-.01.05-.01.07.01.11.09.22.18.34.27.04.03.04.09-.01.11-.54.31-1.11.59-1.71.81-.04.01-.06.06-.04.1.33.63.7 1.23 1.11 1.8.05.06.12.08.19.06 1.78-.55 3.58-1.37 5.44-2.74.03-.02.05-.06.06-.1.39-4.91-.66-9.19-2.81-12.95-.02-.03-.05-.05-.07-.06zM8.52 15.75c-1.07 0-1.95-.99-1.95-2.2 0-1.21.86-2.2 1.95-2.2 1.1 0 1.97 1 1.95 2.2 0 1.21-.86 2.2-1.95 2.2zm7.21 0c-1.07 0-1.95-.99-1.95-2.2 0-1.21.86-2.2 1.95-2.2 1.1 0 1.97 1 1.95 2.2 0 1.21-.85 2.2-1.95 2.2z" />
    </svg>
  );
}

/** 2x2 squares — "Cards". */
export function CardsIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </svg>
  );
}

/** Bookmark — "My Decks". */
export function BookmarkIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <path d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  );
}

/** Playmat with 3 rows of card zones — "Playmat Studio". */
export function PlaymatIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      {/* Mat border */}
      <rect x="1" y="5" width="22" height="14" rx="2" />
      {/* Row 1 — 5 cards, varying width */}
      <rect x="2.5" y="6.5" width="3"   height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="6.3" y="6.5" width="3.8" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="10.9" y="6.5" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="14.2" y="6.5" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="17.5" y="6.5" width="4"   height="3" rx="0.5" fill="currentColor" stroke="none" />
      {/* Row 2 — 5 cards */}
      <rect x="2.5"  y="10.3" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="5.8"  y="10.3" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="9.1"  y="10.3" width="2"   height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="11.9" y="10.3" width="4.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="17.2" y="10.3" width="4.3" height="3" rx="0.5" fill="currentColor" stroke="none" />
      {/* Row 3 — 4 cards */}
      <rect x="2.5"  y="14.1" width="2.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="5.8"  y="14.1" width="4.8" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="11.4" y="14.1" width="3.5" height="3" rx="0.5" fill="currentColor" stroke="none" />
      <rect x="15.7" y="14.1" width="5.8" height="3" rx="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Two overlapping circles — "Matches". */
export function VersusIcon({ className }: IconProps) {
  return (
    <svg {...outlineProps} className={className}>
      <circle cx="9.5" cy="12" r="6.5" />
      <circle cx="14.5" cy="12" r="6.5" />
    </svg>
  );
}

/** TikTok brand mark — filled, currentColor. */
export function TikTokIcon({ className }: IconProps) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.84-.1z" />
    </svg>
  );
}
