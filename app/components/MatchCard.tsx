import Link from "next/link";
import { shade } from "@/lib/color";

export type RecentMatch = {
  id: string;
  result: "win" | "loss" | "draw";
  opponentArchetype: string | null;
  opponentHandle: string | null;
  createdAt: string;
  deckId: string;
  deckName: string;
  username: string;
  deckImageUrl: string | null;
  /** Unique card names from the player's decklist, for search. */
  deckCardNames: string[];
  opponentImageUrl: string | null;
  opponentAttackerName: string | null;
  playerColor: string;
  opponentColor: string;
  /** Prize cards taken in this match. Sourced from match_actions
   *  prize_taken rows; 0 when the battle log has no prize events. */
  playerPrizes: number;
  opponentPrizes: number;
  isBestOf3: boolean;
  hasBattleLog: boolean;
  /** Populated only for imported battle logs (source = 'tcg_live_log').
   *  Null for manual and prize-only matches. Used by the /matches Match
   *  of the Week hero, which ranks by longest game in the last 7 days. */
  totalTurns: number | null;
};

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function MatchCard({ match }: { match: RecentMatch }) {
  const opponentDeckLabel =
    match.opponentArchetype ?? match.opponentAttackerName ?? "Unknown deck";
  const opponentHandleLabel = match.opponentHandle ?? "Opponent";

  // This section is identity-agnostic: winner card always renders on the
  // left, loser on the right. On a draw, fall back to the site-standard
  // gradient and keep the natural player/opponent order.
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

  const footer = (
    <div className="grid grid-cols-2 gap-3 px-3.5 pt-3 pb-3.5 border-t border-black/[0.06]">
      <div className="min-w-0">
        <p className="text-[11px] font-medium text-text-muted truncate">
          {leftSide.handleLabel}&rsquo;s
        </p>
        <p className="text-[13px] font-semibold text-text-primary truncate">
          {leftSide.deckLabel}
        </p>
      </div>
      <div className="min-w-0 text-right">
        <p className="text-[11px] font-medium text-text-muted truncate">
          {rightSide.handleLabel}&rsquo;s
        </p>
        <p className="text-[13px] font-semibold text-text-primary truncate">
          {rightSide.deckLabel}
        </p>
      </div>
    </div>
  );

  // Versus layout — battle log match with both card images
  if (leftSide.imageUrl && rightSide.imageUrl) {
    return (
      <Link
        href={`/battles/${match.id}`}
        className="block rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      >
        <div className="relative overflow-hidden">
          <div className={gradientClass} style={gradientStyle} />
          {/* Ghost card — the winner's deck hero card, blown up into a
              faded grayscale background texture. Mirrors DeckBanner's
              ghost-card treatment on the Deck Collection preview cards
              (gradient background, then the scaled/desaturated card art,
              then content on top) — same opacity/grayscale/scale recipe,
              sized for this card's wider, shorter gradient zone. The
              parent's overflow-hidden clips it to this top hero zone only,
              so it never bleeds into the footer below. */}
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
                transform: "translate(-50%, -15%) scale(2.4) rotate(-4deg)",
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
          {/* Prize counts — large white digits flanking the card pair,
              vertically centered within the gradient zone. Use absolute
              positioning so the centered cards stay perfectly centered
              regardless of digit width. */}
          <span
            aria-label={`${leftSide.handleLabel} prizes taken`}
            className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-white text-[2.4rem] font-black tabular-nums leading-none drop-shadow-sm pointer-events-none"
          >
            {leftSide.prizes}
          </span>
          <span
            aria-label={`${rightSide.handleLabel} prizes taken`}
            className="absolute right-3 top-1/2 -translate-y-1/2 z-10 text-white text-[2.4rem] font-black tabular-nums leading-none drop-shadow-sm pointer-events-none"
          >
            {rightSide.prizes}
          </span>
          <div className="relative flex items-end justify-center gap-4 px-4 pt-5 pb-3">
            <div style={{ transform: "rotate(-6deg)", transformOrigin: "bottom center" }}>
              <div className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]" style={{ width: 96, height: 134 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={leftSide.imageUrl} alt={leftSide.imageAlt} className="w-full h-full object-contain" />
              </div>
            </div>
            <div style={{ transform: "rotate(6deg)", transformOrigin: "bottom center" }}>
              <div className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]" style={{ width: 96, height: 134 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={rightSide.imageUrl} alt={rightSide.imageAlt} className="w-full h-full object-contain" />
              </div>
            </div>
          </div>
          {match.isBestOf3 && (
            <div className="absolute inset-x-0 bottom-2 z-10 flex justify-center pointer-events-none">
              <span className="rounded-full bg-white px-3 py-1 text-[10px] font-bold text-black">
                Best of 3
              </span>
            </div>
          )}
          <div className="relative px-3.5 pb-2 flex items-center justify-end gap-2">
            <p className="text-[11px] text-white/80">{relativeTime(match.createdAt)}</p>
          </div>
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-xl font-black text-white tracking-[0.2em]"
            style={{ textShadow: "0 0 24px rgba(0,0,0,0.55), 0 8px 28px rgba(0,0,0,0.65), 0 2px 4px rgba(0,0,0,0.7)" }}
          >
            VS
          </span>
        </div>
        {footer}
      </Link>
    );
  }

  // Simple layout — leading image (whichever side has one) + info
  const leadImage = leftSide.imageUrl
    ? { url: leftSide.imageUrl, alt: leftSide.imageAlt }
    : rightSide.imageUrl
    ? { url: rightSide.imageUrl, alt: rightSide.imageAlt }
    : null;
  return (
    <Link
      href={`/battles/${match.id}`}
      className="block rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
    >
      <div className="relative flex gap-3.5 p-3.5">
        <div className={gradientClass} style={gradientStyle} />
        {leadImage && (
          <div
            className="relative shrink-0 rounded-lg overflow-hidden border border-black/[0.07] bg-[var(--surface)]"
            style={{ width: 72, height: 101 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={leadImage.url} alt={leadImage.alt} className="w-full h-full object-contain" />
          </div>
        )}
        <div className="relative flex-1 min-w-0 flex items-center justify-end gap-2">
          <p className="text-[11px] text-white/80">{relativeTime(match.createdAt)}</p>
        </div>
      </div>
      {footer}
    </Link>
  );
}
