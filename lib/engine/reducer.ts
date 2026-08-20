// The engine reducer.
//
// Takes a ParsedAction and the current GameState, returns the next state
// plus an EngineEvent describing the delta and any diagnostics raised
// while applying the action.
//
// Style: handlers mutate a freshly-cloned working copy. The reducer
// snapshots via structuredClone, so handlers can call helpers like
// `moveCard(from, to, name)` without worrying about reference sharing
// with the caller's state. Performance is fine for replay scale.
//
// Coverage spans every ActionType emitted by lib/battle-log/parse.ts.
// Anything we don't recognize is still surfaced as an EngineEvent with
// kind = action.action_type so the UI can render a fallback row.

import { lookupCard } from "./catalog";
import { makeUnrevealed, mintInstanceId } from "./initial";
import type {
  CardInstance,
  EngineDiagnostic,
  EngineEvent,
  GameState,
  PlayerSide,
  PokemonInPlay,
} from "./types";
import type { Actor, EndReason, ParsedAction, SpecialCondition } from "@/lib/battle-log/types";

/* ─── Utility ───────────────────────────────────────────────────── */

function clone<T>(value: T): T {
  // structuredClone is in the global scope on Node 18+ / modern browsers.
  // Fall back to JSON for very old runtimes; in this project we're on
  // Node 20, so structuredClone is always present.
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : (JSON.parse(JSON.stringify(value)) as T);
}

function sideOf(state: GameState, actor: Actor): PlayerSide | null {
  if (actor === "player") return state.sides.player;
  if (actor === "opponent") return state.sides.opponent;
  return null;
}

function otherActor(actor: Actor): Actor {
  if (actor === "player") return "opponent";
  if (actor === "opponent") return "player";
  return "system";
}

function makeCard(name: string, opts: { revealed?: boolean } = {}): CardInstance {
  return {
    id: mintInstanceId("card"),
    name,
    catalog: null,
    ...(opts.revealed === false ? { unrevealed: true } : {}),
  };
}

function makePokemon(card: CardInstance, turn: number, evolvedFromStack: CardInstance[] = []): PokemonInPlay {
  return {
    id: mintInstanceId("poke"),
    card,
    stack: evolvedFromStack,
    damage: 0,
    attachedEnergy: [],
    attachedTools: [],
    conditions: [],
    abilitiesUsedThisTurn: [],
    enteredPlayOnTurn: turn,
    evolvedThisTurn: false,
  };
}

/** Find an in-play Pokémon by display name on a given side. Active is
 *  searched first, then bench. */
/**
 * Find a Pokémon by name, active checked before bench unless `preferLocation`
 * says otherwise. Several action types the parser produces — attach_energy,
 * evolve — carry the log's own "in the Active Spot" / "on the Bench"
 * qualifier as a `location` field precisely so a same-named Pokémon in the
 * OTHER zone can't be mistaken for the target; before this parameter existed
 * that field was parsed and then silently dropped, so "attached X to Y on
 * the Bench" would still resolve to an active Y with the same name whenever
 * one happened to be there, attaching to (and, via evolve, permanently
 * carrying forward into) the wrong Pokémon instead of leaving it correctly
 * on the bench. Falls back to the other zone if the preferred one has no
 * name match, rather than failing outright — the caller's own name-only
 * fallback would have found it there anyway, and callers with no hint at
 * all (KO, conditions, damage counters — the parser gives them no zone to
 * prefer) keep exactly their previous active-first behavior.
 */
function findPokemon(
  side: PlayerSide,
  name: string,
  preferLocation?: "active" | "bench",
): { mon: PokemonInPlay; where: "active" | "bench"; benchIndex: number } | null {
  const active =
    side.active && side.active.card.name === name
      ? { mon: side.active, where: "active" as const, benchIndex: -1 }
      : null;
  const bench = () => {
    for (let i = 0; i < side.bench.length; i++) {
      if (side.bench[i].card.name === name) {
        return { mon: side.bench[i], where: "bench" as const, benchIndex: i };
      }
    }
    return null;
  };
  if (preferLocation === "bench") return bench() ?? active;
  return active ?? bench();
}

function indexOfCardInZone(zone: CardInstance[], name: string): number {
  return zone.findIndex((c) => c.name === name);
}

/** Pop a named card from a zone. Returns null when not found. */
function popCardByName(zone: CardInstance[], name: string): CardInstance | null {
  const idx = indexOfCardInZone(zone, name);
  if (idx < 0) return null;
  const [card] = zone.splice(idx, 1);
  return card;
}

/**
 * True for a Pokémon Tool, per the catalog.
 *
 * TCG Live logs a Tool's attachment with the same "attached X to Y" wording
 * it uses for energy — "attached Air Balloon to Solrock in the Active Spot",
 * "attached Cynthia's Power Weight to Cynthia's Gabite on the Bench" — so the
 * parser files both under `attach_energy` and the card itself is the only
 * thing that tells them apart.
 */
function isPokemonTool(name: string): boolean {
  return (lookupCard(name)?.subtypes ?? []).includes("Pokémon Tool");
}

/* ─── Reducer ───────────────────────────────────────────────────── */

interface ApplyContext {
  /** Index into the original ParsedAction[]. Used for diagnostics traceability. */
  actionIndex: number;
}

interface ApplyResult {
  state: GameState;
  event: EngineEvent;
  diagnostics: EngineDiagnostic[];
}

export function applyAction(
  prevState: GameState,
  action: ParsedAction,
  ctx: ApplyContext,
): ApplyResult {
  const state = clone(prevState);
  const diagnostics: EngineDiagnostic[] = [];

  const event: EngineEvent = {
    actionIndex: ctx.actionIndex,
    kind: action.action_type,
    actor: action.actor ?? "system",
    summary: action.raw_text,
    detail: {},
  };

  function diag(severity: "info" | "warn" | "error", code: string, message: string, context?: Record<string, unknown>) {
    diagnostics.push({
      severity,
      actionIndex: ctx.actionIndex,
      code,
      message,
      ...(context ? { context } : {}),
    });
  }

  const actor: Actor = action.actor ?? "system";
  const payload = action.payload;

  switch (action.action_type) {
    /* ── Setup ────────────────────────────────────────────────── */

    case "coin_flip":
    case "coin_toss_won":
      // Pure narration; reducer just emits the event.
      event.detail = { choice: payload.choice ?? null };
      break;

    case "chose_first": {
      if (actor === "player" || actor === "opponent") {
        state.firstPlayer = payload.order === "first" ? actor : otherActor(actor);
      }
      event.detail = { firstPlayer: state.firstPlayer };
      break;
    }

    case "opening_hand": {
      const side = sideOf(state, actor);
      if (!side) break;
      const count = Number(payload.count ?? 7);
      const revealed = (payload.revealed_cards as string[] | undefined) ?? [];
      side.hand = [];
      for (let i = 0; i < count; i++) {
        const name = revealed[i];
        side.hand.push(name ? makeCard(name) : makeCard("(unrevealed)", { revealed: false }));
      }
      event.detail = { handSize: side.hand.length };
      break;
    }

    case "mulligan": {
      const side = sideOf(state, actor);
      if (!side) break;
      side.mulligans += 1;
      // Reshuffle: hand → deck (we just clear the hand; the next opening_hand
      // will repopulate). The log emits a fresh opening_hand-like reveal
      // after each mulligan, so we don't need to fake one here.
      side.hand = [];
      event.detail = { mulligans: side.mulligans };
      break;
    }

    case "mulligan_total": {
      const side = sideOf(state, actor);
      if (!side) break;
      side.mulligans = Number(payload.total ?? side.mulligans);
      event.detail = { mulligans: side.mulligans };
      break;
    }

    case "mulligan_bonus_draw": {
      const side = sideOf(state, actor);
      if (!side) break;
      const count = Number(payload.count ?? 0);
      const revealed = (payload.revealed_cards as string[] | undefined) ?? [];
      for (let i = 0; i < count; i++) {
        const name = revealed[i];
        side.hand.push(name ? makeCard(name) : makeCard("(unrevealed)", { revealed: false }));
      }
      event.detail = { drew: count };
      break;
    }

    case "play_to_active":
    case "play_to_bench": {
      const side = sideOf(state, actor);
      if (!side) break;
      const name = String(payload.card ?? "");
      if (!name) break;
      const fromHand = popCardByName(side.hand, name);
      const card = fromHand ?? makeCard(name);
      if (!fromHand) {
        diag("info", "card_not_in_hand", `${actor} played ${name} but it wasn't tracked in hand`, { name });
      }
      const mon = makePokemon(card, state.turn.number);
      if (action.action_type === "play_to_active") {
        if (side.active) {
          diag("warn", "active_already_set", `Active slot already occupied for ${actor}`, { existing: side.active.card.name });
        }
        side.active = mon;
      } else {
        if (side.bench.length >= 5) {
          diag("warn", "bench_full", `Bench at capacity for ${actor}`, { bench_size: side.bench.length });
        }
        side.bench.push(mon);
      }
      event.detail = { card: name, slot: action.action_type === "play_to_active" ? "active" : "bench" };
      break;
    }

    /* ── Turn boundaries ──────────────────────────────────────── */

    case "turn_start": {
      const turnNumber = Number(payload.turn_number ?? state.turn.number + 1);
      const playerTurnNumber = Number(payload.player_turn_number ?? 0);
      state.turn = {
        number: turnNumber,
        playerTurnNumber,
        actor,
        phase: "turn",
      };
      const side = sideOf(state, actor);
      if (side) {
        side.energyAttachedThisTurn = 0;
        side.supporterPlayedThisTurn = false;
        // Clear "evolved this turn" + ability-used flags for the active.
        if (side.active) {
          side.active.evolvedThisTurn = false;
          side.active.abilitiesUsedThisTurn = [];
        }
        for (const b of side.bench) {
          b.evolvedThisTurn = false;
          b.abilitiesUsedThisTurn = [];
        }
      }
      event.detail = { turn: state.turn };
      break;
    }

    case "turn_end": {
      // Per-side per-turn flags reset at start of the NEXT turn; nothing
      // mechanical happens at turn_end itself in this engine.
      event.detail = {};
      break;
    }

    /* ── Card flow ────────────────────────────────────────────── */

    case "draw": {
      const side = sideOf(state, actor);
      if (!side) break;
      const count = Number(payload.count ?? 1);
      const named = payload.card as string | undefined;
      const revealed = (payload.revealed_cards as string[] | undefined) ?? [];
      const drawn: string[] = [];
      if (named && count === 1) {
        side.hand.push(makeCard(named));
        drawn.push(named);
      } else if (revealed.length === count) {
        for (const name of revealed) {
          side.hand.push(makeCard(name));
          drawn.push(name);
        }
      } else {
        // Unknown identities; record placeholders.
        for (let i = 0; i < count; i++) {
          side.hand.push(makeCard("(unrevealed)", { revealed: false }));
        }
      }
      event.detail = { drew: count, cards: drawn };
      break;
    }

    case "discard": {
      const side = sideOf(state, actor);
      if (!side) break;
      const named = payload.card as string | undefined;
      const count = Number(payload.count ?? (named ? 1 : 0));
      const revealed = (payload.revealed_cards as string[] | undefined) ?? (named ? [named] : []);
      const discarded: string[] = [];
      for (let i = 0; i < count; i++) {
        const name = revealed[i];
        if (name) {
          const card = popCardByName(side.hand, name) ?? makeCard(name);
          side.discard.push(card);
          discarded.push(name);
        } else if (side.hand.length > 0) {
          // Identity unknown — pop something from hand (front).
          const card = side.hand.shift()!;
          card.unrevealed = true;
          side.discard.push(card);
          discarded.push(card.name);
        }
      }
      event.detail = { discarded };
      break;
    }

    case "shuffle": {
      const side = sideOf(state, actor);
      if (!side) break;
      const count = Number(payload.cards_shuffled_in ?? 0);
      const revealed = (payload.revealed_cards as string[] | undefined) ?? [];
      if (count > 0) {
        for (let i = 0; i < count; i++) {
          const name = revealed[i];
          const card = name ? popCardByName(side.hand, name) ?? makeCard(name, { revealed: false }) : side.hand.shift();
          if (!card) continue;
          card.unrevealed = true;
          side.deck.unshift(card);
        }
      }
      event.detail = { shuffledIn: count };
      break;
    }

    case "move_to_hand": {
      const ownerHandle = String(payload.owner ?? "");
      const cardName = String(payload.card ?? "");
      const ownerSide =
        ownerHandle === state.sides.player.handle
          ? state.sides.player
          : ownerHandle === state.sides.opponent.handle
            ? state.sides.opponent
            : sideOf(state, actor);
      if (!ownerSide || !cardName) break;
      // Search discard first (most common — Night Stretcher, Energy Retrieval),
      // then deck (Ultra Ball + shuffle), then lost zone (rare).
      const found =
        popCardByName(ownerSide.discard, cardName) ??
        popCardByName(ownerSide.deck, cardName) ??
        popCardByName(ownerSide.lostZone, cardName) ??
        makeCard(cardName);
      ownerSide.hand.push(found);
      event.detail = { card: cardName };
      break;
    }

    case "add_to_hand": {
      const side = sideOf(state, actor);
      if (!side) break;
      const hidden = Boolean(payload.hidden);
      const cardName = payload.card as string | undefined;
      if (hidden || !cardName) {
        side.hand.push(makeUnrevealed("hand"));
      } else {
        side.hand.push(makeCard(cardName));
      }
      event.detail = { card: cardName ?? null, hidden };
      break;
    }

    case "reveal": {
      // Pure information; no state change.
      event.detail = { cards: payload.revealed_cards ?? [] };
      break;
    }

    /* ── Energy attach ────────────────────────────────────────── */

    case "attach_energy": {
      const side = sideOf(state, actor);
      if (!side) break;
      const energyName = String(payload.energy ?? "");
      const targetName = String(payload.target ?? "");
      const viaEffect = Boolean(payload.via_effect);
      const location = payload.location as "active" | "bench" | undefined;
      const found = findPokemon(side, targetName, location);
      if (!found) {
        diag("warn", "attach_target_missing", `Attached ${energyName} to ${targetName} but target not in play`, { targetName });
        break;
      }
      const card = popCardByName(side.hand, energyName) ?? makeCard(energyName);
      // Tools ride in on this same action type (see isPokemonTool), so they
      // have to be split off here — otherwise they pile up in attachedEnergy,
      // where the board renders them as Colorless energy icons and never as
      // the Tool card behind the Pokémon, and the inspector can't tell the
      // two kinds apart.
      const isTool = isPokemonTool(energyName);
      if (isTool) {
        found.mon.attachedTools.push(card);
      } else {
        found.mon.attachedEnergy.push(card);
      }
      // Attaching a Tool is not the turn's one energy attachment. Counting it
      // as one raised a bogus "extra_energy_attach" warning whenever a player
      // attached a Tool and an energy on the same turn — twice in example-3.
      if (!viaEffect && !isTool) {
        side.energyAttachedThisTurn += 1;
        if (side.energyAttachedThisTurn > 1) {
          diag("warn", "extra_energy_attach", `${actor} attached more than one energy this turn from hand`, {
            count: side.energyAttachedThisTurn,
          });
        }
      }
      event.detail = { energy: energyName, target: targetName, viaEffect, tool: isTool };
      break;
    }

    /* ── Evolve ───────────────────────────────────────────────── */

    case "evolve": {
      const side = sideOf(state, actor);
      if (!side) break;
      const fromName = String(payload.from ?? "");
      const toName = String(payload.to ?? "");
      const location = payload.location as "active" | "bench" | undefined;
      const found = findPokemon(side, fromName, location);
      if (!found) {
        diag("warn", "evolve_source_missing", `Evolved ${fromName} → ${toName} but base not in play`, { fromName, toName });
        break;
      }
      if (found.mon.enteredPlayOnTurn === state.turn.number && !found.mon.evolvedThisTurn) {
        diag("info", "evolve_lock_violation", `Evolved ${fromName} on the same turn it was played`, { fromName });
      }
      const newTop = popCardByName(side.hand, toName) ?? makeCard(toName);
      found.mon.stack = [...found.mon.stack, found.mon.card];
      found.mon.card = newTop;
      found.mon.evolvedThisTurn = true;
      found.mon.abilitiesUsedThisTurn = [];
      // Evolved Pokémon shed special conditions per TCG rules.
      found.mon.conditions = [];
      event.detail = { from: fromName, to: toName, location: payload.location ?? null };
      break;
    }

    /* ── Retreat ──────────────────────────────────────────────── */

    case "retreat": {
      const side = sideOf(state, actor);
      if (!side) break;
      if (!side.active) {
        diag("warn", "retreat_no_active", `${actor} retreated but had no active`);
        break;
      }
      const discardedEnergies = (payload.discarded_energies as string[] | undefined) ?? [];
      for (const energyName of discardedEnergies) {
        const idx = indexOfCardInZone(side.active.attachedEnergy, energyName);
        if (idx >= 0) {
          const [card] = side.active.attachedEnergy.splice(idx, 1);
          side.discard.push(card);
        } else {
          // Energy attached as something not matching name, still add a
          // placeholder discard so totals stay consistent.
          side.discard.push(makeCard(energyName));
        }
      }
      side.active.conditions = [];
      // The new active is promoted by a following switch_active event.
      event.detail = { discarded: discardedEnergies };
      break;
    }

    /* ── Switch active ────────────────────────────────────────── */

    case "switch_active": {
      const side = sideOf(state, actor);
      if (!side) break;
      const targetName = String(payload.pokemon ?? "");
      // Promote the named bench Pokémon to the active spot. If the current
      // active is still present (retreat path), swap it onto the bench.
      const benchIdx = side.bench.findIndex((p) => p.card.name === targetName);
      if (benchIdx < 0) {
        // Could already be active (after retreat-then-promote where parser
        // emits an extra confirmation). No-op.
        if (side.active?.card.name === targetName) {
          event.detail = { promoted: targetName, noop: true };
          break;
        }
        // Not tracked on the bench — but the log is authoritative that
        // this Pokémon is now Active, so materialize it rather than
        // leaving the slot empty. Same conjuring play_to_active does for
        // a card that was never tracked into hand, and it matters more
        // here: bench arrivals go untracked whenever the parser doesn't
        // split a bulk line into per-card actions (Buddy-Buddy Poffin's
        // "drew 2 cards and played them to the Bench" is the known case),
        // and dropping the promotion strands the board with no Active for
        // every frame after a knockout.
        diag("info", "switch_target_missing", `Promote ${targetName} but not on bench; conjured it`, { targetName });
        const conjured = makePokemon(makeCard(targetName), state.turn.number);
        if (side.active) side.bench.push(side.active);
        side.active = conjured;
        event.detail = { promoted: targetName, conjured: true };
        break;
      }
      const incoming = side.bench.splice(benchIdx, 1)[0];
      if (side.active) {
        side.bench.push(side.active);
      }
      side.active = incoming;
      side.active.conditions = []; // conditions clear when leaving play; promotion treats it as fresh
      event.detail = { promoted: targetName };
      break;
    }

    /* ── Trainer plays ────────────────────────────────────────── */

    case "play_supporter":
    case "play_item":
    case "play_tool": {
      const side = sideOf(state, actor);
      if (!side) break;
      const cardName = String(payload.card ?? "");
      if (!cardName) break;
      const card = popCardByName(side.hand, cardName) ?? makeCard(cardName);
      // Catalog-aware classification: many "played X" lines from the parser
      // are coded as play_item, but a Supporter should bump the per-turn
      // flag. Look up the catalog row to decide.
      const meta = lookupCard(cardName);
      const subtypes = meta?.subtypes ?? [];
      const isSupporter = subtypes.includes("Supporter");
      const isTool = subtypes.includes("Pokémon Tool");
      if (isSupporter) {
        if (side.supporterPlayedThisTurn) {
          diag("warn", "supporter_double_play", `${actor} played a second Supporter this turn`, { cardName });
        }
        side.supporterPlayedThisTurn = true;
      }
      // Tools normally reach the engine as `attach_energy` instead, because
      // TCG Live writes their attachment as its own "attached X to Y" line
      // (see isPokemonTool) — that path attaches them properly. A Tool
      // arriving HERE came through a bare "played X." with no target in the
      // log, so there is nothing to attach it to and discard is the only
      // honest destination. The diagnostic keeps that visible rather than
      // silently dropping an attachment.
      //
      // This replaces a v0 stub whose two branches were byte-identical, so
      // the `isTool` test read as meaningful when it changed nothing.
      if (isTool) {
        diag("info", "tool_played_without_target", `${actor} played Tool ${cardName} with no attach target in the log`, {
          cardName,
        });
      }
      side.discard.push(card);
      event.detail = { card: cardName, supporter: isSupporter, tool: isTool };
      break;
    }

    case "play_stadium": {
      const side = sideOf(state, actor);
      if (!side) break;
      const cardName = String(payload.card ?? "");
      if (!cardName) break;
      const card = popCardByName(side.hand, cardName) ?? makeCard(cardName);
      const replaced = state.stadium;
      if (replaced) {
        const replacedOwner = replaced.owner === "player" ? state.sides.player : state.sides.opponent;
        replacedOwner.discard.push(replaced.card);
      }
      state.stadium = {
        card,
        owner: actor === "player" || actor === "opponent" ? actor : "player",
      };
      event.detail = { card: cardName, replaced: replaced?.card.name ?? null };
      break;
    }

    /* ── Combat ───────────────────────────────────────────────── */

    case "attack": {
      const attackerSide = sideOf(state, actor);
      const defenderSide = sideOf(state, otherActor(actor));
      const attackerName = String(payload.attacker ?? "");
      const defenderName = String(payload.defender ?? "");
      const damage = Number(payload.damage ?? 0);
      if (attackerSide?.active && attackerSide.active.card.name !== attackerName) {
        diag("info", "attacker_not_active", `Attacker ${attackerName} is not in active slot`, { attackerName });
      }
      if (defenderSide?.active && defenderSide.active.card.name === defenderName) {
        defenderSide.active.damage += damage;
      } else {
        diag("info", "attack_defender_mismatch", `Defender ${defenderName} is not opposing active`, { defenderName });
      }
      // Splash damage to e.g. bench targets.
      const splash = (payload.splash_damage as Array<{ handle: string; pokemon: string; damage: number }> | undefined) ?? [];
      for (const s of splash) {
        const ownerSide =
          s.handle === state.sides.player.handle
            ? state.sides.player
            : s.handle === state.sides.opponent.handle
              ? state.sides.opponent
              : null;
        if (!ownerSide) continue;
        const target = findPokemon(ownerSide, s.pokemon);
        if (target) target.mon.damage += s.damage;
      }
      event.detail = {
        attacker: attackerName,
        attack: payload.attack_name ?? null,
        defender: defenderName,
        damage,
        weakness_bonus: payload.weakness_bonus ?? null,
        choices: payload.choices ?? [],
        splash,
      };
      break;
    }

    case "ability_used": {
      const side = sideOf(state, actor);
      const source = String(payload.source ?? "");
      const abilityName = String(payload.ability_name ?? "");
      if (side) {
        const found = findPokemon(side, source);
        if (found) found.mon.abilitiesUsedThisTurn.push(abilityName);
      }
      event.detail = { source, ability: abilityName };
      break;
    }

    case "damage_dealt": {
      // Not currently emitted as a top-level action by the parser; included
      // for forward compatibility.
      event.detail = { ...payload };
      break;
    }

    case "discard_from_pokemon": {
      const ownerHandle = String(payload.owner ?? "");
      const pokemonName = String(payload.pokemon ?? "");
      const cardName = String(payload.card ?? "");
      const ownerSide =
        ownerHandle === state.sides.player.handle
          ? state.sides.player
          : ownerHandle === state.sides.opponent.handle
            ? state.sides.opponent
            : sideOf(state, actor);
      if (!ownerSide || !cardName) break;
      const target = findPokemon(ownerSide, pokemonName);
      if (!target) {
        // The pokemon may have just been knocked out and removed; pop a
        // placeholder discard so totals balance.
        ownerSide.discard.push(makeCard(cardName));
        event.detail = { card: cardName, from: pokemonName, fallback: true };
        break;
      }
      const energyIdx = indexOfCardInZone(target.mon.attachedEnergy, cardName);
      if (energyIdx >= 0) {
        const [c] = target.mon.attachedEnergy.splice(energyIdx, 1);
        ownerSide.discard.push(c);
      } else {
        const toolIdx = indexOfCardInZone(target.mon.attachedTools, cardName);
        if (toolIdx >= 0) {
          const [c] = target.mon.attachedTools.splice(toolIdx, 1);
          ownerSide.discard.push(c);
        } else {
          ownerSide.discard.push(makeCard(cardName));
        }
      }
      event.detail = { card: cardName, from: pokemonName };
      break;
    }

    case "effect_activated": {
      event.detail = { card: payload.card ?? null };
      break;
    }

    case "knock_out": {
      // Owner is the side losing the Pokémon. Move card + stack + energies
      // + tools to that side's discard pile, clear the slot.
      const ownerSide = sideOf(state, actor);
      if (!ownerSide) break;
      const targetName = String(payload.pokemon ?? "");
      const found = findPokemon(ownerSide, targetName);
      if (!found) {
        diag("info", "ko_target_missing", `Knocked Out target ${targetName} not in play`, { targetName });
        break;
      }
      const mon = found.mon;
      ownerSide.discard.push(mon.card, ...mon.stack, ...mon.attachedEnergy, ...mon.attachedTools);
      if (found.where === "active") {
        ownerSide.active = null;
      } else {
        ownerSide.bench.splice(found.benchIndex, 1);
      }
      event.detail = { pokemon: targetName, where: found.where };
      break;
    }

    case "prize_taken": {
      const side = sideOf(state, actor);
      if (!side) break;
      const count = Number(payload.count ?? 1);
      const taken = side.prizes.splice(0, count);
      if (actor === "player") state.prizesTaken.player += taken.length;
      else if (actor === "opponent") state.prizesTaken.opponent += taken.length;
      event.detail = { count: taken.length };
      // Winning by prizes is reported separately via game_end.
      break;
    }

    /* ── Conditions ───────────────────────────────────────────── */

    case "condition_applied": {
      const ownerSide = sideOf(state, actor);
      if (!ownerSide) break;
      const targetName = String(payload.pokemon ?? "");
      const condition = payload.condition as SpecialCondition;
      const found = findPokemon(ownerSide, targetName);
      if (!found) {
        diag("info", "condition_target_missing", `Condition target ${targetName} not in play`, { targetName });
        break;
      }
      if (!found.mon.conditions.includes(condition)) {
        found.mon.conditions.push(condition);
      }
      event.detail = { pokemon: targetName, condition };
      break;
    }

    case "damage_counter_placed": {
      const ownerSide = sideOf(state, actor);
      if (!ownerSide) break;
      const targetName = String(payload.pokemon ?? "");
      const counters = Number(payload.counters ?? 0);
      const found = findPokemon(ownerSide, targetName);
      if (!found) {
        diag("info", "counter_target_missing", `Counter target ${targetName} not in play`, { targetName });
        break;
      }
      found.mon.damage += counters * 10;
      event.detail = { pokemon: targetName, counters, damageAfter: found.mon.damage };
      break;
    }

    /* ── End ──────────────────────────────────────────────────── */

    case "game_end": {
      const reason = String(payload.reason ?? "prizes") as EndReason;
      state.endReason = reason;
      const winnerHandle = String(payload.winner ?? "");
      if (winnerHandle === state.sides.player.handle) state.winner = "player";
      else if (winnerHandle === state.sides.opponent.handle) state.winner = "opponent";
      state.turn.phase = "end";
      event.detail = { winner: state.winner, reason };
      break;
    }

    case "unknown":
    default:
      event.detail = { raw: action.raw_text };
      break;
  }

  return { state, event, diagnostics };
}
