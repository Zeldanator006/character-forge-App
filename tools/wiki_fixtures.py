"""Make tests/fixtures/wiki.json: sample wiki pages run through the PC app's wikiparse.py.

tests/wiki.test.mjs runs the same pages through www/js/wikiparse.js and expects the same results. Usage (needs the
PC app's requirements, for BeautifulSoup):

    python3 tools/wiki_fixtures.py /path/to/character-forge
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    sys.path.insert(0, sys.argv[1])
    from app import wikiparse as wp  # noqa: E402  (the PC app)
    from tests import fixtures as pc_pages  # noqa: E402
    import wiki_samples  # noqa: E402

    pages = {f"pc.{k}": v for k, v in vars(pc_pages).items() if k.isupper() and isinstance(v, str) and v.startswith("<html")}
    pages.update({f"sample.{k}": v for k, v in wiki_samples.PAGES.items()})
    parsers = {"index": wp.parse_index, "spell_list": wp.parse_spell_list, "spell": wp.parse_spell,
               "class": lambda h: wp.parse_class(h, "fighter"), "class_wizard": lambda h: wp.parse_class(h, "wizard"),
               "subclass": wp.parse_subclass, "race": wp.parse_race, "background": wp.parse_background,
               "feat": wp.parse_feat, "magic_item_list": wp.parse_magic_item_list, "magic_item": wp.parse_magic_item,
               "option_page": wp.parse_option_page, "generic": wp.parse_generic,
               "feature_options_3": lambda h: wp.feature_options(wp.content_root(wp.soup(h)), 3),
               "feature_options_2": lambda h: wp.feature_options(wp.content_root(wp.soup(h)), 2),
               "to_text": lambda h: wp.to_text(wp.content_root(wp.soup(h))),
               "title": lambda h: wp.page_title(wp.soup(h))}
    cases = []
    for name, html in pages.items():
        for pname, fn in parsers.items():
            try:
                out = fn(html)
            except Exception as e:  # noqa: BLE001 - JS must fail too
                out = {"__error__": type(e).__name__}
            cases.append({"page": name, "parser": pname, "out": out})
    texts = ["Choose two of the following options. You gain another one at 10th and 17th level.",
             "You learn three of the following of your choice at 3rd level, and two more at 7th, 11th, and 15th level.",
             "Pick one", "", "When you reach 6th level, choose one of your choice", "You gain one Fighting Style of your choice."]
    funcs = {
        "choice_count": [[t, lv] for t in texts for lv in (None, 2)],
        "skill_choice": [["You gain proficiency in two of the following skills of your choice: Arcana, History, and Nature."],
                         ["You have proficiency in one skill of your choice."], ["proficient in an other skill"], ["nothing"]],
        "parse_skill_choice": [["Choose two from Arcana, History, Insight"], ["Choose any three"], ["Choose 2 skills"], [""]],
        "norm_path": [["https://dnd5e.wikidot.com/spell:fireball#toc0"], ["/lineage:elf"], ["#top"], ["mailto:x"],
                      ["http://www.dnd5e.wikidot.com/"], ["https://example.com/x"], ["/a?b=1"], [""]],
        "split_list": [["Common, Elvish and one other"], ["  "], ["a; b. or c"]],
        "abilities_in": [["Strength and Dexterity, strength"], [""]],
        "first_level_mention": [["Beginning at 3rd level, you"], ["a 5th-level spell"], ["none"]],
        "parse_ordinal": [["1st"], [" 20th "], ["3"], [""]],
        "sections": [["pre\n### A\nbody a\n### B\nbody b", 3], ["no headings", 2]],
        "label_value": [["Source: PHB\n- Range: 60 feet", "Range"], ["x", "Source"]],
        "skill_field": [["History, plus one of your choice from among Arcana, Nature, or Religion"], ["Insight, Religion"]],
    }
    calls = []
    for fname, arglists in funcs.items():
        for args in arglists:
            out = getattr(wp, fname)(*args)
            calls.append({"fn": fname, "args": args, "out": out})
    doc = {"pages": pages, "cases": cases, "calls": calls, "parser_version": wp.PARSER_VERSION}
    out = ROOT / "tests" / "fixtures" / "wiki.json"
    out.write_text(json.dumps(doc, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {out}: {len(pages)} pages, {len(cases)} parser cases, {len(calls)} calls")


if __name__ == "__main__":
    main()
