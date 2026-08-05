// Human move validation. Most moves must match an enumerated legal move
// exactly, but moves that carry a human SELECTION (discard costs, damage-
// counter allocations, ability targets) can't be pre-enumerated in full —
// the legal set holds their "core" shape and the selection is validated
// against constraints here. Keeping this in one place means the API layer
// (which replays untrusted transcripts) has a single trust boundary.

import type { GameState, PokemonInPlay } from "../types";
import { copyChoices, legalMoves, type SimMove, type TurnContext } from "./moves";
import { attackBenchCounterCount, attackBenchDamageTargets } from "./attacks";
import { isSupporter, trainerDiscardCost } from "./trainers";
import { enumerateEffect, type EffectMove } from "./effects/runtime";
import {
  attackRiderEffect,
  effectDiscardCost,
  effectDiscardFilter,
  effectOwnHandTrimTo,
  effectsFor,
  onAttachEffect,
} from "./effects/cards";
import { cardMatches } from "./effects/match";
import { activatedHandDiscard } from "./abilities";
import { stadiumHandCost } from "./stadiums";

/** Order-insensitive fingerprint of an effect move's picks, so a human
 *  selection matches an enumerated move regardless of id/slot ordering. */
function effectPicks(m: EffectMove): string {
  return JSON.stringify(
    m.picks
      .map((p) => ({
        ref: p.ref,
        mon: [...(p.monIds ?? [])].sort(),
        card: [...(p.cardIds ?? [])].sort(),
      }))
      .sort((a, b) => (a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0)),
  );
}

/** Core (non-selection) fields of a play_trainer move — everything the
 *  enumerator produces. Selection fields (discardCardIds) are excluded so a
 *  human-supplied discard choice still matches its enumerated core. */
function trainerCore(m: Extract<SimMove, { kind: "play_trainer" }>): string {
  const { discardCardIds: _d, ...core } = m;
  return JSON.stringify(core);
}

/** Same idea for a Stadium: `handCardIds` is a selection, not an enumerated
 *  variant, so it must be stripped before the structural compare. */
function stadiumCore(m: Extract<SimMove, { kind: "use_stadium" }>): string {
  const { handCardIds: _h, ...core } = m;
  return JSON.stringify(core);
}

/** True when `move` is a legal human decision in the current state. */
export function isLegalHumanMove(
  state: GameState,
  actor: "player" | "opponent",
  ctx: TurnContext,
  move: SimMove,
): boolean {
  // expandAuto: this is the HUMAN's move, and humanOptions offered them the
  // expanded set (every Energy split Crispin allows, every Janine target
  // subset). Re-enumerating narrow would reject the choice they were given.
  const legal = legalMoves(state, actor, ctx, true);

  // A Stadium's activated effect may make the player choose out of their own
  // hand (Academy at Night's top-deck, Prism Tower's two discards). Like a
  // trainer's discard cost these are a SELECTION, not an enumerated variant,
  // so the generic comparison below cannot see them: without this check a
  // forged move could top-deck or discard a card the player doesn't hold.
  if (move.kind === "use_stadium" && move.handCardIds != null) {
    const side = state.sides[actor];
    const need = stadiumHandCost(move.stadiumName, side.hand.length);
    const ids = move.handCardIds;
    if (ids.length !== need) return false;
    if (new Set(ids).size !== ids.length) return false;
    if (!ids.every((id) => side.hand.some((c) => c.id === id))) return false;
    // Fall through to the structural check on the rest of the move.
  }

  if (move.kind === "play_trainer") {
    const core = trainerCore(move);
    const match = legal.find(
      (m): m is Extract<SimMove, { kind: "play_trainer" }> =>
        m.kind === "play_trainer" && trainerCore(m) === core,
    );
    if (!match) return false;
    // Validate a supplied discard selection: right count, all in hand, no
    // duplicates, and never the trainer card being played.
    if (move.discardCardIds != null) {
      const side = state.sides[actor];
      const card = side.hand.find((c) => c.id === move.cardId);
      if (!card) return false;
      const need = trainerDiscardCost(card);
      const ids = move.discardCardIds;
      if (ids.length !== need) return false;
      if (new Set(ids).size !== ids.length) return false;
      return ids.every((id) => id !== move.cardId && side.hand.some((c) => c.id === id));
    }
    return true;
  }

  // Abilities enumerate every target combination, but the human may pass a
  // smaller `counters` (Munkidori "up to 3"); match on the core targets and
  // clamp the count separately.
  if (move.kind === "use_ability") {
    const match = legal.find(
      (m): m is Extract<SimMove, { kind: "use_ability" }> =>
        m.kind === "use_ability" &&
        m.monId === move.monId &&
        m.abilityName === move.abilityName &&
        m.sourceMonId === move.sourceMonId &&
        m.targetMonId === move.targetMonId,
    );
    if (!match) return false;
    if (move.counters != null && (move.counters < 1 || move.counters > (match.counters ?? move.counters))) {
      return false;
    }
    // The player's chosen discard (Trade). Enumeration does not include it —
    // the AI auto-picks — so this comparison deliberately ignores `cardId`,
    // which means it must be checked HERE or a forged move could discard a
    // card the player doesn't hold, or attach a discard to an ability that
    // has no such cost.
    if (move.cardId !== undefined) {
      const side = state.sides[actor];
      const mon = [side.active, ...side.bench].find((m) => m?.id === move.monId);
      if (!mon) return false;
      if (activatedHandDiscard(mon.card.name, move.abilityName) === 0) return false;
      if (!side.hand.some((c) => c.id === move.cardId)) return false;
    }
    return true;
  }

  // Attach with an ON-ATTACH effect: the picks choose real cards out of a
  // hidden zone (Telepathic's 2 Basics), so they need the same exact-match
  // treatment as rider picks — the generic legalMoves comparison below would
  // not catch a forged pick.
  if (move.kind === "attach" && move.attachPicks != null && move.attachPicks.length > 0) {
    const side = state.sides[actor];
    const card = side.hand.find((c) => c.id === move.cardId);
    const target = [side.active, ...side.bench].find((m) => m?.id === move.targetId) ?? null;
    if (!card || !target) return false;
    if (side.energyAttachedThisTurn !== 0) return false;
    const onAttach = onAttachEffect(card.name);
    if (!onAttach) return false;
    const enumerated = enumerateEffect(
      state,
      actor,
      { id: card.id, name: card.name },
      onAttach.effect,
      onAttach.index,
      target,
    );
    const supplied = effectPicks({
      kind: "effect",
      sourceId: target.id,
      card: card.name,
      effectIndex: onAttach.index,
      picks: move.attachPicks,
    });
    return enumerated.some((m) => effectPicks(m) === supplied);
  }

  if (move.kind === "attack") {
    const match = legal.find(
      (m): m is Extract<SimMove, { kind: "attack" }> =>
        m.kind === "attack" && m.attackIndex === move.attackIndex,
    );
    if (!match) return false;
    const attacker = state.sides[actor].active;
    if (!attacker) return false;
    const oppBench = state.sides[actor === "player" ? "opponent" : "player"].bench;
    const onBench = (id: string) => oppBench.some((m) => m.id === id);
    // Bench-counter allocation: one entry per counter (repeats allowed),
    // every target on the opponent's bench. Full count required when the
    // bench is non-empty; empty when there's no bench (the counters fizzle).
    if (move.benchCounters != null) {
      const need = attackBenchCounterCount(attacker, move.attackIndex);
      const expected = oppBench.length > 0 ? need : 0;
      if (move.benchCounters.length !== expected) return false;
      if (!move.benchCounters.every(onBench)) return false;
    }
    if (move.benchDamageTargets != null) {
      const targets = attackBenchDamageTargets(attacker, move.attackIndex);
      if (move.benchDamageTargets.length > targets) return false;
      if (new Set(move.benchDamageTargets).size !== move.benchDamageTargets.length) return false;
      if (!move.benchDamageTargets.every(onBench)) return false;
    }
    // A rider that costs cards from hand (Team Rocket's Porygon's Hacking
    // discards 1). Enumeration auto-picks these, so they are not part of the
    // pick fingerprint and must be checked here: distinct cards, actually in
    // hand, exactly as many as the rider demands.
    if (move.riderDiscardCardIds != null) {
      const side = state.sides[actor];
      const attackName = attacker.card.catalog?.attacks[move.attackIndex]?.name;
      const r = attackName ? attackRiderEffect(attacker.card.name, attackName) : null;
      if (!r) return false;
      const need = effectDiscardCost(attacker.card.name, r.index);
      const ids = move.riderDiscardCardIds;
      if (need === 0) return false;
      if (ids.length !== need) return false;
      if (new Set(ids).size !== ids.length) return false;
      if (!ids.every((id) => side.hand.some((c) => c.id === id))) return false;
    }

    // A copied attack (Night Joker). The pick is not part of the picks
    // fingerprint, so without this a forged move could copy ANY attack in
    // the game — including one on a Pokémon that isn't even on our bench.
    if (move.copyPick != null) {
      const attackName = attacker.card.catalog?.attacks[move.attackIndex]?.name ?? "";
      const offered = copyChoices(state, actor, attacker, attackName);
      const ok = offered.some(
        (c) => c.monId === move.copyPick!.monId && c.attackIndex === move.copyPick!.attackIndex,
      );
      if (!ok) return false;
    }

    // Declarative rider picks (Cruel Arrow's target). The rider resolves inside
    // this attack, so a forged pick here would hit an arbitrary Pokémon —
    // re-enumerate and require an exact match, same as a standalone effect move.
    const attack = attacker.card.catalog?.attacks[move.attackIndex];
    const rider = attack ? attackRiderEffect(attacker.card.name, attack.name) : null;
    const wantsPicks = (rider?.effect.targets?.length ?? 0) > 0;
    if (move.riderPicks != null && move.riderPicks.length > 0) {
      if (!rider || !wantsPicks) return false; // picks supplied for a rider that takes none
      const enumerated = enumerateEffect(
        state,
        actor,
        { id: attacker.id, name: attacker.card.name },
        rider.effect,
        rider.index,
        attacker,
      );
      const supplied = effectPicks({
        kind: "effect",
        sourceId: attacker.id,
        card: attacker.card.name,
        effectIndex: rider.index,
        picks: move.riderPicks,
      });
      if (!enumerated.some((m) => effectPicks(m) === supplied)) return false;
    } else if (wantsPicks) {
      // A rider that needs a target must carry one whenever a candidate exists.
      const enumerated = enumerateEffect(
        state,
        actor,
        { id: attacker.id, name: attacker.card.name },
        rider!.effect,
        rider!.index,
        attacker,
      );
      if (enumerated.length > 0) return false;
    }
    return true;
  }

  // Declarative-effect move: re-enumerate the source card's effect and match
  // the human's picks. Self-contained (doesn't depend on legalMoves emitting
  // the effect kind), and re-checks the same gates enumeration relies on.
  if (move.kind === "effect") {
    const effect = effectsFor(move.card)[move.effectIndex];
    if (!effect) return false;
    const side = state.sides[actor];
    let sourceMon: PokemonInPlay | null = null;
    if (effect.trigger.kind === "trainer") {
      // The source must be that named card, in hand, and the supporter gate
      // (once per turn; banned on the game's first turn) must be clear.
      const card = side.hand.find((c) => c.id === move.sourceId && c.name === move.card);
      if (!card) return false;
      if (isSupporter(card) && (side.supporterPlayedThisTurn || state.turn.number === 1)) return false;
    } else {
      sourceMon = [side.active, ...side.bench].find((m) => m?.id === move.sourceId) ?? null;
      if (!sourceMon) return false;
      // Activated abilities are once per turn per Pokémon, and applyEffect can
      // only spend one that names an ability — both gates must hold here too,
      // or a human could replay the ability indefinitely.
      if (effect.trigger.kind === "activated") {
        if (!effect.ability) return false;
        if (sourceMon.abilitiesUsedThisTurn.includes(effect.ability)) return false;
      }
    }
    // expandAuto — this is the HUMAN's move being checked, and humanOptions
    // offered the expanded set. Re-enumerating without it would reject every
    // choice the player was just given.
    const enumerated = enumerateEffect(
      state,
      actor,
      { id: move.sourceId, name: move.card },
      effect,
      move.effectIndex,
      sourceMon,
      true,
    );
    // Player-chosen discard COST (Secret Box). Enumeration auto-picks these,
    // so they are not part of the pick fingerprint — they are validated on
    // their own terms: each id must be a DISTINCT card actually in hand, and
    // there must be exactly as many as the op demands. Without this check a
    // forged move could "discard" cards it doesn't hold, or discard none.
    if (move.discardCardIds !== undefined) {
      // Two shapes pay out of hand: a fixed COST (Secret Box discards 3) and
      // a TRIM to a hand size (Hand Trimmer trims to 5), whose count depends
      // on the current hand rather than the card.
      const trimTo = effectOwnHandTrimTo(move.card, move.effectIndex);
      const need =
        trimTo != null
          ? Math.max(0, side.hand.length - 1 - trimTo) // the played card leaves first
          : effectDiscardCost(move.card, move.effectIndex);
      if (need === 0) return false;
      const ids = new Set(move.discardCardIds);
      if (ids.size !== move.discardCardIds.length) return false;
      if (move.discardCardIds.length !== need) return false;
      // The played card is still in hand at validation time (applyMove removes
      // it), so paying with the card itself must not be allowed.
      // Restricted costs (Lunatone: "a Basic Fighting Energy card") must be
      // paid with a MATCHING card — otherwise the player pays with a spare
      // Trainer and the ability is effectively free.
      const filter = effectDiscardFilter(move.card, move.effectIndex);
      const payable = new Set(
        side.hand
          .filter((c) => c.id !== move.sourceId)
          .filter((c) => !filter || cardMatches(c, filter))
          .map((c) => c.id),
      );
      if (!move.discardCardIds.every((id) => payable.has(id))) return false;
    }

    const want = effectPicks(move);
    return enumerated.some((m) => effectPicks(m) === want);
  }

  // A Stadium's hand selection was checked above on its own terms; strip it
  // before the structural compare, or it would never match an enumerated move.
  if (move.kind === "use_stadium") {
    const core = stadiumCore(move);
    return legal.some((m) => m.kind === "use_stadium" && stadiumCore(m) === core);
  }

  const encoded = JSON.stringify(move);
  return legal.some((m) => JSON.stringify(m) === encoded);
}
