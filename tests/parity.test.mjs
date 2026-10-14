// The JavaScript rules engine must match the PC app's Python engine exactly.
// Fixtures come from tools/parity_fixtures.py; see that file to regenerate them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { compute } from '../www/js/rules.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const srd = read('../www/data/srd-2014.json').entries;
const byRef = new Map(srd.map((e) => [`@${e.kind}:${e.path}`, e]));
const resolve = (ref) => {
  const e = byRef.get(ref);
  assert.ok(e, `fixture refers to missing SRD entry ${ref}`);
  return e.data;
};

const cases = read('./fixtures/parity.json');

test(`rules.js matches rules.py on ${cases.length} random characters`, () => {
  for (const [i, { char, ctx, sheet }] of cases.entries()) {
    ctx.classes.forEach((cc) => {
      cc.detail = resolve(cc.detail);
      if (cc.subclass) cc.subclass = resolve(cc.subclass);
    });
    const bg = byRef.get(ctx.background);
    ctx.background = { name: bg.name, ...bg.data };
    ctx.spells = Object.fromEntries(Object.entries(ctx.spells).map(([k, ref]) => [k, resolve(ref)]));

    const got = compute(char, ctx);
    got.features.forEach((f) => { f.text = '#' + createHash('sha1').update(f.text).digest('hex').slice(0, 12); });
    // Python iterates sets in hash order, so only the multiset of warnings is comparable
    got.warnings.sort();
    sheet.warnings.sort();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), sheet, `case ${i} (${char.name}) differs`);
  }
});
