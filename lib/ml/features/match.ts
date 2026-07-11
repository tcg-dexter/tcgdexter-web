// Battle log → match-level + per-turn feature rows, by folding the
// engine's replay() snapshots over the parsed turn structure.
//
// Perspective: parsed must already be normalized (player/opponent resolved
// via normalizePerspective). states[i] is the GameState AFTER actions[i],
// so a turn's end-of-turn snapshot is states[last action index of turn].
// Per-turn flag resets happen at the NEXT turn_start (reducer.ts), so
// end-of-turn snapshots still carry evolvedThisTurn — labels.ts relies on
// that for the missed-evolution heuristic.

import type { BattleLogParseResult, ParsedAction, ParsedTurn } from "@/lib/battle-log/types";
import { isTrainerSubtype } from "@/lib/engine";
import type { GameState, PlayerSide, ReplayResult } from "@/lib/engine/types";
import { bool01, mean, num, numOrNull } from "./guards";
import type { MatchLogFeatures, TurnFeatures } from "./types";

export interface TurnExtraction {
  features: TurnFeatures;
  /** GameState after the turn's last parsed action (for label heuristics). */
  endState: GameState;
}

export interface MatchExtraction {
  match: MatchLogFeatures;
  turns: TurnExtraction[];
}

function strandedBenchEnergy(side: PlayerSide): number {
  return side.bench.reduce((s, mon) => s + mon.attachedEnergy.length, 0);
}

function retreatEnergyCount(a: ParsedAction): number {
  const discarded = a.payload.discarded_energies;
  return Array.isArray(discarded) ? discarded.length : 0;
}

export function extractMatchFeatures(
  parsed: BattleLogParseResult,
  replayResult: ReplayResult,
): MatchExtraction {
  const { states, finalState, diagnostics } = replayResult;
  if (states.length !== parsed.actions.length) {
    // Snapshots are the backbone of every per-turn feature; a mismatch
    // means replay() ran with keepSnapshots: false or on different input.
    throw new Error(
      `replay snapshots (${states.length}) do not match actions (${parsed.actions.length}); ` +
        "run replay() with keepSnapshots enabled on the same parse result",
    );
  }

  const playableTurns = parsed.turns.filter(
    (t): t is ParsedTurn & { actor: "player" | "opponent" } =>
      t.phase === "turn" && (t.actor === "player" || t.actor === "opponent"),
  );

  const turns: TurnExtraction[] = [];

  // Match-level accumulators folded across turns.
  let firstAttackPlayer: number | null = null;
  let firstAttackOpponent: number | null = null;
  let firstPrizePlayer: number | null = null;
  let firstPrizeOpponent: number | null = null;
  let retreatsPlayer = 0;
  let retreatsOpponent = 0;
  let retreatEnergyPlayer = 0;
  let retreatEnergyOpponent = 0;
  let energyPlayer = 0;
  let energyOpponent = 0;
  let supportersPlayer = 0;
  let supportersOpponent = 0;
  let kosByPlayer = 0;
  let kosByOpponent = 0;
  let turnsNoEnergyPlayer = 0;
  let turnsNoSupporterPlayer = 0;
  const prizeDiffs: number[] = [];
  const benchPlayer: number[] = [];
  const benchOpponent: number[] = [];

  for (const turn of playableTurns) {
    const indices = turn.action_indices;
    if (indices.length === 0) continue;
    const lastIdx = indices[indices.length - 1];
    const endState = states[lastIdx];
    const startState = indices[0] > 0 ? states[indices[0] - 1] : replayResult.initialState;
    const actions = indices.map((i) => parsed.actions[i]);
    const actor = turn.actor;
    const other = actor === "player" ? "opponent" : "player";

    let attacked = 0;
    let attackDamage = 0;
    let energyAttached = 0;
    let supporters = 0;
    let items = 0;
    let tools = 0;
    let stadiums = 0;
    let evolutions = 0;
    let retreats = 0;
    let retreatEnergy = 0;
    let abilities = 0;
    let kosScored = 0;
    let prizesTaken = 0;

    for (const a of actions) {
      if (a.actor === actor) {
        switch (a.action_type) {
          case "attack":
            attacked = 1;
            attackDamage += num(a.payload.damage);
            break;
          case "attach_energy":
            energyAttached += 1;
            break;
          case "play_supporter":
            supporters += 1;
            break;
          case "play_item": {
            // The parser can't distinguish supporters/tools from items
            // without a catalog ("X played Y." → play_item, see parse.ts),
            // so re-tag here. Tool before Item: tools carry both subtypes.
            const card = typeof a.payload.card === "string" ? a.payload.card : "";
            if (isTrainerSubtype(card, "Supporter")) supporters += 1;
            else if (isTrainerSubtype(card, "Pokémon Tool")) tools += 1;
            else items += 1;
            break;
          }
          case "play_tool":
            tools += 1;
            break;
          case "play_stadium":
            stadiums += 1;
            break;
          case "evolve":
            evolutions += 1;
            break;
          case "retreat":
            retreats += 1;
            retreatEnergy += retreatEnergyCount(a);
            break;
          case "ability_used":
            abilities += 1;
            break;
          case "prize_taken":
            prizesTaken += num(a.payload.count, 1);
            break;
        }
      }
      // knock_out's actor is the side LOSING the Pokémon, so a KO scored
      // by the acting side shows up as the other side's knock_out.
      if (a.action_type === "knock_out" && a.actor === other) kosScored += 1;
    }

    // Match-level fold.
    if (attacked) {
      if (actor === "player" && firstAttackPlayer === null) firstAttackPlayer = turn.turn_number;
      if (actor === "opponent" && firstAttackOpponent === null) firstAttackOpponent = turn.turn_number;
    }
    if (prizesTaken > 0) {
      if (actor === "player" && firstPrizePlayer === null) firstPrizePlayer = turn.turn_number;
      if (actor === "opponent" && firstPrizeOpponent === null) firstPrizeOpponent = turn.turn_number;
    }
    if (actor === "player") {
      retreatsPlayer += retreats;
      retreatEnergyPlayer += retreatEnergy;
      energyPlayer += energyAttached;
      supportersPlayer += supporters;
      kosByPlayer += kosScored;
      if (energyAttached === 0) turnsNoEnergyPlayer += 1;
      if (supporters === 0) turnsNoSupporterPlayer += 1;
    } else {
      retreatsOpponent += retreats;
      retreatEnergyOpponent += retreatEnergy;
      energyOpponent += energyAttached;
      supportersOpponent += supporters;
      kosByOpponent += kosScored;
    }
    prizeDiffs.push(endState.prizesTaken.player - endState.prizesTaken.opponent);
    benchPlayer.push(endState.sides.player.bench.length);
    benchOpponent.push(endState.sides.opponent.bench.length);

    const actorStartBench =
      actor === "player" ? startState.sides.player.bench.length : startState.sides.opponent.bench.length;
    const actorEndBench =
      actor === "player" ? endState.sides.player.bench.length : endState.sides.opponent.bench.length;

    turns.push({
      endState,
      features: {
        turn_number: turn.turn_number,
        player_turn_number: numOrNull(turn.player_turn_number),
        actor,
        attacked: bool01(attacked),
        attack_damage: num(attackDamage),
        energy_attached: energyAttached,
        supporter_played: bool01(supporters > 0),
        items_played: items,
        tools_played: tools,
        stadium_played: bool01(stadiums > 0),
        evolutions,
        retreats,
        retreat_energy_discarded: retreatEnergy,
        abilities_used: abilities,
        kos_scored: kosScored,
        prizes_taken: prizesTaken,
        prizes_player: num(endState.prizesTaken.player),
        prizes_opponent: num(endState.prizesTaken.opponent),
        prize_diff: num(endState.prizesTaken.player - endState.prizesTaken.opponent),
        bench_player: endState.sides.player.bench.length,
        bench_opponent: endState.sides.opponent.bench.length,
        hand_player: endState.sides.player.hand.length,
        hand_player_known: endState.sides.player.hand.filter((c) => !c.unrevealed).length,
        hand_opponent: endState.sides.opponent.hand.length,
        bench_delta: actorEndBench - actorStartBench,
      },
    });
  }

  const playerTurnCount = playableTurns.filter((t) => t.actor === "player").length;
  const opponentTurnCount = playableTurns.filter((t) => t.actor === "opponent").length;

  const match: MatchLogFeatures = {
    went_first:
      finalState.firstPlayer === "player" ? 1 : finalState.firstPlayer === "opponent" ? 0 : null,
    player_mulligans: num(finalState.sides.player.mulligans),
    opponent_mulligans: num(finalState.sides.opponent.mulligans),
    total_turns: playableTurns.length,
    player_turns: playerTurnCount,
    opponent_turns: opponentTurnCount,
    first_attack_turn_player: firstAttackPlayer,
    first_attack_turn_opponent: firstAttackOpponent,
    first_prize_turn_player: firstPrizePlayer,
    first_prize_turn_opponent: firstPrizeOpponent,
    prizes_player: num(finalState.prizesTaken.player),
    prizes_opponent: num(finalState.prizesTaken.opponent),
    prize_diff: num(finalState.prizesTaken.player - finalState.prizesTaken.opponent),
    kos_by_player: kosByPlayer,
    kos_by_opponent: kosByOpponent,
    retreats_player: retreatsPlayer,
    retreats_opponent: retreatsOpponent,
    retreat_energy_discarded_player: retreatEnergyPlayer,
    retreat_energy_discarded_opponent: retreatEnergyOpponent,
    energy_attached_player: energyPlayer,
    energy_attached_opponent: energyOpponent,
    supporters_player: supportersPlayer,
    supporters_opponent: supportersOpponent,
    turns_no_energy_player: turnsNoEnergyPlayer,
    turns_no_supporter_player: turnsNoSupporterPlayer,
    stranded_energy_final_player: strandedBenchEnergy(finalState.sides.player),
    stranded_energy_final_opponent: strandedBenchEnergy(finalState.sides.opponent),
    avg_prize_diff: mean(prizeDiffs),
    max_prize_lead: prizeDiffs.length ? Math.max(...prizeDiffs, 0) : null,
    max_prize_deficit: prizeDiffs.length ? Math.min(...prizeDiffs, 0) : null,
    avg_bench_player: mean(benchPlayer),
    avg_bench_opponent: mean(benchOpponent),
    end_reason: finalState.endReason,
    engine_error_count: diagnostics.filter((d) => d.severity === "error").length,
    engine_warn_count: diagnostics.filter((d) => d.severity === "warn").length,
    unmatched_line_count: parsed.unmatched.length,
  };

  return { match, turns };
}
