import type { SupabaseClient } from "@supabase/supabase-js";

/** A row from `public.lists`, the minimal shape callers need to hydrate. */
export interface ListRow {
  id: string;
  short_id: string;
  name: string;
  is_public: boolean;
}

/** Summary of a list plus its card membership, for the Lists overview
 *  panel, the Add-to-list picker, and the profile page's Lists section. */
export interface ListSummary {
  id: string;
  shortId: string;
  name: string;
  isPublic: boolean;
  itemCount: number;
  /** null only when `ownerUsername` wasn't provided (e.g. no username set
   *  yet) — the list has no viewable URL until one is. */
  href: string | null;
  /** Up to 4 (set_id, number) pairs, insertion order, for a mosaic thumbnail. */
  previewCards: Array<{ setId: string; number: string }>;
  /** Present only when `opts.checkCard` was passed to hydrateListPreviews. */
  containsCard?: boolean;
}

const PREVIEW_LIMIT = 4;

/**
 * Hydrates raw `lists` rows into `ListSummary`s: one `list_items` query
 * scoped to the given list ids computes each list's item count and preview
 * thumbnails in JS, rather than a separate round-trip per list. Shared by
 * GET /api/lists and the profile page's Lists section so this join lives
 * in exactly one place.
 */
export async function hydrateListPreviews(
  supabase: SupabaseClient,
  ownerUsername: string | null,
  lists: ListRow[],
  opts?: { checkCard?: { setId: string; number: string } },
): Promise<ListSummary[]> {
  if (lists.length === 0) return [];

  const listIds = lists.map((l) => l.id);
  const { data: items } = await supabase
    .from("list_items")
    .select("list_id, set_id, number")
    .in("list_id", listIds)
    .order("created_at", { ascending: true });

  const itemsByList = new Map<string, Array<{ set_id: string; number: string }>>();
  for (const row of (items ?? []) as Array<{
    list_id: string;
    set_id: string;
    number: string;
  }>) {
    const arr = itemsByList.get(row.list_id) ?? [];
    arr.push({ set_id: row.set_id, number: row.number });
    itemsByList.set(row.list_id, arr);
  }

  return lists.map((l): ListSummary => {
    const listItems = itemsByList.get(l.id) ?? [];
    const summary: ListSummary = {
      id: l.id,
      shortId: l.short_id,
      name: l.name,
      isPublic: l.is_public,
      itemCount: listItems.length,
      href: ownerUsername ? `/u/${ownerUsername}/lists/${l.short_id}` : null,
      previewCards: listItems
        .slice(0, PREVIEW_LIMIT)
        .map((i) => ({ setId: i.set_id, number: i.number })),
    };
    if (opts?.checkCard) {
      summary.containsCard = listItems.some(
        (i) => i.set_id === opts.checkCard!.setId && i.number === opts.checkCard!.number,
      );
    }
    return summary;
  });
}
