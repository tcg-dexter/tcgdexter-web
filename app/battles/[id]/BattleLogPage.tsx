"use client";

import Link from "next/link";
import BattleLogDetail from "@/app/components/BattleLogDetail";

interface Props {
  matchId: string;
  result: "win" | "loss" | "draw";
  opponentArchetype: string | null;
  createdAt: string;
  deckName: string;
  username: string;
  deckImageUrl: string | null;
  opponentAttackerName: string | null;
  opponentImageUrl: string | null;
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

export default function BattleLogPage({
  matchId,
  result,
  opponentArchetype,
  createdAt,
  deckName,
  username,
  deckImageUrl,
  opponentAttackerName,
  opponentImageUrl,
  hasBattleLog,
}: Props) {
  const cfg = {
    win:  { label: "Win",  bg: "bg-green-100", text: "text-green-700" },
    loss: { label: "Loss", bg: "bg-red-100",   text: "text-red-700"   },
    draw: { label: "Draw", bg: "bg-gray-100",  text: "text-gray-500"  },
  }[result];

  const vsLabel = opponentArchetype
    ?? (opponentAttackerName ? `${opponentAttackerName}` : null);

  const showVersus = !!deckImageUrl && !!opponentImageUrl;

  return (
    <div className="min-h-screen bg-bg">

      {/* Header — constrained width */}
      <div className="mx-auto max-w-2xl px-4 pt-[calc(env(safe-area-inset-top)_+_1.5rem)] pb-4">

        <Link
          href="/"
          className="mb-5 inline-flex items-center gap-1 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors"
        >
          ← Home
        </Link>

        <div className="mt-1 rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5">
          <div className="flex items-start gap-3">
            <span className={`mt-0.5 shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${cfg.bg} ${cfg.text}`}>
              {cfg.label}
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-[17px] font-semibold text-text-primary leading-tight truncate">
                {deckName}
              </h1>
              <p className="text-[12px] font-medium text-text-muted mt-0.5">@{username}</p>
              {vsLabel && (
                <p className="text-[13px] text-text-secondary mt-1">vs. {vsLabel}</p>
              )}
            </div>
            <p className="shrink-0 text-[11px] text-text-muted mt-0.5">
              {relativeTime(createdAt)}
            </p>
          </div>

          {/* Versus card images */}
          {showVersus && (
            <div className="mt-5 flex items-end justify-center gap-4">
              <div style={{ transform: "rotate(-6deg)", transformOrigin: "bottom center" }}>
                <div
                  className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]"
                  style={{ width: 88, height: 123 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={deckImageUrl!} alt={deckName} className="w-full h-full object-contain" />
                </div>
              </div>
              <span className="mb-7 text-[10px] font-black text-text-muted tracking-[0.2em]">VS</span>
              <div style={{ transform: "rotate(6deg)", transformOrigin: "bottom center" }}>
                <div
                  className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]"
                  style={{ width: 88, height: 123 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={opponentImageUrl!} alt={opponentAttackerName ?? "Opponent"} className="w-full h-full object-contain" />
                </div>
              </div>
            </div>
          )}

          {/* Deck image only */}
          {!showVersus && deckImageUrl && (
            <div className="mt-4 flex justify-center">
              <div
                className="rounded-[6px] overflow-hidden border border-black/[0.07] shadow-sm bg-[var(--surface)]"
                style={{ width: 88, height: 123 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={deckImageUrl} alt={deckName} className="w-full h-full object-contain" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Battle log — full width */}
      <div className="px-3 pb-16">
        {hasBattleLog ? (
          <>
            <p className="mb-1 mt-1 text-xs font-semibold uppercase tracking-widest text-text-muted px-1">
              Battle Log
            </p>
            <BattleLogDetail
              matchId={matchId}
              apiUrl={`/api/battles/${matchId}/log`}
            />
          </>
        ) : (
          <div className="rounded-2xl border border-black/8 bg-white/90 shadow-sm p-5 text-sm text-text-muted text-center">
            No battle log available for this match.
          </div>
        )}
      </div>

    </div>
  );
}
