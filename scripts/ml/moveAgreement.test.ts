import { describe, it, expect } from "vitest";

import { parseBattleLog } from "@/lib/battle-log";
import { normalizePerspective } from "@/lib/battle-log/normalize";
import { replay } from "@/lib/engine/replay";
import { hydrateState, replayViewAt, stockReplayDeck } from "@/lib/ml/features/replayView";
import { legalMoves } from "@/lib/engine/sim";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The instrument's load-bearing assumptions, pinned. Each of these was a bug
// during construction, and each produced a plausible-looking but wrong number
// rather than an error — which is exactly why they are tests.
const RAW = readFileSync(
  join(process.cwd(), "lib/battle-log/fixtures/example-1.txt"),
  "utf8",
);

describe("battle-log replay as a decision source", () => {
  const parsed = normalizePerspective(parseBattleLog(RAW), parseBattleLog(RAW).handles[0]);
  const result = replay(parsed);

  it("gives one state snapshot per action", () => {
    // The instrument indexes states[i-1] as "before action i". If replay ever
    // stopped keeping per-action snapshots, every decision would be scored
    // against the wrong board and nothing would throw.
    expect(result.states.length).toBe(parsed.actions.length);
  });

  it("attributes decisions by TURN, which covers strictly more than by action", () => {
    // Per-action `actor` is unreliable: it is resolved from actor_handle, and
    // most decision lines do not carry one (in the production logs sampled,
    // ALL were null). A first pass filtered on action.actor, found zero player
    // decisions, ran clean, and measured nothing. Turn membership is the
    // attribution that actually works.
    const DECISIONS = new Set([
      "attach_energy", "play_item", "play_stadium", "evolve", "retreat",
      "attack", "ability_used", "play_to_bench",
    ]);
    const byAction = parsed.actions.filter(
      (a) => DECISIONS.has(a.action_type) && a.actor === "player",
    ).length;
    const owner = new Map<number, string>();
    for (const t of parsed.turns) for (const i of t.action_indices) owner.set(i, String(t.actor));
    const byTurn = parsed.actions.filter(
      (a, i) => DECISIONS.has(a.action_type) && owner.get(i) === "player",
    ).length;
    expect(byTurn).toBeGreaterThan(0);
    expect(byTurn).toBeGreaterThanOrEqual(byAction);
  });

  it("makes perspective depend on the handle passed to normalizePerspective", () => {
    // parseBattleLog takes ONE argument — passing {playerHandle} to it is
    // silently ignored, which is how a first pass ended up scoring the wrong
    // side's decisions without any error. Perspective is only real after
    // normalizePerspective, and it must FLIP when the other handle is named.
    const bare = parseBattleLog(RAW);
    const [h0, h1] = bare.handles;
    const asA = normalizePerspective(parseBattleLog(RAW), h0);
    const asB = normalizePerspective(parseBattleLog(RAW), h1);
    const playerTurns = (r: typeof asA) =>
      r.turns.filter((t) => t.actor === "player").map((t) => t.turn_number);
    const a = playerTurns(asA);
    const b = playerTurns(asB);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    // The two perspectives must not claim the same turns.
    expect(a.filter((n) => b.includes(n))).toEqual([]);
  });

  it("reconstructs the log owner's hand, so moves can be enumerated", () => {
    // With an empty hand legalMoves returns only `pass`, and agreement would
    // be measured over a single option forever.
    const withHand = result.states.filter((s) => s.sides.player.hand.length > 0);
    expect(withHand.length).toBeGreaterThan(0);
  });
});

describe("replayViewAt repairs what raw replay views get wrong", () => {
  const parsed = normalizePerspective(parseBattleLog(RAW), parseBattleLog(RAW).handles[0]);
  const result = replay(parsed);
  const state = result.states[Math.floor(result.states.length / 2)];

  it("replaces the empty replay deck with an estimate", () => {
    // Replay decks start empty and fill only as cards surface. A board-aware
    // evaluator scoring deckCount 0 flattens its output, every policy then
    // picks the same move from tactical terms alone, and the instrument
    // reports "the model makes no difference" — a false negative that looks
    // exactly like a real result. This was measured: McNemar z went 0.00 ->
    // 2.50 on the same comparison once the repair was applied.
    hydrateState(state);
    expect(state.sides.player.deck.length).toBe(0);
    const view = replayViewAt(state, "player", null);
    expect(view.deckCount).toBeGreaterThan(0);
  });

  it("synthesizes unseenOwn rather than leaving it empty", () => {
    const view = replayViewAt(state, "player", null);
    expect(Object.keys(view.unseenOwn).length).toBeGreaterThan(0);
  });

  it("carries the per-turn one-shot flags it is given", () => {
    const view = replayViewAt(state, "player", null, {
      retreated: true,
      stadiumPlayed: true,
    });
    expect(view.retreatUsedThisTurn).toBe(true);
    expect(view.stadiumPlayedThisTurn).toBe(true);
  });
});

describe("legal moves at a real decision point", () => {
  it("offers more than pass once a hand exists", () => {
    const parsed = normalizePerspective(parseBattleLog(RAW), parseBattleLog(RAW).handles[0]);
    const result = replay(parsed);
    let best = 0;
    for (let i = 0; i < result.states.length; i++) {
      const s = result.states[i];
      if (s.sides.player.hand.length === 0) continue;
      hydrateState(s);
      try {
        best = Math.max(best, legalMoves(s, "player", { retreated: false } as never).length);
      } catch {
        // A state the reducer left inconsistent is skipped by the instrument
        // too; it must not fail the suite.
      }
    }
    expect(best).toBeGreaterThan(1);
  });
});

describe("stockReplayDeck unblocks deck-gated moves", () => {
  // A FRESH replay per test. Snapshots are shared mutable objects, so a test
  // that stocks a deck would otherwise leave it stocked for the next one —
  // which is exactly how the "deck starts empty" assertion first failed.
  const freshState = () => {
    const parsed = normalizePerspective(parseBattleLog(RAW), parseBattleLog(RAW).handles[0]);
    const result = replay(parsed);
    const state = result.states[Math.floor(result.states.length / 2)];
    hydrateState(state);
    return state;
  };
  const LIST =
    "Pokémon: 4\n4 Snorlax SVI 143\nTrainer: 8\n4 Ultra Ball SVI 196\n4 Nest Ball SVI 181\nEnergy: 4\n4 Basic Lightning Energy SVE 4";

  it("leaves the deck empty without a deck list rather than inventing cards", () => {
    const state = freshState();
    expect(stockReplayDeck(state, "player", null)).toBe(0);
    expect(state.sides.player.deck.length).toBe(0);
  });

  it("stocks only cards the player has not already shown", () => {
    const state = freshState();
    const n = stockReplayDeck(state, "player", LIST);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(16);
    // Every stocked card is hydrated: search filters and cost checks read the
    // catalog, and hydrateState only walks zones that already had cards.
    for (const c of state.sides.player.deck) expect(c.catalog).not.toBeNull();
  });

  it("does not re-stock a deck that already has cards", () => {
    const state = freshState();
    const first = stockReplayDeck(state, "player", LIST);
    const second = stockReplayDeck(state, "player", LIST);
    expect(second).toBe(first);
  });

  it("is what makes deck-gated abilities enumerable at all", () => {
    // N's Zoroark ex's Trade is gated on `side.deck.length > 0`. With the
    // empty deck a replay leaves behind it is silently suppressed, and it
    // alone accounted for 198 of 321 "the engine offered nothing" misses
    // across 60 imported logs — an ability that is implemented and correct.
    const state = freshState();
    expect(state.sides.player.deck.length).toBe(0);
    const before = (() => {
      try {
        return legalMoves(state, "player", { retreated: false } as never).length;
      } catch {
        return 0;
      }
    })();
    stockReplayDeck(state, "player", LIST);
    const after = (() => {
      try {
        return legalMoves(state, "player", { retreated: false } as never).length;
      } catch {
        return 0;
      }
    })();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
