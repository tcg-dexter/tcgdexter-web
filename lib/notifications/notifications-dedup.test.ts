import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect } from "vitest";

/**
 * Regression guard for the deck_liked dedup 42P10 trap.
 *
 * History: 20260726_notifications.sql shipped the dedup index as PARTIAL
 * (where actor_user_id is not null and saved_deck_id is not null), but
 * lib/notifications/notify.ts upserts with a bare
 *   onConflict: "recipient_user_id,actor_user_id,saved_deck_id,type"
 * and Postgres CANNOT infer a partial index from an ON CONFLICT (cols) target
 * with no matching WHERE predicate — it raises 42P10. The notify helper
 * swallows the error, so *every* deck_liked notification silently failed to
 * write in production until 20260727_notifications_dedup_fix.sql made the
 * index full. (Verified live: zero notifications were actually lost — no likes
 * occurred during the broken window — but the defect was real.)
 *
 * This test reproduces the exact contract that broke, against REAL Postgres
 * (PGlite, in-process WASM — no external service, runs in plain CI). It applies
 * the actual notifications migration files from disk, then performs the same
 * upsert notify.ts performs, twice, and asserts it collapses to ONE row. If
 * anyone re-partials the deck_liked dedup index (in these files or a future
 * `*notifications*` migration), the second upsert 42P10s and this test fails —
 * the CI signal that was missing the first time.
 *
 * Scope note: this guards the deck_liked ON CONFLICT target specifically. The
 * new_follower dedup index (20260727_user_follows.sql) is *intentionally*
 * partial and safe — notifyNewFollower uses insert + 23505->update, never
 * ON CONFLICT inference — so it is correctly out of this guard's scope.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

// The exact ON CONFLICT target notify.ts.notifyDeckLiked passes to .upsert().
// Kept in sync with lib/notifications/notify.ts by hand — if that changes, this
// should too (and this test is what proves the pairing still works).
const DECK_LIKED_CONFLICT_COLS =
  "recipient_user_id, actor_user_id, saved_deck_id, type";

const OWNER = "00000000-0000-0000-0000-000000000001";
const ACTOR = "00000000-0000-0000-0000-000000000002";
const DECK = "00000000-0000-0000-0000-000000000003";

// Minimal Supabase-shaped shim: the notifications migration FKs auth.users and
// public.saved_decks, and its RLS policies reference the `authenticated` role
// and auth.uid(). None of that exists in a bare Postgres, so stub just enough
// for the real DDL to apply unchanged.
const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create table if not exists public.saved_decks (id uuid primary key);
  do $$ begin
    if not exists (select from pg_roles where rolname = 'authenticated')
      then create role authenticated;
    end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select null::uuid $$;
`;

/** Every migration that touches the notifications table, in apply order. */
function notificationMigrationSql(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && f.includes("notifications"))
    .sort()
    .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_SHIM);
  await db.exec(`
    insert into auth.users (id) values ('${OWNER}'), ('${ACTOR}');
    insert into public.saved_decks (id) values ('${DECK}');
  `);
  for (const sql of notificationMigrationSql()) await db.exec(sql);
  return db;
}

// Mirrors notify.ts.notifyDeckLiked's upsert(...).onConflict(...): insert a
// deck_liked row, on conflict refresh read_at/created_at (re-surface as unread).
const UPSERT_DECK_LIKED = `
  insert into public.notifications
    (recipient_user_id, actor_user_id, type, saved_deck_id, data, read_at, created_at)
  values ($1, $2, 'deck_liked', $3, '{}'::jsonb, null, now())
  on conflict (${DECK_LIKED_CONFLICT_COLS})
  do update set read_at = excluded.read_at, created_at = excluded.created_at;
`;

describe("notifications deck_liked dedup index", () => {
  it(
    "supports the ON CONFLICT upsert notify.ts uses — two likes collapse to one row",
    async () => {
      const db = await freshDb();
      // First like → insert. Second like (re-like) → must dedup, not 42P10.
      await db.query(UPSERT_DECK_LIKED, [OWNER, ACTOR, DECK]);
      await db.query(UPSERT_DECK_LIKED, [OWNER, ACTOR, DECK]);

      const { rows } = await db.query<{ c: number }>(
        `select count(*)::int as c from public.notifications where type = 'deck_liked'`,
      );
      expect(rows[0].c).toBe(1);
      await db.close();
    },
    30_000, // PGlite's first WASM boot can take a couple seconds.
  );

  it(
    "keeps distinct actors/decks as separate rows (the index isn't over-broad)",
    async () => {
      const db = await freshDb();
      const ACTOR2 = "00000000-0000-0000-0000-000000000004";
      await db.exec(`insert into auth.users (id) values ('${ACTOR2}')`);

      await db.query(UPSERT_DECK_LIKED, [OWNER, ACTOR, DECK]);
      await db.query(UPSERT_DECK_LIKED, [OWNER, ACTOR2, DECK]); // different liker

      const { rows } = await db.query<{ c: number }>(
        `select count(*)::int as c from public.notifications where type = 'deck_liked'`,
      );
      expect(rows[0].c).toBe(2);
      await db.close();
    },
    30_000,
  );
});
