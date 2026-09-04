-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- After applying, run `notify pgrst, 'reload schema';`. PostgREST caches the
-- schema, so a newly-created function isn't reachable over the REST API until
-- that fires — which is exactly how collection_value_history() shipped
-- silently broken: supabase.rpc() failed, the loader logged and returned [],
-- and the chart rendered nothing. The failure is indistinguishable from an
-- empty collection, so verify with a real rpc() call, not by re-reading the
-- function definition.
--
-- Three things here:
--   1. can_view_collection() — the visibility rule, extracted so it has one
--      definition instead of a copy inlined in each aggregate.
--   2. collection_stats() — headline counts + total value, replacing an
--      app-side loop that paged EVERY collection row over the wire (2,216
--      rows across three round trips for the largest real collection) to
--      produce four numbers. Returns one row.
--   3. collection_value_history() — replaces the version in
--      20260830_collection_module.sql with one that drives from the
--      collection rather than from card_price_history. See the note on that
--      function below; this is the change that actually matters for cost.

-- The rule: the owner always; everyone else only when the profile is public
-- AND the owner opted the collection in. Both aggregates below are SECURITY
-- DEFINER over user_card_collection, which is owner-only under RLS, so they
-- can't take the caller's word for it and re-check here.
--
-- Depends on auth.uid(), which is NULL under the service-role client. That
-- makes the client choice load-bearing: read these through createAdminClient()
-- and an owner viewing their own not-yet-public collection silently reads back
-- zeroes — and since collection_public defaults to false, that's the common
-- case, not an edge case. See the header of lib/collection.ts.
create or replace function public.can_view_collection(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target = auth.uid()
      or exists (
        select 1
        from public.profiles p
        where p.id = target
          and p.is_public
          and p.collection_public
      );
$$;

comment on function public.can_view_collection(uuid) is
  'Single definition of the profile Collection module visibility rule: owner always, otherwise public profile AND collection_public. Used by collection_stats and collection_value_history.';

-- Total value is summed from card_price_history's latest priced row per card
-- rather than the bundled data/cards-standard.json index, so the tile and the
-- chart drawn beside it come from the same source and method. Note they are
-- not guaranteed bit-identical: this takes each card's own most recent priced
-- date independently, while collection_value_history groups by a shared date,
-- so on a day the price pipeline has only partly written they can differ
-- slightly. Latest-known price is the better current valuation; the two just
-- shouldn't be described as exactly equal.
--
-- A printing missing from price history contributes 0 to value but still
-- counts toward cards/unique/sets — understating the value is less visible
-- than dropping the card from the counts.
create or replace function public.collection_stats(target uuid)
returns table (
  total_cards bigint,
  unique_cards bigint,
  total_sets bigint,
  total_value numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with owned as (
    -- Collapse variant rows here: a card owned in three finishes is three
    -- rows but one printing, so this makes unique_cards a plain count(*)
    -- and gives the join below one probe per printing instead of per row.
    select
      c.set_id || '-' || c.number as card_id,
      c.set_id,
      sum(c.quantity)::bigint as qty
    from public.user_card_collection c
    where c.user_id = target
      and c.quantity > 0
      and public.can_view_collection(target)
    group by 1, 2
  )
  select
    coalesce(sum(o.qty), 0)::bigint,
    count(*)::bigint,
    count(distinct o.set_id)::bigint,
    coalesce(sum(o.qty * coalesce(l.market_price, 0)), 0)::numeric
  from owned o
  -- LATERAL rather than `distinct on (...) ... where card_id in (...)`: the
  -- latter plans as a hash semi-join over a full scan of card_price_history
  -- (~1.5M rows and growing ~20k/day), and its `order by card_id, date desc`
  -- can't be served by the (card_id, date) PK without a sort. This is one
  -- backward index seek per owned printing.
  left join lateral (
    select h.market_price
    from public.card_price_history h
    where h.card_id = o.card_id
      and h.market_price is not null
    order by h.date desc
    limit 1
  ) l on true;
$$;

comment on function public.collection_stats(uuid) is
  'Card count, distinct printings, distinct sets and total market value for a user''s collection, as one row. SECURITY DEFINER over an owner-only table; gated by can_view_collection.';

-- Replaces the original in 20260830_collection_module.sql. Same result, same
-- signature — the difference is which side the planner drives from.
--
-- The original filtered card_price_history by `date >= current_date - days`
-- and joined the result to the collection. That predicate selects essentially
-- the whole table (history only goes back ~76 days), so it scanned ~1.5M rows
-- on every profile view regardless of how few cards the user owned. Driving
-- from `owned` instead turns it into one index range scan per owned printing.
--
-- `days` is also clamped now. greatest(days, 0) had no ceiling, so a caller
-- passing 100000 would scan that user's entire history — harmless while every
-- caller is internal, but cheap amplification the moment it's wired to a
-- query param.
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
  with owned as (
    select
      c.set_id || '-' || c.number as card_id,
      sum(c.quantity)::bigint as qty
    from public.user_card_collection c
    where c.user_id = target
      and c.quantity > 0
      and public.can_view_collection(target)
    group by 1
  )
  select h.date, sum(o.qty * h.market_price)::numeric as value
  from owned o
  join public.card_price_history h
    on h.card_id = o.card_id
   and h.date >= current_date - least(greatest(days, 1), 365)
  where h.market_price is not null
  group by h.date
  order by h.date;
$$;

comment on function public.collection_value_history(uuid, integer) is
  'Daily total market value of a user''s collection over the last N days (clamped 1..365). SECURITY DEFINER over an owner-only table; gated by can_view_collection. Drives from the collection so the price table is index-sought, not scanned.';

revoke all on function public.can_view_collection(uuid) from public;
revoke all on function public.collection_stats(uuid) from public;
grant execute on function public.can_view_collection(uuid) to anon, authenticated;
grant execute on function public.collection_stats(uuid) to anon, authenticated;
