// Pokémon abilities. Two shapes:
//   * activated — a `use_ability` move the player takes on their turn
//     (Munkidori's Adrena-Brain, Dusknoir's Cursed Blast). Once per turn
//     per Pokémon (tracked via PokemonInPlay.abilitiesUsedThisTurn).
//   * on-evolve — fires automatically when a specific Pokémon evolves
//     (Charizard ex's Infernal Reign). Resolved by the driver's evolve path.
//
// Registry keyed by "CardName::AbilityName". Targets ride on the move so
// the client can render pickers and the AI can score without special-casing.

import type { CardInstance, GameState, PlayerSide, PokemonInPlay } from "../types";
import { moveCounters, placeCounters } from "./damage";
import { energyProvides, isBasicEnergyCard } from "./setup";

export interface UseAbilityMove {
  kind: "use_ability";
  monId: string;
  abilityName: string;
  /** Munkidori: own Pokémon to pull counters from, opponent Pokémon to add to. */
  sourceMonId?: string;
  targetMonId?: string;
  counters?: number;
  /** Reserved for future abilities that pick a card (Drakloak, Gardevoir). */
  cardId?: string;
}

type Actor = "player" | "opponent";

/* ─── Helpers ───────────────────────────────────────────────────── */

export function allInPlay(side: PlayerSide): PokemonInPlay[] {
  return [side.active, ...side.bench].filter((m): m is PokemonInPlay => m !== null);
}

function hasEnergyType(mon: PokemonInPlay, type: string): boolean {
  return mon.attachedEnergy.some((c) => energyProvides(c) === type);
}

/** True when the ability on `mon` can be activated this turn. */
export function abilityAvailable(state: GameState, actor: Actor, mon: PokemonInPlay): { name: string } | null {
  const ability = mon.card.catalog?.abilities?.[0];
  if (!ability) return null;
  const key = `${mon.card.name}::${ability.name}`;
  const spec = ACTIVATED[key];
  if (!spec) return null;
  if (mon.abilitiesUsedThisTurn.includes(ability.name)) return null;
  return spec.available(state, actor, mon) ? { name: ability.name } : null;
}

/* ─── Activated ability registry ────────────────────────────────── */

interface ActivatedSpec {
  available: (state: GameState, actor: Actor, mon: PokemonInPlay) => boolean;
  /** All concrete plays (target combinations) for the UI/AI. */
  moves: (state: GameState, actor: Actor, mon: PokemonInPlay) => UseAbilityMove[];
  /** Apply a validated move. */
  apply: (state: GameState, actor: Actor, mon: PokemonInPlay, move: UseAbilityMove) => void;
}

const ACTIVATED: Record<string, ActivatedSpec> = {
  // Munkidori — Adrena-Brain: if it has Darkness Energy, move up to 3 damage
  // counters from 1 of your Pokémon to 1 of your opponent's Pokémon.
  "Munkidori::Adrena-Brain": {
    available: (state, actor, mon) => {
      if (!hasEnergyType(mon, "Darkness")) return false;
      const own = allInPlay(state.sides[actor]).some((m) => m.damage >= 10);
      const opp = allInPlay(state.sides[actor === "player" ? "opponent" : "player"]).length > 0;
      return own && opp;
    },
    moves: (state, actor, mon) => {
      const own = allInPlay(state.sides[actor]).filter((m) => m.damage >= 10);
      const opp = allInPlay(state.sides[actor === "player" ? "opponent" : "player"]);
      const out: UseAbilityMove[] = [];
      for (const src of own) {
        const max = Math.min(3, Math.floor(src.damage / 10));
        for (const tgt of opp) {
          out.push({
            kind: "use_ability",
            monId: mon.id,
            abilityName: "Adrena-Brain",
            sourceMonId: src.id,
            targetMonId: tgt.id,
            counters: max,
          });
        }
      }
      return out;
    },
    apply: (state, actor, mon, move) => {
      const own = allInPlay(state.sides[actor]).find((m) => m.id === move.sourceMonId);
      const opp = allInPlay(state.sides[actor === "player" ? "opponent" : "player"]).find(
        (m) => m.id === move.targetMonId,
      );
      if (own && opp) {
        moveCounters(own, opp, Math.max(1, Math.min(3, move.counters ?? 3)));
        mon.abilitiesUsedThisTurn.push("Adrena-Brain");
      }
    },
  },

  // Dusknoir — Cursed Blast: put 13 damage counters on 1 of your opponent's
  // Pokémon; then this Pokémon is Knocked Out.
  "Dusknoir::Cursed Blast": {
    available: (state, actor) =>
      allInPlay(state.sides[actor === "player" ? "opponent" : "player"]).length > 0,
    moves: (state, actor, mon) =>
      allInPlay(state.sides[actor === "player" ? "opponent" : "player"]).map((tgt) => ({
        kind: "use_ability",
        monId: mon.id,
        abilityName: "Cursed Blast",
        targetMonId: tgt.id,
      })),
    apply: (state, actor, mon, move) => {
      const opp = allInPlay(state.sides[actor === "player" ? "opponent" : "player"]).find(
        (m) => m.id === move.targetMonId,
      );
      if (!opp) return;
      placeCounters(opp, 13);
      mon.abilitiesUsedThisTurn.push("Cursed Blast");
      // Self-KO: mark this Pokémon lethally so the driver's resolveKnockouts
      // removes it and awards the prize to the opponent.
      mon.damage = (mon.card.catalog?.hp ?? 120) + 130;
    },
  },
};

/** Every activated-ability move available to `actor` this turn. */
export function abilityMoves(state: GameState, actor: Actor): UseAbilityMove[] {
  const out: UseAbilityMove[] = [];
  for (const mon of allInPlay(state.sides[actor])) {
    const avail = abilityAvailable(state, actor, mon);
    if (!avail) continue;
    const ability = mon.card.catalog!.abilities![0];
    out.push(...ACTIVATED[`${mon.card.name}::${ability.name}`].moves(state, actor, mon));
  }
  return out;
}

export function applyAbility(state: GameState, actor: Actor, move: UseAbilityMove): void {
  const mon = allInPlay(state.sides[actor]).find((m) => m.id === move.monId);
  if (!mon) return;
  const ability = mon.card.catalog?.abilities?.[0];
  if (!ability || ability.name !== move.abilityName) return;
  ACTIVATED[`${mon.card.name}::${ability.name}`]?.apply(state, actor, mon, move);
}

/* ─── On-evolve triggers ────────────────────────────────────────── */

/** Fires when `evolved` (the new top card) enters play by evolution.
 *  rng drives the post-search shuffle; null on ghost evaluations. */
export function onEvolve(
  state: GameState,
  actor: Actor,
  evolved: PokemonInPlay,
  shuffle: (() => void) | null,
): void {
  // Charizard ex — Infernal Reign: search deck for up to 3 Basic Fire
  // Energy and attach to your Pokémon in any way. Auto: pile onto the
  // evolved Charizard (the intended attacker) for a clean v1.
  if (evolved.card.name === "Charizard ex") {
    const side = state.sides[actor];
    const fire = side.deck.filter(
      (c) => isBasicEnergyCard(c) && energyProvides(c) === "Fire",
    );
    for (const energy of fire.slice(0, 3)) {
      const idx = side.deck.indexOf(energy);
      if (idx >= 0) evolved.attachedEnergy.push(...side.deck.splice(idx, 1));
    }
    shuffle?.();
  }
}

export function hasOnEvolveTrigger(card: CardInstance): boolean {
  return card.name === "Charizard ex";
}
