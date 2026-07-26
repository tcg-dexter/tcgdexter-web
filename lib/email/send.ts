/**
 * Email transport — the single seam the rest of the app depends on.
 *
 * Dispatches via Resend. Gated on env: with no `RESEND_API_KEY` /
 * `EMAIL_FROM` (preview, test, Vercel — which intentionally has no Resend
 * key) this sends NOTHING and returns null. Actual sends only happen on the
 * mac mini, where those vars are set. Callers (cron, unsubscribe flow) only
 * ever depend on the `sendEmail` signature below, never on Resend directly.
 */

import { getResend } from "./resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Extra SMTP headers, e.g. List-Unsubscribe / List-Unsubscribe-Post. */
  headers?: Record<string, string>;
}

/**
 * Send one email. Returns `{ id }` (provider message id) on success, or
 * `null` when sending is disabled or fails — sending is always
 * best-effort and must never throw into a caller.
 */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string } | null> {
  const from = process.env.EMAIL_FROM;
  if (!process.env.RESEND_API_KEY || !from) {
    console.info(
      `[email] transport disabled (no RESEND_API_KEY/EMAIL_FROM) — skipped "${input.subject}" → ${input.to}`,
    );
    return null;
  }
  const { data, error } = await getResend().emails.send({
    from,
    to: input.to,
    subject: input.subject,
    html: input.html,
    headers: input.headers,
  });
  if (error || !data) {
    console.error("[email] send failed:", error);
    return null;
  }
  return { id: data.id };
}
