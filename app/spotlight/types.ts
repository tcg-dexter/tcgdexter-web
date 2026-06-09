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
  avatar_image_position: SpotlightAvatarPosition;
  /** Aspect-preserving scale multiplier vs the base image width (32% of
   *  banner). 1.0 is the fit-to-default value; clamped 0.1–4 elsewhere. */
  avatar_image_scale: number;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
