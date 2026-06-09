export interface SpotlightCardRef {
  set_id: string;
  number: string;
  name: string;
}

/** Favorite Pokémon is just a Pokémon name — rendered as a sprite, not a
 *  specific card. Stored as jsonb so we can extend later (e.g. preferred
 *  form / shiny / regional variant) without a migration. */
export interface SpotlightPokemonRef {
  name: string;
}

export interface SpotlightQA {
  q: string;
  a: string;
}

/** x / y as percentages (0-100) of the banner's width and height. The
 *  image is rendered centered on this point, so {50, 50} is dead center. */
export interface SpotlightAvatarPosition {
  x: number;
  y: number;
}

/** Per-item placement inside the programmatic banner. */
export interface SpotlightBannerItem {
  x: number;
  y: number;
  scale: number;
}

export type SpotlightBannerItemKey =
  | "collection_card"
  | "pokemon"
  | "user_image"
  | "format_card";

export type SpotlightBannerLayout = Record<
  SpotlightBannerItemKey,
  SpotlightBannerItem
>;

/** Editorial preset for the banner items. The favorite-Pokémon sprite
 *  is rendered separately, pinned to the bottom-right corner — its
 *  entry in this map is retained for schema continuity (the DB column
 *  defaults still include it) but the page does not read it.
 *
 *  The Reset button restores the three interactive items below to
 *  their preset evenly across the horizontal middle. */
export const DEFAULT_BANNER_LAYOUT: SpotlightBannerLayout = {
  collection_card: { x: 20, y: 55, scale: 1.0 },
  user_image: { x: 50, y: 55, scale: 1.0 },
  format_card: { x: 80, y: 55, scale: 1.0 },
  // Unused by the page — pokemon is pinned via CSS, not layout state.
  pokemon: { x: 92, y: 88, scale: 1.0 },
};

/** Item keys whose position + scale are user-editable. Excludes
 *  `pokemon`, which the page pins to the bottom-right corner. */
export const INTERACTIVE_BANNER_KEYS: SpotlightBannerItemKey[] = [
  "collection_card",
  "user_image",
  "format_card",
];

export interface TrainerSpotlightRow {
  id: string;
  profile_id: string;
  slug: string;
  headline: string | null;
  favorite_pokemon: SpotlightPokemonRef | null;
  favorite_collection_card: SpotlightCardRef | null;
  favorite_format_card: SpotlightCardRef | null;
  featured_deck_ids: string[];
  qa: SpotlightQA[];
  avatar_image_url: string | null;
  /** Legacy — superseded by banner_layout.user_image. Kept in the row
   *  for backward compat; the page reads banner_layout instead. */
  avatar_image_position: SpotlightAvatarPosition;
  /** Legacy — superseded by banner_layout.user_image.scale. */
  avatar_image_scale: number;
  /** Per-item placement of the four banner elements. */
  banner_layout: SpotlightBannerLayout;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
