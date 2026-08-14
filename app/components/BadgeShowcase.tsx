"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { CATALOG, type AchievementDef, type AchievementKey } from "@/lib/learn/achievements";

/**
 * Home-page showcase of the full badge catalog — a marketing surface, not
 * a progress view, so every badge renders earned-looking (full color)
 * regardless of who's viewing.
 *
 * The three hardest badges lead as large heroes with their names +
 * requirement underneath; the rest follow in a compact grid. Tapping any
 * badge spins it on its Y axis to reveal the same name + requirement,
 * then spins back after FLIP_BACK_MS.
 */

/** The three headline badges, one per earning path rather than simply the
 *  three hardest: the top of the deck-building track (50 decks), the top
 *  of the match-logging grind (100 matches), and the knowledge badge
 *  (Trainer Quiz), which is the only one earned outside those two counts.
 *  Anything listed here is pulled out of the secondary grid below. */
const HERO_KEYS: AchievementKey[] = ["decks_50", "matches_100", "certified_trainer"];

const FLIP_BACK_MS = 3000;

/** Pointy-top hexagon matching the badge art's silhouette. */
const HEX_CLIP = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";

/**
 * Terse "how you earn it" line, shown under every badge name. Deliberately
 * shorter than the catalog's `description` (which is a full sentence) —
 * these sit in tight hexagons and under hero titles, where a sentence
 * wraps badly. Exhaustive by type, so adding a catalog badge fails the
 * typecheck here until its copy is written.
 */
const REQUIREMENT: Record<AchievementKey, string> = {
  first_save: "Save a deck",
  first_match: "Log a match",
  first_battle_log: "Import a log",
  certified_trainer: "Ace the quiz",
  matches_10: "Log 10 matches",
  matches_50: "Log 50 matches",
  matches_100: "Log 100 matches",
  decks_5: "Save 5 decks",
  decks_10: "Save 10 decks",
  decks_20: "Save 20 decks",
  decks_30: "Save 30 decks",
  decks_40: "Save 40 decks",
  decks_50: "Save 50 decks",
};

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

      <div className="mt-8 flex flex-wrap justify-center gap-4 sm:gap-6 max-w-3xl mx-auto">
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

  // Heroes are static: their name and requirement already sit under the
  // medallion, so flipping would only reveal what's on screen already.
  if (isHero) {
    return (
      <div className="flex flex-col items-center gap-2">
        <div className="w-full" style={{ aspectRatio: "1 / 1" }}>
          <Image
            src={`/badges/${def.key}.png`}
            alt={def.name}
            width={160}
            height={160}
            className="w-full h-full object-contain drop-shadow-sm"
          />
        </div>
        <div className="text-center">
          <p className="text-sm sm:text-base font-semibold text-text-primary leading-tight">
            {def.name}
          </p>
          <p className="mt-0.5 text-xs sm:text-sm text-text-secondary leading-snug">
            {REQUIREMENT[def.key]}
          </p>
        </div>
      </div>
    );
  }

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
    <div className="flex flex-col items-center gap-2 w-[calc(25%-0.75rem)] sm:w-[calc(20%-1.2rem)]">
      <button
        type="button"
        onClick={handleClick}
        aria-label={`${def.name} badge — ${REQUIREMENT[def.key]}`}
        aria-pressed={flipped}
        className="w-full block focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-lg"
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
              width={96}
              height={96}
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
                <span className="font-bold leading-tight text-text-primary text-[10px] sm:text-xs">
                  {def.name}
                </span>
                <span className="leading-snug text-text-secondary text-[8px] sm:text-[10px]">
                  {REQUIREMENT[def.key]}
                </span>
              </div>
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}
