export interface SpotlightCardRef {
  set_id: string;
  number: string;
  name: string;
  /** Optional short blurb shown under the card art in the spotlight
   *  page's "Favorite Cards in {Play,Collection}" sections. Null /
   *  missing → no caption rendered (existing rows that pre-date this
   *  field round-trip cleanly as undefined). */
  caption?: string | null;
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

/** Item keys whose position + scale are user-editable. Cards now
 *  render as fixed fans on either side of the banner and the Pokémon
 *  sprite is pinned to the bottom-right corner, so only the uploaded
 *  user image stays interactive. */
export const INTERACTIVE_BANNER_KEYS: SpotlightBannerItemKey[] = [
  "user_image",
];

/** Participant-facing lifecycle for a spotlight, independent of
 *  `is_published`. An approved spotlight is still a draft until an admin
 *  presses Publish.
 *
 *  not_invited → invited → submitted → in_review → approved */
export type SpotlightSubmissionStatus =
  | "not_invited"
  | "invited"
  | "submitted"
  | "in_review"
  | "approved";

/** Raw content the featured trainer submits via /spotlight/onboarding.
 *  Mirrors the Trainer Spotlight prep PDF section for section.
 *
 *  Stored in its own jsonb column and never written directly to the
 *  published fields — the admin copies each block across in the editor, so
 *  the trainer's original words survive the editorial pass. Field types are
 *  reused from the published shapes above so that copy is a straight
 *  assignment rather than a transform. */
export interface SpotlightSubmission {
  /** Optional per the PDF — a slogan / tagline, if they have one. */
  headline: string;
  /** Freeform "take the mic" intro. Maps to the published `bio`. */
  intro: string;
  favorite_pokemon: SpotlightPokemonRef | null;
  /** Max 3 each. `caption` carries the backstory the PDF asks for. */
  collection_cards: SpotlightCardRef[];
  play_cards: SpotlightCardRef[];
  /** 5–8 answered questions drawn from the bank in ./questions. */
  answers: SpotlightQA[];
  /** Up to 3, from the trainer's own saved decks. */
  deck_ids: string[];
  /** Optional, from the trainer's own card lists. Captured for the admin's
   *  reference — the published spotlight page does not render lists. */
  list_short_ids: string[];
  /** Raw TCG Live screenshot. Kept apart from `avatar_image_url`: the admin
   *  cuts out the subject and uploads the processed version separately. */
  avatar_upload_url: string | null;
  /** Anything else they want to pass along. */
  notes: string;
}

export const EMPTY_SPOTLIGHT_SUBMISSION: SpotlightSubmission = {
  headline: "",
  intro: "",
  favorite_pokemon: null,
  collection_cards: [],
  play_cards: [],
  answers: [],
  deck_ids: [],
  list_short_ids: [],
  avatar_upload_url: null,
  notes: "",
};

/** Fills in any field missing from a stored `submission` jsonb. Rows created
 *  before this column existed default to `{}`, and a submission saved by an
 *  older client may lack newer keys. */
export function normalizeSubmission(
  raw: Partial<SpotlightSubmission> | null | undefined,
): SpotlightSubmission {
  return { ...EMPTY_SPOTLIGHT_SUBMISSION, ...(raw ?? {}) };
}

export interface TrainerSpotlightRow {
  id: string;
  profile_id: string;
  slug: string;
  headline: string | null;
  /** Long-form body text shown above the featured decks on the
   *  published page. Plain text; renders with whitespace-pre-line
   *  so line breaks are preserved. */
  bio: string | null;
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
  /** Up to 3 cards each. Rendered as fanned stacks on either side of
   *  the banner; non-interactive. */
  favorite_collection_cards: SpotlightCardRef[];
  favorite_format_cards: SpotlightCardRef[];
  /** Per-item placement of the user image (and legacy entries for
   *  pokemon / card slots that the page no longer reads). */
  banner_layout: SpotlightBannerLayout;
  is_published: boolean;
  published_at: string | null;
  /** Raw participant submission — see SpotlightSubmission. `{}` until they
   *  save anything; run it through normalizeSubmission before reading. */
  submission: Partial<SpotlightSubmission>;
  submission_status: SpotlightSubmissionStatus;
  invited_at: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  /** Optional note the trainer left when approving the edited version. */
  approval_note: string | null;
  created_at: string;
  updated_at: string;
}
