// Policy feature encoding — the (state, action) representation for the
// next-action policy model.
//
// The policy answers "what is the best next thing I can do?": the engine
// enumerates legal moves, each (PlayerView, SimMove) pair is encoded here,
// a ranker scores them, and softmax over the scores is the policy. Both
// vectors are flat, fixed-length, and versioned: any change to a feature's
// position or meaning MUST bump POLICY_SCHEMA_VERSION (training refuses
// mixed corpora, same rule as FEATURE_SCHEMA_VERSION).
//
// Design rules (shared with the Phase-1 rows):
//   * Values are always finite numbers (never NaN/Infinity/undefined);
//     booleans are 0 | 1; unknown/absent is 0.
//   * Feature names are pinned by encoding a synthetic empty view once at
//     module load — every encode call pushes the SAME names in the SAME
//     order unconditionally, so names and vectors can never drift apart.
//   * POLICY_TOP_CARDS is a FROZEN snapshot of high-frequency meta cards
//     (deck-presence across data/meta-decks.json, 2026-07). It is part of
//     the schema: reordering or replacing entries requires a version bump.
//   * The oppmodel_* block is reserved (all zeros) for the future
//     archetype-posterior opponent model, so it can land without a bump.

import type { CardInstance, PokemonInPlay } from "@/lib/engine/types";
import type { PlayerView } from "@/lib/engine/sim/view";
import {
  applyWeaknessResistance,
  baseDamage,
  remainingHp,
  usableAttacks,
  type SimMove,
} from "@/lib/engine/sim/moves";
import {
  energyUnits,
  isBasic,
  isBasicEnergyCard,
  prizeValue,
} from "@/lib/engine/sim/setup";
import { isSupporter } from "@/lib/engine/sim/trainers";
import { effectiveMaxHp, isTool } from "@/lib/engine/sim/tools";
import { lookupCard } from "@/lib/engine/catalog";
import { num } from "./guards";

// v2: added the reposition_* action block (retreat/switch tactical value).
export const POLICY_SCHEMA_VERSION = 2;

/** Frozen top-of-meta card names (see header). Indicator slots below. */
export const POLICY_TOP_CARDS: readonly string[] = [
  "Boss's Orders",
  "Night Stretcher",
  "Lillie's Determination",
  "Ultra Ball",
  "Poké Pad",
  "Fezandipiti ex",
  "Buddy-Buddy Poffin",
  "Meowth ex",
  "Special Red Card",
  "Latias ex",
  "Lillie's Clefairy ex",
  "Crispin",
  "Hilda",
  "Team Rocket's Petrel",
  "Munkidori",
  "Secret Box",
  "Mega Kangaskhan ex",
  "Switch",
  "Air Balloon",
  "Energy Switch",
  "Rare Candy",
  "Budew",
  "Unfair Stamp",
  "Cyrano",
  "Ciphermaniac's Codebreaking",
  "Pokégear 3.0",
  "Dawn",
  "Telepathic Psychic Energy",
  "Dunsparce",
  "Dudunsparce",
  "Shaymin",
  "Lana's Aid",
];

const MOVE_KINDS = [
  "attach",
  "bench",
  "evolve",
  "retreat",
  "cycle_supporter",
  "cycle_item",
  "play_trainer",
  "use_ability",
  "play_stadium",
  "attach_tool",
  "use_stadium",
  "attack",
  "pass",
] as const;

const CONDITIONS = ["Asleep", "Paralyzed", "Confused", "Poisoned", "Burned"] as const;

const OPPMODEL_RESERVED_SLOTS = 8;

/* ─── Vector builder ────────────────────────────────────────────── */

/** Accumulates aligned (name, value) pairs. Every encode path must push
 *  unconditionally so names are identical for every input. */
class Vec {
  names: string[] = [];
  values: number[] = [];
  push(name: string, value: number | boolean | null | undefined): void {
    this.names.push(name);
    this.values.push(typeof value === "boolean" ? (value ? 1 : 0) : num(value));
  }
}

/* ─── Shared sub-blocks ─────────────────────────────────────────── */

function inPlay(board: PlayerView["board"]): PokemonInPlay[] {
  return [board.active, ...board.bench].filter((m): m is PokemonInPlay => m !== null);
}

/** Best printed damage among the attacks this mon can currently pay for. */
function bestUsableDamage(mon: PokemonInPlay): number {
  let best = 0;
  for (const { attack } of usableAttacks(mon)) best = Math.max(best, baseDamage(attack));
  return best;
}

function pushMon(v: Vec, prefix: string, mon: PokemonInPlay | null): void {
  v.push(`${prefix}_present`, mon !== null);
  v.push(`${prefix}_max_hp`, mon ? effectiveMaxHp(mon) : 0);
  v.push(`${prefix}_hp_remaining`, mon ? remainingHp(mon) : 0);
  v.push(`${prefix}_damage`, mon?.damage ?? 0);
  v.push(`${prefix}_energy_units`, mon ? mon.attachedEnergy.flatMap(energyUnits).length : 0);
  v.push(`${prefix}_tools`, mon?.attachedTools.length ?? 0);
  v.push(`${prefix}_prize_value`, mon ? prizeValue(mon.card.name) : 0);
  v.push(`${prefix}_can_attack`, mon ? usableAttacks(mon).length > 0 : false);
  v.push(`${prefix}_best_damage`, mon ? bestUsableDamage(mon) : 0);
  for (const cond of CONDITIONS) {
    v.push(`${prefix}_${cond.toLowerCase()}`, mon?.conditions.includes(cond) ?? false);
  }
}

function pushBench(v: Vec, prefix: string, bench: PokemonInPlay[]): void {
  v.push(`${prefix}_count`, bench.length);
  v.push(`${prefix}_hp_remaining`, bench.reduce((s, m) => s + remainingHp(m), 0));
  v.push(`${prefix}_damage`, bench.reduce((s, m) => s + m.damage, 0));
  v.push(`${prefix}_energy_units`, bench.reduce((s, m) => s + m.attachedEnergy.flatMap(energyUnits).length, 0));
  v.push(`${prefix}_attackers_ready`, bench.filter((m) => usableAttacks(m).length > 0).length);
  v.push(`${prefix}_max_prize_value`, bench.reduce((s, m) => Math.max(s, prizeValue(m.card.name)), 0));
}

function isEnergyCard(c: CardInstance): boolean {
  return c.catalog?.supertype === "Energy";
}

function isStadiumCard(c: CardInstance): boolean {
  return c.catalog?.supertype === "Trainer" && c.catalog.subtypes.includes("Stadium");
}

function isItemCard(c: CardInstance): boolean {
  return (
    c.catalog?.supertype === "Trainer" &&
    !isSupporter(c) &&
    !isStadiumCard(c) &&
    !isTool(c)
  );
}

function countEnergy(cards: CardInstance[]): number {
  return cards.filter(isEnergyCard).length;
}

/* ─── State features ────────────────────────────────────────────── */

function encodeState(view: PlayerView): Vec {
  const v = new Vec();

  // Game clock.
  v.push("turn_number", view.turn.number);
  v.push("player_turn_number", view.turn.playerTurnNumber);
  v.push("went_first", view.wentFirst === null ? 0.5 : view.wentFirst);
  v.push("my_prizes_taken", view.prizesTaken);
  v.push("opp_prizes_taken", view.opponent.prizesTaken);
  v.push("my_prizes_remaining", view.prizeCount);
  v.push("opp_prizes_remaining", view.opponent.prizeCount);
  v.push("my_deck_count", view.deckCount);
  v.push("opp_deck_count", view.opponent.deckCount);
  v.push("my_hand_count", view.hand.length);
  v.push("opp_hand_count", view.opponent.handCount);
  v.push("my_mulligans", view.mulligans);
  v.push("opp_mulligans", view.opponent.mulligans);

  // Within-turn flags — without these the model cannot sequence a turn.
  v.push("energy_attached_this_turn", view.energyAttachedThisTurn);
  v.push("supporter_played_this_turn", view.supporterPlayedThisTurn);
  v.push("stadium_played_this_turn", view.stadiumPlayedThisTurn);
  v.push("stadium_effect_used_this_turn", view.stadiumEffectUsedThisTurn);
  v.push("retreat_used_this_turn", view.retreatUsedThisTurn);

  // Global.
  v.push("stadium_present", view.stadium !== null);
  v.push("stadium_is_mine", view.stadium?.owner === view.actor);

  // Boards.
  pushMon(v, "my_active", view.board.active);
  pushMon(v, "opp_active", view.opponent.board.active);
  pushBench(v, "my_bench", view.board.bench);
  pushBench(v, "opp_bench", view.opponent.board.bench);

  // Own hand composition.
  const hand = view.hand;
  v.push("hand_basics", hand.filter(isBasic).length);
  v.push("hand_evolutions", hand.filter((c) => c.catalog?.supertype === "Pokémon" && !!c.catalog.evolves_from).length);
  v.push("hand_items", hand.filter(isItemCard).length);
  v.push("hand_supporters", hand.filter(isSupporter).length);
  v.push("hand_stadiums", hand.filter(isStadiumCard).length);
  v.push("hand_tools", hand.filter(isTool).length);
  v.push("hand_basic_energy", hand.filter(isBasicEnergyCard).length);
  v.push("hand_special_energy", hand.filter((c) => isEnergyCard(c) && !isBasicEnergyCard(c)).length);

  // Own unseen cards (deck ∪ prizes — the perfect-memory inference).
  let unseenTotal = 0;
  let unseenPokemon = 0;
  let unseenTrainer = 0;
  let unseenEnergy = 0;
  for (const [name, count] of Object.entries(view.unseenOwn)) {
    unseenTotal += count;
    const supertype = lookupCard(name)?.supertype;
    if (supertype === "Pokémon") unseenPokemon += count;
    else if (supertype === "Trainer") unseenTrainer += count;
    else if (supertype === "Energy") unseenEnergy += count;
  }
  v.push("unseen_total", unseenTotal);
  v.push("unseen_pokemon", unseenPokemon);
  v.push("unseen_trainer", unseenTrainer);
  v.push("unseen_energy", unseenEnergy);

  // Public piles.
  v.push("my_discard_count", view.discard.length);
  v.push("my_discard_energy", countEnergy(view.discard));
  v.push("opp_discard_count", view.opponent.discard.length);
  v.push("opp_discard_energy", countEnergy(view.opponent.discard));
  v.push("my_lost_zone_count", view.lostZone.length);
  v.push("opp_lost_zone_count", view.opponent.lostZone.length);

  // Frozen top-card indicators: counts in own hand, and on the opponent's
  // board (in-play names incl. lower stack stages — visible threats).
  const handCounts = new Map<string, number>();
  for (const c of hand) handCounts.set(c.name, (handCounts.get(c.name) ?? 0) + 1);
  const oppBoardCounts = new Map<string, number>();
  for (const mon of inPlay(view.opponent.board)) {
    for (const name of [mon.card.name, ...mon.stack.map((s) => s.name)]) {
      oppBoardCounts.set(name, (oppBoardCounts.get(name) ?? 0) + 1);
    }
  }
  for (const name of POLICY_TOP_CARDS) v.push(`hand:${name}`, handCounts.get(name) ?? 0);
  for (const name of POLICY_TOP_CARDS) v.push(`opp_board:${name}`, oppBoardCounts.get(name) ?? 0);

  // Reserved for the archetype-posterior opponent model.
  for (let i = 0; i < OPPMODEL_RESERVED_SLOTS; i++) v.push(`oppmodel_${i}`, 0);

  return v;
}

/* ─── Action features ───────────────────────────────────────────── */

function findMon(view: PlayerView, monId: string | undefined): PokemonInPlay | null {
  if (!monId) return null;
  return inPlay(view.board).find((m) => m.id === monId) ?? null;
}

function findHandCard(view: PlayerView, cardId: string | undefined): CardInstance | null {
  if (!cardId) return null;
  return view.hand.find((c) => c.id === cardId) ?? null;
}

/** The hand card a move plays, if any. */
function movedCard(view: PlayerView, move: SimMove): CardInstance | null {
  switch (move.kind) {
    case "attach":
    case "bench":
    case "evolve":
    case "cycle_supporter":
    case "cycle_item":
    case "play_trainer":
    case "play_stadium":
    case "attach_tool":
      return findHandCard(view, move.cardId);
    default:
      return null;
  }
}

/** The own in-play Pokémon a move targets, if any. */
function moveTarget(view: PlayerView, move: SimMove): PokemonInPlay | null {
  switch (move.kind) {
    case "attach":
    case "evolve":
    case "attach_tool":
      return findMon(view, move.targetId);
    case "retreat":
      return view.board.bench[move.benchIndex] ?? null;
    case "use_ability":
      return findMon(view, move.monId);
    case "play_trainer":
      return findMon(view, move.monId);
    default:
      return null;
  }
}

/** For a move that swaps the active Pokémon out, the (outgoing active,
 *  incoming promoted mon) pair — retreat today, extensible to Switch-type
 *  trainers later without a schema change (same features, wider coverage).
 *  null for every other move, so the reposition block encodes as zeros. */
function repositionSwap(
  view: PlayerView,
  move: SimMove,
): { outgoing: PokemonInPlay | null; incoming: PokemonInPlay | null } | null {
  if (move.kind === "retreat") {
    return { outgoing: view.board.active, incoming: view.board.bench[move.benchIndex] ?? null };
  }
  return null;
}

function encodeAction(view: PlayerView, move: SimMove): Vec {
  const v = new Vec();

  for (const kind of MOVE_KINDS) v.push(`kind_${kind}`, move.kind === kind);

  // The card being played from hand (0-block for board-only moves).
  const card = movedCard(view, move);
  v.push("card_present", card !== null);
  v.push("card_is_pokemon", card?.catalog?.supertype === "Pokémon");
  v.push("card_is_trainer", card?.catalog?.supertype === "Trainer");
  v.push("card_is_energy", card ? isEnergyCard(card) : false);
  v.push("card_is_supporter", card ? isSupporter(card) : false);
  v.push("card_is_item", card ? isItemCard(card) : false);
  v.push("card_is_stadium", card ? isStadiumCard(card) : false);
  v.push("card_is_tool", card ? isTool(card) : false);
  v.push("card_is_basic_energy", card ? isBasicEnergyCard(card) : false);
  v.push("card_prize_value", card?.catalog?.supertype === "Pokémon" ? prizeValue(card.name) : 0);
  for (const name of POLICY_TOP_CARDS) v.push(`card:${name}`, card?.name === name);

  // The own in-play Pokémon the move touches (attach/evolve/tool target,
  // retreat destination, ability user, trainer mon target).
  const target = moveTarget(view, move);
  v.push("target_present", target !== null);
  v.push("target_is_active", target !== null && target === view.board.active);
  v.push("target_max_hp", target ? effectiveMaxHp(target) : 0);
  v.push("target_hp_remaining", target ? remainingHp(target) : 0);
  v.push("target_damage", target?.damage ?? 0);
  v.push("target_energy_units", target ? target.attachedEnergy.flatMap(energyUnits).length : 0);
  v.push("target_prize_value", target ? prizeValue(target.card.name) : 0);
  v.push("target_can_attack", target ? usableAttacks(target).length > 0 : false);

  // Selection payloads.
  v.push("n_deck_picks", move.kind === "play_trainer" ? (move.deckCardIds?.length ?? 0) : 0);
  v.push("has_discard_pick", move.kind === "play_trainer" && !!move.discardPickId);
  v.push("targets_opp_bench", move.kind === "play_trainer" && move.oppBenchIndex !== undefined);
  v.push(
    "counters_moved",
    move.kind === "use_ability" ? (move.counters ?? 0)
      : move.kind === "attack" ? (move.benchCounters?.length ?? 0)
      : 0,
  );
  v.push("bench_damage_targets", move.kind === "attack" ? (move.benchDamageTargets?.length ?? 0) : 0);

  // Attack tactics — cheap one-ply lookahead vs. the opposing active.
  // Uses the printed number (state-scaled attacks under-read; the value
  // model and search see the true result).
  const attacker = move.kind === "attack" ? view.board.active : null;
  const attack = attacker?.card.catalog?.attacks[move.kind === "attack" ? move.attackIndex : 0] ?? null;
  const defender = view.opponent.board.active;
  const base = attacker && attack ? baseDamage(attack) : 0;
  const wr = attacker && attack && defender ? applyWeaknessResistance(base, attacker, defender) : 0;
  const koNow = defender !== null && wr >= remainingHp(defender) && wr > 0;
  v.push("attack_base_damage", base);
  v.push("attack_wr_damage", wr);
  v.push("attack_would_ko", koNow);
  v.push("attack_ko_prizes", koNow && defender ? prizeValue(defender.card.name) : 0);
  v.push("attack_overkill", koNow && defender ? wr - remainingHp(defender) : 0);
  v.push("ends_turn", move.kind === "attack" || move.kind === "pass");

  // Reposition tactics — the value of swapping the active out (retreat now,
  // Switch-type effects later). A linear ranker cannot express the decisive
  // comparisons (incoming attacker vs. the one pulled back, incoming threat
  // vs. our remaining HP) from separate state features, and the target_*
  // block above blends across every targeted kind, so these are encoded on
  // the candidate itself for clean, retreat-specific weights.
  const swap = repositionSwap(view, move);
  const outgoing = swap?.outgoing ?? null;
  const incoming = swap?.incoming ?? null;
  const oppActive = view.opponent.board.active;
  const incomingBest = incoming ? bestUsableDamage(incoming) : 0;
  const outgoingBest = outgoing ? bestUsableDamage(outgoing) : 0;
  const threat = oppActive ? bestUsableDamage(oppActive) : 0;
  v.push("reposition_move", swap !== null);
  v.push("reposition_incoming_can_attack", incoming ? usableAttacks(incoming).length > 0 : false);
  v.push("reposition_incoming_best_damage", incomingBest);
  v.push(
    "reposition_incoming_energy_units",
    incoming ? incoming.attachedEnergy.flatMap(energyUnits).length : 0,
  );
  v.push("reposition_clears_status", outgoing ? outgoing.conditions.length > 0 : false);
  v.push("reposition_dodges_ko", outgoing !== null && threat > 0 && threat >= remainingHp(outgoing));
  v.push("reposition_upgrades_attacker", swap !== null && incomingBest > outgoingBest);

  return v;
}

/* ─── Public API ────────────────────────────────────────────────── */

export function encodeStateFeatures(view: PlayerView): number[] {
  return encodeState(view).values;
}

export function encodeActionFeatures(view: PlayerView, move: SimMove): number[] {
  return encodeAction(view, move).values;
}

/** Synthetic empty view — used only to pin the feature-name order. */
const EMPTY_VIEW: PlayerView = {
  actor: "player",
  turn: { number: 0, playerTurnNumber: 0, actor: "player", phase: "turn" },
  wentFirst: null,
  hand: [],
  board: { active: null, bench: [] },
  discard: [],
  lostZone: [],
  deckCount: 0,
  prizeCount: 0,
  prizesTaken: 0,
  mulligans: 0,
  unseenOwn: {},
  energyAttachedThisTurn: 0,
  supporterPlayedThisTurn: false,
  retreatUsedThisTurn: false,
  stadiumPlayedThisTurn: false,
  stadiumEffectUsedThisTurn: false,
  stadium: null,
  opponent: {
    board: { active: null, bench: [] },
    discard: [],
    lostZone: [],
    handCount: 0,
    deckCount: 0,
    prizeCount: 0,
    prizesTaken: 0,
    mulligans: 0,
  },
};

/** Ordered names, aligned by index with the encode outputs. */
export const STATE_FEATURE_NAMES: readonly string[] = encodeState(EMPTY_VIEW).names;
export const ACTION_FEATURE_NAMES: readonly string[] = encodeAction(EMPTY_VIEW, { kind: "pass" }).names;
