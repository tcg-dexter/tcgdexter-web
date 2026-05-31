"use client";

import BattleLogDetail from "@/app/components/BattleLogDetail";
import BackButton from "@/app/components/ui/BackButton";
import ThemeColor from "@/app/components/ThemeColor";

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
        className="relative w-full overflow-hidden h-[calc(34vw-12px)] sm:h-auto sm:aspect-[3/1]"
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
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none px-6">
              <div className="text-center text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.45)]">
                <p className="text-lg sm:text-2xl font-bold leading-tight truncate">
                  {playerLabel}
                </p>
                <p className="my-0.5 sm:my-1 text-xs sm:text-sm font-semibold uppercase tracking-[0.25em] opacity-90">
                  vs
                </p>
                <p className="text-lg sm:text-2xl font-bold leading-tight truncate">
                  {opponentLabel}
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

      {/* Battle stats — read as a small horizontal bar chart: one row
          per stat, one column per player. Per-row maxes drive the bar
          lengths so absolute scale stays visible (a 48-vs-12 damage row
          is much heavier than a 3-vs-4 pokémon row). Match-level facts
          that don't belong to either side (date, turns, etc.) sit in
          their own panel below. */}
      <div className="mx-auto w-full max-w-2xl px-4 mt-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-2 px-1">
          Battle Stats
        </p>
        <div className="rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5">
          <StatChart
            playerName={playerSideName}
            opponentName={opponentSideName}
            rows={[
              { label: "Damage", left: playerStats.damage, right: opponentStats.damage },
              { label: "Pokémon Played", left: playerStats.pokemon, right: opponentStats.pokemon },
              { label: "Supporters", left: playerStats.supporters, right: opponentStats.supporters },
              { label: "Items", left: playerStats.items, right: opponentStats.items },
              { label: "Energy Attached", left: playerStats.energy, right: opponentStats.energy },
            ]}
          />
        </div>

        {/* Match-level facts — not tied to either player. */}
        <p className="text-[11px] font-semibold uppercase tracking-widest text-text-muted mb-2 px-1 mt-5">
          Match
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard
            label="Winner"
            value={winnerName ?? "Draw"}
            tone={result === "win" ? "gradient" : result === "loss" ? "dark" : "ringed"}
          />
          <StatCard
            label="Turns"
            value={totalTurns != null ? String(totalTurns) : "—"}
          />
          <StatCard label="Date" value={formatPlayedAt(playedAt)} />
          <StatCard label="Played" value={relativeTime(createdAt)} />
        </div>
      </div>

      {/* Battle log — full width */}
      <div className="px-3 pb-16">
        {hasBattleLog ? (
          <>
            <p className="mb-1 mt-4 text-xs font-semibold uppercase tracking-widest text-text-muted px-1">
              Battle Log
            </p>
            <BattleLogDetail
              matchId={matchId}
              apiUrl={`/api/battles/${matchId}/log`}
              result={result}
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
 *  site. Tones mirror the W/L/T tiles on /meta-decks/[slug]. */
function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "gradient" | "dark" | "ringed";
}) {
  if (tone === "gradient") {
    return (
      <div className="rounded-2xl bg-gradient-brand shadow-sm px-4 py-3 text-center text-white">
        <p className="text-lg font-bold tabular-nums truncate">{value}</p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "dark") {
    return (
      <div className="rounded-2xl bg-black shadow-sm px-4 py-3 text-center text-white">
        <p className="text-lg font-bold tabular-nums truncate">{value}</p>
        <p className="text-xs mt-0.5 opacity-90">{label}</p>
      </div>
    );
  }
  if (tone === "ringed") {
    return (
      <div className="rounded-2xl bg-white/90 backdrop-blur-xl shadow-[inset_0_0_0_1px_black] px-4 py-3 text-center">
        <p className="text-lg font-bold text-text-primary tabular-nums truncate">{value}</p>
        <p className="text-xs text-text-primary mt-0.5">{label}</p>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm px-4 py-3 text-center">
      <p className="text-lg font-bold text-text-primary tabular-nums truncate">{value}</p>
      <p className="text-xs text-text-muted mt-0.5">{label}</p>
    </div>
  );
}

/** Small horizontal bar chart: one row per stat, one column per
 *  player. Each row's bars are scaled to the row's own max, so the
 *  longer-bar side reads as "more" at a glance and absolute scale
 *  stays comparable across rows of the same metric in other matches.
 *  Player bars use the brand gradient; opponent bars use solid dark. */
function StatChart({
  playerName,
  opponentName,
  rows,
}: {
  playerName: string;
  opponentName: string;
  rows: { label: string; left: number; right: number }[];
}) {
  return (
    <div className="grid grid-cols-[88px_1fr_1fr] gap-x-4 gap-y-4 items-center">
      {/* Column headers — top-left is blank, then each player. */}
      <div />
      <div className="text-[11px] font-bold text-text-primary truncate">
        {playerName}
      </div>
      <div className="text-[11px] font-bold text-text-primary truncate">
        {opponentName}
      </div>

      {rows.map((row) => {
        const max = Math.max(row.left, row.right, 1);
        return (
          <div key={row.label} className="contents">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              {row.label}
            </div>
            <ChartCell value={row.left} pct={(row.left / max) * 100} tone="player" />
            <ChartCell value={row.right} pct={(row.right / max) * 100} tone="opponent" />
          </div>
        );
      })}
    </div>
  );
}

function ChartCell({
  value,
  pct,
  tone,
}: {
  value: number;
  pct: number;
  tone: "player" | "opponent";
}) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="h-2 flex-1 rounded-full bg-surface overflow-hidden min-w-0">
        <div
          className={`h-full rounded-full transition-[width] ${
            tone === "player" ? "bg-gradient-brand" : "bg-black/85"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-sm font-bold text-text-primary tabular-nums shrink-0 w-8 text-right">
        {value}
      </span>
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

/** Shift a hex color's lightness by a percentage delta (positive = lighter,
 *  negative = darker). Used to synthesize a gradient end when both
 *  matchup sides resolve to the same energy-type color. */
function shade(hex: string, deltaPct: number): string {
  const m = hex.match(/^#?([0-9a-f]{6})$/i);
  if (!m) return hex;
  const num = parseInt(m[1], 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * deltaPct / 100)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * deltaPct / 100)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(255 * deltaPct / 100)));
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
