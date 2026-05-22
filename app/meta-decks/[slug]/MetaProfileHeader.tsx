import type { ReactNode } from "react";

/**
 * Twitter-profile-style header for a meta deck page.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │  Banner — solid avatar-bg color with    │
 *   │  the preview card peeking from the      │
 *   │  right; card extends below banner edge  │
 *   │ ┌────┐                                  │
 *   │ │Avt │ overlapping bottom-left          │
 *   └─┴────┴──────────────────────────────────┘
 *      name + annotation
 *      stats grid
 *
 * Banner card placement
 * ─────────────────────
 * The full preview-card image sits in the right portion of the banner
 * with padding above. The card is sized larger than the banner so it
 * extends past the bottom edge (clipped by overflow-hidden); only the
 * upper ~33-40 % of the card is visible. The banner background is the
 * avatar's energy-type color, so the strip of empty space above and to
 * the left of the card reads as a coherent backdrop.
 *
 * Tuning the four constants below changes how the card sits:
 *  - CARD_TOP_PCT     — vertical inset (padding above the card)
 *  - CARD_RIGHT_PCT   — horizontal inset from the banner's right edge
 *  - CARD_WIDTH_PCT   — display width of the card as % of banner width
 *                       (drives visible height via card aspect ratio)
 *  - BANNER_ASPECT_WH — banner aspect ratio (width / height)
 */

const BANNER_ASPECT_WH = 3;     // 3:1
const CARD_TOP_PCT = 16;        // % of banner height — empty strip above
const CARD_RIGHT_PCT = 6;       // % of banner width  — inset from right edge
const CARD_WIDTH_PCT = 55;      // % of banner width  — card display width

interface Props {
  /** Archetype display name, e.g. "Dragapult". */
  name: string;
  /** Annotation appended after the name, e.g. "ex". Empty string skipped. */
  annotation?: string;
  /** Pokémon TCG card image URL — same as the preview card image. */
  cardImageUrl: string | null;
  /** Limitless sprite URL for the leading icon (e.g. dragapult.png). */
  iconUrl: string | null;
  /** Background color for the avatar circle — usually the primary card's
   *  energy-type color. */
  iconBg: string | null;
  /** Pre-formatted percentage, e.g. "19.6%". */
  representationPct: string;
  topCutEntries: number;
  /** Pre-formatted percentage, e.g. "16.6%". */
  conversionRate: string;
  /** Pre-formatted percentage, e.g. "49%". */
  winRate: string;
  /** Coloring hint: highlight win rate amber if true. */
  winRateHighlight: boolean;
  wins: number;
  losses: number;
  ties: number;
  totalEntries: number;
  /** Optional element rendered above the banner (typically a back link). */
  preBanner?: ReactNode;
  /** Action buttons row rendered to the right of the avatar overlap zone. */
  actions?: ReactNode;
  /**
   * Content rendered at the bottom of the bio (after the tournament record
   * line). Used for the top-5 variant cards grid so the "Posts" feed of
   * a Twitter profile sits inside the bio block, before the rest of the
   * page (Overview, accordions, etc.).
   */
  children?: ReactNode;
}

export default function MetaProfileHeader({
  name,
  annotation,
  cardImageUrl,
  iconUrl,
  iconBg,
  representationPct,
  topCutEntries,
  conversionRate,
  winRate,
  winRateHighlight,
  wins,
  losses,
  ties,
  totalEntries,
  preBanner,
  actions,
  children,
}: Props) {
  const fallbackBg = iconBg ?? "#B0A89E";

  return (
    <header className="flex-shrink-0">
      {/* Banner — solid avatar-bg color with the preview card peeking
          from the right. Sits flush at the top of the page; the back
          button (preBanner) overlays the top-left so the banner owns
          the full vertical space the old preBanner row used to take. */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: `${BANNER_ASPECT_WH} / 1`, background: fallbackBg }}
      >
        {cardImageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cardImageUrl}
            alt=""
            aria-hidden="true"
            className="absolute pointer-events-none select-none"
            style={{
              top: `${CARD_TOP_PCT}%`,
              right: `${CARD_RIGHT_PCT}%`,
              width: `${CARD_WIDTH_PCT}%`,
              height: "auto",
            }}
          />
        )}

        {/* Back button overlay — top-left, clears the iOS safe-area inset
            so it doesn't crash into a notch / dynamic island. Caller is
            expected to style the link so it reads on top of card art
            (translucent dark pill or similar). */}
        {preBanner && (
          <div className="absolute left-4 z-10" style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}>
            {preBanner}
          </div>
        )}
      </div>

      {/* Bio section. The avatar overlaps the banner via negative margin;
          we leave a matching block of padding on the right of the actions
          row so the action buttons don't crash into the avatar. */}
      <div className="mx-auto max-w-2xl px-6">
        {/* Avatar + actions row — both sit on the same baseline so the
            avatar can overlap the banner above. `relative z-10` ensures
            the avatar paints above the banner's bottom gradient overlay
            even though it lives in a later DOM block. */}
        <div className="flex items-end justify-between gap-3 -mt-16 sm:-mt-20">
          <div
            className="relative z-10 rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0"
            style={{
              background: fallbackBg,
              width: "128px",
              height: "128px",
            }}
          >
            {iconUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={iconUrl}
                alt=""
                className="w-[116px] h-[116px] object-contain"
              />
            ) : null}
          </div>
          {actions && (
            <div className="flex items-center gap-2 pb-1">{actions}</div>
          )}
        </div>

        {/* Name + annotation. */}
        <div className="mt-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight">
            {name}
            {annotation && (
              <span className="ml-2 text-base sm:text-lg font-semibold text-text-muted">
                {annotation}
              </span>
            )}
          </h1>
        </div>

        {/* Stats — one card per metric. The Tournament Record fields
            (Wins / Losses / Ties / Entries) sit as peer tiles in the
            same grid so the whole bio reads as a single stat board.
            4 columns across all breakpoints. */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          <StatCard label="Meta Share" value={representationPct} valueClass="text-accent" />
          <StatCard label="Top Cut" value={String(topCutEntries)} valueClass="text-amber-500" />
          <StatCard label="Conversion" value={conversionRate} valueClass="text-emerald-600" />
          <StatCard
            label="Win Rate"
            value={winRate}
            valueClass={winRateHighlight ? "text-amber-500" : "text-text-secondary"}
          />
          <StatCard label="Wins" value={wins.toLocaleString()} tone="gradient" />
          <StatCard label="Losses" value={losses.toLocaleString()} tone="dark" />
          {ties > 0 && (
            <StatCard label="Ties" value={ties.toLocaleString()} tone="ringed" />
          )}
          <StatCard
            label="Entries"
            value={totalEntries.toLocaleString()}
            valueClass="text-text-primary"
          />
        </div>
      </div>

      {/* Bio tail — variant cards grid lives in its own wider container so
          the 3-col desktop grid isn't cramped by the bio's 2xl width. */}
      {children && (
        <div className="mx-auto max-w-6xl px-6 mt-6">{children}</div>
      )}
    </header>
  );
}

/**
 * Tile in the bio stat grid.
 *
 * Tones echo the original W/L/T pill chrome so the tournament-record
 * trio still reads at a glance once flattened into the grid:
 *
 *  - "gradient" → site brand gradient bg, white text throughout (Wins)
 *  - "dark"     → solid black bg, white text throughout (Losses)
 *  - "ringed"   → default white card with a 1px black inset ring + black
 *                 label (Ties), mirroring the outlined T pill
 *  - "default"  → standard card chrome; `valueClass` colors the value
 */
function StatCard({
  label,
  value,
  valueClass = "",
  tone = "default",
}: {
  label: string;
  value: string;
  valueClass?: string;
  tone?: "default" | "gradient" | "dark" | "ringed";
}) {
  if (tone === "gradient") {
    return (
      <div className="rounded-2xl bg-gradient-brand shadow-sm px-4 py-3 text-center text-white">
        <p className="text-lg font-bold">{value}</p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "dark") {
    return (
      <div className="rounded-2xl bg-black shadow-sm px-4 py-3 text-center text-white">
        <p className="text-lg font-bold">{value}</p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "ringed") {
    return (
      <div className="rounded-2xl bg-white/90 backdrop-blur-xl shadow-[inset_0_0_0_1px_black] px-4 py-3 text-center">
        <p className="text-lg font-bold text-text-primary">{value}</p>
        <p className="text-xs text-text-primary mt-0.5">{label}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm px-4 py-3 text-center">
      <p className={`text-lg font-bold ${valueClass}`}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
}
