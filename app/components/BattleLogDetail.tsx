"use client";

import { useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type SVGProps } from "react";
import { cleanPayloadCardIds, stripCardIds } from "@/lib/battle-log";

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
  battle: {
    id: string;
    player_handle: string | null;
    opponent_handle: string | null;
    parser_version: number | null;
    result: "win" | "loss" | "draw" | null;
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

const BASIC_ENERGY_TYPES = new Set([
  "Fire", "Water", "Grass", "Lightning", "Psychic",
  "Fighting", "Darkness", "Metal", "Dragon", "Fairy", "Colorless",
]);

function basicEnergyType(name: string): string | null {
  const m = name?.match(/^Basic (\w+) Energy$/);
  if (!m) return null;
  return BASIC_ENERGY_TYPES.has(m[1]) ? m[1] : null;
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
      return "Opening Hand";
    case "mulligan":
      return "Mulligan";
    case "mulligan_total":
      return `Took ${p<number>(action, "total") ?? "?"} mulligans`;
    case "mulligan_bonus_draw":
      return `${p<number>(action, "count") ?? "?"} bonus cards`;
    case "play_to_active":
      return `${p<string>(action, "card")} to Active`;
    case "play_to_bench":
      return `${p<string>(action, "card")} to Bench`;
    case "play_to_stadium": {
      const card = p<string>(action, "card");
      const replaced = p<string[]>(action, "replaced_stadium");
      return replaced && replaced.length
        ? `${card} (replaced ${replaced.join(", ")})`
        : `${card}`;
    }
    case "attach_energy":
      return `${p<string>(action, "energy")} → ${p<string>(action, "target")}`;
    case "evolve":
      return `${p<string>(action, "from")} → ${p<string>(action, "to")}`;
    case "retreat": {
      const energies = p<string[]>(action, "discarded_energies") ?? [];
      const tail = energies.length
        ? ` (discarded ${energies.join(", ")})`
        : "";
      return `${p<string>(action, "pokemon")}${tail}`;
    }
    case "switch_active":
      return `${p<string>(action, "pokemon")} is now Active`;
    case "play_item":
    case "play_supporter":
    case "play_tool":
      return `${p<string>(action, "card")}`;
    case "attack": {
      const dmg = p<number>(action, "damage");
      const target = p<string>(action, "defender");
      const choices = p<string[]>(action, "choices") ?? [];
      const tail = choices.length ? ` · ${choices.join(", ")}` : "";
      return `${p<string>(action, "attack_name")} on ${target} for ${dmg}${tail}`;
    }
    case "ability_used":
      return `${p<string>(action, "source")} used ${p<string>(action, "ability_name")}`;
    case "damage_dealt":
      return `${p<string>(action, "pokemon")} took ${p<number>(action, "damage")} damage`;
    case "discard_from_pokemon":
      return `Discarded ${p<string>(action, "card") ?? "card"}`;
    case "knock_out":
      return `${p<string>(action, "pokemon")} Knocked Out`;
    case "prize_taken": {
      const c = p<number>(action, "count") ?? 1;
      return `${c} Prize${c === 1 ? "" : "s"}`;
    }
    case "condition_applied":
      return `${p<string>(action, "pokemon")} is now ${p<string>(action, "condition")}`;
    case "damage_counter_placed":
      return `${p<number>(action, "counters")} damage on ${p<string>(action, "pokemon")} (${p<string>(action, "from_condition")})`;
    case "draw": {
      const count = p<number>(action, "count") ?? 1;
      const card = p<string>(action, "card");
      if (card) return `${card}`;
      return `${count} card${count === 1 ? "" : "s"}`;
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

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip a leading actor name (and optional possessive "'s") from an action
 * label, then capitalize the first letter of what remains. The turn holder
 * is already named alongside the action, so echoing it in the body is
 * redundant — "alice drew 4 cards" → "Drew 4 cards". Returns the text
 * unchanged (no re-capitalization) when it doesn't start with the name, so
 * name-free labels like "Pikachu to Active" are left intact.
 */
export function stripLeadingActorName(text: string, name?: string | null): string {
  if (!text || !name) return text;
  const re = new RegExp(`^\\s*${escapeRegExp(name.trim())}(?:['’]s)?\\s+`, "i");
  if (!re.test(text)) return text;
  const stripped = text.replace(re, "");
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

/**
 * Format an action label for display next to its author: swap the generic
 * "Opponent" placeholder for the other player's actual name, then strip the
 * redundant leading author name. `otherName` is the side opposite the author.
 */
function formatActionLabel(
  text: string,
  opts: { authorName?: string | null; otherName?: string | null },
): string {
  let out = text;
  if (opts.otherName) {
    out = out.replace(/\bOpponent\b/g, opts.otherName);
  }
  return stripLeadingActorName(out, opts.authorName);
}

/* ─── Avatar + identity helpers ───────────────────────────────── */

const AVATAR_PALETTE = [
  "#3b6fd4",
  "#d43b9a",
  "#27ae60",
  "#e67e22",
  "#9b59b6",
  "#c0392b",
  "#1abc9c",
  "#34495e",
];

function avatarBg(name: string): string {
  const h = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function avatarInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.length ? trimmed[0].toUpperCase() : "?";
}

function handleSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 20) || "user";
}

type PostKind = "player" | "opponent" | "system";

interface SystemAccount {
  displayName: string;
  handle: string;
  glyph: IconKey;
  bg: string;
  /** Optional short text label rendered in place of the glyph (e.g. "PC"). */
  label?: string;
}

const SYSTEM_ACCOUNTS: Record<"setup" | "checkup" | "game", SystemAccount> = {
  setup: { displayName: "Setup", handle: "setup", glyph: "shuffle", bg: "#475569" },
  checkup: { displayName: "Pokémon Checkup", handle: "checkup", glyph: "droplet", bg: "linear-gradient(135deg, #a855f7 0%, #7c3aed 52%, #6d28d9 100%)", label: "PC" },
  game: { displayName: "Game", handle: "game", glyph: "trophy", bg: "#0f172a" },
};

interface PostStats {
  drew: number;
  damage: number;
  ko: number;
  prizes: number;
}

function statsFor(actions: ApiAction[]): PostStats {
  const stats: PostStats = { drew: 0, damage: 0, ko: 0, prizes: 0 };
  for (const a of actions) {
    switch (a.action_type) {
      case "draw":
      case "mulligan_bonus_draw":
      case "opening_hand":
        stats.drew += (p<number>(a, "count") ?? 1);
        break;
      case "attack":
      case "damage_dealt":
      case "damage_counter_placed": {
        const d =
          p<number>(a, "damage") ??
          (p<number>(a, "counters") ?? 0) * 10;
        stats.damage += d;
        break;
      }
      case "knock_out":
        stats.ko += 1;
        break;
      case "prize_taken":
        stats.prizes += p<number>(a, "count") ?? 1;
        break;
    }
  }
  return stats;
}

/* ─── Component ───────────────────────────────────────────────── */

interface Props {
  battleId: string;
  apiUrl: string;
  result?: "win" | "loss" | "draw" | null;
  playerColor?: string;
  opponentColor?: string;
  /** Backgrounds for the two participants' monogram avatars. When set, the
   *  player/opponent posts use these instead of the win/loss tint or the
   *  name-hash fallback — the Replay viewer passes each side's mat gradient
   *  so a monogram reads as cut from the same sleeve as its board mat. Any
   *  CSS background value (a gradient string is fine). Other callers omit
   *  these and keep the win/loss avatar colouring. */
  playerAvatarBg?: string;
  opponentAvatarBg?: string;
  /** When set, marks which post is "current" for the Replay tool's
   *  playhead — the last post with an action at or before this sequence.
   *  That post gets full opacity + auto-centering; every other post
   *  (including ones after it) is dimmed. The thread itself is always
   *  rendered in full — this drives the spotlight, not what's in the DOM. */
  maxSequence?: number | null;
  /** Replay tool only: clicking a post's avatar jumps the playhead to that
   *  post's first action (the beginning of its turn). Given the action
   *  sequence to jump to; the viewer maps it to a frame. */
  onJumpToSequence?: (sequence: number) => void;
  /** When true, the inline ScoreCards (initial board snapshot + each
   *  prize-taking moment) are omitted. Used by the Replay tool where the
   *  live board view already represents that state. */
  hideScoreCards?: boolean;
  /** When true, post avatars render 25% smaller for tighter side-panel
   *  presentations (e.g. the Replay thread next to the board). */
  compactAvatars?: boolean;
  /** When true, the thread collapses to a thin column of avatars + turn
   *  chips + connecting thread lines — no action details. Used by the
   *  Replay viewer's desktop "collapse thread" toggle to free horizontal
   *  space beside the board for the transport controls. The dimming, the
   *  auto-recenter, and the underlying playhead state stay put; only the
   *  right column of each post drops out. */
  collapsed?: boolean;
  /** The thread's own scrollable ancestor (Replay's `overflow-y-auto`
   *  aside). Playhead mode re-centers the current post by scrolling only
   *  this element directly — without it, native scrollIntoView would walk
   *  every scrollable ancestor, including the page itself, and drag the
   *  whole viewport back whenever the user had scrolled away. */
  scrollContainerRef?: MutableRefObject<HTMLDivElement | null>;
}

export default function BattleLogDetail({ battleId, apiUrl, result, playerColor, opponentColor, playerAvatarBg, opponentAvatarBg, maxSequence, onJumpToSequence, hideScoreCards, compactAvatars, collapsed, scrollContainerRef }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiUrl)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json.error ?? "Failed to load battle log.");
        return json as ApiResponse;
      })
      .then((json: ApiResponse) => {
        if (cancelled) return;
        // Strip TCG Live card-id prefixes ("(me2-5_155) N's Zekrom") from
        // card-name payload fields and raw_text. Battles imported before the
        // verbose-export support landed have these baked into their stored
        // actions; cleaning at ingestion keeps the thread readable without a
        // data migration.
        setData({
          ...json,
          actions: json.actions.map((a) => ({
            ...a,
            payload: cleanPayloadCardIds(a.payload ?? {}),
            raw_text: a.raw_text != null ? stripCardIds(a.raw_text) : a.raw_text,
          })),
        });
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
  }, [battleId]);

  // Playhead mode (maxSequence set — the Replay tool): the post the
  // playhead currently sits inside is kept smoothly recentered as it
  // grows, rather than the thread snapping to a bottom-pinned scrollTop
  // every time a new action lands. We scroll scrollContainerRef directly
  // (with a manually computed offset) rather than el.scrollIntoView(),
  // which walks and re-centers *every* scrollable ancestor — including
  // the page itself — and would drag the whole viewport back to the
  // thread any time the user had scrolled away from it.
  const currentPostRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (maxSequence == null) return;
    const container = scrollContainerRef?.current;
    const el = currentPostRef.current;
    if (!container || !el) return;
    // getBoundingClientRect rather than offsetTop — el's offsetParent may
    // be an ancestor further up than container (e.g. a positioned wrapper
    // around it), so offsetTop alone wouldn't reliably measure position
    // relative to container specifically.
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta =
      elRect.top - containerRect.top + elRect.height / 2 - containerRect.height / 2;
    container.scrollTo({ top: container.scrollTop + delta, behavior: "smooth" });
  }, [maxSequence, data, scrollContainerRef]);

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

  // The thread always renders in full — maxSequence (playhead mode) only
  // picks out which post is "current" for the spotlight below, it no
  // longer hides future turns from the DOM.
  const visibleActions = data.actions;

  // Group actions by turn_id, preserving sequence order.
  const actionsByTurn = new Map<string, ApiAction[]>();
  for (const a of visibleActions) {
    if (!a.turn_id) continue;
    const arr = actionsByTurn.get(a.turn_id) ?? [];
    arr.push(a);
    actionsByTurn.set(a.turn_id, arr);
  }

  // Only render turns that have at least one visible action (after the
  // implicit turn_start/turn_end synthetic events are filtered out).
  // Each entry also gets a globalTurnNumber that increments only on
  // actual play turns (skipping setup / checkup), so the post header
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

  // Flatten turns into a single linear stream of "posts". Setup turns
  // expand into one post per actor; everything else becomes a single
  // post attributed either to the actor's handle or to a synthetic
  // "Setup" / "Checkup" / "Game" user so readers see the same avatar +
  // handle + body shape on every entry in the thread.
  const playerHandle = data.battle.player_handle ?? "You";
  const opponentHandle = data.battle.opponent_handle ?? "Opponent";

  // Find the winning side so we can color the player/opponent
  // avatars with the site's win gradient vs solid black for the
  // loser. The battle record carries `result` ("win" | "loss" |
  // "draw") from the player's perspective — preferred over the
  // game_end action, which isn't stored for every battle.
  // Prefer the result prop passed in by the page (always present);
  // fall back to data.battle.result from the API for callers that
  // don't pass it.
  const battleResult = result ?? data.battle.result;
  const winnerActor: "player" | "opponent" | null =
    battleResult === "win"
      ? "player"
      : battleResult === "loss"
      ? "opponent"
      : null;
  const battleHasEnded = winnerActor != null;

  interface Post {
    key: string;
    kind: PostKind;
    displayName: string;
    handle: string;
    label: string;
    actions: ApiAction[];
    system?: SystemAccount;
    outcome?: "win" | "loss";
  }

  function outcomeFor(actor: "player" | "opponent"): "win" | "loss" | undefined {
    if (!battleHasEnded || !winnerActor) return undefined;
    return actor === winnerActor ? "win" : "loss";
  }

  const posts: Post[] = [];

  for (const { turn, actions, globalTurnNumber } of renderableTurns) {
    if (turn.phase === "setup") {
      const groups = groupSetupActions(actions, playerHandle, opponentHandle);
      const expand = groups.length > 0 ? groups : null;
      if (!expand) {
        posts.push({
          key: `${turn.id}-setup`,
          kind: "system",
          displayName: SYSTEM_ACCOUNTS.setup.displayName,
          handle: SYSTEM_ACCOUNTS.setup.handle,
          label: "Pre-game",
          actions,
          system: SYSTEM_ACCOUNTS.setup,
        });
      } else {
        for (const group of expand) {
          const isPlayer = group.actor === "player";
          const isOpponent = group.actor === "opponent";
          const display = isPlayer
            ? playerHandle
            : isOpponent
            ? opponentHandle
            : SYSTEM_ACCOUNTS.setup.displayName;
          posts.push({
            key: `${turn.id}-${group.key}`,
            kind: isPlayer ? "player" : isOpponent ? "opponent" : "system",
            displayName: display,
            handle: isPlayer || isOpponent ? handleSlug(display) : SYSTEM_ACCOUNTS.setup.handle,
            label: "Pre-game",
            actions: group.actions,
            system: isPlayer || isOpponent ? undefined : SYSTEM_ACCOUNTS.setup,
            outcome: isPlayer
              ? outcomeFor("player")
              : isOpponent
              ? outcomeFor("opponent")
              : undefined,
          });
        }
      }
    } else if (turn.phase === "turn") {
      const isPlayer = turn.actor === "player";
      const display = turn.actor_handle ?? (isPlayer ? playerHandle : opponentHandle);
      const kind: PostKind = isPlayer ? "player" : "opponent";
      posts.push({
        key: turn.id,
        kind,
        displayName: display,
        handle: handleSlug(display),
        label: globalTurnNumber != null ? `Turn ${globalTurnNumber}` : "",
        actions,
        outcome: outcomeFor(isPlayer ? "player" : "opponent"),
      });
    } else if (turn.phase === "checkup") {
      posts.push({
        key: turn.id,
        kind: "system",
        displayName: SYSTEM_ACCOUNTS.checkup.displayName,
        handle: SYSTEM_ACCOUNTS.checkup.handle,
        label: "Between turns",
        actions,
        system: SYSTEM_ACCOUNTS.checkup,
      });
    } else {
      posts.push({
        key: turn.id,
        kind: "system",
        displayName: SYSTEM_ACCOUNTS.game.displayName,
        handle: SYSTEM_ACCOUNTS.game.handle,
        label: "Final",
        actions,
        system: SYSTEM_ACCOUNTS.game,
      });
    }
  }

  const pregamePosts = posts.filter((p) => p.label === "Pre-game");
  const gamePosts = posts.filter((p) => p.label !== "Pre-game");

  // Cumulative prize totals at the end of each game turn, keyed by index.
  let playerPrizeRunning = 0;
  let opponentPrizeRunning = 0;
  const prizeCumulative = gamePosts.map((post) => {
    for (const a of post.actions) {
      if (a.action_type === "prize_taken") {
        const count = p<number>(a, "count") ?? 1;
        if (a.actor === "player") playerPrizeRunning += count;
        else if (a.actor === "opponent") opponentPrizeRunning += count;
      }
    }
    return { player: playerPrizeRunning, opponent: opponentPrizeRunning };
  });

  // Active + bench Pokémon tracking. Initialize from pre-game, snapshot after
  // each game turn. benchState entries are arrays because multiple Pokémon can
  // be benched simultaneously; we spread them on snapshot to avoid aliasing.
  const activeState = { player: null as string | null, opponent: null as string | null };
  const benchState = { player: [] as string[], opponent: [] as string[] };

  function applyFieldState(actions: ApiAction[]) {
    for (const a of actions) {
      if (a.action_type === "knock_out") {
        const pokemon = p<string>(a, "pokemon");
        if (pokemon) {
          const lc = pokemon.toLowerCase();
          if (activeState.player?.toLowerCase() === lc) activeState.player = null;
          else if (activeState.opponent?.toLowerCase() === lc) activeState.opponent = null;
          // Also remove from bench (spread damage can KO benched Pokémon).
          benchState.player = benchState.player.filter(n => n.toLowerCase() !== lc);
          benchState.opponent = benchState.opponent.filter(n => n.toLowerCase() !== lc);
        }
      } else if (a.action_type === "play_to_bench") {
        const card = p<string>(a, "card");
        if (card) {
          if (a.actor === "player") benchState.player.push(card);
          else if (a.actor === "opponent") benchState.opponent.push(card);
        }
      } else if (
        a.action_type === "play_to_active" ||
        a.action_type === "switch_active"
      ) {
        const card =
          a.action_type === "play_to_active"
            ? p<string>(a, "card")
            : p<string>(a, "pokemon");
        if (card) {
          // Routing rule: if exactly ONE side is null, always fill it regardless
          // of actor (post-KO promote or missing pre-game setup). Both filled →
          // voluntary retreat, trust actor. Both null → use actor for setup.
          let side: "player" | "opponent" | null = null;
          if (activeState.player === null && activeState.opponent === null) {
            if (a.actor === "player") side = "player";
            else if (a.actor === "opponent") side = "opponent";
            else side = "player";
          } else if (activeState.player === null) {
            side = "player";
          } else if (activeState.opponent === null) {
            side = "opponent";
          } else {
            if (a.actor === "player") side = "player";
            else if (a.actor === "opponent") side = "opponent";
          }

          if (side) {
            // Voluntary retreat: old active goes to bench.
            const old = activeState[side];
            if (old !== null) benchState[side].push(old);
            // New active leaves bench.
            const lc = card.toLowerCase();
            benchState[side] = benchState[side].filter(n => n.toLowerCase() !== lc);
            activeState[side] = card;
          }
        }
      } else if (a.action_type === "evolve") {
        const from = p<string>(a, "from");
        const to = p<string>(a, "to");
        if (from && to) {
          const lc = from.toLowerCase();
          if (activeState.player?.toLowerCase() === lc) activeState.player = to;
          else if (activeState.opponent?.toLowerCase() === lc) activeState.opponent = to;
          const pi = benchState.player.findIndex(n => n.toLowerCase() === lc);
          if (pi !== -1) benchState.player[pi] = to;
          const oi = benchState.opponent.findIndex(n => n.toLowerCase() === lc);
          if (oi !== -1) benchState.opponent[oi] = to;
        }
      }
    }
  }
  for (const post of pregamePosts) applyFieldState(post.actions);
  const initialSnap = {
    player: activeState.player,
    opponent: activeState.opponent,
    playerBench: [...benchState.player],
    opponentBench: [...benchState.opponent],
  };
  const snapshotsAtEnd = gamePosts.map((post) => {
    applyFieldState(post.actions);
    return {
      player: activeState.player,
      opponent: activeState.opponent,
      playerBench: [...benchState.player],
      opponentBench: [...benchState.opponent],
    };
  });

  const resolvedPlayerColor = playerColor ?? "#d95555";
  const resolvedOpponentColor = opponentColor ?? "#1a1a1a";

  const COIN_TOSS_TYPES = new Set(["coin_flip", "coin_toss_won", "chose_first"]);
  const allPregameActions = pregamePosts.flatMap((post) => post.actions);
  const filteredPregamePosts = pregamePosts
    .map((post) => ({ ...post, actions: post.actions.filter((a) => !COIN_TOSS_TYPES.has(a.action_type)) }))
    .filter((post) => post.actions.length > 0);

  // In playhead mode, find which post the playhead currently sits inside —
  // the thread is fully populated now, so unlike a clip boundary this has
  // to be located explicitly: the last post (in render order) holding an
  // action at or before maxSequence. Everything else, before OR after it,
  // gets dimmed — including the upcoming post, which stays visible as a
  // dimmed preview directly below the spotlighted one instead of being
  // hidden until the playhead reaches it.
  const orderedPosts = [...filteredPregamePosts, ...gamePosts];
  let currentPostKey: string | null = null;
  if (maxSequence != null) {
    for (const post of orderedPosts) {
      if (post.actions.some((a) => a.sequence <= maxSequence)) {
        currentPostKey = post.key;
      }
    }
  }

  return (
    <div className="mt-3 flex flex-col rounded-lg bg-bg overflow-hidden">
      {pregamePosts.length > 0 && (
        <>
          {/* CoinTossSegment / SectionDivider / ScoreCard are wide horizontal
              chrome that doesn't fit the collapsed thin column and would
              force the aside wider than the avatars need. In collapsed mode
              the thread is just avatars + turn chips + connecting lines,
              so drop the chrome and let the ThreadPost stack carry it. */}
          {!collapsed && (
            <>
              <CoinTossSegment
                actions={allPregameActions}
                playerHandle={playerHandle}
                opponentHandle={opponentHandle}
              />
              <SectionDivider label="Setup" />
            </>
          )}
          {filteredPregamePosts.map((post, i) => (
            <ThreadPost
              key={post.key}
              post={post}
              isLast={i === filteredPregamePosts.length - 1}
              compactAvatars={compactAvatars}
              collapsed={collapsed}
              playerHandle={playerHandle}
              opponentHandle={opponentHandle}
              playerAvatarBg={playerAvatarBg}
              opponentAvatarBg={opponentAvatarBg}
              onJumpToSequence={onJumpToSequence}
              dimmed={currentPostKey != null && post.key !== currentPostKey}
              rootRef={post.key === currentPostKey ? currentPostRef : undefined}
            />
          ))}
          {!collapsed && !hideScoreCards && (
            <ScoreCard
              key="initial-score"
              playerPrizes={0}
              opponentPrizes={0}
              playerName={playerHandle}
              opponentName={opponentHandle}
              playerColor={resolvedPlayerColor}
              opponentColor={resolvedOpponentColor}
              playerActiveName={initialSnap.player}
              opponentActiveName={initialSnap.opponent}
              playerBench={initialSnap.playerBench}
              opponentBench={initialSnap.opponentBench}
            />
          )}
        </>
      )}
      {gamePosts.length > 0 && !collapsed && <SectionDivider label="Start" />}
      {gamePosts.flatMap((post, i) => {
        const stats = statsFor(post.actions);
        const hasPrizes = stats.prizes > 0;
        const items = [
          <ThreadPost
            key={post.key}
            post={post}
            isLast={hasPrizes || i === gamePosts.length - 1}
            compactAvatars={compactAvatars}
            collapsed={collapsed}
            playerHandle={playerHandle}
            opponentHandle={opponentHandle}
            playerAvatarBg={playerAvatarBg}
            opponentAvatarBg={opponentAvatarBg}
            onJumpToSequence={onJumpToSequence}
            dimmed={currentPostKey != null && post.key !== currentPostKey}
            rootRef={post.key === currentPostKey ? currentPostRef : undefined}
          />,
        ];
        if (hasPrizes && !collapsed && !hideScoreCards) {
          const cum = prizeCumulative[i];
          const snap = snapshotsAtEnd[i];
          items.push(
            <ScoreCard
              key={`${post.key}-prize`}
              playerPrizes={cum.player}
              opponentPrizes={cum.opponent}
              playerName={playerHandle}
              opponentName={opponentHandle}
              playerColor={resolvedPlayerColor}
              opponentColor={resolvedOpponentColor}
              playerActiveName={snap.player}
              opponentActiveName={snap.opponent}
              playerBench={snap.playerBench}
              opponentBench={snap.opponentBench}
            />
          );
        }
        return items;
      })}
    </div>
  );
}

/* ─── Coin toss segment ──────────────────────────────────────── */

function CoinTossSegment({
  actions,
  playerHandle,
  opponentHandle,
}: {
  actions: ApiAction[];
  playerHandle: string;
  opponentHandle: string;
}) {
  const actorName = (actor: Actor) =>
    actor === "player" ? playerHandle : actor === "opponent" ? opponentHandle : "—";

  const flip = actions.find((a) => a.action_type === "coin_flip");
  const won = actions.find((a) => a.action_type === "coin_toss_won");
  const chose = actions.find((a) => a.action_type === "chose_first");

  const lines = [
    flip ? `${actorName(flip.actor)} chose ${p<string>(flip, "choice") ?? "—"}` : null,
    won ? `${actorName(won.actor)} won the coin toss` : null,
    chose
      ? `${actorName(chose.actor)} chose to go ${p<string>(chose, "order") === "first" ? "1st" : "2nd"}`
      : null,
  ].filter(Boolean) as string[];

  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col items-center gap-1 py-3 px-4">
      {lines.map((line, i) => (
        <span key={i} className="text-xs text-text-secondary font-medium">{line}</span>
      ))}
    </div>
  );
}

/* ─── Section divider ────────────────────────────────────────── */

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-5">
      <div className="flex-1 h-px bg-[#e2e8f0]" />
      <span className="text-[12.5px] font-bold uppercase tracking-widest text-text-primary">{label}</span>
      <div className="flex-1 h-px bg-[#e2e8f0]" />
    </div>
  );
}

/* ─── Thread post ─────────────────────────────────────────────── */

interface ThreadPostInput {
  kind: PostKind;
  displayName: string;
  handle: string;
  label: string;
  actions: ApiAction[];
  system?: SystemAccount;
  outcome?: "win" | "loss";
}

const WIN_GRADIENT = "linear-gradient(135deg,#F2A20C 0%,#D91E0D 50%,#A60D0D 100%)";
const LOSS_COLOR = "#1a1a1a";

/**
 * Per-density post metrics. The avatar sits at the very top of its column
 * and the name row starts at the same y, so the name only reads as centred
 * on the avatar when `nameRow`'s min-height matches the avatar's diameter.
 * Keeping the pair in one table is what makes that invariant checkable:
 * they drifted apart in the compact side panel (27px avatar against a 36px
 * row), which dropped the name ~4px and made the two look bottom-aligned.
 */
const POST_DENSITY = {
  compact: {
    avatar: "h-[27px] w-[27px] text-[11px]",
    nameRow: "min-h-[27px]",
    systemLabel: "text-[9px]",
    glyph: "w-3 h-3",
  },
  regular: {
    avatar: "h-9 w-9 text-sm",
    nameRow: "min-h-9",
    systemLabel: "text-[11px]",
    glyph: "w-4 h-4",
  },
} as const;

function ThreadPost({
  post,
  isLast,
  compactAvatars,
  collapsed,
  playerHandle,
  opponentHandle,
  playerAvatarBg,
  opponentAvatarBg,
  onJumpToSequence,
  dimmed,
  rootRef,
}: {
  post: ThreadPostInput;
  isLast: boolean;
  compactAvatars?: boolean;
  /** Collapsed thread mode — see BattleLogDetail's `collapsed` prop. Renders
   *  only the avatar (with the turn chip beneath it, when the post opens a
   *  new turn) and the connecting line, dropping the name row and action
   *  list on the right entirely. */
  collapsed?: boolean;
  playerHandle: string;
  opponentHandle: string;
  /** Mat-gradient backgrounds for the two participants' monogram avatars,
   *  when the caller wants monograms keyed to their board mat (Replay). */
  playerAvatarBg?: string;
  opponentAvatarBg?: string;
  /** Replay tool only: jump the playhead to this post's first action. */
  onJumpToSequence?: (sequence: number) => void;
  /** Playhead mode only — true once a later post has become current,
   *  fading this one out of the spotlight. */
  dimmed?: boolean;
  /** Attached only to the current post, so the parent can smoothly
   *  scrollIntoView-center it as the playhead advances. */
  rootRef?: MutableRefObject<HTMLDivElement | null>;
}) {
  const isSystem = post.kind === "system";
  // "Opponent" in a post's actions means the side opposite its author.
  const otherName =
    post.kind === "player"
      ? opponentHandle
      : post.kind === "opponent"
        ? playerHandle
        : null;
  const isResult = post.system?.handle === "game";
  const avatarStyle: CSSProperties = post.system
    ? { background: post.system.bg }
    : // A participant monogram keyed to its board mat (Replay) — takes
      // priority over the win/loss tint so each side reads as its own colour.
      post.kind === "player" && playerAvatarBg
    ? { background: playerAvatarBg }
    : post.kind === "opponent" && opponentAvatarBg
    ? { background: opponentAvatarBg }
    : post.outcome === "win"
    ? { background: WIN_GRADIENT }
    : post.outcome === "loss"
    ? { background: LOSS_COLOR }
    : { background: avatarBg(post.displayName) };
  const SystemGlyph = post.system ? ICONS[post.system.glyph] : null;
  const density = POST_DENSITY[compactAvatars ? "compact" : "regular"];
  const isTurnPost = post.label.startsWith("Turn ");

  // Clicking an avatar jumps the replay playhead to this post's first action
  // — the beginning of its turn. Available for any post with actions when the
  // caller wired onJumpToSequence (the Replay tool).
  const jumpSequence = post.actions.length
    ? Math.min(...post.actions.map((a) => a.sequence))
    : null;
  const canJump = onJumpToSequence != null && jumpSequence != null;
  const avatarInner = (
    <>
      {post.system?.label ? (
        <span className={`font-bold tracking-tight ${density.systemLabel}`}>
          {post.system.label}
        </span>
      ) : SystemGlyph ? (
        <SystemGlyph className={density.glyph} />
      ) : (
        avatarInitial(post.displayName)
      )}
      {isSystem && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#1d9bf0] ring-2 ring-bg"
          aria-label="Verified"
        >
          <svg viewBox="0 0 24 24" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-11" />
          </svg>
        </span>
      )}
    </>
  );
  const avatarBase = `relative flex shrink-0 items-center justify-center rounded-full font-bold text-white ${density.avatar}`;
  const avatarBlock = canJump ? (
    <button
      type="button"
      onClick={() => onJumpToSequence!(jumpSequence!)}
      aria-label={`Jump to ${post.label || "this moment"}`}
      className={`${avatarBase} cursor-pointer transition hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1`}
      style={avatarStyle}
    >
      {avatarInner}
    </button>
  ) : (
    <div className={avatarBase} style={avatarStyle}>
      {avatarInner}
    </div>
  );

  // Collapsed post: avatar + optional turn chip + connecting line, stacked
  // vertically in a thin column. No name row, no action list. The turn chip
  // sits under the avatar rather than opposite it since the right column is
  // gone; padding matches the expanded post's pt-3/pb-3 so a mix of
  // collapsed and expanded modes wouldn't jump the whole thread.
  if (collapsed) {
    return (
      <div
        ref={rootRef}
        className={`flex flex-col items-center gap-1.5 pt-3 transition-opacity duration-500 ease-out ${dimmed ? "opacity-40" : "opacity-100"} ${isResult ? "bg-accent/[0.06]" : ""}`}
      >
        {avatarBlock}
        {isTurnPost && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-[#1a1a1a] px-2 py-0.5 text-[9px] font-bold text-white tabular-nums">
            {post.label}
          </span>
        )}
        {!isLast ? (
          <div className="w-0.5 flex-1 min-h-[16px] bg-[#cbd5e1]" />
        ) : (
          <div className="h-3" />
        )}
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      className={`flex gap-3 pt-3 transition-opacity duration-500 ease-out ${dimmed ? "opacity-40" : "opacity-100"} ${isResult ? "bg-accent/[0.06]" : ""}`}
    >
      <div className="flex flex-col items-center self-stretch">
        {avatarBlock}
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[16px] bg-[#cbd5e1] mt-1.5" />
        )}
      </div>

      <div
        className={`flex-1 min-w-0 pb-3 ${
          isLast ? "" : "border-b border-black/[0.08] dark:border-white/10"
        }`}
      >
        <div className={`flex items-center justify-between gap-2 ${density.nameRow}`}>
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-bold text-text-primary truncate">
              {post.displayName}
            </span>
            {post.label && !post.label.startsWith("Turn ") && post.label !== "Pre-game" && (
              <>
                <span className="text-xs text-text-muted">·</span>
                <span className="text-xs text-text-muted tabular-nums">
                  {post.label}
                </span>
              </>
            )}
          </div>
          {post.label.startsWith("Turn ") && (
            <span className="shrink-0 rounded-full bg-[#1a1a1a] px-2.5 py-0.5 text-[10px] font-bold text-white tabular-nums">
              {post.label}
            </span>
          )}
        </div>

        <div className="mt-1">
          <ActionList
            actions={post.actions}
            authorName={isSystem ? null : post.displayName}
            otherName={otherName}
          />
        </div>
      </div>
    </div>
  );
}

function pokemonSpriteUrl(name: string): string {
  const slug = name
    .toLowerCase()
    // Strip possessive trainer-name prefixes ("N's ", "Giovanni's ", etc.)
    // before apostrophes are removed so the pattern still recognises them.
    .replace(/^[a-z0-9]+[''']s\s+/i, "")
    // Strip "Mega " prefix used for Mega Evolution card names.
    .replace(/^mega\s+/i, "")
    .replace(/[''.,]/g, "")
    .replace(/\s+(ex|v|vmax|vstar|gx)\b/gi, "")
    .trim()
    .replace(/\s+/g, "-");
  return `https://r2.limitlesstcg.net/pokemon/gen9/${slug}.png`;
}

function PokemonSprite({ name, size = 48 }: { name: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!name || failed) return <div style={{ width: size, height: size }} className="shrink-0" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={pokemonSpriteUrl(name)}
      alt={name}
      className="shrink-0 object-contain"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}

function ScoreCard({
  playerPrizes,
  opponentPrizes,
  playerName,
  opponentName,
  playerColor,
  opponentColor,
  playerActiveName,
  opponentActiveName,
  playerBench,
  opponentBench,
}: {
  playerPrizes: number;
  opponentPrizes: number;
  playerName: string;
  opponentName: string;
  playerColor: string;
  opponentColor: string;
  playerActiveName: string | null;
  opponentActiveName: string | null;
  playerBench: string[];
  opponentBench: string[];
}) {
  return (
    <div className="pt-2 pb-3">
      <div
        className="rounded-xl px-3 pt-3 pb-4 min-h-[120px] flex flex-col text-white opacity-80 shadow-md"
        style={{ background: `linear-gradient(to right, ${playerColor}, ${opponentColor})` }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 w-full">
          <span className="flex-1 text-[13px] font-bold leading-tight truncate">{playerName}</span>
          <div className="shrink-0 flex items-center gap-1.5">
            <span className="text-[22px] font-black tabular-nums leading-none">{playerPrizes}</span>
            <img src="/logo-light.png" alt="TCG Dexter" className="h-[21px] w-auto opacity-90" />
            <span className="text-[22px] font-black tabular-nums leading-none">{opponentPrizes}</span>
          </div>
          <span className="flex-1 text-[13px] font-bold leading-tight truncate text-right">{opponentName}</span>
        </div>
        {/* Body — sprites at XY center, bench lists centered vertically */}
        <div className="relative flex items-center flex-1 min-h-[72px] mt-2">
          <div className="flex-1 flex flex-col gap-0.5 min-w-0">
            {playerBench.map((name, i) => (
              <span key={i} className="text-[12px] font-semibold leading-tight truncate opacity-80">{name}</span>
            ))}
          </div>
          <div className="flex-1 flex flex-col gap-0.5 min-w-0 items-end">
            {opponentBench.map((name, i) => (
              <span key={i} className="text-[10px] font-semibold leading-tight truncate text-right opacity-80">{name}</span>
            ))}
          </div>
          {/* Sprites centered at the XY midpoint of the body */}
          {(() => {
            const soloSprite = (playerActiveName != null) !== (opponentActiveName != null);
            const soloName = soloSprite ? (playerActiveName ?? opponentActiveName) : null;
            return (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                {soloSprite ? (
                  <PokemonSprite name={soloName} size={53} />
                ) : (
                  <div className="flex items-end gap-2">
                    <PokemonSprite name={playerActiveName} />
                    <PokemonSprite name={opponentActiveName} />
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}


/* ─── Helpers ─────────────────────────────────────────────────── */

interface SetupGroup {
  key: string;
  actor: Actor;
  handle: string | null;
  actions: ApiAction[];
}

/**
 * Split the Setup cell's actions into one group per actor, preserving
 * encounter order (whichever side acts first appears on top). Handle
 * labels come from the battle-level player_handle / opponent_handle —
 * action rows themselves don't carry the raw handle.
 */
function groupSetupActions(
  actions: ApiAction[],
  playerHandle: string | null,
  opponentHandle: string | null,
): SetupGroup[] {
  const byKey = new Map<string, SetupGroup>();
  const order: string[] = [];

  for (const a of actions) {
    const actor: Actor = a.actor ?? null;
    const key =
      actor === "player"
        ? "player"
        : actor === "opponent"
        ? "opponent"
        : "system";
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        actor,
        handle:
          actor === "player"
            ? playerHandle
            : actor === "opponent"
            ? opponentHandle
            : null,
        actions: [],
      };
      byKey.set(key, group);
      order.push(key);
    }
    group.actions.push(a);
  }

  return order.map((k) => byKey.get(k)!);
}

type ActionCategory = "featured-ko" | "featured-prize" | "featured-mulligan" | "featured-end" | "attack" | "dim" | "normal";

function categoryFor(type: string): ActionCategory {
  switch (type) {
    case "knock_out":
      return "featured-ko";
    case "game_end":
      return "featured-end";
    case "prize_taken":
      return "featured-prize";
    case "attack":
    case "damage_dealt":
    case "damage_counter_placed":
      return "attack";
    case "coin_flip":
    case "coin_toss_won":
    case "chose_first":
    case "mulligan_total":
      return "dim";
    case "mulligan":
      return "featured-mulligan";
    default:
      return "normal";
  }
}

const ACTION_LABEL: Partial<Record<string, string>> = {
  draw: "DRAW",
  opening_hand: "DRAW",
  mulligan_bonus_draw: "DRAW",
  add_to_hand: "DRAW",
  move_to_hand: "DRAW",
  discard: "DISCARD",
  discard_from_pokemon: "DISCARD",
  play_to_active: "PLAY",
  play_to_bench: "PLAY",
  play_to_stadium: "STAD",
  evolve: "EVOLVE",
  retreat: "RETREAT",
  switch_active: "PROMOTE",
  ability_used: "ABILITY",
  attack: "ATTACK",
  damage_dealt: "ATTACK",
  damage_counter_placed: "ATTACK",
  play_supporter: "SUPP",
  play_item: "ITEM",
  play_tool: "TOOL",
  attach_energy: "ENERGY",
};

function ActionTypeLabel({ type, className }: { type: string; className?: string }) {
  const text = ACTION_LABEL[type];
  return (
    <span className={`shrink-0 w-[52px] text-[10px] font-bold tracking-wide leading-none ${className ?? ""}`}>
      {text ?? ""}
    </span>
  );
}

function ActionList({
  actions,
  authorName,
  otherName,
}: {
  actions: ApiAction[];
  authorName?: string | null;
  otherName?: string | null;
}) {
  // Pre-pair each knock_out with the nearest subsequent prize_taken, skipping
  // any intervening actions (e.g. abilities triggered mid-checkup). Each
  // prize_taken is consumed by at most one knock_out.
  const koPrizeIndex = new Map<number, number>(); // ko idx → prize idx
  const consumedPrize = new Set<number>();
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].action_type === "knock_out") {
      for (let j = i + 1; j < actions.length; j++) {
        if (actions[j].action_type === "prize_taken" && !consumedPrize.has(j)) {
          koPrizeIndex.set(i, j);
          consumedPrize.add(j);
          break;
        }
      }
    }
  }

  // When an ability causes a KO during checkup, the log records knock_out
  // before ability_used. Hoist any ability_used actions that fall between a
  // knock_out and its paired prize_taken so they render above the KO capsule.
  const koHoistedAbilities = new Map<number, number[]>(); // ko idx → ability idxes
  const hoistedAbility = new Set<number>();
  for (const [koIdx, prizeIdx] of Array.from(koPrizeIndex)) {
    const abilities: number[] = [];
    for (let j = koIdx + 1; j < prizeIdx; j++) {
      if (actions[j].action_type === "ability_used") {
        abilities.push(j);
      }
    }
    if (abilities.length > 0) {
      koHoistedAbilities.set(koIdx, abilities);
      abilities.forEach((j) => hoistedAbility.add(j));
    }
  }

  // Consolidate all mulligan actions in this turn into one pill.
  const mulliganIndices: number[] = [];
  for (let i = 0; i < actions.length; i++) {
    if (actions[i].action_type === "mulligan") mulliganIndices.push(i);
  }
  const mulliganCount = mulliganIndices.length;
  const consumedMulligan = new Set(mulliganIndices.slice(1));

  return (
    <ul className="flex flex-col gap-1">
      {actions.map((a, idx) => {
        const label = formatActionLabel(labelFor(a), { authorName, otherName });
        if (!label) return null;
        const cat = categoryFor(a.action_type);

        // Skip abilities that were hoisted to render before their KO capsule.
        if (hoistedAbility.has(idx)) return null;

        if (a.action_type === "knock_out") {
          const prizeIdx = koPrizeIndex.get(idx);
          const hoisted = koHoistedAbilities.get(idx) ?? [];
          const capsule = prizeIdx !== undefined ? (
            <li
              key={a.id}
              className="my-1.5 rounded-full px-3 py-2.5 text-xs font-bold text-white dark:text-black bg-[#1a1a1a] dark:bg-white flex items-center justify-between gap-2"
            >
              <span>{label}</span>
              <span>{labelFor(actions[prizeIdx])}</span>
            </li>
          ) : (
            <li
              key={a.id}
              className="my-1.5 rounded-full px-3 py-2.5 text-xs font-bold text-white dark:text-black text-center bg-[#1a1a1a] dark:bg-white"
            >
              {label}
            </li>
          );
          if (hoisted.length === 0) return capsule;
          return (
            <li key={a.id} className="flex flex-col gap-1">
              {hoisted.map((j) => {
                const ha = actions[j];
                const hl = labelFor(ha);
                return (
                  <div key={ha.id} className="flex items-baseline gap-2 text-sm leading-snug">
                    <ActionTypeLabel type={ha.action_type} className="text-text-muted" />
                    <span className="flex-1 min-w-0 text-text-secondary break-words">{hl}</span>
                  </div>
                );
              })}
              {capsule}
            </li>
          );
        }

        // Skip prize_taken rows that were consumed into a KO capsule above.
        if (cat === "featured-prize" && consumedPrize.has(idx)) return null;

        if (cat === "featured-mulligan") {
          if (consumedMulligan.has(idx)) return null;
          return (
            <li
              key={a.id}
              className="my-1.5 rounded-full px-3 py-2.5 text-xs font-bold text-white bg-[#1a1a1a] flex items-center justify-between gap-2"
            >
              <span>Mulligan</span>
              <span>×{mulliganCount}</span>
            </li>
          );
        }

        if (cat === "featured-end") {
          return (
            <li
              key={a.id}
              className="my-1.5 rounded-full px-3 py-2.5 text-xs font-bold text-white text-center"
              style={{ background: WIN_GRADIENT }}
            >
              {label}
            </li>
          );
        }

        if (cat === "featured-ko" || cat === "featured-prize") {
          return (
            <li
              key={a.id}
              className="my-1.5 rounded-full px-3 py-2.5 text-xs font-bold text-white text-center bg-[#1a1a1a]"
            >
              {label}
            </li>
          );
        }

        if (cat === "attack") {
          return (
            <li key={a.id} className="flex items-baseline gap-2 text-sm leading-snug">
              <ActionTypeLabel type={a.action_type} className="text-text-primary" />
              <span className="flex-1 min-w-0 font-medium text-text-primary break-words">
                {label}
              </span>
            </li>
          );
        }

        if (cat === "dim") {
          return (
            <li key={a.id} className="flex items-baseline gap-2 leading-snug">
              <ActionTypeLabel type={a.action_type} className="text-text-primary" />
              <span className="flex-1 min-w-0 text-xs text-text-muted break-words">
                {label}
              </span>
            </li>
          );
        }

        if (a.action_type === "attach_energy") {
          const energyName = p<string>(a, "energy") ?? "";
          const target = p<string>(a, "target") ?? "";
          const type = basicEnergyType(energyName);
          return (
            <li key={a.id} className="flex items-center gap-2 text-sm leading-snug">
              <ActionTypeLabel type={a.action_type} className="text-text-primary" />
              <span className="flex-1 min-w-0 text-text-secondary flex items-center gap-1.5">
                {type
                  ? <img src={`/types/${type.toLowerCase()}.png`} alt={type} className="h-4 w-4 shrink-0" />
                  : <span className="break-words">{energyName}</span>
                }
                <span>→ {target}</span>
              </span>
            </li>
          );
        }

        return (
          <li key={a.id} className="flex items-baseline gap-2 text-sm leading-snug">
            <ActionTypeLabel type={a.action_type} className="text-text-primary" />
            <span className="flex-1 min-w-0 text-text-secondary break-words">
              {label}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
