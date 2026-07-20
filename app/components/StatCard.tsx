import type { ReactNode } from "react";
import AnimatedGradient from "@/app/components/AnimatedGradient";

/**
 * Tile in a profile / archetype bio stat grid.
 *
 * Tones:
 *  - "gradient" → site brand gradient bg, white text (Wins)
 *  - "dark"     → solid black bg, white text (Losses)
 *  - "ringed"   → white card with 1px inset black ring (Ties)
 *  - "default"  → standard card chrome; `valueClass` colors the value
 *
 * `tabular-nums` keeps numeric tiles the same visual width across the
 * grid so proportional digits don't cause label drift.
 */
export function StatCard({
  label,
  value,
  valueClass = "",
  tone = "default",
  gradientCss,
}: {
  label: ReactNode;
  value: string;
  valueClass?: string;
  tone?: "default" | "gradient" | "dark" | "ringed";
  /** Override the `gradient` tone's background. When omitted, the tile
   *  falls back to the site brand gradient (`bg-gradient-brand`). Used
   *  by the profile page so the Wins tile picks up the user's chosen
   *  banner accent. */
  gradientCss?: string;
}) {
  if (tone === "gradient") {
    // gradientCss changes at runtime (the profile page's Wins tile picks
    // up the user's chosen banner accent) — dissolve into it rather than
    // snapping. The static bg-gradient-brand fallback never changes, so
    // it stays a plain div with no animation machinery.
    if (gradientCss) {
      return (
        <AnimatedGradient
          gradient={gradientCss}
          className="relative rounded-2xl overflow-hidden shadow-sm px-4 py-3 text-center text-white"
        >
          <p className="text-lg font-bold tabular-nums">{value}</p>
          <p className="text-xs mt-0.5 opacity-90">{label}</p>
        </AnimatedGradient>
      );
    }
    return (
      <div className="rounded-2xl shadow-sm px-4 py-3 text-center text-white bg-gradient-brand">
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

/** Render `mobile` below `sm:`, `desktop` from `sm:` up. Used by stat
 *  grid labels so a single long word can't stretch a tile on mobile. */
export function ResponsiveLabel({
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
