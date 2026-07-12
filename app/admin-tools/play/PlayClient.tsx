"use client";

import { useCallback, useMemo, useState } from "react";
import type { PlayResponse } from "@/app/api/play/route";
import type { ClientMon, InteractiveMove } from "@/lib/engine/sim";
import type { GameReview } from "@/lib/ml/gameReview";
import type { DeckOption } from "./page";

/* ─── Small shared bits ─────────────────────────────────────────── */

const ENERGY_COLORS: Record<string, string> = {
  Grass: "bg-green-500",
  Fire: "bg-red-500",
  Water: "bg-blue-500",
  Lightning: "bg-yellow-400",
  Psychic: "bg-purple-500",
  Fighting: "bg-orange-600",
  Darkness: "bg-gray-800",
  Metal: "bg-gray-400",
  Fairy: "bg-pink-400",
  Colorless: "bg-gray-300",
};

const SEVERITY_STYLES: Record<string, string> = {
  warning: "bg-red-100 text-red-800",
  suggestion: "bg-yellow-100 text-yellow-800",
  info: "bg-surface text-text-secondary",
};

const DIFFICULTIES = [
  { key: "easy", label: "Easy", skill: 0.15 },
  { key: "medium", label: "Medium", skill: 0.55 },
  { key: "hard", label: "Hard", skill: 0.95 },
] as const;

function EnergyPips({ types }: { types: string[] }) {
  if (types.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-0.5">
      {types.map((t, i) => (
        <span
          key={i}
          title={t}
          className={`inline-block h-2.5 w-2.5 rounded-full border border-black/20 ${ENERGY_COLORS[t] ?? "bg-gray-300"}`}
        />
      ))}
    </span>
  );
}

/* ─── Board card tiles ──────────────────────────────────────────── */

function MonTile({
  mon,
  image,
  size,
  highlight,
  onClick,
  facing,
}: {
  mon: ClientMon;
  image: string | null;
  size: "active" | "bench";
  highlight?: boolean;
  onClick?: () => void;
  facing: "up" | "down";
}) {
  const width = size === "active" ? "w-24 sm:w-28" : "w-16 sm:w-20";
  const hpLeft = mon.hp !== null ? Math.max(0, mon.hp - mon.damage) : null;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      className={`relative ${width} shrink-0 text-left ${onClick ? "cursor-pointer" : "cursor-default"} ${
        highlight ? "ring-2 ring-accent rounded-lg" : ""
      }`}
    >
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={image}
          alt={mon.name}
          className={`w-full rounded-lg shadow-sm ${facing === "down" ? "rotate-180" : ""}`}
        />
      ) : (
        <div className="flex aspect-[5/7] w-full items-center justify-center rounded-lg border border-black/15 bg-surface p-1 text-center text-[9px] font-semibold text-text-secondary">
          {mon.name}
        </div>
      )}
      {mon.damage > 0 && (
        <span className="absolute -top-1 -right-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow">
          -{mon.damage}
        </span>
      )}
      <div className="mt-0.5 flex items-center justify-between gap-1">
        <EnergyPips types={mon.energyTypes} />
        {hpLeft !== null && (
          <span className="text-[9px] font-semibold text-text-muted">{hpLeft}hp</span>
        )}
      </div>
    </button>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="rounded-full bg-surface px-2 py-0.5 text-[10px] text-text-secondary">
      {label} <span className="font-semibold text-text-primary">{value}</span>
    </span>
  );
}

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
  const [aiDeckId, setAiDeckId] = useState(decks.find((d) => d.source === "meta")?.id ?? decks[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]["key"]>("medium");
  const [game, setGame] = useState<PlayResponse | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [pendingCardId, setPendingCardId] = useState<string | null>(null);
  const [retreatMode, setRetreatMode] = useState(false);
  const [review, setReview] = useState<GameReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deckById = useMemo(() => new Map(decks.map((d) => [d.id, d])), [decks]);

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
      const move = options.find((m) => "cardId" in m && m.cardId === cardId && "targetId" in m && m.targetId === targets[0]);
      if (move) return void sendMove(move);
    }
    if (targets.length > 1) setPendingCardId(pendingCardId === cardId ? null : cardId);
  }

  function handleOwnMonClick(monId: string, benchIndex: number | null) {
    if (!game) return;
    if (game.status === "human_promotion" && benchIndex !== null) {
      return void sendMove({ kind: "promote", benchIndex });
    }
    if (retreatMode && benchIndex !== null) {
      const move = byKind("retreat").find((m) => m.benchIndex === benchIndex);
      if (move) return void sendMove(move);
    }
    if (pendingCardId && pendingTargets.has(monId)) {
      const move = options.find(
        (m) => "cardId" in m && m.cardId === pendingCardId && "targetId" in m && m.targetId === monId,
      );
      if (move) return void sendMove(move);
    }
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

  const view = game.view;
  const images = game.images;
  const attacks = byKind("attack");
  const canRetreat = byKind("retreat").length > 0;

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

  return (
    <div className="flex flex-col gap-3">
      {/* Opponent zone */}
      <div className="rounded-2xl border border-black/8 bg-white p-3 shadow-sm">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary">Opponent</span>
          <CountChip label="hand" value={view.opponent.handCount} />
          <CountChip label="deck" value={view.opponent.deckCount} />
          <CountChip label="prizes left" value={view.opponent.prizeCount} />
          <CountChip label="taken" value={view.opponent.prizesTaken} />
        </div>
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {view.opponent.board.active && (
            <MonTile mon={view.opponent.board.active} image={images[view.opponent.board.active.name] ?? null} size="active" facing="down" />
          )}
          <div className="flex gap-1.5">
            {view.opponent.board.bench.map((mon) => (
              <MonTile key={mon.id} mon={mon} image={images[mon.name] ?? null} size="bench" facing="down" />
            ))}
          </div>
        </div>
      </div>

      {/* Status bar + AI feed */}
      <div className="rounded-2xl border border-black/8 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-primary">
            Turn {view.turn.number} ·{" "}
            {game.status === "human_turn"
              ? "your move"
              : game.status === "human_promotion"
                ? "choose your new Active"
                : "game over"}
          </span>
          {game.outcome && (
            <span className={`text-xs font-bold ${game.outcome.winner === "player" ? "text-green-700" : "text-red-700"}`}>
              {game.outcome.winner === "player" ? "You win!" : game.outcome.winner === "opponent" ? "You lose" : "Draw"} ({game.outcome.endReason})
            </span>
          )}
        </div>
        {log.length > 0 && (
          <ul className="mt-1.5 max-h-24 overflow-y-auto text-[11px] leading-relaxed text-text-secondary">
            {log.slice(-8).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        )}
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>

      {/* Own zone */}
      <div className={`rounded-2xl border p-3 shadow-sm ${game.status === "human_promotion" ? "border-accent bg-red-50" : "border-black/8 bg-white"}`}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary">You</span>
          <CountChip label="deck" value={view.deckCount} />
          <CountChip label="prizes left" value={view.prizeCount} />
          <CountChip label="taken" value={view.prizesTaken} />
          <CountChip label="discard" value={view.discard.length} />
        </div>
        <div className="flex items-end gap-2 overflow-x-auto pb-1">
          {view.board.active && (
            <div className="flex shrink-0 flex-col gap-1">
              <MonTile
                mon={view.board.active}
                image={images[view.board.active.name] ?? null}
                size="active"
                facing="up"
                highlight={pendingTargets.has(view.board.active.id)}
                onClick={
                  pendingTargets.has(view.board.active.id)
                    ? () => handleOwnMonClick(view.board.active!.id, null)
                    : undefined
                }
              />
              {attacks.map((m) => {
                const attack = view.board.active!.attacks[m.attackIndex];
                return (
                  <button
                    key={m.attackIndex}
                    onClick={() => sendMove(m)}
                    disabled={loading}
                    className="rounded-lg border border-transparent bg-black px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50"
                  >
                    {attack?.name ?? "Attack"} {attack?.damage ? `· ${attack.damage}` : ""}
                  </button>
                );
              })}
            </div>
          )}
          <div className="flex gap-1.5">
            {view.board.bench.map((mon, i) => (
              <MonTile
                key={mon.id}
                mon={mon}
                image={images[mon.name] ?? null}
                size="bench"
                facing="up"
                highlight={
                  game.status === "human_promotion" || retreatMode || pendingTargets.has(mon.id)
                }
                onClick={() => handleOwnMonClick(mon.id, i)}
              />
            ))}
          </div>
        </div>

        {/* Hand */}
        {game.status !== "over" && (
          <div className="mt-2 border-t border-black/8 pt-2">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Hand</span>
              {pendingCardId && (
                <span className="text-[10px] text-accent">pick a target Pokémon…</span>
              )}
              {retreatMode && <span className="text-[10px] text-accent">pick a benched Pokémon…</span>}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {view.hand.map((card) => {
                const playable = game.status === "human_turn" && cardIsPlayable(card.id);
                const image = images[card.name];
                return (
                  <button
                    key={card.id}
                    onClick={() => handleHandClick(card.id)}
                    disabled={!playable || loading}
                    className={`w-14 shrink-0 sm:w-16 ${playable ? "" : "opacity-45"} ${
                      pendingCardId === card.id ? "ring-2 ring-accent rounded-lg" : ""
                    }`}
                    title={card.name}
                  >
                    {image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={image} alt={card.name} className="w-full rounded-md shadow-sm" />
                    ) : (
                      <div className="flex aspect-[5/7] w-full items-center justify-center rounded-md border border-black/15 bg-surface p-1 text-center text-[8px] font-semibold text-text-secondary">
                        {card.name}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex items-center gap-2">
              {canRetreat && (
                <button
                  onClick={() => setRetreatMode(!retreatMode)}
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
            </div>
          </div>
        )}

        {/* Game over actions */}
        {game.status === "over" && (
          <div className="mt-2 flex items-center gap-2 border-t border-black/8 pt-2">
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
    </div>
  );
}
