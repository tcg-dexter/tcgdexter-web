#!/usr/bin/env bash
#
# Serialize vitest runs on this machine.
#
# Two concurrent `npm test` invocations panicked the Mac on 2026-09-08: each
# forked a pool of workers, and the combined ~26 GB of V8 heap on a 17 GB box
# starved WindowServer until the ARM watchdog panicked the kernel. vitest.config.ts
# caps a single run; this caps the number of runs.
#
# Refuses rather than queues — a blocked run in a second agent session should
# surface immediately, not sit invisibly for ten minutes.
#
# Usage: bash scripts/test-guard.sh vitest run
#        bash scripts/test-guard.sh vitest
# Escape hatch: `npm run test:unsafe` bypasses this entirely.

set -euo pipefail

LOCK_DIR="${VITEST_LOCK_DIR:-/tmp/tcgdexter-vitest.lock}"
PID_FILE="$LOCK_DIR/pid"

# mkdir is atomic on every filesystem we care about, unlike test -e && touch.
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  holder="$(cat "$PID_FILE" 2>/dev/null || echo "")"

  # Stale lock: the holder died without running its trap (SIGKILL, a panic, a
  # closed terminal). Reclaim it rather than blocking every future run.
  if [ -z "$holder" ] || ! kill -0 "$holder" 2>/dev/null; then
    echo "test-guard: clearing stale lock at $LOCK_DIR (holder ${holder:-unknown} is gone)" >&2
    rm -rf "$LOCK_DIR"
    mkdir "$LOCK_DIR" 2>/dev/null || {
      echo "test-guard: lost the race to reclaim $LOCK_DIR — try again" >&2
      exit 1
    }
  else
    cat >&2 <<MSG
test-guard: a vitest run is already in progress (pid $holder).

Running two at once is what panicked this machine on 2026-09-08 — each pool
holds several GB and together they exhaust RAM.

Wait for it to finish, or if you are certain it is safe:
  npm run test:unsafe
MSG
    exit 1
  fi
fi

echo $$ > "$PID_FILE"
trap 'rm -rf "$LOCK_DIR"' EXIT INT TERM

# Deliberately not `exec` — exec replaces this shell, which discards the trap
# and would leak the lock until the next run's stale-PID sweep.
status=0
"$@" || status=$?
exit "$status"
