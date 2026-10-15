"""Make tests/fixtures/levelup.json: level ups run through the PC app's levelup module.

The library is the phone app's built-in SRD (www/data/srd-2014.json): the PC app's library lookups
(library.ensure_detail and its database) are pointed at those entries while this runs, and
tests/levelup.test.mjs gives www/js/levelup.js a Library holding the same entries, so both build their
contexts from the same data. Usage:

    python3 tools/levelup_fixtures.py /path/to/character-forge   # the PC app's repository
"""
import contextlib
import copy
import hashlib
import json
import random
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COUNT = 25


def hash_text(t):
    return "#" + hashlib.sha1((t or "").encode()).hexdigest()[:12]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.path.insert(0, sys.argv[1])
    from app import levelup, library, options  # noqa: E402  (the PC app)
    from app.srd import ABILITIES, SKILLS  # noqa: E402

    entries = json.loads((ROOT / "www" / "data" / "srd-2014.json").read_text(encoding="utf-8"))["entries"]
    by_id = {e["id"]: e for e in entries}
    by_kind = {}
    for e in entries:
        by_kind.setdefault(e["kind"], []).append(e)

    class FakeDb:  # the SRD entries as the PC app's database
        @staticmethod
        @contextlib.contextmanager
        def connect():
            yield None

        @staticmethod
        def get_entry(con, entry_id):
            return copy.deepcopy(by_id.get(entry_id))

        @staticmethod
        def find_entry(con, kind, name, parent=None):
            return next((copy.deepcopy(e) for e in entries if e["kind"] == kind and e["name"].lower() == (name or "").lower()
                         and (not parent or e["parent"] == parent)), None)

    library.db = FakeDb
    library.ensure_detail = lambda entry_id, refresh=False: copy.deepcopy(by_id.get(entry_id))

    rng = random.Random(20261017)
    cases, skipped = [], {}

    def case(fn, *args):
        stored = json.loads(json.dumps(args))
        try:
            out = getattr(levelup, fn)(*copy.deepcopy(list(args)))
        except Exception:  # noqa: BLE001  (the JavaScript must throw too)
            skipped[fn] = skipped.get(fn, 0) + 1
            cases.append({"fn": fn, "args": stored, "raises": True})
            return None
        out = json.loads(json.dumps(out))
        if fn == "preview":
            for f in out["features"]:
                f["text"] = hash_text(f["text"])
        cases.append({"fn": fn, "args": stored, "out": out})
        return out

    classes_e = by_kind["class"]
    for n in range(COUNT):
        picks = rng.sample(classes_e, 1 if rng.random() < 0.6 else rng.choice([2, 3]))
        classes = []
        for ce in picks:
            c = {"id": ce["id"], "name": ce["name"], "slug": ce["data"]["slug"],
                 "level": rng.randint(1, 19 if len(picks) == 1 else 6), "subclass": None}
            subs = [s for s in by_kind["subclass"] if s["parent"] == c["slug"]]
            if subs and rng.random() < 0.6:
                s = subs[0]
                c["subclass"] = {"id": s["id"], "name": s["name"], "path": s["path"]}
            if rng.random() < 0.05:
                c["level"] = rng.choice(["4", None])
            classes.append(c)
        race_e = rng.choice(by_kind["race"])
        variant = race_e["data"]["variants"][0]
        subrace = rng.choice([None] + [s["name"] for s in variant["subraces"]])
        spells = []
        for sl in [s for s in by_kind["spell-list"] if s["parent"] in {c["slug"] for c in classes}]:
            for sp in rng.sample(sl["data"]["spells"], min(4, len(sl["data"]["spells"]))):
                e = next(x for x in by_kind["spell"] if x["path"] == sp["path"])
                spells.append({"id": e["id"], "name": e["name"], "class": sl["parent"]} if rng.random() < 0.7
                              else {"name": e["name"], "class": sl["parent"]})
        rolled = rng.random() < 0.4
        char = {
            "name": f"Level {n}", "classes": classes,
            "race": {"id": race_e["id"], "name": race_e["name"], "variant": variant["source"], "subrace": subrace},
            "background": {"id": by_kind["background"][0]["id"], "name": by_kind["background"][0]["name"]},
            "base_scores": {a: rng.randint(8, 17) for a in ABILITIES}, "ability_method": "manual",
            "race_bonus": {a: 0 for a in ABILITIES}, "improvements": {a: rng.choice([0, 0, 1]) for a in ABILITIES},
            "skills": rng.sample(list(SKILLS), 3), "spells": spells,
            "feats": [{"id": by_kind["feat"][0]["id"], "name": by_kind["feat"][0]["name"]}] if rng.random() < 0.3 else [],
            "hp_mode": "rolled" if rolled else rng.choice(["average", None]),
            "hp_rolls": [rng.randint(0, 10) for _ in range(rng.randint(0, 12))] if rolled else [],
            "inventory": [],
        }
        if rng.random() < 0.3:
            char["snapshots"] = [{"label": f"Before {k}", "character": {"name": "old"}} for k in range(rng.randint(1, 6))]
        ctx = library.build_context(char)
        opts = []
        for g in options.feature_groups(char, ctx):
            if g.get("options") and rng.random() < 0.5:
                o = rng.choice(g["options"])
                opts.append({"key": g["key"], "label": g["label"], "class": g["class"], "name": o["name"], "text": ""})
        if opts:
            char["class_options"] = opts

        choices = [{"class_index": rng.randrange(len(classes))}, {"class_index": str(rng.randrange(len(classes)))},
                   {"class_id": rng.choice(classes_e)["id"]}, {"class_id": classes[0]["id"]}]
        if rng.random() < 0.2:
            choices.append(rng.choice([{"class_index": 9}, {}, {"class_id": by_kind["spell"][0]["id"]}, {"class_id": 12345},
                                       {"class_id": "x"}]))
        for choice in choices:
            case("bumped", char, choice)
            case("preview", char, choice)
            sub = rng.choice([None, {}, {"id": 1, "name": "Homebrew Path", "path": "/x:homebrew-path"}, {"name": ""}])
            data = {"hp_mode": rng.choice(["average", "rolled", None]), "hp_roll": rng.choice([None, 1, 6, 99, "3", "x", 0]),
                    "subclass": sub, "asi": rng.choice([None, {}, {"str": 2}, {"dex": 1, "con": "1", "foo": 2, "wis": "x"}])}
            case("apply", char, choice, data)
        case("roll_index", classes, rng.randrange(len(classes)))
    for char, idx, die, mode, value in [
        ({"hp_mode": "average"}, 2, 8, "average", None), ({"hp_mode": "average", "hp_rolls": [3]}, 2, 8, "rolled", 7),
        ({"hp_mode": "rolled", "hp_rolls": [3, 4]}, 1, 10, "rolled", "12"), ({"hp_mode": "rolled"}, 3, 6, "average", None),
        ({"hp_mode": "rolled", "hp_rolls": [1]}, 0, 12, "rolled", "x"), ({}, 0, 8, "rolled", 0),
        ({"hp_mode": "rolled", "hp_rolls": [5, 5, 5]}, 1, 8, "rolled", 4.5),
    ]:
        case("apply_hp", char, idx, die, mode, value)

    out = ROOT / "tests" / "fixtures" / "levelup.json"
    out.write_text(json.dumps(cases, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(cases)} cases to {out} ({out.stat().st_size // 1024} KB)")
    if skipped:
        print("Python raised (the test expects JavaScript to throw):", skipped)


if __name__ == "__main__":
    main()
