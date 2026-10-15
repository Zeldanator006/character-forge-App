"""Make tests/fixtures/sheetpdf.json: what the PC app's sheet_pdf.official_values gives for the parity characters.

tests/sheetpdf.test.mjs runs the same characters and sheets through www/js/sheetpdf.js (officialValues) and expects
the same values, field for field, so filling the fillable sheet can't drift from the PC. Usage:

    python3 tools/sheetpdf_fixtures.py /path/to/character-forge   # the PC app's repository

The characters and sheets come from tests/fixtures/parity.json (run tools/parity_fixtures.py first): each case's
character with its sheet, and its hand-written copy with that copy's sheet. They are referred to by case index, so
nothing is stored twice. A few made-up edge cases (no name, many features and attacks, coins) are stored in full.
"""
import copy
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def edge_cases(cases):
    """Characters the random ones may not hit: missing and None fields, long lists, coins, a player name."""
    out = []
    base = next(c for c in cases if c["sheet"]["spellcasting"] and len(c["sheet"]["attacks"]) >= 1)
    char, sheet = copy.deepcopy(base["char"]), copy.deepcopy(base["sheet"])
    char.update(name=None, player="Sam", xp=0, equipment="Rope, 50 feet\nA lucky coin", alignment=None,
                coins={"cp": 3, "sp": 0, "gp": 12, "pp": None}, personality={"ideals": "Freedom — always."},
                backstory="Born in a storm.\n\nRaised by wolves.")
    sheet["features"] = [{"name": f"Feature {i}", "source": "Test" if i % 3 else None, "text": "x"} for i in range(45)]
    sheet["features"][5] = {"name": None, "text": ""}
    sheet["attacks"] = (sheet["attacks"] * 6)[:6]
    sheet["inventory_lines"] = None
    char.update(armor="Chain mail", shield=True, weapons=["Longsword", {"name": "Handaxe"}, "Unarmed strike", {}])
    sheet["slots"] = [4, 3, 0, 2, 0, 0, 0, 0, 0]
    out.append({"char": char, "sheet": sheet})
    char2, sheet2 = copy.deepcopy(base["char"]), copy.deepcopy(base["sheet"])
    for k in ("name", "player", "alignment", "xp", "personality", "backstory", "coins", "equipment"):
        char2.pop(k, None)
    sheet2.pop("background_name", None)
    sheet2.pop("race_name", None)
    sheet2["languages"] = ""
    sheet2["spellcasting"] = []
    sheet2["slots"] = []
    sheet2["inventory_lines"] = []
    out.append({"char": char2, "sheet": sheet2})
    return out


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    sys.path.insert(0, str(Path(sys.argv[1]).resolve()))
    from app import sheet_pdf

    cases = json.loads((ROOT / "tests" / "fixtures" / "parity.json").read_text(encoding="utf-8"))["cases"]
    values = []
    for i, c in enumerate(cases):
        values.append({"case": i, "manual": False, "values": sheet_pdf.official_values(c["char"], c["sheet"])})
        if c.get("manual"):
            mchar = {**c["char"], **c["manual"]}
            values.append({"case": i, "manual": True, "values": sheet_pdf.official_values(mchar, c["manual_sheet"])})
    extra = edge_cases(cases)
    for e in extra:
        e["values"] = sheet_pdf.official_values(e["char"], e["sheet"])
    doc = {"field_map": sheet_pdf.DEFAULT_FIELD_MAP, "values": values, "extra": extra}
    out = ROOT / "tests" / "fixtures" / "sheetpdf.json"
    out.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out} ({len(values)} characters, {len(extra)} edge cases)")


if __name__ == "__main__":
    main()
