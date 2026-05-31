"use client";

import BattleLogDetail from "@/app/components/BattleLogDetail";
import BackButton from "@/app/components/ui/BackButton";
import ThemeColor from "@/app/components/ThemeColor";

interface Props {
  matchId: string;
  result: "win" | "loss" | "draw";
  opponentArchetype: string | null;
  createdAt: string;
  deckName: string;
  username: string;
  deckImageUrl: string | null;
  playerPokemonName: string | null;
  playerColor: string;
  opponentAttackerName: string | null;
  opponentImageUrl: string | null;
  opponentColor: string;
  hasBattleLog: boolean;
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
  deckName,
  username,
  deckImageUrl,
  playerPokemonName,
  playerColor,
  opponentAttackerName,
  opponentImageUrl,
  opponentColor,
  hasBattleLog,
}: Props) {
  const cfg = {
    win:  { label: "Win",  bg: "bg-green-100", text: "text-green-700" },
    loss: { label: "Loss", bg: "bg-red-100",   text: "text-red-700"   },
    draw: { label: "Draw", bg: "bg-gray-100",  text: "text-gray-500"  },
  }[result];

  const playerLabel = playerPokemonName ?? deckName;
  const opponentLabel =
    opponentAttackerName ?? opponentArchetype ?? "Opponent";

  // Gradient between the two energy-type colors. Falls back to a soft
  // neutral when both sides resolve to the same color so the banner
  // doesn't read as a flat block.
  const bannerGradient =
    playerColor === opponentColor
      ? `linear-gradient(135deg, ${playerColor} 0%, ${shade(playerColor, -18)} 100%)`
      : `linear-gradient(135deg, ${playerColor} 0%, ${opponentColor} 100%)`;
  const themeColor = playerColor;

  return (
    <main className="min-h-dvh flex flex-col bg-bg">
      {/* Paint the mobile sticky toolbar so it reads as one continuous
          surface with the banner. */}
      <style
        dangerouslySetInnerHTML={{
          __html: `[data-site-toolbar]{background:${themeColor};backdrop-filter:none;-webkit-backdrop-filter:none}[data-site-toolbar] button[aria-label="Toggle navigation menu"]{color:#fff}`,
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

      {/* Match meta — Win badge, deck name, time. */}
      <div className="mx-auto w-full max-w-2xl px-4 mt-4">
        <div className="rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[17px] font-semibold text-text-primary leading-tight truncate">
                {deckName}
              </h1>
              <p className="text-[12px] font-medium text-text-muted mt-0.5">@{username}</p>
            </div>
            <p className="shrink-0 text-[11px] text-text-muted mt-0.5">
              {relativeTime(createdAt)}
            </p>
          </div>
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
