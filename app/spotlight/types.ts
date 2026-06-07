export interface SpotlightCardRef {
  set_id: string;
  number: string;
  name: string;
}

export interface SpotlightQA {
  q: string;
  a: string;
}

export interface TrainerSpotlightRow {
  id: string;
  profile_id: string;
  slug: string;
  headline: string | null;
  favorite_pokemon: SpotlightCardRef | null;
  favorite_collection_card: SpotlightCardRef | null;
  favorite_format_card: SpotlightCardRef | null;
  featured_deck_ids: string[];
  qa: SpotlightQA[];
  is_published: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}
