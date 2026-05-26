#!/usr/bin/env python3
"""
export_meta_decks.py — Scrape Limitless TCG for reference deck lists for the
top 30 meta archetypes. Outputs data/meta-decks.json.

Rotation filter: Only accepts deck lists where EVERY card has a regulation mark
of H or later (i.e., G-mark and earlier are rotated out of Standard). This is
enforced both by set-code allowlist AND by checking individual card regulation
marks against cards-standard.json when available.

Commits and pushes to tcgdexter-web if data changed.

Usage:
    python3 export_meta_decks.py              # scrape and push
    python3 export_meta_decks.py --no-push    # scrape but skip git
    python3 export_meta_decks.py --dry-run    # print plan without scraping
"""

import argparse
import json
import re
import time
import urllib.request
from pathlib import Path
import subprocess

# ─── Paths ────────────────────────────────────────────────────────────────────

WEB_REPO  = Path.home() / "TCG Dexter/tcgdexter-web"
META_FILE = WEB_REPO / "data" / "meta-archetypes.json"
CARDS_FILE = WEB_REPO / "data" / "cards-standard.json"
OUT_FILE  = WEB_REPO / "data" / "meta-decks.json"

HEADERS = {"User-Agent": "TCGDexter-MetaDeckScraper/1.0 (educational)"}
DELAY = 0.5  # seconds between requests

# ─── Standard-legal set codes (H-mark era and later) ─────────────────────────
# These are sets with regulation mark H or later. Sets with G-mark or earlier
# are excluded. Update this list as new sets release.

STANDARD_SETS = {
    # SV era (H-mark)
    "SVI", "PAL", "OBF", "MEW", "PAR", "TEF", "TWM", "SFA", "SCR", "SSP",
    "PRE", "DRI", "SVP", "SVE",
    # SV sub-sets
    "PAF", "PFL",
    # Mega Evolution era (I-mark)
    "JTG", "MEG", "MEP", "ASC", "WHT",
    # Mega Evolution sub-sets (energies, promos, etc.)
    "MEE", "ME03",
    # Additional
    "BLK", "POR", "PH",
}

# Regulation marks that are rotated OUT of Standard
ROTATED_MARKS = {"A", "B", "C", "D", "E", "F", "G"}


# ─── Fetching ─────────────────────────────────────────────────────────────────

def fetch(url: str) -> str:
    """Fetch a URL and return the response body as text."""
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8")


def find_archetype_ids(keyword: str) -> list[int]:
    """Search Limitless TCG decks page and extract archetype IDs."""
    url = f"https://limitlesstcg.com/decks?q={urllib.request.quote(keyword)}&game=PTCG"
    html = fetch(url)
    return [int(m) for m in re.findall(r'href="/decks/(\d+)"', html)]


def find_list_ids(archetype_id: int) -> list[int]:
    """From an archetype page, extract deck list IDs."""
    url = f"https://limitlesstcg.com/decks/{archetype_id}"
    html = fetch(url)
    return [int(m) for m in re.findall(r'href="/decks/list/(\d+)"', html)]


def parse_deck_list(html: str) -> list[dict]:
    """Parse a Limitless deck list page into card objects."""
    cards: list[dict] = []
    current_category = "pokemon"

    cat_map = {"pokémon": "pokemon", "pokemon": "pokemon", "trainer": "trainer", "energy": "energy"}

    for line in html.split("\n"):
        line_stripped = line.strip()

        # Detect category headers
        heading_m = re.search(r'decklist-column-heading[^>]*>([^<]+)', line_stripped)
        if heading_m:
            heading_text = heading_m.group(1).lower()
            for key, cat in cat_map.items():
                if key in heading_text:
                    current_category = cat
                    break
            continue

        # Parse card entries from data attributes
        card_m = re.search(r'decklist-card[^>]*data-set="([^"]*)"[^>]*data-number="([^"]*)"', line_stripped)
        if card_m:
            set_code = card_m.group(1)
            number = card_m.group(2)
            cards.append({
                "qty": 0,
                "name": "",
                "setCode": set_code,
                "number": number,
                "category": current_category,
                "_partial": True,
            })
            continue

        # Fill in count
        count_m = re.search(r'card-count[^>]*>(\d+)<', line_stripped)
        if count_m and cards and cards[-1].get("_partial"):
            cards[-1]["qty"] = int(count_m.group(1))
            continue

        # Fill in name
        name_m = re.search(r'card-name[^>]*>([^<]+)<', line_stripped)
        if name_m and cards and cards[-1].get("_partial"):
            raw = name_m.group(1).strip()
            raw = raw.replace("&#039;", "'").replace("&amp;", "&").replace("&quot;", '"')
            cards[-1]["name"] = raw
            del cards[-1]["_partial"]
            continue

    cards = [c for c in cards if not c.get("_partial")]
    return cards


# ─── Rotation checks ─────────────────────────────────────────────────────────

def load_card_db() -> dict[str, list[dict]] | None:
    """Load cards-standard.json if available for regulation mark cross-checking."""
    if not CARDS_FILE.exists():
        return None
    try:
        with open(CARDS_FILE) as f:
            return json.load(f)
    except Exception:
        return None


def is_standard_legal(cards: list[dict], card_db: dict[str, list[dict]] | None) -> tuple[bool, set[str]]:
    """Check if all cards in the list are Standard-legal.

    Two-layer check:
    1. Set code must be in STANDARD_SETS
    2. If cards-standard.json is available, verify the card's regulation mark
       is H or later. A card like Iono from PAL has G-mark and is rotated
       even though PAL also contains H-mark cards.

    A card is legal if ANY of its printings has a non-rotated regulation mark.
    Energy cards without regulation marks are assumed legal if their set code passes.

    Returns (is_legal, set of reasons for failure).
    """
    if not cards:
        return False, {"empty deck list"}

    issues: set[str] = set()

    for c in cards:
        # Layer 1: set code check
        if c["setCode"] not in STANDARD_SETS:
            issues.add(f"set:{c['setCode']}")
            continue

        # Layer 2: regulation mark check (if card DB available)
        if card_db and c["name"] in card_db:
            printings = card_db[c["name"]]
            # Check if the card has ANY printing with a legal regulation mark
            has_legal_printing = False
            has_any_mark = False
            for p in printings:
                mark = p.get("regulation_mark")
                if mark:
                    has_any_mark = True
                    if mark.upper() not in ROTATED_MARKS:
                        has_legal_printing = True
                        break
            # If the card has regulation marks but none are legal, it's rotated
            if has_any_mark and not has_legal_printing:
                issues.add(f"rotated:{c['name']}")

    return len(issues) == 0, issues


MAX_VARIANTS = 12
LIST_SCAN_LIMIT = 40


def scrape_variants_for_archetype(name: str, card_db: dict | None) -> list[dict]:
    """Try to find and parse up to MAX_VARIANTS Standard-legal deck lists for an archetype.

    Returns a list of {"listId": int, "cards": [...]} entries, ordered by Limitless
    ranking (top-placing list first).
    """
    keyword = name.split()[0]
    print(f"  Searching for '{keyword}'...")

    try:
        arch_ids = find_archetype_ids(keyword)
    except Exception as e:
        print(f"  ⚠ Search failed: {e}")
        return []

    if not arch_ids:
        print(f"  ⚠ No archetype IDs found")
        return []

    time.sleep(DELAY)

    variants: list[dict] = []
    seen_list_ids: set[int] = set()

    for arch_id in arch_ids:
        if len(variants) >= MAX_VARIANTS:
            break
        try:
            list_ids = find_list_ids(arch_id)
        except Exception as e:
            print(f"  ⚠ Archetype {arch_id} page failed: {e}")
            time.sleep(DELAY)
            continue

        if not list_ids:
            continue

        time.sleep(DELAY)

        for list_id in list_ids[:LIST_SCAN_LIMIT]:
            if len(variants) >= MAX_VARIANTS:
                break
            if list_id in seen_list_ids:
                continue
            seen_list_ids.add(list_id)

            try:
                html = fetch(f"https://limitlesstcg.com/decks/list/{list_id}")
            except Exception as e:
                print(f"  ⚠ List {list_id} fetch failed: {e}")
                time.sleep(DELAY)
                continue

            cards = parse_deck_list(html)
            legal, issues = is_standard_legal(cards, card_db)
            if legal:
                total = sum(c["qty"] for c in cards)
                print(f"  ✓ Variant {len(variants) + 1}/{MAX_VARIANTS} list {list_id}: {len(cards)} unique cards ({total} total)")
                variants.append({"listId": list_id, "cards": cards})
            else:
                print(f"  · List {list_id} not Standard ({issues}) — skipping...")
            time.sleep(DELAY)

    if not variants:
        print(f"  ⚠ No Standard-legal lists found after exhausting all options")
    elif len(variants) < MAX_VARIANTS:
        print(f"  · Only found {len(variants)} legal variant(s); fewer than target {MAX_VARIANTS}")
    return variants


# ─── Git ──────────────────────────────────────────────────────────────────────

def git_push() -> bool:
    subprocess.run(["git", "add", "data/meta-decks.json"], cwd=WEB_REPO, check=True)
    result = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=WEB_REPO)
    if result.returncode == 0:
        print("[export_meta_decks] No changes to commit.")
        return False
    subprocess.run(
        ["git", "commit", "-m", "chore: update meta-decks.json with latest Standard-legal lists"],
        cwd=WEB_REPO, check=True,
    )
    subprocess.run(["git", "push"], cwd=WEB_REPO, check=True)
    print("[export_meta_decks] Pushed updated meta-decks.json.")
    return True


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    parser = argparse.ArgumentParser(description="Export meta deck lists from Limitless TCG")
    parser.add_argument("--no-push", action="store_true", help="Write file but skip git commit/push")
    parser.add_argument("--dry-run", action="store_true", help="Print plan without scraping")
    args = parser.parse_args()

    if not META_FILE.exists():
        print(f"ERROR: meta-archetypes.json not found at {META_FILE}", file=sys.stderr)
        sys.exit(1)

    with open(META_FILE) as f:
        archetypes = json.load(f)

    # Sort by total_entries descending, take top 30
    top30 = sorted(archetypes, key=lambda a: a["total_entries"], reverse=True)[:30]

    if args.dry_run:
        print(f"[export_meta_decks] Would scrape deck lists for {len(top30)} archetypes:")
        for i, a in enumerate(top30, 1):
            print(f"  {i:2d}. {a['name']:<30} (entries={a['total_entries']})")
        print("\nDry run — nothing scraped.")
        return

    print("[export_meta_decks] Loading card DB for rotation cross-checking...")
    card_db = load_card_db()
    if card_db:
        print(f"[export_meta_decks] Card DB loaded ({len(card_db)} names)")
    else:
        print("[export_meta_decks] Card DB not available — using set-code check only")

    results: list[dict] = []

    for i, arch in enumerate(top30, 1):
        print(f"[{i}/30] {arch['name']} (id={arch['id']}, entries={arch['total_entries']})")
        variants = scrape_variants_for_archetype(arch["name"], card_db)
        # `cards` mirrors the top variant for backward compatibility with any
        # consumer that still reads the single-deck shape.
        primary_cards = variants[0]["cards"] if variants else []
        results.append({
            "id": arch["id"],
            "name": arch["name"],
            "cards": primary_cards,
            "variants": variants,
        })
        if i < len(top30):
            time.sleep(DELAY)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w") as f:
        json.dump(results, f, indent=2)

    found = sum(1 for r in results if r["cards"])
    total_variants = sum(len(r.get("variants", [])) for r in results)
    print(
        f"\n[export_meta_decks] Done! {found}/30 archetypes scraped, "
        f"{total_variants} total variants. Saved to {OUT_FILE}"
    )

    if args.no_push:
        print("[export_meta_decks] Skipping git push (--no-push).")
        return

    pushed = git_push()
    print(f"[export_meta_decks] {'Deployed.' if pushed else 'No changes.'}")


if __name__ == "__main__":
    main()
