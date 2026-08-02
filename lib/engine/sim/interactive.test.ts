// Milestone B acceptance: a scripted full game against the AI through the
// session layer, illegal-move rejection, transcript replay determinism,
// and redaction of the serialized client view.

import { describe, it, expect } from "vitest";
import {
  applyHumanMove,
  humanOptions,
  rebuildSession,
  startGame,
  IllegalMoveError,
  HeuristicPolicy,
  serializeView,
  viewFor,
} from "./index";
import type { GameSession, InteractiveMove } from "./index";
import type { TurnContext } from "./moves";

const DECK = [
  "Pokémon: 12",
  "4 Miraidon ex SVI 81",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 24",
  "24 Basic Lightning Energy SVE 4",
].join("\n");

/** Script the human with the HeuristicPolicy so games resolve sensibly. */
function scriptedHumanMove(session: GameSession): InteractiveMove {
  const options = humanOptions(session);
  if (session.status === "human_promotion") return options[0];
  const policy = new HeuristicPolicy();
  const ctx: TurnContext = { retreated: session.ctx.retreated };
  return policy.chooseMove(
    viewFor(session.state, "player"),
    options as Parameters<HeuristicPolicy["chooseMove"]>[1],
    ctx,
  );
}

function playFullGame(seed: number): GameSession {
  const session = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.95, seed });
  for (let i = 0; i < 500 && session.status !== "over"; i++) {
    applyHumanMove(session, scriptedHumanMove(session));
  }
  return session;
}

describe("interactive session", () => {
  it("plays a full scripted game to completion with only legal moves", () => {
    const session = playFullGame(11);
    expect(session.status).toBe("over");
    expect(session.outcome).not.toBeNull();
    expect(["prizes", "no_active", "deck_out", "turn_cap"]).toContain(session.outcome!.endReason);
    expect(session.transcript.moves.length).toBeGreaterThan(10);
  });

  it("rejects illegal moves and bad promotions", () => {
    const session = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed: 3 });
    expect(session.status).toBe("human_turn");
    // Attacking with a fabricated index / promoting with none pending.
    expect(() => applyHumanMove(session, { kind: "attack", attackIndex: 9 })).toThrow(IllegalMoveError);
    expect(() => applyHumanMove(session, { kind: "promote", benchIndex: 0 })).toThrow(IllegalMoveError);
    // Session is still usable after rejections.
    applyHumanMove(session, scriptedHumanMove(session));
    expect(session.status === "human_turn" || session.status === "over").toBe(true);
  });

  it("transcript replay reproduces the exact same game", () => {
    const live = playFullGame(21);
    const rebuilt = rebuildSession(live.transcript);
    expect(rebuilt.status).toBe("over");
    expect(rebuilt.outcome).toEqual(live.outcome);
    expect(rebuilt.state.prizesTaken).toEqual(live.state.prizesTaken);
    expect(rebuilt.transcript.moves).toEqual(live.transcript.moves);
  });

  it("mid-game replay lands on the same decision point", () => {
    const session = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.95, seed: 33 });
    for (let i = 0; i < 12 && session.status !== "over"; i++) {
      applyHumanMove(session, scriptedHumanMove(session));
    }
    const rebuilt = rebuildSession(session.transcript);
    expect(rebuilt.status).toBe(session.status);
    expect(rebuilt.state.turn.number).toBe(session.state.turn.number);
    expect(JSON.stringify(humanOptions(rebuilt))).toBe(JSON.stringify(humanOptions(session)));
    expect(serializeView(viewFor(rebuilt.state, "player"))).toEqual(
      serializeView(viewFor(session.state, "player")),
    );
  });

  it("logs one feature row per completed turn with consistent accounting", () => {
    const session = playFullGame(11);
    expect(session.turnLog.length).toBe(session.outcome!.turns);
    let lastPlayer = 0;
    let lastOpponent = 0;
    for (const row of session.turnLog) {
      expect(row.prize_diff).toBe(row.prizes_player - row.prizes_opponent);
      expect(row.prizes_player).toBeGreaterThanOrEqual(lastPlayer);
      expect(row.prizes_opponent).toBeGreaterThanOrEqual(lastOpponent);
      lastPlayer = row.prizes_player;
      lastOpponent = row.prizes_opponent;
      // Flags ride along on every row.
      expect([0, 1]).toContain(row.flag_missed_energy_attach);
    }
    expect(lastPlayer).toBe(session.outcome!.prizesTaken.player);
    expect(lastOpponent).toBe(session.outcome!.prizesTaken.opponent);
    // Replay rebuilds the identical log.
    expect(rebuildSession(session.transcript).turnLog).toEqual(session.turnLog);
  });

  it("serialized client view redacts all hidden zones", () => {
    const session = startGame({ deckHuman: DECK, deckAi: DECK, skill: 0.5, seed: 7 });
    const view = serializeView(viewFor(session.state, "player"));
    const opponent = view.opponent as unknown as Record<string, unknown>;
    expect(opponent.hand).toBeUndefined();
    expect(opponent.deck).toBeUndefined();
    expect(typeof opponent.handCount).toBe("number");
    const raw = JSON.stringify(view);
    // No unrevealed placeholders should even need to appear client-side.
    expect(raw).not.toContain("(unrevealed)");
  });
});

/* ─── Human reachability of the W3 move shapes ──────────────────── */

// W3 gave the engine 100% effect coverage, but the play UI only ever looked
// for effect moves whose `sourceId` was a HAND card. Declarative activated
// abilities carry `sourceId` = a Pokémon in play, so every one of them was
// enumerated for the AI and unreachable for the human. These pin the SESSION
// side of that: the moves are offered, and the validator accepts them.
describe("declarative abilities are playable by a human", () => {
  /** A deck whose engine is a declarative activated ability. */
  const ABILITY_DECK = [
    "Pokémon: 12",
    "4 Lunatone MEE 74",
    "4 Solrock MEE 73",
    "4 Snorlax SVI 143",
    "Trainer: 24",
    "12 Ultra Ball SVI 196",
    "12 Nest Ball SVI 181",
    "Energy: 24",
    "24 Basic Fighting Energy SVE 6",
  ].join("\n");

  it("offers ability moves sourced from a Pokémon in play, and accepts them", () => {
    let found = false;
    // Several seeds: the ability needs its Pokémon benched, which is a draw.
    for (let seed = 0; seed < 40 && !found; seed++) {
      const session = startGame({ deckHuman: ABILITY_DECK, deckAi: ABILITY_DECK, seed });
      for (let step = 0; step < 30 && session.status === "human_turn"; step++) {
        const options = humanOptions(session);
        const inPlay = new Set(
          [session.state.sides.player.active, ...session.state.sides.player.bench]
            .filter((m) => m !== null)
            .map((m) => m!.id),
        );
        const abilityMove = options.find(
          (m) => m.kind === "effect" && inPlay.has((m as { sourceId: string }).sourceId),
        );
        if (abilityMove) {
          // The whole point: this must NOT throw. If validate rejected moves
          // it had itself enumerated, the human path would be broken.
          expect(() => applyHumanMove(session, abilityMove)).not.toThrow();
          found = true;
          break;
        }
        const next = scriptedHumanMove(session);
        try {
          applyHumanMove(session, next);
        } catch {
          break;
        }
      }
    }
    expect(found).toBe(true);
  });
});
