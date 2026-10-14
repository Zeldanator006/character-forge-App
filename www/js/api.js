/* The app's API, answered on the device. The interface calls the same paths the PC app's
   Flask server answered (see the PC repo's app/server.py); here each one is a function. */
import { compute } from './rules.js';
import { ABILITIES, ALIGNMENTS, ARMOR, CLASS_RULES, POINT_BUY_COST, SKILLS, STANDARD_ARRAY, WEAPONS } from './srd.js';
import { Library, raceSelection, classRules } from './library.js';

export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function newCharacter() {
  const zero = () => Object.fromEntries(ABILITIES.map((a) => [a, 0]));
  return {
    name: '', player: '', alignment: '', xp: 0,
    race: {}, race_bonus: zero(), classes: [], background: {},
    ability_method: 'point_buy', base_scores: Object.fromEntries(ABILITIES.map((a) => [a, 8])),
    improvements: zero(), feats: [], skills: [], expertise: [], tools: '', languages: '',
    hp_mode: 'average', hp_rolls: [], hp_bonus: 0,
    armor: '', shield: false, weapons: [], equipment: '',
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    spells: [], personality: { personality_traits: '', ideals: '', bonds: '', flaws: '' },
    backstory: '', appearance: '', extra_features: [], notes: '',
  };
}

const SETTINGS_DEFAULTS = { show_unearthed_arcana: false, show_homebrew: false };
const now = () => Date.now() / 1000;
const summaryOf = (c) => {
  const classes = (c.data.classes || []).map((k) => `${k.name || '?'} ${k.level || 1}`).join(', ');
  return [((c.data.race || {}).name) || '', classes].filter(Boolean).join(' · ');
};

export async function createApi(store, srdDoc) {
  const lib = new Library(store, srdDoc.entries);
  await lib.load();

  const settings = async () => ({ ...SETTINGS_DEFAULTS, ...(((await store.get('settings', 'app')) || {}).value || {}) });
  const tags = async (q) => {
    if (q.get('all') === '1') return ['ua', 'homebrew'];
    const s = await settings();
    return [s.show_unearthed_arcana && 'ua', s.show_homebrew && 'homebrew'].filter(Boolean);
  };
  const getChar = async (id) => {
    const row = await store.get('characters', Number(id));
    if (!row) throw new ApiError('Not found', 404);
    return { ...row.data, id: row.id };
  };
  const saveChar = async (data, id = null) => {
    const { id: _drop, ...clean } = data || {};
    const row = { name: (clean.name || '').trim() || 'Unnamed', data: clean, updated: now() };
    if (id != null) row.id = Number(id);
    return store.put('characters', row);
  };

  // [method, pattern, handler(params, query, body)]
  const routes = [
    ['GET', '/api/status', async () => ({
      config: { ...(await settings()), api_key_set: false, models: [] }, library: lib.status(), pdfs: 0, template: null,
    })],
    ['POST', '/api/settings', async (p, q, body) => {
      const s = await settings();
      for (const k of Object.keys(SETTINGS_DEFAULTS)) if (k in body) s[k] = Boolean(body[k]);
      await store.put('settings', { id: 'app', value: s });
      return { config: s };
    }],
    ['GET', '/api/srd', async () => ({
      skills: SKILLS,
      armor: Object.fromEntries(Object.entries(ARMOR).map(([k, v]) => [k, { category: v[0], base: v[1] }])),
      weapons: Object.fromEntries(Object.entries(WEAPONS).map(([k, v]) => [k, { category: v[0], ranged: v[1], damage: v[2], type: v[3], properties: v[4] }])),
      alignments: ALIGNMENTS, point_buy: POINT_BUY_COST, standard_array: STANDARD_ARRAY,
      classes: Object.fromEntries(Object.entries(CLASS_RULES).map(([k, v]) => [k, { name: v.name, subclass_level: v.subclass_level, caster: v.caster }])),
    })],

    ['GET', '/api/entries', async (p, q) => ({
      entries: lib.list({ kind: q.get('kind') || null, parent: q.get('parent') || null, query: q.get('q') || '',
        includeTags: await tags(q), limit: Number(q.get('limit') || 2000) }),
    })],
    ['GET', '/api/entries/:id', async ({ id }) => {
      const found = lib.get(id);
      if (!found) throw new ApiError('Not found', 404);
      const { _words, ...e } = structuredClone({ ...found, _words: undefined });
      if (e.kind === 'race') {
        e.selections = (e.data.variants || []).map((v) => ({ variant: v.source, subraces: (v.subraces || []).map((s) => s.name) }));
      }
      if (e.kind === 'class') e.rules = classRules(e);
      return { entry: e };
    }],
    ['GET', '/api/race/:id/selection', async ({ id }, q) => ({
      selection: raceSelection(lib.get(id), q.get('variant') || null, q.get('subrace') || null),
    })],
    ['POST', '/api/entries', async (p, q, d) => {
      if (!d.name || !d.kind) throw new ApiError('kind and name are required');
      return { id: await lib.add({ ...d, source: d.source || 'custom' }) };
    }],
    ['DELETE', '/api/entries/:id', async ({ id }) => { await lib.remove(id); return { ok: true }; }],
    ['GET', '/api/classes/:slug/spells', async ({ slug }, q) => ({
      spells: lib.classSpells(slug, await tags(q), Number(q.get('max') ?? 9)),
    })],
    ['GET', '/api/classes/:slug/subclasses', async ({ slug }, q) => ({ entries: lib.subclassesFor(slug, await tags(q)) })],

    ['GET', '/api/characters', async () => {
      const rows = await store.all('characters');
      rows.sort((a, b) => b.updated - a.updated);
      return { characters: rows.map((r) => ({ id: r.id, name: r.name || 'Unnamed', updated: r.updated, summary: summaryOf(r) })) };
    }],
    ['GET', '/api/characters/new', async () => ({ character: newCharacter() })],
    ['POST', '/api/characters', async (p, q, body) => ({ id: await saveChar(body.character || newCharacter()) })],
    ['GET', '/api/characters/:id', async ({ id }) => ({ character: await getChar(id) })],
    ['PUT', '/api/characters/:id', async ({ id }, q, body) => {
      await getChar(id);
      await saveChar(body.character || {}, id);
      return { ok: true };
    }],
    ['DELETE', '/api/characters/:id', async ({ id }) => { await store.delete('characters', Number(id)); return { ok: true }; }],
    ['GET', '/api/characters/:id/export', async ({ id }) => ({ character: await getChar(id) })],
    ['POST', '/api/compute', async (p, q, body) => {
      const char = body.character || {};
      return { sheet: compute(char, lib.buildContext(char)) };
    }],
  ].map(([method, pattern, fn]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    return { method, re, keys, fn };
  });

  /** fetch()-like entry point: request(path, {method, json}) -> data, or throws ApiError. */
  async function request(url, opts = {}) {
    const method = (opts.method || (opts.json !== undefined ? 'POST' : 'GET')).toUpperCase();
    const [path, qs = ''] = url.split('?');
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const data = await r.fn(params, new URLSearchParams(qs), opts.json || {});
      return structuredClone(data);
    }
    throw new ApiError(`This version of the app can’t do that yet (${method} ${path}).`, 404);
  }

  return { request, library: lib };
}
