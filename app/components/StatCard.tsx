import type { ReactNode } from "react";
import AnimatedGradient from "@/app/components/AnimatedGradient";
import RollingNumber from "@/app/components/ui/RollingNumber";

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
 * grid so proportional digits don't cause label drift — and it's what lets
 * RollingNumber's per-digit columns line up, since every column sizes
 * itself from its own glyph.
 *
 * Values arrive as display strings and roll in on mount (see
 * RollingNumber). This component stays a server component: the client
 * boundary sits at that leaf, so both stat grids that use these tiles —
 * the user profile's and the meta archetype header's — get the animation
 * without either page giving up server rendering.
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
          // No overflow-hidden, deliberately: the gradient layers clip
          // themselves via rounded-[inherit] (see AnimatedGradient). These
          // tiles are narrow — four across at 390px leaves ~45px of content
          // box — so most values overflow it, and the other tones let that
          // spill harmlessly into the padding. An overflow container instead
          // pins the text to its start edge and clips the end, which cut the
          // last digit off "$5,255" while "3,933" beside it rendered fine.
          className="relative rounded-2xl shadow-sm px-4 py-3 text-center text-white"
        >
          <p className="text-lg font-bold tabular-nums">
            <RollingNumber value={value} />
          </p>
          <p className="text-xs mt-0.5 opacity-90">{label}</p>
        </AnimatedGradient>
      );
    }
    return (
      <div className="rounded-2xl shadow-sm px-4 py-3 text-center text-white bg-gradient-brand">
        <p className="text-lg font-bold tabular-nums">
          <RollingNumber value={value} />
        </p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "dark") {
    return (
      <div className="rounded-2xl bg-black dark:bg-white shadow-sm px-4 py-3 text-center text-white dark:text-black">
        <p className="text-lg font-bold tabular-nums">
          <RollingNumber value={value} />
        </p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "ringed") {
    return (
      <div className="rounded-2xl bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-[inset_0_0_0_1px_black] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] px-4 py-3 text-center">
        <p className="text-lg font-bold text-text-primary tabular-nums">
          <RollingNumber value={value} />
        </p>
        <p className="text-xs text-text-primary mt-0.5">{label}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm px-4 py-3 text-center">
      <p className={`text-lg font-bold tabular-nums ${valueClass}`}>
        <RollingNumber value={value} />
      </p>
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
