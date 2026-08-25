import Image from "next/image";
import FlipBadge from "./FlipBadge";
import {
  CATALOG,
  REQUIREMENT,
  type AchievementDef,
  type AchievementKey,
} from "@/lib/learn/achievements";

/**
 * Home-page showcase of the full badge catalog — a marketing surface, not
 * a progress view, so every badge renders earned-looking (full color)
 * regardless of who's viewing.
 *
 * The three hardest badges lead as large heroes with their names +
 * requirement underneath; the rest follow in a compact grid, where tapping
 * a badge flips it (see FlipBadge) to reveal the same name + requirement.
 */

/** The three headline badges, one per earning path rather than simply the
 *  three hardest: the top of the deck-building track (50 decks), the top
 *  of the battle-logging grind (100 battles), and the knowledge badge
 *  (Trainer Quiz), which is the only one earned outside those two counts.
 *  Anything listed here is pulled out of the secondary grid below. */
const HERO_KEYS: AchievementKey[] = ["decks_50", "battles_100", "certified_trainer"];

export default function BadgeShowcase() {
  const heroDefs = HERO_KEYS.map((key) => CATALOG.find((d) => d.key === key)).filter(
    (d): d is AchievementDef => !!d,
  );
  const restDefs = CATALOG.filter((d) => !HERO_KEYS.includes(d.key));

  return (
    <div className="mt-12">
      <div className="grid grid-cols-3 gap-4 sm:gap-6 max-w-2xl mx-auto">
        {heroDefs.map((def) => (
          <HeroBadge key={def.key} def={def} />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-4 sm:gap-6 max-w-3xl mx-auto">
        {restDefs.map((def) => (
          <div
            key={def.key}
            className="flex flex-col items-center gap-2 w-[calc(25%-0.75rem)] sm:w-[calc(20%-1.2rem)]"
          >
            <FlipBadge def={def} variant="showcase" className="w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Heroes are static: their name and requirement already sit under the
 *  medallion, so flipping would only reveal what's on screen already. */
function HeroBadge({ def }: { def: AchievementDef }) {
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
