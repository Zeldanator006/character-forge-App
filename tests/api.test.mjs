// End to end through the on-device API, with the built-in SRD and an in-memory store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../www/js/api.js';
import { memoryStore } from '../www/js/store.js';

const srd = JSON.parse(readFileSync(new URL('../www/data/srd-2014.json', import.meta.url), 'utf8'));
const fresh = () => createApi(memoryStore(), structuredClone(srd));

test('built-in library lists the SRD', async () => {
  const { request } = await fresh();
  const races = (await request('/api/entries?kind=race')).entries.map((e) => e.name);
  assert.deepEqual(races, ['Dragonborn', 'Dwarf', 'Elf', 'Gnome', 'Half-Elf', 'Half-Orc', 'Halfling', 'Human', 'Tiefling']);
  assert.equal((await request('/api/entries?kind=class')).entries.length, 12);
  const st = await request('/api/status');
  assert.equal(st.library.kinds.spell.srd, 319);
  const hits = (await request('/api/entries?q=magic%20miss')).entries.map((e) => e.name);
  assert.ok(hits.includes('Magic Missile'), hits.join());
});

test('a level 3 hill dwarf evoker comes out right', async () => {
  const { request } = await fresh();
  const find = async (kind, name) => (await request(`/api/entries?kind=${kind}`)).entries.find((e) => e.name === name);
  const dwarf = await find('race', 'Dwarf');
  const race = (await request(`/api/entries/${dwarf.id}`)).entry;
  assert.deepEqual(race.selections, [{ variant: 'SRD 5.1', subraces: ['Hill Dwarf'] }]);
  const sel = (await request(`/api/race/${dwarf.id}/selection?variant=SRD%205.1&subrace=Hill%20Dwarf`)).selection;
  assert.deepEqual(sel.analysis.asi, { con: 2, wis: 1 });
  assert.equal(sel.analysis.hp_per_level, 1);
  assert.equal(sel.analysis.speed, 25);
  assert.equal(sel.analysis.darkvision, 60);

  const wizard = await find('class', 'Wizard');
  const detail = (await request(`/api/entries/${wizard.id}`)).entry;
  assert.equal(detail.rules.hit_die, 6);
  assert.equal(detail.rules.slug, 'wizard');
  const subs = (await request('/api/classes/wizard/subclasses')).entries;
  assert.deepEqual(subs.map((s) => s.name), ['Evocation']);
  const spells = (await request('/api/classes/wizard/spells?max=1')).spells;
  assert.ok(spells.every((s) => s.level <= 1));
  assert.ok(spells.some((s) => s.name === 'Fire Bolt') && spells.some((s) => s.name === 'Magic Missile'));
  const fireBolt = spells.find((s) => s.name === 'Fire Bolt');
  const missile = spells.find((s) => s.name === 'Magic Missile');
  const acolyte = await find('background', 'Acolyte');

  const { character } = await request('/api/characters/new');
  Object.assign(character, {
    name: 'Brina Stonequill',
    race: { id: dwarf.id, name: 'Dwarf', variant: 'SRD 5.1', subrace: 'Hill Dwarf' },
    race_bonus: { str: 0, dex: 0, con: 2, int: 0, wis: 1, cha: 0 },
    classes: [{ id: wizard.id, name: 'Wizard', slug: 'wizard', level: 3,
      subclass: { id: subs[0].id, name: subs[0].name, path: subs[0].path } }],
    background: { id: acolyte.id, name: 'Acolyte' },
    base_scores: { str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 8 },
    skills: ['Arcana', 'History'], weapons: ['Quarterstaff', 'Dagger'],
    spells: [{ id: fireBolt.id, name: 'Fire Bolt', level: 0, class: 'wizard' },
      { id: missile.id, name: 'Magic Missile', level: 1, class: 'wizard' }],
  });
  const { id } = await request('/api/characters', { json: { character } });
  const { sheet } = await request('/api/compute', { json: { character } });
  assert.equal(sheet.hp_max, 9 + 2 * 7 + 3);          // 6+3 at 1st, 4+3 after, dwarven toughness
  assert.equal(sheet.ac, 12);
  assert.equal(sheet.speed, 25);
  assert.equal(sheet.spellcasting[0].dc, 12);            // 8 + prof 2 + Int 15 (+2)
  assert.deepEqual(sheet.slots.slice(0, 3), [4, 2, 0]);
  assert.equal(sheet.spellcasting[0].cantrips_known, 3);
  assert.ok(sheet.skills.find((s) => s.name === 'Insight').prof === 'proficient');   // from Acolyte
  assert.ok(sheet.features.some((f) => f.name === 'Arcane Recovery'));
  assert.ok(sheet.features.some((f) => f.name === 'Evocation Savant'));
  assert.ok(sheet.features.some((f) => f.name === 'Shelter of the Faithful'));
  assert.equal(sheet.spells['1'][0].school, 'Evocation');
  assert.deepEqual(sheet.warnings, []);

  const list = (await request('/api/characters')).characters;
  assert.equal(list[0].name, 'Brina Stonequill');
  assert.equal(list[0].summary, 'Dwarf · Wizard 3');
  character.name = 'Brina';
  await request(`/api/characters/${id}`, { method: 'PUT', json: { character } });
  assert.equal((await request(`/api/characters/${id}`)).character.name, 'Brina');
  await request(`/api/characters/${id}`, { method: 'DELETE' });
  assert.equal((await request('/api/characters')).characters.length, 0);
  await assert.rejects(request(`/api/characters/${id}`), /Not found/);
});

test('your own entries can be added, found and deleted; built-in ones can’t be deleted', async () => {
  const { request } = await fresh();
  const { id } = await request('/api/entries', { json: { kind: 'spell', name: 'Glitter Bolt',
    data: { description: 'Sparkles everywhere.', level: 1, classes: ['Wizard'] } } });
  assert.ok(id < 1_000_000_000);
  assert.ok((await request('/api/classes/wizard/spells?max=1')).spells.some((s) => s.name === 'Glitter Bolt'));
  assert.ok((await request('/api/entries?q=sparkles')).entries.some((e) => e.id === id));
  await request(`/api/entries/${id}`, { method: 'DELETE' });
  assert.equal((await request('/api/entries?q=glitter%20bolt')).entries.length, 0);
  const fb = (await request('/api/entries?kind=spell&q=fire%20bolt')).entries[0];
  await assert.rejects(request(`/api/entries/${fb.id}`, { method: 'DELETE' }), /can’t be deleted/);
});

test('SRD ids are stable numbers', () => {
  const ids = srd.entries.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((n) => Number.isInteger(n) && n >= 1_000_000_000));
  const wizard = srd.entries.find((e) => e.kind === 'class' && e.name === 'Wizard');
  assert.equal(wizard.id, 1_000_000_000 + (fnv('class|/wizard') % 1_000_000_000));
});

function fnv(s) {
  let h = 2166136261;
  for (const ch of new TextEncoder().encode(s)) h = Math.imul(h ^ ch, 16777619) >>> 0;
  return h;
}

test('search lists name matches before entries that only mention the words', async () => {
  const { request } = await fresh();
  const names = (await request('/api/entries?q=fireball')).entries.map((e) => e.name);
  assert.equal(names[0], 'Fireball');
  assert.ok(names.length > 1);
});

test('a library exported from the PC imports, replaces SRD duplicates, re-imports in place and can be removed', async () => {
  const { request } = await fresh();
  const wizardSrd = (await request('/api/entries?kind=class')).entries.find((e) => e.name === 'Wizard');
  const doc = {
    app: 'character-forge-library', version: 1,
    entries: [
      { kind: 'class', name: 'Wizard', source: 'wiki', path: '/wizard', parent: '', group: '', tags: [],
        data: { slug: 'wizard', hit_die: 6, features: [{ name: 'Arcane Recovery', level: 1, text: 'From the wiki.' }] } },
      { kind: 'subclass', name: 'School of Illusion', source: 'wiki', path: '/wizard:illusion', parent: 'wizard', group: '', tags: [], data: {} },
      { kind: 'spell-list', name: 'Wizard Spells', source: 'wiki', path: '/spells:wizard', parent: 'wizard', group: '', tags: [],
        data: { spells: [{ path: '/spell:minor-illusion', name: 'Minor Illusion', level: 0 }] } },
      { kind: 'spell', name: 'Minor Illusion', source: 'wiki', path: '/spell:minor-illusion', parent: '', group: '', tags: [],
        data: { level: 0, school: 'Illusion', classes: ['Wizard'] } },
    ],
  };
  const r = await request('/api/library/import', { json: doc });
  assert.deepEqual([r.added, r.updated], [4, 0]);
  const wizards = (await request('/api/entries?kind=class')).entries.filter((e) => e.name === 'Wizard');
  assert.equal(wizards.length, 1);
  assert.equal(wizards[0].source, 'wiki');
  assert.equal((await request(`/api/entries/${wizardSrd.id}`)).entry.source, 'srd');   // old characters still resolve
  const subs = (await request('/api/classes/wizard/subclasses')).entries.map((s) => s.name);
  assert.ok(subs.includes('School of Illusion') && subs.includes('Evocation'), subs.join());
  const spells = (await request('/api/classes/wizard/spells?max=0')).spells.map((s) => s.name);
  assert.deepEqual(spells, ['Minor Illusion']);
  assert.equal((await request('/api/status')).library.imported, 4);

  const again = await request('/api/library/import', { json: doc });
  assert.deepEqual([again.added, again.updated], [0, 4]);
  assert.equal((await request('/api/status')).library.imported, 4);

  await assert.rejects(request('/api/library/import', { json: { app: 'character-forge', entries: [] } }), /library export/);
  assert.equal((await request('/api/library/clear-imported', { method: 'POST' })).removed, 4);
  assert.equal((await request('/api/entries?kind=class')).entries.find((e) => e.name === 'Wizard').source, 'srd');
});
