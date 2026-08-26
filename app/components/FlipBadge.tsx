"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { REQUIREMENT, type AchievementDef } from "@/lib/learn/achievements";

/**
 * A badge medallion that spins on its Y axis when tapped to reveal how the
 * badge is earned, then spins back after FLIP_BACK_MS. Shared by the
 * home-page showcase (BadgeShowcase) and the profile module
 * (AchievementsModule → AchievementBadge) so there's one flip, one set of
 * reveal styling, and one piece of timer/a11y handling.
 *
 * The component renders the tile only — square, filling whatever width the
 * caller gives it via `className`. Captions (the profile's name label) stay
 * outside so they don't spin along with the medallion.
 */

const FLIP_BACK_MS = 3000;

/** Pointy-top hexagon matching the badge art's silhouette. */
const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

export type FlipBadgeVariant = "showcase" | "profile";

export default function FlipBadge({
  def,
  variant,
  locked = false,
  className,
  tabIndex,
}: {
  def: AchievementDef;
  /** "showcase" reveals name + requirement; "profile" reveals the
   *  requirement alone, because the name already sits under the tile. */
  variant: FlipBadgeVariant;
  /** Locked badges keep the profile's dimmed/desaturated medallion. They
   *  still flip — "how do I get this?" is exactly the question a locked
   *  badge raises, and the requirement line is the answer. */
  locked?: boolean;
  /** Sizes the square tile (e.g. "w-full", "w-16"). Callers own layout. */
  className?: string;
  /** Pass -1 when the tile sits inside a collapsed container: the tile is a
   *  real button now, and a zero-height drawer still hands out tab stops. */
  tabIndex?: number;
}) {
  const [flipped, setFlipped] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Never leave a timer running past unmount — it would setState on a
  // dead component.
  useEffect(() => clearTimer, [clearTimer]);

  function handleClick() {
    // Re-tapping mid-reveal flips straight back rather than queuing a
    // second timer on top of the first.
    clearTimer();
    setFlipped((prev) => {
      const next = !prev;
      if (next) {
        timerRef.current = setTimeout(() => {
          setFlipped(false);
          timerRef.current = null;
        }, FLIP_BACK_MS);
      }
      return next;
    });
  }

  const isShowcase = variant === "showcase";
  const requirement = REQUIREMENT[def.key];
  const lockedSuffix = locked ? " (locked)" : "";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`${def.name} badge${lockedSuffix} — ${requirement}`}
      aria-pressed={flipped}
      tabIndex={tabIndex}
      className={`block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-lg ${
        className ?? ""
      }`}
      style={{ perspective: "800px" }}
    >
      <div
        className="relative w-full transition-transform duration-500 ease-out motion-reduce:transition-none"
        style={{
          aspectRatio: "1 / 1",
          transformStyle: "preserve-3d",
          transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)",
        }}
      >
        {/* Front — the medallion art. The locked treatment lives on this
            face rather than on the whole tile so it survives the spin
            without dimming the reveal into illegibility. */}
        <div
          className={`absolute inset-0 flex items-center justify-center transition-opacity ${
            locked ? "opacity-45 grayscale" : ""
          }`}
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          <Image
            src={`/badges/${def.key}.png`}
            alt={`${def.name} badge${lockedSuffix}`}
            width={isShowcase ? 96 : 64}
            height={isShowcase ? 96 : 64}
            className="w-full h-full object-contain drop-shadow-sm"
          />
        </div>

        {/* Back — the reveal, cut to the same hexagon as the art so the
            tile keeps its silhouette through the spin. Rotated a
            half-turn so it reads upright once the front spins away.
            The outer hex is the border tone; the inner one scales down
            inside it to leave an even rim. */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          {/* Sized to the hexagon's real extent inside the PNG (measured:
              80.3% × 95.3% of the canvas) so the back tile lands exactly
              on the front's silhouette instead of the art's padded box. */}
          <div className="relative" style={{ width: "80.3%", height: "95.3%" }}>
            <div
              className="absolute inset-0 bg-black/15 dark:bg-white/20"
              style={{ clipPath: HEX_CLIP }}
            />
            <div
              className="absolute inset-[2px] bg-white dark:bg-surface-elevated"
              style={{ clipPath: HEX_CLIP }}
            />
            {/* Text sits in its own unclipped layer — scaling or clipping
                the copy alongside the shape would distort it. */}
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-1 gap-0.5">
              {isShowcase && (
                <span className="font-bold leading-tight text-text-primary text-[10px] sm:text-xs">
                  {def.name}
                </span>
              )}
              <span
                className={
                  isShowcase
                    ? "leading-snug text-text-secondary text-[8px] sm:text-[10px]"
                    : // Profile tiles are a fixed 48–64px, so the requirement
                      // gets the whole hexagon and the strongest tone it can
                      // carry at this size.
                      "leading-tight font-semibold text-text-primary text-[8px]"
                }
              >
                {requirement}
              </span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}
