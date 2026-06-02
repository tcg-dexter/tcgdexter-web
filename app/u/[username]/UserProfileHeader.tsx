import type { ReactNode } from "react";
import { shade } from "@/lib/color";
import { ENERGY_HEX } from "@/app/components/DeckProfileView";
import { StatCard } from "@/app/components/StatCard";

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

interface Props {
  displayName: string;
  username: string;
  bio: string | null;
  tcgLiveHandle: string | null;
  avatarUrl: string | null;
  bannerAccent: string | null;
  /** Owner-only actions (settings gear + accent picker). Rendered inline
   *  on the right of the avatar overlap row, mirroring the meta header. */
  actions?: ReactNode;
  /** 8 StatCard tiles. Caller-built so the page can wire in owner-vs-
   *  visitor data without duplicating the layout. */
  stats: ReactNode;
  /** Content rendered inside the bio block, below the stat grid. Used
   *  by the profile page for the match-activity + achievements cards so
   *  they share the exact same `max-w-2xl px-6` parent as the stat grid
   *  and line up edge-to-edge with it. */
  belowStats?: ReactNode;
}

export default function UserProfileHeader({
  displayName,
  username,
  bio,
  tcgLiveHandle,
  avatarUrl,
  bannerAccent,
  actions,
  stats,
  belowStats,
}: Props) {
  const gradient = bannerGradientFor(bannerAccent);
  const initial = displayName.trim().charAt(0).toUpperCase() || "?";

  return (
    <header className="flex-shrink-0">
      {/* Banner — solid gradient, matching the meta archetype banner's
          sizing so the avatar overlap math (-mt-16 sm:-mt-20) lands at
          the same visual offset. */}
      <div
        className="relative w-full overflow-hidden h-[calc(34vw-12px)] sm:h-auto sm:aspect-[3/1]"
        style={{ background: gradient }}
      />

      {/* Bio section. Avatar overlaps the banner via negative margin. */}
      <div className="mx-auto max-w-2xl px-6">
        <div className="flex items-end justify-between gap-3 -mt-16 sm:-mt-20">
          <div
            className="relative z-10 rounded-full ring-4 ring-bg flex items-center justify-center overflow-hidden shrink-0"
            style={{
              background: gradient,
              width: "128px",
              height: "128px",
            }}
          >
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-5xl font-bold text-white">{initial}</span>
            )}
          </div>
          {actions && (
            <div className="flex items-center gap-2 pb-1">{actions}</div>
          )}
        </div>

        <div className="mt-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-primary leading-tight">
            {displayName}
          </h1>
          <p className="text-sm text-text-muted mt-0.5">@{username}</p>
        </div>

        {bio && (
          <p className="text-base text-text-secondary leading-relaxed mt-3 whitespace-pre-wrap">
            {bio}
          </p>
        )}

        {tcgLiveHandle && (
          <p className="mt-3 text-sm text-text-muted">
            TCG Live:{" "}
            <span className="font-semibold text-text-primary">
              {tcgLiveHandle}
            </span>
          </p>
        )}

        {/* 8-cell stat grid — wired in by the page. */}
        <div className="mt-4 grid grid-cols-4 gap-3">{stats}</div>

        {/* Match activity, achievements, etc. Sit in the same bio
         *  container as the stat grid so their card edges line up with
         *  the stat row's outer edge. */}
        {belowStats && <div className="mt-6 space-y-6">{belowStats}</div>}
      </div>
    </header>
  );
}

// Re-export so the page can build stat tiles without importing from the
// components barrel separately.
export { StatCard };
