/**
 * Re-engagement email templates — plain inline-styled HTML (no react-email
 * dependency), built for broad email-client support. Each builder returns
 * `{ subject, html }`. Every email routes through `layout()` so they share
 * a header, an accent CTA button, and the unsubscribe footer.
 */

const ACCENT = "#D91E0D";
const TEXT = "#1a1a1a";
const MUTED = "#888888";
const BG = "#f2f2f2";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(opts: {
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  unsubUrl: string;
}): string {
  const { preheader, heading, bodyHtml, ctaLabel, ctaUrl, unsubUrl } = opts;
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${TEXT};">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:24px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid rgba(0,0,0,0.08);">
          <tr><td style="padding:24px 28px 8px;">
            <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${ACCENT};">TCG Dexter</p>
          </td></tr>
          <tr><td style="padding:4px 28px 0;">
            <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;color:${TEXT};">${escapeHtml(heading)}</h1>
            <div style="font-size:15px;line-height:1.6;color:#4a4a4a;">${bodyHtml}</div>
          </td></tr>
          <tr><td style="padding:20px 28px 28px;">
            <a href="${ctaUrl}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">${escapeHtml(ctaLabel)}</a>
          </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr><td style="padding:16px 28px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.5;color:${MUTED};">
              You're getting this because you have re-engagement emails on.<br/>
              <a href="${unsubUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> anytime.
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function streakAtRiskEmail(opts: {
  streak: number;
  ctaUrl: string;
  unsubUrl: string;
}): { subject: string; html: string } {
  const { streak, ctaUrl, unsubUrl } = opts;
  const subject = `🔥 Your ${streak}-day streak ends tonight`;
  return {
    subject,
    html: layout({
      preheader: `Log a match today to keep your ${streak}-day streak alive.`,
      heading: `Keep your ${streak}-day streak alive`,
      bodyHtml: `<p style="margin:0 0 10px;">You haven't logged a match today — log one before the day ends to keep your <strong>${streak}-day streak</strong> going.</p>`,
      ctaLabel: "Log a match",
      ctaUrl,
      unsubUrl,
    }),
  };
}

export function nearBadgeEmail(opts: {
  badgeName: string;
  remaining: number;
  action: string; // e.g. "save 1 more deck", "log 1 more match"
  ctaUrl: string;
  ctaLabel: string;
  unsubUrl: string;
}): { subject: string; html: string } {
  const { badgeName, remaining, action, ctaUrl, ctaLabel, unsubUrl } = opts;
  const noun = remaining === 1 ? "step" : "steps";
  const subject = `You're ${remaining} ${noun} from ${badgeName}`;
  return {
    subject,
    html: layout({
      preheader: `${action} to unlock the ${badgeName} badge.`,
      heading: `So close to ${badgeName}`,
      bodyHtml: `<p style="margin:0 0 10px;">You're just <strong>${action}</strong> away from earning the <strong>${escapeHtml(
        badgeName,
      )}</strong> badge. Nice work getting this far.</p>`,
      ctaLabel,
      ctaUrl,
      unsubUrl,
    }),
  };
}
