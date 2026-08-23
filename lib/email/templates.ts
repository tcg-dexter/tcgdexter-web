/**
 * Re-engagement email templates — plain inline-styled HTML (no react-email
 * dependency), built for broad email-client support. Each builder returns
 * `{ subject, html }`. Every email routes through `layout()` so they share
 * the hero logo, a capsule CTA button, and the unsubscribe footer.
 */

const ACCENT = "#D91E0D";
const TEXT = "#1a1a1a";
const SECONDARY = "#4a4a4a";
const MUTED = "#888888";
const BG = "#f2f2f2";
// Brand gradient (amber → red → dark red), matching --gradient-brand in
// globals.css. Paired with a solid background-color so Outlook — which
// ignores background-image — still fills with the accent.
const GRADIENT = "linear-gradient(90deg,#F2A20C 0%,#D91E0D 50%,#A60D0D 100%)";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Text painted with the brand gradient. Clients that support
 * background-clip:text (Apple Mail, iOS) show the gradient; everywhere else
 * (-webkit-text-fill-color ignored) it falls back to the solid accent color.
 */
function gradientText(s: string): string {
  return `<span style="color:${ACCENT};background-image:${GRADIENT};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;">${escapeHtml(
    s,
  )}</span>`;
}

function layout(opts: {
  siteUrl: string;
  preheader: string;
  headingHtml: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  unsubUrl: string;
}): string {
  const { siteUrl, preheader, headingHtml, bodyHtml, ctaLabel, ctaUrl, unsubUrl } =
    opts;
  const logoUrl = `${siteUrl}/logo-light.png`;
  return `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:${BG};font-family:${FONT};color:${TEXT};-webkit-font-smoothing:antialiased;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);box-shadow:0 2px 12px rgba(44,31,14,0.08);">
          <!-- Hero logo -->
          <tr><td align="center" style="padding:32px 28px 6px;">
            <img src="${logoUrl}" alt="TCG Dexter" width="168" style="display:block;width:168px;max-width:62%;height:auto;margin:0 auto;" />
          </td></tr>
          <tr><td style="padding:14px 32px 0;">
            <h1 style="margin:0 0 12px;font-size:23px;line-height:1.3;font-weight:800;letter-spacing:-0.01em;color:${TEXT};">${headingHtml}</h1>
            <div style="font-size:15px;line-height:1.65;color:${SECONDARY};">${bodyHtml}</div>
          </td></tr>
          <tr><td style="padding:22px 32px 34px;">
            <a href="${ctaUrl}" style="display:inline-block;background-color:${ACCENT};background-image:${GRADIENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 30px;border-radius:999px;box-shadow:0 2px 8px rgba(217,30,13,0.28);">${escapeHtml(ctaLabel)}</a>
          </td></tr>
        </table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;">
          <tr><td style="padding:18px 28px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">
              <a href="${unsubUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> anytime.<br/>
              <a href="${siteUrl}" style="color:${MUTED};text-decoration:none;">tcgdexter.com</a>
              &nbsp;·&nbsp;
              <a href="${siteUrl}/privacy" style="color:${MUTED};text-decoration:none;">Privacy Policy</a>
              &nbsp;·&nbsp;
              <a href="${siteUrl}/terms" style="color:${MUTED};text-decoration:none;">Terms</a>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function streakAtRiskEmail(opts: {
  siteUrl: string;
  streak: number;
  ctaUrl: string;
  unsubUrl: string;
}): { subject: string; html: string } {
  const { siteUrl, streak, ctaUrl, unsubUrl } = opts;
  const subject = `🔥 Your ${streak}-day streak ends tonight`;
  // Flame + count hero, mirroring the profile streak tile (the flame is a
  // rasterized copy of the on-site StreakFlame gradient glyph, since email
  // clients don't render inline SVG).
  const flameHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 14px;"><tr>
    <td valign="middle"><img src="${siteUrl}/email/streak-flame.png" alt="" width="44" height="44" style="display:block;width:44px;height:44px;" /></td>
    <td valign="middle" style="padding-left:6px;font-size:40px;font-weight:800;color:${TEXT};font-family:${FONT};">${streak}</td>
  </tr></table>`;
  return {
    subject,
    html: layout({
      siteUrl,
      preheader: `Log a battle today to keep your ${streak}-day streak alive.`,
      headingHtml: escapeHtml(`Keep your ${streak}-day streak alive`),
      bodyHtml: `${flameHtml}<p style="margin:0 0 10px;">You haven't logged a battle today — log one before the day ends to keep your <strong>${streak}-day streak</strong> going.</p>`,
      ctaLabel: "Log a battle",
      ctaUrl,
      unsubUrl,
    }),
  };
}

export function nearBadgeEmail(opts: {
  siteUrl: string;
  badgeName: string;
  badgeImageUrl: string; // absolute URL, e.g. https://tcgdexter.com/badges/decks_5.png
  remaining: number;
  action: string; // e.g. "save 1 more deck", "log 1 more battle"
  ctaUrl: string;
  ctaLabel: string;
  unsubUrl: string;
}): { subject: string; html: string } {
  const { siteUrl, badgeName, badgeImageUrl, remaining, action, ctaUrl, ctaLabel, unsubUrl } =
    opts;
  const noun = remaining === 1 ? "step" : "steps";
  const subject = `You're ${remaining} ${noun} from ${badgeName}`;
  const actionSentence = action.charAt(0).toUpperCase() + action.slice(1);
  // The locked badge, previewed at ~40% via wrapper opacity so it reads as
  // "not yet earned". Inline styles only — email clients ignore <style>.
  const badgeHtml = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 4px;"><tr><td align="center" style="opacity:0.4;filter:grayscale(100%);">
    <img src="${escapeHtml(badgeImageUrl)}" alt="${escapeHtml(
      badgeName,
    )} badge" width="96" height="96" style="display:block;width:96px;height:96px;" />
  </td></tr></table>`;
  return {
    subject,
    html: layout({
      siteUrl,
      preheader: `${action} to unlock the ${badgeName} badge.`,
      headingHtml: `So close to ${gradientText(badgeName)}`,
      bodyHtml: `${badgeHtml}<p style="margin:0 0 10px;"><strong>${actionSentence}</strong> to earn the ${gradientText(
        badgeName,
      )} badge. Nice work getting this far.</p>`,
      ctaLabel,
      ctaUrl,
      unsubUrl,
    }),
  };
}
