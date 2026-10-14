"""Build www/data/srd-2014.json from the 5e-bits SRD database.

The System Reference Document 5.1 is released by Wizards of the Coast under CC-BY-4.0.
The JSON source is https://github.com/5e-bits/5e-database (MIT). Usage:

    git clone --depth 1 https://github.com/5e-bits/5e-database /tmp/5edb
    python3 tools/build_srd.py /tmp/5edb/src/2014/en

Output entries use the same shapes the app's library uses for every source
(class, subclass, race, background, feat, spell, spell-list), so the builder
treats SRD content exactly like imported content.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "www" / "data" / "srd-2014.json"
SOURCE = "srd"
ORD = {1: "1st", 2: "2nd", 3: "3rd"}
WEAPON_NAMES = {"club", "dagger", "dart", "javelin", "mace", "quarterstaff", "scimitar", "sickle", "sling", "spear",
                "light crossbow", "hand crossbow", "longsword", "rapier", "shortsword"}
ABILITY = {"STR": "str", "DEX": "dex", "CON": "con", "INT": "int", "WIS": "wis", "CHA": "cha"}


def stable_id(kind, path):
    """Characters store entry ids, so SRD ids must never change between builds: hash kind and path.
    They sit at 1,000,000,000 and up; entries you add yourself count up from 1."""
    h = 2166136261
    for ch in f"{kind}|{path}".encode():
        h = ((h ^ ch) * 16777619) & 0xFFFFFFFF
    return 1_000_000_000 + h % 1_000_000_000


def ordinal(n):
    return ORD.get(n, f"{n}th")


def load(folder, name):
    return json.loads((Path(folder) / f"5e-SRD-{name}.json").read_text(encoding="utf-8"))


def text(desc):
    if isinstance(desc, str):
        return desc.strip()
    return "\n\n".join(d.strip() for d in desc or [] if d and d.strip())


def skill_names(options):
    out = []
    for o in options:
        item = o.get("item") or {}
        name = item.get("name", "")
        if name.startswith("Skill: "):
            out.append(name[len("Skill: "):])
    return out


def build(folder):
    classes = load(folder, "Classes")
    levels = load(folder, "Levels")
    features = load(folder, "Features")
    subclasses = load(folder, "Subclasses")
    races = load(folder, "Races")
    subraces = load(folder, "Subraces")
    traits = {t["index"]: t for t in load(folder, "Traits")}
    backgrounds = load(folder, "Backgrounds")
    feats = load(folder, "Feats")
    spells = load(folder, "Spells")

    entries = []

    def add(kind, name, path, data, parent=""):
        entries.append({"id": stable_id(kind, path), "kind": kind, "name": name, "source": SOURCE, "path": path, "parent": parent,
                        "group": "SRD 5.1", "tags": [], "data": data, "parsed": True})

    # ------------------------------------------------------------ features, with options folded into their parent
    children = defaultdict(list)
    for f in features:
        if f.get("parent"):
            children[f["parent"]["index"]].append(f)

    def feature_text(f):
        body = text(f.get("desc"))
        for c in children.get(f["index"], []):
            label = c["name"].split(":", 1)[-1].strip()
            body += f"\n\n{label}. {text(c.get('desc'))}"
        return body.strip()

    class_features = defaultdict(list)
    sub_features = defaultdict(list)
    for f in features:
        if f.get("parent"):
            continue
        item = {"name": f["name"], "level": f["level"], "text": feature_text(f)}
        if f.get("subclass"):
            sub_features[f["subclass"]["index"]].append(item)
        else:
            class_features[f["class"]["index"]].append(item)

    # ------------------------------------------------------------ classes and their tables
    class_levels = defaultdict(dict)
    for lv in levels:
        if "subclass" not in lv and lv.get("class"):
            class_levels[lv["class"]["index"]][lv["level"]] = lv

    for c in classes:
        slug = c["index"]
        choice = (c.get("proficiency_choices") or [{}])[0]
        opts = skill_names(((choice.get("from") or {}).get("options")) or [])
        profs = [p["name"] for p in c.get("proficiencies") or [] if not p["name"].startswith("Saving Throw")]
        armor = [p for p in profs if "armor" in p.lower() or p == "Shields"]
        weapons = [p for p in profs if "Weapons" in p or "crossbow" in p.lower() or p.lower().rstrip("s") in WEAPON_NAMES]
        tools = [p for p in profs if p not in armor and p not in weapons]
        table = []
        any_known = any(((class_levels[slug].get(n) or {}).get("spellcasting") or {}).get("spells_known")
                        for n in range(1, 21))
        any_cantrips = any(((class_levels[slug].get(n) or {}).get("spellcasting") or {}).get("cantrips_known")
                           for n in range(1, 21))
        header = ["Level", "Proficiency Bonus", "Features"]
        if any_cantrips:
            header.append("Cantrips Known")
        if any_known:
            header.append("Spells Known")
        has_slots = any(((class_levels[slug].get(n) or {}).get("spellcasting") or {}).get("spell_slots_level_1")
                        for n in range(1, 21))
        if has_slots:
            header += [ordinal(n) for n in range(1, 10)]
        for n in range(1, 21):
            lv = class_levels[slug].get(n)
            if not lv:
                continue
            row = {"_level": n, "Level": ordinal(n), "Proficiency Bonus": f"+{lv.get('prof_bonus', 2)}",
                   "Features": ", ".join(f["name"] for f in lv.get("features") or []) or "—"}
            sc = lv.get("spellcasting") or {}
            if any_cantrips:
                row["Cantrips Known"] = str(sc.get("cantrips_known") or "—")
            if any_known:
                row["Spells Known"] = str(sc.get("spells_known") or "—")
            if has_slots:
                for s in range(1, 10):
                    v = sc.get(f"spell_slots_level_{s}") or 0
                    row[ordinal(s)] = str(v) if v else "—"
            table.append(row)
        sc = c.get("spellcasting") or {}
        data = {
            "slug": slug, "hit_die": c["hit_die"],
            "saves": [ABILITY[s["name"]] for s in c.get("saving_throws") or []],
            "skill_count": choice.get("choose") or 2, "skill_options": opts,
            "armor": ", ".join(armor) or "None", "weapons": ", ".join(weapons) or "None",
            "tools": ", ".join(tools) or "None",
            "spell_ability": ABILITY.get(((sc.get("spellcasting_ability") or {}).get("name")) or ""),
            "table_header": header, "table": table,
            "features": sorted(class_features[slug], key=lambda f: f["level"]),
            "asi_levels": sorted({f["level"] for f in class_features[slug] if f["name"] == "Ability Score Improvement"}),
            "subclasses": [{"name": s["name"], "path": f"/{slug}:{s['index']}", "source": "SRD 5.1", "tags": []}
                           for s in c.get("subclasses") or []],
        }
        add("class", c["name"], f"/{slug}", data)

    # ------------------------------------------------------------ subclasses
    for s in subclasses:
        slug = s["class"]["index"]
        bonus = defaultdict(list)
        for sp in s.get("spells") or []:
            lvl = None
            for p in sp.get("prerequisites") or []:
                m = re.search(r"-(\d+)$", p.get("index", ""))
                if p.get("type") == "level" and m:
                    lvl = int(m.group(1))
            if lvl:
                bonus[lvl].append(sp["spell"]["name"])
        add("subclass", s["name"], f"/{slug}:{s['index']}",
            {"source": "SRD 5.1", "flavor": s.get("subclass_flavor", ""), "intro": text(s.get("desc")),
             "features": sorted(sub_features[s["index"]], key=lambda f: f["level"]),
             "bonus_spells": [{"level": k, "spells": v} for k, v in sorted(bonus.items())]},
            parent=slug)

    # ------------------------------------------------------------ species
    def trait_list(refs):
        out = []
        for r in refs or []:
            t = traits.get(r["index"])
            if t:
                out.append({"name": t["name"], "text": text(t.get("desc"))})
        return out

    def asi_of(bonuses):
        return {ABILITY[b["ability_score"]["name"]]: b["bonus"] for b in bonuses or []}

    def trait_skills(refs):
        out = []
        for r in refs or []:
            for p in (traits.get(r["index"]) or {}).get("proficiencies") or []:
                if p["name"].startswith("Skill: "):
                    out.append(p["name"][len("Skill: "):])
        return out

    subs_by_race = defaultdict(list)
    for s in subraces:
        subs_by_race[s["race"]["index"]].append(s)
    for r in races:
        asi = asi_of(r.get("ability_bonuses"))
        asi_txt = ", ".join(f"{k.upper()} +{v}" for k, v in asi.items())
        if r.get("ability_bonus_options"):
            opt = r["ability_bonus_options"]
            asi_txt += f"; plus {opt.get('choose', 2)} other scores of your choice increase by 1"
        base = [
            {"name": "Ability Score Increase", "text": asi_txt},
            {"name": "Age", "text": r.get("age", "")},
            {"name": "Alignment", "text": r.get("alignment", "")},
            {"name": "Size", "text": r.get("size_description", "")},
            {"name": "Speed", "text": f"Your base walking speed is {r.get('speed', 30)} feet."},
            {"name": "Languages", "text": r.get("language_desc", "")},
        ] + trait_list(r.get("traits"))
        darkvision = 60 if any(t["index"] == "darkvision" for t in r.get("traits") or []) else None
        skill_choices = 2 if r["index"] == "half-elf" else 0
        sub_out = []
        for s in subs_by_race.get(r["index"], []):
            sub_out.append({"name": s["name"], "traits": [{"name": "Ability Score Increase",
                            "text": ", ".join(f"{k.upper()} +{v}" for k, v in asi_of(s.get("ability_bonuses")).items())}]
                            + trait_list(s.get("racial_traits")),
                            "asi": asi_of(s.get("ability_bonuses")),
                            "skills": trait_skills(s.get("racial_traits"))})
        variant = {
            "source": "SRD 5.1", "intro": "", "traits": base, "subraces": sub_out,
            "fixed": {"asi": asi, "speed": r.get("speed"), "size": r.get("size"), "darkvision": darkvision,
                      "languages": ", ".join(l["name"] for l in r.get("languages") or []),
                      "skills": trait_skills(r.get("traits")), "skill_choices": skill_choices,
                      "asi_flexible": bool(r.get("ability_bonus_options"))},
        }
        add("race", r["name"], f"/lineage:{r['index']}", {"variants": [variant]})

    # ------------------------------------------------------------ backgrounds and feats
    for b in backgrounds:
        skills = [p["name"][len("Skill: "):] for p in b.get("starting_proficiencies") or []
                  if p["name"].startswith("Skill: ")]
        lo = b.get("language_options") or {}
        equipment = ", ".join(f"{e['equipment']['name']}" + (f" ({e['quantity']})" if e.get("quantity", 1) > 1 else "")
                              for e in b.get("starting_equipment") or [])
        if b.get("starting_gold"):
            equipment += f", {b['starting_gold']['quantity']} {b['starting_gold']['unit']}"
        feat = b.get("feature") or {}
        add("background", b["name"], f"/background:{b['index']}", {
            "source": "SRD 5.1", "skills": skills, "skills_text": ", ".join(skills), "tools": "",
            "languages": f"Two of your choice" if lo.get("choose") == 2 else "",
            "equipment": equipment, "feature": {"name": feat.get("name", ""), "text": text(feat.get("desc"))},
            "text": ""})
    for f in feats:
        prereq = ", ".join(f"{p['ability_score']['name'].title()} {p['minimum_score']} or higher"
                           for p in f.get("prerequisites") or [] if p.get("ability_score"))
        add("feat", f["name"], f"/feat:{f['index']}", {"source": "SRD 5.1", "prerequisite": prereq,
                                                        "asi_options": [], "asi_amount": 0, "text": text(f.get("desc"))})

    # ------------------------------------------------------------ spells and class spell lists
    lists = defaultdict(list)
    for s in spells:
        comps = ", ".join(s.get("components") or [])
        if s.get("material"):
            comps += f" ({s['material'].rstrip('.')})"
        duration = s.get("duration", "")
        if s.get("concentration") and "concentration" not in duration.lower():
            duration = f"Concentration, {duration[0].lower() + duration[1:]}" if duration else "Concentration"
        cls = [c["name"] for c in s.get("classes") or []]
        path = f"/spell:{s['index']}"
        add("spell", s["name"], path, {
            "source": "SRD 5.1", "level": s["level"], "school": s["school"]["name"],
            "casting_time": s.get("casting_time", ""), "ritual": bool(s.get("ritual")),
            "range": s.get("range", ""), "components": comps, "duration": duration,
            "concentration": bool(s.get("concentration")), "classes": cls,
            "description": text(s.get("desc")), "higher_levels": text(s.get("higher_level"))})
        for c in s.get("classes") or []:
            lists[c["index"]].append({"path": path, "name": s["name"], "level": s["level"]})
    for slug, sp in sorted(lists.items()):
        name = next(c["name"] for c in classes if c["index"] == slug)
        add("spell-list", f"{name} spell list", f"/spells:{slug}",
            {"spells": sorted(sp, key=lambda x: (x["level"], x["name"]))}, parent=slug)

    return entries


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    entries = build(sys.argv[1])
    ids = [e["id"] for e in entries]
    assert len(ids) == len(set(ids)), "two SRD entries hashed to the same id"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {"name": "System Reference Document 5.1", "license": "CC-BY-4.0",
           "attribution": ("This work includes material taken from the System Reference Document 5.1 (\"SRD 5.1\") "
                           "by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. "
                           "The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License "
                           "available at https://creativecommons.org/licenses/by/4.0/legalcode."),
           "version": 1, "entries": entries}
    OUT.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    counts = defaultdict(int)
    for e in entries:
        counts[e["kind"]] += 1
    print(f"Wrote {OUT} ({OUT.stat().st_size // 1024} KB):", dict(counts))


if __name__ == "__main__":
    main()
