import { describe, expect, it } from "vitest";
import { parseBattleLog } from "./parse";

// The attack line can end with a type-matchup clause. Only the WEAKNESS form
// was ever matched, so a line ending in a RESISTANCE clause failed the attack
// regex outright and fell through to the "<handle>'s <Pokemon> used <move>."
// ability pattern — which, being unanchored at the end, swallowed the rest of
// the line into the move name. In production that left 32 rows across 22
// matches stored as abilities called things like:
//
//   "Corkscrew Dive on hshs123's Yveltal for 100 damage. hshs123's Yveltal
//    took -30 less damage because of Fighting Resistance"
//
// with their damage uncounted and the attacker unattributed.
function attackFrom(line: string) {
  const actions = parseBattleLog(`Setup\n${line}`).actions;
  const hit = actions.find(
    (a) => a.action_type === "attack" || a.action_type === "ability_used",
  );
  return { type: hit?.action_type, payload: (hit?.payload ?? {}) as Record<string, unknown> };
}

describe("the attack line's trailing type-matchup clause", () => {
  it("parses a Resistance clause as an attack, not an ability", () => {
    const { type, payload } = attackFrom(
      "CynthiaFan's Cynthia's Garchomp ex used Corkscrew Dive on hshs123's Yveltal for 100 damage. hshs123's Yveltal took -30 less damage because of Fighting Resistance.",
    );
    expect(type).toBe("attack");
    // The move name must be the move alone — the bug's signature was the rest
    // of the line trailing into it.
    expect(payload.attack_name).toBe("Corkscrew Dive");
    expect(payload.attacker).toBe("Cynthia's Garchomp ex");
    expect(payload.damage).toBe(100);
    // TCG Live writes Resistance as a negative number alongside "less".
    expect(payload.resistance_penalty).toBe(-30);
    expect(payload.resistance_type).toBe("Fighting");
    expect(payload.resistance_target).toBe("Yveltal");
    // A resistance is not a weakness; those fields stay clear.
    expect(payload.weakness_bonus).toBeNull();
    expect(payload.weakness_type).toBeNull();
  });

  it("still parses a Weakness clause exactly as before", () => {
    const { type, payload } = attackFrom(
      "alice's Charizard ex used Burning Darkness on bob's Dragapult ex for 330 damage. bob's Dragapult ex took 60 more damage because of Darkness Weakness.",
    );
    expect(type).toBe("attack");
    expect(payload.attack_name).toBe("Burning Darkness");
    expect(payload.damage).toBe(330);
    expect(payload.weakness_bonus).toBe(60);
    expect(payload.weakness_type).toBe("Darkness");
    expect(payload.weakness_target).toBe("Dragapult ex");
    expect(payload.resistance_penalty).toBeNull();
    expect(payload.resistance_type).toBeNull();
  });

  it("handles a 0-damage attack whose only effect is the resistance", () => {
    // Budew's Itchy Pollen — the item lock, which attacks for nothing.
    const { type, payload } = attackFrom(
      "alice's Budew used Itchy Pollen on bob's Genesect for 0 damage. bob's Genesect took -10 less damage because of Grass Resistance.",
    );
    expect(type).toBe("attack");
    expect(payload.attack_name).toBe("Itchy Pollen");
    expect(payload.damage).toBe(0);
    expect(payload.resistance_penalty).toBe(-10);
  });

  it("leaves a plain attack line with no clause untouched", () => {
    const { type, payload } = attackFrom(
      "alice's Pikachu used Thunder on bob's Snorlax for 90 damage.",
    );
    expect(type).toBe("attack");
    expect(payload.attack_name).toBe("Thunder");
    expect(payload.damage).toBe(90);
    expect(payload.weakness_bonus).toBeNull();
    expect(payload.resistance_penalty).toBeNull();
  });

  it("does not mistake a real ability for an attack", () => {
    const { type, payload } = attackFrom("alice's Pidgeot ex used Quick Search.");
    expect(type).toBe("ability_used");
    expect(payload.ability_name).toBe("Quick Search");
  });
});
