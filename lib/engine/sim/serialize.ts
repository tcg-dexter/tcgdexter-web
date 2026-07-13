// Client-facing serialization: redacted view payloads and human-readable
// action descriptions. Everything here works from public information —
// a card's identity becomes describable exactly when the move makes it
// public (played, benched, attached, discarded).

import type { PokemonInPlay } from "../types";
import type { GameState } from "../types";
import { computeDamage, remainingHp, sideOf, type SimMove } from "./moves";
import { attackBenchCounterCount, attackBenchDamageTargets } from "./attacks";
import { energyProvides } from "./setup";
import type { PlayerView } from "./view";

/* ─── Action descriptions (for the AI move feed) ────────────────── */

function cardName(state: GameState, actor: "player" | "opponent", cardId: string): string {
  const card = sideOf(state, actor).hand.find((c) => c.id === cardId);
  return card?.name ?? "a card";
}

function monName(state: GameState, actor: "player" | "opponent", monId: string): string {
  const side = sideOf(state, actor);
  const mon = [side.active, ...side.bench].find((m) => m?.id === monId);
  return mon?.card.name ?? "a Pokémon";
}

/** Describe a move from public info. Call BEFORE applying it. */
export function describeMove(
  state: GameState,
  actor: "player" | "opponent",
  move: SimMove,
): string {
  const side = sideOf(state, actor);
  switch (move.kind) {
    case "attach": {
      const card = side.hand.find((c) => c.id === move.cardId);
      const type = card ? energyProvides(card) : null;
      return `Attached ${card?.name ?? "an energy"}${type ? "" : ""} to ${monName(state, actor, move.targetId)}`;
    }
    case "bench":
      return `Benched ${cardName(state, actor, move.cardId)}`;
    case "evolve":
      return `Evolved ${monName(state, actor, move.targetId)} into ${cardName(state, actor, move.cardId)}`;
    case "retreat":
      return `Retreated ${side.active?.card.name ?? "the active"} for ${side.bench[move.benchIndex]?.card.name ?? "a benched Pokémon"}`;
    case "cycle_supporter":
      return `Played ${cardName(state, actor, move.cardId)} (drew 2)`;
    case "cycle_item":
      return `Played ${cardName(state, actor, move.cardId)} (drew 1)`;
    case "play_trainer": {
      const name = cardName(state, actor, move.cardId);
      if (move.deckCardNames?.length) {
        return `Played ${name} — fetched ${move.deckCardNames.join(" and ")}`;
      }
      if (move.discardPickName) {
        return `Played ${name} — recovered ${move.discardPickName}`;
      }
      if (move.oppBenchIndex != null) {
        const target = sideOf(state, actor === "player" ? "opponent" : "player").bench[move.oppBenchIndex];
        return `Played ${name} — switched in ${target?.card.name ?? "a benched Pokémon"}`;
      }
      if (move.benchIndex != null) {
        const target = side.bench[move.benchIndex];
        return `Played ${name} — ${target?.card.name ?? "a benched Pokémon"} to the Active Spot`;
      }
      if (move.handCardId != null) {
        const target = [side.active, ...side.bench].find((m) => m?.id === move.monId);
        return `Played ${name} — evolved ${target?.card.name ?? "a Pokémon"} into ${cardName(state, actor, move.handCardId)}`;
      }
      if (move.monId != null) {
        return `Played ${name} on ${monName(state, actor, move.monId)}`;
      }
      return `Played ${name}`;
    }
    case "attack": {
      const attacker = side.active;
      const defender = sideOf(state, actor === "player" ? "opponent" : "player").active;
      const attack = attacker?.card.catalog?.attacks[move.attackIndex];
      if (!attacker || !attack) return "Attacked";
      if (!defender) return `Used ${attack.name}`;
      const dmg = computeDamage(attacker, attack, defender);
      const ko = dmg >= remainingHp(defender);
      return `Used ${attack.name} for ${dmg} damage${ko ? ` — Knocked Out ${defender.card.name}!` : ""}`;
    }
    case "play_stadium":
      return `Played Stadium ${cardName(state, actor, move.cardId)}`;
    case "use_ability": {
      const mon = [side.active, ...side.bench].find((m) => m?.id === move.monId);
      const oppName = move.targetMonId
        ? monName(state, actor === "player" ? "opponent" : "player", move.targetMonId)
        : null;
      const base = `Used ${mon?.card.name ?? "a Pokémon"}'s ${move.abilityName}`;
      return oppName ? `${base} on ${oppName}` : base;
    }
    case "pass":
      return "Ended turn";
  }
}

export function describePromotion(name: string): string {
  return `Promoted ${name} to the Active Spot`;
}

/* ─── Client view payload ───────────────────────────────────────── */

export interface ClientCard {
  id: string;
  name: string;
}

export interface ClientMon {
  id: string;
  name: string;
  hp: number | null;
  damage: number;
  /** Attached energy card names, in attach order. */
  energy: string[];
  /** Provided energy types (for cost affordances in the UI). */
  energyTypes: string[];
  /** Pre-evolution names under this mon. */
  stack: string[];
  retreatCost: number;
  attacks: {
    name: string;
    cost: string[];
    damage: string;
    /** Damage counters this attack places on the opponent's bench (Phantom
     *  Dive) — the UI enters placement mode when > 0. */
    benchCounters?: number;
    /** Benched Pokémon this attack deals raw damage to (Flamebody Cannon). */
    benchDamageTargets?: number;
  }[];
  /** Special conditions on this Pokémon (Poisoned, Asleep, …). */
  conditions: string[];
}

export interface ClientBoard {
  active: ClientMon | null;
  bench: ClientMon[];
}

export interface ClientView {
  turn: { number: number; playerTurnNumber: number; actor: string };
  wentFirst: boolean | null;
  hand: ClientCard[];
  board: ClientBoard;
  discard: ClientCard[];
  deckCount: number;
  prizeCount: number;
  prizesTaken: number;
  energyAttachedThisTurn: number;
  supporterPlayedThisTurn: boolean;
  stadium: { name: string; owner: "player" | "opponent" } | null;
  opponent: {
    board: ClientBoard;
    discard: ClientCard[];
    handCount: number;
    deckCount: number;
    prizeCount: number;
    prizesTaken: number;
  };
}

function clientMon(mon: PokemonInPlay): ClientMon {
  return {
    id: mon.id,
    name: mon.card.name,
    hp: mon.card.catalog?.hp ?? null,
    damage: mon.damage,
    energy: mon.attachedEnergy.map((c) => c.name),
    energyTypes: mon.attachedEnergy
      .map(energyProvides)
      .filter((t): t is string => t !== null),
    stack: mon.stack.map((c) => c.name),
    retreatCost: mon.card.catalog?.retreat_cost ?? 0,
    attacks: (mon.card.catalog?.attacks ?? []).map((a, i) => {
      const counters = attackBenchCounterCount(mon, i);
      const benchDmg = attackBenchDamageTargets(mon, i);
      return {
        name: a.name,
        cost: a.cost,
        damage: a.damage,
        ...(counters > 0 ? { benchCounters: counters } : {}),
        ...(benchDmg > 0 ? { benchDamageTargets: benchDmg } : {}),
      };
    }),
    conditions: [...mon.conditions],
  };
}

function clientBoard(board: { active: PokemonInPlay | null; bench: PokemonInPlay[] }): ClientBoard {
  return {
    active: board.active ? clientMon(board.active) : null,
    bench: board.bench.map(clientMon),
  };
}

export function serializeView(view: PlayerView): ClientView {
  return {
    turn: {
      number: view.turn.number,
      playerTurnNumber: view.turn.playerTurnNumber,
      actor: view.turn.actor,
    },
    wentFirst: view.wentFirst,
    hand: view.hand.map((c) => ({ id: c.id, name: c.name })),
    board: clientBoard(view.board),
    discard: view.discard.map((c) => ({ id: c.id, name: c.name })),
    deckCount: view.deckCount,
    prizeCount: view.prizeCount,
    prizesTaken: view.prizesTaken,
    energyAttachedThisTurn: view.energyAttachedThisTurn,
    supporterPlayedThisTurn: view.supporterPlayedThisTurn,
    stadium: view.stadium,
    opponent: {
      board: clientBoard(view.opponent.board),
      discard: view.opponent.discard.map((c) => ({ id: c.id, name: c.name })),
      handCount: view.opponent.handCount,
      deckCount: view.opponent.deckCount,
      prizeCount: view.opponent.prizeCount,
      prizesTaken: view.opponent.prizesTaken,
    },
  };
}
