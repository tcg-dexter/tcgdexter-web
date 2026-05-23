#!/usr/bin/env python3
"""
backfill_evolves_from.py — Augment data/cards-standard.json with evolvesFrom.

Reads the current cards-standard.json, then for each unique set_id pulls the
pokemontcg.io /v2/cards listing for that set, builds a
{(set_id, number): evolvesFrom} map, and writes the field back onto each card
entry as `evolves_from`. Cards that don't evolve (Basics, Trainers, Energy)
get None.

Idempotent. Safe to re-run; will skip a set when every printing already has
the field present.

Resilience:
- Retries each request up to 4 times with exponential backoff (2/4/8/16s).
- Catches transient timeouts/HTTP errors per-set and continues to the next.
- Flushes the JSON to disk after every set, so a crash or Ctrl-C only loses
  the partial set in flight — re-running picks up exactly where it stopped.

Usage:
    python3 backfill_evolves_from.py                 # patch in place
    python3 backfill_evolves_from.py --dry-run        # print stats only
    python3 backfill_evolves_from.py --force          # re-fetch every set
    python3 backfill_evolves_from.py --set me4        # only this set

This is a one-off (and occasional top-up) — once the upstream
`sync_new_sets.py` carries evolvesFrom through into cards.db,
`export_cards_standard.py` will keep it populated on its own.
"""

import argparse
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

WEB_REPO = Path(__file__).resolve().parent.parent
JSON_PATH = WEB_REPO / "data/cards-standard.json"
API_BASE = "https://api.pokemontcg.io/v2/cards"
PAGE_SIZE = 250  # API max

REQUEST_TIMEOUT = 60  # seconds — pokemontcg.io can be slow for big sets
RETRY_BACKOFFS = [2, 4, 8, 16]  # seconds between retries
INTER_SET_SLEEP = 0.5  # courtesy delay between sets


def _fetch_page(url: str) -> dict | None:
    """Fetch one URL with retries. Returns the parsed JSON payload or None
    if every retry failed."""
    req = urllib.request.Request(url, headers={"User-Agent": "tcgdexter-backfill/1.0"})
    last_err: Exception | None = None
    for attempt, backoff in enumerate([0] + RETRY_BACKOFFS):
        if backoff:
            time.sleep(backoff)
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
            print(f"    attempt {attempt + 1} failed: {e}", file=sys.stderr)
    print(f"    giving up after {len(RETRY_BACKOFFS) + 1} attempts: {last_err}", file=sys.stderr)
    return None


def fetch_set(set_id: str) -> dict[str, str | None] | None:
    """Return {number: evolvesFrom} for every printing in `set_id`, or None if
    we couldn't fetch the set at all (caller can retry later)."""
    out: dict[str, str | None] = {}
    page = 1
    while True:
        params = urllib.parse.urlencode(
            {
                "q": f"set.id:{set_id}",
                "page": str(page),
                "pageSize": str(PAGE_SIZE),
                "select": "number,evolvesFrom",
            }
        )
        url = f"{API_BASE}?{params}"
        payload = _fetch_page(url)
        if payload is None:
            return None if page == 1 else out  # partial first page failure → bail

        data = payload.get("data") or []
        for c in data:
            out[c["number"]] = c.get("evolvesFrom")  # may be absent → None

        total = payload.get("totalCount") or 0
        fetched = page * PAGE_SIZE
        if fetched >= total or not data:
            break
        page += 1
        time.sleep(0.3)
    return out


def save(cards: dict, dry_run: bool) -> None:
    if dry_run:
        return
    JSON_PATH.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description="Backfill evolves_from into cards-standard.json")
    parser.add_argument("--dry-run", action="store_true", help="Print stats but don't write")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch even sets where every card already has evolves_from",
    )
    parser.add_argument("--set", help="Only process this single set_id")
    args = parser.parse_args()

    if not JSON_PATH.exists():
        print(f"ERROR: {JSON_PATH} not found", file=sys.stderr)
        sys.exit(1)

    print(f"[backfill] Reading {JSON_PATH}...")
    cards = json.loads(JSON_PATH.read_text())

    by_set: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for name, variants in cards.items():
        for entry in variants:
            sid = entry.get("set_id")
            if sid and (not args.set or sid == args.set):
                by_set[sid].append((name, entry))

    total_sets = len(by_set)
    if total_sets == 0:
        print(f"[backfill] No matching sets.")
        return
    print(
        f"[backfill] {total_sets} unique sets, {sum(len(v) for v in by_set.values())} printings"
    )

    updated = 0
    skipped = 0
    failed: list[str] = []
    try:
        for i, (sid, items) in enumerate(sorted(by_set.items()), 1):
            all_have = all("evolves_from" in entry for _, entry in items)
            if all_have and not args.force:
                skipped += 1
                continue

            print(f"[backfill] ({i}/{total_sets}) {sid} — {len(items)} cards", flush=True)
            chain = fetch_set(sid)
            if chain is None:
                # Couldn't reach the API for this set at all — leave entries
                # untouched so the next run retries them.
                failed.append(sid)
                continue
            if not chain:
                # Set returned no rows (likely not indexed upstream yet, e.g.
                # me4 / Chaos Rising still rolling out). Mark every printing
                # as None so we don't keep re-trying it on the next run; once
                # the set lands we can `--force` to refresh.
                for _, entry in items:
                    entry.setdefault("evolves_from", None)
                continue

            for _, entry in items:
                num = entry.get("number", "")
                entry["evolves_from"] = chain.get(num)  # None when absent
                updated += 1

            # Flush after every set so a later crash doesn't lose this set's
            # work. JSON write is ~11 MB; cheap enough to do once per set.
            save(cards, args.dry_run)
            time.sleep(INTER_SET_SLEEP)
    except KeyboardInterrupt:
        print("\n[backfill] interrupted — saving progress and exiting", file=sys.stderr)
    finally:
        save(cards, args.dry_run)

    print(
        f"[backfill] updated {updated} card entries; skipped {skipped} already-complete sets; "
        f"{len(failed)} unreachable: {', '.join(failed) if failed else 'none'}"
    )
    if not args.dry_run:
        size_mb = JSON_PATH.stat().st_size / (1024 * 1024)
        print(f"[backfill] Wrote {JSON_PATH} ({size_mb:.1f} MB)")
    if failed:
        print("[backfill] Re-run the script to retry unreachable sets.")


if __name__ == "__main__":
    main()
