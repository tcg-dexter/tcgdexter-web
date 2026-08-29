-- Apply manually via Supabase MCP `apply_migration` — there is no CI
-- migration runner for this repo (see CLAUDE.md).
--
-- Per-printing daily price snapshot, backfilled from dexter-ops's 30-day
-- git history of data/cards-standard.json and kept fresh by daily_ops.py's
-- final pipeline step. card_id is `${set_id}-${number}` (the same
-- convention lib/cardsIndex.ts and friends already use) — note this is NOT
-- globally unique in the source data (a handful of promo/reprint sets like
-- cel25c have multiple distinct cards sharing one printing number), so a
-- tiny number of card_ids conflate more than one physical card's history.
-- Only market_price exists in cards-standard.json today; low/mid/high stay
-- null until a richer price feed is wired in.
create table public.card_price_history (
  card_id text not null,
  date date not null,
  median_price numeric,
  low_price numeric,
  mid_price numeric,
  high_price numeric,
  market_price numeric,
  created_at timestamptz default now(),
  primary key (card_id, date)
);

create index card_price_history_card_id_idx on public.card_price_history(card_id);

alter table public.card_price_history enable row level security;

create policy "public read" on public.card_price_history for select using (true);
