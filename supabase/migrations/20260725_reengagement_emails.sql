-- Re-engagement emails
--
-- Foundation for retention email (streak-at-risk + near-next-badge),
-- sent by a scheduled cron via Resend. Three pieces:
--
--  1. profiles.email_reengagement — master opt-in for all re-engagement
--     email. Defaults true; the Settings toggle and the one-click
--     unsubscribe link both flip it. Every send checks it first.
--
--  2. public.reengagement_emails — a send log that doubles as the
--     idempotency guard. The unique (user_id, kind, dedup_key) caps
--     streak email to once per user per local day (dedup_key = local
--     'YYYY-MM-DD') and near-badge email to once per badge ever
--     (dedup_key = the badge key). The cron claims a row (insert ...
--     on conflict do nothing) BEFORE sending, so concurrent runs can't
--     double-send. RLS is enabled with NO policies — only the
--     service-role cron touches it; clients are denied.
--
--  3. get_activity_counts() — per-user saved-deck and match counts in one
--     round-trip, so the near-badge pass doesn't issue N queries.
--
-- Both new user-scoped objects cascade on auth.users delete, matching
-- user_streaks / user_achievements, so account deletion needs no change.

begin;

-- 1. Master opt-in (mirrors the theme_preference column pattern).
alter table public.profiles
  add column if not exists email_reengagement boolean not null default true;

-- 2. Send log + idempotency guard.
create table if not exists public.reengagement_emails (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users(id) on delete cascade,
  kind                text        not null check (kind in ('streak_at_risk', 'near_badge')),
  dedup_key           text        not null,
  sent_at             timestamptz not null default now(),
  provider_message_id text,
  unique (user_id, kind, dedup_key)
);

create index if not exists reengagement_emails_user_idx
  on public.reengagement_emails (user_id, sent_at desc);

-- RLS on, no policies: service-role cron only, clients fully denied.
alter table public.reengagement_emails enable row level security;

-- 3. Per-user activity counts for the near-badge pass.
create or replace function public.get_activity_counts()
returns table (user_id uuid, deck_count bigint, match_count bigint)
language sql
security definer
set search_path = public
as $$
  select
    p.id as user_id,
    (select count(*) from public.saved_decks sd where sd.user_id = p.id) as deck_count,
    (select count(*) from public.matches m where m.user_id = p.id) as match_count
  from public.profiles p
$$;

-- Only the service role should call this (the cron). Lock out anon/auth,
-- then grant back to service_role explicitly (the revoke from PUBLIC would
-- otherwise strip the cron's implicit access too).
revoke all on function public.get_activity_counts() from public, anon, authenticated;
grant execute on function public.get_activity_counts() to service_role;

commit;
