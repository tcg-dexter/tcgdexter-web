import { verifyUnsubToken } from "@/lib/email/unsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Re-engagement email unsubscribe — one click, no session required.
 *
 * The recipient has no auth cookie when they click from an inbox, so the
 * link carries an HMAC-signed token (see lib/email/unsubscribe.ts) that
 * identifies the user without letting anyone unsubscribe someone else.
 *
 *   GET  — renders a confirmation page (the human click-through).
 *   POST — RFC 8058 one-click (List-Unsubscribe-Post) from mail clients.
 *
 * Both flip profiles.email_reengagement to false via the service-role
 * client (the only writer without a session).
 */

export const dynamic = "force-dynamic";

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://tcgdexter.com").replace(/\/$/, "");
}

/** Flip the opt-out. Returns true on success. */
async function unsubscribe(token: string | null): Promise<boolean> {
  const userId = verifyUnsubToken(token);
  if (!userId) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("profiles")
      .update({ email_reengagement: false })
      .eq("id", userId);
    if (error) {
      console.error("[email/unsubscribe] update failed:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[email/unsubscribe] error:", err);
    return false;
  }
}

function page(heading: string, message: string, ok: boolean): Response {
  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${heading} — TCG Dexter</title>
  </head>
  <body style="margin:0;background:#f2f2f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
    <div style="max-width:440px;margin:64px auto;padding:0 20px;text-align:center;">
      <p style="font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#D91E0D;">TCG Dexter</p>
      <h1 style="font-size:22px;margin:12px 0;">${heading}</h1>
      <p style="font-size:15px;line-height:1.6;color:#4a4a4a;">${message}</p>
      <p style="margin-top:24px;">
        <a href="${baseUrl()}/settings" style="color:#D91E0D;font-weight:600;text-decoration:none;">Manage email settings</a>
      </p>
    </div>
  </body>
</html>`;
  return new Response(html, {
    status: ok ? 200 : 400,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const ok = await unsubscribe(token);
  return ok
    ? page(
        "You're unsubscribed",
        "You won't receive re-engagement emails anymore. You can turn them back on anytime in Settings.",
        true,
      )
    : page(
        "Invalid link",
        "This unsubscribe link is invalid or has expired. You can manage email settings from your account instead.",
        false,
      );
}

export async function POST(req: Request) {
  const token = new URL(req.url).searchParams.get("token");
  const ok = await unsubscribe(token);
  // One-click (RFC 8058): the mail client only cares about the status code.
  return new Response(null, { status: ok ? 200 : 400 });
}
