-- Trainer Spotlight: curated editorial feature highlighting a community player.
-- One row per featured profile. Admin-curated (gated by profiles.is_admin).

create table if not exists public.trainer_spotlights (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references public.profiles(id) on delete cascade,
  slug text not null unique,
  headline text,
  favorite_pokemon jsonb,
  favorite_collection_card jsonb,
  favorite_format_card jsonb,
  featured_deck_ids uuid[] not null default '{}'::uuid[],
  qa jsonb not null default '[]'::jsonb,
  is_published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint trainer_spotlights_featured_deck_ids_max_3
    check (array_length(featured_deck_ids, 1) is null
           or array_length(featured_deck_ids, 1) <= 3)
);

create index if not exists trainer_spotlights_published_idx
  on public.trainer_spotlights (published_at desc nulls last)
  where is_published = true;

create or replace function public.trainer_spotlights_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trainer_spotlights_updated_at on public.trainer_spotlights;
create trigger trainer_spotlights_updated_at
  before update on public.trainer_spotlights
  for each row execute function public.trainer_spotlights_set_updated_at();

alter table public.trainer_spotlights enable row level security;

-- Public read: anyone (including anon) can read published spotlights.
drop policy if exists "trainer_spotlights_public_read" on public.trainer_spotlights;
create policy "trainer_spotlights_public_read"
  on public.trainer_spotlights for select
  to anon, authenticated
  using (is_published = true);

-- Admin read: admins see drafts too.
drop policy if exists "trainer_spotlights_admin_read" on public.trainer_spotlights;
create policy "trainer_spotlights_admin_read"
  on public.trainer_spotlights for select
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin = true)
  );

-- Admin write: only admins can insert / update / delete.
drop policy if exists "trainer_spotlights_admin_insert" on public.trainer_spotlights;
create policy "trainer_spotlights_admin_insert"
  on public.trainer_spotlights for insert
  to authenticated
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "trainer_spotlights_admin_update" on public.trainer_spotlights;
create policy "trainer_spotlights_admin_update"
  on public.trainer_spotlights for update
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin = true)
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "trainer_spotlights_admin_delete" on public.trainer_spotlights;
create policy "trainer_spotlights_admin_delete"
  on public.trainer_spotlights for delete
  to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid() and p.is_admin = true)
  );
