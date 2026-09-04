import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

// Real match a11father vs kenggg2, turn 7: kenggg2's Dragapult ex attacks with
// Phantom Dive for 200 on a11father's Active N's Zoroark ex, plus a spread
// component the log writes as a child "kenggg2 put 6 damage counters on
// kenggg2's N's Zoroark ex." line (the possessive names the ACTOR, not the
// true owner — a documented log quirk; see parse.ts). a11father has TWO N's
// Zoroark ex in play at this point — the Active one Phantom Dive just hit,
// and a separate one on the Bench — so the name alone doesn't say which
// takes the spread damage.
//
// Real Phantom Dive always spreads to a Benched Pokémon, never the Active
// re-hit by its own primary damage. The reducer's damage_counters_placed
// handler used to resolve same-named duplicates Active-first (allInPlay's
// natural order), so the spread piled onto the Active that had already taken
// the 200 instead of the distinct Bench copy — the board showed 260 on the
// Active and nothing on the Bench.
const LOG = readFileSync(
  join(__dirname, "fixtures", "a11father-kenggg2.txt"),
  "utf8",
);

describe("damage_counters_placed resolves a same-named duplicate to the Bench, not a re-hit Active", () => {
  const parsed = normalizePerspective(parseBattleLog(LOG), "a11father");
  const res = replay(parsed, { keepSnapshots: true });

  const attackIdx = parsed.actions.findIndex(
    (a) => a.action_type === "attack" && a.payload.attack_name === "Phantom Dive",
  );
  const placedIdx = parsed.actions.findIndex(
    (a, i) => i > attackIdx && a.action_type === "damage_counters_placed",
  );

  it("finds the attack and its spread-damage action", () => {
    expect(attackIdx).toBeGreaterThan(0);
    expect(placedIdx).toBe(attackIdx + 1);
  });

  it("is turn 7, as reported", () => {
    expect(res.states[attackIdx].turn.number).toBe(7);
  });

  it("the primary 200 lands on the Active and nothing more", () => {
    const activeAfterAttack = res.states[attackIdx].sides.player.active;
    expect(activeAfterAttack?.card.name).toBe("N's Zoroark ex");
    const before = res.states[attackIdx - 1].sides.player.active?.damage ?? 0;
    expect(activeAfterAttack?.damage).toBe(before + 200);
  });

  it("the spread damage lands on the Bench duplicate, and the Active is untouched by it", () => {
    const activeBefore = res.states[attackIdx].sides.player.active?.damage ?? 0;
    const activeAfter = res.states[placedIdx].sides.player.active?.damage ?? 0;
    expect(activeAfter).toBe(activeBefore); // no re-hit

    const benchZoroark = res.states[placedIdx].sides.player.bench.find(
      (m) => m.card.name === "N's Zoroark ex",
    );
    expect(benchZoroark?.damage).toBe(60);
  });
});
