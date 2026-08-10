import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, it, expect } from "vitest";

/**
 * Regression guard for the lists/list_items schema (20260810_lists.sql,
 * 20260810_list_items.sql), applied against REAL Postgres (PGlite, in-process
 * WASM — no external service) the same way
 * lib/notifications/notifications-dedup.test.ts guards the deck_liked index.
 *
 * Unlike deck_liked's dedup index (partial — see CLAUDE.md's ON CONFLICT
 * trap), list_items' primary key `(list_id, set_id, number)` is deliberately
 * FULL/non-partial, so app/api/lists/[id]/items/route.ts's POST handler can
 * catch a plain 23505 unique-violation as "already in this list" without any
 * ON CONFLICT inference. This test proves that contract holds against the
 * real migration files — if list_items' PK is ever made partial (or gains a
 * WHERE clause), the duplicate insert below raises 42P10 instead of 23505
 * and this test fails.
 */

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const OWNER = "00000000-0000-0000-0000-000000000001";

const SUPABASE_SHIM = `
  create schema if not exists auth;
  create table if not exists auth.users (id uuid primary key);
  create table if not exists public.profiles (
    id uuid primary key references auth.users(id),
    is_public boolean not null default false
  );
  do $$ begin
    if not exists (select from pg_roles where rolname = 'authenticated')
      then create role authenticated;
    end if;
    if not exists (select from pg_roles where rolname = 'anon')
      then create role anon;
    end if;
  end $$;
  create or replace function auth.uid() returns uuid
    language sql stable as $$ select null::uuid $$;
`;

/**
 * Every migration that touches the lists/list_items tables, in apply order.
 * Sorted with `_lists.sql` files forced ahead of `_list_items.sql` files —
 * list_items FKs lists, so it must always apply second regardless of
 * filename, and a plain lexicographic sort gets this backwards (the
 * underscore in "_list_items" sorts before the "s" in "_lists" for any
 * shared date prefix).
 */
function listsMigrationSql(): string[] {
  const rank = (f: string) => (f.includes("_list_items.sql") ? 1 : 0);
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && (f.includes("_lists.sql") || f.includes("_list_items.sql")))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8"));
}

async function freshDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("create extension if not exists pgcrypto;");
  await db.exec(SUPABASE_SHIM);
  await db.exec(`insert into auth.users (id) values ('${OWNER}');`);
  await db.exec(`insert into public.profiles (id, is_public) values ('${OWNER}', true);`);
  for (const sql of listsMigrationSql()) await db.exec(sql);
  return db;
}

describe("lists / list_items schema", () => {
  it(
    "generate_list_short_id() and default short_id both work end to end",
    async () => {
      const db = await freshDb();
      const { rows } = await db.query<{ id: string; short_id: string }>(
        `insert into public.lists (user_id, name) values ($1, 'Want List') returning id, short_id`,
        [OWNER],
      );
      expect(rows[0].short_id).toMatch(/^[A-Za-z0-9_-]{8}$/);
      await db.close();
    },
    30_000,
  );

  it(
    "list_items' (list_id, set_id, number) PK is a plain unique-violation (23505), not the partial-index 42P10 trap",
    async () => {
      const db = await freshDb();
      const { rows } = await db.query<{ id: string }>(
        `insert into public.lists (user_id, name) values ($1, 'Trade Bait') returning id`,
        [OWNER],
      );
      const listId = rows[0].id;

      await db.query(
        `insert into public.list_items (list_id, set_id, number) values ($1, 'sv1', '25')`,
        [listId],
      );

      // Mirrors app/api/lists/[id]/items/route.ts's POST handler: a second
      // add of the same card is caught as 23505 and treated as success.
      await expect(
        db.query(
          `insert into public.list_items (list_id, set_id, number) values ($1, 'sv1', '25')`,
          [listId],
        ),
      ).rejects.toMatchObject({ code: "23505" });

      const { rows: countRows } = await db.query<{ c: number }>(
        `select count(*)::int as c from public.list_items where list_id = $1`,
        [listId],
      );
      expect(countRows[0].c).toBe(1);
      await db.close();
    },
    30_000,
  );

  it(
    "deleting a list cascades to its list_items",
    async () => {
      const db = await freshDb();
      const { rows } = await db.query<{ id: string }>(
        `insert into public.lists (user_id, name) values ($1, 'Cascade Test') returning id`,
        [OWNER],
      );
      const listId = rows[0].id;
      await db.query(
        `insert into public.list_items (list_id, set_id, number) values ($1, 'sv1', '1'), ($1, 'sv1', '2')`,
        [listId],
      );

      await db.query(`delete from public.lists where id = $1`, [listId]);

      const { rows: countRows } = await db.query<{ c: number }>(
        `select count(*)::int as c from public.list_items where list_id = $1`,
        [listId],
      );
      expect(countRows[0].c).toBe(0);
      await db.close();
    },
    30_000,
  );
});
