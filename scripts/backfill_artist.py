#!/usr/bin/env python3
"""
backfill_artist.py — Augment data/cards-standard.json with the `artist` field.

Same shape as backfill_evolves_from.py: pulls api.pokemontcg.io per set with
select=number,artist, then writes the artist string back onto each card entry
as `artist`. Cards with no artist (rare — some old promos) get None.

Once this lands, `getCardsByArtist()` in lib/cardsIndex.ts can resolve other
cards by the same illustrator (drives the "More by {artist}" section on
/cards/[id]) and lib/cardSearch.ts's artist-token matching in the catalog
search starts returning hits.

Idempotent. Re-running skips sets whose printings already carry `artist`
unless --force.

Usage:
    python3 backfill_artist.py                  # patch in place
    python3 backfill_artist.py --dry-run        # print stats only
    python3 backfill_artist.py --force          # re-fetch every set
    python3 backfill_artist.py --set me4        # one set only

Requires outbound network to api.pokemontcg.io (the sandbox can't, your
machine can).
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
PAGE_SIZE = 250

REQUEST_TIMEOUT = 60
RETRY_BACKOFFS = [2, 4, 8, 16]
INTER_SET_SLEEP = 0.5


def _fetch_page(url: str) -> dict | None:
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
    """Return {number: artist} for every printing in `set_id`, or None on
    unrecoverable fetch failure for the first page (caller can retry later)."""
    out: dict[str, str | None] = {}
    page = 1
    while True:
        params = urllib.parse.urlencode(
            {
                "q": f"set.id:{set_id}",
                "page": str(page),
                "pageSize": str(PAGE_SIZE),
                "select": "number,artist",
            }
        )
        payload = _fetch_page(f"{API_BASE}?{params}")
        if payload is None:
            return None if page == 1 else out

        data = payload.get("data") or []
        for c in data:
            out[c["number"]] = c.get("artist")

        total = payload.get("totalCount") or 0
        if page * PAGE_SIZE >= total or not data:
            break
        page += 1
        time.sleep(0.3)
    return out


def save(cards: dict, dry_run: bool) -> None:
    if dry_run:
        return
    JSON_PATH.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")))


def main():
    parser = argparse.ArgumentParser(description="Backfill artist into cards-standard.json")
    parser.add_argument("--dry-run", action="store_true", help="Print stats but don't write")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch even sets where every card already has artist",
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
        print("[backfill] No matching sets.")
        return
    print(
        f"[backfill] {total_sets} unique sets, {sum(len(v) for v in by_set.values())} printings"
    )

    updated = 0
    skipped = 0
    failed: list[str] = []
    try:
        for i, (sid, items) in enumerate(sorted(by_set.items()), 1):
            all_have = all("artist" in entry for _, entry in items)
            if all_have and not args.force:
                skipped += 1
                continue

            print(f"[backfill] ({i}/{total_sets}) {sid} — {len(items)} cards", flush=True)
            chain = fetch_set(sid)
            if chain is None:
                failed.append(sid)
                continue
            if not chain:
                for _, entry in items:
                    entry.setdefault("artist", None)
                continue

            for _, entry in items:
                num = entry.get("number", "")
                entry["artist"] = chain.get(num)
                updated += 1

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
