"use client";

import Link from "next/link";
import { bannerGradientFor } from "@/app/u/[username]/UserProfileHeader";
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

/** One stat in the card's footer row — value over a tiny uppercase label,
 *  same treatment as the pinned-deck hero's Record / Win rate / Streak. */
function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-[17px] font-extrabold tabular-nums text-text-primary leading-none">
        {value.toLocaleString()}
      </div>
      <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.09em] text-text-muted">
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
      <div
        aria-hidden
        className="h-[72px] w-full"
        style={{ background: bannerGradientFor(trainer.bannerAccent) }}
      />

      <div className="px-4 pb-4">
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

        <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/10 flex items-start justify-between">
          <Stat value={trainer.deckCount} label="Decks" />
          <Stat value={trainer.totalLikes} label="Likes" />
          <Stat value={trainer.followerCount} label="Followers" />
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
