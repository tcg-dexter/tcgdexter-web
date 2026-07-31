/**
 * weekly-digest-test.ts — build the weekly digest from REAL data and send
 * one to a chosen address (default hello@tcgdexter.com). Also writes the
 * HTML to .email-preview/digest.html for local inspection.
 *
 *   npm run digest:test                 # 7-day window, to hello@
 *   npm run digest:test -- --days 30     # wider window (more to show)
 *   npm run digest:test -- --to me@x.com --no-send   # preview only
 *
 * The Playmat PNG is uploaded to Vercel Blob (public) so the email can load
 * it; every link/logo points at production www.tcgdexter.com.
 */
import { writeFileSync } from "node:fs";
import { put } from "@vercel/blob";
import { createAdminClient } from "@/lib/supabase/admin";
import { SET_RELEASE_DATES } from "@/lib/setReleaseDates";
import { gatherSiteModules, gatherUserRecap } from "@/lib/email/digest-data";
import { renderPlaymatPng } from "@/lib/email/playmat-render";
import { weeklyDigestEmail } from "@/lib/email/digest-templates";
import { sendEmail } from "@/lib/email/send";

const SITE = "https://www.tcgdexter.com";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const DAYS = Number(arg("days", "7"));
const TO = arg("to", "hello@tcgdexter.com")!;
const NO_SEND = process.argv.includes("--no-send");

/** Newest set overall — forced into the test so the set module always shows. */
function newestSetId(): string {
  return Object.entries(SET_RELEASE_DATES).sort((a, b) => b[1].localeCompare(a[1]))[0][0];
}

async function findUserIdByEmail(admin: ReturnType<typeof createAdminClient>, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function main() {
  const admin = createAdminClient();
  const sinceIso = new Date(Date.now() - DAYS * 86400_000).toISOString();

  const userId = await findUserIdByEmail(admin, TO);
  if (!userId) throw new Error(`No auth user for ${TO}`);
  const { data: prof } = await admin.from("profiles").select("display_name, username").eq("id", userId).maybeSingle();
  const recipientName = prof?.display_name || prof?.username || "there";

  const [recap, site] = await Promise.all([
    gatherUserRecap(admin, userId, sinceIso),
    gatherSiteModules(admin, sinceIso, { forceSetId: newestSetId() }),
  ]);
  console.log("recap:", recap);
  console.log("battle:", site.battle ? `${site.battle.deckName} (${site.battle.totalDamage} dmg)` : "none");
  console.log("deck:", site.deck ? site.deck.name : "none");
  console.log("set:", site.set ? `${site.set.name} (${site.set.releaseDate})` : "none");

  // Render + host the playmat.
  let deckWithImage = null as (typeof site.deck & { playmatImageUrl: string }) | null;
  if (site.deck) {
    const mat = await renderPlaymatPng(site.deck.deckList, { width: 960, siteUrl: SITE });
    if (mat) {
      const { url } = await put(`email/playmat-${Date.now()}.png`, mat.png, {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: true,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      console.log("playmat:", url);
      deckWithImage = { ...site.deck, playmatImageUrl: url };
    }
  }

  const { subject, html } = weeklyDigestEmail({
    siteUrl: SITE,
    recipientName,
    recap,
    battle: site.battle,
    deck: deckWithImage,
    set: site.set,
    unsubUrl: `${SITE}/api/email/unsubscribe?token=test`,
  });

  writeFileSync(".email-preview/digest.html", html);
  console.log("wrote .email-preview/digest.html");

  if (NO_SEND) {
    console.log("--no-send: skipping send");
    return;
  }
  const res = await sendEmail({ to: TO, subject: `[TEST] ${subject}`, html });
  console.log("send:", res);
}

main().then(() => process.exit(0));
