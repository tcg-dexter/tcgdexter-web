# Re-engagement email — mac-mini scheduler

Retention emails (streak-at-risk + near-next-badge) are sent by a job that
runs on the **mac mini**, not by Vercel cron (Hobby caps cron at once/day).
Running it here restores hourly, timezone-aware sends and keeps Resend +
the service-role key on the box where they already live.

## The job

- Entry: `scripts/reengagement.ts` → `runReengagement()` in `lib/email/reengagement.ts`.
- Run it: `npm run reengagement` (live) or `npm run reengagement -- --dry`
  (prints the target list, sends nothing).
- Passes:
  - **streak-at-risk** — every run, timezone-aware: `current_streak >= 2`,
    streak alive but today unlogged, user's local hour 18:00–20:59. Deduped
    once per user per local day.
  - **near-badge** — once/day at 16:00 UTC: exactly one milestone-step from
    the next deck/match tier. Deduped once per badge ever.
- Idempotency + send log: `public.reengagement_emails`.
- Sending is best-effort — `sendEmail` no-ops without `RESEND_API_KEY`, and a
  failed send rolls back its dedup claim so it retries next run.

## Required env (mac mini)

```
NEXT_PUBLIC_SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
RESEND_API_KEY
EMAIL_FROM              # e.g. "TCG Dexter <hi@mail.tcgdexter.com>"
UNSUBSCRIBE_SECRET      # must match the value set on Vercel
NEXT_PUBLIC_SITE_URL    # e.g. https://tcgdexter.com (absolute links in emails)
```

## Required env (Vercel — for the unsubscribe route only)

```
UNSUBSCRIBE_SECRET      # same value as the mac mini (verifies the token)
NEXT_PUBLIC_SITE_URL
# SUPABASE_SERVICE_ROLE_KEY already set. No RESEND_API_KEY / CRON_SECRET needed.
```

## Schedule hourly

**launchd** — `~/Library/LaunchAgents/com.tcgdexter.reengagement.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tcgdexter.reengagement</string>
  <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string><string>-lc</string>
      <string>cd /path/to/tcgdexter-web &amp;&amp; npm run reengagement</string>
    </array>
  <key>StartCalendarInterval</key><dict><key>Minute</key><integer>0</integer></dict>
  <key>StandardOutPath</key><string>/tmp/dexter-reengagement.log</string>
  <key>StandardErrorPath</key><string>/tmp/dexter-reengagement.err</string>
</dict></plist>
```

```sh
launchctl load ~/Library/LaunchAgents/com.tcgdexter.reengagement.plist
```

**crontab** alternative:

```
0 * * * * cd /path/to/tcgdexter-web && npm run reengagement >> /tmp/dexter-reengagement.log 2>&1
```

> Alternative cadence: shell `npm run reengagement` from `scripts/daily_ops.py`
> as a once-daily step instead. Simpler, but it loses the local-evening
> timing (a single daily run can't hit everyone's evening).

## First-run check

1. Ensure `lib/email/send.ts` has the real Resend implementation (the local
   handoff — see the file header) and the env above is set.
2. `npm run reengagement -- --dry` → inspect the printed `targets`.
3. `npm run reengagement` → confirm a test send + that the unsubscribe link
   flips `email_reengagement`.
