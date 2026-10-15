// The JavaScript port of the PC app's gear module (with wikiparse.item_effects_from_text) must match the Python.
// Fixtures come from tools/gear_fixtures.py; see that file to regenerate them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as gear from '../www/js/gear.js';
import * as srd from '../www/js/srd.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const { constants, pools, cases } = read('./fixtures/gear.json');
const FIXED_ID = 'aaaaaaaaaa';
const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const modules = { gear, wikiparse: gear, srd };

/** "@pool:key" arguments stand for values stored once in the fixture (fresh copies each time). */
function resolve(v) {
  if (typeof v === 'string' && v.startsWith('@pool:')) return structuredClone(pools[v.slice(6)]);
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
}

/** New items get random ids; the Python ran with every new id "aaaaaaaaaa". */
function fixIds(v) {
  if (Array.isArray(v)) return v.map(fixIds);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k,
      k === 'id' && typeof x === 'string' && /^[0-9a-f]{10}$/.test(x) ? FIXED_ID : fixIds(x)]));
  }
  return v;
}

test('constants match the Python modules', () => {
  for (const [name, want] of Object.entries(constants)) {
    const [mod, key] = name.split('.');
    assert.ok(key in modules[mod], `${mod}.js doesn't export ${key}`);
    let got = modules[mod][key];
    if (key === 'CHOICES') got = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v[0]]));
    assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), want, `${name} differs`);
  }
});

test('new ids are 10 hex digits and differ', () => {
  const ids = new Set(Array.from({ length: 50 }, () => gear.newId()));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^[0-9a-f]{10}$/);
});

const byFn = new Map();
for (const c of cases) {
  if (!byFn.has(c.fn)) byFn.set(c.fn, []);
  byFn.get(c.fn).push(c);
}
for (const [fn, list] of byFn) {
  test(`${fn} matches the Python on ${list.length} cases`, () => {
    const [mod, name] = fn.split('.');
    const f = modules[mod][camel(name)];
    assert.equal(typeof f, 'function', `gear.js doesn't export ${camel(name)}`);
    for (const [i, c] of list.entries()) {
      const where = `${fn} case ${i}: ${JSON.stringify(c.args).slice(0, 300)}`;
      if (c.raises) {
        assert.throws(() => f(...resolve(c.args)), Error, `${where} should throw, as the Python does`);
        continue;
      }
      const got = fixIds(JSON.parse(JSON.stringify(f(...resolve(c.args)) ?? null)));
      assert.deepStrictEqual(got, c.out, where);
    }
  });
}
