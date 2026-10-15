// The JavaScript rules engine must match the PC app's Python engine exactly.
// Fixtures come from tools/parity_fixtures.py; see that file to regenerate them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compute, computeAny, computeManual, toManual } from '../www/js/rules.js';
import * as creatures from '../www/js/creatures.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const srd = read('../www/data/srd-2014.json').entries;
creatures.setCreatures(read('../www/data/creatures.json'));
const byRef = new Map(srd.map((e) => [`@${e.kind}:${e.path}`, e]));
const resolve = (ref) => {
  const e = byRef.get(ref);
  assert.ok(e, `fixture refers to missing SRD entry ${ref}`);
  return structuredClone(e.data);
};
const { races, cases } = read('./fixtures/parity.json');
const hash = (t) => '#' + createHash('sha1').update(t || '').digest('hex').slice(0, 12);
const plain = (v) => JSON.parse(JSON.stringify(v));

function context(stored) {
  const ctx = structuredClone(stored);
  for (const cc of ctx.classes || []) {
    cc.detail = resolve(cc.detail);
    if (cc.subclass) cc.subclass = resolve(cc.subclass);
  }
  if (typeof ctx.race === 'string') ctx.race = structuredClone(races[ctx.race.slice('@race:'.length)]);
  if (ctx.background) {
    const bg = byRef.get(ctx.background);
    ctx.background = { name: bg.name, ...structuredClone(bg.data) };
  }
  // the Python context shares one spell object between its id and name keys
  const shared = new Map();
  ctx.spells = Object.fromEntries(Object.entries(ctx.spells || {}).map(([k, ref]) => {
    if (!shared.has(ref)) shared.set(ref, resolve(ref));
    return [k, shared.get(ref)];
  }));
  return ctx;
}

/** Python iterates sets in hash order, so only the multiset of warnings is comparable; long text is hashed. */
function comparable(sheet, char = {}) {
  const out = plain(sheet);
  out.features.forEach((f) => { f.text = hash(f.text); });
  // an older character (no inventory) gets its items, with new random ids, each time
  if (!Array.isArray(char.inventory)) out.attacks.forEach((a) => { if (a.item) a.item = 'new'; });
  out.warnings.sort();
  return out;
}


const want = (sheet) => { const s = structuredClone(sheet); s.warnings.sort(); return s; };

test(`rules.js matches rules.py on ${cases.length} random characters`, () => {
  for (const [i, c] of cases.entries()) {
    const got = computeAny(structuredClone(c.char), context(c.ctx));
    assert.deepStrictEqual(comparable(got, c.char), want(c.sheet), `case ${i} (${c.char.name}) differs`);
    if (!c.manual) continue;
    const m = toManual(structuredClone(c.char), structuredClone(got));
    const kept = Object.fromEntries(Object.keys(c.manual).map((k) => [k, m[k] ?? null]));
    kept.extra_features = kept.extra_features.map((f) => ({ ...f, text: hash(f.text) }));
    assert.deepStrictEqual(plain(kept), c.manual, `case ${i} (${c.char.name}): toManual differs`);
    assert.deepStrictEqual(comparable(computeAny(m, context(c.ctx))), want(c.manual_sheet),
      `case ${i} (${c.char.name}): the hand-written copy's sheet differs`);
  }
});

test('computeAny picks the engine by mode; compute and computeManual stay exported', () => {
  assert.equal(typeof compute, 'function');
  assert.equal(computeAny({ mode: 'manual', manual: { level: 3 } }, {}).mode, 'manual');
  assert.equal(computeManual({}, null).total_level, 1);
  assert.equal(computeAny({ classes: [] }, {}).mode, 'builder');
});
