"use client";

import ReplayViewer from "@/app/admin-tools/replay2/ReplayViewer2";
import FeaturedBattleHero from "@/app/battles/FeaturedBattleHero";
import type { RecentBattle } from "@/app/components/BattleCard";
import type { BattleSideStatsPair } from "@/lib/battle-side-stats";

/**
 * Home-page showcase for the current Featured Battle: the same hero the
 * /battles page renders, with that battle's replay playing underneath it.
 *
 * Which battle this is comes from `pickFeaturedBattle`, shared with /battles,
 * so the showcase follows whatever is currently featured rather than pinning
 * one — and the two pages can't name different battles.
 *
 * The hero carries its own "Featured Battle" label, so this adds no heading
 * of its own.
 *
 * Mobile drops the replay's action thread (`hideThreadOnMobile`): there the
 * thread renders in full and is scrolled by the page, which suits a
 * dedicated battle page but would bury the rest of the home page under one
 * module. Phones get the board and transport; the thread stays on
 * /battles/[shortId], which the hero's own CTA links to.
 *
 * Autoplays at 2x, unlike every other ReplayViewer mounting: a visitor
 * scrolling the home page didn't navigate here to watch one specific battle,
 * so arriving mid-action is what sells "there's a live-feeling feature
 * here" — a board parked on frame 0 waiting for a click reads as static.
 */
export default function FeaturedBattleShowcase({
  battle,
  stats,
}: {
  battle: RecentBattle;
  stats?: BattleSideStatsPair | null;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
      <FeaturedBattleHero battle={battle} stats={stats} />
      {/* Guarded rather than assumed: the Featured Battle is ranked on
          total damage, which only parsed battle logs carry, so this should
          always hold — but a manual battle reaching here would otherwise
          mount a viewer whose replay endpoint has nothing to return. */}
      {battle.hasBattleLog && (
        <div className="mt-6">
          <ReplayViewer
            battleId={battle.shortId}
            replayUrl={`/api/battles/${battle.shortId}/replay`}
            logUrl={`/api/battles/${battle.shortId}/log`}
            result={battle.result}
            playerColor={battle.playerColor}
            opponentColor={battle.opponentColor}
            hideThreadOnMobile
            autoPlay
            initialSpeed={2}
          />
        </div>
      )}
    </section>
  );
}
