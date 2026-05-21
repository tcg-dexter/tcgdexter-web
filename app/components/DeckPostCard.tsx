import Link from "next/link";
import DeckCardFooter from "./DeckCardFooter";

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

function TypeCounts({ counts }: { counts: CardCounts }) {
  const rows = [
    { label: "Pokémon", n: counts.pokemon },
    { label: "Trainer", n: counts.trainer },
    { label: "Energy", n: counts.energy },
  ];
  return (
    <div className="flex gap-2 mb-2.5">
      <div className="flex flex-col items-end">
        {rows.map(({ label, n }) => (
          <span key={label} className="h-5 flex items-center text-[13px] font-bold text-text-primary tabular-nums">
            {n}
          </span>
        ))}
      </div>
      <div className="flex flex-col items-start">
        {rows.map(({ label }) => (
          <span key={label} className="h-5 flex items-center text-[10px] uppercase tracking-[0.05em] font-semibold text-text-muted">
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
  const href = `/meta-decks/${id}`;
  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <Link href={href} className="block">
        {/* Header — pokémon avatar + deck name + rank */}
        <div className="flex items-center gap-2 px-3.5 pt-3">
          {icon_url ? (
            <div
              className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center overflow-hidden ring-1 ring-black/[0.06]"
              style={{ background: icon_bg ?? "#B0A89E" }}
              aria-hidden
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={icon_url}
                alt=""
                className="w-[22px] h-[22px] object-contain"
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
                Top 5 Deck Lists
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

      <DeckCardFooter
        metaArchetypeId={id}
        initialLikes={like_count}
        saveHref={href}
        deckName={name}
      />
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
}

export function UserDeckCard({
  id,
  name,
  href,
  imageUrl,
  username,
  displayName,
  price,
  counts,
  wl,
  likeCount = 0,
  ownerUserId,
}: UserDeckCardProps) {
  const initials = (displayName ?? username).charAt(0).toUpperCase();
  const bg = avatarBg(username);

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      <Link href={href} className="block">
        {/* Header — deck name */}
        <div className="flex items-center gap-2 px-3.5 pt-3">
          <p className="flex-1 min-w-0 text-[17px] font-semibold text-text-primary truncate">
            {name}
          </p>
          {price != null && price > 0 && (
            <span className="ml-2 shrink-0 text-[17px] font-bold text-text-primary">
              ${Math.round(price)}
            </span>
          )}
        </div>

        {/* Body */}
        <div className="flex gap-3.5 p-3.5 pt-3">
          <CardArt url={imageUrl} name={name} />
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-1.5 mb-2">
              <div
                className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
                style={{ background: bg }}
              >
                {initials}
              </div>
              <p className="text-[13px] font-semibold text-text-muted truncate">
                @{username}
              </p>
            </div>
            {counts && <TypeCounts counts={counts} />}
            <div className="mt-auto">
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
      />
    </div>
  );
}
