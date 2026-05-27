import { NextResponse } from "next/server";
import { searchCards, type SortKey, type SortDir } from "@/lib/cardSearch";

export const dynamic = "force-dynamic";

function multi(sp: URLSearchParams, key: string): string[] | undefined {
  const v = sp.get(key);
  if (!v) return undefined;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

function num(sp: URLSearchParams, key: string): number | undefined {
  const v = sp.get(key);
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;
  const result = searchCards({
    q: sp.get("q") ?? undefined,
    supertype: multi(sp, "supertype"),
    type: multi(sp, "type"),
    regulation: multi(sp, "regulation"),
    setId: multi(sp, "setId"),
    hpMin: num(sp, "hpMin"),
    hpMax: num(sp, "hpMax"),
    priceMin: num(sp, "priceMin"),
    priceMax: num(sp, "priceMax"),
    sort: (sp.get("sort") as SortKey | null) ?? undefined,
    dir: (sp.get("dir") as SortDir | null) ?? undefined,
    page: num(sp, "page"),
    pageSize: num(sp, "pageSize"),
  });
  return NextResponse.json(result);
}
