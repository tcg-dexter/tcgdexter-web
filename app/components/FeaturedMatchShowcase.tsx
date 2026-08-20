"use client";

import ReplayViewer from "@/app/components/replay/ReplayViewer";
import FeaturedMatchHero from "@/app/matches/FeaturedMatchHero";
import type { RecentMatch } from "@/app/components/MatchCard";
import type { MatchSideStats } from "@/lib/match-side-stats";

/**
 * Home-page showcase for the current Featured Match: the same hero the
 * /matches page renders, with that match's replay playing underneath it.
 *
 * Which match this is comes from `pickFeaturedMatch`, shared with /matches,
 * so the showcase follows whatever is currently featured rather than pinning
 * one — and the two pages can't name different matches.
 *
 * The hero carries its own "Featured Match" label, so this adds no heading
 * of its own.
 *
 * Mobile drops the replay's action thread (`hideThreadOnMobile`): there the
 * thread renders in full and is scrolled by the page, which suits a
 * dedicated battle page but would bury the rest of the home page under one
 * module. Phones get the board and transport; the thread stays on
 * /battles/[shortId], which the hero's own CTA links to.
 *
 * Autoplays at 2x, unlike every other ReplayViewer mounting: a visitor
 * scrolling the home page didn't navigate here to watch one specific match,
 * so arriving mid-action is what sells "there's a live-feeling feature
 * here" — a board parked on frame 0 waiting for a click reads as static.
 */
export default function FeaturedMatchShowcase({
  match,
  stats,
}: {
  match: RecentMatch;
  stats?: MatchSideStats | null;
}) {
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-24">
      <FeaturedMatchHero match={match} stats={stats} />
      {/* Guarded rather than assumed: the Featured Match is ranked on
          total damage, which only parsed battle logs carry, so this should
          always hold — but a manual match reaching here would otherwise
          mount a viewer whose replay endpoint has nothing to return. */}
      {match.hasBattleLog && (
        <div className="mt-6">
          <ReplayViewer
            matchId={match.shortId}
            replayUrl={`/api/battles/${match.shortId}/replay`}
            logUrl={`/api/battles/${match.shortId}/log`}
            result={match.result}
            playerColor={match.playerColor}
            opponentColor={match.opponentColor}
            hideThreadOnMobile
            autoPlay
            initialSpeed={2}
          />
        </div>
      )}
    </section>
  );
}
