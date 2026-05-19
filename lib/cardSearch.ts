import { getAllCards, getSets, type CardIndexEntry } from "@/lib/cardsIndex";

export type SortKey = "released" | "name" | "number" | "hp" | "price" | "rarity";

// Approximate ranking of pokemontcg.io rarity strings — higher = scarcer.
// Unknown rarities get rank -1 so they sort to the end of a desc list.
const RARITY_RANK: Record<string, number> = {
  "Common": 1,
  "Uncommon": 2,
  "Promo": 3,
  "Rare": 4,
  "Classic Collection": 4,
  "Rare Holo": 5,
  "Rare BREAK": 5,
  "Rare Prime": 6,
  "Rare ACE": 6,
  "ACE SPEC Rare": 6,
  "Rare Holo LV.X": 6,
  "LEGEND": 7,
  "Rare Holo EX": 7,
  "Rare Holo GX": 7,
  "Rare Holo V": 7,
  "Rare Holo VMAX": 8,
  "Rare Holo VSTAR": 8,
  "Double Rare": 7,
  "Ultra Rare": 8,
  "Rare Ultra": 8,
  "Rare Shining": 9,
  "Shiny Rare": 9,
  "Rare Shiny": 9,
  "Rare Shiny GX": 10,
  "Rare Prism Star": 8,
  "Amazing Rare": 9,
  "Radiant Rare": 9,
  "Trainer Gallery Rare Holo": 9,
  "Illustration Rare": 10,
  "Special Illustration Rare": 11,
  "Hyper Rare": 12,
  "Rare Secret": 12,
  "Rare Rainbow": 12,
  "Rare Holo Star": 11,
};

function rarityRank(r: string | null): number {
  if (!r) return -1;
  return RARITY_RANK[r] ?? -1;
}
export type SortDir = "asc" | "desc";

export interface CardSearchParams {
  q?: string;
  supertype?: string[];
  type?: string[];
  subtype?: string[];
  regulation?: string[];
  setId?: string[];
  hpMin?: number;
  hpMax?: number;
  priceMin?: number;
  priceMax?: number;
  sort?: SortKey;
  dir?: SortDir;
  page?: number;
  pageSize?: number;
}

export interface CardSearchResult {
  cards: CardIndexEntry[];
  total: number;
  page: number;
  pageSize: number;
}

function parseQueryTokens(q: string): { numeric: string[]; setCodes: Set<string>; words: string[] } {
  const tokens = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const knownCodes = new Set(
    getSets()
      .map((s) => s.ptcgoCode?.toLowerCase())
      .filter((c): c is string => !!c)
  );
  const numeric: string[] = [];
  const setCodes = new Set<string>();
  const words: string[] = [];
  for (const t of tokens) {
    if (/^\d+(\/\d+)?$/.test(t)) {
      numeric.push(t.split("/")[0]);
    } else if (knownCodes.has(t)) {
      setCodes.add(t);
    } else {
      words.push(t);
    }
  }
  return { numeric, setCodes, words };
}

interface ScoredCard {
  card: CardIndexEntry;
  score: number;
}

function matchAndScore(
  card: CardIndexEntry,
  query: ReturnType<typeof parseQueryTokens>
): number | null {
  let score = 0;

  if (query.setCodes.size > 0) {
    const code = card.ptcgoCode?.toLowerCase();
    if (!code || !query.setCodes.has(code)) return null;
    score += 5;
  }

  if (query.numeric.length > 0) {
    for (const n of query.numeric) {
      const padded = n.padStart(3, "0");
      if (card.number === n || card.numberPadded === padded) {
        score += 20;
      } else if (card.number.startsWith(n) || card.numberPadded.startsWith(padded)) {
        score += 8;
      } else {
        return null;
      }
    }
  }

  if (query.words.length > 0) {
    for (const w of query.words) {
      let tokenScore = 0;
      if (card.nameLower === w) {
        tokenScore = 50;
      } else if (card.nameLower.startsWith(w)) {
        tokenScore = 30;
      } else if (card.nameTokens.some((tok) => tok === w)) {
        tokenScore = 25;
      } else if (card.nameTokens.some((tok) => tok.startsWith(w))) {
        tokenScore = 15;
      } else if (card.nameLower.includes(w)) {
        tokenScore = 5;
      } else if (card.artistTokens.some((tok) => tok === w)) {
        tokenScore = 12;
      } else if (card.artistTokens.some((tok) => tok.startsWith(w))) {
        tokenScore = 8;
      } else if (card.artistLower?.includes(w)) {
        tokenScore = 4;
      } else {
        return null;
      }
      score += tokenScore;
    }
  }

  return score;
}

function applyFilters(card: CardIndexEntry, p: CardSearchParams): boolean {
  if (p.supertype?.length && !p.supertype.includes(card.supertype)) return false;
  if (p.type?.length && !card.types.some((t) => p.type!.includes(t))) return false;
  if (p.subtype?.length && !card.subtypes.some((s) => p.subtype!.includes(s))) return false;
  if (p.regulation?.length) {
    if (!card.regulationMark || !p.regulation.includes(card.regulationMark)) return false;
  }
  if (p.setId?.length && !p.setId.includes(card.setId)) return false;
  if (p.hpMin != null && (card.hp == null || card.hp < p.hpMin)) return false;
  if (p.hpMax != null && (card.hp == null || card.hp > p.hpMax)) return false;
  if (p.priceMin != null && card.marketPrice < p.priceMin) return false;
  if (p.priceMax != null && card.marketPrice > p.priceMax) return false;
  return true;
}

function compareNumber(a: CardIndexEntry, b: CardIndexEntry): number {
  return (
    (a.numberNumeric ?? Number.MAX_SAFE_INTEGER) -
      (b.numberNumeric ?? Number.MAX_SAFE_INTEGER) ||
    a.number.localeCompare(b.number)
  );
}

function compareCards(a: CardIndexEntry, b: CardIndexEntry, sort: SortKey, dir: SortDir): number {
  const mult = dir === "desc" ? -1 : 1;
  switch (sort) {
    case "released":
      // Primary: set release date (desc by default → newest first).
      // Secondary: set id (stable tie-break for same-day releases).
      // Tertiary: card number ascending — always low→high within a set.
      return (
        mult * a.setReleaseDate.localeCompare(b.setReleaseDate) ||
        mult * a.setId.localeCompare(b.setId) ||
        compareNumber(a, b)
      );
    case "hp":
      return mult * ((a.hp ?? -1) - (b.hp ?? -1)) || a.name.localeCompare(b.name);
    case "price":
      return mult * (a.marketPrice - b.marketPrice) || a.name.localeCompare(b.name);
    case "rarity": {
      const ra = rarityRank(a.rarity);
      const rb = rarityRank(b.rarity);
      // Unknown rarities (rank -1) always sort to the end, regardless of dir.
      if (ra === -1 && rb !== -1) return 1;
      if (rb === -1 && ra !== -1) return -1;
      return mult * (ra - rb) || a.name.localeCompare(b.name);
    }
    case "number":
      return mult * compareNumber(a, b) || a.setName.localeCompare(b.setName);
    case "name":
    default:
      return mult * a.name.localeCompare(b.name) || a.setName.localeCompare(b.setName);
  }
}

export function searchCards(params: CardSearchParams): CardSearchResult {
  const all = getAllCards();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(240, Math.max(12, params.pageSize ?? 120));
  const sort: SortKey = params.sort ?? "released";
  const dir: SortDir = params.dir ?? (params.sort === "name" ? "asc" : "desc");
  const q = params.q?.trim();

  let filtered: ScoredCard[];

  if (q) {
    const tokens = parseQueryTokens(q);
    if (tokens.numeric.length === 0 && tokens.setCodes.size === 0 && tokens.words.length === 0) {
      filtered = all.filter((c) => applyFilters(c, params)).map((c) => ({ card: c, score: 0 }));
    } else {
      filtered = [];
      for (const c of all) {
        if (!applyFilters(c, params)) continue;
        const s = matchAndScore(c, tokens);
        if (s == null) continue;
        filtered.push({ card: c, score: s });
      }
      filtered.sort((a, b) => b.score - a.score || compareCards(a.card, b.card, sort, dir));
      const total = filtered.length;
      const start = (page - 1) * pageSize;
      return {
        cards: filtered.slice(start, start + pageSize).map((s) => s.card),
        total,
        page,
        pageSize,
      };
    }
  } else {
    filtered = all.filter((c) => applyFilters(c, params)).map((c) => ({ card: c, score: 0 }));
  }

  filtered.sort((a, b) => compareCards(a.card, b.card, sort, dir));
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  return {
    cards: filtered.slice(start, start + pageSize).map((s) => s.card),
    total,
    page,
    pageSize,
  };
}

export function getFilterFacets() {
  const cards = getAllCards();
  const supertypes = new Set<string>();
  const types = new Set<string>();
  const subtypes = new Set<string>();
  const regulations = new Set<string>();
  for (const c of cards) {
    supertypes.add(c.supertype);
    c.types.forEach((t) => types.add(t));
    c.subtypes.forEach((s) => subtypes.add(s));
    if (c.regulationMark) regulations.add(c.regulationMark);
  }
  return {
    supertypes: Array.from(supertypes).sort(),
    types: Array.from(types).sort(),
    subtypes: Array.from(subtypes).sort(),
    regulations: Array.from(regulations).sort(),
    sets: getSets(),
  };
}
