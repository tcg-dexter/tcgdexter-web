import Link from "next/link";
import { shade } from "@/lib/color";
import SpotlightBannerImage from "./SpotlightBannerImage";
import type { SpotlightAvatarPosition } from "../types";

interface Props {
  displayName: string;
  username: string;
  avatarUrl: string | null;
  headline: string | null;
  /** Three energy-type colors, ordered: favorite Pokémon, favorite in
   *  collection, favorite to play. Nulls collapse out — the gradient
   *  shows however many we have. */
  accentColors: (string | null)[];
  /** Optional foreground image overlaid on the banner gradient
   *  (typically the trainer's TCG Live avatar). */
  bannerImage?: {
    spotlightId: string;
    url: string;
    position: SpotlightAvatarPosition;
    /** When true, the image is draggable and PATCHes new x/y on drop.
     *  Only enabled for admins viewing the preview surface. */
    editable: boolean;
  };
}

const COLORLESS = "#B0A89E";

/**
 * Profile-style header for a published spotlight, mirroring the
 * meta-archetype and battle-banner pattern: a tall gradient banner up top,
 * a circular avatar overlapping its bottom-left, and the trainer name +
 * headline below. The banner gradient runs horizontally through the three
 * energy accents of the trainer's three favorites — left to right:
 * favorite Pokémon → collection card → format card. The avatar circle
 * picks up a vertical version of that same blend so it reads as the same
 * surface as the banner.
 */
export default function SpotlightHeader({
  displayName,
  username,
  avatarUrl,
  headline,
  accentColors,
  bannerImage,
}: Props) {
  // Drop nulls; if we have nothing, fall back to Colorless so the banner
  // still paints rather than collapsing to white.
  const stops = accentColors.filter((c): c is string => !!c);
  const usable = stops.length > 0 ? stops : [COLORLESS, COLORLESS, COLORLESS];

  // Horizontal 3-stop gradient across the banner; if a slot is missing we
  // still produce a smooth blend over whatever stops remain.
  const bannerGradient = `linear-gradient(90deg, ${usable
    .map((c, i) =>
      `${c} ${Math.round((i / Math.max(usable.length - 1, 1)) * 100)}%`,
    )
    .join(", ")})`;

  // Avatar uses a vertical fade (top stop → darker bottom) of the
  // first accent so it feels rooted in the banner without competing
  // with the horizontal blend behind it.
  const avatarTop = usable[0];
  const avatarGradient = `linear-gradient(180deg, ${avatarTop} 0%, ${shade(
    avatarTop,
    -22,
  )} 100%)`;

  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="flex-shrink-0">
      {/* Banner — 3:1 on desktop, ~33vh on mobile. Mirrors meta archetype
          and battle banner sizing so cross-surface page tops read at the
          same weight. The optional uploaded image floats over the
          gradient and (when editable) drags to reposition. */}
      <div
        className="relative w-full overflow-hidden h-[calc(34vw-12px)] sm:h-auto sm:aspect-[3/1]"
        style={{ background: bannerGradient }}
      >
        {bannerImage && (
          <SpotlightBannerImage
            spotlightId={bannerImage.spotlightId}
            url={bannerImage.url}
            initialPosition={bannerImage.position}
            editable={bannerImage.editable}
          />
        )}
      </div>

      {/* Bio block. The avatar overlaps the banner via negative margin. */}
      <div className="mx-auto max-w-2xl px-6">
        <div className="flex items-end justify-between gap-3 -mt-16 sm:-mt-20">
          <div
            className="relative z-10 rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0"
            style={{
              background: avatarGradient,
              width: "128px",
              height: "128px",
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-5xl font-black text-white drop-shadow-sm">
                {initial}
              </span>
            )}
          </div>
        </div>

        {/* Name + handle + headline. */}
        <div className="mt-3">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-accent mb-1">
            Trainer Spotlight
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight">
            {displayName}
          </h1>
          <Link
            href={`/u/${username}`}
            className="inline-block text-sm text-text-muted hover:text-accent mt-0.5"
          >
            @{username}
          </Link>
          {headline && (
            <p className="text-sm sm:text-base text-text-secondary mt-3 leading-relaxed">
              {headline}
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
