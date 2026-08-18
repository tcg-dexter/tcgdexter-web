import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

const EXAMPLE = readFileSync(
  join(__dirname, "..", "battle-log", "fixtures", "example-1.txt"),
  "utf8",
);

describe("engine.replay (example-1)", () => {
  // Player = MoonSheikah, opponent = a11father (who wins the game).
  const parsed = normalizePerspective(parseBattleLog(EXAMPLE), "MoonSheikah");
  const result = replay(parsed);

  it("emits exactly one event per parsed action", () => {
    expect(result.events.length).toBe(parsed.actions.length);
  });

  it("ends with the prize-out victory recorded against the opponent", () => {
    expect(result.finalState.endReason).toBe("prizes");
    expect(result.finalState.winner).toBe("opponent");
  });

  it("tallies the prize counts both sides ended with", () => {
    // a11father took: 1 (Staryu) + 3 (Mega Greninja ex, multi-prize boost)
    //                + 2 (Budew & Froakie double-KO) = 6 prizes.
    expect(result.finalState.prizesTaken.opponent).toBe(6);
    // MoonSheikah took 2 prizes (a11father's N's Zoroark ex was an ex KO).
    expect(result.finalState.prizesTaken.player).toBe(2);
  });

  it("empties the opponent's prize stack since they prized out", () => {
    expect(result.finalState.sides.opponent.prizes.length).toBe(0);
  });

  it("places knocked-out Pokémon into the right side's discard pile", () => {
    // The engine reflects what the parser surfaces. Buddy-Buddy Poffin's
    // search-and-bench effect is one example — see the parser-gap follow-up.
    // "drew 2 cards and played them to the Bench" line is not yet split
    // into individual play_to_bench actions, so cards added that way
    // (Staryu, Froakie, the eventual Mega Greninja ex line) never enter
    // the engine's bench and can't be tracked through to KO. The engine
    // surfaces this gap via "evolve_source_missing" / "switch_target_missing"
    // diagnostics; the assertions below cover only directly-played Pokémon.
    const playerDiscardNames = result.finalState.sides.player.discard.map((c) => c.name);
    expect(playerDiscardNames).toContain("Budew");

    const oppDiscardNames = result.finalState.sides.opponent.discard.map((c) => c.name);
    expect(oppDiscardNames).toContain("N's Zoroark ex");
  });

  it("flags parser gaps via warn-level diagnostics rather than silently dropping state", () => {
    const codes = new Set(result.diagnostics.map((d) => d.code));
    // The Buddy-Buddy Poffin path means Froakie never reaches the bench,
    // so the later "evolved Froakie to Frogadier" raises this code.
    expect(codes.has("evolve_source_missing")).toBe(true);
  });

  it("tracks the active stadium card and its owner", () => {
    // The last stadium played was Surfing Beach by MoonSheikah; it should
    // still be in play when the game ends.
    expect(result.finalState.stadium?.card.name).toBe("Surfing Beach");
    expect(result.finalState.stadium?.owner).toBe("player");
  });

  it("identifies the first player from the chose_first event", () => {
    expect(result.finalState.firstPlayer).toBe("player");
  });

  it("records mulligan totals on the right side", () => {
    expect(result.finalState.sides.player.mulligans).toBe(3);
    expect(result.finalState.sides.opponent.mulligans).toBe(0);
  });

  it("produces no error-severity diagnostics for this clean replay", () => {
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });

  // The Replay board keys React elements and framer-motion layoutIds off
  // each Pokémon's engine id. Names are NOT unique — this fixture puts three
  // N's Zorua in play at once — so if two in-play Pokémon on a side ever
  // shared an id, the board would key them identically and framer-motion
  // would animate unrelated cards into each other's slots, stranding ghost
  // cards outside the bench row (the phantom "6th bench card" bug).
  describe("in-play Pokémon ids (the board's element identity)", () => {
    const inPlayOn = (state: (typeof result.states)[number], side: "player" | "opponent") => {
      const s = state.sides[side];
      return [...(s.active ? [s.active] : []), ...s.bench];
    };

    it("stay unique per side in every state of the replay", () => {
      for (const state of result.states) {
        for (const side of ["player", "opponent"] as const) {
          const ids = inPlayOn(state, side).map((mon) => mon.id);
          expect(new Set(ids).size).toBe(ids.length);
        }
      }
    });

    it("is not a vacuous guard — this replay really does field same-named Pokémon together", () => {
      const maxSameName = result.states.reduce((max, state) => {
        for (const side of ["player", "opponent"] as const) {
          const counts = new Map<string, number>();
          for (const mon of inPlayOn(state, side)) {
            const n = (counts.get(mon.card.name) ?? 0) + 1;
            counts.set(mon.card.name, n);
            if (n > max) max = n;
          }
        }
        return max;
      }, 0);
      expect(maxSameName).toBeGreaterThanOrEqual(2);
    });
  });

  // A promotion line is the log stating outright which Pokémon is now
  // Active, so the board must show one afterwards. It used to be dropped
  // when the target wasn't on the engine's tracked bench — which happens
  // whenever the parser doesn't split a bulk bench line into per-card
  // actions — leaving the Active spot empty for every frame from the
  // knockout onward. This fixture promotes a Frogadier benched exactly
  // that way.
  describe("promotions always seat an Active Pokémon", () => {
    const promotions = parsed.actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => action.action_type === "switch_active");

    it("is not a vacuous guard — the replay contains promotions", () => {
      expect(promotions.length).toBeGreaterThan(0);
    });

    it("seats the named Pokémon, even one never tracked onto the bench", () => {
      for (const { action, index } of promotions) {
        if (action.actor !== "player" && action.actor !== "opponent") continue;
        const named = String(
          (action.payload as Record<string, unknown>).pokemon ?? "",
        );
        expect(result.states[index].sides[action.actor].active?.card.name).toBe(named);
      }
    });
  });
});

const SAME_NAME_ATTACH = readFileSync(
  join(
    __dirname,
    "..",
    "battle-log",
    "fixtures",
    "example-3-same-name-attach.txt",
  ),
  "utf8",
);

// A real reported bug: turn 17 showed two Cynthia's Power Weight (a
// Pokémon Tool, one-per-Pokémon by the actual game rules) on one
// Pokémon. findPokemon() checked the active slot before the bench
// regardless of what the log said, so "attached X to Y on the Bench"
// resolved to an active same-named Y whenever one happened to be
// there — attaching to (and, through evolve, permanently carrying
// forward into) the wrong Pokémon instead of the bench one the log
// named. This fixture is the real match, trimmed to nothing: it's
// the actual battle_log_raw the bug was filed against.
describe("engine.replay (example-3: same-name active/bench attach target)", () => {
  const parsed = normalizePerspective(parseBattleLog(SAME_NAME_ATTACH), "Nnova12");
  const result = replay(parsed);

  function actionIndex(rawText: string): number {
    const i = parsed.actions.findIndex((a) => a.raw_text === rawText);
    expect(i, `expected to find action: ${rawText}`).toBeGreaterThanOrEqual(0);
    return i;
  }

  it("is not a vacuous guard — the fixture contains the colliding attach pair", () => {
    expect(
      parsed.actions.some(
        (a) =>
          a.action_type === "attach_energy" &&
          a.payload.target === "Cynthia's Gabite" &&
          a.payload.location === "bench",
      ),
    ).toBe(true);
    expect(
      parsed.actions.some(
        (a) =>
          a.action_type === "attach_energy" &&
          a.payload.target === "Cynthia's Gabite" &&
          a.payload.location === "active",
      ),
    ).toBe(true);
  });

  it("attaches a bench-targeted card to the bench Pokémon, not the active one", () => {
    const idx = actionIndex(
      "Nnova12 attached Cynthia's Power Weight to Cynthia's Gabite on the Bench.",
    );
    const side = result.states[idx].sides.player;
    const activeHasIt = side.active?.attachedEnergy.some(
      (c) => c.name === "Cynthia's Power Weight",
    );
    const benchHolder = side.bench.find((mon) =>
      mon.attachedEnergy.some((c) => c.name === "Cynthia's Power Weight"),
    );
    expect(activeHasIt).toBe(false);
    expect(benchHolder).toBeDefined();
  });

  it("doesn't let the bench attach linger on the later active Pokémon it evolves into", () => {
    // The bench Gabite above is knocked out and its Power Weight discarded
    // before this second, unrelated Power Weight is drawn and attached to
    // whichever Garchomp ex is active by then. The bug made the first one
    // stick around on the wrong (active) lineage the whole time, so by
    // this point the active Pokémon held both.
    const idx = actionIndex(
      "Nnova12 attached Cynthia's Power Weight to Cynthia's Garchomp ex in the Active Spot.",
    );
    const active = result.states[idx].sides.player.active;
    const count = active?.attachedEnergy.filter(
      (c) => c.name === "Cynthia's Power Weight",
    ).length;
    expect(count).toBe(1);
  });
});
