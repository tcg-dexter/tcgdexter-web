-- Fix: notifications deck_liked upsert dedup
--
-- The original dedup index (20260726_notifications.sql) was PARTIAL:
--
--   create unique index notifications_dedup_idx
--     on notifications (recipient_user_id, actor_user_id, saved_deck_id, type)
--     where actor_user_id is not null and saved_deck_id is not null;
--
-- lib/notifications/notify.ts upserts with
--   onConflict: "recipient_user_id,actor_user_id,saved_deck_id,type"
-- but Postgres cannot infer a PARTIAL index from a bare ON CONFLICT (cols)
-- target (it has no WHERE predicate to match), so the insert raised 42P10
-- ("no unique or exclusion constraint matching the ON CONFLICT
-- specification"). The notify helper swallows the error, so deck-like
-- notifications were silently never written in production.
--
-- Fix: make the index FULL (non-partial). Postgres treats NULLs as distinct
-- in a unique index, so badge/system notifications (actor + deck both null)
-- are unaffected — the constraint only ever binds deck_liked rows, which is
-- exactly the intended (recipient, actor, deck, type) dedup. The existing
-- .upsert() then works unchanged.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

begin;

drop index if exists public.notifications_dedup_idx;

create unique index if not exists notifications_dedup_idx
  on public.notifications (recipient_user_id, actor_user_id, saved_deck_id, type);

commit;
