"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { Beat } from "@/lib/replay2/beats";
import type { BeatPhase } from "../director/choreography";

/**
 * The end of the game, on the board.
 *
 * Every other beat is announced by the cards it involves, but nothing is left
 * to animate when a game ends: the winning attack has already resolved and
 * the last prize is already taken. Without something at the board level the
 * replay's longest, most deliberately paced beat plays out over a completely
 * still board — the one moment the whole replay has been building to, and it
 * looked identical to a shuffle.
 *
 * A sweep of light across the winner's half, and their name. Deliberately at
 * board level rather than per-mat: this is the only moment in the replay that
 * is about the game rather than about a card.
 */
export function GameEndFlourish({
  beat,
  phase,
  reducedMotion,
  /** Which visual half the winner occupies. The board pins the submitting
   *  player to the bottom mat and the opponent to the top, so this maps the
   *  actor onto a screen position rather than assuming either. */
  winnerEdge,
  winnerName,
}: {
  beat: Beat | null;
  phase: BeatPhase;
  reducedMotion: boolean;
  winnerEdge: "top" | "bottom" | null;
  winnerName: string | null;
}) {
  const active =
    beat?.kind === "game_end" && beat.winner != null && phase !== "anticipate";

  return (
    <AnimatePresence>
      {active && !reducedMotion && (
        <motion.div
          key="game-end"
          className="pointer-events-none absolute inset-0 z-50 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
        >
          {/* Light gathering on the winner's half. Anchored to their edge so
              the board itself says who won before the label is read. */}
          {winnerEdge && (
            <motion.div
              className="absolute inset-x-0"
              style={{
                [winnerEdge]: 0,
                height: "50%",
                background:
                  winnerEdge === "bottom"
                    ? "linear-gradient(to top, rgba(255,238,170,0.55), transparent 78%)"
                    : "linear-gradient(to bottom, rgba(255,238,170,0.55), transparent 78%)",
                // Round the corners on the winner's edge to the mat's own
                // rounded-xl (12px). Without this the square glow fills the
                // transparent triangles outside the mat's rounded corners, so
                // the mat's bottom (or top) reads as square during the win.
                borderRadius:
                  winnerEdge === "bottom" ? "0 0 12px 12px" : "12px 12px 0 0",
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0.72] }}
              transition={{ duration: 1.1, ease: "easeOut" }}
            />
          )}
          {/* A single band sweeping the full board — the light going out
              across the table, once. */}
          <motion.div
            className="absolute inset-y-0"
            style={{
              width: "40%",
              background:
                "linear-gradient(105deg, transparent, rgba(255,255,255,0.5) 50%, transparent)",
              mixBlendMode: "overlay",
            }}
            initial={{ left: "-45%" }}
            animate={{ left: "105%" }}
            transition={{ duration: 0.95, ease: "easeInOut" }}
          />
          {winnerName && (
            // The name on a plate, centred over the winner's OWN mat (their
            // half) rather than the whole board — a mat overlay, so it reads as
            // belonging to their side. The plate mirrors the house skewed-gold
            // bar (SetupCeremony's MatPlate); the text keeps its original size.
            <motion.div
              className="absolute inset-x-0 flex items-center justify-center"
              style={{ [winnerEdge ?? "bottom"]: 0, height: "50%" }}
              initial={{ opacity: 0, scale: 1.3 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 22, delay: 0.18 }}
            >
              <div className="relative flex items-center justify-center">
                <div
                  aria-hidden
                  className="absolute inset-y-0 -inset-x-3"
                  style={{
                    background: "linear-gradient(100deg, #b45309, #f59e0b)",
                    transform: "skewX(-13deg)",
                    boxShadow: "0 6px 22px rgba(245,158,11,0.6)",
                    borderRadius: 4,
                  }}
                />
                <span
                  className="relative select-none whitespace-nowrap px-5 py-1.5 text-center font-black uppercase tracking-[0.14em] text-white"
                  style={{
                    fontSize: "clamp(14px, 3.2vw, 34px)",
                    textShadow: "0 2px 6px rgba(0,0,0,0.6)",
                  }}
                >
                  {winnerName} wins
                </span>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
