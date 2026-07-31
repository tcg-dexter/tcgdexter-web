/**
 * weekly-digest.ts — weekly digest mailer, run on the mac mini (hourly via
 * launchd). Each opted-in user gets one digest per ISO week, fired in their
 * local Friday 7am. See lib/email/weekly-digest.ts for the job.
 *
 * Usage:
 *   npm run digest              # live run
 *   npm run digest -- --dry     # list this-hour's targets, send nothing
 *
 * Required env (mac mini): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   RESEND_API_KEY, EMAIL_FROM, UNSUBSCRIBE_SECRET, NEXT_PUBLIC_SITE_URL,
 *   BLOB_READ_WRITE_TOKEN (hosts the composited Playmat PNG).
 *
 * Schedule hourly with launchd (~/Library/LaunchAgents/com.tcgdexter.weekly-digest.plist):
 *   launchctl load ~/Library/LaunchAgents/com.tcgdexter.weekly-digest.plist
 *
 * Or crontab:  0 * * * * cd /path/to/tcgdexter-web && npm run digest >> /tmp/dexter-weekly-digest.log 2>&1
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { runWeeklyDigest } from "@/lib/email/weekly-digest";

async function main() {
  const dry = process.argv.includes("--dry");
  // --all: one-time manual trigger — send to every opted-in user now,
  // bypassing the Friday-7am-local gate (dedup still applies).
  const ignoreSchedule = process.argv.includes("--all");
  const admin = createAdminClient();
  const summary = await runWeeklyDigest(admin, { dry, ignoreSchedule });
  console.log(`[weekly-digest] ${new Date().toISOString()} ${JSON.stringify(summary)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[weekly-digest] fatal:", err);
    process.exit(1);
  });
