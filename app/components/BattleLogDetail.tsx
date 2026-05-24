"use client";

import { useEffect, useState, type SVGProps } from "react";

/* ─── Types (mirror lib/battle-log + the API response) ────────── */

type Actor = "player" | "opponent" | "system" | null;
type Phase = "setup" | "turn" | "checkup" | "end";

interface ApiTurn {
  id: string;
  turn_number: number;
  player_turn_number: number | null;
  actor: Exclude<Actor, null>;
  actor_handle: string | null;
  phase: Phase;
}

interface ApiAction {
  id: string;
  turn_id: string | null;
  sequence: number;
  actor: Actor;
  action_type: string;
  payload: Record<string, unknown>;
  raw_text: string | null;
}

interface ApiResponse {
  match: {
    id: string;
    player_handle: string | null;
    opponent_handle: string | null;
    parser_version: number | null;
  };
  turns: ApiTurn[];
  actions: ApiAction[];
}

/* ─── Icons ───────────────────────────────────────────────────── */
//
// Outline-style 16px SVGs, sized via className from the caller. Each
// glyph is intentionally simple so the row stays scannable; the action
// label carries the specifics.

type IconKey =
  | "coin"
  | "flag"
  | "hand"
  | "shuffle"
  | "bolt"
  | "card"
  | "stadium"
  | "evolve"
  | "retreat"
  | "swap"
  | "sword"
  | "sparkle"
  | "skull"
  | "trophy"
  | "droplet"
  | "target"
  | "minus"
  | "eye"
  | "impact"
  | "question";

function IconBase({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  );
}

const ICONS: Record<IconKey, (props: SVGProps<SVGSVGElement>) => JSX.Element> = {
  coin: (p) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 9h4a2 2 0 010 4H9m0-4v8m0-4h5" />
    </IconBase>
  ),
  flag: (p) => (
    <IconBase {...p}>
      <path d="M4 21V4m0 0h12l-3 4 3 4H4" />
    </IconBase>
  ),
  hand: (p) => (
    <IconBase {...p}>
      <rect x="3" y="6" width="6" height="14" rx="1" />
      <rect x="9" y="3" width="6" height="17" rx="1" />
      <rect x="15" y="7" width="6" height="13" rx="1" />
    </IconBase>
  ),
  shuffle: (p) => (
    <IconBase {...p}>
      <path d="M16 3l4 4-4 4M16 13l4 4-4 4M4 7h4l8 10h4M4 17h4l3-3.6" />
    </IconBase>
  ),
  bolt: (p) => (
    <IconBase {...p}>
      <path d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" />
    </IconBase>
  ),
  card: (p) => (
    <IconBase {...p}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </IconBase>
  ),
  stadium: (p) => (
    <IconBase {...p}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4M3 17l9 4 9-4" />
    </IconBase>
  ),
  evolve: (p) => (
    <IconBase {...p}>
      <path d="M12 19V5m0 0l-6 6m6-6l6 6" />
    </IconBase>
  ),
  retreat: (p) => (
    <IconBase {...p}>
      <path d="M9 6l-6 6 6 6M3 12h13a5 5 0 015 5v0" />
    </IconBase>
  ),
  swap: (p) => (
    <IconBase {...p}>
      <path d="M7 7h13l-3-3m3 3l-3 3M17 17H4l3-3m-3 3l3 3" />
    </IconBase>
  ),
  sword: (p) => (
    <IconBase {...p}>
      <path d="M14 4l6 6-9 9-3-3 9-9-3-3z" />
      <path d="M5 19l-1 1m1-1l3 3" />
    </IconBase>
  ),
  sparkle: (p) => (
    <IconBase {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" />
    </IconBase>
  ),
  skull: (p) => (
    <IconBase {...p}>
      <path d="M5 11a7 7 0 1114 0v3l-1 2H6l-1-2v-3z" />
      <circle cx="9" cy="11" r="1" />
      <circle cx="15" cy="11" r="1" />
      <path d="M10 19v2M14 19v2" />
    </IconBase>
  ),
  trophy: (p) => (
    <IconBase {...p}>
      <path d="M8 4h8v6a4 4 0 11-8 0V4z" />
      <path d="M8 7H4a3 3 0 003 3M16 7h4a3 3 0 01-3 3M10 16h4l1 4H9l1-4z" />
    </IconBase>
  ),
  droplet: (p) => (
    <IconBase {...p}>
      <path d="M12 3l5 7a5 5 0 11-10 0l5-7z" />
    </IconBase>
  ),
  target: (p) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="12" cy="12" r="1" />
    </IconBase>
  ),
  minus: (p) => (
    <IconBase {...p}>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8 12h8" />
    </IconBase>
  ),
  eye: (p) => (
    <IconBase {...p}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  ),
  impact: (p) => (
    <IconBase {...p}>
      <path d="M12 3l2 5 5 1-4 4 1 6-4-3-4 3 1-6-4-4 5-1 2-5z" />
    </IconBase>
  ),
  question: (p) => (
    <IconBase {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 015 0c0 1.5-2.5 2-2.5 4M12 17.5h.01" />
    </IconBase>
  ),
};

/* ─── action_type → icon + label ──────────────────────────────── */

const ICON_BY_TYPE: Record<string, IconKey> = {
  coin_flip: "coin",
  coin_toss_won: "coin",
  chose_first: "flag",
  opening_hand: "hand",
  mulligan: "shuffle",
  mulligan_total: "shuffle",
  mulligan_bonus_draw: "hand",
  play_to_active: "card",
  play_to_bench: "card",
  play_to_stadium: "stadium",
  attach_energy: "bolt",
  play_supporter: "card",
  play_item: "card",
  play_tool: "card",
  evolve: "evolve",
  retreat: "retreat",
  switch_active: "swap",
  attack: "sword",
  ability_used: "sparkle",
  damage_dealt: "impact",
  discard_from_pokemon: "minus",
  knock_out: "skull",
  prize_taken: "trophy",
  condition_applied: "droplet",
  damage_counter_placed: "target",
  draw: "hand",
  discard: "minus",
  shuffle: "shuffle",
  move_to_hand: "hand",
  add_to_hand: "hand",
  reveal: "eye",
  game_end: "trophy",
  unknown: "question",
};

function p<T = unknown>(action: ApiAction, key: string): T | undefined {
  return action.payload?.[key] as T | undefined;
}

function labelFor(action: ApiAction): string {
  switch (action.action_type) {
    case "coin_flip":
      return `Chose ${p<string>(action, "choice") ?? "—"} on the flip`;
    case "coin_toss_won":
      return "Won the coin toss";
    case "chose_first":
      return p<string>(action, "order") === "first"
        ? "Chose to go first"
        : "Chose to go second";
    case "opening_hand":
      return `Drew opening hand (${p<number>(action, "count") ?? 7})`;
    case "mulligan":
      return "Mulligan";
    case "mulligan_total":
      return `Took ${p<number>(action, "total") ?? "?"} mulligans`;
    case "mulligan_bonus_draw":
      return `Drew ${p<number>(action, "count") ?? "?"} bonus cards`;
    case "play_to_active":
      return `Played ${p<string>(action, "card")} to Active`;
    case "play_to_bench":
      return `Played ${p<string>(action, "card")} to Bench`;
    case "play_to_stadium": {
      const card = p<string>(action, "card");
      const replaced = p<string[]>(action, "replaced_stadium");
      return replaced && replaced.length
        ? `Played ${card} (replaced ${replaced.join(", ")})`
        : `Played ${card}`;
    }
    case "attach_energy":
      return `Attached ${p<string>(action, "energy")} to ${p<string>(action, "target")}`;
    case "evolve":
      return `Evolved ${p<string>(action, "from")} → ${p<string>(action, "to")}`;
    case "retreat": {
      const energies = p<string[]>(action, "discarded_energies") ?? [];
      const tail = energies.length
        ? ` (discarded ${energies.join(", ")})`
        : "";
      return `Retreated ${p<string>(action, "pokemon")}${tail}`;
    }
    case "switch_active":
      return `${p<string>(action, "pokemon")} is now Active`;
    case "play_item":
    case "play_supporter":
    case "play_tool":
      return `Played ${p<string>(action, "card")}`;
    case "attack": {
      const dmg = p<number>(action, "damage");
      const target = p<string>(action, "defender");
      const choices = p<string[]>(action, "choices") ?? [];
      const tail = choices.length ? ` · ${choices.join(", ")}` : "";
      return `${p<string>(action, "attacker")} used ${p<string>(action, "attack_name")} on ${target} for ${dmg}${tail}`;
    }
    case "ability_used":
      return `${p<string>(action, "source")} used ${p<string>(action, "ability_name")}`;
    case "damage_dealt":
      return `${p<string>(action, "pokemon")} took ${p<number>(action, "damage")} damage`;
    case "discard_from_pokemon":
      return `Discarded ${p<string>(action, "card")} from ${p<string>(action, "pokemon")}`;
    case "knock_out":
      return `${p<string>(action, "pokemon")} Knocked Out`;
    case "prize_taken": {
      const c = p<number>(action, "count") ?? 1;
      return `Took ${c} Prize card${c === 1 ? "" : "s"}`;
    }
    case "condition_applied":
      return `${p<string>(action, "pokemon")} is now ${p<string>(action, "condition")}`;
    case "damage_counter_placed":
      return `${p<number>(action, "counters")} damage on ${p<string>(action, "pokemon")} (${p<string>(action, "from_condition")})`;
    case "draw": {
      const count = p<number>(action, "count") ?? 1;
      const card = p<string>(action, "card");
      if (card) return `Drew ${card}`;
      return `Drew ${count} card${count === 1 ? "" : "s"}`;
    }
    case "discard": {
      const card = p<string>(action, "card");
      const count = p<number>(action, "count");
      if (card) return `Discarded ${card}`;
      if (count) return `Discarded ${count} cards`;
      return "Discarded cards";
    }
    case "shuffle": {
      const back = p<number>(action, "cards_shuffled_in");
      return back ? `Shuffled ${back} cards back into deck` : "Shuffled deck";
    }
    case "move_to_hand":
      return `Returned ${p<string>(action, "card")} to hand`;
    case "add_to_hand":
      return p<boolean>(action, "hidden")
        ? "Added a card to hand"
        : `Added ${p<string>(action, "card")} to hand`;
    case "reveal":
      return "Revealed cards";
    case "game_end": {
      const reason = p<string>(action, "reason");
      const winner = p<string>(action, "winner");
      const reasonText =
        reason === "prizes"
          ? "by taking the last Prize"
          : reason === "no_active"
          ? "by KO'ing the last Pokémon"
          : reason === "deck_out"
          ? "by deck out"
          : reason === "concede"
          ? "by concession"
          : "";
      return `${winner} wins ${reasonText}`.trim();
    }
    case "turn_start":
    case "turn_end":
      return ""; // suppressed (rendered as the cell header instead)
    case "unknown":
      return action.raw_text ?? "Unrecognized event";
    default:
      return action.action_type;
  }
}

function Icon({ type, className }: { type: string; className?: string }) {
  const key = ICON_BY_TYPE[type] ?? "question";
  const Cmp = ICONS[key];
  return <Cmp className={className} />;
}

/* ─── Cell header helper ──────────────────────────────────────── */

function cellTitle(turn: ApiTurn, playerHandle: string | null): string {
  if (turn.phase === "setup") return "Setup";
  if (turn.phase === "checkup") return "Pokémon Checkup";
  if (turn.phase === "end") return "End";
  return turn.actor_handle ?? (turn.actor === "player" ? playerHandle ?? "You" : "Opponent");
}

/* ─── Component ───────────────────────────────────────────────── */

interface Props {
  matchId: string;
}

export default function BattleLogDetail({ matchId }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/matches/${matchId}/battle-log`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load battle log.");
        return json as ApiResponse;
      })
      .then((json) => {
        if (cancelled) return;
        setData(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matchId]);

  if (loading) {
    return (
      <div className="mt-3 rounded-lg bg-bg p-4 text-xs text-text-muted">
        Loading battle log…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-3 rounded-lg bg-bg p-4 text-xs text-accent">
        {error}
      </div>
    );
  }

  if (!data) return null;

  // Group actions by turn_id, preserving sequence order.
  const actionsByTurn = new Map<string, ApiAction[]>();
  for (const a of data.actions) {
    if (!a.turn_id) continue;
    const arr = actionsByTurn.get(a.turn_id) ?? [];
    arr.push(a);
    actionsByTurn.set(a.turn_id, arr);
  }

  // Only render turns that have at least one visible action (after the
  // implicit turn_start/turn_end synthetic events are filtered out).
  // Each entry also gets a globalTurnNumber that increments only on
  // actual play turns (skipping setup / checkup), so the cell header
  // counts 1, 2, 3, 4… across both players rather than 1-1, 2-2.
  let playTurnCounter = 0;
  const renderableTurns = data.turns
    .map((t) => {
      if (t.phase === "turn") playTurnCounter += 1;
      return {
        turn: t,
        globalTurnNumber: t.phase === "turn" ? playTurnCounter : null,
        actions: (actionsByTurn.get(t.id) ?? []).filter(
          (a) => a.action_type !== "turn_start" && a.action_type !== "turn_end",
        ),
      };
    })
    .filter(({ actions, turn }) => actions.length > 0 || turn.phase === "setup");

  return (
    <div className="mt-3 flex flex-col gap-2">
      {renderableTurns.map(({ turn, actions, globalTurnNumber }) => {
        const title = cellTitle(turn, data.match.player_handle);
        const turnLabel =
          turn.phase === "turn" && globalTurnNumber != null
            ? `Turn ${globalTurnNumber}`
            : turn.phase === "setup"
            ? "Pre-game"
            : turn.phase === "checkup"
            ? "Between turns"
            : "";

        const isPlayer = turn.actor === "player";
        const isOpponent = turn.actor === "opponent";

        return (
          <div
            key={turn.id}
            className={`rounded-lg bg-bg p-3 ${
              isPlayer ? "shadow-[inset_3px_0_0_0_var(--accent)]" : ""
            } ${isOpponent ? "shadow-[inset_3px_0_0_0_black]" : ""}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-text-primary truncate">
                {title}
              </span>
              <span className="text-[11px] font-semibold text-text-muted tabular-nums">
                {turnLabel}
              </span>
            </div>
            <ul className="flex flex-col gap-1">
              {actions.map((a) => {
                const label = labelFor(a);
                if (!label) return null;
                return (
                  <li
                    key={a.id}
                    className="flex items-start gap-2 text-xs text-text-secondary leading-snug"
                  >
                    <span className="mt-0.5 text-text-muted">
                      <Icon type={a.action_type} className="w-3.5 h-3.5" />
                    </span>
                    <span className="flex-1 min-w-0 break-words">{label}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
