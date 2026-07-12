"use client";

// AI-player practice mode, rendered on the shared replay BoardKit — the
// same mats, card holders, piles, prize stacks and card inspector as the
// Replay viewer, with an interaction layer on top: tap a hand card to play
// it, tap a highlighted Pokémon to target it, attack/retreat/end-turn from
// the action bar. When no game action is pending, taps fall through to the
// card inspector exactly like replay.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PlayResponse } from "@/app/api/play/route";
import type { ClientMon, ClientView, InteractiveMove } from "@/lib/engine/sim";
import type { GameReview } from "@/lib/ml/gameReview";
import {
  InspectContext,
  PlayerMat,
  ReplayCardInspector,
  computeReplayCardWidth,
  CARD_BACK_URL,
  type InspectTarget,
  type PokemonFrame,
} from "@/app/admin-tools/replay/BoardKit";
import type { DeckOption } from "./page";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const SEVERITY_STYLES: Record<string, string> = {
  warning: "bg-red-100 text-red-800",
  suggestion: "bg-yellow-100 text-yellow-800",
  info: "bg-surface text-text-secondary",
};

const DIFFICULTIES = [
  { key: "easy", label: "Easy" },
  { key: "medium", label: "Medium" },
  { key: "hard", label: "Hard" },
] as const;

/* ─── ClientView → BoardKit frames ──────────────────────────────── */

function toFrame(mon: ClientMon, images: Record<string, string | null>): PokemonFrame {
  return {
    id: mon.id,
    name: mon.name,
    damage: mon.damage,
    hp: mon.hp,
    energy: mon.energy,
    energyTypes: mon.energyTypes,
    conditions: [],
    evolutionStack: mon.stack,
    imageUrl: images[mon.name] ?? null,
  };
}

function discardTop(cards: { name: string }[]): string | null {
  return cards.length > 0 ? cards[cards.length - 1].name : null;
}

/* ─── Win-prob sparkline (review screen) ────────────────────────── */

function WinProbSparkline({ curve }: { curve: NonNullable<GameReview["win_prob"]>["curve"] }) {
  if (curve.length === 0) return null;
  const width = 560;
  const height = 120;
  const padX = 8;
  const padY = 10;
  const stepX = curve.length > 1 ? (width - padX * 2) / (curve.length - 1) : 0;
  const yFor = (p: number) => padY + (1 - p) * (height - padY * 2);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Win probability by turn">
      <line x1={padX} x2={width - padX} y1={yFor(0.5)} y2={yFor(0.5)} stroke="#d0d0d0" strokeDasharray="4 4" strokeWidth="1" />
      <polyline
        points={curve.map((pt, i) => `${padX + i * stepX},${yFor(pt.p_win).toFixed(1)}`).join(" ")}
        fill="none"
        stroke="#d95555"
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ─── Main client ───────────────────────────────────────────────── */

export default function PlayClient({ decks }: { decks: DeckOption[] }) {
  const [humanDeckId, setHumanDeckId] = useState(decks[0]?.id ?? "");
  const [aiDeckId, setAiDeckId] = useState(
    decks.find((d) => d.source === "meta")?.id ?? decks[0]?.id ?? "",
  );
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]["key"]>("medium");
  const [game, setGame] = useState<PlayResponse | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [retreatMode, setRetreatMode] = useState(false);
  const [review, setReview] = useState<GameReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  const deckById = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);

  // Board width: same measurement pattern as the replay Board.
  const matContainerRef = useRef<HTMLDivElement>(null);
  const [matWidth, setMatWidth] = useState(300);
  useIsomorphicLayoutEffect(() => {
    const el = matContainerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setMatWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [game != null]);
  const cardWidth = computeReplayCardWidth(matWidth);

  const post = useCallback(async (body: Record<string, unknown>): Promise<PlayResponse> => {
    const res = await fetch("/api/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
    return payload as PlayResponse;
  }, []);

  function absorb(next: PlayResponse) {
    setGame(next);
    setPendingCardId(null);
    setRetreatMode(false);
    if (next.ai_actions.length > 0) {
      setLog((old) => [...old.slice(-30), ...next.ai_actions.map((a) => `T${a.turn} · ${a.description}`)]);
    }
  }

  async function start() {
    const human = deckById.get(humanDeckId);
    const ai = deckById.get(aiDeckId);
    if (!human || !ai) return;
    setLoading(true);
    setError(null);
    setReview(null);
    setLog([]);
    try {
      absorb(await post({ action: "start", deck_human: human.deckList, deck_ai: ai.deckList, skill: difficulty }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function sendMove(move: InteractiveMove) {
    if (!game || loading) return;
    setLoading(true);
    setError(null);
    try {
      absorb(await post({ action: "move", transcript: game.transcript, move }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function fetchReview() {
    if (!game) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/play/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: game.transcript }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? `HTTP ${res.status}`);
      setReview(payload as GameReview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  /* ── Option indexing ── */
  const options = game?.options ?? [];
  const byKind = <K extends InteractiveMove["kind"]>(kind: K) =>
    options.filter((m): m is Extract<InteractiveMove, { kind: K }> => m.kind === kind);
  const attachTargets = (cardId: string) =>
    byKind("attach").filter((m) => m.cardId === cardId).map((m) => m.targetId);
  const evolveTargets = (cardId: string) =>
    byKind("evolve").filter((m) => m.cardId === cardId).map((m) => m.targetId);
  const cardIsPlayable = (cardId: string) =>
    options.some((m) => "cardId" in m && m.cardId === cardId);
  const pendingTargets = pendingCardId
    ? new Set([...attachTargets(pendingCardId), ...evolveTargets(pendingCardId)])
    : new Set<string>();

  function handleHandClick(cardId: string) {
    if (!game || game.status !== "human_turn") return;
    const bench = byKind("bench").find((m) => m.cardId === cardId);
    if (bench) return void sendMove(bench);
    const supporter = byKind("cycle_supporter").find((m) => m.cardId === cardId);
    if (supporter) return void sendMove(supporter);
    const item = byKind("cycle_item").find((m) => m.cardId === cardId);
    if (item) return void sendMove(item);
    const targets = [...attachTargets(cardId), ...evolveTargets(cardId)];
    if (targets.length === 1) {
      const move = options.find(
        (m) => "cardId" in m && m.cardId === cardId && "targetId" in m && m.targetId === targets[0],
      );
      if (move) return void sendMove(move);
    }
    if (targets.length > 1) setPendingCardId(pendingCardId === cardId ? null : cardId);
  }

  function sendTargeted(monId: string) {
    if (!pendingCardId) return;
    const move = options.find(
      (m) => "cardId" in m && m.cardId === pendingCardId && "targetId" in m && m.targetId === monId,
    );
    if (move) void sendMove(move);
  }

  /* ── Screens ── */

  if (!game) {
    return (
      <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: "Your deck", value: humanDeckId, set: setHumanDeckId },
            { label: "Opponent deck", value: aiDeckId, set: setAiDeckId },
          ].map(({ label, value, set }) => (
            <div key={label}>
              <label className="mb-1 block text-xs font-semibold text-text-primary">{label}</label>
              <select
                value={value}
                onChange={(e) => set(e.target.value)}
                className="w-full rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs text-text-primary"
              >
                <optgroup label="My decks">
                  {decks.filter((d) => d.source === "saved").map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </optgroup>
                <optgroup label="Meta decks">
                  {decks.filter((d) => d.source === "meta").map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </optgroup>
              </select>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {DIFFICULTIES.map((d) => (
            <button
              key={d.key}
              onClick={() => setDifficulty(d.key)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                difficulty === d.key
                  ? "border border-transparent bg-black text-white"
                  : "border border-black/15 bg-white text-text-secondary"
              }`}
            >
              {d.label}
            </button>
          ))}
          <button
            onClick={start}
            disabled={loading || !humanDeckId || !aiDeckId}
            className="ml-auto rounded-lg border border-transparent bg-accent px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Setting up…" : "Start Game"}
          </button>
        </div>
        {error && <p className="mt-3 text-xs text-red-700">{error}</p>}
      </div>
    );
  }

  if (review) {
    const won = review.outcome.winner === "player";
    return (
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-text-primary">
            {won ? "Victory" : review.outcome.winner === "opponent" ? "Defeat" : "Draw"} —{" "}
            {review.features.prizes_player}–{review.features.prizes_opponent} prizes ·{" "}
            {review.features.total_turns} turns · {review.outcome.endReason}
          </h2>
          {review.win_prob && (
            <div className="mt-3">
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-xs font-semibold text-text-primary">Win probability by turn</h3>
                <span className="font-mono text-[10px] text-text-muted">{review.win_prob.model_version}</span>
              </div>
              <WinProbSparkline curve={review.win_prob.curve} />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {review.report.insights.length === 0 && (
            <p className="text-xs text-text-muted">No insights — a clean game.</p>
          )}
          {review.report.insights.map((insight, i) => (
            <div key={`${insight.code}-${i}`} className="rounded-lg border border-black/8 bg-white p-3">
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SEVERITY_STYLES[insight.severity]}`}>
                  {insight.severity}
                </span>
                {insight.turn_number !== null && (
                  <span className="text-[10px] text-text-muted">turn {insight.turn_number}</span>
                )}
                <span className="text-xs font-semibold text-text-primary">{insight.title}</span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-secondary">{insight.detail}</p>
            </div>
          ))}
        </div>
        <button
          onClick={() => { setGame(null); setReview(null); }}
          className="self-start rounded-lg border border-transparent bg-black px-3 py-1.5 text-xs font-semibold text-white"
        >
          Play Again
        </button>
      </div>
    );
  }

  const view: ClientView = game.view;
  const images = game.images;
  const attacks = byKind("attack");
  const canRetreat = byKind("retreat").length > 0;
  const promoting = game.status === "human_promotion";
  const humanActive = view.board.active ? toFrame(view.board.active, images) : null;
  const humanBench = view.board.bench.map((m) => toFrame(m, images));
  const aiActive = view.opponent.board.active ? toFrame(view.opponent.board.active, images) : null;
  const aiBench = view.opponent.board.bench.map((m) => toFrame(m, images));

  // Bench taps only act while a mode is live; otherwise the kit falls back
  // to the inspector (tap any card to zoom, same as replay).
  const benchActs = promoting || retreatMode || pendingCardId != null;
  const humanInteract = {
    onActiveClick:
      pendingCardId && view.board.active && pendingTargets.has(view.board.active.id)
        ? () => sendTargeted(view.board.active!.id)
        : undefined,
    highlightActive:
      pendingCardId != null && view.board.active != null && pendingTargets.has(view.board.active.id),
    onBenchClick: benchActs
      ? (i: number) => {
          if (promoting) return void sendMove({ kind: "promote", benchIndex: i });
          if (retreatMode) {
            const move = byKind("retreat").find((m) => m.benchIndex === i);
            if (move) return void sendMove(move);
            return;
          }
          const mon = view.board.bench[i];
          if (mon && pendingTargets.has(mon.id)) sendTargeted(mon.id);
        }
      : undefined,
    highlightBench: view.board.bench.map((mon, i) =>
      promoting ||
      (retreatMode && byKind("retreat").some((m) => m.benchIndex === i)) ||
      (pendingCardId != null && pendingTargets.has(mon.id)),
    ),
  };

  const statusLine = promoting
    ? "Choose your new Active Pokémon"
    : game.status === "human_turn"
      ? pendingCardId
        ? "Pick a target Pokémon"
        : retreatMode
          ? "Pick a benched Pokémon to retreat into"
          : "Your move"
      : game.outcome
        ? game.outcome.winner === "player"
          ? `You win! (${game.outcome.endReason})`
          : game.outcome.winner === "opponent"
            ? `You lose (${game.outcome.endReason})`
            : `Draw (${game.outcome.endReason})`
        : "";

  return (
    <InspectContext.Provider value={setInspect}>
      <div ref={matContainerRef} className="flex flex-col gap-3">
        {/* ── AI mat (top orientation: bench top, active facing the gap) ── */}
        <PlayerMat
          side="player"
          bench={aiBench}
          active={aiActive}
          discardCount={view.opponent.discard.length}
          discardTop={discardTop(view.opponent.discard)}
          discardTopImageUrl={
            discardTop(view.opponent.discard)
              ? images[discardTop(view.opponent.discard)!] ?? null
              : null
          }
          deckCount={view.opponent.deckCount}
          handCount={view.opponent.handCount}
          prizesRemaining={view.opponent.prizeCount}
          stadium={null}
          lastPlayedTrainer={null}
          cardWidth={cardWidth}
          matWidth={matWidth}
        />

        {/* ── Between-mats strip: status left, turn pill right, AI feed. ── */}
        <div className="flex flex-col gap-0.5 px-1">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-bold text-text-primary">
              {statusLine}
            </span>
            <span className="shrink-0 rounded-full bg-[#1a1a1a] px-2.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
              Turn {view.turn.number}
            </span>
          </div>
          <div className="min-h-[1.25rem] py-0.5 text-center text-xs leading-snug text-text-secondary">
            {log.length > 0 ? log[log.length - 1] : ""}
          </div>
          {error && <p className="text-center text-xs text-red-700">{error}</p>}
        </div>

        {/* ── Human mat (bottom orientation: active facing the gap) ── */}
        <PlayerMat
          side="opponent"
          bench={humanBench}
          active={humanActive}
          discardCount={view.discard.length}
          discardTop={discardTop(view.discard)}
          discardTopImageUrl={
            discardTop(view.discard) ? images[discardTop(view.discard)!] ?? null : null
          }
          deckCount={view.deckCount}
          handCount={view.hand.length}
          prizesRemaining={view.prizeCount}
          stadium={null}
          lastPlayedTrainer={null}
          cardWidth={cardWidth}
          matWidth={matWidth}
          interact={humanInteract}
        />

        {/* ── Hand + actions ── */}
        {game.status !== "over" ? (
          <div className="rounded-2xl border border-black/8 bg-white p-3 shadow-sm">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                Hand · {view.hand.length}
              </span>
              {(pendingCardId || retreatMode) && (
                <button
                  onClick={() => {
                    setPendingCardId(null);
                    setRetreatMode(false);
                  }}
                  className="text-[10px] font-semibold text-accent"
                >
                  cancel
                </button>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {view.hand.map((card) => {
                const playable = game.status === "human_turn" && cardIsPlayable(card.id);
                const image = images[card.name];
                return (
                  <button
                    key={card.id}
                    onClick={() =>
                      playable
                        ? handleHandClick(card.id)
                        : setInspect({ kind: "card", name: card.name, imageUrl: image ?? null })
                    }
                    disabled={loading}
                    className={`w-16 shrink-0 sm:w-20 ${playable ? "" : "opacity-45"} ${
                      pendingCardId === card.id ? "rounded-md ring-2 ring-accent" : ""
                    }`}
                    title={card.name}
                  >
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt={card.name} className="w-full rounded-md shadow-sm" />
                    ) : (
                      <div className="relative w-full overflow-hidden rounded-md" style={{ aspectRatio: "245 / 342" }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={CARD_BACK_URL} alt="" className="h-full w-full object-cover" />
                        <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[8px] font-semibold leading-tight text-white line-clamp-2">
                          {card.name}
                        </div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-black/8 pt-2">
              {attacks.map((m) => {
                const attack = view.board.active?.attacks[m.attackIndex];
                return (
                  <button
                    key={m.attackIndex}
                    onClick={() => sendMove(m)}
                    disabled={loading}
                    className="rounded-lg border border-transparent bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {attack?.name ?? "Attack"}
                    {attack?.damage ? ` · ${attack.damage}` : ""}
                  </button>
                );
              })}
              {canRetreat && (
                <button
                  onClick={() => {
                    setRetreatMode(!retreatMode);
                    setPendingCardId(null);
                  }}
                  disabled={loading}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    retreatMode
                      ? "border border-transparent bg-accent text-white"
                      : "border border-black/15 bg-white text-text-secondary"
                  }`}
                >
                  Retreat
                </button>
              )}
              {game.status === "human_turn" && (
                <button
                  onClick={() => sendMove({ kind: "pass" })}
                  disabled={loading}
                  className="ml-auto rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary disabled:opacity-50"
                >
                  End Turn
                </button>
              )}
              {loading && <span className="text-[10px] text-text-muted">…</span>}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-2xl border border-black/8 bg-white p-3 shadow-sm">
            <button
              onClick={fetchReview}
              disabled={loading}
              className="rounded-lg border border-transparent bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Analyzing…" : "Game Review"}
            </button>
            <button
              onClick={() => setGame(null)}
              className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary"
            >
              New Game
            </button>
          </div>
        )}
      </div>
      {inspect && <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />}
    </InspectContext.Provider>
  );
}
