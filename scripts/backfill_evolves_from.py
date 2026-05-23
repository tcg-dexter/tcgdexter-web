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

Usage:
    python3 backfill_evolves_from.py                 # patch in place
    python3 backfill_evolves_from.py --dry-run        # print stats only
    python3 backfill_evolves_from.py --force          # re-fetch every set

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


def fetch_set(set_id: str) -> dict[str, str | None]:
    """Return {number: evolvesFrom} for every printing in `set_id`.
    Paginates the pokemontcg.io listing endpoint."""
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
        req = urllib.request.Request(url, headers={"User-Agent": "tcgdexter-backfill/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            print(f"  HTTP {e.code} on {set_id} page {page}: {e.reason}", file=sys.stderr)
            return out
        except urllib.error.URLError as e:
            print(f"  URL error on {set_id} page {page}: {e.reason}", file=sys.stderr)
            return out

        data = payload.get("data") or []
        for c in data:
            out[c["number"]] = c.get("evolvesFrom")  # may be absent → None

        # Pagination: keep going until we've drained totalCount.
        total = payload.get("totalCount") or 0
        fetched = page * PAGE_SIZE
        if fetched >= total or not data:
            break
        page += 1
        time.sleep(0.2)  # be polite

    return out


def main():
    parser = argparse.ArgumentParser(description="Backfill evolves_from into cards-standard.json")
    parser.add_argument("--dry-run", action="store_true", help="Print stats but don't write")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-fetch even sets where every card already has evolves_from",
    )
    args = parser.parse_args()

    if not JSON_PATH.exists():
        print(f"ERROR: {JSON_PATH} not found", file=sys.stderr)
        sys.exit(1)

    print(f"[backfill] Reading {JSON_PATH}...")
    cards = json.loads(JSON_PATH.read_text())

    # Group printings by set_id for batched API calls.
    by_set: dict[str, list[tuple[str, dict]]] = defaultdict(list)
    for name, variants in cards.items():
        for entry in variants:
            sid = entry.get("set_id")
            if sid:
                by_set[sid].append((name, entry))

    total_sets = len(by_set)
    print(f"[backfill] {total_sets} unique sets, {sum(len(v) for v in by_set.values())} printings")

    updated = 0
    skipped = 0
    for i, (sid, items) in enumerate(sorted(by_set.items()), 1):
        all_have = all("evolves_from" in entry for _, entry in items)
        if all_have and not args.force:
            skipped += 1
            continue

        print(f"[backfill] ({i}/{total_sets}) {sid} — {len(items)} cards", flush=True)
        chain = fetch_set(sid)
        if not chain:
            # Set may not be indexed upstream yet (e.g. me4 on scrydex).
            # Mark every printing as None so we don't keep re-trying.
            for _, entry in items:
                entry.setdefault("evolves_from", None)
            continue

        for _, entry in items:
            num = entry.get("number", "")
            entry["evolves_from"] = chain.get(num)  # None when absent
            updated += 1

    print(f"[backfill] updated {updated} card entries; skipped {skipped} already-complete sets")

    if args.dry_run:
        print("[backfill] --dry-run: not writing")
        return

    JSON_PATH.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")))
    size_mb = JSON_PATH.stat().st_size / (1024 * 1024)
    print(f"[backfill] Wrote {JSON_PATH} ({size_mb:.1f} MB)")


if __name__ == "__main__":
    main()
