// Derive a high-level BattleLogSummary from a normalized parse result.
// Requires the player perspective to already be applied.

import type {
  BattleLogParseResult,
  BattleLogSummary,
  EndReason,
} from "./types";

export function summarize(parsed: BattleLogParseResult): BattleLogSummary {
  let went_first: boolean | null = null;
  let player_mulligans = 0;
  let opponent_mulligans = 0;
  let prizes_taken_player = 0;
  let prizes_taken_opponent = 0;
  let end_reason: EndReason | null = null;
  let winner_actor: "player" | "opponent" | null = null;

  for (const a of parsed.actions) {
    if (a.action_type === "chose_first") {
      if (a.actor === "player") went_first = a.payload.order === "first";
      else if (a.actor === "opponent") went_first = a.payload.order !== "first";
    }

    if (a.action_type === "mulligan") {
      if (a.actor === "player") player_mulligans = Math.max(player_mulligans, 1);
      else if (a.actor === "opponent") opponent_mulligans = Math.max(opponent_mulligans, 1);
    }

    if (a.action_type === "mulligan_total") {
      const total = Number(a.payload.total) || 0;
      if (a.actor === "player") player_mulligans = total;
      else if (a.actor === "opponent") opponent_mulligans = total;
    }

    if (a.action_type === "prize_taken") {
      const count = Number(a.payload.count) || 0;
      if (a.actor === "player") prizes_taken_player += count;
      else if (a.actor === "opponent") prizes_taken_opponent += count;
    }

    if (a.action_type === "game_end") {
      end_reason = (a.payload.reason as EndReason) ?? null;
      if (a.actor === "player") winner_actor = "player";
      else if (a.actor === "opponent") winner_actor = "opponent";
    }
  }

  const total_turns = parsed.turns.filter((t) => t.phase === "turn").length;

  const result: "win" | "loss" | "draw" | null =
    winner_actor === "player" ? "win" : winner_actor === "opponent" ? "loss" : null;

  return {
    player_handle: parsed.player_handle,
    opponent_handle: parsed.opponent_handle,
    went_first,
    player_mulligans,
    opponent_mulligans,
    total_turns,
    prizes_taken_player,
    prizes_taken_opponent,
    end_reason,
    result,
  };
}
