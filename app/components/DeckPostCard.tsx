"use client";

import Link from "next/link";
import { useMemo } from "react";
import DeckCardFooter from "./DeckCardFooter";
import AvatarStack, { type AvatarStackItem } from "./AvatarStack";
import { deckAvatarInfo } from "@/lib/primaryCardImage";
import { metaTopPokemonByCount } from "@/lib/metaPrimaryCard";
import { shade } from "@/lib/color";

// ── Shared types ──────────────────────────────────────────────────────────────

export type CardCounts = { pokemon: number; trainer: number; energy: number };
export type WinLoss = { w: number; l: number; d: number };

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

function TypeCounts({ counts, size = "sm" }: { counts: CardCounts; size?: "sm" | "md" }) {
  const rows = [
    { label: "Pokémon", n: counts.pokemon },
    { label: "Trainer", n: counts.trainer },
    { label: "Energy", n: counts.energy },
  ];
  const numCls =
    size === "md"
      ? "h-6 flex items-center text-[16px] font-bold text-text-primary tabular-nums"
      : "h-5 flex items-center text-[13px] font-bold text-text-primary tabular-nums";
  const labelCls =
    size === "md"
      ? "h-6 flex items-center text-[12px] uppercase tracking-[0.05em] font-semibold text-text-muted"
      : "h-5 flex items-center text-[10px] uppercase tracking-[0.05em] font-semibold text-text-muted";
  return (
    <div className="flex gap-2 mb-2.5">
      <div className="flex flex-col items-end">
        {rows.map(({ label, n }) => (
          <span key={label} className={numCls}>
            {n}
          </span>
        ))}
      </div>
      <div className="flex flex-col items-start">
        {rows.map(({ label }) => (
          <span key={label} className={labelCls}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function WLCircles({ wl }: { wl: WinLoss }) {
  if (wl.w + wl.l + wl.d === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <div
        className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center"
        style={{
          background: "linear-gradient(90deg,#F2A20C 0%,#D91E0D 50%,#A60D0D 100%)",
        }}
      >
        <span className="text-[11px] font-extrabold text-white">W</span>
      </div>
      <span className="text-[19px] font-bold tabular-nums text-text-primary">{wl.w}</span>
      <div className="w-6 h-6 rounded-full bg-black shrink-0 flex items-center justify-center">
        <span className="text-[11px] font-extrabold text-white">L</span>
      </div>
      <span className="text-[19px] font-bold tabular-nums text-text-primary">{wl.l}</span>
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
}: MetaDeckCardProps) {
  const creatorList = (creators && creators.length > 0 ? creators : ["Trainer"]).slice(0, 5);
  const href = `/meta-archetypes/${id}`;
  const accentBg = icon_bg ?? "#B0A89E";
  const accentDeep = shade(accentBg, -22);
  return (
    <div className="relative rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Energy-type accent gradient — sits over the bottom half of the
          card, fading from the avatar's type color at 0 opacity (midpoint)
          through the full type color to the banner's deeper bottom stop
          (shade -22) at the card's bottom edge. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background: `linear-gradient(to bottom, ${accentBg}00 0%, ${accentBg} 50%, ${accentDeep} 100%)`,
        }}
      />
      <Link href={href} className="relative block">
        {/* Header — pokémon avatar + deck name + rank */}
        <div className="flex items-center gap-2 px-3.5 pt-3">
          {icon_url ? (
            <div
              className="w-9 h-9 rounded-full shrink-0 flex items-center justify-center overflow-hidden ring-1 ring-black/[0.06] shadow-sm"
              style={{ background: icon_bg ?? "#B0A89E" }}
              aria-hidden
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={icon_url}
                alt=""
                className="w-7 h-7 object-contain"
              />
            </div>
          ) : null}
          <p className="flex-1 min-w-0 text-[17px] font-semibold text-text-primary truncate">
            {name}
          </p>
          <span className="ml-2 shrink-0 text-[13px] font-semibold text-text-muted tabular-nums">
            {(representation_pct * 100).toFixed(1)}%
          </span>
        </div>

        {/* Body */}
        <div className="flex gap-3.5 p-3.5 pt-3">
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
  wl?: WinLoss | null;
  likeCount?: number;
  isPrivate?: boolean;
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
}

export function UserDeckCard({
  id,
  name: initialName,
  href,
  imageUrl: initialImageUrl,
  counts,
  wl,
  likeCount = 0,
  ownerUserId,
  iconUrl,
  iconBg,
  cards,
  coverImageUrl: initialCoverImageUrl,
}: UserDeckCardProps) {
  const name = initialName;
  const imageUrl = initialImageUrl ?? null;
  const coverImageUrl = initialCoverImageUrl ?? null;

  // Avatar 1 = the existing primary sprite. Slots 2 & 3 are picked from a
  // larger candidate pool (next Pokémon by total copy count, deduped
  // against avatar 1's evolution line — same logic as MetaVariantCard).
  // We over-fetch the pool so AvatarStack can shift forward when a sprite
  // 404s on the limitless host (some forms / regionals aren't covered).
  const avatarItems = useMemo<AvatarStackItem[]>(() => {
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
    const pool = metaTopPokemonByCount(
      adapted,
      5,
      primary ? [primary.name] : [],
    );
    return [
      primaryItem,
      ...pool.map((a) => ({ key: a.name, iconUrl: a.iconUrl, iconBg: a.iconBg })),
    ];
  }, [cards, coverImageUrl, iconUrl, iconBg]);

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Header — deck name + 3-avatar stack (primary + top-2 by copy count). */}
      <div className="flex items-center gap-3 px-3.5 pt-3">
        <Link
          href={href}
          className="flex-1 min-w-0 text-[17px] font-semibold text-text-primary truncate hover:underline underline-offset-2"
        >
          {name}
        </Link>
        <Link
          href={href}
          aria-label={`Open ${name}`}
          className="shrink-0 flex items-center"
        >
          <AvatarStack items={avatarItems} count={3} />
        </Link>
      </div>

      {/* Body */}
      <Link href={href} className="block">
        <div className="flex gap-3.5 p-3.5 pt-3">
          <CardArt url={imageUrl} name={name} />
          <div className="flex-1 min-w-0 flex flex-col">
            {counts && <TypeCounts counts={counts} size="md" />}
            <div className="mt-auto flex justify-end">
              {wl ? <WLCircles wl={wl} /> : null}
            </div>
          </div>
        </div>
      </Link>

      <DeckCardFooter
        deckId={id}
        ownerUserId={ownerUserId}
        initialLikes={likeCount}
        saveHref={href}
        deckName={name}
        hideSave
      />

    </div>
  );
}

