-- Deck version control, part 3: fork lineage + deck-level archetype identity.
--
-- Fork lineage replaces the clone concept: forked_from_deck_id/_version_id
-- record "forked from deck X @ version Y" permanently (SET NULL if the
-- source disappears). Existing cloned_from_id data is migrated here;
-- cloned_from_id itself is kept and dual-written until the deployed
-- DeckCardFooter bundles (which query it from the browser) cycle out, then
-- dropped in a later cleanup migration.
--
-- Archetype identity is deck-level ("the repo IS the archetype"):
-- auto-detected from the list with owner override (archetype_source).
-- meta_archetype_id is deliberately NOT reused — it means "materialized
-- from meta deck X" and the meta-clone DELETE route removes every deck
-- carrying a given value, so stamping it on hand-built decks would nuke
-- user data.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

alter table public.saved_decks
  add column if not exists forked_from_deck_id    uuid references public.saved_decks(id)   on delete set null,
  add column if not exists forked_from_version_id uuid references public.deck_versions(id) on delete set null,
  add column if not exists archetype_id           text,
  add column if not exists archetype_name         text,
  add column if not exists archetype_source       text not null default 'auto'
    check (archetype_source in ('auto', 'manual')),
  add column if not exists primary_pokemon_name   text;

create index if not exists saved_decks_forked_from_idx
  on public.saved_decks (forked_from_deck_id);

-- Migrate clone lineage → fork lineage. Version anchor is the source's v1:
-- the versions backfill snapshotted each deck's current content as v1, so
-- it is the closest truthful record of what was cloned.
update public.saved_decks d
set forked_from_deck_id = d.cloned_from_id,
    forked_from_version_id = (
      select v.id from public.deck_versions v
      where v.deck_id = d.cloned_from_id and v.version_number = 1
    )
where d.cloned_from_id is not null
  and d.forked_from_deck_id is null;

-- Seed archetype identity from the frozen analysis snapshot where the
-- fuzzy meta match succeeded. primary_pokemon_name needs the bundled card
-- DB and is filled by application code on future writes.
update public.saved_decks
set archetype_id   = analysis->'metaMatch'->>'archetypeId',
    archetype_name = analysis->'metaMatch'->>'archetypeName'
where archetype_id is null
  and analysis->'metaMatch'->>'matched' = 'true'
  and analysis->'metaMatch'->>'archetypeName' is not null;

-- Fork count for deck pages. SECURITY DEFINER so private forks are counted
-- without exposing their rows — a bare count leaks nothing meaningful.
create or replace function public.deck_fork_count(p_deck_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from public.saved_decks
  where forked_from_deck_id = p_deck_id;
$$;

revoke execute on function public.deck_fork_count(uuid) from public;
grant execute on function public.deck_fork_count(uuid) to anon, authenticated;

commit;
