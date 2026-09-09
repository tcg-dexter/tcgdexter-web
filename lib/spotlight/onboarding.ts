import { createClient } from "@/lib/supabase/server";
import type {
  SpotlightSubmission,
  SpotlightSubmissionStatus,
} from "@/app/spotlight/types";

export interface OnboardingSpotlight {
  id: string;
  slug: string;
  submission: Partial<SpotlightSubmission>;
  submission_status: SpotlightSubmissionStatus;
}

/** Statuses in which the participant may still edit their submission.
 *  Once an admin moves it to in_review the content is frozen — the trainer's
 *  job at that point is to approve or ask for another round. */
export const EDITABLE_STATUSES: SpotlightSubmissionStatus[] = [
  "invited",
  "submitted",
];

type Result =
  | { ok: true; spotlight: OnboardingSpotlight }
  | { ok: false; error: string; status: number };

/**
 * Resolve the signed-in user's own spotlight, if they have been invited to
 * fill one out.
 *
 * Shared by every /api/spotlight/onboarding route and the onboarding page.
 * The lookup is by `profile_id = auth.uid()` under the
 * trainer_spotlights_subject_read policy, so a user can only ever reach their
 * own row — there is no id in the request to tamper with.
 *
 * A `not_invited` spotlight is treated as nonexistent: an admin may have
 * created the draft long before deciding to reach out.
 */
export async function requireInvitedSpotlight(): Promise<Result> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Sign in required.", status: 401 };

  const { data: spotlight } = await supabase
    .from("trainer_spotlights")
    .select("id, slug, submission, submission_status")
    .eq("profile_id", user.id)
    .maybeSingle<OnboardingSpotlight>();

  if (!spotlight || spotlight.submission_status === "not_invited") {
    return { ok: false, error: "No spotlight invitation found.", status: 404 };
  }
  return { ok: true, spotlight };
}
