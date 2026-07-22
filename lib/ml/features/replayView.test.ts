// Replay → PlayerView bridge + value curve + swing insights.
//
// The bridge is what lets the board-aware value model score REAL imported
// battle logs; these tests pin its non-obvious obligations: catalog
// hydration (the replay reducer leaves catalog null, which would silently
// zero 20 model features), deck-count estimation (replay decks start
// empty), unseenOwn synthesis from the saved deck list, and the per-turn
// flags the sim keeps outside GameState.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { replayTurnViews } from "./replayView";
import { STATE_FEATURE_NAMES, encodeStateFeatures } from "./policy";
import { valueCurve } from "@/lib/ml/valueCurve";
import { readValueArtifact } from "@/lib/ml/botEvaluator";
import { swingInsights, SWING_THRESHOLD } from "@/lib/ml/coach/swings";
import type { WinProbPoint } from "@/lib/ml/winprob";

const FIXTURES = join(process.cwd(), "lib", "battle-log", "fixtures");
const ARTIFACT = join(process.cwd(), "data", "ml", "value.json");

// The fixture's LOG OWNER is a11father — their drawn cards are named in the
// export while MoonSheikah's are hidden. Reviews always run from the log
// owner's perspective (that's whose hand the log reveals), so the tests do
// too. The deck list uses names from the log itself so list-minus-seen has
// real overlap; counts are plausible — the CONTRACT under test is the
// subtraction, not tournament legality.
const DECK_LIST = [
  "Pokémon: 16",
  "4 N's Zorua",
  "3 N's Zoroark ex",
  "3 Munkidori",
  "2 Fezandipiti ex",
  "Trainer: 24",
  "4 Lillie's Determination",
  "4 Ultra Ball",
  "4 N's PP Up",
  "4 Boss's Orders",
  "4 Night Stretcher",
  "4 Poké Pad",
  "Energy: 24",
  "24 Basic Darkness Energy",
].join("\n");

function fixtureViews(deckList: string | null = DECK_LIST) {
  const raw = readFileSync(join(FIXTURES, "example-1.txt"), "utf8");
  const parsed = normalizePerspective(parseBattleLog(raw), "a11father");
  return { parsed, result: replayTurnViews(parsed, replay(parsed), deckList) };
}

describe("replayTurnViews", () => {
  const { result } = fixtureViews();

  it("produces one view per playable turn, in turn order", () => {
    expect(result.views.length).toBeGreaterThan(4);
    for (let i = 1; i < result.views.length; i++) {
      expect(result.views[i].turn_number).toBeGreaterThan(result.views[i - 1].turn_number);
    }
  });

  it("hydrates catalogs so board features carry real values", () => {
    // Without hydration every mon encodes as a 0-HP blank; with it, HP and
    // hand-composition features must be non-zero somewhere in the game.
    const idx = new Map(STATE_FEATURE_NAMES.map((n, i) => [n, i]));
    const maxHp = Math.max(
      ...result.views.map((t) => encodeStateFeatures(t.view)[idx.get("my_active_max_hp")!]),
    );
    const handKnown = Math.max(
      ...result.views.map((t) => {
        const vec = encodeStateFeatures(t.view);
        return (
          vec[idx.get("hand_basics")!] +
          vec[idx.get("hand_items")!] +
          vec[idx.get("hand_supporters")!] +
          vec[idx.get("hand_basic_energy")!]
        );
      }),
    );
    expect(maxHp).toBeGreaterThan(0);
    expect(handKnown).toBeGreaterThan(0);
  });

  it("estimates deck counts by 60-card conservation", () => {
    for (const t of result.views) {
      expect(t.view.deckCount).toBeGreaterThanOrEqual(0);
      expect(t.view.deckCount).toBeLessThanOrEqual(60);
      expect(t.view.opponent.deckCount).toBeGreaterThanOrEqual(0);
    }
    // Decks shrink as the game goes on (draws, benching, prizes).
    const first = result.views[0].view.deckCount;
    const last = result.views[result.views.length - 1].view.deckCount;
    expect(last).toBeLessThan(first);
    // And never the raw replay value: replay decks start EMPTY, so a raw
    // read would be ~0 on turn 1 — conservation puts it near 40+.
    expect(first).toBeGreaterThan(30);
  });

  it("synthesizes unseenOwn as deck list minus seen cards", () => {
    const t0 = result.views[0].view;
    const listTotal = 60;
    const unseenTotal = Object.values(t0.unseenOwn).reduce((s, n) => s + n, 0);
    expect(unseenTotal).toBeGreaterThan(0);
    expect(unseenTotal).toBeLessThanOrEqual(listTotal);
    // Unseen counts shrink or hold as more of the deck surfaces.
    const later = result.views[result.views.length - 1].view;
    const laterTotal = Object.values(later.unseenOwn).reduce((s, n) => s + n, 0);
    expect(laterTotal).toBeLessThanOrEqual(unseenTotal);
  });

  it("degrades to an (unknown) bucket without a deck list", () => {
    const { result: noList } = fixtureViews(null);
    const v = noList.views[0].view;
    expect(Object.keys(v.unseenOwn)).toEqual(["(unknown)"]);
    expect(v.unseenOwn["(unknown)"]).toBe(v.deckCount + v.prizeCount);
  });

  it("zeroes the player's stale within-turn flags on opponent turns", () => {
    for (const t of result.views) {
      if (t.actor === "opponent") {
        expect(t.view.energyAttachedThisTurn).toBe(0);
        expect(t.view.supporterPlayedThisTurn).toBe(false);
      }
    }
  });

  it("reports high card coverage on the meta-deck fixture", () => {
    expect(result.cardCoverage).toBeGreaterThan(0.7);
  });
});

describe.skipIf(!existsSync(ARTIFACT))("valueCurve on a real log", () => {
  it("scores every turn to a probability in (0, 1)", () => {
    const artifact = readValueArtifact(ARTIFACT)!;
    const { result } = fixtureViews();
    const curve = valueCurve(artifact, result.views);
    expect(curve.length).toBe(result.views.length);
    for (const p of curve) {
      expect(Number.isFinite(p.p_win)).toBe(true);
      expect(p.p_win).toBeGreaterThan(0);
      expect(p.p_win).toBeLessThan(1);
    }
    // The curve must actually move — a flat line means the encoder saw
    // nothing (e.g. hydration silently broken).
    const values = curve.map((p) => p.p_win);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.02);
  });
});

describe("swingInsights", () => {
  const point = (turn: number, actor: "player" | "opponent", p: number): WinProbPoint => ({
    turn_number: turn,
    actor,
    p_win: p,
  });

  it("flags the largest drops across player turns only", () => {
    const curve = [
      point(1, "player", 0.5),
      point(2, "opponent", 0.45), // opponent-turn drop: never flagged
      point(3, "player", 0.2), // −0.25 across player turn → warning
      point(4, "opponent", 0.2),
      point(5, "player", 0.08), // −0.12 → suggestion
    ];
    const insights = swingInsights(curve);
    expect(insights.length).toBe(2);
    expect(insights[0].turn_number).toBe(3);
    expect(insights[0].severity).toBe("warning");
    expect(insights[1].turn_number).toBe(5);
    expect(insights[1].severity).toBe("suggestion");
    for (const i of insights) expect(i.code).toBe("winprob_swing");
  });

  it("ignores drops below the threshold", () => {
    const curve = [
      point(1, "player", 0.5),
      point(2, "opponent", 0.5),
      point(3, "player", 0.5 - SWING_THRESHOLD + 0.01),
    ];
    expect(swingInsights(curve)).toEqual([]);
  });

  it("returns nothing under low confidence", () => {
    const curve = [point(1, "player", 0.9), point(2, "player", 0.1)];
    expect(swingInsights(curve, { lowConfidence: true })).toEqual([]);
  });
});
