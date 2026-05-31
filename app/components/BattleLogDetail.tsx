"use client";

import { useEffect, useState, type CSSProperties, type SVGProps } from "react";

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
}

const SYSTEM_ACCOUNTS: Record<"setup" | "checkup" | "game", SystemAccount> = {
  setup: { displayName: "Setup", handle: "setup", glyph: "shuffle", bg: "#475569" },
  checkup: { displayName: "Pokémon Checkup", handle: "checkup", glyph: "droplet", bg: "#7c3aed" },
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
  matchId: string;
  apiUrl?: string;
}

export default function BattleLogDetail({ matchId, apiUrl }: Props) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(apiUrl ?? `/api/matches/${matchId}/battle-log`)
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
  const playerHandle = data.match.player_handle ?? "You";
  const opponentHandle = data.match.opponent_handle ?? "Opponent";

  // Find the winning side so we can color the player/opponent
  // avatars with the site's win gradient vs solid black for the
  // loser. The match record carries `result` ("win" | "loss" |
  // "draw") from the player's perspective — preferred over the
  // game_end action, which isn't stored for every match.
  const winnerActor: "player" | "opponent" | null =
    data.match.result === "win"
      ? "player"
      : data.match.result === "loss"
      ? "opponent"
      : null;
  const matchHasEnded = winnerActor != null;

  interface Post {
    key: string;
    kind: PostKind;
    displayName: string;
    handle: string;
    label: string;
    actions: ApiAction[];
    system?: SystemAccount;
    replyTo?: string;
    outcome?: "win" | "loss";
  }

  function outcomeFor(actor: "player" | "opponent"): "win" | "loss" | undefined {
    if (!matchHasEnded || !winnerActor) return undefined;
    return actor === winnerActor ? "win" : "loss";
  }

  const posts: Post[] = [];

  function pushReplyTarget(forKind: PostKind, forDisplay: string): string | undefined {
    // Walk backwards through the existing posts to find the last
    // "real" player post (skip system broadcasts and self-replies).
    for (let i = posts.length - 1; i >= 0; i--) {
      const prev = posts[i];
      if (prev.kind === "system") continue;
      if (prev.displayName === forDisplay) return undefined;
      return prev.displayName;
    }
    return forKind === "player" ? opponentHandle : playerHandle;
  }

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
      const replyTo = pushReplyTarget(kind, display);
      posts.push({
        key: turn.id,
        kind,
        displayName: display,
        handle: handleSlug(display),
        label: globalTurnNumber != null ? `Turn ${globalTurnNumber}` : "",
        actions,
        replyTo,
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

  return (
    <div className="mt-3 flex flex-col rounded-lg bg-bg overflow-hidden">
      {posts.map((post, i) => (
        <ThreadPost
          key={post.key}
          post={post}
          isLast={i === posts.length - 1}
        />
      ))}
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
  replyTo?: string;
  outcome?: "win" | "loss";
}

const WIN_GRADIENT = "linear-gradient(135deg,#F2A20C 0%,#D91E0D 50%,#A60D0D 100%)";
const LOSS_COLOR = "#1a1a1a";

function ThreadPost({ post, isLast }: { post: ThreadPostInput; isLast: boolean }) {
  const isSystem = post.kind === "system";
  const isResult = post.system?.handle === "game";
  const stats = statsFor(post.actions);
  const avatarStyle: CSSProperties = post.system
    ? { background: post.system.bg }
    : post.outcome === "win"
    ? { background: WIN_GRADIENT }
    : post.outcome === "loss"
    ? { background: LOSS_COLOR }
    : { background: avatarBg(post.displayName) };
  const SystemGlyph = post.system ? ICONS[post.system.glyph] : null;

  return (
    <div
      className={`flex gap-3 px-3 pt-3 ${isResult ? "bg-accent/[0.06]" : ""}`}
    >
      <div className="flex flex-col items-center self-stretch">
        <div
          className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
          style={avatarStyle}
        >
          {SystemGlyph ? (
            <SystemGlyph className="w-4 h-4" />
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
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[16px] bg-[#cbd5e1] mt-1.5" />
        )}
      </div>

      <div
        className={`flex-1 min-w-0 pb-3 ${
          isLast ? "" : "border-b border-[#e2e8f0]"
        }`}
      >
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="text-sm font-bold text-text-primary truncate">
            {post.displayName}
          </span>
          <span className="text-xs text-text-muted truncate">
            @{post.handle}
          </span>
          {post.label && (
            <>
              <span className="text-xs text-text-muted">·</span>
              <span className="text-xs text-text-muted tabular-nums">
                {post.label}
              </span>
            </>
          )}
        </div>

        {post.replyTo && (
          <div className="mb-1 text-[11px] text-text-muted">
            Replying to{" "}
            <span className="text-[#1d9bf0]">@{handleSlug(post.replyTo)}</span>
          </div>
        )}

        <div className="mt-1">
          <ActionList actions={post.actions} />
        </div>

        {!isResult && (stats.drew + stats.damage + stats.ko + stats.prizes > 0) && (
          <PostStatsRow stats={stats} />
        )}
      </div>
    </div>
  );
}

function PostStatsRow({ stats }: { stats: PostStats }) {
  const items: { icon: IconKey; n: number; title: string }[] = [];
  if (stats.drew > 0) items.push({ icon: "hand", n: stats.drew, title: "Cards drawn" });
  if (stats.damage > 0) items.push({ icon: "impact", n: stats.damage, title: "Damage dealt" });
  if (stats.ko > 0) items.push({ icon: "skull", n: stats.ko, title: "Knock-outs" });
  if (stats.prizes > 0) items.push({ icon: "trophy", n: stats.prizes, title: "Prizes taken" });
  return (
    <div className="mt-2 flex items-center gap-4 text-[11px] text-text-muted">
      {items.map(({ icon, n, title }) => {
        const Cmp = ICONS[icon];
        return (
          <span key={icon} className="flex items-center gap-1 tabular-nums" title={title}>
            <Cmp className="w-3 h-3" />
            {n}
          </span>
        );
      })}
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
 * labels come from the match-level player_handle / opponent_handle —
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

function ActionList({ actions }: { actions: ApiAction[] }) {
  return (
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
  );
}
