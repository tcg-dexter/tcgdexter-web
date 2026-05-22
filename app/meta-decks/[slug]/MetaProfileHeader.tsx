import type { ReactNode } from "react";

/**
 * Twitter-profile-style header for a meta deck page.
 *
 * Layout:
 *   ┌─────────────────────────────────────────┐
 *   │  Banner — card art frame, cropped 3:1   │
 *   │ ┌────┐                                  │
 *   │ │Avt │ overlapping bottom-left          │
 *   └─┴────┴──────────────────────────────────┘
 *      name + annotation
 *      stats (4 inline)
 *      tournament record pills
 *
 * Banner cropping
 * ─────────────
 * Pokémon TCG card images are full-card scans (the whole card silhouette,
 * including name + text box). We want only the *art frame*. Empirically
 * the art on modern V/ex/Mega cards lives at roughly
 *
 *   x: 6%–94%    (88% wide)
 *   y: 12%–56%   (44% tall, center at 34%)
 *
 * Card aspect ratio 245 × 342 ≈ 0.716 (W/H). To make the art width fill a
 * 3:1 banner, we scale the image to 1/0.88 = 113.6% of banner width, then
 * shift it −6.8% left and −90% top (~ −30% of banner width, which pulls
 * the art's vertical center to the banner's vertical center). Both offsets
 * are expressed as percentages of the banner so the crop survives any
 * container width.
 *
 * The actual art-frame coords vary slightly per card layout (regular vs
 * V vs Mega vs trainer), so the values below are a conservative average —
 * tune if a specific archetype looks off.
 */

const CARD_ART_INSET_X = 0.06;          // 6% inset on each side
const CARD_ART_INSET_TOP = 0.12;        // 12% from top
const CARD_ART_INSET_BOTTOM = 1 - 0.56; // bottom of frame at 56% from top
const CARD_ART_WIDTH_FRAC = 1 - 2 * CARD_ART_INSET_X; // 0.88
const CARD_ART_HEIGHT_FRAC =
  1 - CARD_ART_INSET_TOP - CARD_ART_INSET_BOTTOM; // 0.44
const CARD_ART_CENTER_Y_FRAC =
  CARD_ART_INSET_TOP + CARD_ART_HEIGHT_FRAC / 2; // 0.34
const CARD_ASPECT_HW = 342 / 245; // height/width

const BANNER_ASPECT_WH = 3; // 3:1

// Scale to make art width = banner width
const IMG_SCALE = 1 / CARD_ART_WIDTH_FRAC; // 1.1364
// Horizontal offset: shift image left so art left edge sits at banner left
const IMG_LEFT_PCT = -CARD_ART_INSET_X * IMG_SCALE * 100; // ≈ -6.82%
// Vertical offset (as % of banner HEIGHT, since `top` is %-of-container-height):
//   image_top_px = banner_center_px - art_center_in_image_px
//   art_center_in_image_px = CARD_ART_CENTER_Y_FRAC × image_height_displayed
//   image_height_displayed = IMG_SCALE × banner_width × CARD_ASPECT_HW
//   banner_center_px = banner_height / 2 = banner_width / (2 × BANNER_ASPECT_WH)
// → image_top_px / banner_height = ...
const IMG_TOP_PCT =
  ((1 / (2 * BANNER_ASPECT_WH)) -
    CARD_ART_CENTER_Y_FRAC * IMG_SCALE * CARD_ASPECT_HW) *
  BANNER_ASPECT_WH *
  100; // ≈ -91%

interface Props {
  /** Archetype display name, e.g. "Dragapult". */
  name: string;
  /** Annotation appended after the name, e.g. "ex". Empty string skipped. */
  annotation?: string;
  /** Rank in the Standard top-30 ranking. */
  rank: number;
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
  rank,
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
      {/* Top status bar — back link + rank pill, sits above the banner. */}
      {preBanner && (
        <div className="px-6 pt-[calc(env(safe-area-inset-top)_+_0.75rem)] pb-3 max-w-2xl mx-auto flex items-center justify-between gap-3">
          {preBanner}
          <span className="text-[11px] font-semibold uppercase tracking-widest text-accent shrink-0">
            #{rank} in Standard
          </span>
        </div>
      )}

      {/* Banner — clipped card art. */}
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
              width: `${IMG_SCALE * 100}%`,
              left: `${IMG_LEFT_PCT}%`,
              top: `${IMG_TOP_PCT}%`,
            }}
          />
        )}
        {/* Subtle bottom gradient so the avatar reads cleanly when card art
            is bright. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-1/3 pointer-events-none"
          style={{
            background:
              "linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 100%)",
          }}
        />
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
            2x2 columns on narrow screens, 1x4 from `sm:` up. */}
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Meta Share" value={representationPct} valueClass="text-accent" />
          <StatCard label="Top Cut" value={String(topCutEntries)} valueClass="text-amber-500" />
          <StatCard label="Conversion" value={conversionRate} valueClass="text-emerald-600" />
          <StatCard
            label="Win Rate"
            value={winRate}
            valueClass={winRateHighlight ? "text-amber-500" : "text-text-secondary"}
          />
          <StatCard label="Wins" value={wins.toLocaleString()} valueClass="text-emerald-600" />
          <StatCard label="Losses" value={losses.toLocaleString()} valueClass="text-text-secondary" />
          {ties > 0 && (
            <StatCard label="Ties" value={ties.toLocaleString()} valueClass="text-text-secondary" />
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

function StatCard({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm px-4 py-3 text-center">
      <p className={`text-lg font-bold ${valueClass}`}>{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
}
