// What actually gets stored for a finished AI Player game.
//
// buildAiBattleRow is kept pure so this needs no database. The parts worth
// pinning are the ones that are quietly wrong-able: the winner is recorded
// from the ROW's point of view ("user"/"ai") rather than the engine's
// ("player"/"opponent"), the deck lists are stored verbatim rather than by
// reference, and the client-supplied labels are never trusted as-is.

import { describe, it, expect } from "vitest";
import { startGame, applyHumanMove, humanOptions, autoSetup, SIM_VERSION } from "@/lib/engine/sim";
import type { GameSession, InteractiveMove } from "@/lib/engine/sim";
import { HeuristicPolicy } from "@/lib/engine/sim/policy";
import { viewFor } from "@/lib/engine/sim/view";
import { buildAiBattleRow } from "./record";
import { parseBattleLog } from "@/lib/battle-log/parse";

const DECK = [
  "Pokémon: 12",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "4 Munkidori TWM 95",
  "Trainer: 20",
  "4 Ultra Ball SVI 196",
  "4 Nest Ball SVI 181",
  "4 Boss's Orders",
  "4 Iono",
  "4 Professor's Research",
  "Energy: 28",
  "28 Basic Darkness Energy",
].join("\n");

const AI_DECK = DECK.replace("4 Snorlax SVI 143", "4 Snorlax SVI 143"); // same list, distinct string

function finishedGame(seed = 11): GameSession {
  const session = startGame({
    deckHuman: DECK,
    deckAi: AI_DECK,
    skill: 0.9,
    seed,
    handles: { player: "Christian", opponent: "Dexter" },
  });
  autoSetup(session);
  const policy = new HeuristicPolicy();
  for (let i = 0; i < 600 && session.status !== "over"; i++) {
    const options = humanOptions(session);
    if (options.length === 0) break;
    const move: InteractiveMove =
      session.status === "human_promotion"
        ? options[0]
        : policy.chooseMove(viewFor(session.state, "player"), options as never, session.ctx) ?? {
            kind: "pass",
          };
    applyHumanMove(session, move);
  }
  return session;
}

describe("buildAiBattleRow", () => {
  it("captures the minimum the user asked for: when, both deck lists, the log", () => {
    const session = finishedGame();
    const row = buildAiBattleRow(session, "user-1");

    // played_at is a database default (now()), so the row carries no
    // timestamp of its own — asserting the rest.
    expect(row.user_deck_list).toBe(DECK);
    expect(row.ai_deck_list).toBe(AI_DECK);
    expect(row.battle_log).toContain("Setup");
    expect(row.battle_log).toContain("Christian");
    expect(row.battle_log).toContain("Dexter");
    expect(row.user_id).toBe("user-1");
  });

  it("stores a log the TCG Live parser reads", () => {
    // The interoperability claim, asserted on the stored artifact rather
    // than only on the emitter's output.
    const row = buildAiBattleRow(finishedGame(), "user-1");
    const parsed = parseBattleLog(row.battle_log);
    expect(parsed.actions.filter((a) => a.action_type === "unknown")).toEqual([]);
    expect(parsed.turns.length).toBeGreaterThan(2);
  });

  it("re-frames the winner from the engine's seat to the row's owner", () => {
    const session = finishedGame();
    const row = buildAiBattleRow(session, "user-1");
    const expected =
      session.outcome?.winner == null ? null : session.outcome.winner === "player" ? "user" : "ai";
    expect(row.winner).toBe(expected);
    expect(["user", "ai", null]).toContain(row.winner);
  });

  it("records provenance, so rows from different engines stay comparable", () => {
    const row = buildAiBattleRow(finishedGame(), "user-1");
    expect(row.sim_version).toBe(SIM_VERSION);
    expect(row.skill).toBe(0.9);
    expect(typeof row.seed).toBe("number");
    expect(row.user_went_first).toBe(finishedGame().transcript.human_first);
  });

  it("stores a transcript that still replays the game", async () => {
    const { rebuildSession, battleLogText } = await import("@/lib/engine/sim");
    const session = finishedGame();
    const row = buildAiBattleRow(session, "user-1");
    const rebuilt = rebuildSession(row.transcript as never);
    expect(rebuilt.status).toBe("over");
    expect(battleLogText(rebuilt)).toBe(row.battle_log);
  });

  it("does not trust client-supplied labels", () => {
    const session = finishedGame();
    const row = buildAiBattleRow(session, "user-1", {
      userDeckName: "  My Deck  ",
      aiDeckName: "x".repeat(500),
      savedDeckId: "not-a-uuid",
    });
    expect(row.user_deck_name).toBe("My Deck");
    expect(row.ai_deck_name?.length).toBe(120);
    // A malformed id is dropped rather than passed to Postgres as a uuid.
    expect(row.saved_deck_id).toBeNull();
  });

  it("keeps a well-formed saved_deck_id", () => {
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const row = buildAiBattleRow(finishedGame(), "user-1", { savedDeckId: id });
    expect(row.saved_deck_id).toBe(id);
  });
});
