# Spec: ML pipeline follow-up for deck-versioning + fork-lineage removal

## Context

Deck-list version control (`deck_versions` table, `?v={n}` browsing, "commit" UI)
and the unused "GitHub-style fork" feature (`forked_from_deck_id`,
`deck_fork_count()`) have been removed from `tcgdexter-web` and from the live
production database (`tcgdexter-prod`). This doc specs the follow-up work
needed in the ML pipeline as a consequence. It's a plan for the ML/dexter-ml
owner to execute — no pipeline code has been changed as part of this spec.

**Fork lineage needs no ML changes.** Grepped the full ML surface in this
repo (`lib/ml/**`, `lib/battle-log/**`, `lib/engine/**`, `scripts/ml/**`) for
`forked_from_deck_id`, `forked_from_version_id`, and `deck_fork_count` —
zero matches outside the now-deleted `/fork` route. The fork feature was
never wired into feature extraction, training, or telemetry. Only deck
**versioning** requires action below.

## What's already gone

Production `tcgdexter-prod`, as of migrations `20260719_drop_deck_versioning`
and `20260719_drop_fork_lineage`:
- Table `public.deck_versions` — dropped.
- Function `public.create_deck_version(...)` — dropped.
- Column `public.matches.saved_deck_version_id` — dropped.
- Column `public.saved_decks.forked_from_version_id` — dropped (was already
  unused after the fork migration's own dual-write window).
- `public.saved_decks.deck_list` / `.analysis` are now written directly by
  the app (no more version-mirror step) — same columns, same shape, just no
  longer updated via a version-insert side effect.

## Two repos are involved

This repo (`tcgdexter-web`) only holds **shared library code** the exporter
reuses (`lib/battle-log`, `lib/engine`, `lib/ml/features`) plus one CLI
script, `scripts/ml/extract.ts`. The actual Supabase → SQLite export job
that produces `feature_store.sqlite` lives in the sibling `dexter-ml` repo
(referenced only by relative path — `../dexter-ml` — from this one; not in
this session's scope, not inspected as part of this spec). Both repos need
changes; only the `tcgdexter-web` side is described here in detail.

## Required change 1 — `scripts/ml/extract.ts` (this repo)

Two blocks read fields that no longer exist in Supabase and therefore will
be absent (or stale/frozen) in any `feature_store.sqlite` exported *after*
the dexter-ml side is updated (see Required change 2):

- **Lines 146–172 (deck extraction)**: unions `saved_decks` rows with
  `deck_versions` rows (`SELECT id, deck_id, deck_list FROM deck_versions`),
  tagging each output row with `deck_version_id`. Once the exporter stops
  populating a `deck_versions` table in the store, this second loop becomes
  dead (query against a table that no longer exists in the store schema →
  hard failure, not a silent no-op).
- **Line 236 (match extraction)**: `deck_version_id: str(m.saved_deck_version_id)`
  reads a `matches` store column that no longer has a live Supabase source.

**Action**: once `feature_store.sqlite`'s schema (in dexter-ml) drops
`deck_versions` and `matches.saved_deck_version_id` (see change 2), update
`extract.ts` to match:
- Delete the `deck_versions` query and the `deckSources` union — decks
  become a straight `SELECT id, deck_list FROM saved_decks ORDER BY id` with
  one row per current deck.
- Drop `deck_version_id` from both the deck-row and match-row schemas (or
  keep the field name but always emit `null`, if downstream training code
  keys on that column's presence for backward-compat during a transition —
  the exporter and training-code owner should agree on which before
  changing this file, since both `decks.jsonl` and `matches.jsonl` are
  consumed downstream).
- Update the header comment (lines 1–17) — it currently documents
  `decks.jsonl` as "one row per saved_deck **and per deck_version**"; that
  becomes just "one row per saved_deck."

This is a small, mechanical change (~15 lines) but it must land **after**
change 2, not before — doing it first would silently make every deck row's
`deck_version_id` field always-null while the store still has real
version history in it, which is a confusing intermediate state for anyone
training against a stale store.

## Required change 2 — `dexter-ml` repo (out of scope here, flag for its owner)

The Phase 0 exporter that builds `feature_store.sqlite` from Supabase must
stop querying `deck_versions` and `matches.saved_deck_version_id` — those
now error (relation/column does not exist) against `tcgdexter-prod`. This
is the blocking change; `extract.ts` here is a downstream consumer and
doesn't matter until the store itself changes shape. Concretely, the
exporter needs to:
- Drop its `deck_versions` table (or query) from the export.
- Drop `saved_deck_version_id` from its `matches` export/table.
- Bump whatever version marker gates store/schema compatibility (`extract.ts`
  already checks `meta.parser_version` / `meta.engine_version` against the
  `lib` constants and warns on mismatch — if the store has its own schema
  version, bump it too, so an old `feature_store.sqlite` snapshot doesn't
  silently get read by a new `extract.ts` that assumes the new shape).

## Backward compatibility for existing exports

Any `feature_store.sqlite` snapshot exported **before** this cleanup still
has a real `deck_versions` table and populated `saved_deck_version_id`
values, and will continue to work with the *current* (unmodified)
`extract.ts` indefinitely — nothing about the Supabase-side drop breaks
already-exported snapshots, since `extract.ts` never talks to Supabase
directly. Sequencing is: update dexter-ml's exporter → re-export a fresh
store → then update `extract.ts` here to match the new store shape. Do not
update `extract.ts` against an old snapshot still carrying the legacy
tables/columns, or the union/columns described above will just go quietly
empty instead of erroring, which is easy to miss.

## Non-actions (confirmed, no change needed)

- `lib/ml/features/*` — pure functions over deck lists / battle logs /
  replay state. No version or fork awareness anywhere in the schema
  (`DeckFeatures`, `MatchLogFeatures`, `TurnFeatures`, `MatchLabels`).
  Nothing to change.
- `lib/ml/communityDecks.ts:75` — comment reads
  `// exact-content duplicate (forks/clones)`; this is describing generic
  content-hash deduplication (any two decks with identical lists, however
  they came to exist), not a reference to the removed fork feature or its
  columns. Cosmetic wording only if anyone wants to reword it later — not
  functionally stale.
- `app/api/admin/ml/runs/route.ts` — reads the `ml_runs` telemetry table
  (run_type: export/train/eval/promote). No version/fork columns involved.
- `scripts/ml/selfplay.ts`, `scripts/ml/policy_duel.ts` — grepped, no
  matches for any of the removed identifiers.
