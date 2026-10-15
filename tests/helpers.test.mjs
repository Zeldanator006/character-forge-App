// The JavaScript ports of the PC app's dice, creatures, resources, feats and options modules must match the Python.
// Fixtures come from tools/helper_fixtures.py; see that file to regenerate them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as dice from '../www/js/dice.js';
import * as creatures from '../www/js/creatures.js';
import * as resources from '../www/js/resources.js';
import * as feats from '../www/js/feats.js';
import * as options from '../www/js/options.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const srd = read('../www/data/srd-2014.json').entries;
const creatureDoc = read('../www/data/creatures.json');
creatures.setCreatures(creatureDoc);
const { constants, pools, cases } = read('./fixtures/helpers.json');

const modules = { dice, creatures, resources, feats, options };
const camel = (name) => name.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
const refs = {
  spell: new Map(srd.filter((e) => e.kind === 'spell').map((e) => [e.path, e.data])),
  class: new Map(srd.filter((e) => e.kind === 'class').map((e) => [e.data.slug, e.data])),
  table: new Map(srd.filter((e) => e.kind === 'class').map((e) => [e.data.slug, e.data.table])),
  creature: new Map(creatureDoc.creatures.map((c) => [c.name, c])),
  pool: new Map(Object.entries(pools)),
};
/** "@kind:key" strings anywhere in a value stand for SRD data, stat blocks or pooled values (fresh copies each time). */
function resolve(v) {
  if (typeof v === 'string' && v.startsWith('@')) {
    const at = v.indexOf(':');
    const map = refs[v.slice(1, at)];
    if (map) {
      assert.ok(map.has(v.slice(at + 1)), `fixture refers to missing ${v}`);
      return resolve(structuredClone(map.get(v.slice(at + 1))));
    }
  }
  if (Array.isArray(v)) return v.map(resolve);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
  return v;
}

test('creatures.json is the SRD 5.1 creature list', () => {
  assert.match(creatureDoc.source, /System Reference Document 5\.1/);
  assert.equal(creatureDoc.creatures.length, 334);
});

test('constants match the Python modules', () => {
  const plain = (v) => (v instanceof Set ? [...v].sort() : v instanceof Map ? Object.fromEntries(v) : v);
  for (const [name, want] of Object.entries(constants)) {
    const [mod, key] = name.split('.');
    assert.ok(key in modules[mod], `${mod}.js doesn't export ${key}`);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(plain(modules[mod][key]))), want, `${name} differs`);
  }
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
    assert.equal(typeof f, 'function', `${mod}.js doesn't export ${camel(name)}`);
    for (const [i, c] of list.entries()) {
      const got = f(...resolve(c.args));
      assert.deepStrictEqual(got, resolve(c.out), `${fn} case ${i}: ${JSON.stringify(c.args).slice(0, 300)}`);
    }
  });
}

test('loadCreatures fetches the data once and shares it', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return { ok: true, json: async () => creatureDoc }; };
  try {
    const list = await creatures.loadCreatures();
    assert.equal(list.length, 334);
    await creatures.loadCreatures();
    assert.ok(calls <= 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});
