"""Make tests/fixtures/parity.json: random characters run through the PC app's Python rules engine.

tests/parity.test.mjs runs the same characters through www/js/rules.js and expects the same sheets,
so the JavaScript port can't drift from the engine it came from. Usage:

    python3 tools/parity_fixtures.py /path/to/character-forge   # the PC app's repository
"""
import copy
import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COUNT = 200


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.path.insert(0, sys.argv[1])
    from app import library, rules  # noqa: E402  (the PC app)
    from app.srd import ABILITIES, ARMOR, CLASS_RULES, SKILLS, WEAPONS  # noqa: E402

    srd = json.loads((ROOT / "www" / "data" / "srd-2014.json").read_text(encoding="utf-8"))["entries"]
    by_kind = {}
    for e in srd:
        by_kind.setdefault(e["kind"], []).append(e)
    rng = random.Random(20261014)
    feats_pool = ["Tough", "Alert", "Mobile", "Observant", "Skilled", "Resilient", "Lightly Armored",
                  "Moderately Armored", "Heavily Armored", "Medium Armor Master", "Grappler"]
    cases = []
    for n in range(COUNT):
        n_classes = 1 if rng.random() < 0.7 else rng.choice([2, 3])
        picks = rng.sample(by_kind["class"], n_classes)
        classes, cctx = [], []
        for i, ce in enumerate(picks):
            slug = ce["data"]["slug"]
            level = rng.randint(1, 20 if n_classes == 1 else 8)
            entry = {**ce, "id": 1000 + i}
            c = {"name": ce["name"], "slug": slug, "level": level}
            sub = None
            subs = [s for s in by_kind["subclass"] if s["parent"] == slug]
            if subs and rng.random() < 0.8:
                s = subs[0]
                c["subclass"] = {"name": s["name"], "path": s["path"]}
                sub = s["data"]
            elif rng.random() < 0.1:
                c["subclass"] = {}
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
        skills = rng.sample(list(SKILLS), rng.randint(0, 6))
        expertise = rng.sample(skills, min(len(skills), rng.randint(0, 2)))
        if rng.random() < 0.15:
            expertise.append("Stealth")
        feats = []
        for name in rng.sample(feats_pool, rng.randint(0, 3)):
            f = {"id": 5000 + len(feats), "name": name, "from": rng.choice(["asi", "asi", "race", None])}
            if rng.random() < 0.4:
                f["asi"], f["asi_amount"] = rng.choice(ABILITIES), rng.choice([1, 1, 2, "1"])
            feats.append(f)
        spells = []
        lists = [l for l in by_kind["spell-list"] if l["parent"] in {c["slug"] for c in classes}]
        spell_ctx = {}
        for sl in lists:
            for sp in rng.sample(sl["data"]["spells"], min(6, len(sl["data"]["spells"]))):
                full = next(e for e in by_kind["spell"] if e["path"] == sp["path"])
                sid = 9000 + len(spells)
                row = {"id": sid, "name": sp["name"], "class": sl["parent"]}
                if rng.random() < 0.7:
                    row["level"] = sp["level"]
                if rng.random() < 0.2:
                    row["prepared"] = rng.choice([False, None, True])
                if rng.random() < 0.1:
                    row["always"] = True
                spells.append(row)
                spell_ctx[str(sid)] = full["data"]  # same object both keys, so refs resolve
                spell_ctx[sp["name"].lower()] = full["data"]
        if rng.random() < 0.1:
            spells.append({"name": "Mystery Spell", "level": 9, "class": ""})
        char = {
            "name": f"Case {n}", "classes": classes, "ability_method": method, "base_scores": base,
            "race_bonus": {a: race["analysis"]["asi"].get(a, 0) for a in ABILITIES},
            "improvements": {a: rng.choice([0, 0, 0, 1, 2]) for a in ABILITIES},
            "skills": skills, "expertise": expertise, "feats": feats, "spells": spells,
            "hp_mode": rng.choice(["average", "rolled"]),
            "hp_rolls": [rng.choice([1, 3, 5, 8, 12, 0, None, "4"]) for _ in range(25)],
            "hp_bonus": rng.choice([0, 0, 3]), "ac_bonus": rng.choice([0, 0, 1]),
            "armor": rng.choice([""] * 4 + list(ARMOR)), "shield": rng.random() < 0.3,
            "weapons": rng.sample(list(WEAPONS), rng.randint(0, 4))
                       + ([{"name": "Longsword", "bonus": 1}] if rng.random() < 0.2 else []),
            "speed_override": rng.choice([0, 0, 0, 35]), "tools": rng.choice(["", "Lute", "none"]),
            "languages": rng.choice(["", "Common, Elvish"]),
            "extra_features": [{"name": "Boon", "text": "A gift."}] if rng.random() < 0.2 else [],
        }
        if rng.random() < 0.05:
            char["classes"].append({"name": "", "level": 3})
        ctx = {"classes": cctx, "race": race, "background": {"name": bg["name"], **bg["data"]},
               "spells": spell_ctx, "feats": {str(f["id"]): {"text": f"{f['name']} text"} for f in feats},
               "warnings": ["Couldn't load something: test"] if rng.random() < 0.05 else []}
        stored = copy.deepcopy(ctx)
        sheet = rules.compute(char, ctx)
        # keep the file small: big SRD blocks are stored as references the test resolves from srd-2014.json
        for cc, c in zip(stored["classes"], classes):
            cc["detail"] = f"@class:/{c['slug']}"
            if cc["subclass"] is not None:
                cc["subclass"] = f"@subclass:{c['subclass']['path']}"
        stored["background"] = f"@background:{bg['path']}"
        stored["spells"] = {k: f"@spell:{next(e['path'] for e in by_kind['spell'] if e['data'] is v)}"
                            for k, v in ctx["spells"].items()}
        for f in sheet["features"]:  # long feature text is compared by hash
            f["text"] = "#" + hashlib.sha1(f["text"].encode()).hexdigest()[:12]
        cases.append({"char": char, "ctx": stored, "sheet": sheet})
    out = ROOT / "tests" / "fixtures" / "parity.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(cases)} cases to {out} ({out.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
