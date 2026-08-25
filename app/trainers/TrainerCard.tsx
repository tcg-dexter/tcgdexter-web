"use client";

import Link from "next/link";
import { bannerGradientFor } from "@/app/u/[username]/UserProfileHeader";
import { BattleHeatGrid } from "@/app/profile/BattleHeatMap";
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
   *  brand gradient. Resolved through `bannerGradientFor` (never stored as
   *  CSS) and painted as the preview card's border, which is the whole of
   *  the trainer's colour on this surface. The avatar circle uses it too. */
  bannerAccent: string | null;
  /** Public decks only — the count a visitor can actually browse. */
  deckCount: number;
  /** Summed `like_count` across those public decks (same tally as /leaderboard). */
  totalLikes: number;
  followerCount: number;
  createdAt: string;
  /** Row-major counts for a 7x7 battle-activity grid (-1 = a day still to
   *  come). Built server-side — the grid's date maths is timezone-dependent
   *  and this component renders on the client, so computing it here would
   *  mismatch on hydration. Scoped to public decks only; see the loader in
   *  ./page.tsx for exactly what that covers. */
  heat: number[];
  /** True when the signed-in viewer already follows this trainer. Always
   *  false for anon visitors (user_follows is readable to authenticated only). */
  viewerFollows: boolean;
}

/** Preview-card avatar diameter. The sprite and the fallback initial are
 *  both derived from it, so this is the only number to move. */
const AVATAR_PX = 48;

/** The activity grid's height, and the gap between its cells. 64px is what
 *  the grid occupied back when it was a 7x7 square sitting beside the
 *  avatar; widening it to 20 weeks changed how much of the card it spans,
 *  not how much of the card's height it costs. */
const HEAT_HEIGHT_PX = 64;
const HEAT_GAP_PX = 2;

/**
 * Avatar circle. Mirrors the non-owner branch of `UserProfileHeader`: the
 * circle is painted with the trainer's own banner gradient and the chosen
 * Pokémon sprite sits centred on top at ~78% of the diameter, so a card
 * reads as a miniature of the profile it links to. Falls back to the
 * initial-letter treatment (see the design library's "Avatars" section)
 * when the trainer hasn't picked a sprite yet — in white, since it sits on
 * the gradient rather than on a grey chip.
 *
 * The ink-coloured outline is part of the avatar rather than something a
 * caller opts into, so the grid card and the list row can't drift apart.
 * A ring, not a border: it's drawn outside the box, so the circle's
 * diameter stays exactly `size` and the sprite keeps its own margin
 * instead of losing a pixel to the outline.
 */
function TrainerAvatar({
  trainer,
  size,
}: {
  trainer: TrainerPreview;
  size: number;
}) {
  const sprite = Math.round(size * 0.78);
  return (
    <div
      className="relative rounded-full flex items-center justify-center overflow-hidden shrink-0 ring-1 ring-black dark:ring-white"
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
 * Grid preview card. An identity row — avatar, name and handle — over the
 * battle-activity grid and the bio, closing on the three public stats.
 *
 * Unlike the deck cards it sits beside, this one doesn't use the elevated
 * white/surface panel: its face is the page background and its outline is
 * the trainer's own accent, so a directory of them reads as a set of
 * coloured windows rather than a wall of identical panels. Radius, shadow
 * and hover still match `UserDeckCard` so the two can share a grid.
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
      className="block rounded-2xl border-2 border-transparent shadow-sm hover:shadow-md transition-shadow"
      style={{
        ...useFadeIn(index, skipEntranceAnimation),
        // The trainer's accent is the card's outline, and the face is the
        // page's own background — so the tile reads as a window cut out of
        // the page in their colour rather than as a panel sitting on it.
        //
        // Two layers on one background, the repo's standing trick for a
        // gradient border (see .gradient-brand / .focus-gradient-border in
        // globals.css): the fill is painted to the padding box, the accent
        // to the border box, and the border itself is transparent so the
        // second layer is all that shows through it. A plain
        // `border-color` couldn't do this — the accent is a gradient, and
        // for a trainer who hasn't picked one it's the brand gradient.
        background: `linear-gradient(var(--bg), var(--bg)) padding-box, ${bannerGradientFor(
          trainer.bannerAccent,
        )} border-box`,
      }}
    >
      <div className="px-4 pt-4 pb-3">
        {/* Identity row: avatar, then who they are. The name column carries
            min-w-0 as well as flex-1 — a flex item won't shrink below its
            content's intrinsic width without it, so a long display name
            would overflow the card rather than truncating. */}
        <div className="flex items-center gap-3">
          <TrainerAvatar trainer={trainer} size={AVATAR_PX} />

          <div className="min-w-0 flex-1">
            <p className="text-[17px] font-semibold text-text-primary truncate">
              {trainer.displayName}
            </p>
            <p className="text-xs text-text-muted truncate">@{trainer.username}</p>
            {/* Under the two identity lines rather than beside the name,
                where it competed with the name for the row's only flexible
                column and made a followed trainer's name truncate sooner.
                leading-none keeps it from claiming more height than the
                chip itself needs. */}
            {trainer.viewerFollows && (
              <span className="mt-1 inline-block text-[10px] font-bold uppercase tracking-[0.08em] leading-none text-text-muted border border-black/10 dark:border-white/15 rounded-full px-1.5 py-0.5">
                Following
              </span>
            )}
          </div>
        </div>

        {/* Activity, on its own row and pinned to the height the square
            7-week grid used to occupy.

            Height, not width, is what's held: the cells are square and
            there are always 7 rows, so the two can't both be chosen. Twenty
            columns at this height come out around 186px wide — comfortably
            inside the card, but far too wide to sit beside the name the way
            the 64px square did, which is why this is its own row rather
            than part of the identity line. */}
        <div className="mt-3">
          <BattleHeatGrid
            counts={trainer.heat}
            accent={trainer.bannerAccent}
            gapPx={HEAT_GAP_PX}
            heightPx={HEAT_HEIGHT_PX}
            cellRadiusClass="rounded-[2px]"
            // This card's face is --bg, not the elevated white surface the
            // grid's default empty tone was picked against — on --bg that
            // tone is within a few percent of the card itself and a quiet
            // stretch reads as no grid at all.
            emptyColor="var(--surface-2)"
            label={`${trainer.displayName}'s battle activity`}
          />
        </div>

        {/* Fixed two-line well whether or not there's a bio, so the stat
            rows stay on one baseline across the grid. */}
        <p className="mt-3 text-[13px] leading-snug text-text-secondary line-clamp-2 min-h-[2.4em]">
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
