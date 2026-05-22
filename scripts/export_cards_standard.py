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
import sqlite3
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

# ─── Paths ────────────────────────────────────────────────────────────────────

CARDS_DB  = Path.home() / "Library/Application Support/Dexter/cards.db"
PRICES_DB = Path.home() / "Library/Application Support/Dexter/prices.db"
WEB_REPO  = Path(__file__).resolve().parent.parent
OUT_FILE  = WEB_REPO / "data/cards-standard.json"

# ─── Helpers ──────────────────────────────────────────────────────────────────


def load_prices(db_path: Path) -> dict[tuple[str, str, str], float]:
    """Load market prices from prices.db. Returns {(name, number, set_name): price}."""
    if not db_path.exists():
        print(f"WARNING: prices.db not found at {db_path} — prices will be 0")
        return {}

    con = sqlite3.connect(str(db_path))
    rows = con.execute(
        "SELECT name, number, set_name, market_price FROM card_prices WHERE variant = 'normal'"
    ).fetchall()
    con.close()

    prices: dict[tuple[str, str, str], float] = {}
    for name, number, set_name, price in rows:
        # Normalize number: "063/165" → "63" (strip leading zeros and slash suffix)
        num_clean = number.split("/")[0].lstrip("0") or "0"
        prices[(name.strip(), num_clean, set_name.strip())] = price
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
    # Chaos Rising (me4) — full set; released 2026/05/22 ahead of the cards.db sync.
    # Mega Evolution chains: Pyroar/Floette/Dragalge are Stage 1 megas; Greninja/Gallade are Stage 2 megas.
    # Trainer subtypes here are best-effort; the DexterDaemon sync will overwrite with the canonical values.
    {"name": "Weedle",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "1",   "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Kakuna",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "2",   "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Beedrill ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "3",   "supertype": "Pokémon", "subtypes": ["Stage 2", "ex"],    "rarity": "Double Rare"},
    {"name": "Carnivine",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "4",   "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Chespin",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "5",   "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Quilladin",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "6",   "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Chesnaught",              "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "7",   "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Rare"},
    {"name": "Vulpix",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "8",   "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Ninetales",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "9",   "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Ho-Oh",                   "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "10",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Rare"},
    {"name": "Fennekin",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "11",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Braixen",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "12",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Delphox",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "13",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Rare"},
    {"name": "Litleo",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "14",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Mega Pyroar ex",          "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "15",  "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Double Rare"},
    {"name": "Remoraid",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "16",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Octillery",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "17",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Delibird",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "18",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Keldeo",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "19",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Rare"},
    {"name": "Froakie",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "20",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Frogadier",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "21",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Mega Greninja ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "22",  "supertype": "Pokémon", "subtypes": ["Stage 2", "MEGA", "ex"], "rarity": "Double Rare"},
    {"name": "Bergmite",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "23",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Avalugg",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "24",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Wimpod",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "25",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Golisopod",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "26",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Mareep",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "27",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Flaaffy",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "28",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Ampharos",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "29",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Rare"},
    {"name": "Emolga",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "30",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Deoxys",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "31",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Deoxys",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "32",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Deoxys",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "33",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Deoxys",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "34",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Mega Floette ex",         "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "35",  "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Double Rare"},
    {"name": "Espurr",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "36",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Meowstic",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "37",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Phantump",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "38",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Trevenant",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "39",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Rare"},
    {"name": "Pumpkaboo",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "40",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Gourgeist ex",            "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "41",  "supertype": "Pokémon", "subtypes": ["Stage 1", "ex"],    "rarity": "Double Rare"},
    {"name": "Xerneas",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "42",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Rare"},
    {"name": "Sudowoodo",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "43",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Phanpy",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "44",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Donphan",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "45",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Baltoy",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "46",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Claydol",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "47",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Mega Gallade ex",         "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "48",  "supertype": "Pokémon", "subtypes": ["Stage 2", "MEGA", "ex"], "rarity": "Double Rare"},
    {"name": "Zubat",                   "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "49",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Golbat",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "50",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Crobat",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "51",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Rare"},
    {"name": "Qwilfish",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "52",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Stunky",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "53",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Skuntank",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "54",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Krookodile ex",           "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "55",  "supertype": "Pokémon", "subtypes": ["Stage 2", "ex"],    "rarity": "Double Rare"},
    {"name": "Trubbish",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "56",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Garbodor",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "57",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Skrelp",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "58",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Beldum",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "59",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Metang",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "60",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Metagross",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "61",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Uncommon"},
    {"name": "Ferroseed",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "62",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Ferrothorn",              "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "63",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Uncommon"},
    {"name": "Cobalion ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "64",  "supertype": "Pokémon", "subtypes": ["Basic", "ex"],      "rarity": "Double Rare"},
    {"name": "Mega Dragalge ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "65",  "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Double Rare"},
    {"name": "Goomy",                   "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "66",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Sliggoo",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "67",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Goodra",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "68",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Rare"},
    {"name": "Tauros",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "69",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Uncommon"},
    {"name": "Patrat",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "70",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Watchog",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "71",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Common"},
    {"name": "Minccino",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "72",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Common"},
    {"name": "Cinccino ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "73",  "supertype": "Pokémon", "subtypes": ["Stage 1", "ex"],    "rarity": "Double Rare"},
    {"name": "Adversity Policy",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "74",  "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Uncommon"},
    {"name": "Ange Floette",            "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "75",  "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Uncommon"},
    {"name": "AZ's Tranquility",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "76",  "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Uncommon"},
    {"name": "Emma",                    "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "77",  "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Uncommon"},
    {"name": "Great Haul Net",          "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "78",  "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Uncommon"},
    {"name": "Philippe",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "79",  "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Uncommon"},
    {"name": "Prism Tower",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "80",  "supertype": "Trainer", "subtypes": ["Stadium"],          "rarity": "Uncommon"},
    {"name": "Roxie's Performance",     "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "81",  "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Uncommon"},
    {"name": "Special Red Card",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "82",  "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Uncommon"},
    {"name": "Transformation Tome",     "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "83",  "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Uncommon"},
    {"name": "Bubbly Water Energy",     "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "84",  "supertype": "Energy",  "subtypes": ["Special"],          "rarity": "Rare"},
    {"name": "Magnetic Metal Energy",   "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "85",  "supertype": "Energy",  "subtypes": ["Special"],          "rarity": "Rare"},
    {"name": "Nitro Fire Energy",       "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "86",  "supertype": "Energy",  "subtypes": ["Special"],          "rarity": "Rare"},
    {"name": "Chespin",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "87",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Illustration Rare"},
    {"name": "Froakie",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "88",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Illustration Rare"},
    {"name": "Frogadier",               "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "89",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Illustration Rare"},
    {"name": "Ampharos",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "90",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Illustration Rare"},
    {"name": "Xerneas",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "91",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Illustration Rare"},
    {"name": "Claydol",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "92",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Illustration Rare"},
    {"name": "Crobat",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "93",  "supertype": "Pokémon", "subtypes": ["Stage 2"],          "rarity": "Illustration Rare"},
    {"name": "Metang",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "94",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Illustration Rare"},
    {"name": "Sliggoo",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "95",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Illustration Rare"},
    {"name": "Tauros",                  "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "96",  "supertype": "Pokémon", "subtypes": ["Basic"],            "rarity": "Illustration Rare"},
    {"name": "Watchog",                 "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "97",  "supertype": "Pokémon", "subtypes": ["Stage 1"],          "rarity": "Illustration Rare"},
    {"name": "Beedrill ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "98",  "supertype": "Pokémon", "subtypes": ["Stage 2", "ex"],    "rarity": "Ultra Rare"},
    {"name": "Mega Pyroar ex",          "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "99",  "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Ultra Rare"},
    {"name": "Mega Greninja ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "100", "supertype": "Pokémon", "subtypes": ["Stage 2", "MEGA", "ex"], "rarity": "Ultra Rare"},
    {"name": "Mega Floette ex",         "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "101", "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Ultra Rare"},
    {"name": "Gourgeist ex",            "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "102", "supertype": "Pokémon", "subtypes": ["Stage 1", "ex"],    "rarity": "Ultra Rare"},
    {"name": "Cobalion ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "103", "supertype": "Pokémon", "subtypes": ["Basic", "ex"],      "rarity": "Ultra Rare"},
    {"name": "Mega Dragalge ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "104", "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Ultra Rare"},
    {"name": "Cinccino ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "105", "supertype": "Pokémon", "subtypes": ["Stage 1", "ex"],    "rarity": "Ultra Rare"},
    {"name": "AZ's Tranquility",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "106", "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Ultra Rare"},
    {"name": "Emma",                    "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "107", "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Ultra Rare"},
    {"name": "Energy Retrieval",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "108", "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Ultra Rare"},
    {"name": "Jumbo Ice Cream",         "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "109", "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Ultra Rare"},
    {"name": "Philippe",                "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "110", "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Ultra Rare"},
    {"name": "Prism Tower",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "111", "supertype": "Trainer", "subtypes": ["Stadium"],          "rarity": "Ultra Rare"},
    {"name": "Roxie's Performance",     "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "112", "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Ultra Rare"},
    {"name": "Special Red Card",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "113", "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Ultra Rare"},
    {"name": "Surfing Beach",           "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "114", "supertype": "Trainer", "subtypes": ["Stadium"],          "rarity": "Ultra Rare"},
    {"name": "Tool Scrapper",           "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "115", "supertype": "Trainer", "subtypes": ["Item"],             "rarity": "Ultra Rare"},
    {"name": "Mega Greninja ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "116", "supertype": "Pokémon", "subtypes": ["Stage 2", "MEGA", "ex"], "rarity": "Special Illustration Rare"},
    {"name": "Mega Floette ex",         "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "117", "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Special Illustration Rare"},
    {"name": "Mega Dragalge ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "118", "supertype": "Pokémon", "subtypes": ["Stage 1", "MEGA", "ex"], "rarity": "Special Illustration Rare"},
    {"name": "Cinccino ex",             "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "119", "supertype": "Pokémon", "subtypes": ["Stage 1", "ex"],    "rarity": "Special Illustration Rare"},
    {"name": "AZ's Tranquility",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "120", "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Special Illustration Rare"},
    {"name": "Roxie's Performance",     "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "121", "supertype": "Trainer", "subtypes": ["Supporter"],        "rarity": "Special Illustration Rare"},
    {"name": "Mega Greninja ex",        "set_id": "me4", "set_name": "Chaos Rising", "ptcgo_code": "CHR", "number": "122", "supertype": "Pokémon", "subtypes": ["Stage 2", "MEGA", "ex"], "rarity": "Mega Hyper Rare"},
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
