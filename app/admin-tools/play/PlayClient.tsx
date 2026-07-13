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
import { trainerDiscardCostByName } from "@/lib/engine/sim";
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
  /** Search-picker modal (deck/discard fetch choices for one trainer). */
  const [pickerMoves, setPickerMoves] = useState<InteractiveMove[] | null>(null);
  /** Boss's Orders: pick the AI's benched Pokémon to drag active. */
  const [bossMoves, setBossMoves] = useState<InteractiveMove[] | null>(null);
  /** Switch etc.: pick one of our benched Pokémon. */
  const [benchPickMoves, setBenchPickMoves] = useState<InteractiveMove[] | null>(null);
  /** Discard-cost stage (Ultra Ball): the chosen fetch move + running picks. */
  const [discardStage, setDiscardStage] = useState<{
    move: Extract<InteractiveMove, { kind: "play_trainer" }>;
    need: number;
    picked: string[];
  } | null>(null);
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
    setPickerMoves(null);
    setBossMoves(null);
    setBenchPickMoves(null);
    setDiscardStage(null);
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
  const trainerMovesFor = (cardId: string) =>
    options.filter(
      (m): m is Extract<InteractiveMove, { kind: "play_trainer" }> =>
        m.kind === "play_trainer" && m.cardId === cardId,
    );
  // Board targets for the selected hand card: attach/evolve targetIds plus
  // trainer monIds (Rare Candy's basic, Crispin's attach target).
  const pendingTargets = pendingCardId
    ? new Set([
        ...attachTargets(pendingCardId),
        ...evolveTargets(pendingCardId),
        ...trainerMovesFor(pendingCardId)
          .map((m) => m.monId)
          .filter((id): id is string => id != null),
      ])
    : new Set<string>();

  function handleHandClick(cardId: string) {
    if (!game || game.status !== "human_turn") return;
    const bench = byKind("bench").find((m) => m.cardId === cardId);
    if (bench) return void sendMove(bench);
    const supporter = byKind("cycle_supporter").find((m) => m.cardId === cardId);
    if (supporter) return void sendMove(supporter);
    const item = byKind("cycle_item").find((m) => m.cardId === cardId);
    if (item) return void sendMove(item);

    // Staple trainers: route by what the moves need.
    const trainers = trainerMovesFor(cardId);
    if (trainers.length > 0) {
      const first = trainers[0];
      if (first.deckCardIds || first.discardPickId) {
        return void setPickerMoves(trainers); // search picker modal
      }
      if (first.oppBenchIndex != null) return void setBossMoves(trainers);
      if (first.benchIndex != null) return void setBenchPickMoves(trainers);
      if (first.monId != null) {
        if (trainers.length === 1) return void sendMove(first);
        return void setPendingCardId(pendingCardId === cardId ? null : cardId);
      }
      return void sendMove(first); // no choices (Iono, Research, …)
    }

    const targets = [...attachTargets(cardId), ...evolveTargets(cardId)];
    if (targets.length === 1) {
      const move = options.find(
        (m) => "cardId" in m && m.cardId === cardId && "targetId" in m && m.targetId === targets[0],
      );
      if (move) return void sendMove(move);
    }
    if (targets.length > 1) setPendingCardId(pendingCardId === cardId ? null : cardId);
  }

  // Search-picker choice: if the trainer also has a discard cost (Ultra
  // Ball), advance to the discard stage instead of sending immediately.
  function choosePickerMove(m: InteractiveMove) {
    if (m.kind !== "play_trainer" || !game) return;
    const card = game.view.hand.find((c) => c.id === m.cardId);
    const need = card ? trainerDiscardCostByName(card.name) : 0;
    if (need > 0) {
      setPickerMoves(null);
      setDiscardStage({ move: m, need, picked: [] });
      return;
    }
    void sendMove(m);
  }

  function toggleDiscard(cardId: string) {
    setDiscardStage((st) => {
      if (!st) return st;
      if (st.picked.includes(cardId)) {
        return { ...st, picked: st.picked.filter((id) => id !== cardId) };
      }
      if (st.picked.length >= st.need) return st;
      return { ...st, picked: [...st.picked, cardId] };
    });
  }

  function sendTargeted(monId: string) {
    if (!pendingCardId) return;
    const move =
      options.find(
        (m) => "cardId" in m && m.cardId === pendingCardId && "targetId" in m && m.targetId === monId,
      ) ?? trainerMovesFor(pendingCardId).find((m) => m.monId === monId);
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
  const stadiumCard = view.stadium
    ? { name: view.stadium.name, imageUrl: images[view.stadium.name] ?? null }
    : null;
  // The stadium sits on its owner's mat (AI = top, human = bottom).
  const aiStadium = view.stadium?.owner === "opponent" ? stadiumCard : null;
  const humanStadium = view.stadium?.owner === "player" ? stadiumCard : null;

  // Bench taps only act while a mode is live; otherwise the kit falls back
  // to the inspector (tap any card to zoom, same as replay).
  const benchActs = promoting || retreatMode || pendingCardId != null || benchPickMoves != null;
  const benchPickIndex = (i: number) =>
    benchPickMoves?.find((m) => m.kind === "play_trainer" && m.benchIndex === i);
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
          if (benchPickMoves) {
            const move = benchPickIndex(i);
            if (move) return void sendMove(move);
            return;
          }
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
      benchPickIndex(i) != null ||
      (retreatMode && byKind("retreat").some((m) => m.benchIndex === i)) ||
      (pendingCardId != null && pendingTargets.has(mon.id)),
    ),
  };

  // Boss's Orders: the AI's bench becomes the target surface.
  const bossIndex = (i: number) =>
    bossMoves?.find((m) => m.kind === "play_trainer" && m.oppBenchIndex === i);
  const aiInteract = bossMoves
    ? {
        onBenchClick: (i: number) => {
          const move = bossIndex(i);
          if (move) void sendMove(move);
        },
        highlightBench: view.opponent.board.bench.map((_, i) => bossIndex(i) != null),
      }
    : undefined;

  const statusLine = promoting
    ? "Choose your new Active Pokémon"
    : game.status === "human_turn"
      ? bossMoves
        ? "Pick the opponent's benched Pokémon to drag active"
        : benchPickMoves
          ? "Pick a benched Pokémon"
          : pendingCardId
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
          stadium={aiStadium}
          lastPlayedTrainer={null}
          cardWidth={cardWidth}
          matWidth={matWidth}
          interact={aiInteract}
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
          stadium={humanStadium}
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
              {(pendingCardId || retreatMode || bossMoves || benchPickMoves) && (
                <button
                  onClick={() => {
                    setPendingCardId(null);
                    setRetreatMode(false);
                    setBossMoves(null);
                    setBenchPickMoves(null);
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
                      <img
                        src={image}
                        alt={card.name}
                        className="w-full rounded-md shadow-sm"
                        onError={(e) => {
                          if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
                        }}
                      />
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
      {/* Search picker — choose what a trainer fetches (deck or discard). */}
      {pickerMoves && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: "rgba(242,242,242,0.92)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Choose a card to fetch"
          onClick={() => setPickerMoves(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">Choose what to fetch</span>
              <button
                onClick={() => setPickerMoves(null)}
                className="text-[10px] font-semibold text-accent"
              >
                cancel
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {pickerMoves.map((m, i) => {
                if (m.kind !== "play_trainer") return null;
                const names = m.deckCardNames ?? (m.discardPickName ? [m.discardPickName] : []);
                return (
                  <button
                    key={i}
                    onClick={() => choosePickerMove(m)}
                    disabled={loading}
                    className="flex flex-col items-center gap-1 rounded-lg border border-black/8 p-1.5 hover:border-accent disabled:opacity-50"
                  >
                    <div className="flex w-full justify-center gap-1">
                      {names.map((n, j) => {
                        const img = images[n];
                        return img ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img key={j} src={img} alt={n} className="w-full min-w-0 rounded-md shadow-sm" style={{ maxWidth: names.length > 1 ? "48%" : "100%" }} />
                        ) : (
                          <div key={j} className="flex aspect-[5/7] w-full items-center justify-center rounded-md border border-black/15 bg-surface p-1 text-center text-[8px] font-semibold text-text-secondary">
                            {n}
                          </div>
                        );
                      })}
                    </div>
                    <span className="line-clamp-2 text-center text-[9px] font-semibold leading-tight text-text-secondary">
                      {names.join(" + ")}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Discard-cost stage (Ultra Ball): choose exactly N cards to discard. */}
      {discardStage && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: "rgba(242,242,242,0.92)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Choose cards to discard"
          onClick={() => setDiscardStage(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">
                Discard {discardStage.need} — chosen {discardStage.picked.length}/{discardStage.need}
              </span>
              <button onClick={() => setDiscardStage(null)} className="text-[10px] font-semibold text-accent">
                cancel
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {view.hand
                .filter((c) => c.id !== discardStage.move.cardId)
                .map((card) => {
                  const chosen = discardStage.picked.includes(card.id);
                  const image = images[card.name];
                  return (
                    <button
                      key={card.id}
                      onClick={() => toggleDiscard(card.id)}
                      className={`overflow-hidden rounded-md ${chosen ? "ring-2 ring-accent" : "opacity-80"}`}
                      title={card.name}
                    >
                      {image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image}
                          alt={card.name}
                          className="w-full"
                          onError={(e) => {
                            if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
                          }}
                        />
                      ) : (
                        <div className="flex aspect-[5/7] items-center justify-center bg-surface p-1 text-center text-[8px] font-semibold text-text-secondary">
                          {card.name}
                        </div>
                      )}
                    </button>
                  );
                })}
            </div>
            <button
              onClick={() => sendMove({ ...discardStage.move, discardCardIds: discardStage.picked })}
              disabled={discardStage.picked.length !== discardStage.need || loading}
              className="mt-3 w-full rounded-lg border border-transparent bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Confirm discard &amp; play
            </button>
          </div>
        </div>
      )}
      {inspect && <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />}
    </InspectContext.Provider>
  );
}
