import CollectionSection from "./CollectionSection";
import { loadCollectionStats, loadCollectionValueHistory } from "@/lib/collection";

interface Props {
  userId: string;
  isOwner: boolean;
  collectionPublic: boolean;
  gradientCss: string;
}

/**
 * Data-fetching half of the profile Collection module.
 *
 * Split out from the page body so the two aggregate queries can be awaited
 * inside a `<Suspense>` boundary instead of in front of the whole page. They
 * used to sit in the page's own `await`, which meant the profile's first byte
 * waited on the slowest thing on the page — a collection aggregate that
 * scales with how many printings the user owns, for a module that renders
 * below decks and lists and is often never scrolled to.
 *
 * `CollectionSection` stays purely presentational; this is the only piece
 * that touches the database.
 *
 * The caller is still responsible for the visibility check (canViewCollection)
 * so a hidden module costs no queries at all — reaching this component at all
 * means the viewer is allowed to see it.
 */
export default async function CollectionSectionAsync({
  userId,
  isOwner,
  collectionPublic,
  gradientCss,
}: Props) {
  const [stats, valueHistory] = await Promise.all([
    loadCollectionStats(userId),
    loadCollectionValueHistory(userId),
  ]);

  // null (not zeroes) means the stats couldn't be loaded — see
  // loadCollectionStats. Render nothing rather than an empty-collection
  // claim we can't stand behind.
  if (!stats) return null;

  return (
    <CollectionSection
      stats={stats}
      valueHistory={valueHistory}
      isOwner={isOwner}
      collectionPublic={collectionPublic}
      gradientCss={gradientCss}
    />
  );
}
