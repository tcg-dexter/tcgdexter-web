import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared, hoisted mock state (vi.mock is hoisted above imports, so its factory
// can only close over vi.hoisted() values, not ordinary top-level consts).
const h = vi.hoisted(() => ({
  writes: [] as Array<{ op: string; table: string; row: Record<string, unknown>; opts?: unknown }>,
  deckRow: null as Record<string, unknown> | null,
  actorRow: null as Record<string, unknown> | null,
  upsertError: null as unknown,
  insertError: null as unknown,
  updateError: null as unknown,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      const builder: Record<string, unknown> = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          if (table === "saved_decks") return Promise.resolve({ data: h.deckRow, error: null });
          if (table === "profiles") return Promise.resolve({ data: h.actorRow, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        upsert(row: Record<string, unknown>, opts: unknown) {
          h.writes.push({ op: "upsert", table, row, opts });
          return Promise.resolve({ error: h.upsertError });
        },
        insert(row: Record<string, unknown>) {
          h.writes.push({ op: "insert", table, row });
          return Promise.resolve({ error: h.insertError });
        },
        update(row: Record<string, unknown>) {
          h.writes.push({ op: "update", table, row });
          // Chainable + awaitable: .eq().eq().eq() then await.
          const chain: Record<string, unknown> = {
            eq() {
              return chain;
            },
            then(resolve: (v: { error: unknown }) => void) {
              resolve({ error: h.updateError });
            },
          };
          return chain;
        },
      };
      return builder;
    },
  }),
}));

import {
  notifyDeckLiked,
  notifyBadgeUnlocked,
  notifyNewFollower,
  formatNotificationMessage,
} from "./notify";

beforeEach(() => {
  h.writes = [];
  h.deckRow = null;
  h.actorRow = null;
  h.upsertError = null;
  h.insertError = null;
  h.updateError = null;
});

describe("formatNotificationMessage", () => {
  it("renders a deck_liked message from the display name", () => {
    expect(
      formatNotificationMessage({
        type: "deck_liked",
        data: { actor_display_name: "Ash", deck_name: "Charizard ex" },
      }),
    ).toBe("Ash liked your deck Charizard ex");
  });

  it("falls back to username, then 'Someone', for deck_liked", () => {
    expect(
      formatNotificationMessage({
        type: "deck_liked",
        data: { actor_display_name: null, actor_username: "ash_k", deck_name: "Lugia" },
      }),
    ).toBe("ash_k liked your deck Lugia");
    expect(
      formatNotificationMessage({
        type: "deck_liked",
        data: { actor_display_name: null, actor_username: null, deck_name: "Lugia" },
      }),
    ).toBe("Someone liked your deck Lugia");
  });

  it("renders a badge_unlocked message", () => {
    expect(
      formatNotificationMessage({
        type: "badge_unlocked",
        data: { badge_key: "first_save", badge_name: "First Save" },
      }),
    ).toBe("You earned the First Save badge");
  });

  it("renders a new_follower message, falling back to username then 'Someone'", () => {
    expect(
      formatNotificationMessage({
        type: "new_follower",
        data: { actor_display_name: "Misty", actor_username: "misty_c" },
      }),
    ).toBe("Misty started following you");
    expect(
      formatNotificationMessage({
        type: "new_follower",
        data: { actor_display_name: null, actor_username: "misty_c" },
      }),
    ).toBe("misty_c started following you");
    expect(
      formatNotificationMessage({
        type: "new_follower",
        data: { actor_display_name: null, actor_username: null },
      }),
    ).toBe("Someone started following you");
  });

  it("has a generic fallback for unknown types", () => {
    expect(formatNotificationMessage({ type: "future_type", data: {} })).toBe(
      "You have a new notification",
    );
  });
});

describe("notifyDeckLiked", () => {
  it("suppresses self-likes (owner liking their own deck)", async () => {
    h.deckRow = { user_id: "u1", name: "Deck", short_id: "abc" };
    await notifyDeckLiked({ deckId: "d1", actorId: "u1" });
    expect(h.writes).toHaveLength(0);
  });

  it("does nothing when the deck can't be resolved", async () => {
    h.deckRow = null;
    await notifyDeckLiked({ deckId: "gone", actorId: "liker" });
    expect(h.writes).toHaveLength(0);
  });

  it("addresses the notification to the deck OWNER, not the actor", async () => {
    h.deckRow = { user_id: "owner", name: "Miraidon", short_id: "xyz" };
    h.actorRow = { display_name: "Liker", username: "liker", avatar_url: null };
    await notifyDeckLiked({ deckId: "d1", actorId: "liker" });

    expect(h.writes).toHaveLength(1);
    const w = h.writes[0];
    expect(w.op).toBe("upsert");
    expect(w.row.recipient_user_id).toBe("owner");
    expect(w.row.actor_user_id).toBe("liker");
    expect((w.row.data as Record<string, unknown>).deck_name).toBe("Miraidon");
  });

  it("snapshots the deck's hero sprite + type bg from its analysis", async () => {
    h.deckRow = {
      user_id: "owner",
      name: "Charizard ex Blitz",
      short_id: "xyz",
      cover_image_url: null,
      analysis: {
        cards: [
          { qty: 2, name: "Charizard ex", number: "125", setCode: "OBF", section: "pokemon" },
          { qty: 1, name: "Charmander", number: "26", setCode: "MEW", section: "pokemon" },
        ],
      },
    };
    await notifyDeckLiked({ deckId: "d1", actorId: "liker" });

    const data = h.writes[0].row.data as Record<string, unknown>;
    // Highest-stage pick → Charizard ex; suffix stripped → "charizard" slug.
    expect(data.deck_hero_image_url).toBe(
      "https://r2.limitlesstcg.net/pokemon/gen9/charizard.png",
    );
    // OBF 125 Charizard ex is a Darkness-type card (not Fire) — bg follows the
    // resolved card's actual type, confirming we read real card data.
    expect(data.deck_hero_bg).toBe("#0d9488"); // Darkness
  });

  it("leaves hero fields null when the deck has no resolvable cards", async () => {
    h.deckRow = { user_id: "owner", name: "Deck", short_id: "xyz" };
    await notifyDeckLiked({ deckId: "d1", actorId: "liker" });

    const data = h.writes[0].row.data as Record<string, unknown>;
    expect(data.deck_hero_image_url).toBeNull();
    expect(data.deck_hero_bg).toBeNull();
  });

  it("upserts on the dedup conflict target and clears read_at", async () => {
    h.deckRow = { user_id: "owner", name: "Deck", short_id: "xyz" };
    await notifyDeckLiked({ deckId: "d1", actorId: "liker" });

    const w = h.writes[0];
    expect(w.opts).toEqual({
      onConflict: "recipient_user_id,actor_user_id,saved_deck_id,type",
    });
    expect(w.row.read_at).toBeNull();
    expect(w.row.type).toBe("deck_liked");
  });

  it("swallows a write error instead of throwing", async () => {
    h.deckRow = { user_id: "owner", name: "Deck", short_id: "xyz" };
    h.upsertError = { message: "boom" };
    await expect(
      notifyDeckLiked({ deckId: "d1", actorId: "liker" }),
    ).resolves.toBeUndefined();
  });
});

describe("notifyBadgeUnlocked", () => {
  it("inserts a system notification with the resolved badge name and no actor", async () => {
    await notifyBadgeUnlocked({ recipientId: "u1", badgeKey: "first_save" });

    expect(h.writes).toHaveLength(1);
    const w = h.writes[0];
    expect(w.op).toBe("insert");
    expect(w.row.recipient_user_id).toBe("u1");
    expect(w.row.actor_user_id).toBeNull();
    expect(w.row.type).toBe("badge_unlocked");
    expect((w.row.data as Record<string, unknown>).badge_name).toBe("First Save");
  });

  it("swallows a write error instead of throwing", async () => {
    h.insertError = { message: "boom" };
    await expect(
      notifyBadgeUnlocked({ recipientId: "u1", badgeKey: "first_battle" }),
    ).resolves.toBeUndefined();
  });
});

describe("notifyNewFollower", () => {
  it("suppresses a self-follow (recipient === actor)", async () => {
    await notifyNewFollower({ recipientId: "u1", actorId: "u1" });
    expect(h.writes).toHaveLength(0);
  });

  it("inserts addressed to the followed user with the follower snapshot", async () => {
    h.actorRow = { display_name: "Brock", username: "brock_h", avatar_url: "a.png" };
    await notifyNewFollower({ recipientId: "followed", actorId: "follower" });

    expect(h.writes).toHaveLength(1);
    const w = h.writes[0];
    expect(w.op).toBe("insert");
    expect(w.table).toBe("notifications");
    expect(w.row.recipient_user_id).toBe("followed");
    expect(w.row.actor_user_id).toBe("follower");
    expect(w.row.type).toBe("new_follower");
    expect(w.row.saved_deck_id).toBeNull();
    expect(w.row.read_at).toBeNull();
    const data = w.row.data as Record<string, unknown>;
    expect(data.actor_display_name).toBe("Brock");
    expect(data.actor_username).toBe("brock_h");
    expect(data.actor_avatar_url).toBe("a.png");
  });

  it("refreshes the existing row on a 23505 (refollow) instead of stacking", async () => {
    h.actorRow = { display_name: "Brock", username: "brock_h", avatar_url: null };
    h.insertError = { code: "23505", message: "duplicate key" };
    await notifyNewFollower({ recipientId: "followed", actorId: "follower" });

    // One insert attempt (rejected) + one update refresh.
    expect(h.writes.map((w) => w.op)).toEqual(["insert", "update"]);
    const upd = h.writes[1];
    expect(upd.table).toBe("notifications");
    expect(upd.row.read_at).toBeNull();
    expect((upd.row.data as Record<string, unknown>).actor_username).toBe("brock_h");
  });

  it("swallows a non-conflict insert error without updating", async () => {
    h.insertError = { code: "42P01", message: "boom" };
    await expect(
      notifyNewFollower({ recipientId: "followed", actorId: "follower" }),
    ).resolves.toBeUndefined();
    expect(h.writes.map((w) => w.op)).toEqual(["insert"]);
  });
});
