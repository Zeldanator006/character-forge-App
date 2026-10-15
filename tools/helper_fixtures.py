"""Make tests/fixtures/helpers.json: inputs run through the PC app's dice, creatures, resources, feats and options modules.

tests/helpers.test.mjs runs the same inputs through www/js/dice.js, creatures.js, resources.js, feats.js and
options.js and expects the same answers, so the JavaScript ports can't drift from the Python they came from.
Usage:

    python3 tools/helper_fixtures.py /path/to/character-forge   # the PC app's repository

Arguments written "@spell:<path>", "@class:<slug>", "@table:<slug>" or "@creature:<name>" stand for an SRD spell's
or class's data (www/data/srd-2014.json) or a stat block (www/data/creatures.json), and "@pool:<key>" for a value
stored once under "pools"; the test resolves them anywhere in the arguments (and in by_name's answers), which keeps this file small.
"""
import copy
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEVELS = [1, 2, 4, 5, 10, 11, 16, 17, 20]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.path.insert(0, sys.argv[1])
    from app import creatures, dice, feats, options, resources  # noqa: E402  (the PC app)
    from app.srd import ABILITIES  # noqa: E402

    srd = json.loads((ROOT / "www" / "data" / "srd-2014.json").read_text(encoding="utf-8"))["entries"]
    by_kind = {}
    for e in srd:
        by_kind.setdefault(e["kind"], []).append(e)
    spells = {e["path"]: e["data"] for e in by_kind["spell"]}
    beasts = {c["name"]: c for c in creatures.all_creatures()}
    modules = {"dice": dice, "creatures": creatures, "resources": resources, "feats": feats, "options": options}
    class_data = {e["data"]["slug"]: e["data"] for e in by_kind["class"]}
    rng = random.Random(20261015)
    cases, skipped, pools = [], {}, {}
    refs = {"spell": spells, "creature": beasts, "class": class_data, "pool": pools,
            "table": {k: v.get("table") for k, v in class_data.items()}}

    def resolve(a):
        if isinstance(a, str) and a.startswith("@") and a[1:].split(":", 1)[0] in refs:
            kind, key = a[1:].split(":", 1)
            return resolve(refs[kind][key])
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
            out = getattr(modules[mod], name)(*[copy.deepcopy(resolve(a)) for a in args])
        except Exception:  # noqa: BLE001  (inputs Python itself rejects aren't parity cases)
            skipped[fn] = skipped.get(fn, 0) + 1
            return None
        stored_out = json.loads(json.dumps(out))
        if fn == "creatures.by_name" and out is not None:
            stored_out = f"@creature:{out['name']}"  # the whole stat block, unchanged
        cases.append({"fn": fn, "args": stored, "out": stored_out})
        return out

    mods_pool = [{a: rng.randint(-1, 5) for a in ABILITIES} for _ in range(30)] + [{a: 0 for a in ABILITIES}]

    # ---------------------------------------------------------- dice
    for lv in range(0, 22):
        case("dice.cantrip_tier", lv)
    for path in spells:
        for lv in LEVELS:
            case("dice.spell_effect", f"@spell:{path}", lv)
        case("dice.spell_effect", f"@spell:{path}")
    snippets = ["Make a ranged spell attack against the target.", "make a MELEE spell attack", "Each creature must make a Dexterity saving throw.",
                "a wisdom saving throw", "takes 3d6 fire damage", "takes 1d10 + your spellcasting ability modifier necrotic damage",
                "takes 2d8 + 4 Radiant damage", "takes 1d4 damage", "takes 2d6 + 3 damage", "half as much damage on a successful one",
                "regains hit points equal to 1d8 + your spellcasting ability modifier", "regain a number of hit points equal to 4d8",
                "This spell's damage increases by 1d10 when you reach 5th level (2d10), 11th level (3d10), and 17th level (4d10).",
                "The spell creates more than one beam when you reach higher levels: two beams at 5th level.",
                "increases by 1d6 for each slot level above 3rd", "increases by 2d8 for each spell slot level above 1st",
                "Hit points: 12d6", "deals 10d10 thunder damage", "You conjure beams of light.", ""]
    for _ in range(400):
        data = {"description": " ".join(rng.sample(snippets, rng.randint(0, 5))),
                "level": rng.choice([0, 0, 1, 2, 3, 5, 9, None])}
        if rng.random() < 0.4:
            data["higher_levels"] = rng.choice(snippets[12:16] + ["", None])
        if rng.random() < 0.1:
            data["text"] = data.pop("description")
        case("dice.spell_effect", data, rng.choice(LEVELS + [0, 3]))
    case("dice.spell_effect", {})
    case("dice.spell_effect", {"description": None, "text": "takes 1d6 cold damage", "level": 0}, 11)

    # ---------------------------------------------------------- creatures
    names = list(beasts)
    for n in names + ["  aboleth ", "WOLF", "Nobody", "", None]:
        case("creatures.by_name", n)
    for cr in [None, 0, 0.0, 0.125, 0.25, 0.5, 1, 2, 3, 10, 30, 1 / 3, 2 / 3, 0.1, 0.2, 0.3333, 0.7, 2.5, 0.0625, 0.07, 0.06,
               0.94, 0.9375, 7.99, 100.75, 1e-9, -0.25, -1.5, -0.0625, True, False, "1/4", " 2/8 ", "0.5", "3", "1_0", "-0.25",
               "1/3", "5/16", "1 / 8", ".5", "5.", "1e-1", "2E1", "+3/4", 1e15 + 0.5]:
        case("creatures.cr_text", cr)
    for t in ["1/4", "1/0", "abc", None, "", " 3 ", "0.5", "1e2", ".5", "5.", "-1/2", True, False, 0.25, 7, 0, -0.0, "1 / 8",
              "1_000", "inf", "nan", "-0", "1/3", "2/3", "0.1", "1e-7", "12345678901/3", [1], {}, "1.5/2", "1/2/3", "--1", "0x10",
              1e-7, 1e21, 0.1, "٣"]:
        case("creatures.cr_value", t)
    speeds = [c["speed"] for c in beasts.values()] + [{}, None, {"walk": 0}, {"fly": 30, "hover": True}, {"swim": 40},
              {"walk": "30", "climb": 0}, {"burrow": 10, "walk": 20, "fly": 60, "hover": False}, {"fly": 0, "hover": True},
              {"walk": None, "swim": 30}, {"hover": True}]
    for s in speeds:
        case("creatures.speed_text", s)
    for n in names:
        case("creatures.summary", f"@creature:{n}")
    for n in rng.sample(names, 40):
        case("creatures.full", f"@creature:{n}")
    for lv in range(0, 21):
        for moon in (False, True):
            case("creatures.wild_shape_rules", lv, moon)
        case("creatures.wild_shape_rules", lv)
    spell_pool = ["Find Familiar", "find steed", "FIND GREATER STEED", "Fireball", "Cure Wounds"]
    opt_pool = ["Pact of the Chain", "pact of the blade", "Agonizing Blast"]
    infos = [None, {}, {"chain": False}, {"greater_steed": False}, {"chain": 0, "greater_steed": None}, {"wild_shape": {}},
             {"wild_shape": None}]
    for _ in range(120):
        level_of = {c: rng.randint(1, 20) for c in rng.sample(["ranger", "druid", "wizard", "fighter"], rng.randint(0, 3))}
        subs = {}
        if rng.random() < 0.6:
            subs["ranger"] = rng.choice(["beast-master", "hunter", "", None])
        if rng.random() < 0.6:
            subs["druid"] = rng.choice(["moon", "circle-of-the-moon", "land", None])
        if subs.get("ranger") is None:
            subs.pop("ranger", None)
        if subs.get("druid") is None:
            subs.pop("druid", None)
        info = case("creatures.companion_info", level_of, subs, rng.sample(spell_pool, rng.randint(0, 3)),
                    rng.sample(opt_pool, rng.randint(0, 2)), rng.choice([2, 3, 4, 5, 6]))
        if info:
            infos.append(info)
    for _ in range(1500):
        case("creatures.allowed", f"@creature:{rng.choice(names)}", rng.choice(list(creatures.MODES) + ["other"]), rng.choice(infos))
    for n in creatures.FAMILIARS + creatures.CHAIN_FAMILIARS + creatures.STEEDS + creatures.GREATER_STEEDS + creatures.ELEMENTALS:
        for mode in creatures.MODES:
            case("creatures.allowed", f"@creature:{n}", mode, rng.choice(infos))
    queries = ["", "wolf", "  giant   spider ", "BEAST tiny", "dragon", "elemental", "zzz", None, "a", "medium beast", "swarm"]
    for q in queries:
        for mode in creatures.MODES:
            case("creatures.search", q, mode, rng.choice(infos), rng.choice([None, None, 0, 0.25, 1, 2, 5]), rng.choice([400, 10, 0, 3, -2, None]))
    case("creatures.search")
    case("creatures.search", "wolf")
    blocks = [f"@creature:{n}" for n in rng.sample(names, 60)] + [f"@creature:{n}" for n in ["Wolf", "Mastiff", "Panther", "Giant Badger"]]
    dice_strings = ["1d6+2", "2d8 - 1", "d4", "5", "", None, "1d6+-2", "1d6 + 2 fire", "+3", "-1", "1d6-2", " 3d4 + 10 ", "1d6 -  4",
                    "2d6+1d4", "xyz", "0", "10d10-0"]
    for i in range(60):
        acts = []
        for _ in range(rng.randint(0, 4)):
            a = {"name": f"Bite {i}", "text": "Melee Weapon Attack"}
            r = rng.random()
            if r < 0.7:
                a["attack"] = rng.randint(-1, 8)
                if rng.random() < 0.8:
                    a["damage"] = [{"dice": rng.choice(dice_strings), "type": "piercing"}] + ([{"dice": "1d6", "type": "fire"}] if rng.random() < 0.2 else [])
                elif rng.random() < 0.5:
                    a["damage"] = []
            elif r < 0.85:
                a["attack"] = None
            acts.append(a)
        b = {"name": f"Test {i}", "ac": rng.choice([None, 0, 12, 15]), "hp": rng.choice([None, 0, 5, 40]), "actions": acts}
        if rng.random() < 0.7:
            b["skills"] = {"Perception": rng.randint(0, 5), "Stealth": rng.randint(0, 5)} if rng.random() < 0.8 else {}
        if rng.random() < 0.5:
            b["saves"] = {"dex": 3}
        blocks.append(b)
    blocks += [None, {}]
    kinds = ["companion", "companion", "familiar", "steed", ""]
    eff_infos = [None, {}, {"beast_master": True, "prof": 3, "ranger_level": 7}, {"beast_master": True},
                 {"beast_master": False, "prof": 4}, {"beast_master": 1, "prof": 0, "ranger_level": None}]
    for b in blocks:
        for _ in range(3):
            case("creatures.effective", b, rng.choice(kinds), rng.choice(eff_infos + infos[-20:]))

    # ---------------------------------------------------------- resources
    classes = ["artificer", "barbarian", "bard", "cleric", "druid", "fighter", "monk", "paladin", "ranger", "rogue",
               "sorcerer", "warlock", "wizard"]
    sub_pool = {"druid": ["circle-of-the-moon", "moon", "land"], "fighter": ["battle-master", "champion", "battle-master-ua"],
                "sorcerer": ["wild-magic", "draconic"], "warlock": ["hexblade", "fiend"], "wizard": ["divination", "evocation"]}
    for cls in classes:
        for lv in range(1, 21):
            sub = {k: rng.choice(v) for k, v in sub_pool.items()}
            case("resources.class_table", {cls: lv}, sub if rng.random() < 0.7 else {}, rng.choice(mods_pool), 2 + (lv - 1) // 4)
    for _ in range(150):
        level_of = {c: rng.randint(1, 20) for c in rng.sample(classes, rng.randint(1, 3))}
        sub = {k: rng.choice(v) for k, v in sub_pool.items() if rng.random() < 0.5}
        case("resources.class_table", level_of, sub, rng.choice(mods_pool), rng.randint(2, 6))
    case("resources.class_table", {}, {}, mods_pool[0], 2)

    feature_texts = []
    for e in by_kind["class"] + by_kind["subclass"]:
        for f in e["data"].get("features") or []:
            feature_texts.append({"name": f["name"], "text": f.get("text") or "", "source": e["name"], "kind": "class"})
    for e in by_kind["race"]:
        for v in e["data"]["variants"]:
            for t in v["traits"]:
                feature_texts.append({"name": t["name"], "text": t.get("text") or "", "source": e["name"], "kind": "race"})
            for s in v.get("subraces") or []:
                for t in s.get("traits") or []:
                    feature_texts.append({"name": t["name"], "text": t.get("text") or "", "source": s["name"], "kind": "race"})
    for e in by_kind["feat"]:
        feature_texts.append({"name": e["name"], "text": e["data"].get("text") or "", "source": "Feat", "kind": "feat"})
    synthetic = [
        "You can use this feature a number of times equal to your Wisdom modifier (a minimum of once). You regain all expended uses when you finish a long rest.",
        "You can use this a number of times equal to 1 + your Charisma modifier. You regain expended uses when you finish a short or long rest.",
        "You can do this a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest.",
        "a number of times equal to twice your proficiency bonus, regaining them at dawn.",
        "You can use it twice, and you regain all uses when you finish a short rest.",
        "You can use this feature three times. You regain all expended uses at each dawn.",
        "Once you use this trait, you can't use it again until you finish a short or long rest.",
        "you can't do so again until you finish a long rest.",
        "You can cast it once with this trait and regain the ability to do so when you finish a long rest.",
        "When you reach 3rd level, you can cast the darkness spell once with this trait, and you regain the ability when you finish a long rest.",
        "Once you reach 5th level, you can cast misty step once without expending a spell slot. You regain it at the next dawn.",
        "You can use this ability once per long rest.",
        "Once you use this feature, you can't use it again.",
        "You can use it once.",
        "  YOU   CAN   USE   IT   FOUR TIMES  before a  Short Rest  ",
        "",
        None,
        "Your attacks deal extra damage.",
        "can use it once per short rest",
        "can do so twice between rests and regain them on a short rest or a long rest",
    ]
    for i, t in enumerate(synthetic):
        for _ in range(2):
            feature_texts.append({"name": rng.choice([f"Gift {i}", "Breath Weapon", "Lucky", "Healing Hands", "Rage", "Channel Divinity: Turn",
                                                      "Fey Step", "  ", "Savage Attacks", "Hidden Step"]),
                                  "text": t, "source": rng.choice(["Race", "Feat", "Magic item", "", None, "Elf"]),
                                  "kind": rng.choice(["race", "class", None])})
    feature_refs = []
    for i, f in enumerate(feature_texts):
        case("resources.read_text", f["name"], f["text"], rng.choice(mods_pool), rng.randint(2, 6))
        feature_refs.append(pool(f"feature:{i}", f))
    feature_texts = feature_refs  # the cases below refer to these by key
    for _ in range(150):
        feats_in = rng.sample(feature_texts, rng.randint(0, 12))
        case("resources.from_features", feats_in, rng.choice(mods_pool), rng.randint(2, 6),
             rng.sample(["rage", "fey-step", "breath-weapon", "gift-3"], rng.randint(0, 2)), rng.choice([1, 3, 5, 20]))
    case("resources.from_features", feature_texts[:40], mods_pool[1], 3)
    for _ in range(150):
        level_of = {c: rng.randint(1, 12) for c in rng.sample(classes, rng.randint(0, 2))}
        sub = {k: rng.choice(v) for k, v in sub_pool.items() if rng.random() < 0.4}
        feats_in = rng.choice([None, [], [{"name": "Lucky"}], [{"name": " lucky "}, {"name": "Alert"}], [{"name": None}]])
        features = rng.sample(feature_texts, rng.randint(0, 10))
        if rng.random() < 0.3:
            features.append({"name": "Lucky", "text": "You have 3 luck points. You regain them when you finish a long rest. You can use it once.", "source": "Feat"})
        case("resources.compute", level_of, sub, rng.choice(mods_pool), rng.randint(2, 6), feats_in, features,
             rng.choice([None, None, 0, 3, 17]))
    for t in ["Fighter 5 / Wizard 2 (Battle Master)", "fighter 5 (battle master) / wizard 3 (School of Divination)", "Rogue",
              "Bard 3 / bard 2", "Druid 6 (Circle of the Moon)", "Warlock 11 (Hexblade)", "Sorcerer 4 wild magic", "Paladin 123",
              "Barbarian 0", "Cleric (Life) 5", "monkey 3", "Ranger10 (Beast Master)", "", None, "Moon druid 2", "Wizardry 4",
              "Artificer 7 (Artillerist) / Fighter 1 (Battle Master)", "fighter (champion) battle master", "bard\t4(lore)"]:
        case("resources.levels_from_text", t)

    # ---------------------------------------------------------- feats
    for f in [{"id": 5}, {"id": "abc"}, {"id": 0, "name": "Magic Initiate"}, {"name": "Fey Touched (UA)"}, {}, {"name": None},
              {"id": None, "name": "  War  Caster! "}, {"id": 12, "name": "x"}]:
        case("feats.feat_key", f)
    grant_names = list(feats.KNOWN) + ["Eldritch Adept (UA)", "Skilled (HB)", "magic initiate (homebrew)", "  LINGUIST  ",
                                       "Telekinetic(ua)", "Grappler", "Mystery", None, ""]
    grant_texts = [
        "You learn one Eldritch Invocation of your choice from the warlock class.",
        "You learn two Metamagic options of your choice from the sorcerer class.",
        "You learn two maneuvers of your choice from among those available to the Battle Master archetype.",
        "You adopt one fighting style option of your choice.",
        "You learn the misty step spell and one 1st-level spell of your choice. The 1st-level spell must be from the divination or enchantment school of magic.",
        "Choose a class: bard, cleric, druid, sorcerer, warlock, or wizard. You learn two cantrips of your choice from that class's spell list. In addition, choose one 1st-level spell to learn from that same list.",
        "Choose one of the following classes: cleric, wizard. You learn two 1st-level spells that have the ritual tag.",
        "You learn one cantrip from the druid spell list. You also learn the longstrider spell.",
        "You learn one cantrip of your choice from the wizard's spell list.",
        "You gain proficiency in one skill of your choice. You gain proficiency in any combination of three skills or tools of your choice.",
        "Choose one skill in which you have proficiency. Your proficiency bonus is doubled for any ability check you make that uses it.",
        "You gain proficiency with four weapons of your choice.",
        "You learn three languages of your choice.",
        "You learn the same spell again. You learn the Detect Thoughts spell. You learn the Pass without Trace spell.",
        "You learn the toll the dead cantrip.  You also learn the  Blindness/Deafness spell.",
        "You learn one cantrip and one 1st-level spell. The spells must be from the necromancy, illusion schools.",
        "",
        None,
        "Choose a class: artificer, paladin or ranger\nYou learn one cantrip.",
        "You learn THREE eldritch invocations and two Fighting Style options.",
        "You gain proficiency in two skills of your choice that you are proficient in? proficiency bonus is doubled.",
        "You learn three maneuvers. Then, much later, a Battle Master trains you.",
    ]
    for name in grant_names:
        g = case("feats.grants", name, rng.choice(grant_texts))
        if g:
            case("feats.summary", g)
    for _ in range(250):
        text = " ".join(rng.sample([t for t in grant_texts if t], rng.randint(1, 4)))
        g = case("feats.grants", rng.choice(["Homebrew Feat", "Custom (UA)", None]), text)
        if g:
            case("feats.summary", g)
    for e in by_kind["feat"]:
        g = case("feats.grants", e["name"], e["data"].get("text"))
        case("feats.summary", g)
    for g in [{**feats.EMPTY, "lists": [["metamagic", 1], ["maneuvers", 3]], "skills": 2, "expertise": 1, "tools": 1, "weapons": 1},
              {**feats.EMPTY, "spells": ["Mage Hand"], "spell_picks": {"classes": ["wizard", "bard"], "picks": [{"count": 1, "level": 3}]}},
              {**feats.EMPTY, "spell_picks": {}, "inline": {}}, {**feats.EMPTY, "spell_picks": {"classes": None, "picks": []}}]:
        case("feats.summary", g)
    prereqs = ["Strength 13 or higher", "Dexterity or Wisdom 13 or higher", "Intelligence, Wisdom or Charisma score of 13 or higher",
               "Strength and Constitution 15 or higher", "Proficiency with medium armor", "proficiency with heavy armor, Strength 13 or higher",
               "Proficiency with a shield", "Proficiency with a martial weapon", "The ability to cast at least one spell",
               "Spellcasting or Pact Magic feature", "Elf (drow)", "Half-elf, half-orc, or human", "Dwarf", "Yuan-ti", "Elf or Half-Elf",
               "4th level", "8th level, Dragonborn", "Gnome (deep gnome)", "Halfling", "", None, "Kobold or goblin, 12th level",
               "Strength 13", "elfish heritage", "half-elfish", "Lizardfolk", "Wisdom 13 or higher and the Spellcasting feature"]
    race_pool = ["elf (drow)", "half-elf", "human", "dwarf (hill)", "hill dwarf", "gnome", "yuan-ti pureblood", "dragonborn",
                 "high-elf", "", "half-orc", "elves", "drow elf", "kobold"]
    for p in prereqs:
        for _ in range(6):
            info = {"scores": {a: rng.randint(8, 18) for a in rng.sample(ABILITIES, rng.randint(3, 6))},
                    "armor": rng.choice([[], ["light"], ["light", "medium", "shield"], ["light", "medium", "heavy", "shield"], "light medium"]),
                    "martial": rng.choice([True, False, [], ["longsword"], 0]), "caster": rng.choice([True, False, [], ["wizard"]]),
                    "race": rng.choice(race_pool), "level": rng.randint(1, 20)}
            case("feats.prerequisite_problems", p, info)

    # ---------------------------------------------------------- options
    for steps, lv in [({1: 1, 10: 2}, 5), ({"1": 1, "10": 2}, 10), ({}, 3), (None, 3), ({"3": 3, "7": 5}, 2), ({"x": 4, "2": 1}, 1),
                      ({" 3 ": 2, "4": 9}, 4), ({"٣": 6}, 3), ({"3.0": 7, "1": 1}, 5), ({"1_0": 5}, 12), ({"-1": 2}, 0), ({"0": 0}, 0),
                      (options.KNOWN_COUNTS["/fighter:battle-master:maneuvers"], 12), ({"+2": 3}, 2)]:
        case("options.at_level", steps, lv)
    for e in by_kind["class"]:
        for lv in [1, 2, 3, 5, 10, 20, 21]:
            for label in ["Cantrips", "Spells Known", "Eldritch Invocations", "Infusions", "Ki", "Sorcery Points", None, "Martial Arts",
                          "maneuvers"]:
                case("options.table_known", f"@table:{e['data']['slug']}", lv, label)
    tbl = [{"_level": 2, "Invocations Known": "2"}, {"_level": 3, "Invocations Known": "—", "Maneuvers Known": None},
           {"_level": 4, "Maneuvers Known": 7.0, "Invocations Known": True}]
    for lv in [1, 2, 3, 4]:
        for label in ["Eldritch Invocations", "Maneuvers", "Battle Master maneuvers", "sssss"]:
            case("options.table_known", tbl, lv, label)
    case("options.table_known", None, 1, "Eldritch Invocations")
    for c in [{"slug": "fighter"}, {"name": "Blood Hunter"}, {"name": None}, {}, {"slug": "", "name": "Wizard"}]:
        case("options.class_slug", c)
    page_paths = ["/fighter:battle-master:maneuvers", "/monk:four-elements:disciplines", "/warlock:eldritch-invocations",
                  "/artificer:infusions", "//fighter:battle-master:maneuvers//", "fighter"]
    char_classes = [{"name": "Fighter", "subclass": {"path": "/fighter:battle-master"}}, {"name": "Fighter", "subclass": {"name": "Battle Master!"}},
                    {"name": "Monk", "subclass": {"name": "Way of the Four Elements"}}, {"name": "Monk", "subclass": {"name": "four elements"}},
                    {"name": "Monk"}, {"name": "Fighter", "subclass": {}}, {"name": "Fighter", "subclass": None},
                    {"name": "Fighter", "subclass": {"path": "", "name": "Champion"}}]
    for p in page_paths:
        for c in char_classes:
            case("options.page_applies", p, c)
    for p in page_paths:
        for slug in ["fighter", "warlock", "monk"]:
            for lv in [1, 3, 7, 11, 20]:
                for label in ["Eldritch Invocations", "Maneuvers", None]:
                    case("options.page_count", p, slug, lv, rng.choice([f"@class:{slug}", None, {}, {"table": tbl}]), label)
    unmet_prereqs = ["5th level", "12th-level warlock", "Pact of the Blade feature", "Eldritch Blast cantrip", "the Fiend patron",
                     "The Great Old One patron", "Pact of the Tome, 7th level", "eldritch blast or toll the dead cantrip", "Hexblade patron",
                     "", None, "15th level, Pact of the Chain", "a firebolt cantrip", "the the archfey patron", "Pact of the Talisman",
                     "9th-level", "o'brien patron", "the cantrip"]
    for p in unmet_prereqs:
        for _ in range(5):
            info = {"level": rng.randint(1, 20), "picked": rng.sample(["pact of the blade", "pact of the chain", "pact of the tome", "agonizing blast"], rng.randint(0, 2)),
                    "spells": rng.sample(["eldritch blast", "toll the dead", "firebolt", "mage hand"], rng.randint(0, 2)),
                    "subclass": rng.choice(["the fiend", "fiend", "the great old one", "great old one", "hexblade", "", "archfey"])}
            case("options.unmet", p, info)

    opt_lists = [[{"name": f"Option {k}", "text": "...", **({"prerequisite": rng.choice(unmet_prereqs)} if rng.random() < 0.6 else {})}
                  for k in range(rng.randint(1, 4))] for _ in range(12)] + [[]]
    choose_pool = [None, {}, {"1": 2, "10": 3}, {3: 1, 7: 2, 15: 3}, {"x": 5}, {"1": 0}]
    texts = ["", "Choose one of the following options.", "At 10th level, you can choose a second option from the Fighting Style class feature.",
             "you gain another option from the Hunter's Prey feature", "Pick an additional option from the totem spirit feature.",
             "another option from the Pact Boon feature, and another option from the Fighting Style feature"]

    def feature(name):
        f = {"name": name, "text": rng.choice(texts)}
        if rng.random() < 0.8:
            f["level"] = rng.choice([1, 1, 2, 3, 6, 10, 14, None, 0])
        if rng.random() < 0.6:
            f["options"] = copy.deepcopy(rng.choice(opt_lists))
        if rng.random() < 0.5:
            f["choose"] = rng.choice(choose_pool)
        return f

    def random_char():
        n = rng.randint(0, 3)
        chars, cctx = [], []
        for i in range(n):
            slug = rng.choice(["fighter", "warlock", "ranger", "barbarian", "monk"])
            c = {"name": rng.choice([slug.title(), "", slug.title()]), "level": rng.choice([1, 3, 6, 10, 20, "4", None, 25, "x", 0, 2.5])}
            if rng.random() < 0.7:
                c["slug"] = slug
            if rng.random() < 0.6:
                c["subclass"] = rng.choice([{"name": "Hunter", "path": f"/{slug}:hunter"}, {"name": "Battle Master"}, {}, None,
                                            {"name": "The Fiend", "path": "/warlock:fiend"}])
            chars.append(c)
            names_ = rng.sample(["Fighting Style", "Hunter's Prey", "Totem Spirit", "Pact Boon", "Metamagic", "Extra Attack"], rng.randint(1, 4))
            detail = {"features": [feature(nm) for nm in names_] + ([feature(names_[0])] if rng.random() < 0.3 else [])}
            if rng.random() < 0.3:
                detail["table"] = tbl
            sub = {"features": [feature(nm) for nm in rng.sample(["Hunter's Prey", "Defensive Tactics", "Fighting Style"], 2)]}
            cctx.append({"rules": rng.choice([{"subclass_level": 3}, {"subclass_level": "1"}, {}, None, {"subclass_level": 0}]),
                         "detail": rng.choice([detail, detail, None]), "subclass": rng.choice([sub, sub, None, {}])})
        if rng.random() < 0.15:
            cctx = cctx[:-1]
        feats_ = []
        for k in range(rng.randint(0, 3)):
            name = rng.choice(["Eldritch Adept", "Fighting Initiate", "Martial Adept", "Metamagic Adept", "Elemental Adept", "Alert",
                               "Custom Feat", None])
            f = {"name": name}
            if rng.random() < 0.7:
                f["id"] = rng.choice([700 + k, "abc", 0])
            if rng.random() < 0.3:
                f["text"] = rng.choice(grant_texts[:4])
            feats_.append(f)
        char = {"classes": chars, "feats": feats_,
                "class_options": [{"name": rng.choice(["Pact of the Blade", "Thirsting Blade ", "agonizing blast", "Pact of the Tome", "Lifedrinker",
                                                       "IMPROVED PACT WEAPON", "Eldritch Smite", None]),
                                   "key": rng.choice(["warlock|/warlock:eldritch-invocations", "fighter|/fighter:battle-master:maneuvers",
                                                      "monk|/monk:four-elements:disciplines", "fighter|Fighting Style", "", None, "ranger|/x|y"]),
                                   "label": rng.choice(["Eldritch Invocations", "Maneuvers", None])}
                                  for _ in range(rng.randint(0, 4))],
                "spells": [{"name": rng.choice(["Eldritch Blast", "Toll the Dead", None])} for _ in range(rng.randint(0, 2))]}
        ctx = {"classes": cctx,
               "feats": rng.choice([None, {}, {"700": {"text": grant_texts[0]}, "None": {"text": grant_texts[2]}, "abc": {"text": ""}}])}
        return char, ctx

    for i in range(300):
        char, ctx = random_char()
        char_ref, ctx_ref = pool(f"char:{i}", char), pool(f"ctx:{i}", ctx)
        groups = case("options.feature_groups", char_ref, ctx_ref)
        case("options.allowed_counts", char_ref, ctx_ref)
        lists = case("options.feat_lists", char_ref, ctx_ref)
        case("options.pact_flags", char_ref)
        all_groups = (groups or []) + [g for g, _ in lists or []]
        for g in all_groups:
            if rng.random() < 0.3:
                g["needs_class"] = rng.choice([True, False])
        case("options.mark_unmet", all_groups, char_ref)
    case("options.pact_flags", {})

    constants = {
        "dice.DAMAGE_TYPES": dice.DAMAGE_TYPES,
        **{f"creatures.{k}": list(getattr(creatures, k)) for k in ("FAMILIARS", "CHAIN_FAMILIARS", "STEEDS", "GREATER_STEEDS", "ELEMENTALS", "SMALL_SIZES")},
        "creatures.MODES": creatures.MODES,
        "resources.ABILITY_WORDS": resources.ABILITY_WORDS, "resources.COUNT_WORDS": resources.COUNT_WORDS,
        "resources.TABLE_NAMES": sorted(resources.TABLE_NAMES), "resources.RACE_TABLE": resources.RACE_TABLE,
        "resources.CLASS_WORDS": list(resources.CLASS_WORDS),
        **{f"feats.{k}": getattr(feats, k) for k in ("NUM", "CASTER_LISTS", "CLASS_ABILITY", "LISTS", "ELEMENTS", "KNOWN", "EMPTY", "RACES")},
        "feats.NOT_SPELLS": sorted(feats.NOT_SPELLS),
        "options.KNOWN_COUNTS": options.KNOWN_COUNTS, "options.PACT_KEYS": options.PACT_KEYS,
    }
    out = ROOT / "tests" / "fixtures" / "helpers.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"constants": constants, "pools": pools, "cases": cases}, ensure_ascii=False), encoding="utf-8")
    counts = {}
    for c in cases:
        counts[c["fn"]] = counts.get(c["fn"], 0) + 1
    print(f"Wrote {len(cases)} cases to {out} ({out.stat().st_size // 1024} KB)")
    for fn, n in sorted(counts.items()):
        print(f"  {fn}: {n}" + (f" ({skipped[fn]} inputs Python rejects, skipped)" if fn in skipped else ""))
    for fn in sorted(set(skipped) - set(counts)):
        print(f"  {fn}: 0 ({skipped[fn]} skipped)")


if __name__ == "__main__":
    main()
