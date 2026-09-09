import type { SpotlightSubmissionStatus } from "./types";

/** Display label + pill styling for each point in the participant
 *  lifecycle. Shared by the admin list and the spotlight editor so the two
 *  read the same. */
export const SUBMISSION_STATUS_META: Record<
  SpotlightSubmissionStatus,
  { label: string; pill: string; blurb: string }
> = {
  not_invited: {
    label: "Not invited",
    pill: "border-black/15 text-text-muted dark:border-white/15",
    blurb:
      "This trainer hasn't been invited to fill anything out yet. Inviting opens the onboarding form at /spotlight/onboarding for them.",
  },
  invited: {
    label: "Invited",
    pill: "border-amber-500/40 text-amber-700 bg-amber-500/5 dark:text-amber-400",
    blurb: "Waiting on the trainer to fill out and submit their content.",
  },
  submitted: {
    label: "Submitted",
    pill: "border-sky-500/40 text-sky-700 bg-sky-500/5 dark:text-sky-400",
    blurb:
      "Their content is in. Copy what you want into the spotlight below, edit it, then send it back for approval.",
  },
  in_review: {
    label: "With trainer",
    pill: "border-violet-500/40 text-violet-700 bg-violet-500/5 dark:text-violet-400",
    blurb:
      "The trainer is reviewing your edited version. Their answers are locked while they do.",
  },
  approved: {
    label: "Approved",
    pill: "border-emerald-500/40 text-emerald-700 bg-emerald-500/5 dark:text-emerald-400",
    blurb: "The trainer signed off. Ready to publish whenever you are.",
  },
};
