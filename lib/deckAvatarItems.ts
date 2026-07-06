import { type AvatarStackItem } from "@/app/components/AvatarStack";
import { deckAvatarInfo } from "@/lib/primaryCardImage";
import { metaTopPokemonByCount } from "@/lib/metaPrimaryCard";

export interface DeckAvatarCard {
  qty: number;
  name: string;
  number: string;
  setCode: string;
  section: "pokemon" | "trainer" | "energy";
}

/**
 * Avatar 1 = the deck's primary sprite. Slots 2 & 3 are picked from a larger
 * candidate pool (next Pokémon by total copy count, deduped against avatar
 * 1's evolution line — same logic as MetaVariantCard). The pool is
 * over-fetched so AvatarStack can shift forward when a sprite 404s on the
 * limitless host (some forms/regionals aren't covered).
 */
export function buildAvatarItems(
  cards: DeckAvatarCard[] | undefined,
  coverImageUrl: string | null,
  iconUrl: string | null | undefined,
  iconBg: string | null | undefined,
): AvatarStackItem[] {
  const primaryItem: AvatarStackItem = {
    key: "primary",
    iconUrl: iconUrl ?? null,
    iconBg: iconBg ?? null,
  };
  if (!cards || cards.length === 0) return [primaryItem];
  const primary = deckAvatarInfo(cards, coverImageUrl);
  const adapted = cards.map((c) => ({
    qty: c.qty,
    name: c.name,
    number: c.number,
    setCode: c.setCode,
    category: c.section,
  }));
  const pool = metaTopPokemonByCount(adapted, 5, primary ? [primary.name] : []);
  return [
    primaryItem,
    ...pool.map((a) => ({ key: a.name, iconUrl: a.iconUrl, iconBg: a.iconBg })),
  ];
}
