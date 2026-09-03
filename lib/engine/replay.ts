// Replay driver — folds applyAction over a BattleLogParseResult.
//
// Returns a snapshot per applied action plus the cumulative event stream
// and diagnostics. Caller decides whether to keep all snapshots (useful
// for a turn-by-turn UI) or just the final state (useful for validation).

import { applyAction, type AmbiguityOracle } from "./reducer";
import { buildInitialState } from "./initial";
import type { BattleLogParseResult } from "@/lib/battle-log/types";
import type {
  EngineDiagnostic,
  EngineEvent,
  GameState,
  ReplayResult,
} from "./types";

export interface ReplayOptions {
  /** When false, only the final state is retained — saves memory for long
   *  replays where intermediate snapshots aren't needed. */
  keepSnapshots?: boolean;
  /** Tie-breaker for same-name/same-printing duplicate references, used by the
   *  energy-attribution solver to test each assignment. See AmbiguityOracle. */
  resolveAmbiguous?: AmbiguityOracle;
}

export function replay(
  parsed: BattleLogParseResult,
  options: ReplayOptions = {},
): ReplayResult {
  const keepSnapshots = options.keepSnapshots !== false;
  const initialState = buildInitialState(parsed);
  let state: GameState = initialState;
  const states: GameState[] = keepSnapshots ? [] : [];
  const events: EngineEvent[] = [];
  const diagnostics: EngineDiagnostic[] = [];

  parsed.actions.forEach((action, idx) => {
    const result = applyAction(state, action, {
      actionIndex: idx,
      resolveAmbiguous: options.resolveAmbiguous,
    });
    state = result.state;
    events.push(result.event);
    if (result.diagnostics.length) diagnostics.push(...result.diagnostics);
    if (keepSnapshots) states.push(state);
  });

  return {
    initialState,
    states,
    events,
    diagnostics,
    finalState: state,
  };
}
