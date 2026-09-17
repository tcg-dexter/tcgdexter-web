// Real battle logs → one reconstructed decision at a time.
//
// This machinery was built inside scripts/ml/move_agreement.ts and is
// extracted here because a SECOND consumer now needs it: the coach values
// every legal move at a human decision, where the agreement instrument only
// asks whether a policy picks the same one. Those two must reconstruct the
// board identically or they will disagree about the game rather than about
// the judgement — the same argument that pulled `replayViewAt` out of
// `replayTurnViews`.
//
// Four silent bugs were found the first time this was written, and the shapes
// that caused them are preserved here deliberately:
//
//   * `parseBattleLog` takes ONE argument — the perspective is applied by
//     `normalizePerspective`, and passing a `{playerHandle}` option to the
//     parser is silently ignored, which found ZERO player decisions and
//     reported a clean run.
//   * Per-action `actor` is null in production logs; attribution lives on the
//     TURN via `action_indices`.
//   * `ability_used` carries `source`/`ability_name`, not `pokemon`/`ability`.
//   * The reconstructed deck is EMPTY unless stocked, which silently deletes
//     every deck-gated move (Trade alone was 198 of 321 misses) and flattens
//     any board-aware evaluator to a constant.

import { parseBattleLog } from "@/lib/battle-log";
import { normalizePerspective } from "@/lib/battle-log/normalize";
import type { ParsedAction } from "@/lib/battle-log/types";
import { replay } from "@/lib/engine/replay";
import { isTrainerSubtype } from "@/lib/engine/catalog";
import { legalMoves, type PlayerView, type SimMove, type TurnContext } from "@/lib/engine/sim";
import type { GameState } from "@/lib/engine/types";
import { hydrateState, replayViewAt, stockReplayDeck } from "@/lib/ml/features/replayView";

/** Action types that represent a CHOICE the player made. Draws, prize takes
 *  and knockouts are consequences, not decisions, and including them would
 *  inflate any per-decision statistic with events no policy chooses. */
export const DECISION_ACTIONS = new Set([
  "attach_energy",
  "play_supporter",
  "play_item",
  "play_tool",
  "play_stadium",
  "evolve",
  "retreat",
  "attack",
  "ability_used",
  "play_to_bench",
]);

/** The card a move plays, resolved through the acting side's zones. Moves
 *  address cards by id; the log names them, so this is the bridge. */
export function moveCardName(state: GameState, move: SimMove): string | null {
  const side = state.sides.player;
  const byId = (id: string): string | null => {
    const hand = side.hand.find((c) => c.id === id);
    if (hand) return hand.name;
    const mons = [side.active, ...side.bench].filter((m) => m != null);
    for (const m of mons!) {
      if (m!.id === id) return m!.card.name;
      const st = m!.stack.find((c) => c.id === id);
      if (st) return st.name;
      const tool = m!.attachedTools.find((c) => c.id === id);
      if (tool) return tool.name;
    }
    return null;
  };
  switch (move.kind) {
    case "attach":
    case "bench":
    case "evolve":
    case "cycle_supporter":
    case "cycle_item":
    case "play_stadium":
    case "attach_tool":
      return byId(move.cardId);
    case "effect":
      return move.card;
    case "play_trainer":
      return byId((move as { cardId: string }).cardId);
    case "use_ability":
      // Abilities are named by their OWNER on the board, and the log names
      // the Pokémon that used it — so resolve the mon, not a hand card.
      return byId(move.monId);
    default:
      return null;
  }
}

/** The in-play Pokémon a move targets, by name. */
export function moveTargetName(state: GameState, move: SimMove): string | null {
  const side = state.sides.player;
  const id =
    move.kind === "attach" || move.kind === "evolve" || move.kind === "attach_tool"
      ? move.targetId
      : null;
  if (!id) return null;
  const mons = [side.active, ...side.bench].filter((m) => m != null);
  return mons!.find((m) => m!.id === id)?.card.name ?? null;
}

/** Does `move` correspond to what the human actually did?
 *
 *  Matching is by NAME rather than id — the replay reducer and the simulator
 *  mint different ids for the same card — and deliberately permissive about
 *  which move KIND carries a trainer, because a card can be enumerated as
 *  `effect` (declarative registry) or `play_trainer`/`cycle_item` (legacy
 *  registry) depending on which table holds it. Requiring the exact kind
 *  would score a correct choice as a miss for half the format. */
export function matches(state: GameState, move: SimMove, action: ParsedAction): boolean {
  const p = action.payload as Record<string, unknown>;
  const name = moveCardName(state, move);
  const eq = (a: unknown, b: string | null) =>
    typeof a === "string" && b != null && a.toLowerCase() === b.toLowerCase();

  switch (action.action_type) {
    case "attach_energy": {
      // The log files Tool attachments under attach_energy too (Binding
      // Mochi), and the engine models those as a different move kind.
      const asTool = isTrainerSubtype(String(p.energy ?? ""), "Pokémon Tool");
      if (asTool) {
        return move.kind === "attach_tool" && eq(p.energy, name);
      }
      if (move.kind !== "attach") return false;
      if (!eq(p.energy, name)) return false;
      // Target is checked only when the log named one AND the engine resolved
      // one; a mismatch there is a real disagreement about WHERE to attach.
      return p.target == null || eq(p.target, moveTargetName(state, move));
    }
    case "play_supporter":
    case "play_item":
      return (
        (move.kind === "effect" ||
          move.kind === "play_trainer" ||
          move.kind === "cycle_item" ||
          move.kind === "cycle_supporter") &&
        eq(p.card, name)
      );
    case "play_tool":
      return move.kind === "attach_tool" && eq(p.card, name);
    case "play_stadium":
      return move.kind === "play_stadium" && eq(p.card, name);
    case "evolve":
      return move.kind === "evolve" && eq(p.to, name);
    case "play_to_bench":
      return move.kind === "bench" && eq(p.card ?? p.pokemon, name);
    case "retreat":
      return move.kind === "retreat";
    case "attack": {
      if (move.kind !== "attack") return false;
      const attacker = state.sides.player.active;
      const atk = attacker?.card.catalog?.attacks?.[move.attackIndex];
      return atk != null && eq(p.attack_name, atk.name);
    }
    case "ability_used":
      // Payload keys are `source` (the Pokémon that used it) and
      // `ability_name` — NOT `pokemon`/`ability`.
      return (
        (move.kind === "use_ability" || move.kind === "effect") &&
        (p.source == null ||
          eq(p.source, name) ||
          (move.kind === "use_ability" && eq(p.ability_name, move.abilityName)))
      );
    default:
      return false;
  }
}

/** The card name the human's action needed, for diagnosing a miss. */
export function actionCardName(action: ParsedAction): string | null {
  const p = action.payload as Record<string, unknown>;
  const v = p.card ?? p.energy ?? p.to ?? p.source ?? p.attacker ?? p.pokemon;
  return typeof v === "string" ? v : null;
}

/** WHY did the engine not offer the human's move? The distinction decides
 *  what the number means:
 *
 *    absent_from_zone  the card is not in the reconstructed hand/board at
 *                      all. That is a REPLAY RECONSTRUCTION limit — the
 *                      reducer learns cards as they surface and does not
 *                      track everything a search puts in hand — not a
 *                      statement about engine card support.
 *    no_legal_move     the card IS there and the engine still offered
 *                      nothing matching. THAT is an engine fidelity gap.
 *
 *  Reporting them together would let reconstruction noise masquerade as
 *  missing card support, and would move whenever the reducer changed. */
export function missReason(state: GameState, action: ParsedAction): string {
  const name = actionCardName(action);
  if (!name) return "no_name_in_payload";
  const side = state.sides.player;
  const inHand = side.hand.some((c) => c.name.toLowerCase() === name.toLowerCase());
  const mons = [side.active, ...side.bench].filter((m) => m != null);
  const inPlay = mons!.some(
    (m) =>
      m!.card.name.toLowerCase() === name.toLowerCase() ||
      m!.stack.some((c) => c.name.toLowerCase() === name.toLowerCase()),
  );
  return inHand || inPlay ? "no_legal_move" : "absent_from_zone";
}

/** Was this benched Pokémon put there by an earlier search THIS TURN, rather
 *  than played from hand by choice? Detected by looking back for a card whose
 *  own payload already named it as revealed/fetched.
 *
 *  Buddy-Buddy Poffin's "put them onto your Bench" is written as its own
 *  play_to_bench line, but the engine resolves it inside the Poffin effect
 *  and never offers a separate bench move. That is a GRANULARITY mismatch
 *  between log and engine, not a missing capability. */
export function causedBySearch(
  actions: ParsedAction[],
  index: number,
  turnStartIdx: number,
): boolean {
  const name = String((actions[index].payload as Record<string, unknown>).card ?? "");
  if (!name) return false;
  for (let j = index - 1; j >= turnStartIdx; j--) {
    const prev = actions[j];
    if (prev.action_type === "play_to_bench") continue; // sibling of the same search
    const p = prev.payload as Record<string, unknown>;
    const revealed = [
      ...((p.revealed_cards as string[] | undefined) ?? []),
      ...((p.drawn_cards as string[] | undefined) ?? []),
    ];
    if (revealed.some((c) => c.toLowerCase() === name.toLowerCase())) return true;
    // Only look back through the immediately preceding effect block.
    if (prev.action_type === "play_item" || prev.action_type === "ability_used") return false;
  }
  return false;
}

export interface LogRow {
  id: string;
  battle_log_raw: string;
  player_handle: string;
  deck_list: string | null;
}

export interface LogDecision {
  logId: string;
  actionIndex: number;
  turnIndex: number | null;
  /** 1-indexed turn number within the log, for display. */
  turnNumber: number | null;
  action: ParsedAction;
  /** Reconstructed pre-move state, hydrated with the deck stocked. The
   *  acting player is always `sides.player` (normalizePerspective). */
  state: GameState;
  ctx: TurnContext;
  legal: SimMove[];
  /** Index into `legal` of the move the human actually made. */
  humanIndex: number;
  /** Repaired view for policies and evaluators. */
  view: PlayerView;
}

export interface ScanStats {
  logsUsed: number;
  logsFailed: number;
  decisions: number;
  matched: number;
  trivial: number;
  /** Handed to the callback. */
  yielded: number;
  missBy: Map<string, number>;
  unmatchedBy: Map<string, number>;
  /** `<card name>:<reason>` for every decision that could not be
   *  reconstructed. `unmatchedBy` groups by action TYPE, which says how the
   *  coverage loss is shaped but not what to fix — "play_trainer:
   *  absent_from_zone x40" is a histogram, "Buddy-Buddy Poffin x12" is a
   *  work queue. */
  unmatchedCards: Map<string, number>;
}

export function emptyScanStats(): ScanStats {
  return {
    logsUsed: 0,
    logsFailed: 0,
    decisions: 0,
    matched: 0,
    trivial: 0,
    yielded: 0,
    missBy: new Map(),
    unmatchedBy: new Map(),
    unmatchedCards: new Map(),
  };
}

/**
 * Walk one battle log and hand back every reconstructable human decision that
 * had at least two legal moves.
 *
 * Coverage is accumulated in `stats` rather than folded into the result,
 * because a human move the engine cannot enumerate is an ENGINE FIDELITY gap,
 * not a disagreement — reporting them together lets missing card support
 * masquerade as bad judgement.
 */
export function scanLog(
  row: LogRow,
  stats: ScanStats,
  onDecision: (decision: LogDecision) => void,
): void {
  let parsed;
  let r;
  try {
    parsed = normalizePerspective(parseBattleLog(row.battle_log_raw), row.player_handle);
    r = replay(parsed);
  } catch {
    stats.logsFailed += 1;
    return;
  }
  if (r.states.length !== parsed.actions.length) {
    stats.logsFailed += 1;
    return;
  }
  stats.logsUsed += 1;

  // Actor attribution lives on the TURN, not the action — every action's own
  // `actor` is null in these logs.
  const owner = new Map<number, string>();
  const ownerTurn = new Map<number, number>();
  const turnStart = new Map<number, number>();
  parsed.turns.forEach((turn, ti) => {
    const first = turn.action_indices[0] ?? 0;
    for (const i of turn.action_indices) {
      owner.set(i, `${turn.actor}:${turn.phase}`);
      ownerTurn.set(i, ti);
      turnStart.set(i, first);
    }
  });

  for (let i = 0; i < parsed.actions.length; i++) {
    const action = parsed.actions[i];
    if (!DECISION_ACTIONS.has(action.action_type)) continue;
    if (owner.get(i) !== "player:turn") continue;
    // An attach the log marks `via_effect` was CAUSED by a card the player
    // played (Crispin, Telepathic Psychic Energy) — it is a consequence, not
    // a choice, and no policy is ever asked to make it.
    if ((action.payload as Record<string, unknown>).via_effect) continue;
    if (
      action.action_type === "play_to_bench" &&
      causedBySearch(parsed.actions, i, turnStart.get(i) ?? 0)
    ) {
      continue;
    }

    const before = i === 0 ? r.initialState : r.states[i - 1];
    hydrateState(before);
    stockReplayDeck(before, "player", row.deck_list);

    // Per-turn one-shot flags, recovered by stepping: what has ALREADY
    // happened this turn before the decision under test. legalMoves gates
    // retreat and stadium on these, so a wrong flag would offer moves the
    // human could not have made.
    const turnIdx = ownerTurn.get(i) ?? null;
    const ctx: TurnContext = { retreated: false, stadiumUsed: false };
    if (turnIdx != null) {
      for (const j of parsed.turns[turnIdx].action_indices) {
        if (j >= i) break;
        const at = parsed.actions[j].action_type;
        if (at === "retreat") ctx.retreated = true;
        if (at === "play_stadium") ctx.stadiumUsed = true;
      }
    }

    let legal: SimMove[];
    try {
      legal = legalMoves(before, "player", ctx);
    } catch {
      continue;
    }
    stats.decisions += 1;

    const humanIndex = legal.findIndex((m) => matches(before, m, action));
    if (humanIndex < 0) {
      const why = missReason(before, action);
      const key = `${action.action_type}:${why}`;
      stats.unmatchedBy.set(key, (stats.unmatchedBy.get(key) ?? 0) + 1);
      stats.missBy.set(why, (stats.missBy.get(why) ?? 0) + 1);
      const cardKey = `${actionCardName(action) ?? "(unnamed)"}:${why}`;
      stats.unmatchedCards.set(cardKey, (stats.unmatchedCards.get(cardKey) ?? 0) + 1);
      continue;
    }
    stats.matched += 1;
    // One legal move is not a decision.
    if (legal.length < 2) {
      stats.trivial += 1;
      continue;
    }

    const view = replayViewAt(before, "player", row.deck_list, {
      retreated: ctx.retreated,
      stadiumPlayed: ctx.stadiumUsed,
    });
    stats.yielded += 1;
    onDecision({
      logId: row.id,
      actionIndex: i,
      turnIndex: turnIdx,
      turnNumber: turnIdx != null ? turnIdx + 1 : null,
      action,
      state: before,
      ctx,
      legal,
      humanIndex,
      view,
    });
  }
}
