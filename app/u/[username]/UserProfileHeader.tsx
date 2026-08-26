import type { CSSProperties, ReactNode } from "react";
import { shade } from "@/lib/color";
import { ENERGY_HEX } from "@/app/components/DeckProfileView";
import { StatCard } from "@/app/components/StatCard";
import AvatarPicker from "./AvatarPicker";
import AnimatedGradient from "@/app/components/AnimatedGradient";
import { FAN_TOTAL_MS } from "@/lib/entranceTiming";

/**
 * Energy-accent keys the picker (and DB check constraint) accept.
 * Kept in sync with `profiles_banner_accent_check` in the migration
 * 20260602_profile_banner_accent.sql.
 */
export const BANNER_ACCENT_KEYS = [
  "Fire",
  "Water",
  "Grass",
  "Lightning",
  "Psychic",
  "Fighting",
  "Darkness",
  "Metal",
  "Dragon",
  "Fairy",
  "Colorless",
] as const;
export type BannerAccent = (typeof BANNER_ACCENT_KEYS)[number];

/** Site signature gradient, rotated 180deg so the header reads top→bottom
 *  like the energy-accent variants. The horizontal `bg-gradient-brand`
 *  Tailwind token is still used for stat tiles (Wins) — that one stays
 *  90deg by design. */
export const BRAND_BANNER_GRADIENT =
  "linear-gradient(180deg, #F2A20C 0%, #D91E0D 50%, #A60D0D 100%)";

/** Top stop (0%) of the brand gradient — drives the mobile browser
 *  chrome via <ThemeColor> so the gradient appears to extend up to the
 *  status bar / notch on iOS Safari, Android Chrome, etc. */
export const BRAND_BANNER_TOP_HEX = "#F2A20C";

/**
 * Compute the CSS gradient string for a stored `banner_accent`. NULL or
 * an unknown value falls back to the brand gradient.
 */
export function bannerGradientFor(accent: string | null): string {
  if (!accent) return BRAND_BANNER_GRADIENT;
  const hex = ENERGY_HEX[accent];
  if (!hex) return BRAND_BANNER_GRADIENT;
  return `linear-gradient(180deg, ${hex} 0%, ${shade(hex, -22)} 100%)`;
}

/** Top stop of the resolved banner gradient — used by <ThemeColor> so
 *  the browser/device chrome matches the gradient's start, making the
 *  gradient appear continuous with the status bar. */
export function bannerTopColorFor(accent: string | null): string {
  if (!accent) return BRAND_BANNER_TOP_HEX;
  return ENERGY_HEX[accent] ?? BRAND_BANNER_TOP_HEX;
}

interface Props {
  displayName: string;
  username: string;
  bio: string | null;
  tcgLiveHandle: string | null;
  avatarUrl: string | null;
  /** Whether the viewer owns this profile — gates the avatar's
   *  Pokémon-picker interactivity (see AvatarPicker). */
  isOwner: boolean;
  bannerAccent: string | null;
  /** Owner-only actions (e.g. settings gear). Rendered inline on the
   *  right of the avatar overlap row, mirroring the meta header. */
  actions?: ReactNode;
  /** Compact "N Followers · M Following" row rendered under the @handle
   *  (before the bio). Present for owner and visitor alike. */
  followStats?: ReactNode;
  /** Owner-only overlay rendered absolutely at the bottom-right of the
   *  banner (typically the accent picker). */
  bannerOverlay?: ReactNode;
  /** Fanned team-card spread rendered inside the banner's clipped
   *  bounds (mirrors the meta archetype header's card fan). Unlike
   *  `bannerOverlay`, this sits *inside* an `overflow-hidden` wrapper
   *  matching the banner's exact geometry so each card's bottom edge
   *  clips the same way — any popover the caller opens from a card
   *  click needs to portal out to escape that clipping. */
  bannerFan?: ReactNode;
}

export default function UserProfileHeader({
  displayName,
  username,
  bio,
  tcgLiveHandle,
  avatarUrl,
  isOwner,
  bannerAccent,
  actions,
  followStats,
  bannerOverlay,
  bannerFan,
}: Props) {
  const gradient = bannerGradientFor(bannerAccent);

  // Shared banner box geometry — mirrors the meta archetype header
  // exactly (down to the sm:+ aspect ratio) so the avatar overlap math
  // (-mt-16 sm:-mt-20) and the team-card fan both read the same as on
  // meta pages. bannerOverlay / bannerFan each get their own sibling
  // wrapper reusing this class string so all three stay pixel-aligned.
  const bannerBox = "h-[calc(34vw-12px)] sm:h-auto sm:aspect-[4.6875/1]";

  return (
    <header className="relative flex-shrink-0">
      {/* Banner — solid gradient, dissolves into a new accent color. */}
      <AnimatedGradient
        gradient={gradient}
        className={`relative w-full overflow-hidden ${bannerBox}`}
      />

      {/* Banner bottom-right overlay (pencil edit button). Rendered as
          a sibling of the banner with matching geometry so the
          AccentPicker popover can open downward past the banner edge
          without being clipped by overflow-hidden. z-30 keeps the
          popover above the settings gear in the bio block. */}
      {bannerOverlay && (
        <div className={`absolute inset-x-0 top-0 ${bannerBox} z-30 pointer-events-none`}>
          <div className="absolute bottom-3 right-6 pointer-events-auto">
            {bannerOverlay}
          </div>
        </div>
      )}

      {/* Hero glow — dissolves in behind the card fan once it's done
          settling (see .dx-hero-glow in globals.css), sitting between the
          gradient and the fan in DOM order so it paints on top of the one
          and behind the other without needing an explicit z-index dance. */}
      {bannerFan && (
        <div
          aria-hidden="true"
          className={`absolute inset-x-0 top-0 ${bannerBox} overflow-hidden z-0 pointer-events-none flex items-center justify-center`}
        >
          <div
            className="dx-hero-glow w-[60%] aspect-square rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0) 65%)",
              "--glow-start-delay": `${FAN_TOTAL_MS}ms`,
            } as CSSProperties}
          />
        </div>
      )}

      {/* Team-card fan. Sized and clipped to the exact same box as the
          banner (unlike bannerOverlay, this wrapper keeps
          overflow-hidden) so each card's bottom edge crops flush with
          the banner edge, matching the meta archetype header. z-0 keeps
          it behind the avatar (z-10), which overlaps the banner's
          bottom-left corner via negative margin. The caller is
          responsible for portaling any popover it opens out of this
          subtree so it isn't clipped too. */}
      {bannerFan && (
        <div className={`absolute inset-x-0 top-0 ${bannerBox} overflow-hidden z-0 pointer-events-none`}>
          {bannerFan}
        </div>
      )}

      {/* Bio section. Avatar overlaps the banner via negative margin.
          `relative z-10` is load-bearing, not decorative: this block is
          otherwise a plain non-positioned box, and CSS paints non-positioned
          in-flow content *before* any positioned z-0 sibling regardless of
          DOM order — so without an explicit stacking level here, the hero
          glow (position:absolute, z-0, above) would paint on top of
          whatever part of the bio overlaps it instead of behind it. */}
      <div className="relative z-10 mx-auto max-w-2xl px-6">
        <div className="flex items-end justify-between gap-3 -mt-16 sm:-mt-20">
          {isOwner ? (
            <AvatarPicker avatarUrl={avatarUrl} gradient={gradient} />
          ) : (
            <AnimatedGradient
              gradient={gradient}
              className="relative z-10 rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0"
              style={{ width: "115px", height: "115px" }}
            >
              {avatarUrl && (
                // Sprite sized to ~78% of the 115px circle, matching the
                // meta archetype header's icon treatment.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="w-[90px] h-[90px] object-contain"
                />
              )}
            </AnimatedGradient>
          )}
          {actions && (
            // self-start + mt slightly larger than the row's negative
            // top margin (mt-16/mt-20) leaves ~16px of breathing room
            // between the gear and the banner's bottom edge, rather
            // than sitting flush against it.
            <div className="self-start mt-20 sm:mt-24 flex items-center gap-2">
              {actions}
            </div>
          )}
        </div>

        {/* Name / @handle on the left, TCG Live (label over handle)
            right-aligned with its baseline pinned to the @handle line. */}
        <div className="mt-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight truncate">
              {displayName}
            </h1>
            <p className="text-sm text-text-muted mt-0.5">@{username}</p>
          </div>
          {tcgLiveHandle && (
            <div className="text-right text-sm leading-tight shrink-0">
              <p className="text-text-muted">TCG Live</p>
              <p className="font-semibold text-text-primary mt-0.5 truncate max-w-[10rem] sm:max-w-[14rem]">
                {tcgLiveHandle}
              </p>
            </div>
          )}
        </div>

        {followStats && <div className="mt-2">{followStats}</div>}

        {bio && (
          <p className="text-base text-text-secondary leading-relaxed mt-3 whitespace-pre-wrap">
            {bio}
          </p>
        )}

      </div>
    </header>
  );
}

// Re-export so the page can build stat tiles without importing from the
// components barrel separately.
export { StatCard };
