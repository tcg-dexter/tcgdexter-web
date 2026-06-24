import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { normalizePerspective, parseBattleLog } from "@/lib/battle-log";
import { lookupCard, replay } from "@/lib/engine";
import type { GameState, PokemonInPlay } from "@/lib/engine";
import { cardImageUrlForName } from "@/lib/primaryCardImage";

/**
 * GET /api/admin/replay/[matchId]
 *
 * Admin-only. Loads a match's stored battle_log_raw, runs the engine
 * end-to-end, and returns a frame-per-action stream trimmed to what the
 * Replay UI needs (active / bench / pile counts / current turn). The
 * deeper engine state — deck instances, attached tool details — stays
 * server-side so the JSON payload stays small.
 */

interface PokemonFrame {
  name: string;
  damage: number;
  /** Printed HP — null when the name doesn't resolve in the catalog. */
  hp: number | null;
  energy: string[];
  /** One energy-type label per attached energy, in attach order. Used by
   *  the UI to render the row of energy icons in the card footer. Special
   *  / blend energies fall back to "Colorless" since no single type icon
   *  fits them. */
  energyTypes: string[];
  conditions: string[];
  evolutionStack: string[];
  /** Resolved most-recent printing image URL; null on catalog miss. */
  imageUrl: string | null;
}

interface SideFrame {
  handle: string | null;
  active: PokemonFrame | null;
  bench: PokemonFrame[];
  handCount: number;
  deckCount: number;
  discardCount: number;
  discardTop: string | null;
  /** Image URL for the most-recently discarded card (face-up top). */
  discardTopImageUrl: string | null;
  prizesRemaining: number;
}

interface StadiumFrame {
  name: string;
  owner: "player" | "opponent";
  imageUrl: string | null;
}

export interface ReplayFrame {
  /** Index into the original parsed action stream. */
  actionIndex: number;
  turn: number;
  playerTurnNumber: number;
  phase: string;
  /** Active actor at this point in the replay. */
  actor: "player" | "opponent" | "system";
  /** Plain-text description of the action that produced this frame. */
  summary: string;
  player: SideFrame;
  opponent: SideFrame;
  stadium: StadiumFrame | null;
  prizesTaken: { player: number; opponent: number };
  winner: "player" | "opponent" | null;
}

export interface ReplayPayload {
  matchId: string;
  playerHandle: string | null;
  opponentHandle: string | null;
  frames: ReplayFrame[];
  unmatchedLines: string[];
}

// Basic energy types we have icons for (public/types/*.png).
const BASIC_TYPES = new Set([
  "fire",
  "water",
  "grass",
  "lightning",
  "psychic",
  "fighting",
  "darkness",
  "metal",
  "fairy",
  "dragon",
  "colorless",
]);

/** Resolve an attached energy card name to a single type label that maps
 *  to /types/{label}.png. Basic energies parse out of the name; special
 *  / blend energies fall back to "Colorless". */
function energyTypeFromName(name: string): string {
  const m =
    name.match(/^Basic\s+([A-Za-z]+)\s+Energy$/i) ??
    name.match(/^([A-Za-z]+)\s+Energy$/);
  if (m && BASIC_TYPES.has(m[1].toLowerCase())) {
    return m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  }
  return "Colorless";
}

function mapPokemon(mon: PokemonInPlay): PokemonFrame {
  const catalog = lookupCard(mon.card.name);
  return {
    name: mon.card.name,
    damage: mon.damage,
    hp: catalog?.hp ?? null,
    energy: mon.attachedEnergy.map((c) => c.name),
    energyTypes: mon.attachedEnergy.map((c) => energyTypeFromName(c.name)),
    conditions: [...mon.conditions],
    evolutionStack: mon.stack.map((c) => c.name),
    imageUrl: cardImageUrlForName(mon.card.name),
  };
}

function mapSide(side: GameState["sides"]["player"]): SideFrame {
  return {
    handle: side.handle,
    active: side.active ? mapPokemon(side.active) : null,
    bench: side.bench.map(mapPokemon),
    handCount: side.hand.length,
    deckCount: side.deck.length,
    discardCount: side.discard.length,
    discardTop:
      side.discard.length > 0
        ? side.discard[side.discard.length - 1].name
        : null,
    discardTopImageUrl:
      side.discard.length > 0
        ? cardImageUrlForName(side.discard[side.discard.length - 1].name)
        : null,
    prizesRemaining: side.prizes.length,
  };
}

function frameFromState(state: GameState, actionIndex: number, summary: string, actor: "player" | "opponent" | "system"): ReplayFrame {
  return {
    actionIndex,
    turn: state.turn.number,
    playerTurnNumber: state.turn.playerTurnNumber,
    phase: state.turn.phase,
    actor,
    summary,
    player: mapSide(state.sides.player),
    opponent: mapSide(state.sides.opponent),
    stadium: state.stadium
      ? {
          name: state.stadium.card.name,
          owner: state.stadium.owner,
          imageUrl: cardImageUrlForName(state.stadium.card.name),
        }
      : null,
    prizesTaken: state.prizesTaken,
    winner: state.winner,
  };
}

interface MatchRow {
  id: string;
  battle_log_raw: string | null;
  player_handle: string | null;
  opponent_handle: string | null;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ matchId: string }> },
) {
  const { matchId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Auth required" }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();
  if (!me?.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const { data: match } = await supabase
    .from("matches")
    .select("id, battle_log_raw, player_handle, opponent_handle")
    .eq("id", matchId)
    .maybeSingle<MatchRow>();
  if (!match) return NextResponse.json({ error: "Match not found" }, { status: 404 });
  if (!match.battle_log_raw) {
    return NextResponse.json({ error: "Match has no battle log" }, { status: 400 });
  }

  const parsed = parseBattleLog(match.battle_log_raw);
  const playerHandle = match.player_handle ?? parsed.handles[0] ?? "";
  const normalized = normalizePerspective(parsed, playerHandle);
  const result = replay(normalized);

  // Frame 0 = initial state, before any action. Then one frame per action.
  const frames: ReplayFrame[] = [];
  frames.push(frameFromState(result.initialState, -1, "Setup", "system"));
  result.states.forEach((state, idx) => {
    const action = normalized.actions[idx];
    const actor = (action.actor ?? "system") as "player" | "opponent" | "system";
    frames.push(frameFromState(state, idx, action.raw_text, actor));
  });

  const payload: ReplayPayload = {
    matchId: match.id,
    playerHandle: normalized.player_handle,
    opponentHandle: normalized.opponent_handle,
    frames,
    unmatchedLines: normalized.unmatched,
  };

  return NextResponse.json(payload);
}
