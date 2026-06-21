import cardData from "@/data/cards-standard.json";

type CardEntry = { subtypes?: string[] };

let _cache: Set<string> | null = null;

export function supporterNames(): Set<string> {
  if (_cache) return _cache;
  const raw = cardData as Record<string, CardEntry[]>;
  _cache = new Set(
    Object.entries(raw)
      .filter(([, cards]) => cards.some((c) => c.subtypes?.includes("Supporter")))
      .map(([name]) => name),
  );
  return _cache;
}
