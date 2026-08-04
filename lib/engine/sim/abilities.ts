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
import { isSupporter, pickDiscards } from "./trainers";
import { stadiumSuppressesAbility } from "./stadiums";
import { auraBlocksSelfKoAbility } from "./auras";

/** Abilities whose cost is knocking their own Pokémon out — the set Psyduck's
 *  Damp shuts down. */
const SELF_KO_ABILITIES = new Set(["Dusknoir::Cursed Blast", "Dusclops::Cursed Blast"]);

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
  // A Stadium may switch this Pokémon's Abilities off entirely.
  if (stadiumSuppressesAbility(mon, state)) return null;
  // Psyduck's Damp switches off abilities that KO their own user.
  if (SELF_KO_ABILITIES.has(`${mon.card.name}::${ability.name}`) && auraBlocksSelfKoAbility(state)) {
    return null;
  }
  const key = `${mon.card.name}::${ability.name}`;
  const spec = ACTIVATED[key];
  if (!spec) return null;
  if (mon.abilitiesUsedThisTurn.includes(ability.name)) return null;
  return spec.available(state, actor, mon) ? { name: ability.name } : null;
}

/* ─── Activated ability registry ────────────────────────────────── */

/** What an activated ability DOES, in the same vocabulary `TrainerSpec.phase`
 *  uses. The policies need this: without it they can only recognise abilities
 *  by name, and an allowlist silently drops every ability nobody remembered to
 *  add. That is exactly what happened — Trade, Flip the Script and Attract
 *  Customers (the card-flow engines of three archetypes) were enumerated as
 *  legal moves and then never chosen, so those decks never drew and never
 *  attacked. Classify here, next to the effect, not in the policy. */
export type AbilityPhase = "draw" | "search" | "tactical";

interface ActivatedSpec {
  /** Coarse class the policies dispatch on. */
  phase: AbilityPhase;
  /** Hand cards this ability makes you DISCARD as a cost, if any.
   *
   *  Declared here for the same reason `phase` is: the UI cannot otherwise
   *  know that Trade ("discard a card from your hand, then draw 2") owes the
   *  player a choice. `apply` has always honoured a supplied `move.cardId`
   *  and fallen back to auto-picking — but nothing ever supplied one, so the
   *  auto-picker silently chose which card left your hand. */
  handDiscard?: number;
  available: (state: GameState, actor: Actor, mon: PokemonInPlay) => boolean;
  /** All concrete plays (target combinations) for the UI/AI. */
  moves: (state: GameState, actor: Actor, mon: PokemonInPlay) => UseAbilityMove[];
  /** Apply a validated move. */
  apply: (state: GameState, actor: Actor, mon: PokemonInPlay, move: UseAbilityMove) => void;
}

const ACTIVATED: Record<string, ActivatedSpec> = {
  // N's Zoroark ex — Trade: discard a card from your hand, then draw 2.
  // Once per turn. v1 auto-discards the least useful card (a human discard
  // choice is a future refinement; the reserved move.cardId can carry it).
  "N's Zoroark ex::Trade": {
    phase: "draw",
    handDiscard: 1,
    available: (state, actor) => {
      const side = state.sides[actor];
      return side.deck.length > 0 && side.hand.length > 0;
    },
    moves: (state, actor, mon) => [
      { kind: "use_ability", monId: mon.id, abilityName: "Trade" },
    ],
    apply: (state, actor, mon, move) => {
      const side = state.sides[actor];
      if (side.deck.length === 0 || side.hand.length === 0) return;
      // Prefer a human-chosen discard (move.cardId) when supplied and in hand;
      // otherwise auto-pick the least useful card.
      const chosen =
        (move.cardId ? side.hand.find((c) => c.id === move.cardId) : undefined) ??
        pickDiscards(side, 1, "")[0];
      if (chosen) {
        const idx = side.hand.findIndex((c) => c.id === chosen.id);
        if (idx >= 0) side.discard.push(...side.hand.splice(idx, 1));
      }
      side.hand.push(...side.deck.splice(0, 2));
      mon.abilitiesUsedThisTurn.push("Trade");
    },
  },

  // Fezandipiti ex — Flip the Script: once during your turn, if any of your
  // Pokémon were Knocked Out during your opponent's last turn, draw 3.
  // (v1 gates once-per-Pokémon; the "1 per turn across copies" cap is a
  // future refinement — decks run a single copy.)
  "Fezandipiti ex::Flip the Script": {
    phase: "draw",
    available: (state, actor) => {
      const side = state.sides[actor];
      return side.koedLastOppTurn === true && side.deck.length > 0;
    },
    moves: (state, actor, mon) => [
      { kind: "use_ability", monId: mon.id, abilityName: "Flip the Script" },
    ],
    apply: (state, actor, mon) => {
      const side = state.sides[actor];
      side.hand.push(...side.deck.splice(0, 3));
      mon.abilitiesUsedThisTurn.push("Flip the Script");
    },
  },

  // Tatsugiri — Attract Customers: once during your turn, if this Pokémon is
  // Active, look at the top 6 cards, reveal a Supporter and put it into your
  // hand, then put the rest on the bottom of your deck. v1 auto-picks the
  // first Supporter and returns the rest in order (deterministic for replay).
  "Tatsugiri::Attract Customers": {
    phase: "search",
    available: (state, actor, mon) => {
      const side = state.sides[actor];
      if (side.active !== mon || side.deck.length === 0) return false;
      return side.deck.slice(0, 6).some(isSupporter);
    },
    moves: (state, actor, mon) => [
      { kind: "use_ability", monId: mon.id, abilityName: "Attract Customers" },
    ],
    apply: (state, actor, mon) => {
      const side = state.sides[actor];
      const top = side.deck.splice(0, 6);
      const idx = top.findIndex(isSupporter);
      if (idx >= 0) side.hand.push(...top.splice(idx, 1));
      side.deck.push(...top); // remainder to the bottom
      mon.abilitiesUsedThisTurn.push("Attract Customers");
    },
  },

  // Munkidori — Adrena-Brain: if it has Darkness Energy, move up to 3 damage
  // counters from 1 of your Pokémon to 1 of your opponent's Pokémon.
  "Munkidori::Adrena-Brain": {
    phase: "tactical",
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
    phase: "tactical",
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

/** Is this ability handled by the LEGACY activated registry? The precedence
 *  check the declarative path uses (moves.ts): legacy specs keep their tuned
 *  handling and the policies' `use_ability` branches; declarative records only
 *  cover abilities the legacy registry does NOT. */
/** How many hand cards this legacy ability discards as a cost (0 if none). */
export function activatedHandDiscard(cardName: string, abilityName: string): number {
  return ACTIVATED[`${cardName}::${abilityName}`]?.handDiscard ?? 0;
}

/** Coarse class of a legacy activated ability, for policy dispatch. Null when
 *  the ability isn't in this registry (the declarative path classifies its own
 *  via `effectMovePhase`). */
export function activatedPhase(cardName: string, abilityName: string): AbilityPhase | null {
  return ACTIVATED[`${cardName}::${abilityName}`]?.phase ?? null;
}

export function hasLegacyActivated(cardName: string, abilityName: string): boolean {
  return `${cardName}::${abilityName}` in ACTIVATED;
}

/** Effect-coverage predicate (W1): is this Pokémon ability actually modeled,
 *  either as an activated ability or an on-evolve trigger? Declarative records
 *  count too — see classifyCardEffects (coverage.ts), which ORs this with the
 *  effects registry (kept there to avoid an abilities → effects import cycle). */
export function isAbilityModeled(cardName: string, abilityName: string): boolean {
  if (hasLegacyActivated(cardName, abilityName)) return true;
  return cardName === "Charizard ex" && abilityName === "Infernal Reign";
}

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
