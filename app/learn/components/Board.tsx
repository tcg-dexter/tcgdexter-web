"use client";

/**
 * The play area, drawn as an actual board mid-game.
 *
 * This is not a diagram of the mat — it *is* the mat. `PlayerMat`
 * (app/admin-tools/replay/BoardKit.tsx) is the same component the replay
 * viewer and the practice mode render, fed a hand-written game state instead
 * of a real frame, so a learner who finishes the curriculum and opens a
 * replay is looking at a board they have already seen. An abstract diagram
 * had to be kept in sync with the real thing by hand; this can't drift.
 *
 * The one substitution: every face-up card renders as its *name in text*
 * rather than its art (`face="label"` — see CardFace in BoardKit). A lesson
 * teaching where the Active sits is served by the word "Active"; real card
 * art would make the reader study a matchup instead of a board. Face-down
 * zones (Draw, Prizes) keep their card backs, because being face down is the
 * point of them.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  CardLabelFace,
  PlayerMat,
  computeReplayCardWidth,
  replayTrayMetrics,
  type PokemonFrame,
} from "@/app/admin-tools/replay/BoardKit";

// Matches the replay viewer's own guard: measuring before paint avoids a
// card-width flash, but useLayoutEffect warns during SSR.
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** A Pokémon in play. Only the fields the board actually draws are set —
 *  the rest are the empty values a real frame would carry. */
function mon(
  id: string,
  name: string,
  extra: Partial<PokemonFrame> = {},
): PokemonFrame {
  return {
    id,
    name,
    damage: 0,
    hp: null,
    energy: [],
    energyTypes: [],
    conditions: [],
    evolutionStack: [],
    imageUrl: null,
    tools: [],
    ...extra,
  };
}

type SideState = {
  active: PokemonFrame;
  bench: PokemonFrame[];
  prizesRemaining: number;
  deckCount: number;
  discardCount: number;
  discardTop: string | null;
  stadium: { name: string; imageUrl: string | null } | null;
  lastPlayedTrainer: { name: string; imageUrl: string | null } | null;
};

type Scene = { you: SideState; opponent: SideState; hand: string[] };

/**
 * Two boards, because `<Board />` is used twice and the two lessons need
 * different moments. "setup" is the position at the end of setup — full
 * Prizes, empty discard, nothing played yet, which is exactly what the
 * setup lesson's prose describes. "midgame" is a live board: damage on the
 * Actives, Prizes taken, a Stadium out, a Trainer just played.
 */
const SCENES: Record<"midgame" | "setup", Scene> = {
  midgame: {
    you: {
      active: mon("you-active", "Active", {
        hp: 190,
        damage: 60,
        energyTypes: ["Fire", "Fire"],
      }),
      bench: [
        mon("you-bench-1", "Bench", { hp: 60, damage: 0 }),
        mon("you-bench-2", "Bench", { hp: 130, damage: 30, energyTypes: ["Fire"] }),
        mon("you-bench-3", "Bench", { hp: 70, damage: 0 }),
      ],
      prizesRemaining: 4,
      deckCount: 28,
      discardCount: 9,
      discardTop: "Trainer",
      stadium: { name: "Stadium", imageUrl: null },
      lastPlayedTrainer: { name: "Just played", imageUrl: null },
    },
    opponent: {
      active: mon("opp-active", "Active", {
        hp: 170,
        damage: 120,
        energyTypes: ["Water"],
      }),
      bench: [
        mon("opp-bench-1", "Bench", { hp: 110, damage: 0 }),
        mon("opp-bench-2", "Bench", { hp: 60, damage: 0 }),
      ],
      prizesRemaining: 5,
      deckCount: 26,
      discardCount: 12,
      discardTop: "Pokémon",
      stadium: null,
      lastPlayedTrainer: null,
    },
    hand: ["Pokémon", "Trainer", "Trainer", "Energy"],
  },
  setup: {
    you: {
      active: mon("you-active", "Active", { hp: 60, damage: 0 }),
      bench: [mon("you-bench-1", "Bench", { hp: 70, damage: 0 })],
      prizesRemaining: 6,
      deckCount: 47,
      discardCount: 0,
      discardTop: null,
      stadium: null,
      lastPlayedTrainer: null,
    },
    opponent: {
      active: mon("opp-active", "Active", { hp: 70, damage: 0 }),
      bench: [mon("opp-bench-1", "Bench", { hp: 60, damage: 0 })],
      prizesRemaining: 6,
      deckCount: 47,
      discardCount: 0,
      discardTop: null,
      stadium: null,
      lastPlayedTrainer: null,
    },
    hand: ["Pokémon", "Trainer", "Trainer", "Energy", "Energy"],
  },
};

/** Your hand, below your mat — where the replay viewer puts it. Card holders
 *  are built from the same tray metrics the mat uses, so a hand card reads as
 *  the same size of card as one in play. */
function HandRow({ labels, cardWidth }: { labels: string[]; cardWidth: number }) {
  const m = replayTrayMetrics(cardWidth);
  return (
    <div className="mt-2 flex flex-wrap items-end justify-center gap-1">
      {labels.map((label, i) => (
        <div
          key={i}
          className="relative bg-black shadow-sm"
          style={{ width: m.containerW, borderRadius: m.radius, padding: m.pad }}
        >
          <div
            className="relative w-full overflow-hidden bg-white"
            style={{ height: m.cardH, borderRadius: m.cardRadius }}
          >
            <CardLabelFace text={label} width={cardWidth} />
          </div>
        </div>
      ))}
    </div>
  );
}

function SideLabel({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted">
      {children}
    </p>
  );
}

export default function Board({
  stage = "midgame",
}: {
  /** Which moment to draw. Defaults to a live board; the setup lesson asks
   *  for "setup", the position its prose is describing. */
  stage?: "midgame" | "setup";
}) {
  const scene = SCENES[stage] ?? SCENES.midgame;
  const containerRef = useRef<HTMLDivElement>(null);
  const [matWidth, setMatWidth] = useState(300);

  useIsomorphicLayoutEffect(() => {
    const el = containerRef.current;
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

  // `side` is which way a mat is oriented, not whose cards it holds — the
  // opponent takes the top slot ("player" orientation, tray pinned to that
  // slot's floor) and you take the bottom, so the two Actives meet in the
  // middle. Same convention as the replay viewer; see its comment there.
  const mats = (
    <>
      <SideLabel>Opponent</SideLabel>
      <PlayerMat
        side="player"
        face="label"
        instant
        {...scene.opponent}
        handCount={4}
        cardWidth={cardWidth}
        matWidth={matWidth}
      />
      <SideLabel>You</SideLabel>
      <PlayerMat
        side="opponent"
        face="label"
        instant
        {...scene.you}
        handCount={scene.hand.length}
        cardWidth={cardWidth}
        matWidth={matWidth}
      />
    </>
  );

  return (
    <figure className="my-6">
      <div ref={containerRef} className="flex flex-col gap-1.5">
        {mats}
        <HandRow labels={scene.hand} cardWidth={cardWidth} />
      </div>
      <figcaption className="mt-3 text-center text-xs text-text-muted">
        {stage === "setup"
          ? "The board the moment setup finishes: six Prizes each, one Active, a Bench started, nothing in the discard."
          : "A game in progress. Face-up cards are labelled by what they are rather than shown as art — this is the same board the replay viewer draws."}
      </figcaption>
    </figure>
  );
}
