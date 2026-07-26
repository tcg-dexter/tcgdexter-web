-- Onboarding dismissal
--
-- Lets a user permanently hide the "Get Started" checklist on /my-decks.
-- Cross-device (survives re-login), unlike a localStorage flag. The
-- checklist also auto-hides once its steps are complete, so this is just
-- the explicit "hide it now" control. Mirrors the email_reengagement
-- boolean-preference pattern.

alter table public.profiles
  add column if not exists onboarding_dismissed boolean not null default false;
