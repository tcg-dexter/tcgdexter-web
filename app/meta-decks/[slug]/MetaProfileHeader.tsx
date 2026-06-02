import type { ReactNode } from "react";
import { shade } from "@/lib/color";
import { StatCard, ResponsiveLabel } from "@/app/components/StatCard";

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
 * Cards are *bottom-anchored*: each card sits with its bottom edge at
 * the banner's bottom edge, then shifts down by a fraction of its own
 * height (`BOTTOM_CLIP_PCT`) via `transform: translateY(...)`. Because
 * translateY's percentage is relative to the element's own height, the
 * portion of each card that gets clipped by `overflow-hidden` is a
 * fixed fraction of card height — *independent of banner height*. So a
 * shorter banner only trims the empty avatar-color space above the
 * cards; it never eats into the visible portion of the cards below.
 *
 * The row is horizontally centered inside the same max-w-6xl container
 * the variant grid below uses, so the fan spans the full width of the
 * deck-list preview row.
 *
 * Per-card left offset is derived from `(SPAN - CARD_WIDTH) / (count-1)`
 * so the row always spans the full container regardless of how many
 * cards we actually have (1..7).
 *
 * Banner sizing is responsive:
 *
 *   - Mobile (< `sm:`): explicit `h-[calc(34vw-12px)]`. The formula
 *     targets a constant ~4px gap between the raised centre card's top
 *     edge and the banner top across common phone viewports. It is
 *     derived from `CARD_WIDTH_PCT`, the inner container's 48px gutters
 *     (`mx-6` × 2), the pokemon-card aspect (~1.396), and the centre
 *     card's effective height fraction `1 − (BOTTOM_CLIP_PCT −
 *     CENTER_RAISE_CARD_PCT)/100 = 0.76`. Re-derive if any of those
 *     change: `banner_h ≈ 0.76 × CARD_WIDTH_PCT/100 × 1.396 × (vw − 48)
 *     + 4`, which simplifies to ≈ `0.34 × vw − 12 px` with the current
 *     constants.
 *   - `sm:` and up: `sm:h-auto sm:aspect-[3/1]` cancels the calc'd
 *     height and falls back to the original 3:1 aspect. Desktop render
 *     is unchanged.
 *
 * The centre card is the binding constraint because CENTER_RAISE_CARD_PCT
 * lifts it higher than the outer cards.
 *
 * Tuning constants:
 *  - BOTTOM_CLIP_PCT       — % of card height that sits below the banner
 *  - CENTER_RAISE_CARD_PCT — % of card height the centre card is raised
 *  - CARDS_SPAN_PCT        — % of inner container width; total fan span
 *  - CARD_WIDTH_PCT        — % of inner container width; per-card display width
 */

const CARDS_SPAN_PCT = 80;      // % of inner container width — fan total span
const CARD_WIDTH_PCT = 32;      // % of inner container width — per card

// Fan-like-a-playing-hand tuning. The center card sits
// CENTER_RAISE_CARD_PCT higher (less clipped) than the outer cards;
// intermediate cards interpolate along a quadratic so the fan reads as
// an arc rather than a straight tilt. CARD_MAX_ROTATION_DEG is the
// outermost card's tilt; intermediate cards interpolate linearly
// between 0 and ±max. Cards rotate around their own bottom-center so
// the bottom edge of each card stays put, mimicking the way real cards
// in a hand pivot at the player's wrist.
//
// BOTTOM_CLIP_PCT and CENTER_RAISE_CARD_PCT are calibrated against the
// previous top-anchored geometry (CARDS_TOP_PCT=25, CENTER_RAISE_PCT=12.5
// of banner height) at a typical desktop viewport so the desktop render
// stays visually unchanged.
const BOTTOM_CLIP_PCT = 35;           // % of card height — outer card clip
const CENTER_RAISE_CARD_PCT = 11;     // % of card height — centre raise
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
  // Vertical gradient: accent color at the top → a few shades darker
  // at the bottom. Mirrors the battle banner's matchup gradient so the
  // page-top treatment reads consistently across the site, and lets
  // the sticky mobile toolbar stay painted with the solid top color
  // (still equal to the gradient's 0% stop).
  const bannerGradient = `linear-gradient(180deg, ${fallbackBg} 0%, ${shade(fallbackBg, -22)} 100%)`;

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
        className="relative w-full overflow-hidden h-[calc(34vw-12px)] sm:h-auto sm:aspect-[3/1]"
        style={{ background: bannerGradient }}
      >
        {/* Cards layer — constrained to the same max-w-6xl ± px-6 the
            variant grid below uses, so the fan spans the full width of
            the deck-list preview row regardless of viewport. */}
        <div className="absolute inset-0 mx-auto max-w-6xl">
          {/* Desktop (sm:+) shrinks the fan to 90% of its mobile size while
              keeping each card's bottom edge pinned to the banner's bottom
              via `origin-bottom`. Banner height is unaffected because the
              scale is purely a transform on the cards layer. */}
          <div className="relative h-full mx-6 sm:scale-90 sm:origin-bottom sm:translate-y-[10px]">
            {bannerCards.map((url, i) => {
              const left =
                cardCount === 1
                  ? singleCardLeft
                  : cardsLeftStart + i * cardsStep;

              // Fan geometry — per-card clip + rotation derived from the
              // card's signed distance from the row's center.
              //
              //   normDist = |i - center| / maxDist  (0 at centre, 1 at edge)
              //   clipPct  = BOTTOM_CLIP_PCT - CENTER_RAISE_CARD_PCT × (1 - normDist²)
              //   rotation = (i - center) / maxDist × CARD_MAX_ROTATION_DEG
              //
              // The quadratic on clipPct gives the row a smooth arc — the
              // middle card sits CENTER_RAISE_CARD_PCT higher (less
              // clipped) than the outer cards. clipPct is a percentage of
              // the card's own height, applied via translateY, so the
              // bottom-clip stays a fixed fraction of card height even
              // when the banner gets shorter (mobile aspect-[16/5]).
              const center = (cardCount - 1) / 2;
              const signedDist = i - center;
              const maxDist = Math.max(center, 1);
              const normDist = Math.abs(signedDist) / maxDist;
              const clipPct =
                BOTTOM_CLIP_PCT -
                CENTER_RAISE_CARD_PCT * (1 - normDist * normDist);
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
                    bottom: 0,
                    left: `${left}%`,
                    width: `${CARD_WIDTH_PCT}%`,
                    height: "auto",
                    transform: `translateY(${clipPct}%) rotate(${rotationDeg}deg)`,
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
              background: bannerGradient,
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

