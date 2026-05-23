-- Battle log import for matches
--
-- Adds the ability to ingest a TCG Live battle log paste into a structured
-- form alongside the existing manual-entry match. The match row stays the
-- authoritative high-level record (result, opponent, played_at). Per-turn
-- and per-action structure live in match_turns / match_actions and exist
-- to power future turn-by-turn analysis and coaching.
--
-- Design notes:
-- * source distinguishes manual entries from imported logs. The current
--   POST /api/matches path keeps writing source='manual'; the new import
--   endpoint writes source='tcg_live_log' plus the import metadata.
-- * battle_log_raw is kept verbatim so the parser can be re-run as it
--   improves. parser_version records which parser produced the current
--   rows in match_turns/match_actions.
-- * Perspective is normalized at write time: actor = 'player' is always
--   the saved-deck owner, 'opponent' the other side, 'system' for events
--   like "Pokémon Checkup". The raw handles are kept on matches for
--   traceability and on each row's payload where useful.
-- * profiles.tcg_live_handle lets the import flow auto-pick the user's
--   side after a paste; if missing we ask once and offer to save it.

begin;

-- ── matches: import metadata ──────────────────────────────────
alter table public.matches
  add column if not exists source text not null default 'manual',
  add column if not exists battle_log_raw text,
  add column if not exists player_handle text,
  add column if not exists opponent_handle text,
  add column if not exists went_first boolean,
  add column if not exists player_mulligans integer,
  add column if not exists opponent_mulligans integer,
  add column if not exists total_turns integer,
  add column if not exists prizes_taken_player integer,
  add column if not exists prizes_taken_opponent integer,
  add column if not exists end_reason text,
  add column if not exists parser_version integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_source_check'
  ) then
    alter table public.matches
      add constraint matches_source_check
      check (source in ('manual', 'tcg_live_log'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'matches_end_reason_check'
  ) then
    alter table public.matches
      add constraint matches_end_reason_check
      check (
        end_reason is null
        or end_reason in ('prizes', 'no_active', 'deck_out', 'concede')
      );
  end if;
end $$;

-- ── profiles.tcg_live_handle ──────────────────────────────────
alter table public.profiles
  add column if not exists tcg_live_handle text;

-- TCG Live handles are case-sensitive in display but we treat duplicates
-- case-insensitively for the auto-detect path. No global uniqueness — two
-- different users can legitimately share a handle (rare, but possible).
create index if not exists profiles_tcg_live_handle_lower_idx
  on public.profiles (lower(tcg_live_handle))
  where tcg_live_handle is not null;

-- ── match_turns ───────────────────────────────────────────────
create table if not exists public.match_turns (
  id                   uuid        primary key default gen_random_uuid(),
  match_id             uuid        not null references public.matches(id) on delete cascade,
  user_id              uuid        not null,
  turn_number          integer     not null,
  player_turn_number   integer,
  actor                text        not null check (actor in ('player', 'opponent', 'system')),
  actor_handle         text,
  phase                text        not null check (phase in ('setup', 'turn', 'checkup', 'end')),
  created_at           timestamptz not null default now(),
  unique (match_id, turn_number)
);

create index if not exists match_turns_match_idx
  on public.match_turns (match_id, turn_number);
create index if not exists match_turns_user_idx
  on public.match_turns (user_id);

-- ── match_actions ─────────────────────────────────────────────
create table if not exists public.match_actions (
  id           uuid        primary key default gen_random_uuid(),
  match_id     uuid        not null references public.matches(id) on delete cascade,
  turn_id      uuid        references public.match_turns(id) on delete cascade,
  user_id      uuid        not null,
  sequence     integer     not null,
  actor        text        check (actor is null or actor in ('player', 'opponent', 'system')),
  action_type  text        not null,
  payload      jsonb       not null default '{}'::jsonb,
  raw_text     text,
  created_at   timestamptz not null default now(),
  unique (match_id, sequence)
);

create index if not exists match_actions_match_seq_idx
  on public.match_actions (match_id, sequence);
create index if not exists match_actions_turn_idx
  on public.match_actions (turn_id);
create index if not exists match_actions_user_idx
  on public.match_actions (user_id);
create index if not exists match_actions_type_idx
  on public.match_actions (action_type);

-- ── RLS: owner-only, mirroring matches ────────────────────────
alter table public.match_turns enable row level security;
alter table public.match_actions enable row level security;

drop policy if exists match_turns_select_own on public.match_turns;
create policy match_turns_select_own
  on public.match_turns
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists match_turns_insert_own on public.match_turns;
create policy match_turns_insert_own
  on public.match_turns
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists match_turns_update_own on public.match_turns;
create policy match_turns_update_own
  on public.match_turns
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists match_turns_delete_own on public.match_turns;
create policy match_turns_delete_own
  on public.match_turns
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists match_actions_select_own on public.match_actions;
create policy match_actions_select_own
  on public.match_actions
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists match_actions_insert_own on public.match_actions;
create policy match_actions_insert_own
  on public.match_actions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists match_actions_update_own on public.match_actions;
create policy match_actions_update_own
  on public.match_actions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists match_actions_delete_own on public.match_actions;
create policy match_actions_delete_own
  on public.match_actions
  for delete
  to authenticated
  using (auth.uid() = user_id);

commit;
