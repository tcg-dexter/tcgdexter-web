"use client";

import { useLayoutEffect, useRef, useState } from "react";
import ReplayViewer from "@/app/components/replay/ReplayViewer";
import BackButton from "@/app/components/ui/BackButton";
import {
  BattleStatChart,
  buildBattleStatRows,
  type BattleSideStats,
} from "@/app/components/BattleStatChart";
import { shade } from "@/lib/color";

export type { BattleSideStats };

interface Props {
  matchId: string;
  result: "win" | "loss" | "draw";
  opponentArchetype: string | null;
  createdAt: string;
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
  winnerName: string | null;
  loserName: string | null;
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

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
  matchId,
  result,
  opponentArchetype,
  createdAt,
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
  winnerName,
  loserName,
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

  return (
    <main className="min-h-dvh flex flex-col bg-bg">
      {/* Back button — it used to overlay a full-bleed banner, which no
          longer exists, so the desktop (xl+) copy renders here in page
          flow. The wrapper is hidden below xl to avoid leaving its padding
          behind as dead space: the sub-xl copy portals itself into the
          sticky toolbar and isn't a descendant of this div, so hiding the
          wrapper doesn't hide it. */}
      <div className="mx-auto hidden w-full max-w-6xl px-4 pt-3 xl:block">
        <BackButton href="/" ariaLabel="Back" />
      </div>

      {/* Match hero — built to read as a sibling of the deck collection's
          pinned deck: a rounded card sitting on the page background, lit by
          a gradient glow bleeding out from under it, with the artwork panel
          on the left and the details on the right. The one substitution is
          color — the pinned deck glows in the brand gradient, this glows in
          the match's own winner→loser gradient. */}
      <div className="mx-auto w-full max-w-6xl px-4 pt-3">
        <div className="relative">
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
                {playerLabel}
              </p>
              <p className="truncate text-xl md:text-2xl font-bold leading-tight text-text-primary">
                <span className="text-text-muted">vs </span>
                {opponentLabel}
              </p>
              <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-text-muted">
                {formatPlayedAt(playedAt)}
              </p>

              {/* Two rows only — the headline exchange (damage) and the one
                  that decides the game (prizes). The full six-row table
                  still lives on the /matches Featured Match drawer.

                  Butted straight against the date with no margin: the
                  chart's own header row carries `pb-2`, so the two still
                  read as separate lines rather than colliding. */}
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
      </div>

      {/* Battle log — the playback viewer, capped to the same max-width
          the rest of the page uses so the 16:9 window doesn't run wider
          than the hero above it. It follows the hero directly, with no
          section heading: the viewer is the only thing left on the page,
          so there's nothing for a divider to separate it from. */}
      <div className="mx-auto w-full max-w-6xl px-4 pb-16">
        {hasBattleLog ? (
          <ReplayViewer
            matchId={matchId}
            replayUrl={`/api/battles/${matchId}/replay`}
            logUrl={`/api/battles/${matchId}/log`}
            result={result}
            playerColor={playerColor}
            opponentColor={opponentColor}
          />
        ) : (
          <div className="mt-4 rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5 text-sm text-text-muted text-center dark:bg-surface-elevated dark:border-white/10">
            No battle log available for this match.
          </div>
        )}
      </div>
    </main>
  );
}

/** Headline tile matching the meta archetype StatCard tones so the
 *  result panel reads as one consistent design language across the
 *  site. Tones mirror the W/L/T tiles on /meta-archetypes/[slug]. The
 *  value auto-shrinks to fit the tile width so long handles like
 *  "MoonSheikah" don't truncate. */
function StatCard({
  label,
  value,
  tone = "default",
}: {
  label?: string;
  value: string;
  tone?: "default" | "gradient" | "dark" | "ringed";
}) {
  const chrome =
    tone === "gradient"
      ? "rounded-2xl bg-gradient-brand shadow-sm px-4 py-3 text-center text-white"
      : tone === "dark"
      ? "rounded-2xl bg-black dark:bg-white shadow-sm px-4 py-3 text-center text-white dark:text-black"
      : tone === "ringed"
      ? "rounded-2xl bg-white/90 backdrop-blur-xl shadow-[inset_0_0_0_1px_black] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] px-4 py-3 text-center dark:bg-surface-elevated"
      : "rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm px-4 py-3 text-center dark:bg-surface-elevated dark:border-white/10";

  const valueClass =
    tone === "gradient" || tone === "dark"
      ? "font-bold tabular-nums"
      : "font-bold text-text-primary tabular-nums";

  const labelClass =
    tone === "gradient" || tone === "dark"
      ? "text-xs mt-0.5 opacity-90"
      : tone === "ringed"
      ? "text-xs text-text-primary mt-0.5"
      : "text-xs text-text-muted mt-0.5";

  return (
    <div className={`${chrome} flex flex-col justify-center`}>
      <FitText text={value} className={valueClass} maxSize={18} minSize={10} />
      {label && <p className={labelClass}>{label}</p>}
    </div>
  );
}

/** Render `text` at the largest font-size between `minSize` and
 *  `maxSize` that still fits on a single line inside the parent
 *  container. Measures via a hidden span on layout + on container
 *  resize, then picks the largest size whose rendered width is ≤
 *  the available width. Keeps the chosen size monotonic (never
 *  bouncing up and down) by re-measuring on every observer fire. */
function FitText({
  text,
  className = "",
  maxSize = 18,
  minSize = 10,
}: {
  text: string;
  className?: string;
  maxSize?: number;
  minSize?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [size, setSize] = useState(maxSize);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const fit = () => {
      const cw = container.clientWidth;
      if (cw <= 0) return;
      // Measure at the maximum candidate size, then scale down.
      measure.style.fontSize = `${maxSize}px`;
      const tw = measure.scrollWidth;
      if (tw <= cw) {
        setSize(maxSize);
        return;
      }
      const scaled = Math.max(minSize, Math.floor((maxSize * cw) / tw));
      setSize(scaled);
    };

    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text, maxSize, minSize]);

  return (
    <div ref={containerRef} className="w-full overflow-hidden">
      {/* The visible, fitted line. */}
      <p
        className={`whitespace-nowrap leading-tight ${className}`}
        style={{ fontSize: `${size}px` }}
      >
        {text}
      </p>
      {/* Hidden measurer — same text, sized at maxSize so we can
          divide to derive the fit-size. Absolutely sized off-flow so
          it doesn't affect layout. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className={`invisible absolute -left-[9999px] whitespace-nowrap ${className}`}
      >
        {text}
      </span>
    </div>
  );
}



/**
 * Artwork panel — the battle page's take on the deck collection's pinned
 * deck banner. Same construction: a gradient field, one blown-up
 * desaturated card as a ghost behind everything, and hero cards anchored
 * to the panel's floor so they read as tucked behind its edge. The
 * differences are that there are two heroes rather than one, the ghost is
 * the winner's card, and the pinned banner's favourite toggle, W/L ribbon
 * and avatar stack are all dropped — nothing on a finished match is
 * actionable, and the heroes sit centred in the panel rather than tucked
 * behind its floor.
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
}: {
  gradient: string;
  ghostImageUrl: string | null;
  leftImageUrl: string | null;
  leftAlt: string;
  rightImageUrl: string | null;
  rightAlt: string;
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
