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

  it("replays the whole fixture without losing track of a Pokémon", () => {
    // This used to assert the opposite: that "evolved Froakie to Frogadier"
    // raised evolve_source_missing, because the Buddy-Buddy Poffin line that
    // benched Froakie ("drew 2 cards and played them to the Bench", with the
    // names on the bullet underneath) was dropped by the parser and the
    // Pokémon never reached the board.
    //
    // The parser reads those lines now, and the whole cascade this fixture
    // used to produce — evolve_source_missing, attach_target_missing,
    // switch_target_missing, ko_target_missing — is gone with it. What is
    // left is informational only. Keeping the assertion pointed at "no warn
    // or error" rather than deleting it means a future parser change that
    // re-loses a Pokémon fails here instead of quietly degrading the board.
    const loud = result.diagnostics.filter((d) => d.severity !== "info");
    expect(loud.map((d) => `${d.severity}:${d.code} ${d.message}`)).toEqual([]);
  });

  it("still surfaces a genuine rules conflict rather than swallowing it", () => {
    // The counterpart to the assertion above: quiet diagnostics on example-1
    // must mean "nothing went wrong", not "the machinery stopped reporting".
    // A log that plays a sixth Pokémon onto a five-slot bench with nothing
    // leaving is a genuine over-fill, and the engine must warn.
    //
    // (This used to point at example-3, whose apparent "seventh Pokémon" was
    // actually a Dudunsparce shuffling itself back into the deck via Run Away
    // Draw — a legal move the parser dropped, leaving a phantom on the bench.
    // Now that self-return is modelled, that fixture is clean, so the positive
    // control is a synthetic log that truly breaks the cap.)
    const OVERFILL = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played Pikachu to the Active Spot.
bob played Bulbasaur to the Active Spot.

alice's Turn
alice played Voltorb to the Bench.
alice played Voltorb to the Bench.
alice played Voltorb to the Bench.
alice played Voltorb to the Bench.
alice played Voltorb to the Bench.
alice played Voltorb to the Bench.
alice ended their turn.
`;
    const other = replay(normalizePerspective(parseBattleLog(OVERFILL), "alice"));
    expect(other.diagnostics.some((d) => d.code === "bench_full")).toBe(true);
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

  // Which array a card lands in is the routing tests' business below; these
  // two are about WHICH POKÉMON it lands on, so they look across both.
  const attachedNames = (mon: {
    attachedEnergy: { name: string }[];
    attachedTools: { name: string }[];
  }) => [...mon.attachedEnergy, ...mon.attachedTools].map((c) => c.name);

  it("attaches a bench-targeted card to the bench Pokémon, not the active one", () => {
    const idx = actionIndex(
      "Nnova12 attached Cynthia's Power Weight to Cynthia's Gabite on the Bench.",
    );
    const side = result.states[idx].sides.player;
    const activeHasIt = side.active
      ? attachedNames(side.active).includes("Cynthia's Power Weight")
      : false;
    const benchHolder = side.bench.find((mon) =>
      attachedNames(mon).includes("Cynthia's Power Weight"),
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
    const count = active
      ? attachedNames(active).filter((n) => n === "Cynthia's Power Weight").length
      : 0;
    expect(count).toBe(1);
  });

  // TCG Live phrases a Tool's attachment exactly like an energy's ("attached
  // X to Y"), so the parser files both under attach_energy. The engine used
  // to push whatever arrived straight into attachedEnergy, which left Tools
  // sitting among the energies: the board drew them as Colorless energy
  // icons, never as the Tool card behind the Pokémon, and they counted
  // against the one-energy-per-turn rule.
  describe("Pokémon Tools attached through an energy line", () => {
    const finalPlayer = result.finalState.sides.player;
    const holder = [finalPlayer.active, ...finalPlayer.bench].find(
      (mon) => mon && attachedNames(mon).includes("Cynthia's Power Weight"),
    );

    it("is not a vacuous guard — the fixture really does attach a Tool", () => {
      expect(holder).toBeDefined();
    });

    it("routes the Tool into attachedTools, not attachedEnergy", () => {
      expect(holder!.attachedTools.map((c) => c.name)).toContain("Cynthia's Power Weight");
      expect(holder!.attachedEnergy.map((c) => c.name)).not.toContain(
        "Cynthia's Power Weight",
      );
    });

    it("still keeps the real energies on the same Pokémon", () => {
      // Guards against over-correcting into "route everything to tools".
      expect(holder!.attachedEnergy.length).toBeGreaterThan(0);
      for (const c of holder!.attachedEnergy) {
        expect(c.name).toMatch(/Energy$/);
      }
    });

    it("doesn't let a Tool consume the turn's one energy attachment", () => {
      // Attaching the Tool alongside an energy previously tripped this
      // warning twice in this very fixture.
      const extra = result.diagnostics.filter((d) => d.code === "extra_energy_attach");
      expect(extra).toEqual([]);
    });
  });
});
