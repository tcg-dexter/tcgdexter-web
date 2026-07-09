"use client";

import Link from "next/link";
import { shade } from "@/lib/color";
import { type RecentMatch } from "@/app/components/MatchCard";

/** Short month/day for the "Played" stat value — no year, since the
 *  Featured Match is by definition within the last 7 days. */
function playedDateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/**
 * Featured Match hero — an amalgamation of two existing patterns:
 *
 *  1. The /my-decks pinned-deck hero shell (glow, rounded card, two-column
 *     desktop split, gradient-brand shadow) from MyDecksClient's
 *     PinnedDeckHero.
 *  2. The MatchCard versus banner (accent-color gradient, ghost card of
 *     the winner's deck, fanned + rotated hero cards, huge prize digits,
 *     VS glyph) from app/components/MatchCard.tsx.
 *
 * The banner column takes the versus imagery; the info column takes the
 * pinned-deck's stat treatment, but populated with match numbers instead
 * of deck record — total damage dealt (the axis this pick is ranked on),
 * prize score, and time since — then a "View battle" CTA that jumps to
 * /battles/[id].
 */
export default function FeaturedMatchHero({ match }: { match: RecentMatch }) {
  const opponentDeckLabel =
    match.opponentArchetype ?? match.opponentAttackerName ?? "Unknown deck";
  const opponentHandleLabel = match.opponentHandle ?? "Opponent";

  const isDraw = match.result === "draw";
  const playerWon = match.result === "win";
  const leftSide = playerWon
    ? {
        imageUrl: match.deckImageUrl,
        imageAlt: match.deckName,
        handleLabel: match.username,
        deckLabel: match.deckName,
        color: match.playerColor,
        prizes: match.playerPrizes,
      }
    : {
        imageUrl: match.opponentImageUrl,
        imageAlt: match.opponentAttackerName ?? "Opponent",
        handleLabel: opponentHandleLabel,
        deckLabel: opponentDeckLabel,
        color: match.opponentColor,
        prizes: match.opponentPrizes,
      };
  const rightSide = playerWon
    ? {
        imageUrl: match.opponentImageUrl,
        imageAlt: match.opponentAttackerName ?? "Opponent",
        handleLabel: opponentHandleLabel,
        deckLabel: opponentDeckLabel,
        color: match.opponentColor,
        prizes: match.opponentPrizes,
      }
    : {
        imageUrl: match.deckImageUrl,
        imageAlt: match.deckName,
        handleLabel: match.username,
        deckLabel: match.deckName,
        color: match.playerColor,
        prizes: match.playerPrizes,
      };

  const gradientStyle: React.CSSProperties | undefined = isDraw
    ? undefined
    : {
        background:
          leftSide.color === rightSide.color
            ? `linear-gradient(90deg, ${leftSide.color} 0%, ${shade(leftSide.color, -18)} 100%)`
            : `linear-gradient(90deg, ${leftSide.color} 0%, ${rightSide.color} 100%)`,
      };
  const gradientClass = isDraw
    ? "absolute inset-0 bg-gradient-brand opacity-80"
    : "absolute inset-0";

  return (
    <div className="relative mb-4">
      {/* Gradient glow — matches PinnedDeckHero's treatment exactly. */}
      <div className="absolute -inset-px rounded-2xl bg-gradient-brand opacity-30 blur-md" />
      <div className="relative rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-[0_20px_30px_-15px_rgba(217,30,13,0.3)] overflow-hidden flex flex-col md:flex-row">
        {/* Banner column — the MatchCard versus imagery, sized for hero. */}
        <div className="md:w-[360px] shrink-0">
          <div className="relative h-[220px] md:h-full overflow-hidden">
            <div className={gradientClass} style={gradientStyle} />
            {/* Ghost card — winner's deck hero, blown up + desaturated,
                same recipe as the grid preview cards but sized for this
                hero zone. */}
            {!isDraw && leftSide.imageUrl && (
              <div
                aria-hidden
                className="absolute rounded-lg overflow-hidden"
                style={{
                  width: 150,
                  height: 207,
                  left: "50%",
                  top: "50%",
                  opacity: 0.2,
                  filter: "grayscale(1)",
                  transform:
                    "translate(-50%, -15%) scale(2.4) rotate(-4deg)",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={leftSide.imageUrl}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
            )}
            {/* Prize digits flanking the fanned pair — same 2.4rem hero
                treatment as MatchCard. */}
            <span
              aria-label={`${leftSide.handleLabel} prizes taken`}
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-white text-[2.64rem] font-black tabular-nums leading-none drop-shadow-sm pointer-events-none"
            >
              {leftSide.prizes}
            </span>
            <span
              aria-label={`${rightSide.handleLabel} prizes taken`}
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-white text-[2.64rem] font-black tabular-nums leading-none drop-shadow-sm pointer-events-none"
            >
              {rightSide.prizes}
            </span>
            <div className="relative h-full flex items-center justify-center gap-[18px] px-4">
              {leftSide.imageUrl && (
                <div
                  style={{
                    transform: "rotate(-6deg)",
                    transformOrigin: "center",
                  }}
                >
                  <div
                    className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]"
                    style={{ width: 115, height: 161 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={leftSide.imageUrl}
                      alt={leftSide.imageAlt}
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              )}
              {rightSide.imageUrl && (
                <div
                  style={{
                    transform: "rotate(6deg)",
                    transformOrigin: "center",
                  }}
                >
                  <div
                    className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]"
                    style={{ width: 115, height: 161 }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={rightSide.imageUrl}
                      alt={rightSide.imageAlt}
                      className="w-full h-full object-contain"
                    />
                  </div>
                </div>
              )}
            </div>
            {/* Player names anchored to each side's hero-card / prize-count
                pair. Matched typography with the prize digits (white +
                drop-shadow) so they read as part of the same score-strip. */}
            <span className="absolute left-3 bottom-2 z-10 max-w-[45%] truncate text-white text-[13px] font-bold leading-none drop-shadow-sm pointer-events-none">
              {leftSide.handleLabel}
            </span>
            <span className="absolute right-3 bottom-2 z-10 max-w-[45%] truncate text-white text-[13px] font-bold leading-none drop-shadow-sm pointer-events-none">
              {rightSide.handleLabel}
            </span>
            {match.isBestOf3 && (
              <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center pointer-events-none">
                <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-black">
                  Best of 3
                </span>
              </div>
            )}
            <span
              className="pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-black text-white tracking-[0.2em]"
              style={{
                textShadow:
                  "0 0 24px rgba(0,0,0,0.55), 0 8px 28px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.7)",
              }}
            >
              VS
            </span>
          </div>
        </div>

        {/* Info column — pinned-deck stat treatment, populated with match
            numbers instead of deck record. */}
        <div className="flex-1 p-5 md:p-6 flex flex-col">
          <div className="text-[11px] font-bold uppercase tracking-[0.15em] bg-gradient-brand bg-clip-text text-transparent">
            Featured Match
          </div>
          {/* Title — two lines: "<player>'s <deck>" then "vs <player>'s
              <deck>". Player names live in the banner too so this line is
              purely the deck-owner phrasing you'd hear a caster read. H2
              scale (text-xl) sits below the stat numbers in visual weight,
              letting the eyebrow + damage figure lead. */}
          <h2 className="mt-2 text-xl font-bold text-text-primary leading-tight">
            <span className="block truncate">
              {leftSide.handleLabel}&rsquo;s {leftSide.deckLabel}
            </span>
            <span className="block truncate">
              <span className="text-text-muted font-semibold text-sm mr-2">
                vs
              </span>
              {rightSide.handleLabel}&rsquo;s {rightSide.deckLabel}
            </span>
          </h2>

          <div className="flex flex-wrap justify-between gap-y-3 mt-4">
            {match.totalDamage != null && (
              <div className="text-center">
                <div className="text-[24px] font-extrabold tabular-nums bg-[linear-gradient(135deg,#F2A20C_0%,#D91E0D_50%,#A60D0D_100%)] bg-clip-text text-transparent">
                  {match.totalDamage.toLocaleString()}
                </div>
                <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">
                  Damage
                </div>
              </div>
            )}
            <div className="text-center">
              <div className="text-[24px] font-extrabold tabular-nums text-text-primary">
                {leftSide.prizes}&ndash;{rightSide.prizes}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">
                Prizes
              </div>
            </div>
            <div className="text-center">
              <div className="text-[24px] font-extrabold text-text-primary">
                {playedDateLabel(match.createdAt)}
              </div>
              <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-text-muted">
                Played
              </div>
            </div>
          </div>

          <div className="flex items-center mt-5">
            <Link
              href={`/battles/${match.id}`}
              className="h-[38px] flex-1 min-w-0 inline-flex items-center justify-center gap-1.5 rounded-full border border-transparent bg-black px-[1px] text-sm font-semibold text-white transition-opacity hover:opacity-80 touch-manipulation"
            >
              View battle
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
