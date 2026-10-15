// The JavaScript wiki parsers must give exactly what the PC app's wikiparse.py gives.
// Fixtures come from tools/wiki_fixtures.py (pages from tools/wiki_samples.py and the PC app's tests).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import * as wp from '../www/js/wikiparse.js';

// Node has no DOMParser; linkedom parses like BeautifulSoup's html.parser (no tbody added, no tag fixing)
wp.setHtmlParser((html) => parseHTML(html).document);
const fx = JSON.parse(readFileSync(new URL('./fixtures/wiki.json', import.meta.url), 'utf8'));
const plain = (v) => JSON.parse(JSON.stringify(v));

const PARSERS = {
  index: wp.parseIndex, spell_list: wp.parseSpellList, spell: wp.parseSpell,
  class: (h) => wp.parseClass(h, 'fighter'), class_wizard: (h) => wp.parseClass(h, 'wizard'),
  subclass: wp.parseSubclass, race: wp.parseRace, background: wp.parseBackground, feat: wp.parseFeat,
  magic_item_list: wp.parseMagicItemList, magic_item: wp.parseMagicItem, option_page: wp.parseOptionPage,
  generic: wp.parseGeneric,
  feature_options_3: (h) => wp.featureOptions(wp.contentRoot(wp.soup(h)), 3),
  feature_options_2: (h) => wp.featureOptions(wp.contentRoot(wp.soup(h)), 2),
  to_text: (h) => wp.toText(wp.contentRoot(wp.soup(h))),
  title: (h) => wp.pageTitle(wp.soup(h)),
};
const FUNCS = {
  choice_count: wp.choiceCount, skill_choice: wp.skillChoice, parse_skill_choice: wp.parseSkillChoice,
  norm_path: wp.normPath, split_list: wp.splitList, abilities_in: wp.abilitiesIn,
  first_level_mention: wp.firstLevelMention, parse_ordinal: wp.parseOrdinal, sections: wp.sections,
  label_value: wp.labelValue, skill_field: wp.skillField,
};

test('same parser version as the PC app', () => assert.equal(wp.PARSER_VERSION, fx.parser_version));

for (const parser of Object.keys(PARSERS)) {
  test(`wikiparse ${parser} matches the Python on every sample page`, () => {
    for (const c of fx.cases.filter((x) => x.parser === parser)) {
      const html = fx.pages[c.page];
      if (c.out && c.out.__error__) { assert.throws(() => PARSERS[parser](html), `${c.page} should fail`); continue; }
      assert.deepStrictEqual(plain(PARSERS[parser](html)), c.out, `${parser} on ${c.page}`);
    }
  });
}

test('wikiparse helpers match the Python', () => {
  for (const c of fx.calls) assert.deepStrictEqual(plain(FUNCS[c.fn](...c.args) ?? null), c.out, `${c.fn}(${JSON.stringify(c.args)})`);
});
