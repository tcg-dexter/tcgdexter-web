-- CRM: email campaigns + per-recipient sends.
--
-- v1 is "manual-now, API-ready" — campaigns store subject/body so a later
-- API sender (Resend, Postmark, etc.) can pick them up without a schema
-- change. email_sends has nullable timestamp columns for the events an API
-- sender would populate (opened_at, replied_at, bounced_at,
-- provider_message_id). For now only sent_at is toggled, by an admin
-- clicking "mark sent" in the dashboard CRM.
--
-- RLS is OFF on both tables. All access goes through service-role on the
-- dashboard subdomain, gated by the DASHBOARD_ADMIN_EMAILS env allowlist.

create table if not exists public.email_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  subject text not null default '',
  body text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'complete')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  completed_at timestamptz
);

create index if not exists email_campaigns_created_at_idx
  on public.email_campaigns (created_at desc);

create table if not exists public.email_sends (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.email_campaigns(id) on delete cascade,
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  sent_at timestamptz,
  opened_at timestamptz,
  replied_at timestamptz,
  bounced_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique (campaign_id, recipient_user_id)
);

create index if not exists email_sends_campaign_id_idx
  on public.email_sends (campaign_id);

create index if not exists email_sends_recipient_user_id_idx
  on public.email_sends (recipient_user_id);

-- Per-recipient "last send" lookup driver for the contact dashboard.
create index if not exists email_sends_recipient_sent_at_idx
  on public.email_sends (recipient_user_id, sent_at desc);
