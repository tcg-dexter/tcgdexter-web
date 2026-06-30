import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBattleLog } from "./parse";
import { normalizePerspective } from "./normalize";
import { summarize } from "./summarize";

const EXAMPLE = readFileSync(join(__dirname, "fixtures/example-1.txt"), "utf8");
const VERBOSE = readFileSync(
  join(__dirname, "fixtures/example-2-verbose.txt"),
  "utf8",
);

describe("parseBattleLog (example-1)", () => {
  const parsed = parseBattleLog(EXAMPLE);

  it("detects both handles", () => {
    expect(parsed.handles).toContain("MoonSheikah");
    expect(parsed.handles).toContain("a11father");
  });

  it("produces a setup section + alternating turns", () => {
    const phases = parsed.turns.map((t) => t.phase);
    expect(phases[0]).toBe("setup");
    expect(phases).toContain("checkup");
    // there should be more turn-phase entries than just setup/checkup
    expect(phases.filter((p) => p === "turn").length).toBeGreaterThanOrEqual(8);
  });

  it("captures coin flip + going-first", () => {
    const coin = parsed.actions.find((a) => a.action_type === "coin_flip");
    expect(coin?.actor_handle).toBe("MoonSheikah");
    expect(coin?.payload.choice).toBe("tails");

    const order = parsed.actions.find((a) => a.action_type === "chose_first");
    expect(order?.actor_handle).toBe("MoonSheikah");
    expect(order?.payload.order).toBe("first");
  });

  it("captures mulligan total of 3", () => {
    const m = parsed.actions.find((a) => a.action_type === "mulligan_total");
    expect(m?.payload.total).toBe(3);
  });

  it("captures opponent bonus draw because of mulligans", () => {
    const bonus = parsed.actions.find(
      (a) => a.action_type === "mulligan_bonus_draw",
    );
    expect(bonus?.actor_handle).toBe("a11father");
    expect(bonus?.payload.count).toBe(3);
  });

  it("captures attaches with location", () => {
    const attaches = parsed.actions.filter(
      (a) => a.action_type === "attach_energy",
    );
    expect(attaches.length).toBeGreaterThan(5);
    const first = attaches[0];
    expect(first.payload.energy).toBe("Basic Water Energy");
    expect(first.payload.location).toBe("active");
  });

  it("captures attacks with damage and choices", () => {
    const attacks = parsed.actions.filter((a) => a.action_type === "attack");
    expect(attacks.length).toBeGreaterThan(0);
    const nightJoker500 = attacks.find(
      (a) => a.payload.attack_name === "Night Joker" && a.payload.damage === 500,
    );
    expect(nightJoker500).toBeTruthy();
    expect(nightJoker500?.payload.choices).toContain("Powerful Rage");
  });

  it("captures weakness bonus on Itchy Pollen", () => {
    const itchy = parsed.actions.find(
      (a) => a.action_type === "attack" && a.payload.attack_name === "Itchy Pollen",
    );
    expect(itchy?.payload.damage).toBe(20);
    expect(itchy?.payload.weakness_bonus).toBe(10);
    expect(itchy?.payload.weakness_type).toBe("Grass");
  });

  it("captures abilities (Trade, Flip the Script)", () => {
    const abilities = parsed.actions.filter(
      (a) => a.action_type === "ability_used",
    );
    expect(abilities.some((a) => a.payload.ability_name === "Trade")).toBe(true);
    expect(
      abilities.some((a) => a.payload.ability_name === "Flip the Script"),
    ).toBe(true);
  });

  it("captures evolves", () => {
    const evolves = parsed.actions.filter((a) => a.action_type === "evolve");
    expect(evolves.length).toBeGreaterThan(3);
  });

  it("captures retreats and ensuing switch", () => {
    const retreats = parsed.actions.filter((a) => a.action_type === "retreat");
    expect(retreats.length).toBe(1);
    expect(retreats[0].payload.pokemon).toBe("Fezandipiti ex");
    expect((retreats[0].payload.discarded_energies as string[]).length).toBe(1);
  });

  it("captures KOs and prize counts", () => {
    const kos = parsed.actions.filter((a) => a.action_type === "knock_out");
    expect(kos.length).toBeGreaterThanOrEqual(4);

    const prizes = parsed.actions.filter((a) => a.action_type === "prize_taken");
    const total = prizes.reduce((n, p) => n + Number(p.payload.count || 0), 0);
    expect(total).toBeGreaterThanOrEqual(6);
  });

  it("captures Poisoned condition + checkup damage", () => {
    const cond = parsed.actions.find((a) => a.action_type === "condition_applied");
    expect(cond?.payload.condition).toBe("Poisoned");

    const checkup = parsed.actions.find(
      (a) => a.action_type === "damage_counter_placed",
    );
    expect(checkup?.payload.from_condition).toBe("Poisoned");
  });

  it("captures Boss's Orders forced switch as a sub-action of play_item", () => {
    const boss = parsed.actions.find(
      (a) =>
        a.action_type === "play_item" && a.payload.card === "Boss's Orders",
    );
    expect(boss).toBeTruthy();
    const forced = boss?.payload.forced_switches as Array<unknown>;
    expect(forced.length).toBe(1);
  });

  it("captures stadium plays and N's Castle / Surfing Beach swap", () => {
    const stadiums = parsed.actions.filter(
      (a) => a.action_type === "play_stadium",
    );
    expect(stadiums.length).toBe(2);
    const surfing = stadiums.find((s) => s.payload.card === "Surfing Beach");
    expect((surfing?.payload.replaced_stadium as string[])[0]).toBe("N's Castle");
  });

  it("captures game end", () => {
    const end = parsed.actions.find((a) => a.action_type === "game_end");
    expect(end?.payload.winner).toBe("a11father");
    expect(end?.payload.reason).toBe("prizes");
  });

  it("leaves very few lines unmatched", () => {
    // 'unknown' actions plus the unmatched list should be empty or trivial.
    // Allow a small allowance for any new wording we haven't seen.
    expect(parsed.unmatched.length).toBeLessThanOrEqual(2);
  });
});

describe("parseBattleLog (verbose / card-id export)", () => {
  const parsed = parseBattleLog(VERBOSE);

  it("detects both handles despite card-id prefixes", () => {
    expect(parsed.handles).toContain("a11father");
    expect(parsed.handles).toContain("lampdust94432");
  });

  it("strips card-id prefixes from card-name payloads", () => {
    const active = parsed.actions.find(
      (a) => a.action_type === "play_to_active" && a.actor_handle === "a11father",
    );
    expect(active?.payload.card).toBe("N's Zekrom");

    const attack = parsed.actions.find((a) => a.action_type === "attack");
    expect(attack?.payload.attacker).toBe("Solrock");
    expect(attack?.payload.defender).toBe("N's Zekrom");

    const evolve = parsed.actions.find((a) => a.action_type === "evolve");
    expect(evolve?.payload.from).toBe("Riolu");
    expect(evolve?.payload.to).toBe("Mega Lucario ex");
  });

  it("strips card-id prefixes from revealed card lists", () => {
    const opening = parsed.actions.find(
      (a) => a.action_type === "opening_hand" && a.actor_handle === "a11father",
    );
    const revealed = opening?.payload.revealed_cards as string[];
    expect(revealed).toContain("N's Zekrom");
    expect(revealed).toContain("Basic Darkness Energy");
    expect(revealed.every((c) => !c.includes("("))).toBe(true);
  });

  it("captures the name → id map for printing disambiguation", () => {
    expect(parsed.cardIds["N's Zekrom"]).toBe("me2-5_155");
    expect(parsed.cardIds["N's Reshiram"]).toBe("me2-5_154_ph2");
    expect(parsed.cardIds["Solrock"]).toBe("me1_75");
  });

  it("keeps raw_text free of id prefixes", () => {
    const active = parsed.actions.find((a) => a.action_type === "play_to_active");
    expect(active?.raw_text.includes("(")).toBe(false);
  });

  it("reads the concession as a game end", () => {
    const end = parsed.actions.find((a) => a.action_type === "game_end");
    expect(end?.payload.winner).toBe("lampdust94432");
    expect(end?.payload.reason).toBe("concede");
  });

  it("leaves the standard export's cardIds empty", () => {
    expect(Object.keys(parseBattleLog(EXAMPLE).cardIds)).toHaveLength(0);
  });
});

describe("normalize + summarize (example-1)", () => {
  const parsed = parseBattleLog(EXAMPLE);
  const normalized = normalizePerspective(parsed, "MoonSheikah");

  it("assigns actor by handle", () => {
    const moonAttacks = normalized.actions.filter(
      (a) => a.action_type === "attack" && a.actor === "player",
    );
    const oppAttacks = normalized.actions.filter(
      (a) => a.action_type === "attack" && a.actor === "opponent",
    );
    expect(moonAttacks.length).toBeGreaterThan(0);
    expect(oppAttacks.length).toBeGreaterThan(0);
  });

  it("derives the summary", () => {
    const s = summarize(normalized);
    expect(s.player_handle).toBe("MoonSheikah");
    expect(s.opponent_handle).toBe("a11father");
    expect(s.went_first).toBe(true);
    expect(s.player_mulligans).toBe(3);
    expect(s.opponent_mulligans).toBe(0);
    expect(s.prizes_taken_player).toBe(2);
    expect(s.prizes_taken_opponent).toBe(6);
    expect(s.end_reason).toBe("prizes");
    expect(s.result).toBe("loss");
  });

  it("flips perspective when player is a11father", () => {
    const flipped = normalizePerspective(parseBattleLog(EXAMPLE), "a11father");
    const s = summarize(flipped);
    expect(s.result).toBe("win");
    expect(s.prizes_taken_player).toBe(6);
    expect(s.prizes_taken_opponent).toBe(2);
  });
});
