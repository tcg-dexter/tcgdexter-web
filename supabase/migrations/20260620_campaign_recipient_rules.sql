-- Campaign recipient rules.
--
-- v1.1 introduces auto-enrollment campaigns: a campaign can declare a
-- recipient_type that drives which auth.users get pulled in as email_sends
-- rows without manual selection.
--
--   manual         — the existing behavior; recipients are added one at a
--                    time from the contact dashboard.
--   signup_window  — every user whose auth.users.created_at falls between
--                    signup_window_start and signup_window_end (inclusive)
--                    is auto-enrolled. The sync runs opportunistically on
--                    every CRM landing and campaign-detail page load —
--                    there's no DB trigger, so no superuser needed.
--
-- Sync skips campaigns with status='complete' so finished campaigns stop
-- enrolling. The date columns are nullable for non-window campaigns; the
-- check constraint forces both bounds present when type = 'signup_window'.

alter table public.email_campaigns
  add column if not exists recipient_type text not null default 'manual'
    check (recipient_type in ('manual', 'signup_window')),
  add column if not exists signup_window_start date,
  add column if not exists signup_window_end date,
  add constraint email_campaigns_signup_window_chk
    check (
      recipient_type <> 'signup_window'
      or (signup_window_start is not null and signup_window_end is not null
          and signup_window_end >= signup_window_start)
    );
