// Energy-attribution solver (stage 3).
//
// A TCG Live log names an energy's target by name + zone only, so two
// same-printing Pokémon on the same bench are indistinguishable at the moment
// energy is attached — the name-only resolver just piles it on the first, which
// is how a real 2-1 split renders as 3-0. But the log DOES reveal each
// instance's energy later, when it leaves: a retreat / effect names the exact
// energies discarded, from the (unambiguous) Active Pokémon. Those events are
// hard constraints on the ambiguous attaches.
//
// This solver treats each ambiguous attach as a free choice and searches for
// the assignment that satisfies every constraint — scored as the number of
// `energy_discard_shortfall` diagnostics the replay raises (an instance asked to
// pay energy it isn't holding = a wrong assignment). Among the feasible
// (min-shortfall) assignments it prefers the most balanced one, which is the
// agreed behaviour where the log doesn't force a distribution. It never
// re-implements the reducer: it drives the real replay through the ambiguity
// oracle, so its semantics can't drift.

import { replay } from "./replay";
import type { AmbiguityOracle } from "./reducer";
import type { BattleLogParseResult } from "@/lib/battle-log/types";
import type { GameState, PokemonInPlay } from "./types";

const SHORTFALL_CODE = "energy_discard_shortfall";
/** Above this many total assignments, fall back to a greedy per-point search
 *  instead of enumerating them all. Real duplicate scenarios are tiny (a
 *  handful of ambiguous attaches, two candidates each), so the exhaustive path
 *  is the normal one; the cap only guards a pathological log. */
const EXHAUSTIVE_CAP = 512;

interface AmbiguousPoint {
  actionIndex: number;
  candidateCount: number;
}

interface Score {
  /** Constraint violations — lower is more correct. */
  shortfalls: number;
  /** Worst per-instance pile within any same-printing group — lower is more
   *  balanced. Only a tie-breaker once shortfalls are minimised. */
  imbalance: number;
}

const NO_OP: AmbiguityOracle = () => undefined;

/**
 * Resolve which same-printing duplicate each ambiguous energy attach belongs
 * to. Returns an oracle to pass as `replay`'s `resolveAmbiguous`, so the board
 * the viewer sees is built from the corrected attribution.
 */
export function solveEnergyAttribution(
  parsed: BattleLogParseResult,
): AmbiguityOracle {
  // Discover the ambiguous points by running once at defaults and noting every
  // attach the oracle is consulted on with more than one candidate.
  const points: AmbiguousPoint[] = [];
  replay(parsed, {
    keepSnapshots: false,
    resolveAmbiguous: (info) => {
      if (info.candidateIds.length > 1) {
        points.push({
          actionIndex: info.actionIndex,
          candidateCount: info.candidateIds.length,
        });
      }
      return undefined;
    },
  });
  if (points.length === 0) return NO_OP;

  const oracleFor = (ordinals: Map<number, number>): AmbiguityOracle => (info) => {
    const ord = ordinals.get(info.actionIndex);
    return ord == null ? undefined : info.candidateIds[ord];
  };

  const scoreOf = (ordinals: Map<number, number>): Score => {
    const res = replay(parsed, {
      keepSnapshots: false,
      resolveAmbiguous: oracleFor(ordinals),
    });
    let shortfalls = 0;
    for (const d of res.diagnostics) if (d.code === SHORTFALL_CODE) shortfalls++;
    return { shortfalls, imbalance: maxDuplicatePile(res.finalState) };
  };

  const better = (a: Score, b: Score) =>
    a.shortfalls < b.shortfalls ||
    (a.shortfalls === b.shortfalls && a.imbalance < b.imbalance);

  const totalCombos = points.reduce((n, p) => n * p.candidateCount, 1);

  let best = new Map<number, number>(); // empty = all defaults (first candidate)
  let bestScore = scoreOf(best);

  if (totalCombos <= EXHAUSTIVE_CAP) {
    // Enumerate every ordinal tuple.
    for (let combo = 0; combo < totalCombos; combo++) {
      const ordinals = new Map<number, number>();
      let rem = combo;
      for (const p of points) {
        ordinals.set(p.actionIndex, rem % p.candidateCount);
        rem = Math.floor(rem / p.candidateCount);
      }
      const s = scoreOf(ordinals);
      if (better(s, bestScore)) {
        best = ordinals;
        bestScore = s;
      }
    }
  } else {
    // Greedy: fix each point in turn to its locally-best ordinal. Not globally
    // optimal, but only reached on a pathological number of ambiguous attaches.
    const ordinals = new Map<number, number>();
    for (const p of points) {
      let localBest = 0;
      let localScore: Score | null = null;
      for (let ord = 0; ord < p.candidateCount; ord++) {
        ordinals.set(p.actionIndex, ord);
        const s = scoreOf(ordinals);
        if (localScore == null || better(s, localScore)) {
          localScore = s;
          localBest = ord;
        }
      }
      ordinals.set(p.actionIndex, localBest);
    }
    best = ordinals;
  }

  return best.size === 0 ? NO_OP : oracleFor(best);
}

/** The largest energy pile on any Pokémon that shares its name+printing with
 *  another in-play Pokémon — the imbalance a balanced assignment minimises. */
function maxDuplicatePile(state: GameState): number {
  let worst = 0;
  for (const side of [state.sides.player, state.sides.opponent]) {
    const inPlay: PokemonInPlay[] = side.active
      ? [side.active, ...side.bench]
      : [...side.bench];
    const groups = new Map<string, PokemonInPlay[]>();
    for (const mon of inPlay) {
      const key = `${mon.card.name}|${mon.card.printingId ?? ""}`;
      const g = groups.get(key);
      if (g) g.push(mon);
      else groups.set(key, [mon]);
    }
    for (const g of Array.from(groups.values())) {
      if (g.length < 2) continue;
      for (const mon of g) worst = Math.max(worst, mon.attachedEnergy.length);
    }
  }
  return worst;
}
