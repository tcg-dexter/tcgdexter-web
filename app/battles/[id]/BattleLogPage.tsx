"use client";

import { Fragment, useLayoutEffect, useRef, useState } from "react";
import BattleLogDetail from "@/app/components/BattleLogDetail";
import BackButton from "@/app/components/ui/BackButton";
import ThemeColor from "@/app/components/ThemeColor";
import { shade } from "@/lib/color";

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
  totalTurns: number | null;
  playerStats: BattleSideStats;
  opponentStats: BattleSideStats;
  hasBattleLog: boolean;
}

export interface BattleSideStats {
  damage: number;
  pokemon: number;
  supporters: number;
  items: number;
  energy: number;
  prizes: number;
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

// Banner card tuning — mirrors the meta-archetype geometry so the two
// banners feel the same size, but reduced to two cards. Each card sits
// flush with the banner's bottom edge and is shifted down by a fraction
// of its own height so a fixed portion peeks above the bottom edge
// regardless of banner height.
const CARD_WIDTH_PCT = 28;
const BOTTOM_CLIP_PCT = 30;
const CARD_ROTATION_DEG = 10;

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
  totalTurns,
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
  // loser's color at the bottom. The top color is a single solid hex,
  // which lets us paint the sticky toolbar + iOS status bar with the
  // exact same color so the gradient reads as continuing up through
  // the device's top edge — the meta archetype banner uses the same
  // trick (solid color matches across toolbar/banner/safe-area).
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
  const themeColor = winnerColor;

  return (
    <main className="min-h-dvh flex flex-col bg-bg">
      {/* Paint the mobile sticky toolbar so it reads as one continuous
          surface with the banner. */}
      <style
        dangerouslySetInnerHTML={{
          __html:
            // Toolbar + iOS status bar share the winner's solid color
            // (the top of the vertical gradient), so the gradient
            // visually continues all the way to the device top.
            `[data-site-toolbar]{background:${winnerColor};backdrop-filter:none;-webkit-backdrop-filter:none}` +
            `[data-site-toolbar] button[aria-label="Toggle navigation menu"]{color:#fff}`,
        }}
      />
      <ThemeColor color={themeColor} />

      {/* Banner — same dimensions as the meta archetype banner, with two
          cards bottom-anchored and the matchup label centered between
          them in white. */}
      <div
        className="relative w-full overflow-hidden h-[calc(30.6vw-10.8px)] sm:h-auto sm:aspect-[3/1]"
        style={{ background: bannerGradient }}
      >
        <div className="absolute inset-0 mx-auto max-w-6xl">
          <div className="relative h-full mx-6">
            {deckImageUrl && (
              <BannerCard
                src={deckImageUrl}
                alt={playerLabel}
                leftPct={6}
                rotationDeg={-CARD_ROTATION_DEG}
              />
            )}
            {opponentImageUrl && (
              <BannerCard
                src={opponentImageUrl}
                alt={opponentLabel}
                leftPct={100 - 6 - CARD_WIDTH_PCT}
                rotationDeg={CARD_ROTATION_DEG}
              />
            )}

            {/* Centered matchup text. Stays vertically and horizontally
                centered in the banner; cards sit beneath it visually
                because zIndex isn't set, so the text paints on top. */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6 pb-[3.4vw] sm:pb-0">
              <div className="text-center text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
                <p className="text-lg sm:text-5xl font-bold leading-tight truncate">
                  {playerLabel}
                </p>
                <p className="my-0.5 sm:my-2 text-xs sm:text-2xl font-semibold uppercase tracking-[0.25em] opacity-90">
                  vs
                </p>
                <p className="text-lg sm:text-5xl font-bold leading-tight truncate">
                  {opponentLabel}
                </p>
                <p className="mt-1.5 sm:mt-3 text-[11px] sm:text-sm font-medium uppercase tracking-[0.2em] opacity-80">
                  {formatPlayedAt(playedAt)}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Back button — desktop overlay; mobile copy portals into the
            sticky toolbar's slot. */}
        <div
          className="absolute left-4 z-10"
          style={{ top: "calc(env(safe-area-inset-top) + 0.75rem)" }}
        >
          <BackButton href="/" ariaLabel="Back" />
        </div>
      </div>

      {/* Battle stats — match-level tiles on top, per-side stat table
          underneath, with no section headings so the whole block reads
          as one continuous summary. */}
      <div className="mx-auto w-full max-w-2xl px-4 mt-8">
        <div className="grid grid-cols-3 gap-3">
          <StatCard
            label="W"
            value={winnerName ?? "Draw"}
            tone={result === "win" ? "gradient" : result === "loss" ? "dark" : "ringed"}
          />
          <StatCard
            label="Turns"
            value={totalTurns != null ? String(totalTurns) : "—"}
          />
          <StatCard
            label="L"
            value={loserName ?? "—"}
            tone="dark"
          />
        </div>

        <div className="mt-5 px-1">
          <StatChart
            playerName={playerSideName}
            opponentName={opponentSideName}
            winnerSide={result === "win" ? "left" : result === "loss" ? "right" : null}
            rows={[
              { label: "Damage Dealt", left: playerStats.damage, right: opponentStats.damage },
              { label: "Pokémon Played", left: playerStats.pokemon, right: opponentStats.pokemon },
              { label: "Supporters Played", left: playerStats.supporters, right: opponentStats.supporters },
              { label: "Items Played", left: playerStats.items, right: opponentStats.items },
              { label: "Energy Attached", left: playerStats.energy, right: opponentStats.energy },
              { label: "Prizes Taken", left: playerStats.prizes, right: opponentStats.prizes },
            ]}
          />
        </div>
      </div>

      {/* Battle log — full width. The heading sits above the thread
          as a strong section break: bold uppercase title flanked by a
          short accent rule, with a turn-count caption underneath. */}
      <div className="px-4 pb-16">
        {hasBattleLog ? (
          <>
            <div className="mt-8 mb-2">
              <div className="flex items-baseline gap-3">
                <h2 className="text-xl font-black uppercase tracking-[0.15em] text-text-primary">
                  Battle Log
                </h2>
                <span className="h-px flex-1 bg-text-primary/15" />
              </div>
              {totalTurns != null && (
                <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-text-muted">
                  {totalTurns} turn{totalTurns === 1 ? "" : "s"}
                </p>
              )}
            </div>
            <BattleLogDetail
              matchId={matchId}
              apiUrl={`/api/battles/${matchId}/log`}
              result={result}
              playerColor={playerColor}
              opponentColor={opponentColor}
            />
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5 text-sm text-text-muted text-center">
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
      ? "rounded-2xl bg-black shadow-sm px-4 py-3 text-center text-white"
      : tone === "ringed"
      ? "rounded-2xl bg-white/90 backdrop-blur-xl shadow-[inset_0_0_0_1px_black] px-4 py-3 text-center"
      : "rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm px-4 py-3 text-center";

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

/** Per-stat table: one row per stat, one column per player. Numbers
 *  carry the comparison — the leader on each row is bolded a touch
 *  heavier so the eye still lands on it without a bar telling you to.
 *  Row dividers span the entire grid width (col-span-3) so the
 *  separators read as one continuous line rather than three column
 *  segments. */
function StatChart({
  playerName,
  opponentName,
  winnerSide,
  rows,
}: {
  playerName: string;
  opponentName: string;
  winnerSide: "left" | "right" | null;
  rows: { label: string; left: number; right: number }[];
}) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] gap-x-6 items-baseline">
      {rows.map((row, idx) => {
        const isFirst = idx === 0;
        const isFooter = idx === rows.length - 1;
        const leftGradient = isFooter && winnerSide === "left";
        const rightGradient = isFooter && winnerSide === "right";
        return (
        <Fragment key={row.label}>
          {!isFirst && (
            <div className={`col-span-3 border-t ${isFooter ? "border-black" : "border-black/[0.08]"}`} />
          )}
          <div className={`font-semibold uppercase tracking-widest text-text-primary py-2.5 ${isFooter ? "text-[14px]" : "text-[11px]"}`}>
            {row.label}
          </div>
          {/* Left (player) value */}
          <div className={`py-2.5 text-right ${isFooter ? "" : "tabular-nums font-semibold text-text-secondary text-sm"} ${leftGradient ? "bg-gradient-brand bg-clip-text text-transparent" : ""}`}>
            {isFooter ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-[11px] font-bold ${!leftGradient ? "text-text-primary" : ""}`}>{playerName}</span>
                <span className={`text-[18px] font-semibold tabular-nums ${!leftGradient ? "text-text-secondary" : ""}`}>{row.left}</span>
              </div>
            ) : row.left}
          </div>
          {/* Right (opponent) value */}
          <div className={`py-2.5 text-right ${isFooter ? "" : "tabular-nums font-semibold text-text-secondary text-sm"} ${rightGradient ? "bg-gradient-brand bg-clip-text text-transparent" : ""}`}>
            {isFooter ? (
              <div className="flex flex-col items-end gap-0.5">
                <span className={`text-[11px] font-bold ${!rightGradient ? "text-text-primary" : ""}`}>{opponentName}</span>
                <span className={`text-[18px] font-semibold tabular-nums ${!rightGradient ? "text-text-secondary" : ""}`}>{row.right}</span>
              </div>
            ) : row.right}
          </div>
        </Fragment>
        );
      })}
    </div>
  );
}

function BannerCard({
  src,
  alt,
  leftPct,
  rotationDeg,
}: {
  src: string;
  alt: string;
  leftPct: number;
  rotationDeg: number;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      aria-hidden="true"
      className="absolute pointer-events-none select-none drop-shadow-md"
      style={{
        bottom: 0,
        left: `${leftPct}%`,
        width: `${CARD_WIDTH_PCT}%`,
        height: "auto",
        transform: `translateY(${BOTTOM_CLIP_PCT}%) rotate(${rotationDeg}deg)`,
        transformOrigin: "50% 100%",
      }}
    />
  );
}

