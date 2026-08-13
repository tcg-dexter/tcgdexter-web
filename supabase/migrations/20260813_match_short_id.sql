-- Add `short_id` to matches so battle URLs stop exposing the row UUID.
--
-- /battles/[id] was addressed by the match's UUID, which is both long and
-- leaks an internal identifier into a link people share. The route now
-- resolves by short_id first and falls back to id for UUID-shaped values,
-- so every link shared before this migration keeps working forever while
-- new ones are the short form (e.g. /battles/k8m2x7q9).
--
-- Same 8-char nanoid-style generator already used by saved_decks
-- (20260620_saved_deck_short_id.sql) and lists (20260810_lists.sql):
-- 64^8 ≈ 2.8 × 10^14 keys, ample against birthday collisions.
--
-- Applies to every match, not just battle-log ones — a match's identity
-- shouldn't depend on whether it happens to have a parsed log attached.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

CREATE OR REPLACE FUNCTION generate_match_short_id()
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
ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS short_id TEXT;

-- 2. Backfill — VOLATILE function is evaluated per row, so each match
--    gets its own random id.
UPDATE matches
SET short_id = generate_match_short_id()
WHERE short_id IS NULL;

-- 3. Promote to NOT NULL + UNIQUE. Future inserts pick up the default.
ALTER TABLE matches
  ALTER COLUMN short_id SET NOT NULL,
  ALTER COLUMN short_id SET DEFAULT generate_match_short_id();

CREATE UNIQUE INDEX IF NOT EXISTS matches_short_id_unique
  ON matches (short_id);
