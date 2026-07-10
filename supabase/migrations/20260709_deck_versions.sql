-- Deck version control, part 1: the deck_versions table.
--
-- A saved deck ("repo") keeps its stable saved_decks row — matches, likes,
-- spotlights, and short_id URLs all key off saved_decks.id. History lives
-- here: one row per version ("commit"), linear per deck (unique
-- version_number). saved_decks.deck_list/analysis remain a denormalized
-- mirror of the LATEST version so every existing read path keeps working;
-- create_deck_version() is the single write path that keeps the mirror and
-- the history in sync atomically.
--
-- Apply via Supabase SQL editor or `supabase db execute < file`.

begin;

create table if not exists public.deck_versions (
  id             uuid primary key default gen_random_uuid(),
  deck_id        uuid not null references public.saved_decks(id) on delete cascade,
  version_number int  not null check (version_number >= 1),
  -- User-supplied version title; null renders as "v{version_number}".
  name           text,
  -- Commit-message analog shown in the history list.
  changelog      text not null default '',
  deck_list      text not null,
  analysis       jsonb,
  created_at     timestamptz not null default now(),
  unique (deck_id, version_number)
);

create index if not exists deck_versions_deck_idx
  on public.deck_versions (deck_id, version_number desc);

alter table public.deck_versions enable row level security;

-- Owner: full control over versions of their own decks.
drop policy if exists "deck_versions_owner_all" on public.deck_versions;
create policy "deck_versions_owner_all"
  on public.deck_versions
  for all
  to authenticated
  using (
    exists (
      select 1 from public.saved_decks d
      where d.id = deck_versions.deck_id
        and d.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.saved_decks d
      where d.id = deck_versions.deck_id
        and d.user_id = auth.uid()
    )
  );

-- Visitors: full history of a public deck is browsable (public repo
-- commits), under the same cascading rule as saved_decks_public_read —
-- deck public AND owner profile public.
drop policy if exists "deck_versions_public_read" on public.deck_versions;
create policy "deck_versions_public_read"
  on public.deck_versions
  for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.saved_decks d
      where d.id = deck_versions.deck_id
        and d.is_public = true
        and exists (
          select 1 from public.profiles p
          where p.id = d.user_id
            and p.is_public = true
        )
    )
  );

-- The single write path for deck content. SECURITY INVOKER: RLS still
-- decides what the caller may touch — a non-owner's insert/update fails
-- even though a public deck row is selectable. The FOR UPDATE lock
-- serializes concurrent saves so version numbers never collide.
create or replace function public.create_deck_version(
  p_deck_id   uuid,
  p_deck_list text,
  p_analysis  jsonb,
  p_name      text default null,
  p_changelog text default ''
)
returns public.deck_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_deck_id uuid;
  v_next    int;
  v_row     public.deck_versions;
begin
  select id into v_deck_id
  from public.saved_decks
  where id = p_deck_id
  for update;

  if v_deck_id is null then
    raise exception 'deck not found';
  end if;

  select coalesce(max(version_number), 0) + 1 into v_next
  from public.deck_versions
  where deck_id = p_deck_id;

  insert into public.deck_versions (deck_id, version_number, name, changelog, deck_list, analysis)
  values (p_deck_id, v_next, nullif(trim(p_name), ''), coalesce(p_changelog, ''), p_deck_list, p_analysis)
  returning * into v_row;

  update public.saved_decks
  set deck_list  = p_deck_list,
      analysis   = p_analysis,
      updated_at = now()
  where id = p_deck_id;

  return v_row;
end;
$$;

revoke execute on function public.create_deck_version(uuid, text, jsonb, text, text) from public;
grant execute on function public.create_deck_version(uuid, text, jsonb, text, text) to authenticated;

-- Backfill: every existing deck's current content becomes its v1, dated to
-- the deck's creation. Idempotent.
insert into public.deck_versions (deck_id, version_number, deck_list, analysis, created_at)
select s.id, 1, s.deck_list, s.analysis, s.created_at
from public.saved_decks s
where not exists (
  select 1 from public.deck_versions v where v.deck_id = s.id
);

commit;
