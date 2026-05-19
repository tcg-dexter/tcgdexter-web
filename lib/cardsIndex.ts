import cardData from "@/data/cards-standard.json";
import { setReleaseDate } from "@/lib/setReleaseDates";

export interface CardIndexEntry {
  id: string;
  name: string;
  nameLower: string;
  nameTokens: string[];
  setId: string;
  setName: string;
  setReleaseDate: string;
  setSize: number;
  ptcgoCode: string | null;
  number: string;
  numberPadded: string;
  numberNumeric: number | null;
  supertype: "Pokémon" | "Trainer" | "Energy" | string;
  subtypes: string[];
  types: string[];
  hp: number | null;
  retreatCost: number;
  regulationMark: string | null;
  marketPrice: number;
  rarity: string | null;
  artist: string | null;
  artistLower: string | null;
  artistTokens: string[];
}

export interface CardAttack {
  name: string;
  cost: string[];
  convertedEnergyCost?: number;
  damage?: string;
  text?: string;
}

export interface CardAbility {
  type: string;
  name: string;
  text: string;
}

export interface RawCard {
  name: string;
  set_id: string;
  set_name: string;
  ptcgo_code?: string | null;
  number: string;
  supertype: string;
  subtypes?: string[];
  types?: string[];
  hp?: string | number | null;
  retreat_cost?: number | null;
  regulation_mark?: string | null;
  market_price?: number | null;
  rarity?: string | null;
  artist?: string | null;
  release_date?: string | null;
  attacks?: CardAttack[];
  abilities?: CardAbility[];
  rules?: string[];
}

let CARDS: CardIndexEntry[] | null = null;
let SETS: Array<{ id: string; name: string; ptcgoCode: string | null }> | null = null;

function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s\-’'.:,&()\/]+/)
    .filter(Boolean);
}

function tokenizeArtist(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[\s\-’'.:,&()\/]+/)
    .filter(Boolean);
}

function padNumber(num: string): string {
  const m = num.match(/^(\d+)(.*)$/);
  if (!m) return num;
  return m[1].padStart(3, "0") + m[2];
}

function buildIndex(): CardIndexEntry[] {
  const raw = cardData as unknown as Record<string, RawCard[]>;
  const out: CardIndexEntry[] = [];
  const setSizes = new Map<string, number>();
  for (const variants of Object.values(raw)) {
    for (const c of variants) {
      setSizes.set(c.set_id, (setSizes.get(c.set_id) ?? 0) + 1);
    }
  }
  for (const variants of Object.values(raw)) {
    for (const c of variants) {
      const hpNum = c.hp == null ? null : Number(c.hp);
      const numericMatch = c.number.match(/^(\d+)/);
      out.push({
        id: `${c.set_id}-${c.number}`,
        name: c.name,
        nameLower: c.name.toLowerCase(),
        nameTokens: tokenizeName(c.name),
        setId: c.set_id,
        setName: c.set_name,
        setReleaseDate: c.release_date ?? setReleaseDate(c.set_id),
        setSize: setSizes.get(c.set_id) ?? 0,
        ptcgoCode: c.ptcgo_code ?? null,
        number: c.number,
        numberPadded: padNumber(c.number),
        numberNumeric: numericMatch ? Number(numericMatch[1]) : null,
        supertype: c.supertype,
        subtypes: c.subtypes ?? [],
        types: c.types ?? [],
        hp: Number.isFinite(hpNum) ? (hpNum as number) : null,
        retreatCost: c.retreat_cost ?? 0,
        regulationMark: c.regulation_mark ?? null,
        marketPrice: c.market_price ?? 0,
        rarity: c.rarity ?? null,
        artist: c.artist ?? null,
        artistLower: c.artist ? c.artist.toLowerCase() : null,
        artistTokens: c.artist ? tokenizeArtist(c.artist) : [],
      });
    }
  }
  return out;
}

export function getAllCards(): CardIndexEntry[] {
  if (!CARDS) CARDS = buildIndex();
  return CARDS;
}

export function getSets(): Array<{ id: string; name: string; ptcgoCode: string | null }> {
  if (SETS) return SETS;
  const seen = new Map<string, { id: string; name: string; ptcgoCode: string | null }>();
  for (const c of getAllCards()) {
    if (!seen.has(c.setId)) {
      seen.set(c.setId, { id: c.setId, name: c.setName, ptcgoCode: c.ptcgoCode });
    }
  }
  SETS = Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  return SETS;
}

export function getCardById(id: string): CardIndexEntry | null {
  return getAllCards().find((c) => c.id === id) ?? null;
}

export function getCardsByName(name: string): CardIndexEntry[] {
  const lower = name.toLowerCase();
  return getAllCards().filter((c) => c.nameLower === lower);
}

export function getCardsByArtist(artist: string): CardIndexEntry[] {
  const lower = artist.trim().toLowerCase();
  if (!lower) return [];
  return getAllCards().filter((c) => c.artist?.toLowerCase() === lower);
}

export function getRawCard(id: string): RawCard | null {
  const idx = getCardById(id);
  if (!idx) return null;
  const raw = cardData as unknown as Record<string, RawCard[]>;
  const variants = raw[idx.name];
  if (!variants) return null;
  return (
    variants.find((v) => v.set_id === idx.setId && v.number === idx.number) ?? null
  );
}
