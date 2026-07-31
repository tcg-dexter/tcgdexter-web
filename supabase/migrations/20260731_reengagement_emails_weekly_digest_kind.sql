-- Allow the weekly digest mailer to log/dedup its sends in
-- public.reengagement_emails alongside the streak + near-badge kinds.
alter table public.reengagement_emails
  drop constraint reengagement_emails_kind_check;

alter table public.reengagement_emails
  add constraint reengagement_emails_kind_check
  check (kind = any (array['streak_at_risk'::text, 'near_badge'::text, 'weekly_digest'::text]));
