import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "@/lib/engine";
import { deriveLocks } from "./locks";

// Real match a11father vs kenggg2. kenggg2's Budew uses Itchy Pollen on
// a11father's N's Zorua. Itchy Pollen is an ITEM lock — "your opponent can't
// play Item cards from their hand during their next turn" — not a retreat lock
// (the sim engine's effect catalog approximates it as cannot_retreat because it
// has no Item-lock status; deriveLocks reclassifies it). The log never states
// the lock; deriveLocks must infer it.
const LOG = readFileSync(
  join(__dirname, "..", "engine", "fixtures", "a11father-kenggg2.txt"),
  "utf8",
);

describe("deriveLocks — Item lock from Budew's Itchy Pollen (real match)", () => {
  const parsed = normalizePerspective(parseBattleLog(LOG), "a11father");
  const res = replay(parsed, { keepSnapshots: true });
  const { perState } = deriveLocks(res.states, parsed.actions);

  const attackIdx = parsed.actions.findIndex(
    (a) => a.action_type === "attack" && a.payload.attack_name === "Itchy Pollen",
  );

  it("finds the Itchy Pollen attack", () => {
    expect(attackIdx).toBeGreaterThan(0);
  });

  it("Item-locks a11father (the Defender's controller), not retreat-locks", () => {
    // kenggg2 is the opponent; "your opponent" = a11father = the player side.
    expect(perState[attackIdx].player.item).toBe(true);
    expect(perState[attackIdx].player.retreat).toBe(false);
    // The attacker isn't locked.
    expect(perState[attackIdx].opponent.item).toBe(false);
  });

  it("holds the Item lock through a11father's next turn, then releases it", () => {
    const lockTurn = res.states[attackIdx].turn.number;
    const during = perState.findIndex(
      (_l, i) => i > attackIdx && res.states[i].turn.number === lockTurn + 1,
    );
    expect(during).toBeGreaterThan(attackIdx);
    expect(perState[during].player.item).toBe(true);

    const later = perState.findIndex(
      (_l, i) => i > attackIdx && res.states[i].turn.number >= lockTurn + 2,
    );
    if (later !== -1) expect(perState[later].player.item).toBe(false);
  });

  it("reports no retreat lock anywhere in this match (no retreat-locking card)", () => {
    expect(perState.some((l) => l.player.retreat || l.opponent.retreat)).toBe(false);
  });
});

// A genuine retreat lock: Dusknoir's Shadow Bind ("the Defending Pokémon can't
// retreat during your opponent's next turn"). Proven synthetically since the
// real fixture has none.
const SHADOW_BIND_LOG = `Setup
alice chose heads for the opening coin flip.
alice won the coin toss.
alice decided to go first.
alice drew 7 cards for the opening hand.
bob drew 7 cards for the opening hand.
alice played Duskull to the Active Spot.
bob played Pikachu to the Active Spot.

alice's Turn
alice played Duskull to the Bench.
alice ended their turn.

bob's Turn
bob ended their turn.

alice's Turn
alice's Dusknoir used Shadow Bind on bob's Pikachu for 60 damage.
alice ended their turn.
`;

describe("deriveLocks — retreat lock from an attack rider", () => {
  const parsed = normalizePerspective(parseBattleLog(SHADOW_BIND_LOG), "alice");
  const res = replay(parsed, { keepSnapshots: true });
  const { perState } = deriveLocks(res.states, parsed.actions);

  const attackIdx = parsed.actions.findIndex(
    (a) => a.action_type === "attack" && a.payload.attack_name === "Shadow Bind",
  );

  it("finds the locking attack", () => {
    expect(attackIdx).toBeGreaterThan(0);
  });

  it("retreat-locks the Defender (bob = opponent), not Item-locks", () => {
    expect(perState[attackIdx].opponent.retreat).toBe(true);
    expect(perState[attackIdx].opponent.item).toBe(false);
    expect(perState[attackIdx].player.retreat).toBe(false);
  });
});

// A static-ability Item lock: Vileplume ("both players can't play Items while
// it is in play"). Proven synthetically — no real fixture carries one.
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
