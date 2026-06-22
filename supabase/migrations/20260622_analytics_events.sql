-- Foundational behavioral analytics: an append-only event log written from
-- the API routes via lib/analytics/track.ts, plus helper views to support
-- the activation funnel and feature adoption dashboard views.
--
-- Server-only by design: RLS denies all reads/writes from anon/authenticated.
-- Inserts happen via the service-role admin client (createAdminClient()).

create table if not exists public.analytics_events (
  id            uuid primary key default gen_random_uuid(),
  occurred_at   timestamptz not null default now(),
  -- Identity columns are all nullable. A single row can carry any combination:
  -- anonymous_id alone (first-touch pre-signup), user_id + anonymous_id
  -- (signed-in user whose anon cookie is still around — lets us stitch
  -- pre-signup behavior to a known user post-hoc), or user_id alone (server
  -- event with no request cookies, e.g. a future background job).
  user_id       uuid references auth.users(id) on delete set null,
  anonymous_id  text,
  session_id    text,
  event_name    text not null,
  properties    jsonb not null default '{}'::jsonb,
  path          text,
  referrer      text,
  locale        text,
  user_agent    text,
  -- sha256(ip || daily_salt). Never store raw IP. Daily salt rotation is
  -- enough to defeat cross-day re-identification while still letting us
  -- spot abuse bursts within a day. The salt itself lives in an env var.
  ip_hash       text
);

create index if not exists analytics_events_occurred_at_idx
  on public.analytics_events (occurred_at desc);

create index if not exists analytics_events_user_id_occurred_at_idx
  on public.analytics_events (user_id, occurred_at desc)
  where user_id is not null;

create index if not exists analytics_events_anonymous_id_occurred_at_idx
  on public.analytics_events (anonymous_id, occurred_at desc)
  where anonymous_id is not null;

create index if not exists analytics_events_event_name_occurred_at_idx
  on public.analytics_events (event_name, occurred_at desc);

create index if not exists analytics_events_session_id_idx
  on public.analytics_events (session_id)
  where session_id is not null;

alter table public.analytics_events enable row level security;
-- No policies = no access for anon or authenticated roles. The service-role
-- key used by createAdminClient() bypasses RLS, so server-side writes still
-- work. This mirrors the analysis_submissions table.

-- ── Backfill from existing product tables ───────────────────────────────
-- One-shot, idempotent via WHERE NOT EXISTS check on (event_name, user_id,
-- occurred_at). Gives day-one dashboards a real history instead of an
-- empty funnel.

insert into public.analytics_events (occurred_at, user_id, event_name, properties)
select p.created_at, p.id, 'auth.signed_up', jsonb_build_object('backfilled', true)
from public.profiles p
where not exists (
  select 1 from public.analytics_events e
  where e.event_name = 'auth.signed_up'
    and e.user_id = p.id
);

insert into public.analytics_events (occurred_at, user_id, event_name, properties)
select s.created_at, s.user_id, 'analyze.completed',
       jsonb_build_object(
         'backfilled', true,
         'deck_size', coalesce((s.analysis_summary->>'deckSize')::int, null),
         'archetype', s.analysis_summary->'metaMatch'->>'archetypeName'
       )
from public.analysis_submissions s
where s.user_id is not null
  and not exists (
    select 1 from public.analytics_events e
    where e.event_name = 'analyze.completed'
      and e.user_id = s.user_id
      and e.occurred_at = s.created_at
  );

-- Anonymous analyses too — they're useful for the anonymous→signup funnel
-- (sets a floor for how many anon visitors actually engaged with the core
-- feature before deciding whether to sign up).
insert into public.analytics_events (occurred_at, user_id, event_name, properties)
select s.created_at, null, 'analyze.completed',
       jsonb_build_object(
         'backfilled', true,
         'anonymous', true,
         'deck_size', coalesce((s.analysis_summary->>'deckSize')::int, null)
       )
from public.analysis_submissions s
where s.user_id is null;

insert into public.analytics_events (occurred_at, user_id, event_name, properties)
select d.created_at, d.user_id, 'deck.saved',
       jsonb_build_object('backfilled', true, 'is_public', d.is_public)
from public.saved_decks d
where not exists (
  select 1 from public.analytics_events e
  where e.event_name = 'deck.saved'
    and e.user_id = d.user_id
    and e.occurred_at = d.created_at
);

insert into public.analytics_events (occurred_at, user_id, event_name, properties)
select m.created_at, m.user_id, 'match.logged',
       jsonb_build_object('backfilled', true, 'result', m.result)
from public.matches m
where not exists (
  select 1 from public.analytics_events e
  where e.event_name = 'match.logged'
    and e.user_id = m.user_id
    and e.occurred_at = m.created_at
);

-- ── Helper view: first-event timestamp per (user_id, event_name) ────────
-- The activation funnel and "time to first X" queries are O(rows) without
-- this; the view lets the dashboard join against a tiny aggregate instead
-- of scanning the whole events table on every page load.
create or replace view public.analytics_user_first_events as
select
  user_id,
  event_name,
  min(occurred_at) as first_at
from public.analytics_events
where user_id is not null
group by user_id, event_name;

-- ── Helper function: activation funnel for a signup-window cohort ───────
-- Returns one row per funnel step with absolute count and median
-- time-to-step (seconds from signup). Used by fetchActivation() in the
-- dashboard data layer.
create or replace function public.analytics_activation_funnel(
  cohort_days int default null  -- null = all time
)
returns table (
  step       text,
  step_order int,
  user_count bigint,
  median_seconds_from_signup numeric
)
language sql
stable
as $$
  with cohort as (
    select p.id as user_id, p.created_at as signed_up_at
    from public.profiles p
    where cohort_days is null
       or p.created_at >= now() - make_interval(days => cohort_days)
  ),
  steps as (
    select 'signup'::text as step, 1 as step_order, c.user_id, c.signed_up_at as at
    from cohort c
    union all
    select 'analyze.completed', 2, c.user_id, fe.first_at
    from cohort c
    join public.analytics_user_first_events fe
      on fe.user_id = c.user_id and fe.event_name = 'analyze.completed'
    union all
    select 'deck.saved', 3, c.user_id, fe.first_at
    from cohort c
    join public.analytics_user_first_events fe
      on fe.user_id = c.user_id and fe.event_name = 'deck.saved'
    union all
    select 'match.logged', 4, c.user_id, fe.first_at
    from cohort c
    join public.analytics_user_first_events fe
      on fe.user_id = c.user_id and fe.event_name = 'match.logged'
  )
  select
    s.step,
    s.step_order,
    count(distinct s.user_id) as user_count,
    percentile_cont(0.5) within group (
      order by extract(epoch from (s.at - c.signed_up_at))
    ) as median_seconds_from_signup
  from steps s
  join cohort c on c.user_id = s.user_id
  group by s.step, s.step_order
  order by s.step_order;
$$;

-- ── Helper function: feature adoption among recently-active users ───────
-- For users with any event in the last `window_days`, returns each event
-- type's distinct-user count. Drives the Behavior view's adoption list.
create or replace function public.analytics_feature_adoption(
  window_days int default 7
)
returns table (
  event_name      text,
  user_count      bigint,
  active_total    bigint
)
language sql
stable
as $$
  with active as (
    select distinct user_id
    from public.analytics_events
    where user_id is not null
      and occurred_at >= now() - make_interval(days => window_days)
  ),
  total as (select count(*)::bigint as n from active)
  select
    e.event_name,
    count(distinct e.user_id) as user_count,
    (select n from total) as active_total
  from public.analytics_events e
  join active a on a.user_id = e.user_id
  where e.occurred_at >= now() - make_interval(days => window_days)
  group by e.event_name
  order by user_count desc;
$$;
