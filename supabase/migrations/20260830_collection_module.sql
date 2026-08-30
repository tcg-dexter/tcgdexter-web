-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- Backs the Collection module at the bottom of user profile pages.
--
-- Two pieces:
--   1. profiles.collection_public — the owner's opt-in for showing that
--      module to visitors. Separate from profiles.is_public: a public
--      profile does NOT imply a public collection, since what someone owns
--      (and what it's worth) is a different disclosure from which decks
--      they've built. Defaults to false, so nothing becomes visible until
--      it's deliberately switched on.
--   2. collection_value_history() — the aggregate value-over-time series
--      behind the module's chart.

alter table public.profiles
  add column if not exists collection_public boolean not null default false;

comment on column public.profiles.collection_public is
  'Owner opt-in for showing the profile Collection module (stats + value chart) to visitors. Requires is_public too — a private profile hides it regardless.';

-- Aggregate collection value per day.
--
-- Done in SQL rather than in the app because the app-side shape of this is
-- one row per owned printing per day: a 500-card collection over 90 days is
-- ~45k rows over the wire just to sum them. This returns one row per day.
--
-- SECURITY DEFINER so it can read user_card_collection, which is owner-only
-- under RLS (user_card_collection_owner_select). The visibility rule is
-- enforced *inside* the function instead — owner always, everyone else only
-- when the profile is public AND collection_public is on — so the elevated
-- read can't be used to page through a stranger's private collection. Note
-- the rule is re-checked here rather than trusted from the caller; callers
-- pass only a target user id.
--
-- Join key: card_price_history.card_id is normally '{set_id}-{number}'. A
-- handful of sets (e.g. cel25c) share one printed number across distinct
-- cards and the price-history writer disambiguates those with a name slug
-- (see priceHistoryCardId in lib/priceHistory.ts). Those few printings
-- simply don't match here and are omitted from the aggregate — replicating
-- the slug in SQL would mean carrying a copy of the card name table, and
-- the omission is immaterial at aggregate scale.
create or replace function public.collection_value_history(
  target uuid,
  days integer default 90
)
returns table (date date, value numeric)
language sql
stable
security definer
set search_path = public
as $$
  select h.date, sum(c.quantity * h.market_price)::numeric as value
  from public.user_card_collection c
  join public.card_price_history h
    on h.card_id = c.set_id || '-' || c.number
  where c.user_id = target
    and c.quantity > 0
    and h.market_price is not null
    and h.date >= (current_date - greatest(days, 0))
    and (
      target = auth.uid()
      or exists (
        select 1
        from public.profiles p
        where p.id = target
          and p.is_public
          and p.collection_public
      )
    )
  group by h.date
  order by h.date;
$$;

comment on function public.collection_value_history(uuid, integer) is
  'Daily total market value of a user''s collection over the last N days. SECURITY DEFINER: enforces owner-or-(public profile AND collection_public) internally, since user_card_collection is owner-only under RLS.';

revoke all on function public.collection_value_history(uuid, integer) from public;
grant execute on function public.collection_value_history(uuid, integer) to anon, authenticated;
