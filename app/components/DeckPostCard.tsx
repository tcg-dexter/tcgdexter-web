"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DeckCardFooter from "./DeckCardFooter";
import DeckCardMenu from "./DeckCardMenu";
import AvatarStack, { type AvatarStackItem } from "./AvatarStack";
import CompositionRing, { CompositionLegend } from "./CompositionRing";
import { type MatchFormData } from "./MatchForm";
import MatchEntry from "./MatchEntry";
import QRCodeButton from "./QRCodeButton";
import { buildAvatarItems } from "@/lib/deckAvatarItems";
import { shade } from "@/lib/color";
import { useFadeIn } from "@/lib/useFadeIn";

// ── Shared types ──────────────────────────────────────────────────────────────

export type CardCounts = { pokemon: number; trainer: number; energy: number };
export type WinLoss = { w: number; l: number; d: number };
/** Win/loss/draw record plus the derived win rate + recent form — see
 *  lib/deck-record.ts. `wl` on UserDeckCardProps carries this full shape;
 *  WLCircles below only reads the w/l/d fields. */
export type DeckRecordLike = WinLoss & {
  winRatePct?: number | null;
  recentForm?: ("W" | "L" | "D")[];
};

// ── Avatar color — deterministic per username ────────────────────────────────

const AVATAR_PALETTE = [
  "#3b6fd4", "#d43b9a", "#27ae60", "#e67e22", "#9b59b6", "#c0392b",
];
function avatarBg(name: string): string {
  const h = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CardArt({ url, name }: { url?: string | null; name: string }) {
  return (
    <div
      className="shrink-0 self-start rounded-lg overflow-hidden border border-black/[0.07] bg-[var(--surface)] flex items-center justify-center"
      style={{ width: 106, height: 148 }}
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="w-full h-full object-contain" />
      ) : (
        <span className="text-[11px] text-text-muted text-center leading-relaxed px-2">
          No cover
          <br />
          set
        </span>
      )}
    </div>
  );
}

export function WLCircles({ wl }: { wl: WinLoss }) {
  if (wl.w + wl.l + wl.d === 0) return null;
  return (
    <div className="inline-flex items-baseline tabular-nums font-bold text-[15px] leading-none bg-black rounded-full px-3 py-1.5 text-white">
      <span>{wl.w}</span>
      <span className="mx-1.5">-</span>
      <span>{wl.l}</span>
      {wl.d > 0 && (
        <>
          <span className="mx-1.5">-</span>
          <span>{wl.d}</span>
        </>
      )}
    </div>
  );
}

// ── Meta Deck Card ────────────────────────────────────────────────────────────

export interface MetaDeckCardProps {
  id: string;
  name: string;
  image_url?: string | null;
  /** URL of the pokémon sprite shown in the leading avatar circle. */
  icon_url?: string | null;
  /** Background color of the avatar circle (energy-type color of the
   *  card used for image_url). */
  icon_bg?: string | null;
  representation_pct: number;
  like_count?: number;
  creators?: string[];
  /** Position in the grid — drives the entrance-animation stagger delay. */
  index?: number;
}

export function MetaDeckCard({
  id,
  name,
  image_url,
  icon_url,
  icon_bg,
  representation_pct,
  like_count = 0,
  creators,
  index,
}: MetaDeckCardProps) {
  const creatorList = (creators && creators.length > 0 ? creators : ["Trainer"]).slice(0, 5);
  const href = `/meta-archetypes/${id}`;
  const accentBg = icon_bg ?? "#B0A89E";
  const accentDeep = shade(accentBg, -22);
  return (
    <div
      className="relative rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      style={useFadeIn(index)}
    >
      {/* Energy-type accent gradient — mirrors the recent-battles preview
          treatment (horizontal accent gradient at opacity-80) but uses the
          card's own type color + banner-deep stop, masked along the
          vertical axis so the top edge still fades in cleanly. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 opacity-80"
        style={{
          background: `linear-gradient(90deg, ${accentBg} 0%, ${accentDeep} 100%)`,
          maskImage: "linear-gradient(to bottom, transparent 0%, black 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 100%)",
        }}
      />
      <Link href={href} className="relative block">
        {/* Header — deck name + rank */}
        <div className="flex items-center gap-2 px-3.5 pt-3">
          <p className="flex-1 min-w-0 text-[19px] font-semibold text-text-primary truncate">
            {name}
          </p>
          <span className="ml-2 shrink-0 text-[13px] font-semibold text-text-muted tabular-nums">
            {(representation_pct * 100).toFixed(1)}%
          </span>
        </div>

        {/* Body */}
        <div className="relative flex gap-3.5 p-3.5 pt-3">
          <CardArt url={image_url} name={name} />
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex flex-col gap-0.5">
              <p className="text-[12px] font-bold text-text-primary">
                Top Deck Lists
              </p>
              {creatorList.map((c, i) => (
                <p
                  key={`${c}-${i}`}
                  className="text-[12px] font-medium text-text-secondary truncate"
                >
                  {c}
                </p>
              ))}
            </div>
          </div>
          {icon_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={icon_url}
              alt=""
              aria-hidden
              className="pointer-events-none absolute bottom-2.5 right-2.5 w-14 h-14 object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
            />
          ) : null}
        </div>
      </Link>

      <div className="relative">
        <DeckCardFooter
          metaArchetypeId={id}
          initialLikes={like_count}
          saveHref={href}
          deckName={name}
          hideSave
          hideShare
        />
      </div>
    </div>
  );
}

// ── User Deck Card ────────────────────────────────────────────────────────────

export interface UserDeckCardProps {
  id: string;
  name: string;
  href: string;
  imageUrl?: string | null;
  username: string;
  displayName?: string | null;
  price?: number | null;
  counts?: CardCounts | null;
  wl?: DeckRecordLike | null;
  likeCount?: number;
  isPrivate?: boolean;
  /** Personal bookmark flag (saved_decks.is_favorite) — private to the
   *  owner, distinct from the public Like feature in DeckCardFooter. */
  isFavorite?: boolean;
  /** Whether this is the single deck pinned to the /my-decks hero. Drives
   *  whether the manage menu offers "Pin this deck". */
  isPinned?: boolean;
  /** analysis.rotation.ready — false when the deck contains cards that have
   *  rotated out of Standard. Null when no analysis snapshot exists. */
  legalityReady?: boolean | null;
  archetypeName?: string | null;
  /** Meta-archetype slug — links a "Compare vs meta" action when present. */
  archetypeId?: string | null;
  /** ISO timestamp from saved_decks.updated_at. */
  updatedAt?: string | null;
  /** ISO timestamp from saved_decks.created_at. Used by client-side sort. */
  createdAt?: string | null;
  /** Owner's auth user_id. When this matches the viewer, the card's Save
   *  button reflects ownership rather than offering a clone toggle. */
  ownerUserId?: string;
  /** Limitless sprite URL for the deck's "face" Pokémon — derived from the
   *  cover card. Falls back to the auto-picked primary when no cover is set. */
  iconUrl?: string | null;
  /** Energy-type color used for the avatar circle background. */
  iconBg?: string | null;
  /** Full analysis.cards list. Required when the viewer is the owner so the
   *  edit modal can populate the cover-image picker. */
  cards?: Array<{
    qty: number;
    name: string;
    number: string;
    setCode: string;
    section: "pokemon" | "trainer" | "energy";
  }>;
  /** Persisted cover override (null when auto-picked). */
  coverImageUrl?: string | null;
  /** Raw deck list text. Required for the manage menu (copy + edit). */
  deckList?: string;
  /** Current visibility — drives the manage menu's Make public/private item. */
  isPublic?: boolean;
  /** When true, render the ⋯ manage menu (owner-only context). */
  canManage?: boolean;
  /** Position in the grid — drives the entrance-animation stagger delay. */
  index?: number;
}

export function DeckBanner({
  imageUrl,
  name,
  iconBg,
  wl,
  isFavorite,
  onToggleFavorite,
  showFavorite,
  avatarItems,
  className = "",
}: {
  imageUrl: string | null;
  name: string;
  iconBg: string | null;
  wl?: DeckRecordLike | null;
  isFavorite: boolean;
  onToggleFavorite: (e: React.MouseEvent) => void;
  showFavorite: boolean;
  avatarItems: AvatarStackItem[];
  /** Extra classes merged onto the root — lets callers override the default
   *  fixed height (e.g. stretch full-height in a desktop side-by-side
   *  layout) without affecting the grid card's own fixed-height use. */
  className?: string;
}) {
  const accentBg = iconBg ?? "#B0A89E";
  const accentDeep = shade(accentBg, -35);
  const hasRecord = !!wl && wl.w + wl.l + wl.d > 0;
  return (
    <div
      className={`relative h-[150px] overflow-hidden ${className}`}
      style={{ background: `linear-gradient(120deg, ${accentDeep} 0%, ${accentBg} 100%)` }}
    >
      <div
        aria-hidden
        className="absolute rounded-lg overflow-hidden bg-white"
        style={{
          width: 166,
          height: 229,
          left: "44%",
          top: "50%",
          opacity: 0.2,
          filter: "grayscale(1)",
          transform: "translate(-50%, 0%) scale(3) rotate(-4deg)",
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        ) : null}
      </div>
      {showFavorite && (
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFavorite}
          className={`absolute top-2.5 left-2.5 z-10 w-7 h-7 rounded-full bg-white/90 flex items-center justify-center text-[13px] transition-colors ${
            isFavorite ? "text-accent" : "text-black/25 hover:text-black/40"
          }`}
        >
          <svg
            className="w-[15px] h-[15px]"
            viewBox="0 0 24 24"
            fill={isFavorite ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
          </svg>
        </button>
      )}
      {hasRecord && (
        <span className="absolute top-2.5 right-2.5 z-10 rounded-full bg-black px-3 py-[5px] text-[12px] font-bold text-white tabular-nums">
          {wl!.w}–{wl!.l}
        </span>
      )}
      <div
        className="absolute rounded-lg overflow-hidden bg-white shadow-[0_8px_18px_rgba(0,0,0,0.3)]"
        style={{
          width: 166,
          height: 229,
          left: "39%",
          bottom: 0,
          transform: "translate(-50%, 40%) rotate(-4deg)",
        }}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="w-full h-full object-cover" />
        ) : null}
      </div>
      <div className="absolute right-3 bottom-2.5 z-10 flex">
        <AvatarStack items={avatarItems} count={3} />
      </div>
    </div>
  );
}

export function UserDeckCard({
  id,
  name: initialName,
  href,
  imageUrl: initialImageUrl,
  counts,
  wl,
  isFavorite: initialIsFavorite = false,
  isPinned = false,
  iconUrl,
  iconBg,
  cards,
  coverImageUrl: initialCoverImageUrl,
  deckList,
  isPublic = true,
  canManage = false,
  index,
}: UserDeckCardProps) {
  const router = useRouter();
  const name = initialName;
  const imageUrl = initialImageUrl ?? null;
  const coverImageUrl = initialCoverImageUrl ?? null;
  const [isFavorite, setIsFavorite] = useState(initialIsFavorite);
  const [logOpen, setLogOpen] = useState(false);

  const avatarItems = useMemo(
    () => buildAvatarItems(cards, coverImageUrl, iconUrl, iconBg),
    [cards, coverImageUrl, iconUrl, iconBg],
  );

  async function toggleFavorite(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !isFavorite;
    setIsFavorite(next);
    const res = await fetch(`/api/saved-decks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_favorite: next }),
    });
    if (!res.ok) setIsFavorite(!next);
  }

  async function handleQuickLog(data: MatchFormData) {
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saved_deck_id: id, ...data }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error ?? "Failed to log match.");
    }
    setLogOpen(false);
    router.refresh();
  }

  return (
    <div
      className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      style={useFadeIn(index)}
    >
      <DeckBanner
        imageUrl={imageUrl}
        name={name}
        iconBg={iconBg ?? null}
        wl={wl}
        isFavorite={isFavorite}
        onToggleFavorite={toggleFavorite}
        showFavorite={canManage}
        avatarItems={avatarItems}
      />

      {/* Body — deck name + (owner) manage menu, then composition ring. */}
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <Link
          href={href}
          className="flex-1 min-w-0 text-[19px] font-semibold text-text-primary truncate hover:underline underline-offset-2"
        >
          {name}
        </Link>
        {canManage && deckList != null && (
          <div className="shrink-0 -mr-1">
            <DeckCardMenu
              deckId={id}
              deckName={name}
              deckList={deckList}
              isPublic={isPublic}
              isPinned={isPinned}
              cards={cards ?? []}
              coverImageUrl={coverImageUrl}
            />
          </div>
        )}
      </div>

      <Link href={href} className="block">
        {counts && (
          <div className="flex items-center gap-3.5 px-3.5 py-1">
            <CompositionRing counts={counts} />
            <CompositionLegend counts={counts} />
          </div>
        )}
      </Link>

      <div className="flex items-stretch border-t border-black/5">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setLogOpen((v) => !v);
          }}
          className="flex-1 py-2.5 text-[13px] font-semibold text-text-primary hover:bg-black/[0.03] transition-colors"
        >
          Log match
        </button>
        <QRCodeButton
          shareUrl={href}
          className="flex-1 inline-flex items-center justify-center gap-1.5 py-2.5 text-[13px] font-semibold text-text-primary hover:bg-black/[0.03] transition-colors border-l border-black/5"
        />
      </div>

      {logOpen && (
        <div className="border-t border-black/5 p-3.5">
          <MatchEntry
            savedDeckId={id}
            onSubmitManual={handleQuickLog}
            onImported={() => {
              setLogOpen(false);
              router.refresh();
            }}
            onCancel={() => setLogOpen(false)}
            scrollToTopOnCancel={false}
          />
        </div>
      )}
    </div>
  );
}

