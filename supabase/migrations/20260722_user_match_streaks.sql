-- Daily match-logging streak
--
-- Per-user activity streak: consecutive calendar days on which the user
-- logged at least one match. The habit loop — log today, keep the flame
-- alive, come back tomorrow.
--
-- "A day" is bucketed off matches.created_at (server now(), immutable),
-- NOT played_at (user-supplied / backdatable). The calendar day is
-- resolved in the user's own timezone, passed from the client at log
-- time (fallback 'UTC'), since no timezone is stored on the account.
--
-- Read/display rule (enforced in app code, not here): the current streak
-- counts as "alive" only when last_logged_date is today or yesterday in
-- the stored timezone; otherwise it displays as 0. That makes a nightly
-- reset job unnecessary — staleness resolves at read time and is
-- corrected on the next log.
--
-- Writes go exclusively through bump_match_streak() (security definer,
-- keyed off auth.uid()); there is no direct-write RLS policy. Reads are
-- public so streaks render on public profiles and can feed later
-- community surfaces.

begin;

create table if not exists public.user_streaks (
  user_id          uuid        not null primary key references auth.users(id) on delete cascade,
  current_streak   integer     not null default 0,
  longest_streak   integer     not null default 0,
  last_logged_date date,
  timezone         text        not null default 'UTC',
  updated_at       timestamptz not null default now()
);

-- RLS: public read; no direct write (the function is the only writer).
alter table public.user_streaks enable row level security;

drop policy if exists "user_streaks_authenticated_read" on public.user_streaks;
create policy "user_streaks_authenticated_read"
  on public.user_streaks for select to authenticated using (true);

drop policy if exists "user_streaks_anon_read" on public.user_streaks;
create policy "user_streaks_anon_read"
  on public.user_streaks for select to anon using (true);

-- ── bump_match_streak ──────────────────────────────────────────────────
-- Atomic (row-locked) read-modify-write of the caller's streak. Keyed off
-- auth.uid() so a user can never bump another account's streak. Returns
-- the resulting current/longest and whether this call changed anything
-- (so the client can pick celebration copy).
create or replace function public.bump_match_streak(p_local_date date, p_tz text)
returns table (out_current integer, out_longest integer, out_changed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user    uuid := auth.uid();
  v_last    date;
  v_current integer;
  v_longest integer;
  v_changed boolean := false;
  v_tz      text := coalesce(nullif(p_tz, ''), 'UTC');
begin
  if v_user is null then
    return;  -- unauthenticated: emit no row
  end if;

  select last_logged_date, current_streak, longest_streak
    into v_last, v_current, v_longest
    from public.user_streaks
    where user_id = v_user
    for update;

  if not found then
    v_current := 1; v_longest := 1; v_changed := true;
    insert into public.user_streaks (user_id, current_streak, longest_streak, last_logged_date, timezone, updated_at)
      values (v_user, 1, 1, p_local_date, v_tz, now());
  elsif v_last = p_local_date then
    -- already logged today — no streak change
    v_changed := false;
  elsif v_last = p_local_date - 1 then
    v_current := v_current + 1;
    v_longest := greatest(v_longest, v_current);
    v_changed := true;
    update public.user_streaks
      set current_streak = v_current, longest_streak = v_longest,
          last_logged_date = p_local_date, timezone = v_tz, updated_at = now()
      where user_id = v_user;
  elsif v_last < p_local_date - 1 then
    -- gap: streak broken, restart at today
    v_current := 1;
    v_longest := greatest(v_longest, 1);
    v_changed := true;
    update public.user_streaks
      set current_streak = 1, longest_streak = v_longest,
          last_logged_date = p_local_date, timezone = v_tz, updated_at = now()
      where user_id = v_user;
  else
    -- v_last > p_local_date: backdated client date / clock skew — no-op guard
    v_changed := false;
  end if;

  return query select v_current, v_longest, v_changed;
end;
$$;

grant execute on function public.bump_match_streak(date, text) to authenticated;

-- ── Backfill ───────────────────────────────────────────────────────────
-- Seed every existing user from their match history so nobody starts at
-- zero. Uses UTC day boundaries for history (no per-match timezone exists
-- retroactively); going forward the function uses the client timezone.
-- Classic gaps-and-islands: consecutive dates share (d - row_number()).
insert into public.user_streaks (user_id, current_streak, longest_streak, last_logged_date, timezone, updated_at)
select user_id, trailing_len, longest_len, last_day, 'UTC', now()
from (
  with days as (
    select distinct user_id, (created_at at time zone 'UTC')::date as d
    from public.matches
    where user_id is not null
  ),
  grp as (
    select user_id, d,
           d - (row_number() over (partition by user_id order by d))::integer as island
    from days
  ),
  runs as (
    select user_id, island, count(*)::integer as run_len, max(d) as run_end
    from grp
    group by user_id, island
  )
  select user_id,
         max(run_len)                                          as longest_len,
         (array_agg(run_len order by run_end desc))[1]         as trailing_len,
         max(run_end)                                          as last_day
  from runs
  group by user_id
) seed
on conflict (user_id) do nothing;

commit;
