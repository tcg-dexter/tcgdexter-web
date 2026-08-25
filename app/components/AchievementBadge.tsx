import type { AchievementDef } from "@/lib/learn/achievements";
import FlipBadge from "./FlipBadge";

/**
 * A single achievement medallion + label. Each badge is a hosted PNG at
 * `/badges/<key>.png` (300×300 art). Earned badges render in full color;
 * locked badges are desaturated and dimmed.
 *
 * The medallion itself is the shared FlipBadge — tapping it spins the tile
 * to reveal how the badge is earned. Locked badges flip too; the dimmed
 * treatment rides on the medallion face so it survives the spin. Only the
 * tile flips: this name label stays put underneath, and FlipBadge's
 * profile variant leaves the name off its reveal because of it.
 *
 * Stays a server component — FlipBadge owns the "use client" boundary, so
 * this can still be rendered from a server tree.
 */

export default function AchievementBadge({
  def,
  earned,
  size = "md",
  tabIndex,
}: {
  def: AchievementDef;
  earned: boolean;
  size?: "sm" | "md";
  /** Forwarded to the flip tile — pass -1 inside a collapsed drawer. */
  tabIndex?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 w-full">
      <FlipBadge
        def={def}
        variant="profile"
        locked={!earned}
        className={size === "md" ? "w-16" : "w-12"}
        tabIndex={tabIndex}
      />
      <p
        className={`text-[11px] leading-tight font-semibold text-center max-w-[5.5rem] ${
          earned ? "text-text-primary" : "text-text-muted"
        }`}
      >
        {def.name}
      </p>
    </div>
  );
}
