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

const RESULT_CFG = {
  win:  { label: "Win",  badgeBg: "bg-green-100",  badgeText: "text-green-700",  glow: "bg-green-400",  heroBg: "from-[#091209]" },
  loss: { label: "Loss", badgeBg: "bg-red-100",    badgeText: "text-red-700",    glow: "bg-red-400",    heroBg: "from-[#12090a]" },
  draw: { label: "Draw", badgeBg: "bg-white/10",   badgeText: "text-white/55",   glow: "bg-white/30",   heroBg: "from-[#0d0d0d]" },
};

const CARD_W = 112;
const CARD_H = 157; // ~1.4 aspect ratio (standard Pokémon card)

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
  const cfg = RESULT_CFG[result];
  const vsLabel = opponentArchetype ?? opponentAttackerName ?? null;
  const showVersus = !!deckImageUrl && !!opponentImageUrl;

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Hero banner ─────────────────────────────────────────── */}
      <div className={`bg-gradient-to-b ${cfg.heroBg} to-[#0f0f0f] rounded-b-[32px] overflow-hidden`}>

        {/* Back link */}
        <div className="px-4 pt-[calc(env(safe-area-inset-top)_+_0.875rem)]">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/35 hover:text-white/65 transition-colors"
          >
            ← Home
          </Link>
        </div>

        {/* Result badge with color bloom */}
        <div className="relative flex justify-center items-center pt-5 pb-2">
          <div className={`absolute w-36 h-12 blur-3xl opacity-25 rounded-full ${cfg.glow}`} />
          <span className={`relative px-5 py-1.5 rounded-full text-[11px] font-bold tracking-widest uppercase ${cfg.badgeBg} ${cfg.badgeText}`}>
            {cfg.label}
          </span>
        </div>

        {/* Card images */}
        {showVersus ? (
          <>
            <div className="flex items-end justify-center gap-3 px-5 pt-3">
              {/* Player card */}
              <div className="flex-1 flex justify-end">
                <div style={{ transform: "rotate(-6deg)", transformOrigin: "bottom center" }}>
                  <div
                    className="rounded-xl overflow-hidden bg-[var(--surface)]"
                    style={{ width: CARD_W, height: CARD_H, boxShadow: "0 12px 48px rgba(0,0,0,0.75)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={deckImageUrl!} alt={deckName} className="w-full h-full object-contain" />
                  </div>
                </div>
              </div>

              {/* VS */}
              <div className="shrink-0 flex items-center mb-14">
                <span className="text-[9px] font-black text-white/20 tracking-[0.3em]">VS</span>
              </div>

              {/* Opponent card */}
              <div className="flex-1 flex justify-start">
                <div style={{ transform: "rotate(6deg)", transformOrigin: "bottom center" }}>
                  <div
                    className="rounded-xl overflow-hidden bg-[var(--surface)]"
                    style={{ width: CARD_W, height: CARD_H, boxShadow: "0 12px 48px rgba(0,0,0,0.75)" }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={opponentImageUrl!} alt={opponentAttackerName ?? "Opponent"} className="w-full h-full object-contain" />
                  </div>
                </div>
              </div>
            </div>

            {/* Player labels — mirror the card alignment */}
            <div className="flex justify-between px-5 pt-3 pb-5">
              <div className="flex-1 pl-2">
                <p className="text-[11px] font-semibold text-white/60 truncate" style={{ maxWidth: CARD_W + 20 }}>{deckName}</p>
                <p className="text-[10px] text-white/30 mt-0.5">@{username}</p>
              </div>
              <div className="flex-1 text-right pr-2">
                <p className="text-[11px] font-semibold text-white/60 truncate ml-auto" style={{ maxWidth: CARD_W + 20 }}>
                  {vsLabel ?? "Opponent"}
                </p>
                <p className="text-[10px] text-white/30 mt-0.5">Opponent</p>
              </div>
            </div>
          </>
        ) : deckImageUrl ? (
          <>
            <div className="flex justify-center pt-3">
              <div
                className="rounded-xl overflow-hidden bg-[var(--surface)]"
                style={{ width: CARD_W, height: CARD_H, boxShadow: "0 12px 48px rgba(0,0,0,0.75)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={deckImageUrl} alt={deckName} className="w-full h-full object-contain" />
              </div>
            </div>
            <div className="pt-3 pb-5 text-center px-4">
              <p className="text-[13px] font-semibold text-white/70 truncate">{deckName}</p>
              <p className="text-[11px] text-white/35 mt-0.5">
                @{username}{vsLabel ? ` · vs. ${vsLabel}` : ""}
              </p>
            </div>
          </>
        ) : (
          <div className="px-6 pt-4 pb-6">
            <h1 className="text-lg font-semibold text-white/80">{deckName}</h1>
            <p className="text-[12px] text-white/40 mt-1">
              @{username}{vsLabel ? ` · vs. ${vsLabel}` : ""}
            </p>
          </div>
        )}
      </div>

      {/* ── Date / meta strip ───────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-black/[0.06]">
        <p className="text-[11px] text-text-muted">
          {vsLabel ? `vs. ${vsLabel}` : deckName}
        </p>
        <p className="text-[11px] text-text-muted">{relativeTime(createdAt)}</p>
      </div>

      {/* ── Battle log ──────────────────────────────────────────── */}
      <div className="px-3 pt-3 pb-16">
        {hasBattleLog ? (
          <>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-widest text-text-muted">
              Battle Log
            </p>
            <BattleLogDetail matchId={matchId} apiUrl={`/api/battles/${matchId}/log`} />
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
