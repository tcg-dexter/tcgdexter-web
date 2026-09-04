"use client";

import ReplayViewer2 from "@/app/admin-tools/replay2/ReplayViewer2";
import BackButton from "@/app/components/ui/BackButton";
import {
  BattleStatChart,
  buildBattleStatRows,
  type BattleSideStats,
} from "@/app/components/BattleStatChart";
import { shade } from "@/lib/color";

export type { BattleSideStats };

interface Props {
  battleId: string;
  result: "win" | "loss" | "draw";
  opponentArchetype: string | null;
  playedAt: string;
  deckName: string;
  username: string;
  deckImageUrl: string | null;
  playerPokemonName: string | null;
  playerColor: string;
  playerHandle: string | null;
  opponentAttackerName: string | null;
  opponentImageUrl: string | null;
  opponentColor: string;
  opponentHandle: string | null;
  playerStats: BattleSideStats;
  opponentStats: BattleSideStats;
  hasBattleLog: boolean;
}

function formatPlayedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Hero-card placement inside the artwork panel. Both cards sit on the
// panel's centre in both axes, then step apart horizontally by a share of
// their OWN width, so the overlap is identical at every panel size.
// Positioning them at fixed percentages of the panel instead would drift —
// the same pair that overlaps in a 360px desktop column opens into a gap
// on a wide phone.
const HERO_OVERLAP_PCT = 20;
const HERO_STEP_PCT = (100 - HERO_OVERLAP_PCT) / 2;
const HERO_ROTATION_DEG = 5;
// Card height as a share of the panel's, with width following from the
// printed card aspect. Sizing off the panel rather than in pixels is what
// keeps a centred card inside it: the panel is a fixed height on mobile
// but stretches to the details column on desktop, and a pixel size that
// fit one would overflow the other. The tilt costs headroom too — a
// rotated card's bounding box is h·cos(θ) + w·sin(θ), ~5.9% taller than
// the card at 5° — so 80% here occupies ~85% of the panel.
const HERO_HEIGHT_PCT = 80;

export default function BattleLogPage({
  battleId,
  result,
  opponentArchetype,
  playedAt,
  deckName,
  username,
  deckImageUrl,
  playerPokemonName,
  playerColor,
  playerHandle,
  opponentAttackerName,
  opponentImageUrl,
  opponentColor,
  opponentHandle,
  playerStats,
  opponentStats,
  hasBattleLog,
}: Props) {
  const playerLabel = playerPokemonName ?? deckName;
  const opponentLabel =
    opponentAttackerName ?? opponentArchetype ?? "Opponent";
  const playerSideName =
    playerHandle ?? username ?? "You";
  const opponentSideName =
    opponentHandle ?? opponentArchetype ?? "Opponent";

  // Vertical gradient anchored to the winner: winner's color at the top,
  // loser's color at the bottom. It paints the artwork panel behind the
  // hero cards and, at low opacity, the glow bleeding out from under the
  // whole card — the deck collection's pinned hero does the same with the
  // brand gradient, and this substitutes the match's own colors for it.
  const winnerColor =
    result === "win"
      ? playerColor
      : result === "loss"
      ? opponentColor
      : playerColor;
  const loserColor =
    result === "win"
      ? opponentColor
      : result === "loss"
      ? playerColor
      : opponentColor;
  const bannerGradient =
    winnerColor === loserColor
      ? `linear-gradient(180deg, ${winnerColor} 0%, ${shade(winnerColor, -18)} 100%)`
      : `linear-gradient(180deg, ${winnerColor} 0%, ${loserColor} 100%)`;
  // The ghost behind the hero cards is the winner's, so the artwork states
  // the result before any label does. A draw has no winner to feature, so
  // it falls back to the page owner's deck.
  const ghostImageUrl =
    (result === "loss" ? opponentImageUrl : deckImageUrl) ?? null;
  // The winning deck's name gets the brand gradient, matching the treatment
  // BattleStatChart gives the winning player's column header. A draw has no
  // winner, so neither name takes it.
  const winnerLabelClass = "bg-gradient-brand bg-clip-text text-transparent";

  // The stat header that used to lead the page — the winner-tinted hero with
  // the two decks' art, the archetype matchup, the date and the two-row stat
  // chart. Replay 2.0 is now the page's lead content, and this sits below it:
  // handed to the viewer as belowMatchupSlot so the page reads viewer →
  // controls → matchup → copy → this → thread. No "Watch Replay" button now
  // that the replay is what's above it.
  const statHeader = (
    <div className="relative mt-6">
      <div
        aria-hidden
        className="absolute -inset-px rounded-2xl opacity-30 blur-md"
        style={{ background: bannerGradient }}
      />
      <div
        className="relative flex flex-col overflow-hidden rounded-2xl border border-black/8 bg-bg md:flex-row dark:border-white/10"
        style={{
          // The drop shadow tints to the winner's color the way the
          // pinned deck's tints to the brand red. color-mix keeps this
          // in CSS rather than needing a hex→rgba helper for what is
          // only ever one alpha.
          boxShadow: `0 20px 30px -15px color-mix(in srgb, ${winnerColor} 45%, transparent)`,
        }}
      >
        <BattleBanner
          gradient={bannerGradient}
          ghostImageUrl={ghostImageUrl}
          leftImageUrl={deckImageUrl}
          leftAlt={playerLabel}
          rightImageUrl={opponentImageUrl}
          rightAlt={opponentLabel}
        />

        <div className="flex-1 p-5 md:p-6">
          {/* Archetype pair + date. Truncated rather than wrapped: these
              sit in a fixed column now, so a second line on a long
              archetype would push the stat table down instead of
              overhanging the way it did on the full-bleed banner. */}
          <p className="truncate text-xl md:text-2xl font-bold leading-tight text-text-primary">
            <span className={result === "win" ? winnerLabelClass : undefined}>
              {playerLabel}
            </span>
          </p>
          <p className="truncate text-xl md:text-2xl font-bold leading-tight text-text-primary">
            <span className="text-text-muted">vs </span>
            <span className={result === "loss" ? winnerLabelClass : undefined}>
              {opponentLabel}
            </span>
          </p>
          <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
            {formatPlayedAt(playedAt)}
          </p>

          {/* Two rows only — the headline exchange (damage) and the one
              that decides the game (prizes). The full six-row table
              still lives on the /battles Featured Battle drawer. */}
          <BattleStatChart
            playerName={playerSideName}
            opponentName={opponentSideName}
            winnerSide={
              result === "win" ? "left" : result === "loss" ? "right" : null
            }
            rows={buildBattleStatRows(playerStats, opponentStats, [
              "damage",
              "prizes",
            ])}
          />
        </div>
      </div>
    </div>
  );

  return (
    // Page shell copied from /my-decks and /battles so the content below sits
    // on the same rails as the deck collection and the matches feed.
    <main className="mx-auto max-w-6xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] pb-24">
      {/* Back button — the desktop (xl+) copy renders here above the content.
          The wrapper is hidden below xl to avoid leaving its margin behind as
          dead space: the sub-xl copy portals itself into the sticky toolbar
          and isn't a descendant of this div, so hiding the wrapper doesn't
          hide it. */}
      <div className="mb-3 hidden xl:block">
        <BackButton href="/" ariaLabel="Back" />
      </div>

      {hasBattleLog ? (
        // Replay 2.0 leads the page; the stat header rides below it, injected
        // between the viewer's matchup/copy block and its thread.
        <div className="mt-6">
          <ReplayViewer2
            battleId={battleId}
            replayUrl={`/api/battles/${battleId}/replay`}
            logUrl={`/api/battles/${battleId}/log`}
            result={result}
            playerColor={playerColor}
            opponentColor={opponentColor}
            belowMatchupSlot={statHeader}
          />
        </div>
      ) : (
        // No battle log: fall back to the stat header alone plus a notice.
        <>
          {statHeader}
          <div className="mt-6 rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5 text-sm text-text-muted text-center dark:bg-surface-elevated dark:border-white/10">
            No battle log available for this battle.
          </div>
        </>
      )}
    </main>
  );
}

/**
 * Artwork panel — the battle page's take on the deck collection's pinned
 * deck banner. Same construction: a gradient field with one blown-up
 * desaturated card as a ghost behind everything. The differences are that
 * there are two heroes rather than one and they sit centred rather than
 * tucked behind the panel's floor, the ghost is the winner's card, and the
 * pinned banner's favourite toggle, W/L ribbon and avatar stack are all
 * dropped — nothing on a finished battle is actionable.
 *
 * The mobile height is taller than the pinned banner's 150px because of
 * that centring: a tucked card can be any size and just show less of
 * itself, but a centred one has to fit, so the panel has to give it room.
 */
function BattleBanner({
  gradient,
  ghostImageUrl,
  leftImageUrl,
  leftAlt,
  rightImageUrl,
  rightAlt,
  onWatchReplay,
}: {
  gradient: string;
  ghostImageUrl: string | null;
  leftImageUrl: string | null;
  leftAlt: string;
  rightImageUrl: string | null;
  rightAlt: string;
  /** Jumps the page to the replay board. Omitted when this battle has no
   *  log — there's nothing to view, and the page shows the "No battle log
   *  available" card in the viewer's place — and the pill drops with it
   *  rather than rendering a button that scrolls to nothing. */
  onWatchReplay?: () => void;
}) {
  return (
    <div
      className="relative h-[190px] shrink-0 overflow-hidden md:h-auto md:w-[360px]"
      style={{ background: gradient }}
    >
      {/* Ghost. Geometry lifted from DeckBanner: a card-sized box scaled 3×
          about its own centre, so the art reads as a texture rather than a
          card. */}
      <div
        aria-hidden
        className="absolute overflow-hidden rounded-lg bg-white"
        style={{
          width: 166,
          height: 229,
          left: "44%",
          top: "50%",
          opacity: 0.2,
          filter: "grayscale(1)",
          transform: "translate(-50%, 5%) scale(3) rotate(-4deg)",
        }}
      >
        {ghostImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={ghostImageUrl} alt="" className="h-full w-full object-cover" />
        ) : null}
      </div>

      {leftImageUrl && (
        <BannerHeroCard
          src={leftImageUrl}
          alt={leftAlt}
          xOffsetPct={-50 - HERO_STEP_PCT}
          rotationDeg={-HERO_ROTATION_DEG}
        />
      )}
      {rightImageUrl && (
        <BannerHeroCard
          src={rightImageUrl}
          alt={rightAlt}
          xOffsetPct={-50 + HERO_STEP_PCT}
          rotationDeg={HERO_ROTATION_DEG}
        />
      )}

      {onWatchReplay && (
        // Bottom-centre, on the panel's one axis of symmetry: the hero pair
        // is centred, so this is the only anchor that meets both cards the
        // same way at every panel size — a corner would tuck under one card
        // and float free of the other as the panel grows from its 190px
        // mobile height to the details column's on md. It does sit over the
        // cards' bottom edges — HERO_HEIGHT_PCT leaves ~7% of the panel
        // clear below them, which is less than a tap target — so z-20 puts
        // it above both cards and the ghost, and the fill and shadow carry
        // it against the artwork.
        <button
          type="button"
          onClick={onWatchReplay}
          className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2 md:bottom-4 inline-flex items-center justify-center rounded-full bg-white px-5 py-2 text-[11px] font-semibold tracking-[0.15em] text-black shadow-md hover:shadow-lg transition"
        >
          WATCH REPLAY
        </button>
      )}
    </div>
  );
}

function BannerHeroCard({
  src,
  alt,
  xOffsetPct,
  rotationDeg,
}: {
  src: string;
  alt: string;
  /** Shift off the panel's horizontal centre, in percent of the card's own
   *  width. -50 sits the card dead centre; stepping either side of that
   *  keeps the pair's overlap independent of the panel's width. */
  xOffsetPct: number;
  rotationDeg: number;
}) {
  return (
    <div
      className="absolute overflow-hidden rounded-lg bg-white shadow-[0_8px_18px_rgba(0,0,0,0.3)]"
      style={{
        // Percentage height against the panel, with the width derived by
        // aspect-ratio rather than stated — one number to keep in sync
        // instead of a matching pair.
        height: `${HERO_HEIGHT_PCT}%`,
        aspectRatio: "245 / 342",
        top: "50%",
        left: "50%",
        transform: `translate(${xOffsetPct}%, -50%) rotate(${rotationDeg}deg)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </div>
  );
}
