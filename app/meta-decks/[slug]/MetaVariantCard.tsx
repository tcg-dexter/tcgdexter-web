import Link from "next/link";
import CopyDeckListButton from "@/app/components/CopyDeckListButton";
import DeckCardFooter from "@/app/components/DeckCardFooter";
import SpriteIcon from "./SpriteIcon";

interface CardCounts {
  pokemon: number;
  trainer: number;
  energy: number;
}

interface Props {
  /** Stable key — typically `${archetypeSlug}-v${index}`. */
  id: string;
  /** Archetype slug — drives the Save action's meta clone endpoint. */
  archetypeId: string;
  /** Parent archetype display name — used as the header title when this
   *  variant has no specific sub-archetype tag from Limitless. */
  archetypeName: string;
  /** Annotation appended after the archetype name (e.g. "ex"). Optional. */
  annotation?: string;
  /** Sub-archetype label scraped from Limitless's variant dropdown
   *  (e.g. "Dragapult Blaziken"). When present this is the header title;
   *  when null we fall back to the parent archetype name. */
  variantName?: string | null;
  /** Pokémon icon for the archetype — shown in the header next to the
   *  variant title. Mirrors UserDeckCard's deck-icon avatar. */
  iconUrl?: string | null;
  /** Background color behind the header icon (typing tint). */
  iconBg?: string | null;
  /** Tournament + date label as scraped from limitlesstcg.com. Placing
   *  (e.g. "2nd") is folded into this string by the caller so the header
   *  right slot is free for the copy-list action. */
  contextLabel?: string | null;
  /** Player name. Shown in the body next to an initials avatar, matching
   *  UserDeckCard's `@username` slot. */
  creator: string;
  /** Full deck list text — handed to CopyDeckListButton for the
   *  clipboard write. Same format the carousel below the bio uses. */
  deckList: string;
  /** Primary card image for THIS variant's deck list (pokemontcg.io). */
  cardImageUrl: string | null;
  /** Pokémon / Trainer / Energy totals for the variant's card list. */
  counts: CardCounts;
  /**
   * Optional click-through. When omitted the card is visual-only.
   * (TODO: wire to a `/meta-decks/[slug]/[variantIndex]` sub-route or a
   * limitless decklist URL once `listId` is preserved by the scraper.)
   */
  href?: string;
}

// Deterministic palette for the player-initial avatar — same pattern used
// by UserDeckCard in app/components/DeckPostCard.tsx so card chrome
// matches across the site.
const AVATAR_PALETTE = [
  "#3b6fd4", "#d43b9a", "#27ae60", "#e67e22", "#9b59b6", "#c0392b",
];
function avatarBg(name: string): string {
  const h = name.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

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
          <span
            key={label}
            className="h-5 flex items-center text-[13px] font-bold text-text-primary tabular-nums"
          >
            {n}
          </span>
        ))}
      </div>
      <div className="flex flex-col items-start">
        {rows.map(({ label }) => (
          <span
            key={label}
            className="h-5 flex items-center text-[10px] uppercase tracking-[0.05em] font-semibold text-text-muted"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Preview card for one of the top-5 meta deck variants.
 *
 * Visual style mirrors UserDeckCard (the variant we use for user-created
 * decks) so meta deck profiles read like a Twitter "Posts" feed where each
 * post is a known player's build of the archetype.
 */
export default function MetaVariantCard({
  archetypeId,
  archetypeName,
  annotation,
  variantName,
  iconUrl,
  iconBg,
  contextLabel,
  creator,
  deckList,
  cardImageUrl,
  counts,
  href,
}: Props) {
  const fallbackName = annotation
    ? `${archetypeName} ${annotation}`
    : archetypeName;
  const headerName = (variantName ?? "").trim() || fallbackName;
  const displayCreator = creator || "Trainer";
  const initials = displayCreator.trim().charAt(0).toUpperCase() || "T";
  const playerBg = avatarBg(displayCreator);

  // Body mirrors UserDeckCard: small avatar + @creator above TypeCounts,
  // tournament context pinned to the bottom.
  const body = (
    <div className="flex gap-3.5 p-3.5 pt-3">
      <CardArt url={cardImageUrl} name={headerName} />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-1.5 mb-2">
          <div
            className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
            style={{ background: playerBg }}
            aria-hidden
          >
            {initials}
          </div>
          <p className="text-[13px] font-semibold text-text-muted truncate">
            {displayCreator}
          </p>
        </div>
        <TypeCounts counts={counts} />
        {contextLabel && (
          <p className="mt-auto text-[11px] text-text-muted truncate">
            {contextLabel}
          </p>
        )}
      </div>
    </div>
  );

  // Header avatar is the archetype's Pokémon icon — same pattern as
  // UserDeckCard, where the deck's primary Pokémon sits next to its name.
  const headerAvatar = (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden ring-1 ring-black/[0.06]"
      style={{ background: iconBg ?? "#B0A89E" }}
      aria-hidden
    >
      {iconUrl ? (
        <SpriteIcon src={iconUrl} className="w-[22px] h-[22px] object-contain" />
      ) : null}
    </div>
  );

  return (
    <div className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow">
      {/* Header — archetype icon + variant name + copy-list button. */}
      <div className="flex items-center gap-2 px-3.5 pt-3">
        {href ? (
          <Link href={href} aria-label={`Open ${headerName}`} className="shrink-0">
            {headerAvatar}
          </Link>
        ) : (
          headerAvatar
        )}
        {href ? (
          <Link
            href={href}
            className="flex-1 min-w-0 text-[17px] font-semibold text-text-primary truncate hover:underline underline-offset-2"
          >
            {headerName}
          </Link>
        ) : (
          <p className="flex-1 min-w-0 text-[17px] font-semibold text-text-primary truncate">
            {headerName}
          </p>
        )}
        {/* Trailing slot — kept flush with the header's px-3.5 inset so the
            copy icon's right edge mirrors the avatar circle's left edge. */}
        <div className="shrink-0">
          <CopyDeckListButton deckList={deckList} iconOnly />
        </div>
      </div>

      {/* Body — primary card art + creator handle + counts + tournament.
          Wrapped in a <Link> when href is set so the body is one big
          click target on top of the header's per-element targets. */}
      {href ? (
        <Link href={href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}

      <DeckCardFooter
        metaArchetypeId={archetypeId}
        initialLikes={0}
        saveHref={href ?? `/meta-decks/${archetypeId}`}
        deckName={headerName}
        hideLikes
      />
    </div>
  );
}
