import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { deriveLocks } from "./locks";

// Real match a11father vs kenggg2. kenggg2's Budew uses Itchy Pollen on
// a11father's N's Zorua — an attack rider that locks the Defender's retreat
// during their next turn. The log never says so; deriveLocks must infer it.
const LOG = readFileSync(
  join(__dirname, "..", "engine", "fixtures", "a11father-kenggg2.txt"),
  "utf8",
);

describe("deriveLocks — retreat lock from an attack rider", () => {
  const parsed = normalizePerspective(parseBattleLog(LOG), "a11father");
  const res = replay(parsed, { keepSnapshots: true });
  const { perState } = deriveLocks(res.states, parsed.actions);

  const attackIdx = parsed.actions.findIndex(
    (a) => a.action_type === "attack" && a.payload.attack_name === "Itchy Pollen",
  );

  it("finds the locking attack", () => {
    expect(attackIdx).toBeGreaterThan(0);
  });

  it("locks the player's (a11father's) retreat the moment Itchy Pollen lands", () => {
    // kenggg2 is the opponent; the Defender is a11father = the player side.
    expect(perState[attackIdx].player.retreat).toBe(true);
    expect(perState[attackIdx].opponent.retreat).toBe(false);
  });

  it("holds the lock through a11father's next turn, then releases it", () => {
    const lockTurn = res.states[attackIdx].turn.number;
    // While still within the victim's next turn (and the same Active), locked.
    const during = perState.findIndex(
      (_l, i) =>
        i > attackIdx && res.states[i].turn.number === lockTurn + 1,
    );
    expect(during).toBeGreaterThan(attackIdx);
    expect(perState[during].player.retreat).toBe(true);

    // Two turns on, the lock is gone.
    const later = perState.findIndex(
      (_l, i) => i > attackIdx && res.states[i].turn.number >= lockTurn + 2,
    );
    if (later !== -1) expect(perState[later].player.retreat).toBe(false);
  });

  it("never reports an Item lock in a match with no item-locking cards", () => {
    expect(perState.some((l) => l.player.item || l.opponent.item)).toBe(false);
  });
});

// A static-ability Item lock: Vileplume ("both players can't play Items while
// it is in play"). Proven synthetically since no real fixture carries one.
const VILEPLUME_LOG = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played Pikachu to the Active Spot.
bob played Oddish to the Active Spot.

alice's Turn
alice played Voltorb to the Bench.
alice ended their turn.

bob's Turn
bob played Vileplume to the Bench.
bob ended their turn.
`;

describe("deriveLocks — Item lock from a static ability", () => {
  const parsed = normalizePerspective(parseBattleLog(VILEPLUME_LOG), "alice");
  const res = replay(parsed, { keepSnapshots: true });
  const { perState } = deriveLocks(res.states, parsed.actions);

  const vileplumeIdx = parsed.actions.findIndex(
    (a) => a.action_type === "play_to_bench" && a.payload.card === "Vileplume",
  );

  it("locks Items for BOTH sides once Vileplume is in play", () => {
    expect(vileplumeIdx).toBeGreaterThan(0);
    expect(perState[vileplumeIdx].player.item).toBe(true);
    expect(perState[vileplumeIdx].opponent.item).toBe(true);
  });

  it("does not lock Items before Vileplume hits the board", () => {
    expect(perState[vileplumeIdx - 1].player.item).toBe(false);
    expect(perState[vileplumeIdx - 1].opponent.item).toBe(false);
  });

  it("leaves retreat unlocked — an ability Item lock is not a retreat lock", () => {
    expect(perState[vileplumeIdx].player.retreat).toBe(false);
    expect(perState[vileplumeIdx].opponent.retreat).toBe(false);
  });
});
