"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG, type AchievementDef, type AchievementKey } from "@/lib/learn/achievements";

/**
 * Home-page showcase of the full badge catalog — a marketing surface, not
 * a progress view, so every badge renders earned-looking (full color)
 * regardless of who's viewing.
 *
 * The three hardest badges lead as large heroes with their titles
 * underneath; the rest follow in a compact grid. Tapping any badge spins
 * it on its Y axis to reveal the badge name, then spins back after
 * FLIP_BACK_MS.
 */

/** Hardest badges first: the top of the deck-building track (50 decks),
 *  the top of the match-logging grind (100 matches), then the next
 *  deck-building tier (40 decks). Anything listed here is pulled out of
 *  the secondary grid below. */
const HERO_KEYS: AchievementKey[] = ["decks_50", "matches_100", "decks_40"];

const FLIP_BACK_MS = 3000;

export default function BadgeShowcase() {
  const heroDefs = HERO_KEYS.map((key) => CATALOG.find((d) => d.key === key)).filter(
    (d): d is AchievementDef => !!d,
  );
  const restDefs = CATALOG.filter((d) => !HERO_KEYS.includes(d.key));

  return (
    <div className="mt-12">
      <div className="grid grid-cols-3 gap-4 sm:gap-6 max-w-2xl mx-auto">
        {heroDefs.map((def) => (
          <FlipBadge key={def.key} def={def} variant="hero" />
        ))}
      </div>

      <div className="mt-8 grid grid-cols-4 sm:grid-cols-5 gap-4 sm:gap-6 max-w-3xl mx-auto">
        {restDefs.map((def) => (
          <FlipBadge key={def.key} def={def} variant="compact" />
        ))}
      </div>
    </div>
  );
}

function FlipBadge({
  def,
  variant,
}: {
  def: AchievementDef;
  variant: "hero" | "compact";
}) {
  const isHero = variant === "hero";
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

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${def.name} badge — reveal name`}
        aria-pressed={flipped}
        className="w-full block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
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
          {/* Front — the medallion art. */}
          <div
            className="absolute inset-0 flex items-center justify-center"
            style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
          >
            <Image
              src={`/badges/${def.key}.png`}
              alt={def.name}
              width={isHero ? 160 : 96}
              height={isHero ? 160 : 96}
              className="w-full h-full object-contain drop-shadow-sm"
            />
          </div>

          {/* Back — the reveal. Rotated a half-turn so it reads upright
              once the front has spun away. */}
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-full border border-black/8 dark:border-white/10 bg-white dark:bg-surface-elevated px-2 text-center shadow-sm"
            style={{
              backfaceVisibility: "hidden",
              WebkitBackfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            <span
              className={`font-bold leading-tight text-text-primary ${
                isHero ? "text-sm sm:text-base" : "text-[10px] sm:text-xs"
              }`}
            >
              {def.name}
            </span>
            {isHero && (
              <span className="hidden sm:block text-[11px] leading-snug text-text-secondary">
                {def.description}
              </span>
            )}
          </div>
        </div>
      </button>

      {isHero && (
        <p className="text-sm sm:text-base font-semibold text-text-primary text-center leading-tight">
          {def.name}
        </p>
      )}
    </div>
  );
}
