// The interoperability contract, enforced rather than asserted.
//
// An AI Player game emits a battle log; that log is fed to the REAL TCG
// Live parser (lib/battle-log/parse.ts), and every line must come back as
// a recognised action. The parser labels anything it can't match as
// action_type "unknown", so "zero unknowns" is an exact pass/fail — not a
// judgement call about whether the format "looks right".
//
// This is what lets an AI Player log and a log pasted from TCG Live be
// interchangeable downstream: same parser, same replay reducer, same ML
// feature extraction.

import { describe, it, expect } from "vitest";
import { startGame, applyHumanMove, humanOptions, autoSetup, battleLogText } from "./index";
import { HeuristicPolicy } from "./policy";
import { viewFor } from "./view";
import type { GameSession, InteractiveMove } from "./index";
import { parseBattleLog } from "@/lib/battle-log/parse";
import { sanitizeHandle } from "./battleLog";

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

/** A meta deck, so the log exercises abilities, riders and declarative
 *  effects rather than only the simple move kinds. */
const META = [
  "Pokémon: 14",
  "4 N's Zorua",
  "3 N's Zoroark ex",
  "2 Fezandipiti ex",
  "2 Munkidori TWM 95",
  "3 N's Reshiram",
  "Trainer: 26",
  "4 Ultra Ball SVI 196",
  "4 Buddy-Buddy Poffin",
  "3 Rare Candy",
  "3 Boss's Orders",
  "4 Iono",
  "4 Professor's Research",
  "4 Nest Ball SVI 181",
  "Energy: 20",
  "20 Basic Darkness Energy",
].join("\n");

/** Play a whole game with a scripted human, return the finished session. */
function playFullGame(deck: string, seed: number): GameSession {
  const session = startGame({
    deckHuman: deck,
    deckAi: deck,
    skill: 0.9,
    seed,
    handles: { player: "TestTrainer", opponent: "Dexter" },
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

describe("AI Player games emit a parseable TCG Live battle log", () => {
  for (const [name, deck, seed] of [
    ["a simple deck", DECK, 11],
    ["a meta deck (abilities, riders, declarative effects)", META, 7],
    ["a second seed", META, 23],
  ] as const) {
    it(`round-trips through the real parser — ${name}`, () => {
      const session = playFullGame(deck, seed);
      const text = battleLogText(session);
      expect(text.length).toBeGreaterThan(200);

      const parsed = parseBattleLog(text);
      const unknown = parsed.actions.filter((a) => a.action_type === "unknown");
      // Name the offending lines: a bare count tells you nothing about
      // which emitter line drifted from the parser's vocabulary.
      expect(
        unknown.map((a) => a.raw_text),
        "emitted lines the TCG Live parser does not recognise",
      ).toEqual([]);

      // The parse must also be structurally sound, not merely unknown-free.
      expect(parsed.turns.length).toBeGreaterThan(2);
      expect(parsed.handles.length).toBe(2);
      expect(parsed.handles).toContain("TestTrainer");
      expect(parsed.handles).toContain("Dexter");
    });
  }

  it("records both players' setup and a result line", () => {
    const session = playFullGame(DECK, 11);
    const text = battleLogText(session);
    expect(text.startsWith("Setup\n")).toBe(true);
    expect(text).toContain("won the coin toss.");
    expect(text).toContain("to the Active Spot.");
    // Every game we can finish ends with a TCG Live result line, unless it
    // hit the turn cap (a draw has no such line in the real format).
    if (session.outcome?.winner) expect(text).toMatch(/wins\.\n?$/);
  });

  it("is a pure function of the transcript — a rebuild renders the same text", async () => {
    const { rebuildSession } = await import("./interactive");
    const session = playFullGame(META, 7);
    const rebuilt = rebuildSession(session.transcript);
    expect(battleLogText(rebuilt)).toBe(battleLogText(session));
  });

  it("never reveals the AI's hand contents", () => {
    const session = playFullGame(META, 7);
    const text = battleLogText(session);
    // The AI's opening hand is summarised the way a real log summarises the
    // opponent's, rather than listed card by card.
    const dexterOpening = text
      .split("\n")
      .findIndex((l) => l.startsWith("Dexter drew ") && l.includes("for the opening hand"));
    expect(dexterOpening).toBeGreaterThan(-1);
    expect(text.split("\n")[dexterOpening + 1]).toMatch(/^- \d+ drawn cards\.$/);
  });
});

describe("handles are made safe for the log grammar", () => {
  it("strips apostrophes, which are load-bearing in the format", () => {
    // "<handle>'s Turn" and "<handle>'s <mon> used ..." both split on the
    // apostrophe — a handle containing one would mis-parse the whole game.
    expect(sanitizeHandle("O'Brien", "You")).toBe("OBrien");
    expect(sanitizeHandle("Ash’s Pikachu", "You")).toBe("Ashs Pikachu");
  });

  it("falls back rather than emitting an empty handle", () => {
    expect(sanitizeHandle("", "You")).toBe("You");
    expect(sanitizeHandle("   ", "Dexter")).toBe("Dexter");
  });

  it("collapses newlines, which would forge log lines", () => {
    expect(sanitizeHandle("evil\nDexter's Turn", "You")).toBe("evil Dexters Turn");
  });
});
