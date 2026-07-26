/**
 * reengagement.ts — retention email mailer, run on the mac mini.
 *
 * Replaces the Vercel cron (Hobby caps cron at once/day). The always-on
 * mac mini schedules this hourly so streak reminders land in each user's
 * local evening. Sends run here, where Resend is configured — so no Resend
 * env is needed on Vercel.
 *
 * Usage:
 *   npm run reengagement            # live run
 *   npm run reengagement -- --dry   # compute targets, send nothing
 *
 * Required env (mac mini): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   RESEND_API_KEY, EMAIL_FROM, UNSUBSCRIBE_SECRET, NEXT_PUBLIC_SITE_URL.
 *
 * Schedule hourly with launchd (~/Library/LaunchAgents/com.tcgdexter.reengagement.plist):
 *   <?xml version="1.0" encoding="UTF-8"?>
 *   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
 *   <plist version="1.0"><dict>
 *     <key>Label</key><string>com.tcgdexter.reengagement</string>
 *     <key>ProgramArguments</key>
 *       <array><string>/bin/zsh</string><string>-lc</string>
 *         <string>cd /path/to/tcgdexter-web && npm run reengagement</string></array>
 *     <key>StartCalendarInterval</key><dict><key>Minute</key><integer>0</integer></dict>
 *     <key>StandardOutPath</key><string>/tmp/dexter-reengagement.log</string>
 *     <key>StandardErrorPath</key><string>/tmp/dexter-reengagement.err</string>
 *   </dict></plist>
 *   launchctl load ~/Library/LaunchAgents/com.tcgdexter.reengagement.plist
 *
 * Or crontab:  0 * * * * cd /path/to/tcgdexter-web && npm run reengagement >> /tmp/dexter-reengagement.log 2>&1
 */

import { createAdminClient } from "@/lib/supabase/admin";
import { runReengagement } from "@/lib/email/reengagement";

async function main() {
  const dry = process.argv.includes("--dry");
  const admin = createAdminClient();
  const summary = await runReengagement(admin, { dry });
  console.log(`[reengagement] ${new Date().toISOString()} ${JSON.stringify(summary)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[reengagement] fatal:", err);
    process.exit(1);
  });
