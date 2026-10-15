"""Make tests/fixtures/gear.json: inputs run through the PC app's gear module (and wikiparse.item_effects_from_text).

tests/gear.test.mjs runs the same inputs through www/js/gear.js and expects the same answers, so the JavaScript port
can't drift from the Python it came from. Usage:

    python3 tools/gear_fixtures.py /path/to/character-forge   # the PC app's repository

Arguments written "@pool:<key>" stand for a value stored once under "pools" (the random inventories).
New items get random ids; while this runs every id is "aaaaaaaaaa", and the test swaps any 10-hex-digit id for
that too. random_inventory() is shared with tools/parity_fixtures.py.
"""
import copy
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXED_ID = "aaaaaaaaaa"

EQUIPMENT_LINES = [
    "(a) a greataxe or (b) any martial melee weapon",
    "(a) two handaxes or (b) any simple weapon",
    "An explorer's pack and four javelins",
    "(a) a light crossbow and 20 bolts or (b) any simple weapon",
    "(a) a component pouch or (b) an arcane focus",
    "- Leather armor, two daggers, and thieves' tools.",
    "(a) a rapier, (b) a longsword, or (c) any simple weapon",
    "(a) a diplomat's pack or (b) an entertainer's pack",
    "(a) a lute or (b) any other musical instrument",
    "(a) a wooden shield or (b) any simple weapon",
    "(a) a scimitar or (b) any simple melee weapon",
    "(a) chain mail or (b) leather armor, longbow, and 20 arrows",
    "(a) a martial weapon and a shield or (b) two martial weapons",
    "(a) five javelins or (b) any simple melee weapon",
    "(a) scale mail or (b) leather armor",
    "(a) two shortswords or (b) two simple melee weapons",
    "A longbow and a quiver of 20 arrows",
    "A holy symbol and a pouch containing 15 gp",
    "10 darts",
    "A spellbook",
    "(a) a mace or (b) a warhammer (if proficient)",
    "• A set of artisan's tools or a musical instrument",
    "a mysterious orb, three sticks of incense, and 2 flasks of oil",
    "",
    "(a) three daggers, (b) a sling and 20 sling bullets",
    "Any two simple weapons of your choice",
    "50 feet of hempen rope and a grappling hook.",
    "a gaming set, a set of dice, 5 candles and a small knife",
]

PHRASES = [
    "leather armor", "two daggers", "Two Daggers", "a pouch containing 15 gp", "an explorer's pack", "10 torches",
    "a quiver of 20 arrows", "Quiver of 20 arrows", "any simple weapon", "two simple melee weapons",
    "any martial melee weapon", "three martial weapons of your choice", "a martial weapon", "another simple weapon",
    "50 feet of silk rope", "a hempen rope", "your choice of a holy symbol", "a set of artisan's tools",
    "a musical instrument", "a gaming set", "a bottle of black ink", "a quill", "a small knife",
    "a set of common clothes", "a belt pouch containing 10 gp", "5 sp", "a trinket", "twenty arrows",
    "ten days of rations", "2 flasks of oil", "sticks of incense", "an unknown widget", "three widgets",
    "a dagger (if proficient)", "a shield", "Thieves’ tools", "a vial of perfume", "the wolves", "boxes",
    "bushes", "classes", "foxes", "a set of fine clothes.", "  ", "", None, "a prayer book", "a deck of cards",
    "a holy symbol (a gift)", "any other musical instrument", "one simple weapon", "2 javelins", "1 gp and 3 sp",
    "a pouch with 5 gp", "a book of lore", "Crossbow bolts", "an emblem", "sprig of mistletoe",
]

LOOKUPS = ["Leather Armor", "  two   daggers ", "Torches", "knives", "Clothes, Common", "thieves’ tools", "SHIELD",
           "Rope", "potions of healing", "glaives", "boxes", "dresses", "", "nothing like it", "ball bearings (bag of 1,000)",
           "arrows", "candles", "plate armor", "scale mail", "Explorer's pack", "small knives"]

BACKGROUND_TEXT = [
    "Clothes, common, Pouch, 15 gp",
    "A holy symbol (a gift to you when you entered the priesthood), a prayer book or prayer wheel, 5 sticks of incense, "
    "vestments, a set of common clothes, and a belt pouch containing 15 gp",
    "A set of fine clothes, a signet ring, a scroll of pedigree, and a purse containing 25 gp",
    "A crowbar, a set of dark common clothes including a hood, and a belt pouch containing 15 gp",
    "A musical instrument (one of your choice), the favor of an admirer, a costume, and a belt pouch containing 15 gp",
    "A set of artisan's tools (one of your choice), a letter of introduction from your guild, a set of traveler's "
    "clothes, and a belt pouch containing 15 gp",
    "A staff, a hunting trap, a trophy from an animal you killed, a set of traveler's clothes, and a belt pouch "
    "containing 10 gp",
    "An arcane focus, a gaming set or a druidic focus, and 2 pp",
    "A bottle of black ink, a quill, a small knife, a letter from a dead colleague, a set of common clothes and 10 gp",
    "", None, "Two daggers and 5 gp or 3 sp", "a dagger or a sword",
]

TOOL_TEXT = ["Thieves' tools, tinker's tools", "One type of artisan's tools", "Three musical instruments of your choice",
             "Disguise kit, forgery kit", "One type of gaming set", "None", "", None, "Navigator’s tools, vehicles (water)",
             "Herbalism kit and the poisoner's kit", "LUTE"]


def custom_weapon(rng, n):
    w = {"damage": rng.choice(["1d8", " 2d6 ", "1d10", "1", ""]), "type": rng.choice(["slashing", "radiant", "", None]),
         "category": rng.choice(["martial", "simple", None]),
         "properties": rng.sample(["finesse", "versatile", "thrown", "ammunition", "light", "reach", "bogus", "heavy"],
                                  rng.randint(0, 4)),
         "versatile": rng.choice(["1d10", "", None]), "range": rng.choice(["", "20/60", "80/320", None]),
         "ranged": rng.random() < 0.3}
    return {"id": f"cw{n:08d}", "name": rng.choice(["Sun Blade", "Bone Club", "Spirit Bow", "Thing +1"]), "qty": 1,
            "weight": 3, "cost_cp": 0, "kind": "weapon", "equipped": rng.random() < 0.8, "weapon": w,
            "bonus": rng.choice([0, 0, 1, "2"])}


def custom_armor(rng, n):
    cat = rng.choice(["light", "medium", "heavy", "shield", "robe"])
    a = {"category": cat, "ac": rng.choice([11, 14, "16", None, 3]), "maxdex": rng.choice([None, "", "full", 2, "3", 0]),
         "str": rng.choice([0, 13, "15", None]), "stealth": rng.random() < 0.4}
    return {"id": f"cz{n:08d}", "name": rng.choice(["Mithral Coat", "Bark Skin", "Tower Shield"]), "qty": 1, "weight": 10,
            "cost_cp": 0, "kind": "armor", "equipped": rng.random() < 0.8, "armor": a, "bonus": rng.choice([0, 1])}


def random_inventory(rng, gear, srd_mod, magic_entries, size=None):
    """A random inventory: catalog items, custom weapons and armor, magic items, ammo, treasure and junk."""
    weapons = [w for w in srd_mod.WEAPONS if w != "Unarmed strike"]
    items, n = [], rng.randint(0, 10_000)
    count = size if size is not None else rng.randint(0, 12)
    for _ in range(count):
        n += 1
        roll = rng.random()
        if roll < 0.25:
            it = gear.make_item(rng.choice(weapons), rng.choice([1, 1, 1, 2, 5]))
            if rng.random() < 0.25:
                it["bonus"] = rng.choice([1, 2, 3, -1, "1"])
            if rng.random() < 0.15:
                it["bond"] = rng.choice(["pact", "hex", "bond", "kensei", "weird"])
            if rng.random() < 0.1:
                it["ability"] = rng.choice(["cha", "wis", "str", "xyz"])
            if rng.random() < 0.1:
                it["prof"] = rng.choice(["yes", "no", "auto"])
            if rng.random() < 0.15:
                it["equipped"] = False
        elif roll < 0.38:
            it = gear.make_item(rng.choice(list(srd_mod.ARMOR) + ["Shield"]))
            it["equipped"] = rng.random() < 0.7
            if rng.random() < 0.2:
                it["bonus"] = rng.choice([1, 2])
        elif roll < 0.48:
            it = gear.make_item(rng.choice(["Arrow", "Crossbow bolt", "Sling bullet", "Blowgun needle"]),
                                rng.choice([0, 1, 10, 20, "5"]))
        elif roll < 0.6:
            e = rng.choice(magic_entries)
            variants = (e["data"].get("variants") or [])
            it = gear.item_from_entry(e, rng.choice([None, 0, 1, 5]) if variants else None)
            if it.get("magic"):
                it["magic"]["desc"] = it["magic"]["desc"][:60]  # long text isn't what's being tested
                it["magic"]["attuned"] = rng.random() < 0.6
            if rng.random() < 0.15:
                it["equipped"] = not it.get("equipped")
        elif roll < 0.66:
            it = custom_weapon(rng, n)
        elif roll < 0.71:
            it = custom_armor(rng, n)
        elif roll < 0.78:
            it = {"id": f"tr{n:08d}", "name": rng.choice(["Ruby", "Gold ring", "Art object"]), "kind": "treasure",
                  "qty": rng.choice([1, 2, "3", -1]), "weight": rng.choice([0, 0.1, "0.5"]),
                  "value_cp": rng.choice([5000, 25, 10, 120.5, "300", 0])}
        elif roll < 0.95:
            it = gear.make_item(rng.choice(list(gear.GEAR) + list(gear.PACKS) + list(gear.EXTRA) + ["Mystery box"]),
                                rng.choice([1, 1, 2, 10]))
        else:
            it = rng.choice([{"name": "", "qty": 1}, {"name": "Junk", "qty": "x", "weight": "heavy"}, "not an item",
                             {"name": "Odd", "kind": "magic", "equipped": True, "effects": ["no", {"type": "ac"}]}])
        if isinstance(it, dict):
            if rng.random() < 0.08:
                it["carried"] = False
            if rng.random() < 0.08:
                it["notes"] = rng.choice(["  from grandma ", "chipped"])
            if rng.random() < 0.05:
                it["charges"] = {"max": rng.choice([3, "7"]), "used": rng.choice([0, 1, 9])}
        items.append(it)
    return items


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.path.insert(0, sys.argv[1])
    from app import gear, srd, wikiparse  # noqa: E402  (the PC app)
    from magic_items import MAGIC_ITEMS  # noqa: E402

    gear.new_id = lambda: FIXED_ID
    rng = random.Random(20261016)
    entries = [{**e, "id": 7000 + i} for i, e in enumerate(MAGIC_ITEMS)]
    modules = {"gear": gear, "wikiparse": wikiparse}
    cases, skipped, pools = [], {}, {}

    def resolve(a):
        if isinstance(a, str) and a.startswith("@pool:"):
            return copy.deepcopy(pools[a[6:]])
        if isinstance(a, list):
            return [resolve(x) for x in a]
        if isinstance(a, dict):
            return {k: resolve(v) for k, v in a.items()}
        return a

    def pool(key, value):
        pools[key] = json.loads(json.dumps(value))
        return f"@pool:{key}"

    def case(fn, *args):
        mod, name = fn.split(".")
        stored = json.loads(json.dumps(args))
        try:
            out = getattr(modules[mod], name)(*[resolve(a) for a in copy.deepcopy(list(args))])
        except Exception:  # noqa: BLE001  (inputs Python rejects: the JavaScript must throw too)
            skipped[fn] = skipped.get(fn, 0) + 1
            cases.append({"fn": fn, "args": stored, "raises": True})
            return None
        cases.append({"fn": fn, "args": stored, "out": json.loads(json.dumps(out))})
        return out

    constants = {f"gear.{k}": json.loads(json.dumps(getattr(gear, k))) for k in (
        "GP", "SP", "CP", "WEAPON_COST", "ARMOR_COST", "GEAR", "EXTRA", "PACKS", "FOCUS_CHOICES", "ARTISAN_TOOLS",
        "AMMO_FOR", "STARTING_EQUIPMENT", "STARTING_WEALTH", "OLD_NAMES", "ALIASES", "NUM", "DAMAGE_TYPES",
        "WEAPON_FLAGS", "BOW_FORMS", "EFFECT_TYPES", "COIN_ORDER", "KIND_ORDER", "BOND_LABEL", "INSTRUMENTS",
        "FOCUS_BY_CLASS", "KIND_FOR_TYPE", "DEFAULT_FORM")}
    constants["gear.CHOICES"] = {k: v[0] for k, v in gear.CHOICES.items()}
    constants.update({f"srd.{k}": json.loads(json.dumps(getattr(srd, k)))
                      for k in ("MULTICLASS_PROFS", "CANTRIPS_KNOWN", "SPELLS_KNOWN")})

    # ---------------------------------------------------------- text into items
    for s in LOOKUPS:
        case("gear.lookup", s)
    for p in PHRASES:
        case("gear.parse_phrase", p)
    for line in EQUIPMENT_LINES + BACKGROUND_TEXT:
        case("gear.split_items", line)
        case("gear.parse_line", line)
    for slug in list(gear.STARTING_EQUIPMENT) + ["homebrew", "", "blood-hunter"]:
        case("gear.starting_equipment", slug)
        case("gear.starting_equipment", slug, rng.sample(EQUIPMENT_LINES, 5))
    case("gear.starting_equipment", "homebrew", EQUIPMENT_LINES)
    case("gear.starting_equipment", "homebrew", None)
    for text in BACKGROUND_TEXT + EQUIPMENT_LINES[:8]:
        case("gear.background_items", text)
        case("gear.items_from_text", text)
    tokens = ["Dagger", "Dagger*2", "simple", "martial-melee*2", "arcane-focus", "holy-symbol", "instrument",
              "custom:Lucky coin", "custom:Rocks*3", "coins:gp:15", "Explorer's pack", "Shield", "Plate", "Torch*10",
              "Trinket", "Mystery", "Arrow*20", "gaming-set", "artisan-tools", "bad*x", "coins:gp"]
    for _ in range(40):
        case("gear.resolve_option", rng.sample(tokens, rng.randint(0, 4)))
        case("gear.option_label", rng.sample(tokens, rng.randint(0, 4)))
    for name in list(gear.PACKS) + ["Leather", "Studded leather", "Chain mail", "Mystery"]:
        case("gear.display_name", name)

    # ---------------------------------------------------------- the catalog and items
    case("gear.catalog")
    names = (list(srd.WEAPONS) + list(srd.ARMOR) + ["Shield"] + list(gear.GEAR) + list(gear.PACKS) + list(gear.EXTRA)
             + ["Custom thing", ""])
    for name in names:
        case("gear.make_item", name)
    for _ in range(30):
        case("gear.make_item", rng.choice(names), rng.choice([1, 3, 20]), rng.choice(["", "class", "background"]),
             rng.choice(["", "a note"]))
    for pack in gear.PACKS:
        case("gear.unpack", gear.make_item(pack))
    case("gear.unpack", {"name": "Empty"})
    for e in entries:
        case("gear.item_from_entry", e)
        for v in (0, 1, 2, -1, 9, True, "1"):
            if e["data"].get("variants"):
                case("gear.item_from_entry", e, v)
        text = e["data"].get("text") or ""
        for kind in ("weapon", "armor", "potion", "staff", "ring", "ammunition", "shield", ""):
            case("wikiparse.item_effects_from_text", text, {"item_type": kind, "variants": e["data"].get("variants") or []})
    for text in ["", "Your Wisdom score becomes 18 and your Dexterity score is 20.", "+3 bonus to AC and saving throws.",
                 "You have resistance to cold damage. You have resistance to thunder damage. You have resistance to all damage.",
                 "Hit: extra 1d8 damage. Against undead, an extra 2d6 radiant damage? Once per turn it deals an extra 1d4 acid "
                 "damage!  Then an extra 3d6 thunder damage.", "your speed is increased by 5 feet.\n\nA +2 bonus to initiative.",
                 "+1 bonus to spell attack rolls. +2 bonus to your spell save DC.",
                 "You hit a creature: extra 1d6 necrotic damage. You hit an attack roll: extra 1d6 fire damage."]:
        for kind in ("weapon", "wondrous", "potion"):
            case("wikiparse.item_effects_from_text", text, {"item_type": kind})
    case("wikiparse.item_effects_from_text", "a bonus to spell attack rolls determined by the rod's rarity", {"variants": [{"bonus": 2}]})
    case("gear.item_from_entry", {"name": "Bare"})
    case("gear.item_from_entry", {"data": {"item_type": "weapon", "type_detail": "any axe", "bonus": "2"}})
    case("gear.item_from_entry", {"data": {"item_type": "armor", "type_detail": "plate", "rarity": "varies"}})
    case("gear.item_from_entry", {"data": {"item_type": "staff", "works_as": "something", "effects": []}})
    case("gear.item_from_entry", {"data": {"item_type": "Potion", "effects": [{"type": "hp", "value": 2}], "charges": 2.5}})

    srd_items = []
    for _ in range(45):
        inv = random_inventory(rng, gear, srd, entries)
        srd_items.append(inv)
        dicts = [i for i in inv if isinstance(i, dict)]
        ref = pool(f"inv{len(pools)}", dicts)
        case("gear.item_effects", ref)
        case("gear.inventory_lines", ref)
        case("gear.total_weight", ref, rng.choice([None, {}, {"gp": 120, "sp": "30", "cp": -4, "pp": 2.5}, {"ep": "x"}]))
        case("gear.treasure_value", ref)
        case("gear.merge_items", copy.deepcopy(dicts[:3]), copy.deepcopy(rng.sample(dicts, min(3, len(dicts)))))
        case("gear.gear_in_use", {"inventory": pool(f"raw{len(pools)}", inv)})
        for it in dicts[:3]:
            for fn in ("role", "weapon_stats", "armor_stats", "shield_ac", "magic_active", "in_use", "sort_key"):
                case(f"gear.{fn}", it)
    case("gear.merge_items", [gear.make_item("Torch", 2)], [gear.make_item("Torch", 3), gear.make_item("Shield"),
                                                            gear.make_item("Torch", 1, note="wet")])
    for char in [{}, {"armor": "Plate", "shield": True, "weapons": ["Longsword", "Unarmed strike", {"name": "Dagger", "bonus": "1"},
                                                                    {"name": "Mace", "bonus": 0}, "Nothing", {"name": "Spear"}]},
                 {"inventory": []}, {"inventory": None, "armor": "Hide", "weapons": ["Unarmed strike"], "unarmed": False},
                 {"armor": "Leather armor", "shield": 0}]:
        case("gear.ensure_inventory", char)
        case("gear.gear_in_use", char)
    for coins in [None, {}, {"gp": 15}, {"pp": 1, "gp": "2", "ep": 0, "sp": 3.7, "cp": -1}, {"gp": "lots"}]:
        case("gear.coins_text", coins)
    for cp in [0, 1, 5, 9, 10, 15, 30, 99, 100, 150, 250, 1234, 2.5, 0.25, 12.5, 1e6, 123456789, "40", None, "x", -20, 150000]:
        case("gear.money", cp)
    for lv in [{}, {"artificer": 9}, {"artificer": 10}, {"artificer": 14}, {"artificer": 18}, {"wizard": 20}]:
        case("gear.attunement_limit", lv)
    for t in TOOL_TEXT:
        case("gear.tool_profs", t)
    for slugs in [[], ["wizard"], ["cleric", "paladin"], ["bard", "druid", "artificer"], ["fighter"], ["warlock", "sorcerer"]]:
        case("gear.usable_focus", slugs)
        case("gear.usable_focus", slugs, True)

    out = ROOT / "tests" / "fixtures" / "gear.json"
    out.write_text(json.dumps({"constants": constants, "pools": pools, "cases": cases}, ensure_ascii=False), encoding="utf-8")
    fns = sorted({c["fn"] for c in cases})
    print(f"Wrote {len(cases)} cases for {len(fns)} functions to {out} ({out.stat().st_size // 1024} KB)")
    if skipped:
        print("Python raised (the test expects JavaScript to throw):", skipped)


if __name__ == "__main__":
    main()
