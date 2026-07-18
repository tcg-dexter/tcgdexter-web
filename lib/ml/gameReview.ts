// Post-game review for AI-player games — the chess.com closing move.
// Rebuilds a finished transcript (deterministic), aggregates its per-turn
// feature log into MatchLogFeatures, and feeds the SAME coach heuristics
// and win-prob curve that analyze real imported matches.

import { analyzeDeckList, detectDeckArchetype } from "@/lib/analyzeDeck";
import {
  rebuildSession,
  IllegalMoveError,
  type GameOutcome,
  type GameTranscript,
  type LoggedTurn,
} from "@/lib/engine/sim";
import { buildCoachReport, type CoachReport } from "./coach";
import { mean, num } from "./features/guards";
import type { MatchLogFeatures } from "./features";
import { readWinProbArtifact, winProbCurve, type WinProbPoint } from "./winprob";

export interface GameReview {
  report: CoachReport;
  features: MatchLogFeatures;
  win_prob: { model_version: string; curve: WinProbPoint[] } | null;
  outcome: GameOutcome;
}

function detectArchetype(deckList: string): string | null {
  try {
    return detectDeckArchetype(analyzeDeckList(deckList)).archetypeName;
  } catch {
    return null;
  }
}

/** Aggregate the session's turn log the way extractMatchFeatures folds a
 *  replayed battle log (sim games have no parser/engine diagnostics). */
function aggregateFeatures(
  transcript: GameTranscript,
  turns: LoggedTurn[],
  stranded: { player: number; opponent: number },
  mulligans: { player: number; opponent: number },
): MatchLogFeatures {
  const player = turns.filter((t) => t.actor === "player");
  const opponent = turns.filter((t) => t.actor === "opponent");
  const sum = (rows: LoggedTurn[], key: keyof LoggedTurn) =>
    rows.reduce((s, t) => s + num(t[key]), 0);
  const firstWhere = (rows: LoggedTurn[], pred: (t: LoggedTurn) => boolean) =>
    rows.find(pred)?.turn_number ?? null;
  const prizeDiffs = turns.map((t) => t.prize_diff);
  const last = turns[turns.length - 1];

  return {
    went_first: transcript.human_first ? 1 : 0,
    player_mulligans: mulligans.player,
    opponent_mulligans: mulligans.opponent,
    total_turns: turns.length,
    player_turns: player.length,
    opponent_turns: opponent.length,
    first_attack_turn_player: firstWhere(player, (t) => t.attacked === 1),
    first_attack_turn_opponent: firstWhere(opponent, (t) => t.attacked === 1),
    first_prize_turn_player: firstWhere(player, (t) => t.prizes_taken > 0),
    first_prize_turn_opponent: firstWhere(opponent, (t) => t.prizes_taken > 0),
    prizes_player: last?.prizes_player ?? 0,
    prizes_opponent: last?.prizes_opponent ?? 0,
    prize_diff: last?.prize_diff ?? 0,
    kos_by_player: sum(player, "kos_scored"),
    kos_by_opponent: sum(opponent, "kos_scored"),
    retreats_player: sum(player, "retreats"),
    retreats_opponent: sum(opponent, "retreats"),
    retreat_energy_discarded_player: sum(player, "retreat_energy_discarded"),
    retreat_energy_discarded_opponent: sum(opponent, "retreat_energy_discarded"),
    energy_attached_player: sum(player, "energy_attached"),
    energy_attached_opponent: sum(opponent, "energy_attached"),
    supporters_player: sum(player, "supporter_played"),
    supporters_opponent: sum(opponent, "supporter_played"),
    turns_no_energy_player: player.filter((t) => t.energy_attached === 0).length,
    turns_no_supporter_player: player.filter((t) => t.supporter_played === 0).length,
    stranded_energy_final_player: stranded.player,
    stranded_energy_final_opponent: stranded.opponent,
    avg_prize_diff: mean(prizeDiffs),
    max_prize_lead: prizeDiffs.length ? Math.max(...prizeDiffs, 0) : null,
    max_prize_deficit: prizeDiffs.length ? Math.min(...prizeDiffs, 0) : null,
    avg_bench_player: mean(turns.map((t) => t.bench_player)),
    avg_bench_opponent: mean(turns.map((t) => t.bench_opponent)),
    end_reason: null, // set from the outcome below
    engine_error_count: 0,
    engine_warn_count: 0,
    unmatched_line_count: 0,
  };
}

export function reviewFromTranscript(transcript: GameTranscript): GameReview {
  const session = rebuildSession(transcript);
  if (session.status !== "over" || !session.outcome) {
    throw new IllegalMoveError("Game is not finished — review needs a completed transcript");
  }

  const benchEnergy = (side: "player" | "opponent") =>
    session.state.sides[side].bench.reduce((s, mon) => s + mon.attachedEnergy.length, 0);

  const features = aggregateFeatures(
    transcript,
    session.turnLog,
    { player: benchEnergy("player"), opponent: benchEnergy("opponent") },
    {
      player: session.state.sides.player.mulligans,
      opponent: session.state.sides.opponent.mulligans,
    },
  );
  features.end_reason = session.outcome.endReason;

  const report = buildCoachReport(features, session.turnLog);

  let winProb: GameReview["win_prob"] = null;
  const artifact = readWinProbArtifact();
  if (artifact) {
    winProb = {
      model_version: artifact.model_version,
      curve: winProbCurve(
        artifact,
        {
          went_first: features.went_first,
          archetype_name: detectArchetype(transcript.deck_human),
        },
        session.turnLog,
      ),
    };
  }

  return { report, features, win_prob: winProb, outcome: session.outcome };
}
