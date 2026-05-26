import type { ReactNode } from "react";

/**
 * Twitter-profile-style header for a meta deck page.
 *
 * Layout:
 *   ┌──────────────────────────────────────────┐
 *   │ Banner — solid avatar-bg color with the  │
 *   │ 7 most common cards across the top-5     │
 *   │ deck lists fanned across the row at the  │
 *   │ same top inset / card size as the prior  │
 *   │ single-card peek                         │
 *   │ ┌────┐                                   │
 *   │ │Avt │ overlapping bottom-left           │
 *   └─┴────┴───────────────────────────────────┘
 *      name + annotation
 *      stats grid
 *
 * Banner card placement
 * ─────────────────────
 * Each card sits at CARDS_TOP_PCT from the top of the banner and renders
 * at full height; cards that extend past the bottom of the banner are
 * clipped by the banner's overflow-hidden. The row of cards is centered
 * horizontally within the same max-w-6xl container the variant grid
 * below uses, so the fan visually spans the full width of the deck-list
 * preview row.
 *
 * Per-card left offset is derived from `(SPAN - CARD_WIDTH) / (count-1)`
 * so the row always spans the full container regardless of how many
 * cards we actually have (1..7).
 *
 * Tuning constants:
 *  - CARDS_TOP_PCT     — % of banner height; vertical inset to first card
 *  - CARDS_SPAN_PCT    — % of inner container width; total fan span
 *  - CARD_WIDTH_PCT    — % of inner container width; per-card display width
 *  - BANNER_ASPECT_WH  — banner aspect ratio (width / height)
 */

const BANNER_ASPECT_WH = 3;     // 3:1
const CARDS_TOP_PCT = 25;       // % of banner height; the *outer* cards' top
const CARDS_SPAN_PCT = 80;      // % of inner container width — fan total span
const CARD_WIDTH_PCT = 32;      // % of inner container width — per card

// Fan-like-a-playing-hand tuning. The center card sits CENTER_RAISE_PCT
// higher (closer to the banner top) than the outer cards; intermediate
// cards interpolate along a quadratic so the fan reads as an arc rather
// than a straight tilt. CARD_MAX_ROTATION_DEG is the outermost card's
// tilt; intermediate cards interpolate linearly between 0 and ±max.
// Cards rotate around their own bottom-center so the bottom edge of each
// card stays put, mimicking the way real cards in a hand pivot at the
// player's wrist.
const CENTER_RAISE_PCT = 12.5;        // top % offset; centre = TOP_PCT − this
const CARD_MAX_ROTATION_DEG = 12;     // degrees at the leftmost/rightmost

interface Props {
  /** Archetype display name, e.g. "Dragapult". */
  name: string;
  /** Annotation appended after the name, e.g. "ex". Empty string skipped. */
  annotation?: string;
  /** Up to 7 pokemontcg.io card image URLs — the most common cards across
   *  the archetype's top-5 deck lists, ordered most → least common. They
   *  fan across the banner with even overlap; later entries paint on top
   *  of earlier ones. */
  bannerCards: string[];
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
  bannerCards,
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

  // Even-spaced overlap math — derive each card's left edge from the
  // total span, the per-card width, and the count of cards we actually
  // have to render (1..N). With N cards, there are (N-1) gaps; each gap
  // is (SPAN - CARD_WIDTH) / (N-1). Single-card edge case falls back to
  // centered placement.
  const cardCount = bannerCards.length;
  const cardsLeftStart = (100 - CARDS_SPAN_PCT) / 2;
  const cardsStep =
    cardCount > 1
      ? (CARDS_SPAN_PCT - CARD_WIDTH_PCT) / (cardCount - 1)
      : 0;
  const singleCardLeft = (100 - CARD_WIDTH_PCT) / 2;

  return (
    <header className="flex-shrink-0">
      {/* Banner — solid avatar-bg color with the top-7 cards fanned
          across the middle, each peeking from behind the next. Sits
          flush at the top of the page; the back button (preBanner)
          overlays the top-left. */}
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: `${BANNER_ASPECT_WH} / 1`, background: fallbackBg }}
      >
        {/* Cards layer — constrained to the same max-w-6xl ± px-6 the
            variant grid below uses, so the fan spans the full width of
            the deck-list preview row regardless of viewport. */}
        <div className="absolute inset-0 mx-auto max-w-6xl">
          <div className="relative h-full mx-6">
            {bannerCards.map((url, i) => {
              const left =
                cardCount === 1
                  ? singleCardLeft
                  : cardsLeftStart + i * cardsStep;

              // Fan geometry — per-card top + rotation derived from the
              // card's signed distance from the row's center.
              //
              //   normDist = |i - center| / maxDist  (0 at centre, 1 at edge)
              //   top      = CARDS_TOP_PCT - CENTER_RAISE_PCT × (1 - normDist²)
              //   rotation = (i - center) / maxDist × CARD_MAX_ROTATION_DEG
              //
              // The quadratic on top gives the row a smooth arc — the
              // middle card sits CENTER_RAISE_PCT higher than the outer
              // cards, which themselves stay at CARDS_TOP_PCT so they
              // never drop below the banner edge.
              const center = (cardCount - 1) / 2;
              const signedDist = i - center;
              const maxDist = Math.max(center, 1);
              const normDist = Math.abs(signedDist) / maxDist;
              const top =
                CARDS_TOP_PCT -
                CENTER_RAISE_PCT * (1 - normDist * normDist);
              const rotationDeg =
                cardCount > 1
                  ? (signedDist / maxDist) * CARD_MAX_ROTATION_DEG
                  : 0;

              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`${i}-${url}`}
                  src={url}
                  alt=""
                  aria-hidden="true"
                  className="absolute pointer-events-none select-none drop-shadow-md"
                  style={{
                    top: `${top}%`,
                    left: `${left}%`,
                    width: `${CARD_WIDTH_PCT}%`,
                    height: "auto",
                    transform: `rotate(${rotationDeg}deg)`,
                    transformOrigin: "50% 100%",
                    zIndex: i,
                  }}
                />
              );
            })}
          </div>
        </div>

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
                // Sprite sized to ~78% of the 128px circle so there's a
                // visible ring of avatar-bg color around the artwork
                // instead of the previous nearly-flush 116px fit.
                className="w-[100px] h-[100px] object-contain"
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
            4 columns across all breakpoints. Mobile-shortened labels
            on the longer headers prevent any single tile from being
            stretched by an unwrappable word. */}
        <div className="mt-4 grid grid-cols-4 gap-3">
          <StatCard
            label={<ResponsiveLabel mobile="Share" desktop="Meta Share" />}
            value={representationPct}
            valueClass="text-accent"
          />
          <StatCard label="Top Cut" value={String(topCutEntries)} valueClass="text-amber-500" />
          <StatCard
            label={<ResponsiveLabel mobile="Conv." desktop="Conversion" />}
            value={conversionRate}
            valueClass="text-emerald-600"
          />
          <StatCard
            label={<ResponsiveLabel mobile="W Rate" desktop="Win Rate" />}
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
 *
 * Label is a ReactNode so callers can swap copy responsively (e.g. via
 * `ResponsiveLabel` below) without per-tone overloads. `tabular-nums`
 * on the value keeps "16.6%" and "19.6%" the same visual width across
 * tiles instead of letting proportional-digit kerning shift them.
 */
function StatCard({
  label,
  value,
  valueClass = "",
  tone = "default",
}: {
  label: ReactNode;
  value: string;
  valueClass?: string;
  tone?: "default" | "gradient" | "dark" | "ringed";
}) {
  if (tone === "gradient") {
    return (
      <div className="rounded-2xl bg-gradient-brand shadow-sm px-4 py-3 text-center text-white">
        <p className="text-lg font-bold tabular-nums">{value}</p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "dark") {
    return (
      <div className="rounded-2xl bg-black shadow-sm px-4 py-3 text-center text-white">
        <p className="text-lg font-bold tabular-nums">{value}</p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "ringed") {
    return (
      <div className="rounded-2xl bg-white/90 backdrop-blur-xl shadow-[inset_0_0_0_1px_black] px-4 py-3 text-center">
        <p className="text-lg font-bold text-text-primary tabular-nums">{value}</p>
        <p className="text-xs text-text-primary mt-0.5">{label}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm px-4 py-3 text-center">
      <p className={`text-lg font-bold tabular-nums ${valueClass}`}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
}

/** Tiny helper: render `mobile` text below `sm:` and `desktop` text from
 *  `sm:` up. Used by the bio stat grid to keep tiles uniform-width on
 *  mobile -- a single-word label like "Conversion" was overflowing its
 *  tile's content area and visually breaking center alignment. */
function ResponsiveLabel({
  mobile,
  desktop,
}: {
  mobile: string;
  desktop: string;
}) {
  return (
    <>
      <span className="sm:hidden">{mobile}</span>
      <span className="hidden sm:inline">{desktop}</span>
    </>
  );
}
