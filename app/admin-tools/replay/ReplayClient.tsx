"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import Link from "next/link";
import BattleLogDetail, { formatActionLabel } from "@/app/components/BattleLogDetail";
import type {
  ReplayFrame,
  ReplayPayload,
} from "@/app/api/admin/replay/[matchId]/route";
import {
  MAT_STYLES,
  TEXTURES,
  MAT_PADDING,
  MAT_ASPECT,
} from "@/app/admin-tools/deck-mat/DeckMatClient";

// Fires synchronously before first paint on the client (prevents card-width
// overflow flash) and falls back to useEffect during SSR to avoid the
// "useLayoutEffect does nothing on the server" hydration warning.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

// Hardcoded default mat style for the replay board.
const REPLAY_GRADIENT = MAT_STYLES.find((s) => s.key === "fire-lightning")!.gradient;
const REPLAY_TEXTURE = TEXTURES.find((t) => t.key === "lines")!;

export interface ReplayMatchOption {
  id: string;
  createdAt: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  opponentArchetype: string | null;
  result: "win" | "loss" | "draw" | null;
  deckName: string;
}

interface PokemonFrame {
  name: string;
  damage: number;
  hp: number | null;
  energy: string[];
  energyTypes: string[];
  conditions: string[];
  evolutionStack: string[];
  imageUrl: string | null;
}

// pokemontcg.io serves the standard Pokémon card-back PNG as the body of
// a 404 — browsers render the bytes regardless of status code. Reusing
// that gives us a card-back without bundling an asset of our own.
const CARD_BACK_URL = "https://images.pokemontcg.io/back.png";

// Card inspector (lightbox) target. A tapped Pokémon opens with its full
// holder — HP bar + attached energies — while any other card (stadium,
// played trainer, top discard) opens as a plain large image.
type InspectTarget =
  | { kind: "pokemon"; mon: PokemonFrame }
  | { kind: "card"; name: string; imageUrl: string | null };

// Lets any card on the mat open the inspector without prop-drilling a
// callback through PlayerMat → rows → individual cards.
const InspectContext = createContext<((t: InspectTarget) => void) | null>(null);

interface ReplayClientProps {
  options: ReplayMatchOption[];
}

export default function ReplayClient({ options }: ReplayClientProps) {
  const [selectedId, setSelectedId] = useState<string | null>(
    options[0]?.id ?? null,
  );
  const [data, setData] = useState<ReplayPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2 | 4>(1);

  useEffect(() => {
    if (!selectedId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPlaying(false);
    fetch(`/api/admin/replay/${selectedId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(`Replay failed (${r.status})`);
        return (await r.json()) as ReplayPayload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setFrameIndex(0);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Replay failed");
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const frame: ReplayFrame | null = useMemo(() => {
    if (!data) return null;
    return data.frames[Math.min(frameIndex, data.frames.length - 1)] ?? null;
  }, [data, frameIndex]);

  const frameCount = data?.frames.length ?? 0;

  // Auto-advance at the selected speed while playing.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setFrameIndex((i) => {
        if (i >= frameCount - 1) return i;
        return i + 1;
      });
    }, Math.round(1000 / speed));
    return () => clearInterval(id);
  }, [playing, frameCount, speed]);

  // Pause automatically when the last frame is reached.
  useEffect(() => {
    if (playing && frameIndex >= frameCount - 1) setPlaying(false);
  }, [playing, frameIndex, frameCount]);

  // Index of every frame that opens a new turn (turn number changes vs the
  // prior frame). Drives the outer chevrons — back/forward by whole turn —
  // without scanning the frame array on every click.
  const turnStartIndices = useMemo(() => {
    if (!data) return [] as number[];
    const starts: number[] = [];
    let prevTurn = Number.NaN;
    data.frames.forEach((f, i) => {
      if (f.turn !== prevTurn) {
        starts.push(i);
        prevTurn = f.turn;
      }
    });
    return starts;
  }, [data]);

  const canStepBack = frameIndex > 0;
  const canStepForward = frameIndex < frameCount - 1;

  function stepTurnBack() {
    if (turnStartIndices.length === 0) return;
    let currentStart = 0;
    for (let i = turnStartIndices.length - 1; i >= 0; i--) {
      if (turnStartIndices[i] <= frameIndex) {
        currentStart = turnStartIndices[i];
        break;
      }
    }
    if (frameIndex === currentStart) {
      const idx = turnStartIndices.indexOf(currentStart);
      if (idx > 0) setFrameIndex(turnStartIndices[idx - 1]);
    } else {
      setFrameIndex(currentStart);
    }
  }

  function stepTurnForward() {
    const next = turnStartIndices.find((i) => i > frameIndex);
    if (next != null) setFrameIndex(next);
  }

  const canTurnBack =
    turnStartIndices.length > 0 && frameIndex > turnStartIndices[0];
  const canTurnForward =
    turnStartIndices.some((i) => i > frameIndex);

  // Auto-pin the thread to its newest post as the playhead advances or
  // rewinds. We scroll on every actionIndex change so the most-recently
  // revealed row stays visible without the user having to scroll.
  const threadScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = threadScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [frame?.actionIndex, selectedId]);

  // Pin the thread aside to the board's measured height so it scrolls
  // inside a fixed envelope instead of stretching the row to fit its own
  // content (which would otherwise push the navigator away from the
  // board on desktop).
  const boardRef = useRef<HTMLDivElement>(null);
  const [boardHeight, setBoardHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    setBoardHeight(el.getBoundingClientRect().height);
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBoardHeight(entry.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [frame?.actionIndex, selectedId]);

  return (
    <main className="min-h-dvh bg-bg pb-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 pt-6">
        <header className="mb-5 flex items-baseline justify-between gap-3">
          <div>
            <Link
              href="/admin-tools"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted hover:text-text-primary"
            >
              ← Admin Tools
            </Link>
            <h1 className="mt-1 text-2xl font-bold text-text-primary">Replay</h1>
            <p className="mt-0.5 text-xs text-text-secondary">
              Step through a parsed battle log on a board.
            </p>
          </div>
        </header>

        {/* Desktop header (above the thread + board row): match name
            on the left, wordmark in the center, the four stepper
            controls on the right. Replaces the lower TurnNavigator on
            lg+; mobile keeps the navigator below the board. */}
        <ReplayHeader
          playerPrimaryName={data?.playerPrimaryName ?? null}
          opponentPrimaryName={data?.opponentPrimaryName ?? null}
          canStepBack={canStepBack}
          canStepForward={canStepForward}
          canTurnBack={canTurnBack}
          canTurnForward={canTurnForward}
          playing={playing}
          speed={speed}
          onTogglePlay={() => setPlaying((p) => !p)}
          onCycleSpeed={() => setSpeed((s) => s === 0.5 ? 1 : s === 1 ? 2 : s === 2 ? 4 : 0.5)}
          onStepBack={() => { setPlaying(false); canStepBack && setFrameIndex((i) => i - 1); }}
          onStepForward={() => { setPlaying(false); canStepForward && setFrameIndex((i) => i + 1); }}
          onTurnBack={() => { setPlaying(false); stepTurnBack(); }}
          onTurnForward={() => { setPlaying(false); stepTurnForward(); }}
        />

        {/* Row 1: thread (lg only) + board side-by-side. The aside is
            pinned to the board's measured height so its inner scroll
            container has something to clip against — without this the
            thread would stretch the row taller than the board, pushing
            the navigator out of arm's reach. */}
        <div className="lg:flex lg:items-start lg:gap-6">
          {selectedId && (
            <aside
              key={selectedId}
              className="relative hidden min-w-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden"
              style={
                boardHeight != null
                  ? { height: `${boardHeight}px`, marginTop: "1rem" }
                  : undefined
              }
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-[#f2f2f2] to-[#f2f2f2]/0" />
              <div
                ref={threadScrollRef}
                className="h-full overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              >
                <BattleLogDetail
                  matchId={selectedId}
                  apiUrl={`/api/admin/replay/${selectedId}/log`}
                  maxSequence={frame?.actionIndex ?? -1}
                  hideScoreCards
                  compactAvatars
                />
              </div>
            </aside>
          )}
          <div ref={boardRef} className="lg:w-[720px] lg:shrink-0">
            <Board frame={frame} loading={loading} error={error} />
          </div>
        </div>

        {/* Row 2: navigator (mobile only — desktop uses the header above)
            + match selector pinned under the board column on desktop,
            full-width on mobile. */}
        <div className="lg:ml-auto lg:w-[720px]">
          <div className="lg:hidden">
            <TurnNavigator
              frameIndex={frameIndex}
              frameCount={frameCount}
              canStepBack={canStepBack}
              canStepForward={canStepForward}
              canTurnBack={canTurnBack}
              canTurnForward={canTurnForward}
              playing={playing}
              speed={speed}
              onTogglePlay={() => setPlaying((p) => !p)}
              onCycleSpeed={() => setSpeed((s) => s === 0.5 ? 1 : s === 1 ? 2 : s === 2 ? 4 : 0.5)}
              onStepBack={() => { setPlaying(false); canStepBack && setFrameIndex((i) => i - 1); }}
              onStepForward={() => { setPlaying(false); canStepForward && setFrameIndex((i) => i + 1); }}
              onTurnBack={() => { setPlaying(false); stepTurnBack(); }}
              onTurnForward={() => { setPlaying(false); stepTurnForward(); }}
            />
          </div>

          <MatchSelector
            options={options}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>
      </div>
    </main>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Desktop header                                                   */
/* ──────────────────────────────────────────────────────────────── */

function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current" aria-hidden>
      <path d="M5 3l14 9-14 9V3z" />
    </svg>
  );
}

function speedLabel(s: 0.5 | 1 | 2 | 4): string {
  return s === 0.5 ? "½×" : `${s}×`;
}

function ReplayHeader({
  playerPrimaryName,
  opponentPrimaryName,
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  playing,
  speed,
  onTogglePlay,
  onCycleSpeed,
  onStepBack,
  onStepForward,
  onTurnBack,
  onTurnForward,
}: {
  playerPrimaryName: string | null;
  opponentPrimaryName: string | null;
  canStepBack: boolean;
  canStepForward: boolean;
  canTurnBack: boolean;
  canTurnForward: boolean;
  playing: boolean;
  speed: 0.5 | 1 | 2 | 4;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
}) {
  const left = playerPrimaryName ?? "?";
  const right = opponentPrimaryName ?? "?";
  const buttonClass =
    "rounded-md border border-black/10 px-4 py-1.5 text-sm font-semibold text-text-secondary hover:bg-surface disabled:opacity-30";
  return (
    <div className="mt-4 hidden items-center gap-6 lg:flex">
      <div className="flex flex-1 min-w-0 items-baseline gap-2 text-xl font-semibold text-text-primary">
        <span className="truncate">{left}</span>
        <span className="text-base font-normal text-text-muted">vs</span>
        <span className="truncate">{right}</span>
      </div>
      <div className="flex shrink-0 justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-wordmark.png"
          alt="TCG Dexter"
          className="h-[42px] w-auto opacity-90"
        />
      </div>
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onTurnBack}
          disabled={!canTurnBack}
          aria-label="Previous turn"
          title="Previous turn"
          className={buttonClass}
        >
          ⟪
        </button>
        <button
          type="button"
          onClick={onStepBack}
          disabled={!canStepBack}
          aria-label="Previous action"
          title="Previous action"
          className={buttonClass}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={onTogglePlay}
          disabled={!playing && !canStepForward}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause" : "Play"}
          className={`${buttonClass} px-3`}
        >
          <PlayPauseIcon playing={playing} />
        </button>
        <button
          type="button"
          onClick={onCycleSpeed}
          aria-label={`Playback speed: ${speedLabel(speed)}`}
          title="Cycle playback speed"
          className="rounded-md border border-black/10 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-text-secondary hover:bg-surface"
        >
          {speedLabel(speed)}
        </button>
        <button
          type="button"
          onClick={onStepForward}
          disabled={!canStepForward}
          aria-label="Next action"
          title="Next action"
          className={buttonClass}
        >
          ›
        </button>
        <button
          type="button"
          onClick={onTurnForward}
          disabled={!canTurnForward}
          aria-label="Next turn"
          title="Next turn"
          className={buttonClass}
        >
          ⟫
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Board                                                            */
/* ──────────────────────────────────────────────────────────────── */

// Rail columns (draw/discard/prizes) and active card are sized for a standard
// 5-card bench. The bench itself is an absolutely positioned overlay and never
// competes with the grid layout, so only those 5 card-widths + 2 grid gaps
// constrain the formula.
// Tray geometry ratios (×card width). A Pokémon renders inside a rounded
// "card holder": padding around the contents, the card image on top, a gap,
// then a stacked info strip (energy row above, HP bar below). TRAY_TOTAL_RATIO
// is the holder's full height as a multiple of card width — used to reserve
// vertical space so two stacked rows (bench + active) never collide.
const TRAY_PAD_RATIO = 0.045;
const TRAY_GAP_RATIO = 0.04;
const TRAY_STRIP_RATIO = 0.34;
// The holder wraps a full-size card image (same width as the stand-alone
// cards), inset by `pad` on every side — so the container is wider than the
// card image by 2*pad.
const CONTAINER_W_FACTOR = 1 + 2 * TRAY_PAD_RATIO;
// Holder height as a multiple of the card-image width: top pad + card
// (342/245 tall) + gap + HP strip + bottom pad.
const TRAY_TOTAL_RATIO =
  2 * TRAY_PAD_RATIO + 342 / 245 + TRAY_GAP_RATIO + TRAY_STRIP_RATIO;
// Card images (and their holders) are rendered 10% larger than the bare
// fit-to-mat size, consuming the layout headroom. The holder geometry scales
// with them, but the footer/label text is pinned to its pre-bump pixel size
// (see the `/ CARD_IMAGE_BUMP` in the font-size computations).
const CARD_IMAGE_BUMP = 1.1;
// Shared gap (px) between adjacent cards on the board: bench-to-bench and the
// float gap between the active and its stadium / played-trainer neighbours.
const REPLAY_CARD_GAP = 4;

function computeReplayCardWidth(matWidth: number): number {
  const innerW = matWidth - 2 * MAT_PADDING;
  const innerH = matWidth * MAT_ASPECT - 2 * MAT_PADDING;
  const ROW_GAP = 6;
  // Two tray rows (bench + active) must fit the mat height; size from the
  // tray's full height, not the bare card.
  const maxTrayH = (innerH - ROW_GAP) / 2;
  const maxWidthFromH = maxTrayH / TRAY_TOTAL_RATIO;
  // 2 rail holders + 5 bench Pokémon holders — all are holders now (wider
  // than the bare card by the container factor); 5 conservative bench gaps.
  const maxWidthFromW =
    (innerW - 2 * 12 - 5 * REPLAY_CARD_GAP) / (7 * CONTAINER_W_FACTOR);
  return Math.max(
    20,
    Math.floor(Math.min(maxWidthFromH, maxWidthFromW) * 0.9 * CARD_IMAGE_BUMP),
  );
}

function Board({
  frame,
  loading,
  error,
}: {
  frame: ReplayFrame | null;
  loading: boolean;
  error: string | null;
}) {
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
  }, []);

  const cardWidth = computeReplayCardWidth(matWidth);
  const [inspect, setInspect] = useState<InspectTarget | null>(null);

  return (
    <InspectContext.Provider value={setInspect}>
    <div ref={matContainerRef} className="mt-4">
      {error ? (
        <div className="rounded-2xl border border-accent/40 bg-white p-6 text-sm text-accent">
          {error}
        </div>
      ) : !frame ? (
        <div className="rounded-2xl border border-black/8 bg-white p-10 text-center text-sm text-text-secondary">
          {loading ? "Loading replay…" : "Pick a match below to begin."}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <PlayerMat
            side="player"
            bench={frame.player.bench}
            active={frame.player.active}
            discardCount={frame.player.discardCount}
            discardTop={frame.player.discardTop}
            discardTopImageUrl={frame.player.discardTopImageUrl}
            deckCount={frame.player.deckCount}
            handCount={frame.player.handCount}
            prizesRemaining={frame.player.prizesRemaining}
            stadium={frame.stadium?.owner === "player" ? frame.stadium : null}
            lastPlayedTrainer={
              frame.lastPlayedTrainer?.actor === "player"
                ? frame.lastPlayedTrainer
                : null
            }
            cardWidth={cardWidth}
            matWidth={matWidth}
          />
          <BetweenMatsBar frame={frame} />
          <PlayerMat
            side="opponent"
            bench={frame.opponent.bench}
            active={frame.opponent.active}
            discardCount={frame.opponent.discardCount}
            discardTop={frame.opponent.discardTop}
            discardTopImageUrl={frame.opponent.discardTopImageUrl}
            deckCount={frame.opponent.deckCount}
            handCount={frame.opponent.handCount}
            prizesRemaining={frame.opponent.prizesRemaining}
            stadium={frame.stadium?.owner === "opponent" ? frame.stadium : null}
            lastPlayedTrainer={
              frame.lastPlayedTrainer?.actor === "opponent"
                ? frame.lastPlayedTrainer
                : null
            }
            cardWidth={cardWidth}
            matWidth={matWidth}
          />
        </div>
      )}
      {inspect && (
        <ReplayCardInspector target={inspect} onClose={() => setInspect(null)} />
      )}
    </div>
    </InspectContext.Provider>
  );
}

// Thread-style current-action strip slotted between the two mats. Repurposes
// the battle-log thread's vocabulary — actor name + concise action + a
// black "Turn N" pill — but collapses to a single row showing only the
// action for the board state on screen. Left: actor (or "Setup" / "Pokémon
// Checkup" for the synthetic phases). Center: the current action. Right: the
// turn number.
function BetweenMatsBar({ frame }: { frame: ReplayFrame }) {
  const leftLabel =
    frame.phase === "setup"
      ? "Setup"
      : frame.phase === "checkup"
        ? "Pokémon Checkup"
        : frame.actor === "player"
          ? frame.player.handle ?? "Player"
          : frame.actor === "opponent"
            ? frame.opponent.handle ?? "Opponent"
            : "Game";
  // Setup has no turn yet; turns and between-turn checkups do.
  const showTurn = frame.phase === "turn" || frame.phase === "checkup";

  // Turn bookends ("… ended their turn", "<player>'s turn") are implied by
  // whatever action follows, so we suppress them here and leave the action
  // line blank rather than echoing redundant scaffolding.
  const summary = frame.summary ?? "";
  const s = summary.toLowerCase();
  const handles = [frame.player.handle, frame.opponent.handle]
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase());
  const isImplied =
    s.includes("ended their turn") ||
    handles.some((h) => s.includes(`${h}'s turn`) || s.includes(`${h} turn`));
  // During a player's turn the holder is named on the line above, so strip a
  // leading "<holder> " / "<holder>'s " from the action (and recapitalize).
  // Setup/checkup keep the name since the left label doesn't identify who acted.
  const turnHolder =
    frame.phase === "turn"
      ? frame.actor === "player"
        ? frame.player.handle
        : frame.actor === "opponent"
          ? frame.opponent.handle
          : null
      : null;
  // "Opponent" in the action means the side opposite the actor.
  const otherName =
    frame.actor === "player"
      ? frame.opponent.handle
      : frame.actor === "opponent"
        ? frame.player.handle
        : null;
  const actionText = isImplied
    ? ""
    : formatActionLabel(summary, { authorName: turnHolder, otherName });

  return (
    <div className="flex flex-col gap-0.5 px-1">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-bold text-text-primary">
          {leftLabel}
        </span>
        {showTurn && (
          <span className="shrink-0 rounded-full bg-[#1a1a1a] px-2.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
            Turn {frame.turn}
          </span>
        )}
      </div>
      <div className="line-clamp-2 min-h-[2.5rem] py-1 text-center text-xs leading-snug text-text-secondary">
        {actionText}
      </div>
    </div>
  );
}

// P1 mat: bench at top, active at bottom — actives face each other across the
// gap between the two mats. P2 mat: active at top, bench at bottom.
//
// 3-column grid: [left-rail] [center 1fr] [right-rail]
// Stadium and played-trainer are absolutely positioned overlays that float
// on a higher z-layer so they never affect bench centering or active centering.
function PlayerMat({
  side,
  bench,
  active,
  discardCount,
  discardTop,
  discardTopImageUrl,
  deckCount,
  handCount,
  prizesRemaining,
  stadium,
  lastPlayedTrainer,
  cardWidth,
  matWidth,
}: {
  side: "player" | "opponent";
  bench: PokemonFrame[];
  active: PokemonFrame | null;
  discardCount: number;
  discardTop?: string | null;
  discardTopImageUrl?: string | null;
  deckCount: number;
  handCount: number;
  prizesRemaining: number;
  stadium: { name: string; imageUrl: string | null } | null;
  lastPlayedTrainer: { name: string; imageUrl: string | null } | null;
  cardWidth: number;
  matWidth: number;
}) {
  const isPlayer = side === "player";
  const label = isPlayer ? "P1" : "P2";
  const texScale = matWidth > 0 ? matWidth / 600 : 1;
  const inspect = useContext(InspectContext);

  // ── Overlay geometry ──────────────────────────────────────────────────────
  // The center column's horizontal midpoint is always innerW/2 regardless of
  // gap size (the gaps cancel out in the algebra). Active card is centered there.
  const innerW = matWidth - 2 * MAT_PADDING;
  const innerH = matWidth * MAT_ASPECT - 2 * MAT_PADDING;
  const cardH = cardWidth * (342 / 245);
  const FLOAT_GAP = REPLAY_CARD_GAP; // px between floating card and its anchor

  // Active Pokémon now renders inside a tray (card + info strip), taller than
  // the bare card. The grid pins the tray to the bottom (P1) / top (P2) of the
  // center column; this resolves the card *image* top within that tray so the
  // floating stadium / played-trainer cards still line up with the card art.
  const activeTray = replayTrayMetrics(cardWidth);
  // The active Pokémon's holder is wider than the bare card by 2*pad; the
  // floating stadium / played-trainer anchor off the holder's edge.
  const activeHalf = activeTray.containerW / 2;
  const activeMatTop = isPlayer
    ? MAT_PADDING + innerH - activeTray.totalH + activeTray.pad // P1: tray bottom-pinned
    : MAT_PADDING + activeTray.pad;                             // P2: tray top-pinned

  // Center the bare stadium / played-trainer cards on the active Pokémon's
  // holder: take the holder's vertical midpoint and back off half a card
  // height. The holder top is the card-art top minus its padding.
  const activeContainerTop = activeMatTop - activeTray.pad;
  const overlayTop =
    activeContainerTop + activeTray.totalH / 2 - cardH / 2;

  // Stadium floats at same height as the active; anchored right (P1) or left (P2)
  // — opposite side from the active Pokémon's center.
  const stadiumLeft = isPlayer
    ? MAT_PADDING + innerW / 2 + activeHalf + FLOAT_GAP  // P1: right of active
    : MAT_PADDING + innerW / 2 - activeHalf - FLOAT_GAP - cardWidth; // P2: left of active

  // Played trainer floats where the stadium used to be: left of active (P1),
  // right of active (P2), vertically centered on the active row.
  const playedTrainerTop = overlayTop;
  const playedTrainerLeft = isPlayer
    ? MAT_PADDING + innerW / 2 - activeHalf - FLOAT_GAP - cardWidth // P1: left of active
    : MAT_PADDING + innerW / 2 + activeHalf + FLOAT_GAP;            // P2: right of active

  // Bench sizing: cards fill the full inner mat width divided by bench count.
  // Height-constrained to the same row height as the active card. Since the
  // bench is an absolute overlay, it never competes with the grid layout.
  const n = bench.length || 1;
  const benchCardWidth = Math.max(20, Math.floor(Math.min(
    cardH * (245 / 342),                    // height: same card size as active
    // width: fit n holders (each wider than its card by the container factor)
    (innerW - Math.max(0, n - 1) * REPLAY_CARD_GAP) / (n * CONTAINER_W_FACTOR),
  )));
  const benchTray = replayTrayMetrics(benchCardWidth);
  const benchTop = isPlayer
    ? MAT_PADDING                                 // P1: bench tray at top of mat interior
    : MAT_PADDING + innerH - benchTray.totalH;    // P2: bench tray at bottom of mat interior

  // Active slot: single card, clean fade+layout transition. The layoutId
  // receives the card from the bench when a Pokémon is promoted.
  const activeRow = (
    <div className="flex justify-center" style={{ minWidth: activeTray.containerW }}>
      <AnimatePresence mode="wait">
        {active && (
          <motion.div
            key={active.name}
            layoutId={`${side}-${active.name}`}
            style={{ width: activeTray.containerW }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, layout: { duration: 0.3, ease: "easeInOut" } }}
          >
            <PokemonCardImage mon={active} width={cardWidth} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <LayoutGroup id={side}>
      <div
        className="relative rounded-xl overflow-hidden"
        style={{
          padding: MAT_PADDING,
          height: matWidth > 0 ? matWidth * MAT_ASPECT : undefined,
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(REPLAY_TEXTURE.svg)}"), ${REPLAY_GRADIENT}`,
          backgroundSize: `${REPLAY_TEXTURE.w * texScale}px ${REPLAY_TEXTURE.h * texScale}px, auto`,
          boxShadow: "0 4px 4px rgba(0,0,0,0.66)",
        }}
      >
        {/* ── 3-column grid: left-rail | center | right-rail ── */}
        <div
          className="grid h-full gap-1.5 sm:gap-3"
          style={{ gridTemplateColumns: `${activeTray.containerW}px 1fr ${activeTray.containerW}px` }}
        >
          {/* Left rail — cards rotate top-toward-left (outer edge). On the top
              mat (P2) the piles anchor to the bottom of the mat. */}
          <div className={`flex h-full flex-col gap-1.5 sm:gap-3 ${isPlayer ? "" : "justify-end"}`}>
            {isPlayer ? (
              <>
                <Pile label="Discard" count={discardCount} width={cardWidth} rotate="ccw" topName={discardTop} topImageUrl={discardTopImageUrl} />
                <Pile label="Draw" count={deckCount} width={cardWidth} rotate="ccw" hint={`${handCount} in hand`} useCardBack />
              </>
            ) : (
              <StackedPrizePile label="Prizes" count={prizesRemaining} width={cardWidth} rotate="ccw" />
            )}
          </div>
          {/* Center: active card only — bench is an absolute overlay */}
          <div className={`flex h-full flex-col ${isPlayer ? "justify-end" : "justify-start"}`}>
            {activeRow}
          </div>
          {/* Right rail — cards rotate top-toward-right (outer edge). On the top
              mat (P2) the piles anchor to the bottom of the mat. */}
          <div className={`flex h-full flex-col gap-1.5 sm:gap-3 ${isPlayer ? "" : "justify-end"}`}>
            {isPlayer ? (
              <StackedPrizePile label="Prizes" count={prizesRemaining} width={cardWidth} rotate="cw" />
            ) : (
              <>
                <Pile label="Draw" count={deckCount} width={cardWidth} rotate="cw" hint={`${handCount} in hand`} useCardBack />
                <Pile label="Discard" count={discardCount} width={cardWidth} rotate="cw" topName={discardTop} topImageUrl={discardTopImageUrl} />
              </>
            )}
          </div>
        </div>

        {/* ── Bench overlay (z-0, behind stadium/trainer, full mat width) ── */}
        {bench.length > 0 && (
          <div
            className="absolute z-0 flex justify-center overflow-hidden"
            style={{ top: benchTop, left: MAT_PADDING, width: innerW, gap: REPLAY_CARD_GAP }}
          >
            {bench.map((mon) => (
              <motion.div
                key={mon.name}
                layoutId={`${side}-${mon.name}`}
                className="shrink-0"
                style={{ width: benchTray.containerW }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
              >
                <PokemonCardImage mon={mon} width={benchCardWidth} />
              </motion.div>
            ))}
          </div>
        )}

        {/* ── Floating overlays (z-10, don't affect grid flow) ── */}
        <AnimatePresence>
          {stadium && (
            <motion.div
              key={stadium.name}
              className="absolute z-10"
              style={{ top: overlayTop, left: stadiumLeft, width: cardWidth }}
              title={stadium.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
            >
              <div
                className={`relative w-full overflow-hidden rounded bg-white ${inspect ? "cursor-pointer" : ""}`}
                style={{ aspectRatio: "245 / 342" }}
                role={inspect ? "button" : undefined}
                onClick={
                  inspect
                    ? () =>
                        inspect({
                          kind: "card",
                          name: stadium.name,
                          imageUrl: stadium.imageUrl,
                        })
                    : undefined
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={stadium.imageUrl ?? CARD_BACK_URL}
                  alt={stadium.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    if (e.currentTarget.src !== CARD_BACK_URL)
                      e.currentTarget.src = CARD_BACK_URL;
                  }}
                />
                {!stadium.imageUrl && (
                  <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[7px] font-semibold leading-tight text-white line-clamp-2">
                    {stadium.name}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {lastPlayedTrainer && (
            <motion.div
              key={lastPlayedTrainer.name}
              className="absolute z-10"
              style={{ top: playedTrainerTop, left: playedTrainerLeft, width: cardWidth }}
              title={lastPlayedTrainer.name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div
                className={`relative w-full overflow-hidden rounded bg-white ${inspect ? "cursor-pointer" : ""}`}
                style={{ aspectRatio: "245 / 342" }}
                role={inspect ? "button" : undefined}
                onClick={
                  inspect
                    ? () =>
                        inspect({
                          kind: "card",
                          name: lastPlayedTrainer.name,
                          imageUrl: lastPlayedTrainer.imageUrl,
                        })
                    : undefined
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={lastPlayedTrainer.imageUrl ?? CARD_BACK_URL}
                  alt={lastPlayedTrainer.name}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    if (e.currentTarget.src !== CARD_BACK_URL)
                      e.currentTarget.src = CARD_BACK_URL;
                  }}
                />
                {!lastPlayedTrainer.imageUrl && (
                  <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[7px] font-semibold leading-tight text-white line-clamp-2">
                    {lastPlayedTrainer.name}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

// Direction a pile's cards are rotated so their printed top points at the
// mat's outer edge: "ccw" for the left rail (top → left), "cw" for the right
// rail (top → right).
type PileRotate = "cw" | "ccw";

// A single card face turned on its side to fill a landscape `L × H` slot. The
// source art is portrait (245:342), so we render it at `H × L` (still 245:342)
// and rotate ±90° about the center; its bounding box then matches the slot.
function RotatedCardFace({
  src,
  alt,
  L,
  H,
  radius,
  rotate,
  ariaHidden,
}: {
  src: string;
  alt: string;
  L: number;
  H: number;
  radius: number;
  rotate: PileRotate;
  ariaHidden?: boolean;
}) {
  const deg = rotate === "cw" ? 90 : -90;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      aria-hidden={ariaHidden || undefined}
      className="absolute left-1/2 top-1/2 max-w-none object-cover"
      style={{
        width: H,
        height: L,
        transform: `translate(-50%, -50%) rotate(${deg}deg)`,
        borderRadius: radius,
      }}
      onError={(e) => {
        if (e.currentTarget.src !== CARD_BACK_URL) e.currentTarget.src = CARD_BACK_URL;
      }}
    />
  );
}

// Draw / discard pile, in the same black holder as the Pokémon cards, but
// turned on its side so the card's printed top faces the mat's outer edge.
// The card art fills a landscape slot; the footer (label + count) stays
// upright below it, along the now-longer edge.
function Pile({
  label,
  count,
  width,
  rotate,
  topName,
  topImageUrl,
  hint,
  useCardBack,
  className = "",
}: {
  label: string;
  count: number;
  /** Card-image width — drives the holder geometry (matches the actives). */
  width: number;
  /** Which way to rotate so the card top points at the mat's outer edge. */
  rotate: PileRotate;
  topName?: string | null;
  /** When set, render the top card face-up using this image (discard). */
  topImageUrl?: string | null;
  hint?: string;
  /** Render the standard card-back image as the face. */
  useCardBack?: boolean;
  className?: string;
}) {
  const inspect = useContext(InspectContext);
  const m = replayTrayMetrics(width);
  const fontSize = Math.max(6, Math.round((m.strip * 0.34) / CARD_IMAGE_BUMP));
  // Landscape card slot: long edge spans the holder width, short edge is the
  // 245/342 counterpart.
  const L = width;
  const H = Math.round(width * (245 / 342));
  // Face image: card back for the draw pile, the top discard otherwise. With
  // no top card (empty discard) the card area stays an empty translucent slot.
  const faceSrc = useCardBack ? CARD_BACK_URL : topImageUrl ?? null;
  const hasFace = useCardBack || Boolean(topName);
  // Only the face-up top discard is worth inspecting (the draw pile is a
  // card back, an empty pile has nothing to show).
  const clickable = inspect != null && !useCardBack && Boolean(topName);

  return (
    <div
      className={`relative bg-black shadow-sm ${className}`}
      style={{ width: m.containerW, borderRadius: m.radius, padding: m.pad }}
      title={hint ? `${label} · ${hint}` : label}
    >
      {/* Landscape card slot — inset by the holder padding for concentric corners. */}
      <div
        className={`relative w-full overflow-hidden ${clickable ? "cursor-pointer" : ""}`}
        style={{
          height: H,
          borderRadius: m.cardRadius,
          background: hasFace ? "#fff" : "rgba(255,255,255,0.06)",
        }}
        role={clickable ? "button" : undefined}
        onClick={
          clickable
            ? () =>
                inspect!({
                  kind: "card",
                  name: topName as string,
                  imageUrl: topImageUrl ?? null,
                })
            : undefined
        }
      >
        {hasFace && (
          <>
            <RotatedCardFace
              src={faceSrc ?? CARD_BACK_URL}
              alt={useCardBack ? "" : topName ?? ""}
              ariaHidden={useCardBack}
              L={L}
              H={H}
              radius={m.cardRadius}
              rotate={rotate}
            />
            {!useCardBack && topName && !topImageUrl && (
              <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[9px] font-semibold leading-tight text-white line-clamp-2">
                {topName}
              </div>
            )}
          </>
        )}
      </div>

      {/* Label row — mirrors the HP header: label left, count right. */}
      <div
        className="flex items-center justify-between leading-none text-white"
        style={{ fontSize, marginTop: m.gap }}
      >
        <span className="font-bold uppercase">{label}</span>
        <span className="font-semibold tabular-nums">{count}</span>
      </div>
    </div>
  );
}

// Special-condition styling. Each pill carries a short label and a
// color-matched chip so a glance at the corner of the card tells you
// what's afflicting the Pokémon. Confused uses "¿?" rather than a
// 3-letter abbreviation (per the game's iconography).
const CONDITION_PILL: Record<string, { label: string; cls: string }> = {
  Poisoned: { label: "PSN", cls: "bg-purple-600 text-white" },
  Burned: { label: "BRN", cls: "bg-orange-500 text-white" },
  Confused: { label: "¿?", cls: "bg-yellow-400 text-black" },
  Asleep: { label: "SLP", cls: "bg-sky-500 text-white" },
  Paralyzed: { label: "PAR", cls: "bg-amber-400 text-black" },
};

function ConditionPill({ condition }: { condition: string }) {
  const meta =
    CONDITION_PILL[condition] ?? {
      label: condition.slice(0, 3).toUpperCase(),
      cls: "bg-gray-500 text-white",
    };
  return (
    <span
      className={`rounded-full px-1 py-[1px] text-[6px] font-bold uppercase leading-none shadow-sm ${meta.cls}`}
      title={condition}
    >
      {meta.label}
    </span>
  );
}

// Resolve the holder's pixel geometry from a card-image width (the same width
// as the stand-alone cards). The card image is inset by `pad` on every side
// for a concentric corner radius, so the container is `width + 2*pad` wide and
// taller by the card height + gap + HP strip + paddings. Ratios live up near
// computeReplayCardWidth so the board can reserve the holder's footprint.
export function replayTrayMetrics(width: number) {
  const pad = Math.max(2, Math.round(width * TRAY_PAD_RATIO));
  const gap = Math.max(1, Math.round(width * TRAY_GAP_RATIO));
  const strip = Math.max(12, Math.round(width * TRAY_STRIP_RATIO));
  const cardW = width;
  const cardH = cardW * (342 / 245);
  const containerW = width + 2 * pad;
  const totalH = pad + cardH + gap + strip + pad;
  const radius = Math.max(4, Math.round(containerW * 0.08));
  const cardRadius = Math.max(2, radius - pad);
  return { pad, gap, strip, cardW, cardH, containerW, totalH, radius, cardRadius };
}

function PokemonCardImage({
  mon,
  width,
  inspectable = true,
  energyIconSize,
}: {
  mon: PokemonFrame;
  width: number;
  /** When true (board context), tapping opens the card inspector. The
   *  inspector renders its own copy with this off so it can't re-open. */
  inspectable?: boolean;
  /** Explicit energy-icon px size. When omitted, the responsive board sizes
   *  apply; the inspector passes a value proportional to the enlarged card. */
  energyIconSize?: number;
}) {
  const inspect = useContext(InspectContext);
  const clickable = inspectable && inspect != null;
  const remainingHp = mon.hp != null ? Math.max(0, mon.hp - mon.damage) : null;
  const hadFallback = !mon.imageUrl;
  const m = replayTrayMetrics(width);
  const barH = Math.max(3, Math.round(m.strip * 0.22));
  const hpFontSize = Math.max(6, Math.round((m.strip * 0.34) / CARD_IMAGE_BUMP));

  // HP as a percentage of the card's printed maximum.
  const hpPct =
    mon.hp != null && mon.hp > 0 && remainingHp != null
      ? Math.max(0, Math.min(100, (remainingHp / mon.hp) * 100))
      : null;
  // Full HP → green, anything above 20% → yellow, 20% or below → red.
  const hpColor =
    hpPct == null
      ? "transparent"
      : hpPct >= 100
        ? "#22c55e"
        : hpPct > 20
          ? "#facc15"
          : "#ef4444";

  return (
    <div
      className={`relative bg-black shadow-sm ${clickable ? "cursor-pointer" : ""}`}
      style={{ width: m.containerW, borderRadius: m.radius, padding: m.pad }}
      title={mon.name}
      role={clickable ? "button" : undefined}
      onClick={clickable ? () => inspect!({ kind: "pokemon", mon }) : undefined}
    >
      {/* Card image — full size (same as the stand-alone cards), inset by the
          holder padding for a concentric corner radius. */}
      <div
        className="relative w-full overflow-hidden bg-white"
        style={{ height: m.cardH, borderRadius: m.cardRadius }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mon.imageUrl ?? CARD_BACK_URL}
          alt={mon.name}
          className="h-full w-full object-cover"
          onError={(e) => {
            if (e.currentTarget.src !== CARD_BACK_URL) {
              e.currentTarget.src = CARD_BACK_URL;
            }
          }}
        />
        {hadFallback && (
          <div className="absolute inset-x-1 top-1 rounded bg-black/60 px-1 py-0.5 text-center text-[7px] font-semibold leading-tight text-white line-clamp-2">
            {mon.name}
          </div>
        )}
        {mon.conditions.length > 0 && (
          // Status pills stay on the card, stacked up from the bottom-right.
          <div className="pointer-events-none absolute bottom-1 right-1 z-10 flex flex-col-reverse items-end gap-0.5">
            {mon.conditions.map((c) => (
              <ConditionPill key={c} condition={c} />
            ))}
          </div>
        )}
        {mon.energyTypes.length > 0 && (
          // Gradient footer matches the Card Catalog's CardFooterOverlay so
          // the energy icons sit on the same darkened band shape across the
          // app. Energies render left-to-right in attach order.
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-start gap-[2px] px-0 pb-1 pt-3 bg-gradient-to-b from-transparent to-black to-80%">
            {mon.energyTypes.map((t, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={i}
                src={`/types/${t.toLowerCase()}.png`}
                alt={t}
                // On the board: 25% smaller on mobile, full size on sm+. In
                // the inspector: scaled proportionally to the enlarged card.
                className={
                  energyIconSize == null
                    ? "h-[7.5px] w-[7.5px] sm:h-[10px] sm:w-[10px]"
                    : undefined
                }
                style={
                  energyIconSize == null
                    ? undefined
                    : { height: energyIconSize, width: energyIconSize }
                }
              />
            ))}
          </div>
        )}
      </div>

      {/* Info strip — HP header (label + remaining/total) above the HP bar. */}
      {hpPct != null && (
        <div
          className="flex flex-col gap-[1px]"
          style={{ marginTop: m.gap }}
        >
          <div
            className="flex items-center justify-between leading-none text-white"
            style={{ fontSize: hpFontSize }}
          >
            <span className="font-bold uppercase">HP</span>
            <span className="font-semibold tabular-nums">{remainingHp}</span>
          </div>
          <div
            className="w-full overflow-hidden rounded-full bg-white/20"
            style={{ height: barH }}
          >
            <div
              className="h-full rounded-full"
              style={{ width: `${hpPct}%`, background: hpColor }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// Prize pile, in the same black holder as the other piles, turned on its side
// to match the draw/discard rotation. Up to 6 landscape card backs stack with
// a small vertical offset so it reads as "a stack of cards"; the label row
// below shows "PRIZES" + remaining count.
function StackedPrizePile({
  label,
  count,
  width,
  rotate,
}: {
  label: string;
  count: number;
  width: number;
  rotate: PileRotate;
}) {
  const m = replayTrayMetrics(width);
  const fontSize = Math.max(6, Math.round((m.strip * 0.34) / CARD_IMAGE_BUMP));
  const layers = Math.max(0, Math.min(6, count));
  // Landscape card slot (long edge spans the holder width).
  const L = width;
  const H = Math.round(width * (245 / 342));
  // Per-layer vertical offset, in px — unchanged by the rotation. The card
  // area grows to contain the stack rather than shrinking the cards.
  const offset = Math.max(2, Math.round(width * 0.06));
  const stackSpan = layers > 0 ? (layers - 1) * offset : 0;
  const areaH = H + stackSpan;

  return (
    <div
      className="relative bg-black shadow-sm"
      style={{ width: m.containerW, borderRadius: m.radius, padding: m.pad }}
      title={label}
    >
      <div className="relative w-full" style={{ height: areaH }}>
        {layers === 0 ? (
          <div
            className="absolute inset-0 flex items-center justify-center border border-dashed border-white/20 text-white/40"
            style={{ borderRadius: m.cardRadius, fontSize }}
          >
            empty
          </div>
        ) : (
          Array.from({ length: layers }).map((_, i) => (
            <div
              key={i}
              className="absolute left-0 right-0 overflow-hidden bg-white shadow-sm"
              style={{
                height: H,
                top: i * offset,
                borderRadius: m.cardRadius,
                zIndex: i,
              }}
            >
              <RotatedCardFace
                src={CARD_BACK_URL}
                alt=""
                ariaHidden
                L={L}
                H={H}
                radius={m.cardRadius}
                rotate={rotate}
              />
            </div>
          ))
        )}
      </div>

      {/* Label row — mirrors the HP header: label left, count right. */}
      <div
        className="flex items-center justify-between leading-none text-white"
        style={{ fontSize, marginTop: m.gap }}
      >
        <span className="font-bold uppercase">{label}</span>
        <span className="font-semibold tabular-nums">{count}</span>
      </div>
    </div>
  );
}

// Card inspector (lightbox) for the replay mat. Mirrors the deck-profile
// card viewer — a gray semi-opaque scrim over the board with the tapped card
// presented large — but a Pokémon opens inside its full holder (HP bar +
// attached energies) rather than as a bare image.
function ReplayCardInspector({
  target,
  onClose,
}: {
  target: InspectTarget;
  onClose: () => void;
}) {
  const [vp, setVp] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const measure = () =>
      setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // Size the presented card to ~80vw / ~78vh, whichever binds first.
  const maxW = vp.w > 0 ? vp.w * 0.8 : 320;
  const maxH = vp.h > 0 ? vp.h * 0.78 : 480;

  const targetName = target.kind === "pokemon" ? target.mon.name : target.name;

  let content: JSX.Element;
  if (target.kind === "pokemon") {
    // The holder is `width * CONTAINER_W_FACTOR` wide and `width *
    // TRAY_TOTAL_RATIO` tall — invert both bounds and take the smaller width.
    const pokeWidth = Math.max(
      140,
      Math.floor(
        Math.min(maxW / CONTAINER_W_FACTOR, maxH / TRAY_TOTAL_RATIO),
      ),
    );
    content = (
      <PokemonCardImage
        mon={target.mon}
        width={pokeWidth}
        inspectable={false}
        energyIconSize={Math.max(12, Math.round(pokeWidth * 0.14))}
      />
    );
  } else {
    // Plain card: bound by the 245/342 aspect.
    const imgW = Math.floor(Math.min(maxW, maxH * (245 / 342)));
    content = (
      <div
        className="relative overflow-hidden rounded-[20px] sm:rounded-3xl bg-white shadow-lg"
        style={{ width: imgW, aspectRatio: "245 / 342" }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={target.imageUrl ?? CARD_BACK_URL}
          alt={target.name}
          className="h-full w-full object-cover"
          onError={(e) => {
            if (e.currentTarget.src !== CARD_BACK_URL)
              e.currentTarget.src = CARD_BACK_URL;
          }}
        />
        {!target.imageUrl && (
          <div className="absolute inset-x-2 top-2 rounded bg-black/60 px-2 py-1 text-center text-sm font-semibold leading-tight text-white line-clamp-2">
            {target.name}
          </div>
        )}
      </div>
    );
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${targetName} preview`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background:
          "linear-gradient(180deg, rgba(242, 242, 242, 1) 0%, rgba(242, 242, 242, 0.85) 100%)",
      }}
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close card viewer"
        className="absolute top-4 left-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition hover:bg-black/70"
      >
        <svg
          className="h-5 w-5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.75}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Stop taps on the card from bubbling to the scrim and dismissing. */}
      <div onClick={(e) => e.stopPropagation()}>{content}</div>
    </div>,
    document.body,
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Turn navigator                                                   */
/* ──────────────────────────────────────────────────────────────── */

function TurnNavigator({
  frameIndex,
  frameCount,
  canStepBack,
  canStepForward,
  canTurnBack,
  canTurnForward,
  playing,
  speed,
  onTogglePlay,
  onCycleSpeed,
  onStepBack,
  onStepForward,
  onTurnBack,
  onTurnForward,
}: {
  frameIndex: number;
  frameCount: number;
  canStepBack: boolean;
  canStepForward: boolean;
  canTurnBack: boolean;
  canTurnForward: boolean;
  playing: boolean;
  speed: 0.5 | 1 | 2 | 4;
  onTogglePlay: () => void;
  onCycleSpeed: () => void;
  onStepBack: () => void;
  onStepForward: () => void;
  onTurnBack: () => void;
  onTurnForward: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onTurnBack}
          disabled={!canTurnBack}
          className="rounded-md border border-black/10 px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Previous turn"
          title="Previous turn"
        >
          ⟪
        </button>
        <button
          type="button"
          onClick={onStepBack}
          disabled={!canStepBack}
          className="rounded-md border border-black/10 px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Previous action"
          title="Previous action"
        >
          ‹
        </button>
        <div className="flex flex-1 flex-col items-center text-center">
          <div className="text-[10px] tabular-nums text-text-muted">
            Step {frameCount > 0 ? frameIndex + 1 : 0} / {frameCount}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onTogglePlay}
              disabled={!playing && !canStepForward}
              aria-label={playing ? "Pause" : "Play"}
              title={playing ? "Pause" : "Play"}
              className="rounded-md border border-black/10 px-3 py-1.5 text-text-secondary hover:bg-surface disabled:opacity-30"
            >
              <PlayPauseIcon playing={playing} />
            </button>
            <button
              type="button"
              onClick={onCycleSpeed}
              aria-label={`Playback speed: ${speedLabel(speed)}`}
              title="Cycle playback speed"
              className="rounded-md border border-black/10 px-2.5 py-1.5 text-xs font-semibold tabular-nums text-text-secondary hover:bg-surface"
            >
              {speedLabel(speed)}
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={onStepForward}
          disabled={!canStepForward}
          className="rounded-md border border-black/10 px-3 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Next action"
          title="Next action"
        >
          ›
        </button>
        <button
          type="button"
          onClick={onTurnForward}
          disabled={!canTurnForward}
          className="rounded-md border border-black/10 px-2.5 py-1 text-xs font-semibold text-text-secondary hover:bg-surface disabled:opacity-30"
          aria-label="Next turn"
          title="Next turn"
        >
          ⟫
        </button>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────── */
/* Match selector                                                   */
/* ──────────────────────────────────────────────────────────────── */

function MatchSelector({
  options,
  selectedId,
  onSelect,
}: {
  options: ReplayMatchOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-black/8 bg-white p-4">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        Recent imported matches
      </div>
      {options.length === 0 ? (
        <p className="py-3 text-xs text-text-secondary">
          No matches with battle logs yet.
        </p>
      ) : (
        <ul className="divide-y divide-black/5">
          {options.map((m) => {
            const active = m.id === selectedId;
            const dt = new Date(m.createdAt);
            const dateLabel = dt.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
            const resultClass =
              m.result === "win"
                ? "bg-emerald-100 text-emerald-700"
                : m.result === "loss"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-gray-100 text-gray-700";
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onSelect(m.id)}
                  className={`flex w-full items-center justify-between gap-3 px-1 py-2 text-left text-xs transition ${
                    active ? "bg-surface" : "hover:bg-surface/60"
                  }`}
                >
                  <div className="flex flex-1 flex-col">
                    <span className="font-semibold text-text-primary">
                      {m.playerHandle ?? "?"}
                      <span className="mx-1 text-text-muted">vs</span>
                      {m.opponentHandle ?? "?"}
                    </span>
                    <span className="text-[11px] text-text-secondary">
                      {m.deckName}
                      {m.opponentArchetype && (
                        <>
                          <span className="text-text-muted"> · </span>
                          {m.opponentArchetype}
                        </>
                      )}
                    </span>
                  </div>
                  {m.result && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${resultClass}`}
                    >
                      {m.result}
                    </span>
                  )}
                  <span className="w-12 text-right text-[11px] tabular-nums text-text-muted">
                    {dateLabel}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
