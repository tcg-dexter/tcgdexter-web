import { getAllCards } from "./cardsIndex";
import { createClient } from "./supabase/server";

/**
 * card_price_history.card_id is normally `{setId}-{number}` (see
 * dexter-ops/scripts/backfill_price_history.py, the writer of this table).
 * A handful of sets — e.g. cel25c, Celebrations: Classic Collection's 4-in-1
 * oversized promos — share one printed number across multiple distinct
 * cards, so the writer disambiguates those with a slug of the card name.
 * Mirror that exact rule here so lookups land on the right row.
 */
function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function priceHistoryCardId(
  setId: string,
  number: string,
  name: string
): string {
  const base = `${setId}-${number}`;
  const sharesNumber = getAllCards().some(
    (c) => c.setId === setId && c.number === number && c.name !== name
  );
  return sharesNumber ? `${base}-${slug(name)}` : base;
}

export interface PricePoint {
  date: string;
  price: number;
}

/** Last 90 days of market price for one printing, ascending by date. */
export async function getCardPriceHistory(
  setId: string,
  number: string,
  name: string
): Promise<PricePoint[]> {
  const cardId = priceHistoryCardId(setId, number, name);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 90);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("card_price_history")
    .select("date, market_price")
    .eq("card_id", cardId)
    .not("market_price", "is", null)
    .gte("date", since.toISOString().slice(0, 10))
    .order("date", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    date: row.date as string,
    price: Number(row.market_price),
  }));
}
