// The wiki inside the store app, end to end through the on-device API: index, class, spells, species, a character.
// The wiki is a fake that serves the sample pages (the PC app's tests use the same pages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';
import { createApi } from '../www/js/api.js';
import { memoryStore } from '../www/js/store.js';
import { setHtmlParser } from '../www/js/wikiparse.js';

setHtmlParser((html) => parseHTML(html).document);
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const srd = read('../www/data/srd-2014.json');
const creaturesDoc = read('../www/data/creatures.json');
const { pages: P } = read('./fixtures/wiki.json');
const LIST_PAGE = P['pc.RACE'].replace(/<div id="page-content">[\s\S]*<\/div>\s*<div class="page-tags">/,
  '<div id="page-content"><h1>Common</h1><p><a href="/lineage:dwarf">Dwarf</a></p><h1>Unearthed Arcana</h1>'
  + '<p><a href="/lineage:glitchling-ua">Glitchling</a></p></div><div class="page-tags">');
const PAGES = { '/': P['pc.INDEX'], '/lineage': LIST_PAGE, '/spells:wizard': P['pc.SPELL_LIST'], '/spell:fireball': P['pc.SPELL'],
  '/wizard': P['pc.CLASS'], '/wizard:evocation': P['pc.SUBCLASS'], '/lineage:dwarf': P['pc.RACE'],
  '/background:acolyte': P['pc.BACKGROUND'], '/feat:alert': P['pc.FEAT'], '/feat:tough': P['pc.FEAT2'],
  '/wondrous-items': P['sample.MAGIC_ITEMS'], '/wondrous-items:cloak-of-protection': P['sample.ITEM_CLOAK'] };

function fakeWiki() {
  const fetched = [];
  const transport = async (url) => {
    const path = url.replace('https://dnd5e.wikidot.com', '');
    fetched.push(path);
    return PAGES[path] ? { status: 200, text: PAGES[path] } : { status: 404, text: '' };
  };
  return { transport, fetched };
}
const start = async (opts = {}) => {
  const store = memoryStore();
  const api = await createApi(store, structuredClone(srd), { creaturesDoc, ...opts });
  await api.request('/api/settings', { json: { wiki_delay_seconds: 0.5 } });
  return { ...api, store };
};
const names = (es) => es.map((e) => e.name);

test('without the store app the wiki is off and says why', async () => {
  const { request } = await start();
  assert.equal((await request('/api/status')).config.wiki_available, false);
  await assert.rejects(request('/api/wiki/sync', { method: 'POST' }), /app store/);
  // and nothing else waits on it
  assert.ok((await request('/api/entries?kind=spell')).entries.length > 300);
});

test('index, class, subclass, spells and species download and read like on the PC', { timeout: 60000 }, async () => {
  const wiki = fakeWiki();
  const { request } = await start({ wikiTransport: wiki.transport });
  assert.equal((await request('/api/status')).config.wiki_available, true);
  const r = await request('/api/wiki/sync', { method: 'POST' });
  assert.deepEqual(r.errors, []);
  assert.ok(r.counts.class >= 2 && r.counts.race >= 2, JSON.stringify(r.counts));

  const races = (await request('/api/entries?kind=race')).entries;
  const dwarves = races.filter((e) => e.name === 'Dwarf');
  assert.equal(dwarves.length, 1);                       // the wiki's Dwarf takes the SRD one's place
  assert.equal(dwarves[0].source, 'wiki');
  assert.ok(!names(races).includes('Glitchling'));       // UA hidden by default
  assert.ok(names((await request('/api/entries?kind=race&all=1')).entries).includes('Glitchling'));

  const wizard = (await request('/api/entries?kind=class')).entries.find((e) => e.name === 'Wizard' && e.source === 'wiki');
  const detail = (await request(`/api/entries/${wizard.id}`)).entry;
  assert.equal(detail.rules.hit_die, 6);
  assert.equal(detail.data._v, 6);
  const subs = (await request('/api/classes/wizard/subclasses')).entries;
  assert.ok(names(subs).includes('School of Evocation'), names(subs).join());
  const spells = (await request('/api/classes/wizard/spells?max=1')).spells;
  assert.deepEqual(names(spells), ['Fire Bolt', 'Detect Magic', 'Magic Missile']);

  const sel = (await request(`/api/entries/${dwarves[0].id}`)).entry.selections;
  assert.deepEqual(sel[0].subraces, ['Hill Dwarf', 'Mountain Dwarf']);
  const bg = (await request('/api/entries?kind=background&q=acolyte')).entries.find((e) => e.source === 'wiki');
  const evo = subs.find((s) => s.path.includes('wizard:evocation'));

  const { character: char } = await request('/api/characters/new');
  Object.assign(char, { name: 'Brina Stonequill', race: { id: dwarves[0].id, name: 'Dwarf', variant: "Player's Handbook", subrace: 'Hill Dwarf' },
    race_bonus: { str: 0, dex: 0, con: 2, int: 0, wis: 1, cha: 0 },
    classes: [{ id: wizard.id, name: 'Wizard', slug: 'wizard', level: 3, subclass: { id: evo.id, name: evo.name, path: evo.path } }],
    background: { id: bg.id, name: bg.name }, base_scores: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 8 },
    skills: ['Arcana', 'History'],
    spells: [{ id: spells[0].id, name: 'Fire Bolt', level: 0, class: 'wizard' }, { id: spells[2].id, name: 'Magic Missile', level: 1, class: 'wizard' }] });
  const { sheet } = await request('/api/compute', { json: { character: char } });
  assert.equal(sheet.hp_max, 9 + 2 * 7 + 3);
  assert.deepEqual(sheet.slots.slice(0, 2), [4, 2]);
  assert.equal(sheet.spells['1'][0].range, '120 feet');   // the spell's own page was read for the sheet
  assert.ok(names(sheet.features).includes('Shelter of the Faithful'));

  // pages are kept: opening them again doesn't download them again
  const before = wiki.fetched.length;
  await request(`/api/entries/${wizard.id}`);
  await request('/api/classes/wizard/spells');
  assert.equal(wiki.fetched.length, before);
  assert.ok((await request('/api/status')).library.pages_cached >= 5);
  // ...unless asked to
  await request(`/api/entries/${wizard.id}?refresh=1`);
  assert.equal(wiki.fetched.length, before + 1);
});

test('magic items come from the wiki list, with effects read from their pages', { timeout: 60000 }, async () => {
  const wiki = fakeWiki();
  const { request } = await start({ wikiTransport: wiki.transport });
  assert.equal((await request('/api/wiki/magic-items', { method: 'POST' })).count, 8);
  const items = (await request('/api/magic-items')).items;
  assert.ok(!names(items).includes('Fancy Hat') && !names(items).includes('Arcane Grenade (UA)'));
  const cloak = items.find((i) => i.name === 'Cloak of Protection');
  assert.equal(cloak.attunement, true);
  const { item } = await request('/api/gear/from-entry', { json: { id: cloak.id } });
  assert.deepEqual(item.effects.map((e) => e.type), ['ac', 'save']);
});

test('a page the wiki doesn’t have is a clear error, not a crash', { timeout: 60000 }, async () => {
  const wiki = fakeWiki();
  const { request } = await start({ wikiTransport: wiki.transport });
  await request('/api/wiki/sync', { method: 'POST' });
  const human = (await request('/api/entries?kind=race')).entries.find((e) => e.name === 'Human' && e.source === 'wiki');
  await assert.rejects(request(`/api/entries/${human.id}`), /no page at \/lineage:human/);
});
