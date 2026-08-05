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

/** A universal declarative-effect move (W2). Carries `sourceId` (the hand card)
 *  and `picks` with display names, so the UI can label choices generically. */
type EffectMove = Extract<InteractiveMove, { kind: "effect" }>;
/** The display-name half of an EffectPick — all this UI needs from a pick. */
type EffectPickLike = { cardNames?: string[]; monNames?: string[] };
// Import the value directly from its leaf module rather than the
// "@/lib/engine/sim" barrel — the barrel also re-exports interactive.ts
// and planner.ts, which transitively pull in lib/ml/botEvaluator.ts
// (a server-only module reading the trained model off disk via node:fs
// / node:path). Importing anything from the barrel drags that whole
// module graph into this client bundle and webpack can't handle the
// node: scheme in the browser build.
import { trainerDiscardCostByName } from "@/lib/engine/sim/trainers";
import { stadiumHandCost, stadiumTopDecks } from "@/lib/engine/sim/stadiums";
import { attackRiderDiscardCost, effectOwnHandTrimTo } from "@/lib/engine/sim/effects/cards";
import { effectAbilityName, effectDiscardCost, effectDiscardFilter } from "@/lib/engine/sim/effects/cards";
import { cardMatches } from "@/lib/engine/sim/effects/match";
import { lookupCard } from "@/lib/engine/catalog";
import type { CardFilter } from "@/lib/engine/sim/effects/types";
import { activatedHandDiscard } from "@/lib/engine/sim/abilities";
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
    conditions: mon.conditions,
    evolutionStack: mon.stack,
    imageUrl: images[mon.name] ?? null,
    tools: mon.tools.map((t) => ({ name: t, imageUrl: images[t] ?? null })),
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
  /** Declarative-effect card with more than one enumerated option (e.g. which
   *  card to fetch / which Pokémon to target) — a generic chooser driven by
   *  the moves' pick display names. */
  const [effectChooser, setEffectChooser] = useState<{
    label: string;
    moves: InteractiveMove[];
  } | null>(null);
  /** Discard-cost stage (Ultra Ball): the chosen fetch move + running picks. */
  /** Discard-cost stage. Accepts BOTH a legacy trainer (Ultra Ball) and a
   *  declarative effect (Secret Box) — the latter reported a cost of 0 via
   *  `trainerDiscardCostByName`, which only reads the legacy registry, so no
   *  prompt appeared and the op silently auto-picked the player's cards. */
  const [discardStage, setDiscardStage] = useState<{
    move: Extract<
      InteractiveMove,
      { kind: "play_trainer" | "effect" | "use_ability" | "use_stadium" | "attack" }
    >;
    need: number;
    picked: string[];
    /** Restricts which hand cards may pay (Lunatone's Fighting Energy). */
    filter?: CardFilter | null;
    /** What happens to the chosen cards. Not every hand choice is a discard —
     *  Academy at Night puts one on TOP OF YOUR DECK, and calling that
     *  "discard" would be a lie the player acts on. */
    verb?: string;
  } | null>(null);
  /** Ability targeting: chosen ability's legal moves, awaiting an opponent
   *  target tap (Munkidori, Dusknoir). */
  const [abilityTargeting, setAbilityTargeting] = useState<{
    label: string;
    moves: Extract<InteractiveMove, { kind: "use_ability" }>[];
  } | null>(null);
  /** Counter-placement mode: an attack that drops N counters on the AI's
   *  bench, placed one tap at a time. */
  const [counterPlace, setCounterPlace] = useState<{
    attackIndex: number;
    total: number;
    placed: string[];
  } | null>(null);
  /** Own-Pokémon target chooser (attach energy, evolve, Crispin, Rare
   *  Candy) — an explicit list so targeting never depends on board taps. */
  const [ownTargetChooser, setOwnTargetChooser] = useState<{
    label: string;
    /** `moves` holds every move for that target — normally one, but more when
     *  an on-attach trigger adds `attachPicks`, which is then a second choice. */
    choices: { move: InteractiveMove; monId: string; moves?: InteractiveMove[] }[];
  } | null>(null);
  /** Tapping one of YOUR OWN Pokémon opens its attacks + abilities. The
   *  action bar has always carried these, but nothing happened when you
   *  tapped the Pokémon itself — it fell through to the card inspector — so
   *  they read as missing, and a benched Pokémon's ability in a shared bar
   *  gives no clue which Pokémon it belongs to. */
  const [monPanel, setMonPanel] = useState<string | null>(null);
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
    setAbilityTargeting(null);
    setCounterPlace(null);
    setOwnTargetChooser(null);
    setEffectChooser(null);
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
    options.some(
      (m) =>
        ("cardId" in m && m.cardId === cardId) ||
        (m.kind === "effect" && m.sourceId === cardId),
    );
  /** Declarative-effect moves sourced from a given hand card. */
  const effectMovesFor = (cardId: string) =>
    options.filter((m): m is EffectMove => m.kind === "effect" && m.sourceId === cardId);
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

  /** Open the own-Pokémon target chooser. `alwaysAsk` forces the picker
   *  even for a single candidate (energy attach, so the target is always an
   *  explicit choice). */
  function chooseOwnTarget(
    label: string,
    choices: { move: InteractiveMove; monId: string }[],
    alwaysAsk = false,
  ) {
    if (choices.length === 0) return;
    // Several moves may share a target and differ only in `attachPicks` (an
    // on-attach trigger). Collapse to one entry per target so the target
    // picker isn't showing the same Pokémon twice, then resolve the pick.
    const byMon = new Map<string, InteractiveMove[]>();
    for (const c of choices) {
      const list = byMon.get(c.monId) ?? [];
      list.push(c.move);
      byMon.set(c.monId, list);
    }
    const unique = Array.from(byMon, ([monId, moves]) => ({ monId, moves }));
    if (unique.length === 1 && !alwaysAsk) {
      return void sendOrChoose(label, unique[0].moves);
    }
    setOwnTargetChooser({
      label,
      choices: unique.map(({ monId, moves }) => ({ monId, move: moves[0], moves })),
    });
  }

  /** Display names carried by ANY pick-bearing move.
   *
   *  W2 gave declarative trainers `picks`; W3 then added the same shape to
   *  four more places — `triggerPicks` (on-play / on-evolve), `attachPicks`
   *  (on-attach) and `riderPicks` (attack riders). The UI only ever read
   *  `picks`, so those choices were enumerated by the engine, offered to the
   *  AI, and silently dropped for the human. One accessor for all of them. */
  function pickNamesOf(m: InteractiveMove): string[] {
    const groups = [
      (m as { picks?: EffectPickLike[] }).picks,
      (m as { triggerPicks?: EffectPickLike[] }).triggerPicks,
      (m as { attachPicks?: EffectPickLike[] }).attachPicks,
      (m as { riderPicks?: EffectPickLike[] }).riderPicks,
    ];
    const out: string[] = [];
    for (const g of groups) {
      for (const p of g ?? []) out.push(...(p.cardNames ?? []), ...(p.monNames ?? []));
    }
    // Legacy trainers that target SEVERAL of our own Pokémon at once
    // (Janine's Secret Art) carry board ids rather than picks; resolve them
    // to names so the same chooser can render them.
    for (const id of (m as { monIds?: string[] }).monIds ?? []) {
      const mon = inPlayById(id);
      if (mon) out.push(mon.name);
    }
    return out;
  }

  /** Send when there's nothing to decide, otherwise let the human choose. */
  function sendOrChoose(label: string, moves: InteractiveMove[]) {
    if (moves.length === 0) return;
    if (moves.length === 1) return void sendMove(moves[0]);
    setEffectChooser({ label, moves });
  }

  /** Does a card NAME satisfy a CardFilter? The client view carries no
   *  catalog (it is the redacted information set), so hydrate from the shared
   *  card catalog to run the same matcher the engine uses — otherwise the UI
   *  would offer cards the validator then rejects. */
  function matchesFilter(name: string, filter: CardFilter): boolean {
    const catalog = lookupCard(name);
    if (!catalog) return false;
    return cardMatches({ id: name, name, catalog }, filter);
  }

  /** One of your own Pokémon by id, Active or Benched. */
  function inPlayById(id: string): ClientMon | undefined {
    return view.board.active?.id === id
      ? view.board.active
      : view.board.bench.find((m) => m.id === id);
  }

  /** The card PAYING a discard cost, which must not be discardable itself.
   *  A trainer pays with `cardId`, a declarative effect with `sourceId`, and
   *  an ability with neither — it is a Pokémon in play, not a hand card. */
  function discardCostSourceId(m: InteractiveMove): string | null {
    if (m.kind === "effect") return m.sourceId;
    if (m.kind === "play_trainer") return m.cardId;
    return null;
  }

  function handleHandClick(cardId: string) {
    if (!game) return;
    // Opening board: tapping a Basic places it, Active first then the Bench.
    if (game.status === "human_setup") {
      const place = options.find(
        (m) => (m.kind === "setup_active" || m.kind === "setup_bench") && m.cardId === cardId,
      );
      if (place) void sendMove(place);
      return;
    }
    if (game.status !== "human_turn") return;
    const card = view.hand.find((c) => c.id === cardId);
    // Bench. Several bench moves for one card differ only in `triggerPicks`
    // (Meowth ex's Last-Ditch Catch and friends) — that is the human's choice
    // to make, and taking `.find()` threw it away.
    const benchMoves = byKind("bench").filter((m) => m.cardId === cardId);
    if (benchMoves.length > 0) {
      return void sendOrChoose(card?.name ?? "Bench", benchMoves);
    }
    const stadium = byKind("play_stadium").find((m) => m.cardId === cardId);
    if (stadium) return void sendMove(stadium);
    const supporter = byKind("cycle_supporter").find((m) => m.cardId === cardId);
    if (supporter) return void sendMove(supporter);
    const item = byKind("cycle_item").find((m) => m.cardId === cardId);
    if (item) return void sendMove(item);

    // Staple trainers: route by what the moves need.
    const trainers = trainerMovesFor(cardId);
    if (trainers.length > 0) {
      const first = trainers[0];
      // N's PP Up: choose a discard-pile Energy, then a Benched target.
      if (first.discardPickId != null && first.monId != null) {
        const energyKeys = Array.from(
          new Set(trainers.map((m) => m.discardPickName ?? m.discardPickId!)),
        );
        if (energyKeys.length <= 1) {
          // Single Energy type ⇒ skip straight to the target chooser.
          return void chooseOwnTarget(
            card?.name ?? "Attach",
            trainers.map((m) => ({ move: m as InteractiveMove, monId: m.monId! })),
          );
        }
        const reps = energyKeys.map(
          (k) => trainers.find((m) => (m.discardPickName ?? m.discardPickId) === k)!,
        );
        return void setPickerMoves(reps); // stage 1: pick which Energy
      }
      // Crispin: stage 1 picks the Energy split (which type attaches, which
      // goes to hand), stage 2 picks who it attaches to. Same two-stage shape
      // as N's PP Up, keyed on distinct fields so routing stays unambiguous.
      if (first.attachCardId != null && first.monId != null) {
        const splits = new Map<string, typeof trainers>();
        for (const m of trainers) {
          const key = `${m.attachCardName}->${m.toHandCardName ?? ""}`;
          splits.set(key, [...(splits.get(key) ?? []), m]);
        }
        if (splits.size <= 1) {
          return void chooseOwnTarget(
            card?.name ?? "Attach",
            trainers.map((m) => ({ move: m as InteractiveMove, monId: m.monId! })),
          );
        }
        return void setPickerMoves(Array.from(splits.values(), (ms) => ms[0]));
      }
      if (first.deckCardIds || first.discardPickId) {
        return void setPickerMoves(trainers); // search picker modal
      }
      if (first.oppBenchIndex != null || first.oppMonId != null) {
        return void setBossMoves(trainers); // pick an opponent Pokémon
      }
      if (first.benchIndex != null) return void setBenchPickMoves(trainers);
      if (first.monIds != null) {
        // Janine's Secret Art: which one or two of our Darkness Pokémon.
        // Each option names its whole target set, because "both, and Poison
        // my own Active" is a different decision from "just the Benched one".
        return void sendOrChoose(card?.name ?? "Play", trainers);
      }
      if (first.monId != null) {
        // Crispin / Rare Candy: pick which own Pokémon.
        return void chooseOwnTarget(
          card?.name ?? "Play",
          trainers
            .filter((m) => m.monId != null)
            .map((m) => ({ move: m as InteractiveMove, monId: m.monId! })),
        );
      }
      return void sendMove(first); // no choices (Iono, Research, …)
    }

    // Declarative-effect cards (Team Rocket's Transceiver, …). One enumerated
    // option ⇒ play it; several ⇒ a generic chooser over the picks.
    const effectMoves = effectMovesFor(cardId);
    if (effectMoves.length > 0) {
      // "Discard down to N" (Hand Trimmer). The count depends on the hand
      // rather than the card, so it is computed here — but which cards go is
      // still the player's, and the op reads the same discardCardIds channel.
      const trimTo = effectOwnHandTrimTo(effectMoves[0].card, effectMoves[0].effectIndex);
      if (trimTo != null) {
        // The card being played leaves the hand first, so it is not counted.
        const need = Math.max(0, view.hand.length - 1 - trimTo);
        if (need > 0) {
          return void setDiscardStage({ move: effectMoves[0], need, picked: [] });
        }
      }
      const cost = effectDiscardCost(effectMoves[0].card, effectMoves[0].effectIndex);
      if (cost > 0) {
        // Pay the cost first, exactly like Ultra Ball. The op auto-picks when
        // no explicit choice is supplied, which is right for the AI and wrong
        // for a human — "discard 3 cards" is the player's decision.
        return void setDiscardStage({
          move: effectMoves[0],
          need: cost,
          picked: [],
          filter: effectDiscardFilter(effectMoves[0].card, effectMoves[0].effectIndex),
        });
      }
      if (effectMoves.length === 1) return void sendMove(effectMoves[0]);
      return void setEffectChooser({ label: card?.name ?? "Play", moves: effectMoves });
    }

    // Attach energy / evolve / attach a Tool: choose which of your Pokémon
    // via an explicit list (never depends on board taps).
    const targeted = options.filter(
      (m): m is Extract<InteractiveMove, { kind: "attach" | "evolve" | "attach_tool" }> =>
        (m.kind === "attach" || m.kind === "evolve" || m.kind === "attach_tool") &&
        m.cardId === cardId,
    );
    if (targeted.length > 0) {
      const isAttach = targeted[0].kind === "attach";
      const verb = isAttach
        ? `Attach ${card?.name ?? "Energy"}`
        : targeted[0].kind === "attach_tool"
          ? `Attach ${card?.name ?? "Tool"}`
          : `Evolve into ${card?.name ?? ""}`;
      // Energy attach always asks (target is an explicit choice, even with
      // a single Pokémon in play).
      return void chooseOwnTarget(
        verb,
        targeted.map((m) => ({ move: m, monId: m.targetId })),
        isAttach,
      );
    }
  }

  // Search-picker choice: if the trainer also has a discard cost (Ultra
  // Ball), advance to the discard stage instead of sending immediately.
  function choosePickerMove(m: InteractiveMove) {
    if (!game) return;
    // Stadium search (Artazon) has no discard cost — send directly.
    if (m.kind === "play_trainer") {
      const card = game.view.hand.find((c) => c.id === m.cardId);
      const need = card ? trainerDiscardCostByName(card.name) : 0;
      if (need > 0) {
        setPickerMoves(null);
        setDiscardStage({ move: m, need, picked: [] });
        return;
      }
      // Crispin stage 2: the chosen Energy split still needs a target.
      if (m.attachCardId != null && m.monId != null) {
        const targets = trainerMovesFor(m.cardId).filter(
          (x) => x.attachCardId === m.attachCardId && x.toHandCardId === m.toHandCardId,
        );
        setPickerMoves(null);
        chooseOwnTarget(
          `Attach ${m.attachCardName ?? "Energy"}`,
          targets.map((x) => ({ move: x as InteractiveMove, monId: x.monId! })),
          true,
        );
        return;
      }
      // N's PP Up stage 2: the chosen Energy still needs a Benched target.
      if (m.monId != null && m.discardPickId != null) {
        const targets = trainerMovesFor(m.cardId).filter(
          (x) => x.discardPickId === m.discardPickId,
        );
        setPickerMoves(null);
        chooseOwnTarget(
          game.view.hand.find((c) => c.id === m.cardId)?.name ?? "Attach",
          targets.map((x) => ({ move: x as InteractiveMove, monId: x.monId! })),
        );
        return;
      }
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
      <div className="rounded-2xl border border-black/8 bg-white p-4 shadow-sm dark:bg-surface-elevated dark:border-white/10">
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
                className="w-full rounded-lg border border-black/15 bg-white px-2 py-1.5 text-xs text-text-primary dark:bg-surface-2 dark:border-white/10"
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
                  ? "border border-transparent bg-black text-white dark:bg-white dark:text-black"
                  : "border border-black/15 bg-white text-text-secondary dark:bg-surface-2 dark:border-white/10"
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
        {error && <p className="mt-3 text-xs text-accent">{error}</p>}
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
  /** Attacks grouped by index. `legalMoves` emits one move per rider-pick
   *  combination, so a rider attack appears several times; the UI keyed its
   *  buttons on `attackIndex` and therefore rendered duplicate keys and threw
   *  every pick but one away. */
  const attackGroups = Array.from(
    attacks.reduce((map, m) => {
      const list = map.get(m.attackIndex) ?? [];
      list.push(m);
      map.set(m.attackIndex, list);
      return map;
    }, new Map<number, typeof attacks>()),
  ).map(([attackIndex, moves]) => ({ attackIndex, moves }));
  const canRetreat = byKind("retreat").length > 0;
  /** Why retreat is unavailable, or null when it IS available.
   *
   *  The button used to be hidden whenever retreat was illegal, which makes
   *  "your Active can't pay the cost" indistinguishable from "this game has no
   *  retreat" — and that is exactly how it was reported. Retreat is legal on
   *  only ~22% of decision points (energy is scarce), so the button was
   *  missing most of the time. Absence of an affordance reads as a bug; a
   *  disabled button with a reason reads as the rules. */
  const retreatBlockedReason: string | null = (() => {
    if (canRetreat) return null;
    if (game?.status !== "human_turn") return null;
    const active = view.board.active;
    if (!active) return "No Active Pokémon";
    if (view.board.bench.length === 0) return "No Benched Pokémon to promote";
    const cost = active.retreatCost ?? 0;
    const have = active.energy?.length ?? 0;
    // Energy is the cause in essentially every case measured (193 of 193
    // blocked decision points in a 6-game probe), so name it precisely.
    // Anything else — already retreated this turn, a "can't retreat" status —
    // is not distinguishable from the client view, so say so rather than
    // guess: a wrong reason is worse than an honest vague one.
    if (have < cost) return `Needs ${cost} Energy — ${have} attached`;
    return "Not available this turn";
  })();
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
        : view.board.active
          ? () => setMonPanel(view.board.active!.id)
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
          if (mon && pendingTargets.has(mon.id)) return void sendTargeted(mon.id);
          if (mon) setMonPanel(mon.id);
        }
      : (i: number) => {
          // Even with no pending action, a benched Pokémon must open its own
          // abilities — that is where a human looks for them.
          const mon = view.board.bench[i];
          if (mon) setMonPanel(mon.id);
        },
    highlightBench: view.board.bench.map((mon, i) =>
      promoting ||
      benchPickIndex(i) != null ||
      (retreatMode && byKind("retreat").some((m) => m.benchIndex === i)) ||
      (pendingCardId != null && pendingTargets.has(mon.id)),
    ),
  };

  // Distinct usable abilities (from the legal set), grouped for buttons.
  const abilityOptions = options.filter(
    (m): m is Extract<InteractiveMove, { kind: "use_ability" }> => m.kind === "use_ability",
  );
  const abilityGroups = Array.from(
    abilityOptions.reduce((map, m) => {
      const key = `${m.monId}:${m.abilityName}`;
      if (!map.has(key)) map.set(key, { abilityName: m.abilityName, monId: m.monId, moves: [] as typeof abilityOptions });
      map.get(key)!.moves.push(m);
      return map;
    }, new Map<string, { abilityName: string; monId: string; moves: typeof abilityOptions }>())
    .values(),
  );

  /** DECLARATIVE activated abilities (W3). These arrive as `effect` moves
   *  whose `sourceId` is a Pokémon in play rather than a hand card — and the
   *  only place this UI looked for effect moves was `sourceId === <hand card>`,
   *  so none of them were reachable. Every ability W3 authored was usable by
   *  the AI and invisible to the human: Pecharunt ex's Subjugating Chains,
   *  Mega Kangaskhan ex's Run Errand, Lunatone's Lunar Cycle, Fan Rotom,
   *  Teal Mask Ogerpon ex, ~30 in all.
   *
   *  The legacy `use_ability` registry keeps its own tuned buttons above; this
   *  covers everything the declarative path added. */
  const inPlayIds = new Set(
    [view.board.active, ...view.board.bench].filter(Boolean).map((m) => m!.id),
  );
  const declarativeAbilityGroups = Array.from(
    options
      .filter((m): m is EffectMove => m.kind === "effect" && inPlayIds.has(m.sourceId))
      .reduce((map, m) => {
        const key = `${m.sourceId}:${m.card}`;
        if (!map.has(key)) map.set(key, { monId: m.sourceId, card: m.card, moves: [] as EffectMove[] });
        map.get(key)!.moves.push(m);
        return map;
      }, new Map<string, { monId: string; card: string; moves: EffectMove[] }>())
      .values(),
  );

  // The AI mat is the target surface for Boss (bench), ability targeting
  // (active + bench), and counter placement (bench). Highlight + tap route
  // by whichever mode is live.
  const bossIndex = (i: number) =>
    bossMoves?.find((m) => m.kind === "play_trainer" && m.oppBenchIndex === i);
  // Ruffian targets any opponent Pokémon (Active or Bench) by id.
  const bossMoveForMon = (id: string) =>
    bossMoves?.find((m) => m.kind === "play_trainer" && m.oppMonId === id);
  const abilityTargetIds = new Set(
    abilityTargeting?.moves.map((m) => m.targetMonId).filter((id): id is string => id != null) ?? [],
  );
  function sendAbilityAt(targetId: string) {
    if (!abilityTargeting) return;
    // Prefer the move whose source carries the most damage (Munkidori);
    // Dusknoir has a single move per target.
    const candidates = abilityTargeting.moves.filter((m) => m.targetMonId === targetId);
    const best = candidates.sort((a, b) => (b.counters ?? 0) - (a.counters ?? 0))[0];
    if (best) void sendMove(best);
  }
  const oppActive = view.opponent.board.active;
  const bossActiveMove = bossMoves && oppActive ? bossMoveForMon(oppActive.id) : undefined;
  const aiActiveTargetable =
    (abilityTargeting != null && oppActive != null && abilityTargetIds.has(oppActive.id)) ||
    bossActiveMove != null;

  const aiInteract =
    bossMoves || abilityTargeting || counterPlace
      ? {
          onActiveClick: aiActiveTargetable
            ? () => {
                if (bossActiveMove) return void sendMove(bossActiveMove);
                if (oppActive) sendAbilityAt(oppActive.id);
              }
            : undefined,
          highlightActive: aiActiveTargetable,
          onBenchClick: (i: number) => {
            const mon = view.opponent.board.bench[i];
            if (bossMoves) {
              const move = bossIndex(i) ?? (mon ? bossMoveForMon(mon.id) : undefined);
              if (move) void sendMove(move);
              return;
            }
            if (abilityTargeting && mon && abilityTargetIds.has(mon.id)) {
              sendAbilityAt(mon.id);
              return;
            }
            if (counterPlace && mon) {
              setCounterPlace((cp) =>
                cp && cp.placed.length < cp.total ? { ...cp, placed: [...cp.placed, mon.id] } : cp,
              );
            }
          },
          highlightBench: view.opponent.board.bench.map((mon, i) =>
            bossMoves != null
              ? bossIndex(i) != null || (mon != null && bossMoveForMon(mon.id) != null)
              : abilityTargeting != null
                ? abilityTargetIds.has(mon.id)
                : counterPlace != null,
          ),
        }
      : undefined;

  const settingUp = game.status === "human_setup";
  const statusLine = settingUp
    ? !view.board.active
      ? "Choose your Active Pokémon"
      : `Bench up to 5 Basics (${view.board.bench.length}/5), then Start`
    : promoting
    ? "Choose your new Active Pokémon"
    : game.status === "human_turn"
      ? counterPlace
        ? `Place damage counters — ${counterPlace.placed.length}/${counterPlace.total} on the opponent's Bench`
        : abilityTargeting
          ? `${abilityTargeting.label}: pick a target`
          : bossMoves
            ? bossMoves.some((m) => m.kind === "play_trainer" && m.oppMonId != null)
              ? "Pick an opponent's Pokémon to target"
              : "Pick the opponent's benched Pokémon to drag active"
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
              {(pendingCardId || retreatMode || bossMoves || benchPickMoves || abilityTargeting) && (
                <button
                  onClick={() => {
                    setPendingCardId(null);
                    setRetreatMode(false);
                    setBossMoves(null);
                    setBenchPickMoves(null);
                    setAbilityTargeting(null);
                  }}
                  className="text-[10px] font-semibold text-accent"
                >
                  cancel
                </button>
              )}
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {view.hand.map((card) => {
                const playable =
                  (game.status === "human_turn" || settingUp) && cardIsPlayable(card.id);
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
              {/* Declarative abilities (W3) — sourced from a Pokémon in play. */}
              {declarativeAbilityGroups.map((g) => (
                <button
                  key={`decl:${g.monId}:${g.card}`}
                  onClick={() => sendOrChoose(g.card, g.moves)}
                  disabled={loading}
                  className="rounded-lg border border-accent px-3 py-1.5 text-xs font-semibold text-accent disabled:opacity-50"
                >
                  {effectAbilityName(g.card, g.moves[0].effectIndex) ?? g.card}
                </button>
              ))}
              {/* Ability buttons (Munkidori, Dusknoir, …). */}
              {abilityGroups.map((g) => (
                <button
                  key={`${g.monId}:${g.abilityName}`}
                  onClick={() => {
                    // A hand-discard cost is asked FIRST (Trade). Otherwise
                    // single-target-free abilities send immediately and the
                    // rest enter opponent-target selection.
                    const owner = inPlayById(g.monId);
                    const cost = owner ? activatedHandDiscard(owner.name, g.abilityName) : 0;
                    if (cost > 0) {
                      setDiscardStage({ move: g.moves[0], need: cost, picked: [] });
                    } else if (g.moves.length === 1 && g.moves[0].targetMonId == null) {
                      void sendMove(g.moves[0]);
                    } else {
                      setAbilityTargeting({ label: g.abilityName, moves: g.moves });
                      setCounterPlace(null);
                    }
                  }}
                  disabled={loading}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    abilityTargeting?.moves[0]?.abilityName === g.abilityName
                      ? "border border-transparent bg-accent text-white"
                      : "border border-purple-300 bg-purple-50 text-purple-800"
                  }`}
                >
                  ⚡ {g.abilityName}
                </button>
              ))}
              {/* Activated Stadium effect (Artazon). */}
              {(() => {
                const stadiumMoves = options.filter(
                  (m): m is Extract<InteractiveMove, { kind: "use_stadium" }> => m.kind === "use_stadium",
                );
                if (stadiumMoves.length === 0) return null;
                const handNeed = stadiumHandCost(
                  stadiumMoves[0].stadiumName,
                  view.hand.length,
                );
                return (
                  <button
                    onClick={() => {
                      // Academy at Night / Prism Tower spend cards from hand.
                      // They also carry no `deckCardName`, so the search
                      // picker rendered an EMPTY modal — the button did
                      // nothing at all before this.
                      if (handNeed > 0) {
                        return void setDiscardStage({
                          move: stadiumMoves[0],
                          need: handNeed,
                          picked: [],
                          verb: stadiumTopDecks(stadiumMoves[0].stadiumName)
                            ? "Put on top of your deck"
                            : "Discard",
                        });
                      }
                      if (stadiumMoves.some((m) => m.deckCardName)) {
                        return void setPickerMoves(stadiumMoves);
                      }
                      void sendMove(stadiumMoves[0]);
                    }}
                    disabled={loading}
                    className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800"
                  >
                    🏟 {stadiumMoves[0].stadiumName}
                  </button>
                );
              })()}
              {counterPlace ? (
                <>
                  <button
                    onClick={() =>
                      sendMove({
                        kind: "attack",
                        attackIndex: counterPlace.attackIndex,
                        benchCounters: counterPlace.placed,
                      })
                    }
                    disabled={loading || counterPlace.placed.length !== counterPlace.total}
                    className="rounded-lg border border-transparent bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    Confirm attack ({counterPlace.placed.length}/{counterPlace.total})
                  </button>
                  <button
                    onClick={() => setCounterPlace(null)}
                    className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                attackGroups.map(({ attackIndex, moves }) => {
                  const m = moves[0];
                  const attack = view.board.active?.attacks[attackIndex];
                  const counters = attack?.benchCounters ?? 0;
                  const hasBench = view.opponent.board.bench.length > 0;
                  const attacker = view.board.active;
                  const riderCost =
                    attacker && attack
                      ? attackRiderDiscardCost(attacker.name, attack.name)
                      : 0;
                  return (
                    <button
                      key={attackIndex}
                      onClick={() => {
                        // Attacks that place counters on a non-empty bench
                        // enter tap-to-place mode; everything else fires now.
                        if (riderCost > 0) {
                          // The attack's rider spends cards from hand (Team
                          // Rocket's Porygon's Hacking). Ask before firing —
                          // a rider resolves inside the attack, so this is
                          // the only point at which the player can choose.
                          setDiscardStage({ move: m, need: riderCost, picked: [] });
                        } else if (counters > 0 && hasBench) {
                          setCounterPlace({ attackIndex, total: counters, placed: [] });
                          setAbilityTargeting(null);
                        } else if (moves.length > 1) {
                          // Same attack, different `riderPicks` (Cruel Arrow's
                          // target, Night Joker's donor). One button, then the
                          // choice — rendering one button per pick meant
                          // duplicate React keys and an arbitrary target.
                          setEffectChooser({ label: attack?.name ?? "Attack", moves });
                        } else {
                          void sendMove(m);
                        }
                      }}
                      disabled={loading}
                      className="rounded-lg border border-transparent bg-black px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      {attack?.name ?? "Attack"}
                      {attack?.damage ? ` · ${attack.damage}` : ""}
                      {counters > 0 ? ` · ${counters}◦` : ""}
                    </button>
                  );
                })
              )}
              {!canRetreat && retreatBlockedReason && !counterPlace && (
                <button
                  disabled
                  title={retreatBlockedReason}
                  className="cursor-not-allowed rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs font-semibold text-text-muted"
                >
                  Retreat · {retreatBlockedReason}
                </button>
              )}
              {canRetreat && !counterPlace && (
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
              {settingUp && (
                <>
                  <button
                    onClick={() => sendMove({ kind: "setup_reset" })}
                    disabled={loading || !view.board.active}
                    className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-semibold text-text-secondary disabled:opacity-50"
                  >
                    Clear Board
                  </button>
                  <button
                    onClick={() => sendMove({ kind: "setup_done" })}
                    disabled={loading || !view.board.active}
                    className="ml-auto rounded-lg border border-transparent bg-accent px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  >
                    Start Game
                  </button>
                </>
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
                const names =
                  m.kind === "play_trainer"
                    ? m.attachCardName
                      // Crispin: attached first, then the one going to hand.
                      ? [m.attachCardName, ...(m.toHandCardName ? [m.toHandCardName] : [])]
                      : m.deckCardNames ?? (m.discardPickName ? [m.discardPickName] : [])
                    : m.kind === "use_stadium" && m.deckCardName
                      ? [m.deckCardName]
                      : [];
                if (names.length === 0) return null;
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
          aria-label="Choose cards from your hand"
          onClick={() => setDiscardStage(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">
                {discardStage.verb ?? "Discard"} {discardStage.need} — chosen{" "}
                {discardStage.picked.length}/{discardStage.need}
              </span>
              <button onClick={() => setDiscardStage(null)} className="text-[10px] font-semibold text-accent">
                cancel
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {view.hand
                .filter((c) => c.id !== discardCostSourceId(discardStage.move))
                // Only cards that may actually PAY are offered — a restricted
                // cost (Lunatone's Basic Fighting Energy) would otherwise let
                // the player pick a card the validator then rejects.
                .filter((c) => !discardStage.filter || matchesFilter(c.name, discardStage.filter))
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
              onClick={() =>
                sendMove(
                  discardStage.move.kind === "use_ability"
                    ? // Trade takes ONE card on `cardId` — the field its apply
                      // has always read and nothing ever supplied.
                      { ...discardStage.move, cardId: discardStage.picked[0] }
                    : discardStage.move.kind === "use_stadium"
                      ? { ...discardStage.move, handCardIds: discardStage.picked }
                      : discardStage.move.kind === "attack"
                        ? { ...discardStage.move, riderDiscardCardIds: discardStage.picked }
                        : { ...discardStage.move, discardCardIds: discardStage.picked },
                )
              }
              disabled={discardStage.picked.length !== discardStage.need || loading}
              className="mt-3 w-full rounded-lg border border-transparent bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
            >
              Confirm &amp; play
            </button>
          </div>
        </div>
      )}
      {/* Own-Pokémon target chooser (attach energy, evolve, Crispin, Rare
          Candy) — explicit list so targeting never relies on a board tap. */}
      {ownTargetChooser && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: "rgba(242,242,242,0.92)" }}
          role="dialog"
          aria-modal="true"
          aria-label={ownTargetChooser.label}
          onClick={() => setOwnTargetChooser(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">
                {ownTargetChooser.label} — choose a Pokémon
              </span>
              <button onClick={() => setOwnTargetChooser(null)} className="text-[10px] font-semibold text-accent">
                cancel
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {ownTargetChooser.choices.map((choice, i) => {
                const mon = [view.board.active, ...view.board.bench].find((m) => m?.id === choice.monId);
                const img = mon ? images[mon.name] : null;
                const isActive = view.board.active?.id === choice.monId;
                return (
                  <button
                    key={`${choice.monId}-${i}`}
                    onClick={() => {
                      // Target chosen. If that target's move carries an
                      // on-attach trigger with alternatives, ask for those too.
                      const label = ownTargetChooser.label;
                      setOwnTargetChooser(null);
                      sendOrChoose(label, choice.moves ?? [choice.move]);
                    }}
                    disabled={loading}
                    className="flex flex-col items-center gap-1 rounded-lg border border-black/8 p-1.5 hover:border-accent disabled:opacity-50"
                  >
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={img}
                        alt={mon?.name ?? ""}
                        className="w-full rounded-md shadow-sm"
                        onError={(e) => {
                          if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
                        }}
                      />
                    ) : (
                      <div className="flex aspect-[5/7] w-full items-center justify-center rounded-md border border-black/15 bg-surface p-1 text-center text-[8px] font-semibold text-text-secondary">
                        {mon?.name ?? "?"}
                      </div>
                    )}
                    <span className="text-center text-[9px] font-semibold leading-tight text-text-secondary">
                      {mon?.name ?? "?"}
                      {isActive ? " (Active)" : ""}
                      {mon && mon.energy.length > 0 ? ` · ${mon.energy.length}⚡` : ""}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {/* Generic declarative-effect chooser — one option per enumerated move,
          labelled by the picks' display names (fetched card / targeted mon). */}
      {monPanel && (() => {
        const mon =
          view.board.active?.id === monPanel
            ? view.board.active
            : view.board.bench.find((m) => m.id === monPanel);
        if (!mon) return null;
        const isActive = view.board.active?.id === mon.id;
        const myAttacks = isActive ? attackGroups : [];
        const myDecl = declarativeAbilityGroups.filter((g) => g.monId === mon.id);
        const myLegacy = abilityGroups.filter((g) => g.monId === mon.id);
        const nothing = myAttacks.length === 0 && myDecl.length === 0 && myLegacy.length === 0;
        return (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center p-4"
            style={{ background: "rgba(242,242,242,0.92)" }}
            role="dialog"
            aria-modal="true"
            aria-label={mon.name}
            onClick={() => setMonPanel(null)}
          >
            <div
              className="max-h-[80vh] w-full max-w-sm overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-semibold text-text-primary">
                  {mon.name}
                  {!isActive && <span className="ml-1 font-normal text-text-muted">(Benched)</span>}
                </span>
                <button onClick={() => setMonPanel(null)} className="text-[10px] font-semibold text-accent">
                  close
                </button>
              </div>

              {myAttacks.length > 0 && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Attacks</div>
                  <div className="flex flex-col gap-1.5">
                    {myAttacks.map(({ attackIndex, moves }) => {
                      const atk = mon.attacks?.[attackIndex];
                      const counters = atk?.benchCounters ?? 0;
                      const hasBench = view.opponent.board.bench.length > 0;
                      return (
                        <button
                          key={attackIndex}
                          onClick={() => {
                            setMonPanel(null);
                            if (counters > 0 && hasBench) {
                              setCounterPlace({ attackIndex, total: counters, placed: [] });
                              setAbilityTargeting(null);
                            } else if (moves.length > 1) {
                              setEffectChooser({ label: atk?.name ?? "Attack", moves });
                            } else {
                              void sendMove(moves[0]);
                            }
                          }}
                          disabled={loading}
                          className="flex items-center justify-between rounded-lg border border-transparent bg-black px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          <span>{atk?.name ?? "Attack"}</span>
                          <span className="tabular-nums">{atk?.damage || ""}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {(myDecl.length > 0 || myLegacy.length > 0) && (
                <div>
                  <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">Abilities</div>
                  <div className="flex flex-col gap-1.5">
                    {myDecl.map((g) => (
                      <button
                        key={`p-decl:${g.card}`}
                        onClick={() => {
                          setMonPanel(null);
                          sendOrChoose(g.card, g.moves);
                        }}
                        disabled={loading}
                        className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-2 text-left text-xs font-semibold text-purple-800 disabled:opacity-50"
                      >
                        ⚡ {effectAbilityName(g.card, g.moves[0].effectIndex) ?? g.card}
                      </button>
                    ))}
                    {myLegacy.map((g) => (
                      <button
                        key={`p-leg:${g.abilityName}`}
                        onClick={() => {
                          setMonPanel(null);
                          const cost = activatedHandDiscard(mon.name, g.abilityName);
                          if (cost > 0) {
                            // Trade: "discard a card from your hand, then draw
                            // 2". Which card is the player's decision.
                            setDiscardStage({ move: g.moves[0], need: cost, picked: [] });
                          } else if (g.moves.length === 1 && g.moves[0].targetMonId == null) {
                            void sendMove(g.moves[0]);
                          } else {
                            setAbilityTargeting({ label: g.abilityName, moves: g.moves });
                            setCounterPlace(null);
                          }
                        }}
                        disabled={loading}
                        className="rounded-lg border border-purple-300 bg-purple-50 px-3 py-2 text-left text-xs font-semibold text-purple-800 disabled:opacity-50"
                      >
                        ⚡ {g.abilityName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {nothing && (
                <p className="text-xs text-text-secondary">
                  Nothing to use right now.
                  {!isActive && " Attacks are only available from the Active Spot."}
                </p>
              )}

              <button
                onClick={() => {
                  setMonPanel(null);
                  setInspect({ kind: "card", name: mon.name, imageUrl: images[mon.name] ?? null });
                }}
                className="mt-3 w-full rounded-lg border border-black/15 bg-white px-3 py-1.5 text-[11px] font-semibold text-text-secondary"
              >
                View card
              </button>
            </div>
          </div>
        );
      })()}

      {effectChooser && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center p-4"
          style={{ background: "rgba(242,242,242,0.92)" }}
          role="dialog"
          aria-modal="true"
          aria-label={effectChooser.label}
          onClick={() => setEffectChooser(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl border border-black/8 bg-white p-4 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold text-text-primary">{effectChooser.label} — choose</span>
              <button onClick={() => setEffectChooser(null)} className="text-[10px] font-semibold text-accent">
                cancel
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {effectChooser.moves.map((m, i) => {
                const names = pickNamesOf(m);
                return (
                  <button
                    key={i}
                    onClick={() => sendMove(m)}
                    disabled={loading}
                    className="flex flex-col items-center gap-1 rounded-lg border border-black/8 p-1.5 hover:border-accent disabled:opacity-50"
                  >
                    <div className="flex w-full justify-center gap-1">
                      {names.length > 0 ? (
                        names.map((n, j) => {
                          const img = images[n];
                          return img ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={j} src={img} alt={n} className="w-full min-w-0 rounded-md shadow-sm" style={{ maxWidth: names.length > 1 ? "48%" : "100%" }} />
                          ) : (
                            <div key={j} className="flex aspect-[5/7] w-full items-center justify-center rounded-md border border-black/15 bg-surface p-1 text-center text-[8px] font-semibold text-text-secondary">
                              {n}
                            </div>
                          );
                        })
                      ) : (
                        <div className="flex aspect-[5/7] w-full items-center justify-center rounded-md border border-black/15 bg-surface p-1 text-center text-[8px] font-semibold text-text-secondary">
                          Play
                        </div>
                      )}
                    </div>
                    <span className="line-clamp-2 text-center text-[9px] font-semibold leading-tight text-text-secondary">
                      {names.join(" + ") || "Play"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
      {inspect && <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />}
    </InspectContext.Provider>
  );
}
