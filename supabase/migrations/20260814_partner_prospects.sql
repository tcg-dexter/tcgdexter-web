-- Partnerships: creator/site outreach prospects.
--
-- Tracks PTCG content creators, tools, podcasts and newsletters who might
-- want to share TCG Dexter with their audience. This is a distinct motion
-- from the existing email CRM (email_campaigns / email_sends), which is
-- structurally scoped to signed-up users — email_sends.recipient_user_id is
-- a FK to auth.users, so it cannot hold a prospect who isn't a user.
-- Outreach here is DM/social-first, so there is deliberately no email
-- column; add one later if that changes (one-line migration).
--
-- Every row's reach figures and links come from third-party sources
-- (creator lists, the creator's own social bio) that could not be directly
-- verified at seed time — see links_verified / source_url below. Nothing is
-- fabricated to fill a gap: an unconfirmed field is left null.
--
-- RLS is enabled with zero policies, matching the live state of every other
-- service-role-only table (email_campaigns, email_sends, ml_runs,
-- ops_runs, analysis_submissions) as of this migration — access goes
-- through the service-role client only, gated by the dashboard subdomain's
-- DASHBOARD_ADMIN_EMAILS allowlist, and RLS-with-no-policies denies
-- anon/authenticated by default while the service-role key still bypasses
-- RLS entirely, so this is belt-and-braces rather than a behavior change.
--
-- Apply via Supabase MCP `apply_migration` — there is no CI migration
-- runner for this repo.

begin;

create table if not exists public.partner_prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text,
  kind text not null default 'creator'
    check (kind in ('creator', 'site', 'podcast', 'newsletter')),
  tier text
    check (tier is null or tier in ('macro', 'mid', 'micro')),
  priority text not null default 'medium'
    check (priority in ('high', 'medium', 'low')),
  status text not null default 'prospect'
    check (status in ('prospect', 'contacted', 'replied', 'partnered', 'declined')),
  note text not null default '',
  -- Reach as reported by a third-party source at research time, e.g.
  -- "~2.5M YT subs (3rd-party list, undated)" — directional, not authoritative.
  reach_note text,
  -- Where the reach figure / handle was sourced from, so it can be
  -- spot-checked before outreach.
  source_url text,
  -- Flips to true once a human has confirmed the handle/links actually
  -- resolve. Every seeded row starts false.
  links_verified boolean not null default false,
  youtube_url text,
  twitch_url text,
  tiktok_url text,
  x_url text,
  instagram_url text,
  website_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create index if not exists partner_prospects_priority_idx
  on public.partner_prospects (priority);

create index if not exists partner_prospects_status_idx
  on public.partner_prospects (status);

alter table public.partner_prospects enable row level security;

commit;
