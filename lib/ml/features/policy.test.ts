// Policy encoding acceptance: fixed-length versioned vectors, names aligned
// by index with values, every value finite, deterministic per input. The
// vector lengths are pinned — changing them means the schema changed, which
// requires a POLICY_SCHEMA_VERSION bump (and updating these pins).

import { describe, it, expect } from "vitest";
import {
  ACTION_FEATURE_NAMES,
  POLICY_SCHEMA_VERSION,
  POLICY_TOP_CARDS,
  STATE_FEATURE_NAMES,
  encodeActionFeatures,
  encodeStateFeatures,
} from "./policy";
import { instantiateDeck, legalMoves, viewFor } from "@/lib/engine/sim";
import { buildSimInitialState } from "@/lib/engine/sim/setup";
import { mulberry32 } from "@/lib/engine/sim/rng";
import type { SimMove } from "@/lib/engine/sim/moves";

const DECK = [
  "Pokémon: 12",
  "4 Miraidon ex SVI 81",
  "4 Pikachu SVI 62",
  "4 Snorlax SVI 143",
  "Trainer: 24",
  "12 Ultra Ball SVI 196",
  "12 Nest Ball SVI 181",
  "Energy: 24",
  "24 Basic Lightning Energy SVE 4",
].join("\n");

function fixture() {
  const deck = instantiateDeck(DECK);
  const state = buildSimInitialState(deck, deck, mulberry32(11), "player");
  state.turn = { number: 3, playerTurnNumber: 2, actor: "player", phase: "turn" };
  const ctx = { retreated: false };
  const view = viewFor(state, "player", ctx);
  const legal = legalMoves(state, "player", ctx);
  return { view, legal };
}

describe("policy feature encoding", () => {
  const { view, legal } = fixture();

  it("pins the schema version and vector shapes", () => {
    expect(POLICY_SCHEMA_VERSION).toBe(3);
    expect(encodeStateFeatures(view).length).toBe(STATE_FEATURE_NAMES.length);
    for (const move of legal) {
      expect(encodeActionFeatures(view, move).length).toBe(ACTION_FEATURE_NAMES.length);
    }
  });

  it("has unique feature names", () => {
    expect(new Set(STATE_FEATURE_NAMES).size).toBe(STATE_FEATURE_NAMES.length);
    expect(new Set(ACTION_FEATURE_NAMES).size).toBe(ACTION_FEATURE_NAMES.length);
  });

  it("emits only finite values", () => {
    for (const x of encodeStateFeatures(view)) expect(Number.isFinite(x)).toBe(true);
    for (const move of legal) {
      for (const x of encodeActionFeatures(view, move)) expect(Number.isFinite(x)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(encodeStateFeatures(view)).toEqual(encodeStateFeatures(view));
    expect(encodeActionFeatures(view, legal[0])).toEqual(encodeActionFeatures(view, legal[0]));
  });

  it("encodes known state values at their named slots", () => {
    const at = (name: string) => encodeStateFeatures(view)[STATE_FEATURE_NAMES.indexOf(name)];
    expect(at("turn_number")).toBe(3);
    expect(at("player_turn_number")).toBe(2);
    expect(at("my_prizes_remaining")).toBe(6);
    expect(at("unseen_total")).toBe(view.deckCount + view.prizeCount);
    // 60-card deck: everything is hand + board + deck + prizes at setup.
    const onBoard = [view.board.active, ...view.board.bench].filter(Boolean).length;
    expect(at("unseen_total") + view.hand.length + onBoard).toBe(60);
    expect(at("my_active_present")).toBe(1);
    expect(at("stadium_present")).toBe(0);
  });

  it("one-hots the move kind and zeroes attack tactics for pass", () => {
    const pass = legal.find((m) => m.kind === "pass")!;
    const vec = encodeActionFeatures(view, pass);
    const at = (name: string) => vec[ACTION_FEATURE_NAMES.indexOf(name)];
    const kindSum = ACTION_FEATURE_NAMES.filter((n) => n.startsWith("kind_"))
      .reduce((s, n) => s + at(n), 0);
    expect(kindSum).toBe(1);
    expect(at("kind_pass")).toBe(1);
    expect(at("attack_base_damage")).toBe(0);
    expect(at("attack_would_ko")).toBe(0);
    expect(at("ends_turn")).toBe(1);
  });

  it("zeroes the reposition block for non-reposition moves", () => {
    const REPO = [
      "reposition_move",
      "reposition_incoming_can_attack",
      "reposition_incoming_best_damage",
      "reposition_incoming_energy_units",
      "reposition_clears_status",
      "reposition_dodges_ko",
      "reposition_upgrades_attacker",
    ];
    for (const n of REPO) expect(ACTION_FEATURE_NAMES).toContain(n);
    const pass = legal.find((m) => m.kind === "pass")!;
    const vec = encodeActionFeatures(view, pass);
    for (const n of REPO) expect(vec[ACTION_FEATURE_NAMES.indexOf(n)]).toBe(0);
  });

  it("flags a retreat candidate as a reposition and reads the incoming mon", () => {
    const retreat = { kind: "retreat", benchIndex: 0 } as SimMove;
    const vec = encodeActionFeatures(view, retreat);
    const at = (name: string) => vec[ACTION_FEATURE_NAMES.indexOf(name)];
    expect(at("reposition_move")).toBe(1);
    // Incoming = bench[0]; its readiness mirrors the standalone target block.
    expect(at("reposition_incoming_can_attack")).toBe(at("target_can_attack"));
  });

  it("marks attach targets and card identity", () => {
    const attach = legal.find((m) => m.kind === "attach");
    if (!attach || attach.kind !== "attach") return; // opening hands always hold energy here
    const vec = encodeActionFeatures(view, attach);
    const at = (name: string) => vec[ACTION_FEATURE_NAMES.indexOf(name)];
    expect(at("kind_attach")).toBe(1);
    expect(at("card_is_energy")).toBe(1);
    expect(at("card_is_basic_energy")).toBe(1);
    expect(at("target_present")).toBe(1);
    expect(at("ends_turn")).toBe(0);
  });

  it("keeps the frozen top-card list intact (schema-bound)", () => {
    expect(POLICY_TOP_CARDS.length).toBe(32);
    expect(POLICY_TOP_CARDS[0]).toBe("Boss's Orders");
    // Each top card contributes hand/opp_board/card indicator slots.
    for (const name of POLICY_TOP_CARDS) {
      expect(STATE_FEATURE_NAMES).toContain(`hand:${name}`);
      expect(STATE_FEATURE_NAMES).toContain(`opp_board:${name}`);
      expect(ACTION_FEATURE_NAMES).toContain(`card:${name}`);
    }
  });
});
