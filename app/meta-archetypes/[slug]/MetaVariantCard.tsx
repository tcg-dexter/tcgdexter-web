"use client";

import Link from "next/link";
import AvatarStack, { type AvatarStackItem } from "@/app/components/AvatarStack";
import DeckCardFooter from "@/app/components/DeckCardFooter";
import type { MetaAvatar } from "@/lib/metaPrimaryCard";
import { shade } from "@/lib/color";
import { useFadeIn } from "@/lib/useFadeIn";

interface Props {
  /** Stable key — typically `${archetypeSlug}-v${index}`. */
  id: string;
  /** Parent archetype slug — used for the Save button's clone endpoint. */
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
  /** Pokémon icon for the archetype — shown in the banner avatar stack. */
  iconUrl?: string | null;
  /** Background color for the banner gradient + avatar circle (typing tint). */
  iconBg?: string | null;
  /** "Nth Place" line for the accolade stack, or null when placing is
   *  unknown. */
  placingLine?: string | null;
  /** Tournament / event name parsed out of the variant's date string. */
  competitionName?: string | null;
  /** Human-readable date for the accolade stack. */
  dateLine?: string | null;
  /** Player name. Rendered as "{creator}'s" above the variant title. */
  creator: string;
  /** Primary card image for THIS variant's deck list (pokemontcg.io). */
  cardImageUrl: string | null;
  /** Up to 2 additional Pokémon avatars (next-highest HP, deduped against
   *  the archetype primary) stacked next to the archetype avatar in the
   *  banner. */
  secondaryAvatars: MetaAvatar[];
  /**
   * Optional click-through. When omitted the card is visual-only.
   * (TODO: wire to a `/meta-archetypes/[slug]/[variantIndex]` sub-route or a
   * limitless decklist URL once `listId` is preserved by the scraper.)
   */
  href?: string;
  /** Position in the grid — drives the entrance-animation stagger delay. */
  index?: number;
}

/**
 * Preview card for one of the top-5 meta deck variants.
 *
 * Adopts the same banner treatment as the main /meta-archetypes cards
 * (MetaDeckCard): full diagonal accent gradient, a scaled/rotated ghost
 * watermark, the rotated hero card art tucked into the bottom edge, and the
 * Pokémon avatar stack in the banner's bottom-right corner. The body reuses
 * the existing "{creator}'s / {deck name}" two-line header with the
 * placement/accolade stack directly beneath it, and a Save Deck + Share
 * footer matching the saved-deck preview cards' footer style.
 */
export default function MetaVariantCard({
  archetypeId,
  archetypeName,
  annotation,
  variantName,
  iconUrl,
  iconBg,
  placingLine,
  competitionName,
  dateLine,
  creator,
  cardImageUrl,
  secondaryAvatars,
  href,
  index,
}: Props) {
  const fallbackName = annotation
    ? `${archetypeName} ${annotation}`
    : archetypeName;
  const headerName = (variantName ?? "").trim() || fallbackName;
  const displayCreator = creator || "Trainer";

  // Unified pool: archetype primary at index 0, then top-N copy-count
  // candidates. AvatarStack renders the first 3 whose sprite loads — when
  // a slot 404s it auto-shifts forward through the rest of the pool.
  const avatarItems: AvatarStackItem[] = [
    { key: "primary", iconUrl: iconUrl ?? null, iconBg: iconBg ?? null },
    ...secondaryAvatars.map((a) => ({
      key: a.name,
      iconUrl: a.iconUrl,
      iconBg: a.iconBg,
    })),
  ];

  const accentBg = iconBg ?? "#B0A89E";
  const accentDeep = shade(accentBg, -35);
  const hasAccolade = Boolean(placingLine || competitionName || dateLine);

  const headerTitle = (
    <div className="flex-1 min-w-0">
      <p
        className="text-xs font-semibold truncate bg-clip-text text-transparent"
        style={{
          backgroundImage:
            "linear-gradient(135deg, #F2A20C 0%, #D91E0D 50%, #A60D0D 100%)",
        }}
      >
        {displayCreator}&apos;s
      </p>
      <p className="text-[17px] font-semibold text-text-primary truncate leading-tight">
        {headerName}
      </p>
    </div>
  );

  const body = (
    <>
      {/* Header — reused two-line creator/deck-name header, now in the body */}
      <div className="flex items-center gap-2 px-3.5 pt-3">{headerTitle}</div>

      {/* Placement stats — directly below the header */}
      {hasAccolade && (
        <div className="flex flex-col items-start text-left leading-tight px-3.5 pt-1.5 pb-3">
          {placingLine && (
            <span className="text-[13px] font-semibold text-text-primary truncate">
              {placingLine}
            </span>
          )}
          {competitionName &&
            competitionName.split(",").map((part, i) => {
              const text = part.trim();
              if (!text) return null;
              return (
                <span
                  key={i}
                  className="text-[13px] text-text-secondary truncate"
                >
                  {text}
                </span>
              );
            })}
          {dateLine && (
            <span className="text-[13px] text-text-muted truncate">
              {dateLine}
            </span>
          )}
        </div>
      )}
    </>
  );

  return (
    <div
      className="relative rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      style={useFadeIn(index)}
    >
      {/* Banner — same treatment as the main meta-archetype preview cards'
          banner: diagonal accent gradient, scaled/rotated ghost watermark,
          rotated hero card tucked into the bottom edge, avatar stack in the
          bottom-right corner. */}
      <div
        aria-hidden
        className="relative h-[150px] overflow-hidden md:[--hero-card-x:42%]"
        style={{ background: `linear-gradient(120deg, ${accentDeep} 0%, ${accentBg} 100%)` }}
      >
        <div
          className="absolute rounded-lg overflow-hidden bg-white"
          style={{
            width: 166,
            height: 229,
            left: "44%",
            top: "50%",
            opacity: 0.2,
            filter: "grayscale(1)",
            transform: "translate(-50%, 5%) scale(3) rotate(-4deg)",
          }}
        >
          {cardImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardImageUrl} alt="" className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div
          className="absolute rounded-lg overflow-hidden bg-white shadow-[0_8px_18px_rgba(0,0,0,0.3)]"
          style={{
            width: "var(--hero-card-w, 166px)",
            height: "var(--hero-card-h, 229px)",
            left: "var(--hero-card-x, 39%)",
            bottom: 0,
            transform: "translate(-50%, 40%) rotate(-4deg)",
          }}
        >
          {cardImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cardImageUrl} alt={headerName} className="w-full h-full object-cover" />
          ) : null}
        </div>
        <div className="absolute right-3 bottom-2.5 z-10 flex">
          <AvatarStack items={avatarItems} count={3} />
        </div>
      </div>

      {href ? (
        <Link href={href} className="block">
          {body}
        </Link>
      ) : (
        body
      )}

      <div className="relative">
        <DeckCardFooter
          metaArchetypeId={archetypeId}
          initialLikes={0}
          saveHref={href ?? `/meta-archetypes/${archetypeId}`}
          deckName={headerName}
          hideLikes
          saveLabel="Save Deck"
        />
      </div>
    </div>
  );
}
