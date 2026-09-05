/**
 * Weekly digest email. Reuses the brand shell (hero logo, footer) from the
 * re-engagement templates, then stacks up to four modules:
 *   1. Your week — per-user recap stats
 *   2. Battle of the Week — the /battles Featured Battle, rebuilt as static
 *      email HTML (email can't run the React hero)
 *   3. Playmat — a server-composited mat PNG of a new public deck
 *   4. New set — logo + release date (conditional)
 */
import type { RecentBattle } from "@/app/components/BattleCard";
import type { UserRecap, NewPublicDeck, NewSet } from "@/lib/email/digest-data";

const ACCENT = "#8C2711";
const TEXT = "#1a1a1a";
const SECONDARY = "#4a4a4a";
const MUTED = "#888888";
const BG = "#f2f2f2";
const GRADIENT = "linear-gradient(90deg,#D99B29 0%,#8C2711 100%)";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A pill CTA link, matching the re-engagement button. */
function cta(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;background-color:${ACCENT};background-image:${GRADIENT};color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 24px;border-radius:999px;">${escapeHtml(label)}</a>`;
}

/** Section heading used above each module. */
function sectionTitle(text: string): string {
  return `<p style="margin:0 0 12px;font-size:13px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${ACCENT};">${escapeHtml(text)}</p>`;
}

/** A bordered module card. */
function moduleCard(inner: string): string {
  return `<tr><td style="padding:10px 24px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid rgba(0,0,0,0.07);border-radius:14px;box-shadow:0 1px 6px rgba(44,31,14,0.05);">
      <tr><td style="padding:20px 22px;">${inner}</td></tr>
    </table>
  </td></tr>`;
}

function statCell(value: number, label: string): string {
  return `<td width="50%" style="padding:6px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};border-radius:12px;"><tr><td align="center" style="padding:14px 8px;">
      <div style="font-size:30px;font-weight:800;line-height:1;color:${TEXT};font-family:${FONT};">${value}</div>
      <div style="font-size:12px;color:${MUTED};margin-top:5px;">${escapeHtml(label)}</div>
    </td></tr></table>
  </td>`;
}

function recapModule(recap: UserRecap): string {
  return moduleCard(`${sectionTitle("Your week")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>${statCell(recap.followerGains, recap.followerGains === 1 ? "New follower" : "New followers")}${statCell(recap.decksAdded, recap.decksAdded === 1 ? "Deck added" : "Decks added")}</tr>
      <tr>${statCell(recap.followingGains, "Started following")}${statCell(recap.battlesLogged, recap.battlesLogged === 1 ? "Battle logged" : "Battles logged")}</tr>
    </table>`);
}

/** One side of the versus row: card thumbnail on its accent color + label. */
function battleSide(imageUrl: string | null, color: string, deckLabel: string, handle: string, align: "left" | "right"): string {
  const img = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" width="64" height="90" alt="" style="display:block;width:64px;height:90px;border-radius:6px;object-fit:cover;" />`
    : `<div style="width:64px;height:90px;border-radius:6px;background:${color};"></div>`;
  return `<td width="42%" align="${align}" valign="top">
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:${align === "right" ? "0 0 0 auto" : "0"};"><tr><td style="background:${color};border-radius:9px;padding:6px;">${img}</td></tr></table>
    <div style="font-size:13px;font-weight:700;color:${TEXT};margin-top:8px;text-align:${align};">${escapeHtml(deckLabel)}</div>
    <div style="font-size:11px;color:${MUTED};text-align:${align};">${escapeHtml(handle)}</div>
  </td>`;
}

function battleModule(m: RecentBattle, siteUrl: string): string {
  const oppDeck = m.opponentArchetype ?? m.opponentAttackerName ?? "Unknown deck";
  const dmg = m.totalDamage ?? 0;
  return moduleCard(`${sectionTitle("⚔ Battle of the Week")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      ${battleSide(m.deckImageUrl, m.playerColor, m.deckName, `@${m.username}`, "left")}
      <td width="16%" align="center" valign="middle"><div style="font-size:15px;font-weight:800;color:${MUTED};">VS</div></td>
      ${battleSide(m.opponentImageUrl, m.opponentColor, oppDeck, m.opponentHandle ?? "Opponent", "right")}
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;"><tr><td align="center" style="background:${BG};border-radius:10px;padding:10px;">
      <span style="font-size:22px;font-weight:800;color:${ACCENT};font-family:${FONT};">${dmg.toLocaleString()}</span>
      <span style="font-size:12px;color:${MUTED};"> total damage dealt</span>
    </td></tr></table>
    <div style="margin-top:16px;">${cta("See the battle", `${siteUrl}/battles`)}</div>`);
}

function playmatModule(deck: NewPublicDeck, imageUrl: string, siteUrl: string): string {
  return moduleCard(`${sectionTitle("🎴 Build your battlefield")}
    <img src="${escapeHtml(imageUrl)}" width="440" alt="Playmat of ${escapeHtml(deck.name)}" style="display:block;width:100%;max-width:440px;height:auto;border-radius:10px;margin:0 auto;" />
    <div style="font-size:13px;font-weight:700;color:${TEXT};margin-top:12px;">${escapeHtml(deck.name)}</div>
    <div style="font-size:12px;color:${MUTED};margin-bottom:2px;">New public deck by ${escapeHtml(deck.ownerName)} — laid out in Playmat Studio</div>
    <div style="margin-top:14px;">${cta("Try Playmat Studio", `${siteUrl}/admin-tools/deck-mat`)}</div>`);
}

function setModule(set: NewSet, siteUrl: string): string {
  const dateLabel = set.releaseDate
    ? new Date(set.releaseDate + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "";
  const logoSrc = set.logoUrl && set.logoUrl.startsWith("/") ? `${siteUrl}${set.logoUrl}` : set.logoUrl;
  const logo = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(set.name)} logo" height="60" style="display:block;height:60px;width:auto;max-width:80%;margin:6px auto 0;" />`
    : `<div style="font-size:20px;font-weight:800;color:${TEXT};">${escapeHtml(set.name)}</div>`;
  return moduleCard(`${sectionTitle("✨ New set released")}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:8px;">${logo}</td></tr></table>
    <div style="font-size:14px;font-weight:700;color:${TEXT};text-align:center;margin-top:8px;">${escapeHtml(set.name)}</div>
    ${dateLabel ? `<div style="font-size:12px;color:${MUTED};text-align:center;">Released ${escapeHtml(dateLabel)}</div>` : ""}
    <div style="margin-top:16px;text-align:center;">${cta("Browse the Card Catalog", `${siteUrl}/cards`)}</div>`);
}

export interface WeeklyDigestInput {
  siteUrl: string;
  recipientName: string;
  recap: UserRecap;
  battle: RecentBattle | null;
  deck: (NewPublicDeck & { playmatImageUrl: string }) | null;
  set: NewSet | null;
  unsubUrl: string;
}

export function weeklyDigestEmail(input: WeeklyDigestInput): { subject: string; html: string } {
  const { siteUrl, recipientName, recap, battle, deck, set, unsubUrl } = input;
  const logoUrl = `${siteUrl}/logo-light.png`;
  const subject = `Your week on TCG Dexter`;
  const preheader = `A recap of your week${recap.followerGains ? ` — ${recap.followerGains} new follower${recap.followerGains === 1 ? "" : "s"}` : ""}, plus what's new on the site.`;

  const modules = [
    recapModule(recap),
    battle ? battleModule(battle, siteUrl) : "",
    deck ? playmatModule(deck, deck.playmatImageUrl, siteUrl) : "",
    set ? setModule(set, siteUrl) : "",
  ].join("\n");

  const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:${BG};font-family:${FONT};color:${TEXT};-webkit-font-smoothing:antialiased;">
    <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:28px 8px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
          <tr><td align="center" style="padding:8px 24px 4px;">
            <img src="${logoUrl}" alt="TCG Dexter" width="150" style="display:block;width:150px;max-width:56%;height:auto;margin:0 auto;" />
          </td></tr>
          <tr><td style="padding:10px 24px 2px;text-align:center;">
            <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:800;letter-spacing:-0.01em;color:${TEXT};">${escapeHtml(recipientName)}'s Week in Review</h1>
            <p style="margin:8px 0 0;font-size:14px;color:${SECONDARY};">Collect. Compete. Level Up.</p>
          </td></tr>
          ${modules}
          <tr><td style="padding:20px 28px 4px;text-align:center;">
            <p style="margin:0;font-size:12px;line-height:1.7;color:${MUTED};">
              <a href="${unsubUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> anytime.<br/>
              <a href="${siteUrl}" style="color:${MUTED};text-decoration:none;">tcgdexter.com</a>
              &nbsp;·&nbsp;<a href="${siteUrl}/privacy" style="color:${MUTED};text-decoration:none;">Privacy Policy</a>
              &nbsp;·&nbsp;<a href="${siteUrl}/terms" style="color:${MUTED};text-decoration:none;">Terms</a>
            </p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  return { subject, html };
}
