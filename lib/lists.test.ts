import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hydrateListPreviews, type ListRow } from "./lists";

interface FakeItem {
  list_id: string;
  set_id: string;
  number: string;
}

/** Minimal chainable stand-in for the one query hydrateListPreviews issues:
 *  supabase.from("list_items").select(...).in("list_id", ids).order(...). */
function fakeSupabase(items: FakeItem[]): SupabaseClient {
  return {
    from: (table: string) => {
      if (table !== "list_items") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          in: (_col: string, ids: string[]) => ({
            order: () => ({
              data: items.filter((i) => ids.includes(i.list_id)),
              error: null,
            }),
          }),
        }),
      };
    },
  } as unknown as SupabaseClient;
}

const LIST_A: ListRow = { id: "a", short_id: "aaa11111", name: "Want List", is_public: true };
const LIST_B: ListRow = { id: "b", short_id: "bbb22222", name: "Trade Bait", is_public: false };

describe("hydrateListPreviews", () => {
  it("returns [] for an empty lists array", async () => {
    const result = await hydrateListPreviews(fakeSupabase([]), "dexter", []);
    expect(result).toEqual([]);
  });

  it("computes itemCount and caps previewCards at 4, scoped per list", async () => {
    const items: FakeItem[] = [
      { list_id: "a", set_id: "sv1", number: "1" },
      { list_id: "a", set_id: "sv1", number: "2" },
      { list_id: "a", set_id: "sv1", number: "3" },
      { list_id: "a", set_id: "sv1", number: "4" },
      { list_id: "a", set_id: "sv1", number: "5" },
      { list_id: "b", set_id: "sv2", number: "9" },
    ];
    const result = await hydrateListPreviews(fakeSupabase(items), "dexter", [LIST_A, LIST_B]);

    const a = result.find((r) => r.id === "a")!;
    expect(a.itemCount).toBe(5);
    expect(a.previewCards).toEqual([
      { setId: "sv1", number: "1" },
      { setId: "sv1", number: "2" },
      { setId: "sv1", number: "3" },
      { setId: "sv1", number: "4" },
    ]);
    expect(a.href).toBe("/u/dexter/lists/aaa11111");
    expect(a.isPublic).toBe(true);

    const b = result.find((r) => r.id === "b")!;
    expect(b.itemCount).toBe(1);
    expect(b.isPublic).toBe(false);
  });

  it("href is null when ownerUsername is null (no username set yet)", async () => {
    const result = await hydrateListPreviews(fakeSupabase([]), null, [LIST_A]);
    expect(result[0].href).toBeNull();
  });

  it("sets containsCard per-list only when opts.checkCard is passed", async () => {
    const items: FakeItem[] = [{ list_id: "a", set_id: "sv1", number: "1" }];

    const withCheck = await hydrateListPreviews(fakeSupabase(items), "dexter", [LIST_A, LIST_B], {
      checkCard: { setId: "sv1", number: "1" },
    });
    expect(withCheck.find((r) => r.id === "a")!.containsCard).toBe(true);
    expect(withCheck.find((r) => r.id === "b")!.containsCard).toBe(false);

    const withoutCheck = await hydrateListPreviews(fakeSupabase(items), "dexter", [LIST_A]);
    expect(withoutCheck[0].containsCard).toBeUndefined();
  });
});
