/**
 * Email transport — the single seam the rest of the app depends on.
 *
 * ⚠️ NO-OP STUB. The real Resend implementation is a local handoff (the
 * sending account/domain live on the dev machine). This committed version
 * imports no provider SDK, so the branch builds and — crucially — PREVIEW
 * AND ANY ENV WITHOUT A KEY SEND NOTHING. Callers (cron, unsubscribe
 * flow) only ever depend on the `sendEmail` signature below, never on
 * Resend directly, so swapping this body in changes nothing downstream.
 *
 * To wire the real transport (local session):
 *   1. `npm i resend`
 *   2. add `lib/email/resend.ts` exporting a lazy client
 *   3. replace the body of `sendEmail` below with:
 *        const from = process.env.EMAIL_FROM;
 *        if (!process.env.RESEND_API_KEY || !from) return null;
 *        const { data, error } = await getResend().emails.send({
 *          from, to: input.to, subject: input.subject,
 *          html: input.html, headers: input.headers,
 *        });
 *        if (error || !data) { console.error("[email] send failed:", error); return null; }
 *        return { id: data.id };
 *   4. set RESEND_API_KEY + EMAIL_FROM in the environment.
 */

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
 *
 * STUB: logs the intent and returns null. Replace the body locally to
 * dispatch via Resend (see file header).
 */
export async function sendEmail(input: SendEmailInput): Promise<{ id: string } | null> {
  if (!process.env.RESEND_API_KEY) {
    console.info(
      `[email] transport disabled (no RESEND_API_KEY) — skipped "${input.subject}" → ${input.to}`,
    );
    return null;
  }
  // Guard: the real transport isn't wired in this build. If a key is set
  // but the body wasn't replaced, fail closed rather than silently
  // pretending to send.
  console.warn(
    `[email] sendEmail stub invoked with a key present but no transport wired — "${input.subject}" → ${input.to}`,
  );
  return null;
}
