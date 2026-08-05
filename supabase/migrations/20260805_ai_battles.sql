-- ai_battles: one row per completed AI Player game.
--
-- Applied manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner (see CLAUDE.md).
--
-- Purpose, in order of what it has to serve:
--   1. Debugging. "Retreat wasn't offered" and "Trade only worked once" were
--      both reported from memory, and reproducing them cost more than fixing
--      them. `transcript` replays the exact game; `battle_log` reads like a
--      TCG Live log so a bug can be discussed by pointing at a line.
--   2. The ML pipeline. `battle_log` is written in the SAME format
--      lib/battle-log/parse.ts already parses, so these rows flow through
--      the existing parser → replay → feature extraction with no new ingest
--      path. Enforced by lib/engine/sim/battleLog.test.ts, which parses
--      emitted logs and fails on any unrecognised line.
--
--      NOT YET WIRED: scripts/ml/extract.ts reads `matches` out of the
--      exported feature_store.sqlite. Feeding these rows in is a column
--      mapping, deliberately left until there are games to feed:
--        ai_battles.battle_log          -> matches.battle_log_raw
--        transcript->'handles'->>'player' -> matches.player_handle
--        winner = 'user'                -> result 'win' / 'loss'
--        turns, prizes_user/ai, user_went_first -> the same columns
--      Filter on sim_version first; rows from older engines are not
--      comparable with newer ones.
--
-- Design notes:
-- * transcript is the ENGINE's source of truth ({seed, decks, skill,
--   moves[]}) and battle_log is a rendering of it. Both are stored: the
--   transcript is replayable only while sim_version matches, and the log
--   stays readable forever. sim_version records which engine produced them.
-- * Deck lists are stored verbatim rather than by reference. A saved deck
--   can be edited or deleted afterwards, and a log whose deck no longer
--   matches the game it describes is worse than no log.
-- * No foreign key to saved_decks for the same reason; saved_deck_id is a
--   soft pointer, nullable, kept for grouping only.
-- * RLS is owner-only, mirroring matches/match_turns. Admin/ML reads go
--   through the service-role client, which bypasses RLS.

begin;

create table if not exists public.ai_battles (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  played_at       timestamptz not null default now(),

  -- The two lists, verbatim as played.
  user_deck_list  text        not null,
  ai_deck_list    text        not null,
  -- Soft pointer for grouping ("all my games with this deck"). Deliberately
  -- not a foreign key: the deck may be edited or deleted later, and the log
  -- must keep describing the game that was actually played.
  saved_deck_id   uuid,
  user_deck_name  text,
  ai_deck_name    text,

  -- TCG Live-format log. The interoperability surface.
  battle_log      text        not null,
  -- {seed, decks, skill, moves[]} — replays the exact game while
  -- sim_version matches the running engine.
  transcript      jsonb       not null,
  -- The game's identity in the stateless design: /api/play replays the
  -- transcript on every request, so the same finished game can be submitted
  -- more than once. Upserting on (user_id, seed) makes the write idempotent
  -- instead of accumulating duplicates. Two games deliberately started with
  -- the SAME explicit seed collide, and the later one wins — an admin-tool
  -- scenario, and same seed + same decks is the same game anyway.
  seed            bigint      not null,

  -- Outcome, denormalised so the common queries need no parsing.
  winner          text        check (winner is null or winner in ('user', 'ai')),
  end_reason      text        check (
                    end_reason is null
                    or end_reason in ('prizes', 'no_active', 'deck_out', 'turn_cap')
                  ),
  turns           integer,
  prizes_user     integer,
  prizes_ai       integer,
  user_went_first boolean,

  -- Provenance: which engine and which bot produced this game. Without
  -- these a row cannot be compared with another, and the ML pipeline
  -- cannot filter a training set to one engine version.
  sim_version     integer     not null,
  skill           real,
  model_version   text,

  created_at      timestamptz not null default now(),

  -- FULL unique index, not partial: supabase-js `.upsert({ onConflict })`
  -- cannot infer a partial one and fails with 42P10 (see CLAUDE.md).
  constraint ai_battles_user_seed_key unique (user_id, seed)
);

create index if not exists ai_battles_user_played_idx
  on public.ai_battles (user_id, played_at desc);
-- The ML export filters by engine version before anything else: rows from
-- an older sim are not comparable and must be excluded cheaply.
create index if not exists ai_battles_sim_version_idx
  on public.ai_battles (sim_version, played_at desc);
create index if not exists ai_battles_saved_deck_idx
  on public.ai_battles (saved_deck_id)
  where saved_deck_id is not null;

alter table public.ai_battles enable row level security;

drop policy if exists ai_battles_select_own on public.ai_battles;
create policy ai_battles_select_own
  on public.ai_battles for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists ai_battles_insert_own on public.ai_battles;
create policy ai_battles_insert_own
  on public.ai_battles for insert to authenticated
  with check (auth.uid() = user_id);

-- No UPDATE policy: a played game is a historical record, and a log that can
-- be rewritten by its subject is not evidence. The idempotent upsert on
-- (user_id, seed) therefore runs through the SERVICE-ROLE client, which
-- bypasses RLS — the route has already authenticated the user, so user_id is
-- server-derived rather than client-supplied.
drop policy if exists ai_battles_delete_own on public.ai_battles;
create policy ai_battles_delete_own
  on public.ai_battles for delete to authenticated
  using (auth.uid() = user_id);

comment on table public.ai_battles is
  'One row per completed AI Player game. battle_log is TCG Live format (see lib/engine/sim/battleLog.ts); transcript replays the game while sim_version matches. Owner-only RLS.';

commit;
