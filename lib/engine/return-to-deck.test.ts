import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { replay } from "./replay";

// Real match a11father vs kenggg2. kenggg2 repeatedly uses Dudunsparce's
// Run Away Draw ability, which shuffles the Dudunsparce (and its Dunsparce
// base) back into the deck. TCG Live writes that as a bare "kenggg2 played
// Dudunsparce." with the self-shuffle hidden in child lines. Modelled wrong,
// the benched Dudunsparce never leaves and the bench over-counts — the user
// saw 6 on kenggg2's bench where the rules cap it at 5.
const LOG = readFileSync(
  join(__dirname, "fixtures", "a11father-kenggg2.txt"),
  "utf8",
);

describe("Pokémon that shuffles itself back into the deck (Run Away Draw)", () => {
  const parsed = normalizePerspective(parseBattleLog(LOG), "a11father");
  const res = replay(parsed, { keepSnapshots: true });

  it("keeps kenggg2's bench within the 5-card cap the whole game", () => {
    const worst = Math.max(
      ...res.states.map((s) => s.sides.opponent.bench.length),
    );
    expect(worst).toBeLessThanOrEqual(5);
  });

  it("never raises bench_full for kenggg2 (no illegal over-fill)", () => {
    const benchFull = res.diagnostics.filter((d) => d.code === "bench_full");
    expect(benchFull).toHaveLength(0);
  });

  it("the Dudunsparce ability removes it from the bench (not a phantom)", () => {
    // Action #42: "kenggg2 played Dudunsparce." — the self-return. The bench
    // must shrink by one across it, and no Dudunsparce may remain in play.
    const idx = parsed.actions.findIndex(
      (a, i) =>
        i >= 40 &&
        a.action_type === "play_item" &&
        a.payload.card === "Dudunsparce",
    );
    expect(idx).toBeGreaterThan(0);
    const before = res.states[idx - 1].sides.opponent;
    const after = res.states[idx].sides.opponent;
    expect(after.bench.length).toBe(before.bench.length - 1);
    const dudunInPlay = [after.active, ...after.bench].some(
      (m) => m?.card.name === "Dudunsparce",
    );
    expect(dudunInPlay).toBe(false);
  });

  it("does NOT remove a Supporter that shuffles a copy of itself from hand", () => {
    // Lillie's Determination (a11father, #36) shuffles a copy of itself into
    // the deck from hand and sets the same parser flag — but it is never in
    // play, so the reducer must leave the board untouched and not warn.
    const missing = res.diagnostics.filter(
      (d) => d.code === "return_target_missing",
    );
    expect(missing).toHaveLength(0);
  });
});
