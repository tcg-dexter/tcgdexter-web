"use client";

import Link from "next/link";
import DeckCardFooter from "@/app/components/DeckCardFooter";
import AvatarStack, { type AvatarStackItem } from "@/app/components/AvatarStack";
import type { MetaAvatar } from "@/lib/metaPrimaryCard";
import { useFadeIn } from "@/lib/useFadeIn";

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
   *  body. */
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

  const hasAccolade = Boolean(placingLine || competitionName || dateLine);
  const body = (
    <div className="flex gap-3.5 p-3.5 pt-3">
      <CardArt url={cardImageUrl} name={headerName} />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="mt-auto flex flex-col items-end text-right leading-tight">
          {hasAccolade && (
            <>
              {placingLine && (
                <span className="text-[11px] font-semibold text-text-primary truncate">
                  {placingLine}
                </span>
              )}
              {competitionName && (
                <span className="text-[11px] text-text-secondary truncate">
                  {competitionName}
                </span>
              )}
              {dateLine && (
                <span className="text-[11px] text-text-muted truncate">
                  {dateLine}
                </span>
              )}
            </>
          )}
          <AvatarStack items={avatarItems} count={3} bare />
        </div>
      </div>
    </div>
  );

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

  return (
    <div
      className="rounded-2xl border border-black/8 bg-white/90 backdrop-blur-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow"
      style={useFadeIn(index)}
    >
      <div className="flex items-stretch gap-3 px-3.5 pt-3">
        {href ? (
          <Link href={href} className="flex-1 min-w-0 block">
            {headerTitle}
          </Link>
        ) : (
          headerTitle
        )}
      </div>

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
        saveHref={href ?? `/meta-archetypes/${archetypeId}`}
        deckName={headerName}
        hideLikes
      />
    </div>
  );
}

