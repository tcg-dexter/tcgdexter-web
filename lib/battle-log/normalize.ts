// Apply the user's chosen perspective to a parsed battle log: which raw
// handle is "player" and which is "opponent". Mutates a copy and returns
// the result.

import type { Actor, BattleLogParseResult, ParsedAction, ParsedTurn } from "./types";

export function detectHandles(parsed: BattleLogParseResult): {
  candidates: string[];
} {
  // The two top-level players are the first two unique handles seen.
  // Some logs may include more (rare; mostly handles inside payloads),
  // so we cap at two for the picker.
  return { candidates: parsed.handles.slice(0, 2) };
}

export function normalizePerspective(
  parsed: BattleLogParseResult,
  playerHandle: string,
): BattleLogParseResult {
  const opponentHandle =
    parsed.handles.find((h) => h !== playerHandle) ?? null;

  function resolve(h: string | null): Actor | null {
    if (!h) return null;
    if (h === playerHandle) return "player";
    if (opponentHandle && h === opponentHandle) return "opponent";
    return "system";
  }

  const actions: ParsedAction[] = parsed.actions.map((a) => ({
    ...a,
    actor: resolve(a.actor_handle) ?? (a.actor_handle ? "system" : null),
  }));

  const turns: ParsedTurn[] = parsed.turns.map((t) => {
    if (t.phase === "checkup" || t.phase === "setup") {
      return { ...t, actor: "system" };
    }
    const resolved = resolve(t.actor_handle);
    return { ...t, actor: resolved ?? "system" };
  });

  return {
    ...parsed,
    player_handle: playerHandle,
    opponent_handle: opponentHandle,
    actions,
    turns,
  };
}
