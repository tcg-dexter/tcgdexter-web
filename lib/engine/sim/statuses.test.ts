import { describe, expect, it } from "vitest";
import { attackSelfLock } from "./statuses";

describe("attack self-lockout parsing", () => {
  it("locks a single named attack", () => {
    expect(
      attackSelfLock("Mega Brave", "During your next turn, this Pokémon can't use Mega Brave."),
    ).toEqual({ attackName: "Mega Brave" });
  });

  it("locks the whole Pokémon for 'can't use attacks'", () => {
    expect(
      attackSelfLock(
        "Rampaging Thunder",
        "During your next turn, this Pokémon can't use attacks.",
      ),
    ).toEqual({ attackName: null });
  });

  it("ignores clauses aimed at the OPPONENT's next turn", () => {
    // A debuff on the defender is not a lockout on the user. Getting this
    // backwards would freeze the attacker every time it applied a status.
    expect(
      attackSelfLock(
        "Clutch",
        "During your opponent's next turn, the Defending Pokémon can't retreat.",
      ),
    ).toBeNull();
  });

  it("ignores an unrelated attack named in the clause", () => {
    expect(
      attackSelfLock("Aura Jab", "During your next turn, this Pokémon can't use Mega Brave."),
    ).toBeNull();
  });

  it("returns null for plain attacks", () => {
    expect(attackSelfLock("Ram", "")).toBeNull();
    expect(attackSelfLock("Ram", undefined)).toBeNull();
  });
});
