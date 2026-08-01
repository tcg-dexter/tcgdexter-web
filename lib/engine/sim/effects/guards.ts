// Guard evaluation for the declarative effect schema. Its own module because
// BOTH runtime.ts (enumeration/damage) and primitives.ts (the draw_until op)
// need it, and runtime already imports primitives — putting it in either one
// would make that a cycle.

import type { GameState, PokemonInPlay } from "../../types";
import { energyProvides } from "../setup";
import { cardMatches, monMatches } from "./match";
import type { Guard } from "./types";

type Actor = "player" | "opponent";
const other = (a: Actor): Actor => (a === "player" ? "opponent" : "player");

/* ─── Guards ────────────────────────────────────────────────────── */

export function guardsPass(
  state: GameState,
  actor: Actor,
  source: PokemonInPlay | null,
  guards: Guard[] | undefined,
): boolean {
  if (!guards) return true;
  const side = state.sides[actor];
  const opp = state.sides[other(actor)];
  return guards.every((g) => {
    switch (g.cond) {
      case "opp_prizes_lte":
        return opp.prizes.length <= g.n;
      case "self_prizes_lte":
        return side.prizes.length <= g.n;
      case "is_active":
        return source != null && side.active === source;
      case "koed_last_opp_turn":
        return side.koedLastOppTurn === true;
      case "has_energy_type":
        return source != null && source.attachedEnergy.some((c) => energyProvides(c) === g.type);
      case "deck_has":
        return side.deck.some((c) => cardMatches(c, g.filter));
      case "discard_has":
        return side.discard.some((c) => cardMatches(c, g.filter));
      case "opp_active_is":
        return opp.active != null && monMatches(opp.active, g.filter);
      case "self_has_energy":
        return source != null && source.attachedEnergy.some((c) => cardMatches(c, g.filter));
      case "self_is":
        return source != null && monMatches(source, g.filter);
      case "supporter_played_contains":
        return (side.supporterNamePlayedThisTurn ?? "").includes(g.text);
      case "moved_to_active_this_turn":
        return source != null && source.movedToActiveOnTurn === state.turn.number;
      case "stadium_in_play":
        return state.stadium != null;
      case "own_bench_gte":
        return side.bench.length >= g.n;
      case "own_has_mon": {
        const pool = [side.active, ...side.bench].filter((m): m is PokemonInPlay => m !== null);
        return pool.some((m) => monMatches(m, g.filter));
      }
      case "all_own_mons_match": {
        const pool = [side.active, ...side.bench].filter((m): m is PokemonInPlay => m !== null);
        return pool.length > 0 && pool.every((m) => monMatches(m, g.filter));
      }
      case "hand_size_gte":
        // Checked while the card is still IN hand (enumeration time), so a
        // "discard N OTHER cards" cost needs N+1.
        return side.hand.length >= g.n;
    }
  });
}

