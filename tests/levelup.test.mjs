// The JavaScript port of the PC app's levelup module must match the Python.
// Fixtures come from tools/levelup_fixtures.py, which runs the Python with the built-in SRD as its library;
// here a Library holding the same entries is passed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as levelup from '../www/js/levelup.js';
import * as creatures from '../www/js/creatures.js';
import { Library } from '../www/js/library.js';
import { memoryStore } from '../www/js/store.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const srd = read('../www/data/srd-2014.json');
creatures.setCreatures(read('../www/data/creatures.json'));
const cases = read('./fixtures/levelup.json');
const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const hash = (t) => '#' + createHash('sha1').update(t || '').digest('hex').slice(0, 12);
const TAKES_LIBRARY = new Set(['bumped', 'preview', 'apply']);

const lib = new Library(memoryStore(), srd.entries);
await lib.load();

const byFn = new Map();
for (const c of cases) {
  if (!byFn.has(c.fn)) byFn.set(c.fn, []);
  byFn.get(c.fn).push(c);
}
for (const [fn, list] of byFn) {
  test(`levelup.${fn} matches the Python on ${list.length} cases`, () => {
    const f = levelup[camel(fn)];
    assert.equal(typeof f, 'function', `levelup.js doesn't export ${camel(fn)}`);
    for (const [i, c] of list.entries()) {
      const args = structuredClone(c.args);
      if (TAKES_LIBRARY.has(fn)) args.push(lib);
      const where = `${fn} case ${i}: ${JSON.stringify(c.args).slice(0, 200)}`;
      if (c.raises) {
        assert.throws(() => f(...args), Error, `${where} should throw, as the Python does`);
        continue;
      }
      const got = JSON.parse(JSON.stringify(f(...args)));
      if (fn === 'preview') got.features.forEach((x) => { x.text = hash(x.text); });
      assert.deepStrictEqual(got, c.out, where);
    }
  });
}

test('withLibrary binds the library once', () => {
  const lu = levelup.withLibrary(lib);
  const c = cases.find((x) => x.fn === 'preview' && !x.raises);
  const got = JSON.parse(JSON.stringify(lu.preview(...structuredClone(c.args))));
  got.features.forEach((x) => { x.text = hash(x.text); });
  assert.deepStrictEqual(got, c.out);
  assert.equal(lu.rollIndex([{ level: 3 }], 0), 1);
});
