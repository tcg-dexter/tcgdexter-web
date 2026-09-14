-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- eBay shop listings, moved out of data/shop-listings.json.
--
-- Why: the JSON was rewritten and committed by
-- dexter-ops/scripts/export_shop_listings.py on every run, and each commit
-- cost a Vercel production build. Build CPU was 47% of the September usage
-- bill. Listings are mutable state that changes several times a day; baking
-- them into an immutable build artifact was the wrong shape for them. Card
-- metadata stays bundled — that is reference data and a hash lookup beats a
-- query for it.
--
-- Shape mirrors the JSON exactly. That file was a flat
-- Record<lookup_key, ShopListing[]> holding two key namespaces at once, so
-- one listing appears under up to three keys:
--   "iono"                 — card name (deck profiler; a deck list names
--                            cards, not printings)
--   "iono:185"             — name + printed number
--   "card:sv2a-185"        — `card:${setId}-${number}`, the exact printing
--                            (card detail pages, which state a price for one
--                            card). Only single cards get a card: key — lots
--                            and sealed product would misprice a card page.
-- Rather than invent a normalised schema the readers would have to rebuild
-- the map from, one row per (lookup_key, item_id) keeps the lookup a direct
-- indexed read and keeps the exporter's resolution logic authoritative.
--
-- Small table by design: ~400 rows. The shop stocks a few hundred cards
-- against ~20,600 printings, so most lookups miss and callers render nothing.
create table public.shop_listings (
  lookup_key    text not null,
  item_id       text not null,
  title         text not null,
  card_number   text not null,
  price         numeric not null,
  currency      text not null default 'USD',
  image_url     text,
  listing_url   text not null,
  condition     text not null,
  best_offer    boolean not null default false,
  -- Cheapest shipping option costs nothing. Nullable rather than false-by-
  -- default: entries written before the exporter captured it mean "not
  -- known free", which is not the same as "not free".
  free_shipping boolean,
  -- How the exporter tied this listing to a printing — "unique", "set code", …
  matched_by    text,
  -- Set to the run's start time on every upsert. The exporter deletes rows
  -- older than its own run to retire delisted items without ever emptying
  -- the table mid-run, which a truncate-and-insert would do.
  updated_at    timestamptz not null default now(),
  primary key (lookup_key, item_id)
);

create index shop_listings_lookup_key_idx on public.shop_listings(lookup_key);
create index shop_listings_updated_at_idx on public.shop_listings(updated_at);

alter table public.shop_listings enable row level security;

-- Public shop data, rendered on unauthenticated card and deck pages.
-- Writes are service-role only (dexter-ops), which bypasses RLS.
create policy "public read" on public.shop_listings for select using (true);
