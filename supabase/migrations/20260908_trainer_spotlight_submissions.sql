-- Trainer Spotlight: participant-submitted onboarding content.
--
-- Until now a spotlight was assembled entirely by an admin, from content the
-- featured trainer sent over DM in response to the Trainer Spotlight prep PDF.
-- This adds an in-app path for that: the featured trainer fills out a form at
-- /spotlight/onboarding and their raw answers land in `submission`.
--
-- `submission` is deliberately SEPARATE from the published columns
-- (headline / bio / qa / favorite_*_cards). The admin copies fields across in
-- the editor, so the editorial pass never destroys the trainer's original
-- words -- which is what lets us honour the PDF's promise that they get to
-- approve any edits made.
--
-- Lifecycle (`submission_status`) is independent of `is_published`:
--   not_invited -> invited -> submitted -> in_review -> approved
-- An approved spotlight is still a draft until an admin presses Publish.
-- Text column + CHECK rather than a Postgres enum, matching the house pattern
-- in email_campaigns.status and partner_prospects.status.
--
-- Apply via Supabase MCP apply_migration (no CI migration runner).

alter table public.trainer_spotlights
  add column if not exists submission jsonb not null default '{}'::jsonb,
  add column if not exists submission_status text not null default 'not_invited',
  add column if not exists invited_at timestamptz,
  add column if not exists submitted_at timestamptz,
  add column if not exists approved_at timestamptz,
  add column if not exists approval_note text;

alter table public.trainer_spotlights
  drop constraint if exists trainer_spotlights_submission_status_check;
alter table public.trainer_spotlights
  add constraint trainer_spotlights_submission_status_check
  check (submission_status in
    ('not_invited', 'invited', 'submitted', 'in_review', 'approved'));

-- Subject read: the featured trainer can read their own spotlight row even
-- while it is an unpublished draft, so the onboarding page can load it.
--
-- Read ONLY. There is deliberately no subject UPDATE policy: RLS cannot
-- restrict which columns an UPDATE touches, so a row-level write policy here
-- would also let the trainer rewrite slug, qa, or is_published. All
-- participant writes go through /api/spotlight/onboarding, which verifies
-- profile_id = auth.uid() and then writes the whitelisted columns with the
-- service-role client -- the same shape as the admin avatar route.
drop policy if exists "trainer_spotlights_subject_read" on public.trainer_spotlights;
create policy "trainer_spotlights_subject_read"
  on public.trainer_spotlights for select
  to authenticated
  using (profile_id = auth.uid());
