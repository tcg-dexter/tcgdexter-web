-- Add `short_id` to saved_decks for human-readable share URLs.
--
-- /u/[username]/[idOrShortId] now resolves by short_id first and falls
-- back to id for legacy UUID-shaped links — so already-shared URLs keep
-- working forever while every newly-generated share is the short form
-- (e.g. /u/dexter/k8m2x7q9).
--
-- Generated via a small inlined nanoid-style function: 8 chars from the
-- URL-safe alphabet [A-Za-z0-9_-] gives 64^8 ≈ 2.8 × 10^14 keys, plenty
-- of headroom against birthday collisions at any plausible deck count.

CREATE OR REPLACE FUNCTION generate_saved_deck_short_id()
RETURNS text AS $$
DECLARE
  alphabet text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  id text := '';
  i int := 0;
  bytes bytea;
BEGIN
  bytes := gen_random_bytes(8);
  WHILE i < 8 LOOP
    id := id || substr(alphabet, 1 + (get_byte(bytes, i) & 63), 1);
    i := i + 1;
  END LOOP;
  RETURN id;
END;
$$ LANGUAGE PLPGSQL VOLATILE;

-- 1. Add nullable column so existing rows aren't broken.
ALTER TABLE saved_decks
  ADD COLUMN IF NOT EXISTS short_id TEXT;

-- 2. Backfill — VOLATILE function is evaluated per row, so each saved
--    deck gets its own random id.
UPDATE saved_decks
SET short_id = generate_saved_deck_short_id()
WHERE short_id IS NULL;

-- 3. Promote to NOT NULL + UNIQUE. Future inserts pick up the default.
ALTER TABLE saved_decks
  ALTER COLUMN short_id SET NOT NULL,
  ALTER COLUMN short_id SET DEFAULT generate_saved_deck_short_id();

CREATE UNIQUE INDEX IF NOT EXISTS saved_decks_short_id_unique
  ON saved_decks (short_id);
