-- Drop the verified head-to-head "shared matches" feature
-- (shared_matches, match_evidence, match_judge_rulings, the
-- claim_shared_match()/lookup_shared_match_by_code() RPCs, and the
-- match-evidence storage bucket's policies — all introduced in
-- 20260505_verified_shared_matches.sql). It was never wired into any UI
-- (no create/join-match screen, no evidence-upload form, no judge-ruling
-- admin page, and the RPCs are called nowhere in the app) — backend
-- scaffolding only.
--
-- The match-evidence bucket row itself must be removed via the Storage
-- API (direct SQL deletion from storage.buckets is blocked by a
-- protect_delete trigger) — done separately, not in this migration.
--
-- profiles.is_admin, also added by that migration, is unrelated (load-
-- bearing across many other admin features) and stays in place.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

drop function if exists public.claim_shared_match(text, uuid);
drop function if exists public.lookup_shared_match_by_code(text);

drop table if exists public.match_judge_rulings;
drop table if exists public.match_evidence;
drop table if exists public.shared_matches;

drop policy if exists "match_evidence_storage_read" on storage.objects;
drop policy if exists "match_evidence_storage_insert" on storage.objects;

commit;
