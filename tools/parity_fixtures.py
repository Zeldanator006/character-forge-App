"""Make tests/fixtures/parity.json: random characters run through the PC app's Python rules engine.

tests/parity.test.mjs runs the same characters through www/js/rules.js and expects the same sheets,
so the JavaScript port can't drift from the engine it came from. Usage:

    python3 tools/parity_fixtures.py /path/to/character-forge   # the PC app's repository

The characters carry inventories (weapons, armor, shields, ammunition, magic items with effects and attunement,
custom weapons and armor, coins), feats that grant things, class options and invocations, companions and
Wild Shape, multiclassing, and hand-written (manual) sheets. Each case is run with rules.compute_any; some also
go through rules.to_manual and back through compute_any. Big SRD blocks in the context are stored as
"@kind:path" references the test resolves from srd-2014.json (species selections, "@race:...", are stored once
under "races"), and long feature text is compared by hash.
"""
import copy
import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COUNT = 180
MANUAL_COUNT = 30

FEAT_TEXT = {  # feats the PC app reads from their text (the rest it knows by name)
    "Tough": "Your hit point maximum increases by an amount equal to twice your level.",
    "Arcane Dabbler": "You learn two cantrips of your choice from the wizard spell list. Intelligence is your "
                      "spellcasting ability for these spells.",
    "Gifted": "You learn the mage hand cantrip and you gain proficiency in one skill of your choice.",
}
FEATS = [
    # (name, prerequisite, extra fields picker)
    ("Tough", "", None), ("Alert", "", None), ("Mobile", "", None), ("Observant", "", None), ("Lucky", "", None),
    ("Resilient", "", "asi"), ("Lightly Armored", "", None), ("Moderately Armored", "Proficiency with light armor", None),
    ("Heavily Armored", "Proficiency with medium armor", None), ("Medium Armor Master", "Proficiency with medium armor", None),
    ("Grappler", "Strength 13 or higher", None), ("War Caster", "The ability to cast at least one spell", None),
    ("Skilled", "", None), ("Weapon Master", "", "weapons"), ("Magic Initiate", "", "spell_class"),
    ("Fey Touched", "", "asi"), ("Eldritch Adept", "Spellcasting or Pact Magic feature", None),
    ("Fighting Initiate", "Proficiency with a martial weapon", None), ("Metamagic Adept", "Spellcasting or Pact Magic feature", None),
    ("Martial Adept", "", None), ("Elven Accuracy", "Elf or half-elf", "asi"), ("Squat Nimbleness", "Dwarf or a Small race", None),
    ("Arcane Dabbler", "4th level", None), ("Gifted", "Charisma 13 or higher", None), ("Ritual Caster", "Intelligence or Wisdom 13 or higher", "spell_class"),
]
SPECIAL_SPELLS = ["Hex", "Hunter's Mark", "Find Familiar", "Find Steed", "Find Greater Steed", "Eldritch Blast", "Mage Hand"]
EXTRA_SUBCLASSES = {  # subclasses the SRD file doesn't have, picked by name only (no detail in the context)
    "druid": [("Circle of the Moon", "/druid:circle-of-the-moon")], "ranger": [("Beast Master", "/ranger:beast-master")],
    "warlock": [("The Hexblade", "/warlock:hexblade")], "fighter": [("Eldritch Knight", "/fighter:eldritch-knight"),
                                                                   ("Battle Master", "/fighter:battle-master")],
    "rogue": [("Arcane Trickster", "/rogue:arcane-trickster")], "sorcerer": [("Wild Magic", "/sorcerer:wild-magic")],
}
PACT_OPTIONS = [("Pact of the Blade", ""), ("Pact of the Chain", ""), ("Improved Pact Weapon", "Pact of the Blade feature"),
                ("Thirsting Blade", "5th level, Pact of the Blade feature"), ("Eldritch Smite", "5th level, Pact of the Blade feature"),
                ("Lifedrinker", "12th level, Pact of the Blade feature"), ("Agonizing Blast", "eldritch blast cantrip"),
                ("Sign of Ill Omen", "5th level"), ("Relentless Hex", "7th level, the Hexblade patron")]


def hash_text(t):
    return "#" + hashlib.sha1((t or "").encode()).hexdigest()[:12]


def manual_char(rng, n, ABILITIES, SKILLS):
    """A hand-written sheet with random fields filled in (some badly)."""
    m = {
        "class_text": rng.choice(["Fighter 5 / Wizard 2 (Battle Master)", "Druid 8 (Moon)", "Ranger 7 (Beast Master)",
                                  "Warlock 12 (Hexblade)", "Rogue 11", "barbarian 3", "", "Paladin 4 / Sorcerer 3 (Wild Magic)",
                                  "Monk 6", "Homebrew Knight 4"]),
        "level": rng.choice([1, 5, "7", 12, 20, 25, "", None]), "race_text": rng.choice([" Hill Dwarf ", "", "Elf"]),
        "background_text": rng.choice(["Acolyte", ""]), "save_profs": rng.sample(ABILITIES, rng.randint(0, 3)),
        "jack": rng.random() < 0.3, "ac": rng.choice(["", 0, 15, "17", "x"]), "ac_note": rng.choice(["", " Plate + shield "]),
        "hp_max": rng.choice(["", 44, "30"]), "speed": rng.choice(["30", "", 40, "fast"]), "hit_dice": rng.choice(["5d10 + 2d6", ""]),
        "init_bonus": rng.choice([0, 2, "5", "-1"]), "passive_bonus": rng.choice([0, 5, "x"]),
        "prof_override": rng.choice(["", 0, 4, "3"]),
        "attacks": [{"name": rng.choice(["Longsword", " Bite ", "", "Fire Bolt"]), "ability": rng.choice(["str", "dex", "", "cha", "foo"]),
                     "prof": rng.choice([True, False, None]), "bonus": rng.choice([0, 1, "2"]),
                     "dice": rng.choice(["1d8", "", "3", " 2d6 ", "2d6+1"]), "dmg_bonus": rng.choice([0, 1, "x"]),
                     "add_mod": rng.choice([True, False]), "type": rng.choice(["slashing", "", "fire"]),
                     "versatile": rng.choice(["", "1d10", None]), "notes": rng.choice(["", "reach"]),
                     "range": rng.choice(["melee", "ranged", None]), "finesse": rng.random() < 0.3,
                     "kind": rng.choice(["weapon", "spell"])} for _ in range(rng.randint(0, 3))],
        "spell_ability": rng.choice(["", "int", "wis", "cha", "nope"]), "spell_class": rng.choice(["", " Wizard ", None]),
        "spell_dc_bonus": rng.choice([0, 1]), "spell_attack_bonus": rng.choice([0, "2"]),
        "slots": rng.choice([[], [4, 3, "2"], [4, 3, 3, 3, 2, 1, 1, 1, 1, 9, 9], [-1, "x"]]),
        "pact_count": rng.choice([0, 2, "3"]), "pact_level": rng.choice([0, 5, 9, "2"]),
        "proficiencies": rng.choice(["", "Armor: light armor, medium armor, shields\nWeapons: simple weapons, longswords\n\n  ",
                                     "All armor, shields\nMartial weapons", "Heavy armor\nhand crossbows, rapiers"]),
        "size": rng.choice(["", "Medium "]), "darkvision": rng.choice(["", 60, "120"]),
        "lucky": rng.random() < 0.3, "reliable_talent": rng.random() < 0.2, "crit_range": rng.choice([20, 19, "18", 10, ""]),
        "extra_crit_dice": rng.choice([0, 1, "2"]),
        "riders": [{"name": rng.choice(["Sneak Attack", "", "Rage"]), "dice": "3d6", "flat": rng.choice([0, "2"]),
                    "type": "", "applies": rng.choice(["", "melee"]), "once": rng.random() < 0.5,
                    **({"id": "custom"} if rng.random() < 0.3 else {})} for _ in range(rng.randint(0, 3))],
    }
    char = {
        "name": f"Manual {n}", "mode": "manual", "manual": m,
        "base_scores": {a: rng.choice([8, 10, 13, 15, 18, "12", None]) for a in ABILITIES},
        "skills": rng.sample(list(SKILLS), rng.randint(0, 5)), "expertise": rng.sample(list(SKILLS), rng.randint(0, 2)),
        "spells": [{"name": rng.choice(["Fire Bolt", "Shield", " ", "Find Familiar", "Hex"]), "level": rng.choice([0, 1, "", None, "2"]),
                    "prepared": rng.choice([True, False]), "notes": rng.choice(["", "ritual"])} for _ in range(rng.randint(0, 4))],
        "extra_features": [{"name": rng.choice(["Second Wind", "War Caster", "Lucky", "Action Surge", "Wild Shape", " "]),
                            "source": rng.choice(["Fighter 1", "Feat", "", None]),
                            "text": "You can use it once. You regain the use when you finish a short or long rest."}
                           for _ in range(rng.randint(0, 4))],
        "tools": rng.choice(["", " Thieves' tools ", "lute"]), "languages": rng.choice(["", "Common"]),
        "coins": rng.choice([None, {"gp": 12, "sp": 3}]),
        "levelup_todo": rng.choice([[], [{"step": "spells", "label": "Spells"}, {"step": "feats", "label": "Feats"},
                                         {"step": "x", "label": "Spells"}, {"label": "no step"}, "junk"]]),
    }
    return char


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.path.insert(0, sys.argv[1])
    from app import gear, library, options, rules, srd  # noqa: E402  (the PC app)
    from app.srd import ABILITIES, ARMOR, SKILLS, WEAPONS  # noqa: E402
    from gear_fixtures import random_inventory  # noqa: E402
    from magic_items import MAGIC_ITEMS  # noqa: E402

    counter = iter(range(10 ** 9))
    gear.new_id = lambda: f"i{next(counter):09d}"  # stable ids for items made while generating
    srd_entries = json.loads((ROOT / "www" / "data" / "srd-2014.json").read_text(encoding="utf-8"))["entries"]
    by_kind = {}
    for e in srd_entries:
        by_kind.setdefault(e["kind"], []).append(e)
    spell_by_name = {e["name"].lower(): e for e in by_kind["spell"]}
    magic_entries = [{**e, "id": 7000 + i} for i, e in enumerate(MAGIC_ITEMS)]
    rng = random.Random(20261014)
    cases, races = [], {}

    def run(char, ctx, stored_ctx, also_manual):
        sheet = rules.compute_any(copy.deepcopy(char), copy.deepcopy(ctx))
        case = {"char": char, "ctx": stored_ctx}
        if also_manual:
            m = rules.to_manual(copy.deepcopy(char), copy.deepcopy(sheet))
            msheet = rules.compute_any(copy.deepcopy(m), copy.deepcopy(ctx))
            case["manual"] = {k: m.get(k) for k in ("mode", "base_scores", "skills", "expertise", "extra_features",
                                                    "languages", "spells", "manual", "tools")}
            for f in case["manual"]["extra_features"]:
                f["text"] = hash_text(f["text"])
            for f in msheet["features"]:
                f["text"] = hash_text(f["text"])
            case["manual_sheet"] = msheet
        for f in sheet["features"]:  # long feature text is compared by hash
            f["text"] = hash_text(f["text"])
        if not isinstance(char.get("inventory"), list):  # an older character's items get new random ids each time
            for a in sheet["attacks"]:
                if a.get("item"):
                    a["item"] = "new"
        case["sheet"] = sheet
        cases.append(json.loads(json.dumps(case)))

    for n in range(COUNT):
        n_classes = 1 if rng.random() < 0.65 else rng.choice([2, 2, 3])
        picks = rng.sample(by_kind["class"], n_classes)
        classes, cctx = [], []
        for i, ce in enumerate(picks):
            slug = ce["data"]["slug"]
            level = rng.randint(1, 20 if n_classes == 1 else 8)
            entry = {**ce, "id": 1000 + i}
            c = {"name": ce["name"], "slug": slug, "level": level}
            sub = None
            subs = [s for s in by_kind["subclass"] if s["parent"] == slug]
            roll = rng.random()
            if subs and roll < 0.6:
                s = subs[0]
                c["subclass"] = {"name": s["name"], "path": s["path"]}
                sub = s["data"]
            elif roll < 0.85 and slug in EXTRA_SUBCLASSES:
                name, path = rng.choice(EXTRA_SUBCLASSES[slug])
                c["subclass"] = {"name": name, "path": path}
            elif roll < 0.9:
                c["subclass"] = {}
            if rng.random() < 0.05:
                c["level"] = rng.choice(["5", None, 0, 30])
            classes.append(c)
            cctx.append({"rules": library.class_rules(entry), "detail": ce["data"],
                         "subclass": sub if rng.random() < 0.9 else None})
        race_e = rng.choice(by_kind["race"])
        variant = race_e["data"]["variants"][0]
        subrace = rng.choice([None] + [s["name"] for s in variant["subraces"]])
        race = library.race_selection(race_e, variant["source"], subrace)
        bg = by_kind["background"][0]
        method = rng.choice(["point_buy", "standard", "manual"])
        if method == "point_buy":
            base = {a: rng.randint(8, 15) for a in ABILITIES}
        elif method == "standard":
            vals = [15, 14, 13, 12, 10, 8] if rng.random() < 0.9 else [15, 15, 13, 12, 10, 8]
            rng.shuffle(vals)
            base = dict(zip(ABILITIES, vals))
        else:
            base = {a: rng.randint(3, 18) for a in ABILITIES}
        race_bonus = {a: race["analysis"]["asi"].get(a, 0) for a in ABILITIES}
        if rng.random() < 0.25:  # moved, missing or made up
            vals = list(race_bonus.values())
            rng.shuffle(vals)
            race_bonus = dict(zip(ABILITIES, vals))
        if rng.random() < 0.1:
            race_bonus[rng.choice(ABILITIES)] = rng.choice([-1, 1, 2])
        skills = rng.sample(list(SKILLS), rng.randint(0, 6))
        expertise = rng.sample(skills, min(len(skills), rng.randint(0, 2)))
        if rng.random() < 0.15:
            expertise.append("Stealth")
        feats, feat_ctx = [], {}
        for name, prereq, extra in rng.sample(FEATS, rng.randint(0, 3)):
            fid = 5000 + len(feats)
            f = {"id": fid, "name": name, "from": rng.choice(["asi", "asi", "race", None])}
            if extra == "asi" or rng.random() < 0.3:
                f["asi"], f["asi_amount"] = rng.choice(ABILITIES), rng.choice([1, 1, 2, "1"])
            if extra == "weapons":
                f["weapons"] = rng.sample([w for w in WEAPONS if w != "Unarmed strike"], rng.randint(0, 4))
            if extra == "spell_class":
                f["spell_class"] = rng.choice(["wizard", "cleric", "druid", "bard", "nope"])
            if rng.random() < 0.15:
                f["prerequisite"] = "Wisdom 13 or higher"
            feats.append(f)
            if rng.random() < 0.85:
                feat_ctx[str(fid)] = {"text": FEAT_TEXT.get(name, f"{name} text"), "prerequisite": prereq}
        if rng.random() < 0.05:
            feats.append({"name": "Unnamed feat"})
        spells = []
        lists = [sl for sl in by_kind["spell-list"] if sl["parent"] in {c["slug"] for c in classes}]
        spell_ctx = {}
        def add_spell(full, row):
            sid = 9000 + len(spells)
            row["id"] = sid
            spells.append(row)
            spell_ctx[str(sid)] = full["data"]  # same object both keys, so refs resolve
            spell_ctx[full["name"].lower()] = full["data"]
        for sl in lists:
            for sp in rng.sample(sl["data"]["spells"], min(5, len(sl["data"]["spells"]))):
                full = next(e for e in by_kind["spell"] if e["path"] == sp["path"])
                row = {"name": sp["name"], "class": sl["parent"]}
                if rng.random() < 0.7:
                    row["level"] = sp["level"]
                if rng.random() < 0.2:
                    row["prepared"] = rng.choice([False, None, True])
                if rng.random() < 0.1:
                    row["always"] = True
                add_spell(full, row)
        for name in rng.sample(SPECIAL_SPELLS, rng.randint(0, 3)):
            full = spell_by_name.get(name.lower())
            row = {"name": name, "class": rng.choice([c.get("slug", "") for c in classes] + [f"feat:{f['id']}" for f in feats if "id" in f])}
            if full:
                add_spell(full, row)
            else:
                spells.append(row)
        if rng.random() < 0.1:
            spells.append({"name": "Mystery Spell", "level": 9, "class": ""})

        char = {
            "name": f"Case {n}", "classes": classes, "ability_method": method, "base_scores": base,
            "race": {"id": race_e["id"], "name": race_e["name"], "subrace": subrace},
            "race_bonus": race_bonus, "custom_origin": rng.random() < 0.2,
            "improvements": {a: rng.choice([0, 0, 0, 1, 2]) for a in ABILITIES},
            "skills": skills, "expertise": expertise, "feats": feats, "spells": spells,
            "bg_skills": rng.sample(list(SKILLS), rng.choice([0, 0, 1, 2])),
            "race_skills": rng.sample(list(SKILLS), rng.choice([0, 0, 1])),
            "hp_mode": rng.choice(["average", "rolled"]),
            "hp_rolls": [rng.choice([1, 3, 5, 8, 12, 0, None, "4"]) for _ in range(25)],
            "hp_bonus": rng.choice([0, 0, 3]), "ac_bonus": rng.choice([0, 0, 1]),
            "speed_override": rng.choice([0, 0, 0, 35]), "tools": rng.choice(["", "Lute", "none", "Thieves' tools"]),
            "languages": rng.choice(["", "Common, Elvish"]),
            "extra_features": [{"name": "Boon", "text": "A gift."}] if rng.random() < 0.2 else [],
            "coins": rng.choice([None, {}, {"gp": rng.randint(0, 3000), "sp": rng.randint(0, 50), "cp": "12", "pp": 0}]),
        }
        if rng.random() < 0.2:  # an older character: armor, shield and weapons fields instead of an inventory
            char.update({"armor": rng.choice([""] * 4 + list(ARMOR)), "shield": rng.random() < 0.3,
                         "weapons": rng.sample(list(WEAPONS), rng.randint(0, 4))
                         + ([{"name": "Longsword", "bonus": 1}] if rng.random() < 0.2 else [])})
        else:
            char["inventory"] = random_inventory(rng, gear, srd, magic_entries, rng.randint(0, 14))
        if rng.random() < 0.15:
            char["unarmed"] = True
        if rng.random() < 0.1:
            char["extra_save_profs"] = rng.sample(ABILITIES, 2)
        if rng.random() < 0.1:
            char["pact_blade"] = {"has": True, "improved": rng.random() < 0.5, "lifedrinker": True, "smite": True}
        if rng.random() < 0.1:
            char["levelup_todo"] = [{"step": "options", "label": "Class options"}, {"step": "hp", "label": "Hit points"}]
        if rng.random() < 0.05:
            char["classes"].append({"name": "", "level": 3})

        ctx = {"classes": cctx, "race": race, "background": {"name": bg["name"], **bg["data"]},
               "spells": spell_ctx, "feats": feat_ctx,
               "warnings": ["Couldn't load something: test"] if rng.random() < 0.05 else []}
        # class options: picks from the groups the class features offer, plus pact boons and invocations
        opts = []
        try:
            groups = options.feature_groups(char, copy.deepcopy(ctx))
        except Exception:  # noqa: BLE001
            groups = []
        for g in groups:
            if g.get("options") and rng.random() < 0.7:
                for o in rng.sample(g["options"], min(len(g["options"]), rng.randint(1, (g.get("count") or 1) + 1))):
                    opts.append({"key": g["key"], "label": g["label"], "class": g["class"], "name": o["name"],
                                 "text": (o.get("text") or "")[:40]})
        if any(c.get("slug") == "warlock" for c in classes) or rng.random() < 0.1:
            for name, prereq in rng.sample(PACT_OPTIONS, rng.randint(0, 5)):
                opts.append({"key": rng.choice(["warlock|Eldritch Invocations", "warlock|Pact Boon",
                                                "feat:5000|invocations"]), "label": "Eldritch Invocations",
                             "class": "warlock", "name": name, "prerequisite": prereq, "text": ""})
        if rng.random() < 0.05:
            opts.append({"name": "", "key": ""})
        if opts:
            char["class_options"] = opts

        stored = copy.deepcopy(ctx)
        for cc, c in zip(stored["classes"], classes):
            cc["detail"] = f"@class:/{c['slug']}"
            if cc["subclass"] is not None:
                cc["subclass"] = f"@subclass:{c['subclass']['path']}"
        stored["background"] = f"@background:{bg['path']}"
        race_key = f"{race_e['path']}|{subrace or ''}"  # each species selection is stored once, under "races"
        races[race_key] = race
        stored["race"] = f"@race:{race_key}"
        stored["spells"] = {k: f"@spell:{next(e['path'] for e in by_kind['spell'] if e['data'] is v)}"
                            for k, v in ctx["spells"].items()}
        if rng.random() < 0.15:
            char["mode"] = "builder"
        run(char, ctx, stored, rng.random() < 0.25)

    for n in range(MANUAL_COUNT):
        char = manual_char(rng, n, ABILITIES, SKILLS)
        if rng.random() < 0.5:
            char["inventory"] = random_inventory(rng, gear, srd, magic_entries, rng.randint(0, 8))
        spell_ctx = {}
        for s in char["spells"]:
            full = spell_by_name.get(s["name"].strip().lower())
            if full and rng.random() < 0.7:
                spell_ctx[s["name"].lower()] = full["data"]
        ctx = {"spells": spell_ctx}
        stored = {"spells": {k: f"@spell:{next(e['path'] for e in by_kind['spell'] if e['data'] is v)}"
                             for k, v in spell_ctx.items()}}
        run(char, ctx, stored, rng.random() < 0.3)

    out = ROOT / "tests" / "fixtures" / "parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"races": races, "cases": cases}, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(cases)} cases to {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
