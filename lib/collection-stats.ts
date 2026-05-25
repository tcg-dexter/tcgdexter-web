import type { SupabaseClient } from "@supabase/supabase-js";
import cardData from "@/data/cards-standard.json";

interface CardDataEntry {
  set_id: string;
  number: string;
  market_price: number | null;
}

let PRICE_INDEX: Map<string, number> | null = null;

function buildPriceIndex(): Map<string, number> {
  const idx = new Map<string, number>();
  const db = cardData as unknown as Record<string, CardDataEntry[]>;
  for (const entries of Object.values(db)) {
    for (const e of entries) {
      if (e.market_price == null || e.market_price <= 0) continue;
      idx.set(`${e.set_id}|${e.number}`, e.market_price);
    }
  }
  return idx;
}

function priceIndex(): Map<string, number> {
  if (!PRICE_INDEX) PRICE_INDEX = buildPriceIndex();
  return PRICE_INDEX;
}

export interface CollectionStats {
  cardCount: number;
  marketValue: number;
}

export async function computeCollectionStats(
  supabase: SupabaseClient,
  userId: string
): Promise<CollectionStats> {
  const { data, error } = await supabase
    .from("user_card_collection")
    .select("set_id, number, quantity")
    .eq("user_id", userId);

  if (error || !data) return { cardCount: 0, marketValue: 0 };

  const prices = priceIndex();
  let cardCount = 0;
  let marketValue = 0;
  for (const row of data as Array<{ set_id: string; number: string; quantity: number }>) {
    cardCount += row.quantity;
    const price = prices.get(`${row.set_id}|${row.number}`);
    if (price) marketValue += price * row.quantity;
  }
  return { cardCount, marketValue: Math.round(marketValue * 100) / 100 };
}
