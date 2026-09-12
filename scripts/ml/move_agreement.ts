// Does the pilot choose what a real player chose?
//
// WHY THIS EXISTS
//
// Every gate we have is a win-rate duel on the 12-deck frozen benchmark, and
// that instrument has a resolution floor. Measured 2026-09-08 at n~2300 per
// comparison: it separates a 4.5-point effect (planner+model vs the planner's
// built-in evaluator, 54.52% CI [52.5,56.5]) and CANNOT separate anything
// under ~2 points. Six consecutive interventions — more games, more deck
// diversity, denser route labels, richer card-detail features, deeper search —
// all landed inside that floor and reported nothing.
//
// The floor is structural, not fixable by running more games: a duel yields
// ONE bit per GAME, and a game is ~100 decisions. Real battle logs invert
// that. 271 imported logs hold tens of thousands of DECISIONS, each with a
// recorded human choice, so the effective sample size is two orders of
// magnitude larger for the same wall-clock cost.
//
// WHAT IT MEASURES, AND WHAT IT DOES NOT
//
// Agreement with a human is NOT optimality. These logs come from TCG Live
// players of unknown and varying skill, and a pilot that agreed 100% would
// merely have cloned an average ladder player. Read it as a HIGH-RESOLUTION
// SIMILARITY signal, useful for detecting that a change moved play at all —
// which the duel cannot do — and never as a quality score on its own.
//
// COVERAGE IS REPORTED SEPARATELY, AND THAT IS THE POINT
//
// A human move the engine cannot enumerate is an ENGINE FIDELITY gap, not a
// disagreement. Folding the two together would let missing card support
// masquerade as bad judgement — and quietly reward a change that made the
// engine worse at representing the game. So every decision is classified:
//
//   matched    the engine offered a legal move corresponding to the human's
//   unmatched  it did not — fidelity gap, excluded from the agreement rate
//   trivial    only one legal move existed — excluded, it measures nothing
//
// Agreement is computed over MATCHED, NON-TRIVIAL decisions only, and the
// coverage rate is printed alongside so a change in one cannot hide in the
// other.
//
// Usage:
//   npx tsx scripts/ml/move_agreement.ts [--limit N] [--artifact PATH]
//     [--skill 1] [--db PATH] [--verbose]

import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { parseBattleLog } from "@/lib/battle-log";
import { normalizePerspective } from "@/lib/battle-log/normalize";
import type { ParsedAction } from "@/lib/battle-log/types";
import { replay } from "@/lib/engine/replay";
import { hydrateState, replayViewAt, stockReplayDeck } from "@/lib/ml/features/replayView";
import { legalMoves, viewFor } from "@/lib/engine/sim";
import { isTrainerSubtype } from "@/lib/engine/catalog";
import type { SimMove } from "@/lib/engine/sim/moves";
import type { GameState } from "@/lib/engine/types";
import { HeuristicPolicy, type DecisionPolicy } from "@/lib/engine/sim/policy";
import { PlannerPolicy } from "@/lib/engine/sim/planner";
import { RoutePlannerPolicy } from "@/lib/engine/sim/routePlanner";
import { plannerParamsForSkill } from "@/lib/engine/sim/difficulty";
import { createBoardEvaluator } from "@/lib/ml/botEvaluator";
import { numOrNull } from "@/lib/ml/features";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

const DB =
  arg("--db") ?? path.resolve(REPO_ROOT, "..", "dexter-ml", "feature_store.sqlite");
const LIMIT = numOrNull(arg("--limit")) ?? 271;
const ARTIFACT = arg("--artifact");
const SKILL = numOrNull(arg("--skill")) ?? 1;
const VERBOSE = process.argv.includes("--verbose");
// Second policy for a PAIRED comparison. This is the mode that makes the
// instrument worth building: both policies are asked the SAME decisions, so
// the comparison is paired and only DISCORDANT decisions (one agrees, the
// other does not) carry information. An unpaired win-rate duel throws that
// structure away, which is why it needs thousands of games to resolve two
// points; McNemar's test on the discordant pairs resolves far less.
const ARTIFACT_B = arg("--vs");
// Which PLANNER each side uses: "template" (the four-slot enumeration) or
// "route" (the sequence beam search). Comparing SEARCH here rather than only
// in the duel matters: agreement can say whether two pilots play DIFFERENTLY
// at all, which a win rate cannot — two policies can tie at 50% either
// because they play alike or because they differ and are equally good.
const PLANNER_A = arg("--planner-a") ?? "template";
const PLANNER_B = arg("--planner-b") ?? "template";
const BEAM = numOrNull(arg("--beam")) ?? 6;

/** Log actions that represent a CHOICE the player made. Draws, knockouts and
 *  prize takes are consequences, not decisions, and including them would
 *  inflate agreement with events no policy chooses. */
const DECISION_ACTIONS = new Set([
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
function moveCardName(state: GameState, move: SimMove): string | null {
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
function moveTargetName(state: GameState, move: SimMove): string | null {
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
function matches(state: GameState, move: SimMove, action: ParsedAction): boolean {
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
function actionCardName(action: ParsedAction): string | null {
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
function missReason(state: GameState, action: ParsedAction): string {
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
 *  own payload already named it as revealed/fetched. */
function causedBySearch(actions: ParsedAction[], index: number, turnStartIdx: number): boolean {
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

function makePolicy(
  spec: string | null,
  planner = "template",
): { label: string; policy: () => DecisionPolicy } {
  const ARTIFACT = spec;
  if (ARTIFACT === "heuristic") {
    return { label: "HeuristicPolicy", policy: () => new HeuristicPolicy() };
  }
  const params = plannerParamsForSkill(SKILL);
  const kind = planner === "route" ? ` [route beam=${BEAM}]` : "";
  const build = (evaluate?: ReturnType<typeof createBoardEvaluator>) =>
    planner === "route"
      ? new RoutePlannerPolicy({
          params,
          seed: 1,
          beam: BEAM,
          ...(evaluate ? { evaluate } : {}),
        })
      : new PlannerPolicy({ params, seed: 1, ...(evaluate ? { evaluate } : {}) });
  // "none" = the planner's built-in evaluator, matching value_duel.ts's
  // convention. It isolates the MODEL's contribution from the SEARCH's.
  if (!ARTIFACT || ARTIFACT === "none") {
    return {
      label: `planner (built-in evaluator)${kind}`,
      policy: () => build(),
    };
  }
  const evaluate = createBoardEvaluator(ARTIFACT);
  if (!evaluate) throw new Error(`[move_agreement] no usable artifact at ${ARTIFACT}`);
  return {
    label: `planner + ${path.basename(ARTIFACT)}${kind}`,
    policy: () => build(evaluate),
  };
}

interface Tally {
  decisions: number;
  matched: number;
  trivial: number;
  agreed: number;
  scored: number;
  optionsSum: number;
  randomBaseline: number;
}

function main(): void {
  const db = new DatabaseSync(DB, { readOnly: true });
  const rows = db
    .prepare(
      // The deck list is not optional. replayViewAt needs it to synthesize
      // unseenOwn; without it a board-aware evaluator scores every position
      // with deckCount 0 and no unseen cards, its output flattens, and every
      // policy picks the same move from the planner's tactical terms alone.
      `SELECT m.id, m.battle_log_raw, m.player_handle, d.deck_list
         FROM matches m
         LEFT JOIN saved_decks d ON d.id = m.saved_deck_id
        WHERE m.battle_log_raw IS NOT NULL AND m.player_handle IS NOT NULL
        ORDER BY m.id LIMIT ?`,
    )
    .all(LIMIT) as {
    id: string;
    battle_log_raw: string;
    player_handle: string;
    deck_list: string | null;
  }[];
  db.close();

  const a = makePolicy(ARTIFACT, PLANNER_A);
  const b = ARTIFACT_B ? makePolicy(ARTIFACT_B, PLANNER_B) : null;
  console.log(`[move_agreement] ${rows.length} battle logs`);
  console.log(`  A: ${a.label}`);
  if (b) console.log(`  B: ${b.label}`);
  console.log("");
  const { label, policy } = a;

  const t: Tally = {
    decisions: 0,
    matched: 0,
    trivial: 0,
    agreed: 0,
    scored: 0,
    optionsSum: 0,
    randomBaseline: 0,
  };
  const unmatchedBy = new Map<string, number>();
  const missBy = new Map<string, number>();
  const agreedBy = new Map<string, [number, number]>();
  let logsUsed = 0;
  let logsFailed = 0;
  // McNemar 2x2 on the discordant cells only.
  let bothAgree = 0;
  let onlyA = 0;
  let onlyB = 0;
  let neither = 0;

  for (const row of rows) {
    let parsed;
    let r;
    try {
      parsed = normalizePerspective(parseBattleLog(row.battle_log_raw), row.player_handle);
      r = replay(parsed);
    } catch {
      logsFailed += 1;
      continue;
    }
    if (r.states.length !== parsed.actions.length) {
      logsFailed += 1;
      continue;
    }
    logsUsed += 1;

    // Actor attribution lives on the TURN, not the action — every action's
    // own `actor` is null in these logs.
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
      // played (Crispin, Telepathic Psychic Energy) — it is a consequence,
      // not a choice, and no policy is ever asked to make it. Scoring it
      // would measure the engine's effect resolution as if it were judgement.
      if ((action.payload as Record<string, unknown>).via_effect) continue;
      // A card the log puts on the bench as the CONSEQUENCE of a search
      // (Buddy-Buddy Poffin "put them onto your Bench") is written as its own
      // play_to_bench line, but the engine resolves it inside the Poffin
      // effect and never offers a separate bench move. That is a GRANULARITY
      // mismatch between log and engine, not a missing capability — counting
      // it as a fidelity gap understates coverage and blames the engine for
      // representing the card correctly.
      if (action.action_type === "play_to_bench" && causedBySearch(parsed.actions, i, turnStart.get(i) ?? 0)) {
        continue;
      }

      const before = i === 0 ? r.initialState : r.states[i - 1];
      hydrateState(before);
      // Without this the deck is empty and every deck-gated move vanishes —
      // Trade alone accounted for 198 of 321 "engine offered nothing" misses.
      stockReplayDeck(before, "player", row.deck_list);
      // Per-turn one-shot flags, recovered by stepping: what has ALREADY
      // happened in this turn before the decision under test. legalMoves
      // gates retreat and stadium on these, so a wrong flag would offer
      // moves the human could not have made.
      const turnIdx = ownerTurn.get(i);
      const ctx = { retreated: false, stadiumUsed: false } as Record<string, boolean>;
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
        legal = legalMoves(before, "player", ctx as never);
      } catch {
        continue;
      }
      t.decisions += 1;

      const humanIdx = legal.findIndex((m) => matches(before, m, action));
      if (humanIdx < 0) {
        const why = missReason(before, action);
        unmatchedBy.set(
          `${action.action_type}:${why}`,
          (unmatchedBy.get(`${action.action_type}:${why}`) ?? 0) + 1,
        );
        missBy.set(why, (missBy.get(why) ?? 0) + 1);
        if (VERBOSE && t.decisions < 40) {
          const p = action.payload as Record<string, unknown>;
          console.log(
            `  unmatched ${action.action_type} ${JSON.stringify(p).slice(0, 70)} ` +
              `(legal: ${legal.map((m) => m.kind).join(",")})`,
          );
        }
        continue;
      }
      t.matched += 1;
      // One legal move is not a decision; scoring it would inflate agreement
      // with positions that had no alternative.
      if (legal.length < 2) {
        t.trivial += 1;
        continue;
      }

      const repaired = replayViewAt(before, "player", row.deck_list, {
        retreated: ctx.retreated,
        stadiumPlayed: ctx.stadiumUsed,
      });
      let chosen: SimMove;
      try {
        chosen = policy().chooseMove(repaired, legal, ctx as never);
      } catch {
        continue;
      }
      t.scored += 1;
      t.optionsSum += legal.length;
      t.randomBaseline += 1 / legal.length;
      const hit = matches(before, chosen, action);
      if (hit) t.agreed += 1;
      if (b) {
        let hitB = false;
        try {
          const chosenB = b.policy().chooseMove(repaired, legal, ctx as never);
          hitB = matches(before, chosenB, action);
        } catch {
          // Fall through as a non-agreement rather than dropping the pair:
          // dropping only A-failures or only B-failures would bias McNemar.
        }
        if (hit && hitB) bothAgree += 1;
        else if (hit) onlyA += 1;
        else if (hitB) onlyB += 1;
        else neither += 1;
      }
      const cell = agreedBy.get(action.action_type) ?? [0, 0];
      cell[0] += hit ? 1 : 0;
      cell[1] += 1;
      agreedBy.set(action.action_type, cell);
    }
  }

  const pct = (a: number, b: number) => `${((100 * a) / (b || 1)).toFixed(1)}%`;
  console.log(`  logs replayed        : ${logsUsed} (${logsFailed} unusable)`);
  console.log(`  player decisions     : ${t.decisions.toLocaleString()}`);
  console.log(
    `  COVERAGE (engine could represent the human's move): ` +
      `${t.matched.toLocaleString()} / ${t.decisions.toLocaleString()} = ${pct(t.matched, t.decisions)}`,
  );
  console.log(`  trivial (1 legal move, excluded)         : ${t.trivial.toLocaleString()}`);
  console.log(`  scored (matched, >=2 options)            : ${t.scored.toLocaleString()}`);
  console.log(
    `  mean options per scored decision         : ${(t.optionsSum / (t.scored || 1)).toFixed(1)}`,
  );
  console.log(
    `\n  AGREEMENT : ${t.agreed.toLocaleString()} / ${t.scored.toLocaleString()} = ` +
      `${pct(t.agreed, t.scored)}`,
  );
  console.log(
    `  random baseline (1/n per decision)       : ${pct(t.randomBaseline, t.scored)}`,
  );
  // Binomial SE on the agreement rate — the whole reason for this instrument
  // is that this number is small where the duel's was not.
  const p = t.agreed / (t.scored || 1);
  const se = Math.sqrt((p * (1 - p)) / (t.scored || 1));
  console.log(
    `  95% CI                                   : ` +
      `[${(100 * (p - 1.96 * se)).toFixed(1)}, ${(100 * (p + 1.96 * se)).toFixed(1)}]  ` +
      `(±${(196 * se).toFixed(2)} pts)`,
  );

  if (b) {
    const disc = onlyA + onlyB;
    // McNemar with a normal approximation on the discordant pairs. Only
    // disagreements carry information: decisions both policies get right (or
    // both get wrong) tell us nothing about which is better, and including
    // them is exactly the dilution an unpaired duel suffers.
    const z = disc > 0 ? (onlyA - onlyB) / Math.sqrt(disc) : 0;
    const pRate = (x: number) => `${((100 * x) / (t.scored || 1)).toFixed(1)}%`;
    console.log(`\n  PAIRED COMPARISON (same ${t.scored.toLocaleString()} decisions)`);
    console.log(`    A agrees            : ${(bothAgree + onlyA).toLocaleString()}  ${pRate(bothAgree + onlyA)}`);
    console.log(`    B agrees            : ${(bothAgree + onlyB).toLocaleString()}  ${pRate(bothAgree + onlyB)}`);
    console.log(`    both agree          : ${bothAgree.toLocaleString()}`);
    console.log(`    both disagree       : ${neither.toLocaleString()}`);
    console.log(`    DISCORDANT  A only  : ${onlyA.toLocaleString()}`);
    console.log(`                B only  : ${onlyB.toLocaleString()}`);
    console.log(`    McNemar z = ${z.toFixed(2)}  ${Math.abs(z) > 1.96 ? "SEPARABLE at 95%" : "not separable"}`);
    if (disc > 0) {
      console.log(
        `    (a paired test sees ${disc.toLocaleString()} informative decisions here; an\n` +
          `     unpaired win-rate duel would need thousands of GAMES for the same power)`,
      );
    }
  }

  console.log(`\n  by action type (agreement / scored):`);
  for (const [k, [a, n]] of Array.from(agreedBy).sort((x, y) => y[1][1] - x[1][1])) {
    console.log(`    ${k.padEnd(16)} ${String(a).padStart(6)} / ${String(n).padStart(6)}  ${pct(a, n)}`);
  }
  if (missBy.size > 0) {
    const totalMiss = Array.from(missBy.values()).reduce((a, b) => a + b, 0);
    console.log(`\n  WHY the engine offered no matching move (${totalMiss.toLocaleString()} misses):`);
    for (const [k, n] of Array.from(missBy).sort((x, y) => y[1] - x[1])) {
      console.log(`    ${k.padEnd(20)} ${String(n).padStart(6)}  ${pct(n, totalMiss)}`);
    }
  }
  if (unmatchedBy.size > 0 && VERBOSE) {
    console.log(`\n  unmatched detail:`);
    for (const [k, n] of Array.from(unmatchedBy).sort((x, y) => y[1] - x[1])) {
      console.log(`    ${k.padEnd(16)} ${String(n).padStart(6)}`);
    }
  }
}

main();
