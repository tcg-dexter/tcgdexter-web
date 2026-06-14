import cardData from "@/data/cards-standard.json";
import { setReleaseDate } from "@/lib/setReleaseDates";
import { normalizeForSearch } from "@/lib/searchNormalize";

/**
 * PTCGO / set abbreviation overrides. Takes precedence over the raw
 * `ptcgo_code` field — covers (1) sets where upstream never populated
 * the field (Mega Evolution era), and (2) sets where upstream uses a
 * different convention than the one we want to display (svp, mep where
 * upstream emits "PR-SV" / "PR-ME" but the community-standard codes
 * are SVP and MEP).
 */
const SET_PTCGO_CODE_OVERRIDES: Record<string, string> = {
  me1: "MEG",
  me2: "PFL",
  me2pt5: "ASC",
  me3: "POR",
  me4: "CRI",
  svp: "SVP",
  mep: "MEP",
};

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
  /** Card name this printing evolves from (e.g. Starmie ← Staryu). Null for
   *  Basics, Trainers, Energy, and any printing where the upstream catalog
   *  hasn't carried the field through yet. Populated by
   *  `scripts/backfill_evolves_from.py`; preserved across daily exports by
   *  `dexter-ops/scripts/export_cards_standard.py`. */
  evolvesFrom: string | null;
  /** Lowercased ability + attack names, used by catalog search for
   *  exact/prefix matching ("battle compressor", "mega hammer"). */
  effectNames: string[];
  /** Per-word tokens drawn from ability + attack names — drives partial
   *  matching (e.g. "hammer" hits "Mega Hammer"). */
  effectNameTokens: string[];
  /** Concatenated lowercase text of every ability + attack effect on the
   *  card (rules text excluded — those sit on Trainers/Energy and are
   *  caught by `name`). Used for substring fallback matching. */
  effectText: string;
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
  weaknesses?: Array<{ type: string; value: string }>;
  evolves_from?: string | null;
}

export interface SetStats {
  id: string;
  name: string;
  ptcgoCode: string | null;
  releaseDate: string | null;
  /** Actual number of distinct cards in the set — includes secret rares
   *  and other prints past the "official" set size. Used as the
   *  denominator for completion progress in the catalog data view. */
  size: number;
}

let CARDS: CardIndexEntry[] | null = null;
let SETS: Array<{ id: string; name: string; ptcgoCode: string | null }> | null = null;
let SET_STATS: SetStats[] | null = null;

function tokenizeName(name: string): string[] {
  return normalizeForSearch(name)
    .split(/[\s\-’'.:,&()\/]+/)
    .filter(Boolean);
}

function tokenizeArtist(name: string): string[] {
  return normalizeForSearch(name)
    .split(/[\s\-’'.:,&()\/]+/)
    .filter(Boolean);
}

function tokenizeEffect(text: string): string[] {
  return normalizeForSearch(text)
    .split(/[\s\-’'.:,&()\/!?]+/)
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
      const abilities = c.abilities ?? [];
      const attacks = c.attacks ?? [];
      const effectNames: string[] = [];
      const effectNameTokens: string[] = [];
      const effectTextParts: string[] = [];
      for (const a of abilities) {
        if (a.name) {
          effectNames.push(normalizeForSearch(a.name));
          effectNameTokens.push(...tokenizeEffect(a.name));
        }
        if (a.text) effectTextParts.push(normalizeForSearch(a.text));
      }
      for (const a of attacks) {
        if (a.name) {
          effectNames.push(normalizeForSearch(a.name));
          effectNameTokens.push(...tokenizeEffect(a.name));
        }
        if (a.text) effectTextParts.push(normalizeForSearch(a.text));
      }
      out.push({
        id: `${c.set_id}-${c.number}`,
        name: c.name,
        nameLower: normalizeForSearch(c.name),
        nameTokens: tokenizeName(c.name),
        setId: c.set_id,
        setName: c.set_name,
        setReleaseDate: c.release_date ?? setReleaseDate(c.set_id),
        setSize: setSizes.get(c.set_id) ?? 0,
        ptcgoCode: SET_PTCGO_CODE_OVERRIDES[c.set_id] ?? c.ptcgo_code ?? null,
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
        artistLower: c.artist ? normalizeForSearch(c.artist) : null,
        artistTokens: c.artist ? tokenizeArtist(c.artist) : [],
        evolvesFrom: c.evolves_from ?? null,
        effectNames,
        effectNameTokens,
        effectText: effectTextParts.join(" "),
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
  const seen = new Map<
    string,
    { id: string; name: string; ptcgoCode: string | null; releaseDate: string | null }
  >();
  for (const c of getAllCards()) {
    if (!seen.has(c.setId)) {
      seen.set(c.setId, {
        id: c.setId,
        name: c.setName,
        ptcgoCode: c.ptcgoCode,
        releaseDate: c.setReleaseDate ?? null,
      });
    }
  }
  SETS = Array.from(seen.values())
    .sort((a, b) => {
      const ad = a.releaseDate ?? "";
      const bd = b.releaseDate ?? "";
      if (ad !== bd) return bd.localeCompare(ad);
      return a.name.localeCompare(b.name);
    })
    .map(({ id, name, ptcgoCode }) => ({ id, name, ptcgoCode }));
  return SETS;
}

export function getAllSetStats(): SetStats[] {
  if (SET_STATS) return SET_STATS;
  const seen = new Map<string, SetStats>();
  for (const c of getAllCards()) {
    const existing = seen.get(c.setId);
    if (existing) {
      existing.size += 1;
    } else {
      seen.set(c.setId, {
        id: c.setId,
        name: c.setName,
        ptcgoCode: c.ptcgoCode,
        releaseDate: c.setReleaseDate ?? null,
        size: 1,
      });
    }
  }
  SET_STATS = Array.from(seen.values()).sort((a, b) => {
    const ad = a.releaseDate ?? "";
    const bd = b.releaseDate ?? "";
    if (ad !== bd) return bd.localeCompare(ad);
    return a.name.localeCompare(b.name);
  });
  return SET_STATS;
}

export function getCardById(id: string): CardIndexEntry | null {
  return getAllCards().find((c) => c.id === id) ?? null;
}

export function getCardsByName(name: string): CardIndexEntry[] {
  const lower = normalizeForSearch(name);
  return getAllCards().filter((c) => c.nameLower === lower);
}

export function getCardsByArtist(artist: string): CardIndexEntry[] {
  const lower = normalizeForSearch(artist.trim());
  if (!lower) return [];
  return getAllCards().filter((c) => c.artistLower === lower);
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
