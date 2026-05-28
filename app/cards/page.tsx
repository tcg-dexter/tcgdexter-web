import {
  searchCards,
  getFilterFacets,
  type SortKey,
  type SortDir,
  type OwnershipFilter,
} from "@/lib/cardSearch";
import { createClient } from "@/lib/supabase/server";
import CardsClient from "./CardsClient";

export const metadata = {
  title: "Card Catalog — TCG Dexter",
};

function asArray(v: string | string[] | undefined): string[] | undefined {
  if (v == null) return undefined;
  if (Array.isArray(v)) return v.flatMap((s) => s.split(",")).filter(Boolean);
  return v.split(",").filter(Boolean);
}

function asNumber(v: string | string[] | undefined): number | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  if (s == null || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function asString(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function CardsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const sort = (asString(searchParams.sort) as SortKey | undefined) ?? "released";
  const dir = (asString(searchParams.dir) as SortDir | undefined) ?? "desc";
  const view = asString(searchParams.view) === "list" ? "list" : "grid";
  const page = asNumber(searchParams.page) ?? 1;
  const pageSize = asNumber(searchParams.pageSize) ?? 60;
  const rawOwnership = asString(searchParams.ownership);
  const ownership: OwnershipFilter =
    rawOwnership === "owned" || rawOwnership === "unowned" ? rawOwnership : "all";

  // Only round-trip to Supabase when an ownership filter is active —
  // the catalog renders fine without auth otherwise. If the viewer is
  // signed out, the filter resolves against an empty set: "owned"
  // returns nothing, "unowned" returns everything.
  let ownedKeys: Set<string> | undefined;
  if (ownership !== "all") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    ownedKeys = new Set<string>();
    if (user) {
      // Paginate — PostgREST caps a single response at db.maxRows (default
      // 1000). Without this, large collections silently truncate and the
      // ownership filter drops cards above the cap.
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data } = await supabase
          .from("user_card_collection")
          .select("set_id, number")
          .eq("user_id", user.id)
          .gt("quantity", 0)
          .range(from, from + PAGE - 1);
        if (!data?.length) break;
        for (const row of data) {
          ownedKeys.add(`${row.set_id}-${row.number}`);
        }
        if (data.length < PAGE) break;
      }
    }
  }

  const retreatCostRaw = asArray(searchParams.retreatCost)
    ?.map(Number)
    .filter(Number.isFinite);

  const params = {
    q: asString(searchParams.q),
    supertype: asArray(searchParams.supertype),
    type: asArray(searchParams.type),
    regulation: asArray(searchParams.regulation),
    setId: asArray(searchParams.setId),
    hpMin: asNumber(searchParams.hpMin),
    hpMax: asNumber(searchParams.hpMax),
    priceMin: asNumber(searchParams.priceMin),
    priceMax: asNumber(searchParams.priceMax),
    rarity: asArray(searchParams.rarity),
    retreatCost: retreatCostRaw,
    sort,
    dir,
    page,
    pageSize,
    ownership,
    ownedKeys,
  };

  const result = searchCards(params);
  const facets = getFilterFacets();

  return (
    <CardsClient
      initialResult={result}
      facets={facets}
      initialParams={{
        q: params.q ?? "",
        supertype: params.supertype ?? [],
        type: params.type ?? [],
        regulation: params.regulation ?? [],
        setId: params.setId ?? [],
        hpMin: params.hpMin,
        hpMax: params.hpMax,
        priceMin: params.priceMin,
        priceMax: params.priceMax,
        rarity: params.rarity ?? [],
        retreatCost: params.retreatCost ?? [],
        sort,
        dir,
        page,
        pageSize,
        view,
        ownership,
        variant: [],
      }}
    />
  );
}
