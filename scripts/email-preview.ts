/**
 * email-preview.ts — render every re-engagement email template to
 * standalone HTML files for design iteration. Sends nothing.
 *
 *   npm run email:preview            # writes .email-preview/*.html
 *   npm run email:preview -- --open  # …and opens the index in your browser
 *
 * Badge images resolve from the local `public/` dir via a file:// URL, so
 * the previews render the real art without a deploy. Pass --site <url> to
 * point image/link URLs at a real origin instead (e.g. a preview build).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CATALOG } from "../lib/learn/achievements";
import { streakAtRiskEmail, nearBadgeEmail } from "../lib/email/templates";

const OUT = join(process.cwd(), ".email-preview");
const args = process.argv.slice(2);
const siteArg = args[args.indexOf("--site") + 1];
const site =
  args.includes("--site") && siteArg
    ? siteArg.replace(/\/$/, "")
    : // file:// URL with the path properly percent-encoded (repo paths may
      // contain spaces), so local previews load the real assets.
      pathToFileURL(join(process.cwd(), "public")).href.replace(/\/$/, "");

// A representative unsubscribe/CTA link — real routing is exercised by the
// live job; here we only care about the rendered design.
const unsubUrl = `${site}/api/email/unsubscribe?token=preview`;

type Sample = { file: string; title: string; subject: string; html: string };
const samples: Sample[] = [];

// Streak-at-risk — a couple of streak lengths.
for (const streak of [2, 7]) {
  const { subject, html } = streakAtRiskEmail({
    siteUrl: site,
    streak,
    ctaUrl: `${site}/my-decks`,
    unsubUrl,
  });
  samples.push({ file: `streak_${streak}.html`, title: `Streak · ${streak}-day`, subject, html });
}

// Near-badge — one per milestone badge so every image is visible.
const milestones = CATALOG.filter((d) => /_(\d+)$/.test(d.key));
for (const def of milestones) {
  const isDecks = def.key.startsWith("decks");
  const action = isDecks ? "save 1 more deck" : "log 1 more match";
  const { subject, html } = nearBadgeEmail({
    siteUrl: site,
    badgeName: def.name,
    badgeImageUrl: `${site}/badges/${def.key}.png`,
    remaining: 1,
    action,
    ctaUrl: isDecks ? `${site}/` : `${site}/my-decks`,
    ctaLabel: isDecks ? "Build a deck" : "Log a match",
    unsubUrl,
  });
  samples.push({
    file: `near_${def.key}.html`,
    title: `Near · ${def.name}`,
    subject,
    html,
  });
}

mkdirSync(OUT, { recursive: true });
for (const s of samples) writeFileSync(join(OUT, s.file), s.html);

const index = `<!doctype html><meta charset="utf-8">
<title>Re-engagement email previews</title>
<body style="font-family:-apple-system,system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#1a1a1a;">
<h1 style="font-size:20px;">Re-engagement email previews</h1>
<p style="color:#666;font-size:14px;">Site base: <code>${site}</code></p>
<ul style="line-height:2;">
${samples
  .map(
    (s) =>
      `<li><a href="./${s.file}">${s.title}</a> &nbsp;<span style="color:#999;font-size:13px;">— ${s.subject}</span></li>`,
  )
  .join("\n")}
</ul></body>`;
writeFileSync(join(OUT, "index.html"), index);

console.log(`[email-preview] wrote ${samples.length + 1} files to ${OUT}`);
if (args.includes("--open")) execFileSync("open", [join(OUT, "index.html")]);
