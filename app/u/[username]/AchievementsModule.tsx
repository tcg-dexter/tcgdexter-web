"use client";

import { useState } from "react";
import {
  CATALOG,
  CATEGORY_ORDER,
  type AchievementKey,
} from "@/lib/learn/achievements";
import AchievementBadge from "@/app/components/AchievementBadge";

/**
 * Profile badges module. Collapsed, it shows only the earned badges. The
 * chevron animates a drawer open to reveal the locked ones (grouped by
 * category) as goals to chase. Reuses the repo's grid-rows-[0fr]→[1fr]
 * height-animation idiom (see MatchForm / DeckProfileView).
 */
export default function AchievementsModule({
  earnedKeys,
  showLocked = true,
}: {
  earnedKeys: AchievementKey[];
  /** Reveal the locked "goals" drawer. Owner-only — visitors just see the
   *  earned grid. */
  showLocked?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const earnedSet = new Set(earnedKeys);
  const earnedDefs = CATALOG.filter((d) => earnedSet.has(d.key));
  const lockedDefs = CATALOG.filter((d) => !earnedSet.has(d.key));
  const hasLocked = showLocked && lockedDefs.length > 0;

  return (
    <div className="rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm p-4 sm:p-5">
      {/* Header — toggles the locked drawer when there are badges left to
          earn; otherwise it's a plain, non-interactive heading. */}
      <button
        type="button"
        onClick={() => hasLocked && setOpen((o) => !o)}
        aria-expanded={hasLocked ? open : undefined}
        disabled={!hasLocked}
        className={`w-full flex items-center justify-between gap-3 ${
          hasLocked ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <div className="flex items-baseline gap-2">
          <h2 className="text-base font-semibold text-text-primary">Badges</h2>
          <span className="text-xs text-text-muted tabular-nums">
            {earnedDefs.length} / {CATALOG.length}
          </span>
        </div>
        {hasLocked && (
          <svg
            className={`w-4 h-4 text-text-muted transition-transform duration-300 ${
              open ? "rotate-180" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Earned badges (always visible). Grid drops back to 3-up at lg,
          where this card sits in the narrower right rail of the profile's
          two-column top region. */}
      {earnedDefs.length > 0 ? (
        <div className="mt-4 grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-3 gap-3">
          {earnedDefs.map((def) => (
            <AchievementBadge key={def.key} def={def} earned size="md" />
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-text-secondary">
          No badges yet — save a deck or log a match to start earning.
        </p>
      )}

      {/* Locked badges drawer — grouped by category, revealed on expand. */}
      {hasLocked && (
        <div
          className={`grid transition-all duration-300 ease-in-out ${
            open ? "grid-rows-[1fr] opacity-100 mt-5" : "grid-rows-[0fr] opacity-0"
          }`}
        >
          <div className="overflow-hidden">
            <div className="space-y-4 pt-1">
              {CATEGORY_ORDER.map((cat) => {
                const locked = lockedDefs.filter((d) => d.category === cat);
                if (locked.length === 0) return null;
                return (
                  <div key={cat}>
                    <p className="text-xs font-medium text-text-muted mb-2">
                      {cat}
                    </p>
                    <div className="grid grid-cols-4 sm:grid-cols-5 lg:grid-cols-3 gap-3">
                      {locked.map((def) => (
                        <AchievementBadge
                          key={def.key}
                          def={def}
                          earned={false}
                          size="md"
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
