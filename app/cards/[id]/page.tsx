import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getCardById,
  getCardsByArtist,
  getCardsByName,
  getRawCard,
} from "@/lib/cardsIndex";
import { cardImageFallbacks, cardImageSmall } from "@/lib/cardImages";
import BackButton from "@/app/components/ui/BackButton";
import { createClient } from "@/lib/supabase/server";
import CardImage from "../CardImage";
import CardDetailPanel from "../CardDetailPanel";
import AddToListButton from "../AddToListButton";
import { findCardAppearances } from "@/lib/cardAppearances";
import { hydrateListPreviews, type ListRow, type ListSummary } from "@/lib/lists";
import AppearsInCarousel from "./AppearsInCarousel";
import ListsCarousel from "./ListsCarousel";
import PriceHistoryChart from "./PriceHistoryChart";
import { shopListingsForCard } from "@/lib/shopListings";
import { getCardPriceHistory } from "@/lib/priceHistory";
import ShopListingsPanel from "../ShopListingsPanel";

interface Props {
  params: { id: string };
}

export async function generateMetadata({ params }: Props) {
  const id = decodeURIComponent(params.id);
  const card = getCardById(id);
  if (!card) return { title: "Card — TCG Dexter" };
  return {
    title: `${card.name} (${card.setName} ${card.number}) — TCG Dexter`,
  };
}

export default async function CardDetailPage({ params }: Props) {
  const id = decodeURIComponent(params.id);
  const card = getCardById(id);
  const raw = getRawCard(id);
  if (!card || !raw) notFound();

  const supabase = await createClient();
  const [
    {
      data: { user },
    },
    priceHistory,
  ] = await Promise.all([
    supabase.auth.getUser(),
    getCardPriceHistory(card.setId, card.number, card.name),
  ]);

  // First "Appears in" batch (top meta variants containing this exact
  // printing). Server-render the first 10 so the section paints with the
  // page; the client carousel pulls the next batches on scroll.
  const appearancesInitial = findCardAppearances(
    card.ptcgoCode ?? "",
    card.number,
    0,
    10,
  );

  // Empty for almost every card — the shop stocks a few hundred printings.
  const shopListings = shopListingsForCard(card.setId, card.number);

  // The viewer's own lists that already contain this printing. Signed-out
  // visitors and users whose lists don't include it get nothing — RLS scopes
  // the query to the caller, so this is never another user's lists.
  let listsWithCard: ListSummary[] = [];
  if (user) {
    const [{ data: viewerProfile }, { data: listsRaw }] = await Promise.all([
      supabase.from("profiles").select("username").eq("id", user.id).maybeSingle(),
      supabase
        .from("lists")
        .select("id, short_id, name, is_public")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    const hydrated = await hydrateListPreviews(
      supabase,
      (viewerProfile?.username as string | undefined) ?? null,
      (listsRaw ?? []) as ListRow[],
      { checkCard: { setId: card.setId, number: card.number } },
    );
    listsWithCard = hydrated.filter((l) => l.containsCard);
  }

  const otherPrintings = getCardsByName(card.name).filter((c) => c.id !== card.id);
  // Pull other cards illustrated by the same artist. Cap to ~3 rows at lg
  // (8 cols) so a prolific illustrator's catalog doesn't take over the
  // page. Excludes any printing of the current card so the section sits
  // cleanly alongside "More {name}".
  const moreByArtist = card.artist
    ? getCardsByArtist(card.artist)
        .filter((c) => c.nameLower !== card.nameLower)
        .slice(0, 24)
    : [];

  return (
    <main className="mx-auto max-w-5xl px-4 sm:px-6 pt-[calc(env(safe-area-inset-top)_+_1.68rem)] md:pt-[calc(env(safe-area-inset-top)_+_3rem)] xl:pt-[calc(env(safe-area-inset-top)_+_0.75rem)] pb-24">
      {/* Desktop-only — back button flushes to the top of the available
          space (matching deck profile pages); on mobile the BackButton
          portals into the sticky toolbar. */}
      <div className="hidden xl:block mb-8">
        <BackButton href="/cards" ariaLabel="Back to Cards" />
      </div>

      <CardDetailPanel
        card={card}
        raw={raw}
        renderCardImage={(image) => (
          <AddToListButton
            setId={card.setId}
            number={card.number}
            isAuthenticated={Boolean(user)}
            image={image}
          />
        )}
      />

      <ShopListingsPanel listings={shopListings} />

      {appearancesInitial.items.length > 0 && (
        <AppearsInCarousel
          setCode={card.ptcgoCode ?? ""}
          number={card.number}
          initialItems={appearancesInitial.items}
          initialHasMore={appearancesInitial.hasMore}
        />
      )}

      <ListsCarousel lists={listsWithCard} />

      <PriceHistoryChart points={priceHistory} />

      {moreByArtist.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            More by {card.artist}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {moreByArtist.map((c, i) => (
              <Link
                key={c.id}
                href={`/cards/${encodeURIComponent(c.id)}`}
                className="block rounded-lg overflow-hidden bg-surface hover:shadow-md transition-shadow"
                style={{ aspectRatio: "245 / 342" }}
                title={`${c.name} — ${c.setName} ${c.number}`}
              >
                <CardImage
                  src={cardImageSmall(c.setId, c.number)}
                  fallbackSrcs={cardImageFallbacks(c.setId, c.number)}
                  alt={`${c.name} — ${c.setName} ${c.number}`}
                  name={c.name}
                  setName={c.setName}
                  number={c.number}
                  index={i}
                  className="w-full h-full object-contain"
                />
              </Link>
            ))}
          </div>
        </div>
      )}

      {otherPrintings.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-text-primary mb-3">
            More {card.name}
          </h2>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {otherPrintings.map((c, i) => (
              <Link
                key={c.id}
                href={`/cards/${encodeURIComponent(c.id)}`}
                className="block rounded-lg overflow-hidden bg-surface hover:shadow-md transition-shadow"
                style={{ aspectRatio: "245 / 342" }}
                title={`${c.setName} ${c.number}`}
              >
                <CardImage
                  src={cardImageSmall(c.setId, c.number)}
                  fallbackSrcs={cardImageFallbacks(c.setId, c.number)}
                  alt={`${c.name} — ${c.setName} ${c.number}`}
                  name={c.name}
                  setName={c.setName}
                  number={c.number}
                  index={i}
                  className="w-full h-full object-contain"
                />
              </Link>
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
