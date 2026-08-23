import type { ReactNode } from "react";

/** Shared types for Social Studio templates. Most templates render at a
 *  fixed 1080×1920 canvas (9:16); the spotlight thumbnail uses a 5:4
 *  landscape canvas. Per-template dimensions live in CANVAS_SIZE_BY_KIND.
 *  Each template is composed of named layers so the editor can toggle,
 *  isolate, and export each one as its own PNG. */

// Default (9:16) canvas — the size every template but the spotlight thumbnail
// renders at. Kept as the LayerCanvas / rasterizer defaults.
export const CANVAS_W = 1080;
export const CANVAS_H = 1920;

// 5:4 landscape canvas for the flashy spotlight thumbnail.
export const THUMB_CANVAS_W = 1350;
export const THUMB_CANVAS_H = 1080;

export interface CanvasSize {
  w: number;
  h: number;
}

/** One compositing layer of a template. `node` is absolutely positioned
 *  content for the 1080×1920 canvas; LayerCanvas stacks layers in array
 *  order (first = bottom). */
export interface StudioLayer {
  /** Stable per-template id, doubles as the export filename suffix. */
  id: string;
  /** Human label shown in the editor's layers panel. */
  name: string;
  /** When set, this layer renders the given copy field — the editor uses
   *  it to show "editable text" affordances in the layers panel. */
  copyField?: keyof TemplateCopy;
  node: ReactNode;
}

/** Route external image URLs through the admin-only proxy so html-to-image
 *  can fetch them same-origin during PNG export (the upstream CDNs don't
 *  all send CORS headers). Relative URLs pass through untouched. */
export function proxied(url: string): string;
export function proxied(url: string | null): string | null;
export function proxied(url: string | null): string | null {
  if (!url) return null;
  if (url.startsWith("/")) return url;
  return `/api/admin/social-studio/proxy-image?url=${encodeURIComponent(url)}`;
}

export interface SpotlightSubject {
  kind: "spotlight";
  id: string;
  slug: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  headline: string | null;
  /** Color stops used for the banner gradient — favorite Pokémon →
   *  first-collection card → first-play card. Resolved server-side. */
  accentColors: string[];
  pokemonName: string | null;
}

/** Same source data as SpotlightSubject, rendered through the 5:4
 *  flashy-thumbnail template instead of the 9:16 portrait one. */
export interface SpotlightThumbSubject extends Omit<SpotlightSubject, "kind"> {
  kind: "spotlight_thumb";
}

export interface MetaArchetypeSubject {
  kind: "meta_archetype";
  id: string;
  name: string;
  representationPct: number;
  totalEntries: number;
  iconUrl: string | null;
  imageUrl: string | null;
  accentColor: string;
}

export interface CardSpotlightSubject {
  kind: "card_spotlight";
  id: string;
  name: string;
  setName: string;
  number: string;
  rarity: string | null;
  artist: string | null;
  types: string[];
  marketPrice: number | null;
  imageUrl: string | null;
  accentColor: string;
}

export interface FeaturedDeckSubject {
  kind: "featured_deck";
  id: string;
  shortId: string;
  name: string;
  username: string;
  displayName: string;
  coverImageUrl: string | null;
  iconUrl: string | null;
  accentColor: string;
  likeCount: number;
  price: number | null;
}

interface FeaturedBattleFields {
  id: string;
  /** TCG Dexter handles retained for the subject dropdown label; the
   *  template itself renders the platform handles below. */
  username: string;
  displayName: string;
  deckName: string;
  /** Player's deck cover (the player-side hero card on the banner). */
  deckCoverUrl: string | null;
  /** Opponent's representative card image — top attacker for imported
   *  battle logs, recognized meta-archetype primary for manual entries. */
  opponentImageUrl: string | null;
  /** Type-color accents per side, used to paint the split gradient. */
  playerAccentColor: string;
  opponentAccentColor: string;
  /** Handles shown in the banner's "Player Handles" row. For imported logs
   *  these are the TCG Live in-game handles (matches.player_handle /
   *  opponent_handle); for manual entries the player's TCG Dexter handle
   *  and the opponent name as logged. Fall back to placeholders when
   *  missing. */
  playerHandle: string | null;
  opponentHandle: string | null;
  opponentArchetype: string | null;
  result: "win" | "loss" | "draw";
  playerPrizes: number;
  opponentPrizes: number;
  /** Small label above the handle row — "TCG Live" for imported logs,
   *  "Battle Log" for manual entries. */
  platformLabel: string;
}

export interface FeaturedBattleSubject extends FeaturedBattleFields {
  kind: "featured_battle";
}

/** Manually-logged battles (source != 'tcg_live_log') with a recognized
 *  meta-archetype opponent. Renders through the same banner as
 *  FeaturedBattleSubject, but piped from matches.prizes_taken_* /
 *  opponent_name / opponent_archetype instead of a parsed battle log. */
export interface FeaturedManualBattleSubject extends FeaturedBattleFields {
  kind: "featured_battle_manual";
}

export type FeaturedBattleLikeSubject = FeaturedBattleSubject | FeaturedManualBattleSubject;

export type TemplateSubject =
  | SpotlightSubject
  | SpotlightThumbSubject
  | MetaArchetypeSubject
  | CardSpotlightSubject
  | FeaturedDeckSubject
  | FeaturedBattleSubject
  | FeaturedManualBattleSubject;

export type TemplateKind = TemplateSubject["kind"];

/** Canvas dimensions per template. Most are the default 9:16; the spotlight
 *  thumbnail is 5:4 landscape. */
export const CANVAS_SIZE_BY_KIND: Record<TemplateKind, CanvasSize> = {
  spotlight: { w: CANVAS_W, h: CANVAS_H },
  spotlight_thumb: { w: THUMB_CANVAS_W, h: THUMB_CANVAS_H },
  meta_archetype: { w: CANVAS_W, h: CANVAS_H },
  card_spotlight: { w: CANVAS_W, h: CANVAS_H },
  featured_deck: { w: CANVAS_W, h: CANVAS_H },
  featured_battle: { w: CANVAS_W, h: CANVAS_H },
  featured_battle_manual: { w: CANVAS_W, h: CANVAS_H },
};

export interface TemplateCopy {
  eyebrow: string;
  headline: string;
  subhead: string;
  cta: string;
}

export const TEMPLATE_LABELS: Record<TemplateKind, string> = {
  spotlight: "Trainer Spotlight",
  spotlight_thumb: "Spotlight Thumbnail",
  meta_archetype: "Meta Archetype Spotlight",
  card_spotlight: "Card Spotlight",
  featured_deck: "Featured Deck",
  featured_battle: "Featured Battle",
  featured_battle_manual: "Featured Battle (Manual)",
};

export const TEMPLATE_DESCRIPTIONS: Record<TemplateKind, string> = {
  spotlight: "Published trainer spotlights — avatar, headline, and partner Pokémon.",
  spotlight_thumb: "Published spotlights as a flashy 5:4 thumbnail — partner Pokémon hero, avatar, and headline.",
  meta_archetype: "Top archetypes from the live meta, with their share as the hero stat.",
  card_spotlight: "Chase cards from the Standard catalog, ranked by market price.",
  featured_deck: "Most-liked public decks from the community library.",
  featured_battle: "Verified TCG Live battles with the head-to-head card stack.",
  featured_battle_manual: "Manually logged battles with the head-to-head card stack.",
};
