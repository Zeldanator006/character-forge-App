// Every file the app loads must be in the offline cache list, or the installed app breaks without a connection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const www = new URL('../www/', import.meta.url);
const sw = readFileSync(new URL('sw.js', www), 'utf8');
const cached = new Set([...sw.matchAll(/'([\w./-]+)'/g)].map((m) => m[1]));

test('the service worker caches every script, data file and vendored library', () => {
  // and everything index.html loads
  const html = readFileSync(new URL('index.html', www), 'utf8');
  const loaded = [...html.matchAll(/(?:src|href)="([\w./-]+\.(?:js|css|webmanifest|svg|png))"/g)].map((m) => m[1]);
  assert.deepEqual(loaded.filter((f) => !cached.has(f)), [], 'index.html loads files the service worker doesn’t cache');
  const want = ['index.html', 'phone.css', 'manifest.webmanifest', 'data/srd-2014.json', 'data/creatures.json',
    ...readdirSync(new URL('ui/', www)).map((f) => `ui/${f}`),
    ...readdirSync(new URL('js/', www)).map((f) => `js/${f}`),
    ...readdirSync(new URL('vendor/', www)).filter((f) => f.endsWith('.mjs')).map((f) => `vendor/${f}`),
    ...readdirSync(new URL('icons/', www)).map((f) => `icons/${f}`)];
  const missing = want.filter((f) => !cached.has(f));
  assert.deepEqual(missing, [], `add these to FILES in www/sw.js (and bump VERSION): ${missing.join(', ')}`);
});
