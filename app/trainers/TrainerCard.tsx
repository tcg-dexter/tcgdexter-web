"use client";

import Link from "next/link";
import { bannerGradientFor } from "@/app/u/[username]/UserProfileHeader";
import {
  TEAM_CARD_WIDTH_PCT,
  TEAM_FAN_HEIGHT_RATIO,
  TEAM_SLOT_GEOMETRY,
  normalizeTeam,
  type TeamCardRef,
} from "@/app/u/[username]/TeamCards";
import { cardImageLarge } from "@/lib/cardImages";
import { useFadeIn } from "@/lib/useFadeIn";

/**
 * One public trainer, flattened for the directory. Assembled server-side in
 * ./page.tsx so both the grid card and the list row read the same shape —
 * same split the deck collection uses between `UserDeckCard` and
 * `SavedDeckRow`.
 */
export interface TrainerPreview {
  id: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarUrl: string | null;
  /** `profiles.banner_accent` — an energy key, or null for the signature
   *  brand gradient. Painted via `bannerGradientFor`, never stored as CSS. */
  bannerAccent: string | null;
  /** `profiles.team_cards` — the seven cards the trainer fanned across
   *  their own profile banner, nulls included for empty slots. Rendered at
   *  the same geometry here so a directory tile is a true miniature of the
   *  profile it links to. */
  teamCards: (TeamCardRef | null)[];
  /** Public decks only — the count a visitor can actually browse. */
  deckCount: number;
  /** Summed `like_count` across those public decks (same tally as /leaderboard). */
  totalLikes: number;
  followerCount: number;
  createdAt: string;
  /** True when the signed-in viewer already follows this trainer. Always
   *  false for anon visitors (user_follows is readable to authenticated only). */
  viewerFollows: boolean;
}

/**
 * Avatar circle. Mirrors the non-owner branch of `UserProfileHeader`: the
 * circle is painted with the trainer's own banner gradient and the chosen
 * Pokémon sprite sits centred on top at ~78% of the diameter, so a card
 * reads as a miniature of the profile it links to. Falls back to the
 * initial-letter treatment (see the design library's "Avatars" section)
 * when the trainer hasn't picked a sprite yet — in white, since it sits on
 * the gradient rather than on a grey chip.
 */
function TrainerAvatar({
  trainer,
  size,
  ringClass = "",
}: {
  trainer: TrainerPreview;
  size: number;
  ringClass?: string;
}) {
  const sprite = Math.round(size * 0.78);
  return (
    <div
      className={`relative rounded-full flex items-center justify-center overflow-hidden shrink-0 ${ringClass}`}
      style={{
        width: size,
        height: size,
        background: bannerGradientFor(trainer.bannerAccent),
      }}
    >
      {trainer.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={trainer.avatarUrl}
          alt=""
          className="object-contain"
          style={{ width: sprite, height: sprite }}
          loading="lazy"
        />
      ) : (
        <span
          className="font-bold text-white/90 leading-none"
          style={{ fontSize: Math.round(size * 0.4) }}
        >
          {trainer.displayName.trim().charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

/** Height of the plain accent band shown for a trainer with no cards
 *  picked — the banner's original height, before the fan needed room. */
const EMPTY_BANNER_PX = 72;

/**
 * The trainer's banner: their chosen accent gradient with their chosen
 * seven cards fanned across it, at the same slot geometry the profile
 * banner uses (TEAM_SLOT_GEOMETRY) — the tile really is a miniature of the
 * page it links to, not a separate design that resembles it.
 *
 * Sized at the profile's own scale rather than a shrunken one, so the
 * outermost cards bleed past the tile's edges and get clipped by its
 * rounded corners exactly as they do on a profile banner. That bleed is
 * part of the look — the fan is meant to read as wider than its frame.
 *
 * Deliberately static: no `dx-fan-card`, so none of the cards animate in.
 * On a profile the fan opening is the page arriving; in a grid of tiles
 * it would be a dozen banners all shuffling at once, and the entrance
 * would fight the tiles' own staggered fade.
 *
 * Empty slots render as nothing at all rather than as the profile's
 * outlines: those exist to tell an owner there's room to fill, which is a
 * message with no audience on someone else's directory card.
 */
function BannerFan({ trainer }: { trainer: TrainerPreview }) {
  const team = normalizeTeam(trainer.teamCards);
  const hasCards = team.some((c) => c !== null);

  return (
    <div
      aria-hidden
      className="relative w-full overflow-hidden"
      style={{
        background: bannerGradientFor(trainer.bannerAccent),
        // An aspect ratio, not a pixel height: the tile's width changes with
        // the grid's column count, and the fan is sized in percentages of
        // it, so only a ratio keeps the tallest card exactly meeting the
        // banner's top edge at every breakpoint. A trainer with no cards
        // picked keeps the plain band the banner used to be.
        aspectRatio: hasCards ? `1 / ${TEAM_FAN_HEIGHT_RATIO}` : undefined,
        height: hasCards ? undefined : EMPTY_BANNER_PX,
      }}
    >
      {team.map((card, i) => {
        if (!card) return null;
        const g = TEAM_SLOT_GEOMETRY[i];
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={cardImageLarge(card.set_id, card.number)}
            alt=""
            loading="lazy"
            className="absolute select-none rounded drop-shadow-md"
            style={{
              bottom: 0,
              // Plain inline placement, unlike the profile's fan, which
              // has to route these through a class so a media query can
              // override them. There's one spread here and no entrance to
              // sequence, so there's nothing for a class to win against.
              left: `${g.left}%`,
              width: `${TEAM_CARD_WIDTH_PCT}%`,
              transform: `translateY(${g.clipPct}%) rotate(${g.rotationDeg}deg)`,
              transformOrigin: "50% 100%",
              zIndex: g.zIndex,
            }}
          />
        );
      })}
    </div>
  );
}

/** One stat in a trainer's footer row — value over a tiny uppercase label,
 *  same treatment as the pinned-deck hero's Record / Win rate / Streak.
 *  `compact` is the grid card's size: its banner now carries a card fan,
 *  so the footer gives height back rather than growing the tile twice. */
function Stat({
  value,
  label,
  compact = false,
}: {
  value: number;
  label: string;
  compact?: boolean;
}) {
  return (
    <div className="text-center">
      <div
        className={`font-extrabold tabular-nums text-text-primary leading-none ${
          compact ? "text-[13px]" : "text-[17px]"
        }`}
      >
        {value.toLocaleString()}
      </div>
      <div
        className={`font-bold uppercase tracking-[0.09em] text-text-muted ${
          compact ? "mt-0.5 text-[9px]" : "mt-1 text-[10px]"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

/**
 * Grid preview card. Banner strip + overlapping avatar + name/handle/bio,
 * closing on the three public stats. Card chrome (radius, border, blurred
 * elevated surface, hover shadow) is lifted verbatim from `UserDeckCard`
 * so a trainer card and a deck card can sit in the same grid without
 * looking like they came from different apps.
 */
export function TrainerCard({
  trainer,
  index,
  skipEntranceAnimation = false,
}: {
  trainer: TrainerPreview;
  index?: number;
  skipEntranceAnimation?: boolean;
}) {
  return (
    <Link
      href={`/u/${trainer.username}`}
      className="block rounded-2xl border border-black/8 dark:border-white/10 bg-white/90 dark:bg-surface-elevated backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      style={useFadeIn(index, skipEntranceAnimation)}
    >
      <BannerFan trainer={trainer} />

      <div className="px-4 pb-3">
        {/* Negative margin overlaps the banner's bottom edge, echoing the
            profile header's avatar. The ring matches the card surface, not
            the page background, since the circle sits on the card here. */}
        <div className="-mt-8">
          <TrainerAvatar
            trainer={trainer}
            size={64}
            ringClass="ring-4 ring-white dark:ring-surface-elevated"
          />
        </div>

        <div className="mt-2 min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-[17px] font-semibold text-text-primary truncate">
              {trainer.displayName}
            </span>
            {trainer.viewerFollows && (
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted border border-black/10 dark:border-white/15 rounded-full px-1.5 py-0.5">
                Following
              </span>
            )}
          </div>
          <p className="text-xs text-text-muted truncate">@{trainer.username}</p>
        </div>

        {/* Fixed two-line well whether or not there's a bio, so the stat
            rows stay on one baseline across the grid. */}
        <p className="mt-2 text-[13px] leading-snug text-text-secondary line-clamp-2 min-h-[2.4em]">
          {trainer.bio?.trim() || ""}
        </p>

        <div className="mt-2 pt-2 border-t border-black/5 dark:border-white/10 flex items-start justify-between">
          <Stat value={trainer.deckCount} label="Decks" compact />
          <Stat value={trainer.totalLikes} label="Likes" compact />
          <Stat value={trainer.followerCount} label="Followers" compact />
        </div>
      </div>
    </Link>
  );
}

/**
 * List row. Rendered inside the shared white/elevated container the deck
 * collection uses for `SavedDeckRow`, so the divider and hover states match.
 * The stat trio collapses to a single "N decks · N likes" line on mobile,
 * where three labelled columns won't fit next to the name.
 */
export function TrainerRow({
  trainer,
  isLast,
}: {
  trainer: TrainerPreview;
  isLast: boolean;
}) {
  return (
    <Link
      href={`/u/${trainer.username}`}
      className={`flex items-center gap-3 px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${
        isLast ? "" : "border-b border-black/5 dark:border-white/10"
      }`}
    >
      <TrainerAvatar trainer={trainer} size={40} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm font-semibold text-text-primary truncate">
            {trainer.displayName}
          </span>
          {trainer.viewerFollows && (
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.08em] text-text-muted">
              Following
            </span>
          )}
        </div>
        <div className="text-xs text-text-muted truncate">
          @{trainer.username}
          <span className="sm:hidden">
            {" · "}
            {trainer.deckCount.toLocaleString()} decks ·{" "}
            {trainer.totalLikes.toLocaleString()} likes
          </span>
        </div>
      </div>

      <div className="hidden sm:flex items-start gap-6 shrink-0">
        <Stat value={trainer.deckCount} label="Decks" />
        <Stat value={trainer.totalLikes} label="Likes" />
        <Stat value={trainer.followerCount} label="Followers" />
      </div>
    </Link>
  );
}
