#!/usr/bin/env python3
"""
export_cards_standard.py — Export cards-standard.json from cards.db + prices.db.

Reads card data from cards.db (synced via sync_new_sets.py) and market prices
from prices.db (synced daily via pokemon_price_sync.py), then writes a merged
cards-standard.json keyed by card name for the web app's analysis engine.

Output format (consumed by /api/analyze):
{
  "Pikachu": [
    {
      "name": "Pikachu",
      "set_id": "sv1",
      "set_name": "Scarlet & Violet",
      "number": "56",
      "supertype": "Pokémon",
      "subtypes": ["Basic"],
      "types": ["Lightning"],
      "rarity": "Common",
      "hp": "60",
      "abilities": [],
      "attacks": [...],
      "rules": [],
      "regulation_mark": "G",
      "retreat_cost": 1,
      "market_price": 0.12
    },
    ...
  ],
  ...
}

Commits and pushes to tcgdexter-web if data changed.

Usage:
    python3 export_cards_standard.py              # full export
    python3 export_cards_standard.py --dry-run     # export without git push
    python3 export_cards_standard.py --no-push     # write file but skip git
"""

import argparse
import json
import re
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

# Variant preference order for headline market_price. When prices.db has
# multiple variant rows for the same printing (e.g. Jungle/Fossil holos
# tracked as both firstEditionHolofoil and unlimitedHolofoil), we pick
# the variant earliest in this list. The intent is to default to the
# Unlimited print run rather than 1st Edition — 1st Edition is a niche
# collector variant that prices 2–13× higher and overstates a typical
# user's collection value when applied as the default.
VARIANT_PREFERENCE = (
    "normal",
    "unlimited",
    "holofoil",
    "unlimitedHolofoil",
    "1stedition",
    "firstEditionHolofoil",
    "reverseHolofoil",
)
_PREF_RANK = {v: i for i, v in enumerate(VARIANT_PREFERENCE)}


def _normalize_name(name: str) -> str:
    # Strip trailing " (NN)" where NN is digits — TCGplayer's disambiguator
    # for cards sharing a name in the same set (e.g. "Articuno (2)" vs
    # "Articuno (17)" in Fossil). cards.db uses plain "Articuno" and
    # disambiguates by number, so we drop the suffix to match. Other
    # parentheticals like "(Full Art)" or "(Secret)" denote distinct
    # printings and are preserved.
    return re.sub(r"\s*\(\d+\)\s*$", "", name).strip()

# ─── Paths ────────────────────────────────────────────────────────────────────

CARDS_DB  = Path.home() / "Library/Application Support/Dexter/cards.db"
PRICES_DB = Path.home() / "Library/Application Support/Dexter/prices.db"
WEB_REPO  = Path(__file__).resolve().parent.parent
OUT_FILE  = WEB_REPO / "data/cards-standard.json"

# ─── Helpers ──────────────────────────────────────────────────────────────────


def load_prices(db_path: Path) -> dict[tuple[str, str, str], float]:
    """Load market prices from prices.db. Returns {(name, number, set_name): price}.

    When prices.db has multiple variant rows for the same printing, the
    variant earliest in VARIANT_PREFERENCE wins. Names are normalized to
    strip TCGplayer's "(N)" disambiguator so prices.db's "Articuno (2)"
    matches cards.db's "Articuno" keyed by number.
    """
    if not db_path.exists():
        print(f"WARNING: prices.db not found at {db_path} — prices will be 0")
        return {}

    con = sqlite3.connect(str(db_path))
    rows = con.execute(
        "SELECT name, number, set_name, variant, market_price FROM card_prices"
    ).fetchall()
    con.close()

    # Group every variant we know about per (name, number, set_name).
    grouped: dict[tuple[str, str, str], dict[str, float]] = defaultdict(dict)
    for name, number, set_name, variant, price in rows:
        # Normalize number: "063/165" → "63" (strip leading zeros and slash suffix)
        num_clean = number.split("/")[0].lstrip("0") or "0"
        key = (_normalize_name(name), num_clean, set_name.strip())
        grouped[key][variant] = price

    # Collapse each group to a single price by picking the most preferred
    # variant present. Unknown variants sort last so they're only used as a
    # final fallback rather than overriding a known preference.
    prices: dict[tuple[str, str, str], float] = {}
    for key, variants in grouped.items():
        best = min(variants, key=lambda v: _PREF_RANK.get(v, len(VARIANT_PREFERENCE)))
        prices[key] = variants[best]
    return prices


def load_cards(db_path: Path, prices: dict) -> dict[str, list[dict]]:
    """Load cards from cards.db, merge with prices, return keyed by name."""
    if not db_path.exists():
        print(f"ERROR: cards.db not found at {db_path}", file=sys.stderr)
        sys.exit(1)

    con = sqlite3.connect(str(db_path))
    con.row_factory = sqlite3.Row
    rows = con.execute("""
        SELECT id, name, number, set_id, set_name, set_release_date,
               rarity, supertype, hp, artist,
               types, subtypes, regulation_mark,
               abilities, attacks, retreat_cost,
               weaknesses, rules
        FROM cards
    """).fetchall()
    con.close()

    cards_by_name: dict[str, list[dict]] = defaultdict(list)

    for row in rows:
        name = row["name"]
        number = row["number"]
        set_name = row["set_name"]

        # Look up market price by (name, number, set_name)
        num_clean = number.lstrip("0") or "0"
        price = prices.get((name, num_clean, set_name), 0.0)

        # Also try a broader lookup by just name if exact match fails
        if price == 0.0:
            for key, p in prices.items():
                if key[0] == name and key[2] == set_name:
                    price = p
                    break

        # Parse JSON columns
        def parse_json(val, default=None):
            if default is None:
                default = []
            if val is None or val == "":
                return default
            try:
                return json.loads(val)
            except (json.JSONDecodeError, TypeError):
                return default

        subtypes = parse_json(row["subtypes"])
        types = parse_json(row["types"])
        abilities_raw = parse_json(row["abilities"])
        attacks_raw = parse_json(row["attacks"])
        rules = parse_json(row["rules"])

        # Normalize abilities to match web app interface
        abilities = []
        for a in abilities_raw:
            abilities.append({
                "type": a.get("type", "Ability"),
                "name": a.get("name", ""),
                "text": a.get("text", ""),
            })

        # Normalize attacks to match web app interface
        attacks = []
        for a in attacks_raw:
            attacks.append({
                "name": a.get("name", ""),
                "cost": a.get("cost", []),
                "convertedEnergyCost": a.get("convertedEnergyCost", len(a.get("cost", []))),
                "damage": a.get("damage", ""),
                "text": a.get("text", ""),
            })

        card_entry = {
            "name": name,
            "set_id": row["set_id"],
            "set_name": set_name,
            "number": number,
            "supertype": row["supertype"] or "",
            "subtypes": subtypes,
            "types": types,
            "rarity": row["rarity"],
            "hp": row["hp"],
            "artist": row["artist"],
            "abilities": abilities,
            "attacks": attacks,
            "rules": rules,
            "regulation_mark": row["regulation_mark"],
            "retreat_cost": row["retreat_cost"],
            "market_price": round(price, 2),
        }

        cards_by_name[name].append(card_entry)

    _apply_catalog_stubs(cards_by_name)
    return dict(cards_by_name)


# Minimal records for printings present in user collections but not yet
# synced into cards.db. The upstream pipeline (sync_new_sets.py) is the
# proper place for these — these stubs are a transient gap-filler so
# /my-collection imports resolve. Each entry is the smallest shape the
# web app reads: name/set/number/rarity/supertype, everything else null
# or empty. Remove individual stubs once cards.db carries them.
CATALOG_STUBS: list[dict] = [
    # Mega Evolution Black Star Promos (set_id "mep")
    {"name": "Psyduck",                 "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "7",   "supertype": "Pokémon", "subtypes": ["Basic"],   "rarity": "Promo"},
    {"name": "Alakazam",                "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "9",   "supertype": "Pokémon", "subtypes": ["Stage 2"], "rarity": "Promo"},
    {"name": "Sneasel",                 "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "20",  "supertype": "Pokémon", "subtypes": ["Basic"],   "rarity": "Promo"},
    {"name": "Haunter",                 "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "27",  "supertype": "Pokémon", "subtypes": ["Stage 1"], "rarity": "Promo"},
    {"name": "N's Zekrom",              "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "31",  "supertype": "Pokémon", "subtypes": ["Basic"],   "rarity": "Promo"},
    {"name": "Bulbasaur",               "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "37",  "supertype": "Pokémon", "subtypes": ["Basic"],   "rarity": "Promo"},
    {"name": "Charmander",              "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "38",  "supertype": "Pokémon", "subtypes": ["Basic"],   "rarity": "Promo"},
    {"name": "Squirtle",                "set_id": "mep",      "set_name": "Mega Evolution Black Star Promos", "ptcgo_code": "PR-ME", "number": "39",  "supertype": "Pokémon", "subtypes": ["Basic"],   "rarity": "Promo"},
    # Scarlet & Violet Black Star Promos (svp) gaps
    {"name": "Espeon ex",               "set_id": "svp",      "set_name": "Scarlet & Violet Black Star Promos", "ptcgo_code": "PR-SV", "number": "175", "supertype": "Pokémon", "subtypes": [], "rarity": "Promo"},
    {"name": "Team Rocket's Mewtwo ex", "set_id": "svp",      "set_name": "Scarlet & Violet Black Star Promos", "ptcgo_code": "PR-SV", "number": "205", "supertype": "Pokémon", "subtypes": [], "rarity": "Promo"},
    {"name": "Victini",                 "set_id": "svp",      "set_name": "Scarlet & Violet Black Star Promos", "ptcgo_code": "PR-SV", "number": "208", "supertype": "Pokémon", "subtypes": [], "rarity": "Promo"},
    # Black Bolt (zsv10pt5) gap
    {"name": "Antique Cover Fossil",    "set_id": "zsv10pt5", "set_name": "Black Bolt", "ptcgo_code": "BLK", "number": "80", "supertype": "Trainer", "subtypes": ["Item"], "rarity": "Common"},
]


def _apply_catalog_stubs(cards_by_name: dict[str, list[dict]]) -> None:
    """Append CATALOG_STUBS entries to cards_by_name, skipping any printing
    that's already present (so a sync that finally pulls the real card in
    silently displaces the stub on the next run)."""
    for s in CATALOG_STUBS:
        bucket = cards_by_name.setdefault(s["name"], [])
        if any(c.get("set_id") == s["set_id"] and c.get("number") == s["number"] for c in bucket):
            continue
        bucket.append({
            "name": s["name"],
            "set_id": s["set_id"],
            "set_name": s["set_name"],
            "ptcgo_code": s["ptcgo_code"],
            "number": s["number"],
            "supertype": s["supertype"],
            "subtypes": s.get("subtypes", []),
            "types": [],
            "rarity": s["rarity"],
            "hp": None,
            "abilities": [],
            "attacks": [],
            "rules": [],
            "regulation_mark": None,
            "retreat_cost": None,
            "market_price": 0,
        })


def git_push(repo: Path) -> bool:
    """Stage, commit, and push cards-standard.json if changed."""
    subprocess.run(["git", "add", "data/cards-standard.json"], cwd=repo, check=True)
    result = subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=repo)
    if result.returncode == 0:
        print("[export_cards_standard] No changes to commit.")
        return False
    subprocess.run(
        ["git", "commit", "-m", "chore: update cards-standard.json with latest prices"],
        cwd=repo, check=True,
    )
    subprocess.run(["git", "push"], cwd=repo, check=True)
    print("[export_cards_standard] Pushed updated cards-standard.json.")
    return True


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Export cards-standard.json from cards.db + prices.db")
    parser.add_argument("--dry-run", action="store_true", help="Print stats but don't write file")
    parser.add_argument("--no-push", action="store_true", help="Write file but skip git commit/push")
    parser.add_argument("--cards-db", default=str(CARDS_DB), help="Path to cards.db")
    parser.add_argument("--prices-db", default=str(PRICES_DB), help="Path to prices.db")
    args = parser.parse_args()

    cards_db = Path(args.cards_db)
    prices_db = Path(args.prices_db)

    print("[export_cards_standard] Loading prices from prices.db...")
    prices = load_prices(prices_db)
    print(f"[export_cards_standard] {len(prices)} price entries loaded")

    print("[export_cards_standard] Loading cards from cards.db...")
    cards = load_cards(cards_db, prices)

    total_cards = sum(len(v) for v in cards.values())
    priced = sum(1 for v in cards.values() for c in v if c["market_price"] > 0)
    print(f"[export_cards_standard] {len(cards)} unique names, {total_cards} total printings, {priced} with prices")

    if args.dry_run:
        print("[export_cards_standard] Dry run — not writing file.")
        return

    if not WEB_REPO.exists():
        print(f"ERROR: tcgdexter-web not found at {WEB_REPO}", file=sys.stderr)
        sys.exit(1)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")))
    size_mb = OUT_FILE.stat().st_size / (1024 * 1024)
    print(f"[export_cards_standard] Written {OUT_FILE} ({size_mb:.1f} MB)")

    if args.no_push:
        print("[export_cards_standard] Skipping git push (--no-push).")
        return

    pushed = git_push(WEB_REPO)
    print(f"[export_cards_standard] Done. {'Deployed.' if pushed else 'No changes.'}")


if __name__ == "__main__":
    main()
