/* The app's API, answered on the device. The interface calls the same paths the PC app's
   Flask server answered (see the PC repo's app/server.py); here each one is a function. */
import { compute } from './rules.js';
import { ABILITIES, ALIGNMENTS, ARMOR, CLASS_RULES, POINT_BUY_COST, SKILLS, STANDARD_ARRAY, WEAPONS } from './srd.js';
import { Library, raceSelection, classRules } from './library.js';
import { Pdfs } from './pdfs.js';
import { DEFAULT_MODEL, MODELS, makeClaude } from './claude.js';
import * as creatures from './creatures.js';
import { spellEffect } from './dice.js';

export class ApiError extends Error {
  /** data: extra fields sent back with the error (a refused save returns the newer character). */
  constructor(message, status = 400, data = null) { super(message); this.status = status; this.data = data; }
}

export function newCharacter() {
  const zero = () => Object.fromEntries(ABILITIES.map((a) => [a, 0]));
  return {
    name: '', player: '', alignment: '', xp: 0,
    race: {}, race_bonus: zero(), classes: [], background: {},
    ability_method: 'point_buy', base_scores: Object.fromEntries(ABILITIES.map((a) => [a, 8])),
    improvements: zero(), feats: [], skills: [], race_skills: [], bg_skills: [], expertise: [], tools: '', languages: '',
    hp_mode: 'average', hp_rolls: [], hp_bonus: 0,
    armor: '', shield: false, weapons: [], equipment: '', inventory: [], unarmed: false,
    coins: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    spells: [], personality: { personality_traits: '', ideals: '', bonds: '', flaws: '' },
    backstory: '', appearance: '', extra_features: [], notes: '',
  };
}

/** A blank hand-written sheet (the PC app's claude_ai.new_manual). */
export function newManual() {
  return {
    class_text: '', level: 1, race_text: '', background_text: '', save_profs: [], jack: false,
    ac: '', ac_note: '', hp_max: '', speed: '30', hit_dice: '', init_bonus: 0, passive_bonus: 0,
    prof_override: '', attacks: [], spell_ability: '', spell_class: '', slots: Array(9).fill(0),
    pact_count: 0, pact_level: 0, proficiencies: '', size: '', darkvision: '',
    lucky: false, reliable_talent: false, crit_range: 20, extra_crit_dice: 0, riders: [],
  };
}

// The parts of a saved character the rest of the app relies on, and the type each must have when present.
const CHARACTER_SHAPE = { race: 'object', background: 'object', classes: 'array', base_scores: 'object', race_bonus: 'object',
  improvements: 'object', feats: 'array', spells: 'array', skills: 'array', inventory: 'array', coins: 'object',
  personality: 'object', manual: 'object' };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** Why this isn't a character the app can open (an Import of the wrong file), or null. */
export function characterProblem(data) {
  if (!isObj(data)) return 'That file isn’t a character from Character Forge.';
  for (const [k, kind] of Object.entries(CHARACTER_SHAPE)) {
    if (data[k] == null) continue;
    if (kind === 'array' ? !Array.isArray(data[k]) : !isObj(data[k])) {
      return `That file isn’t a character from Character Forge (its "${k}" doesn’t look right).`;
    }
  }
  if ((data.classes || []).some((c) => !isObj(c))) return 'That file isn’t a character from Character Forge (its classes don’t look right).';
  return null;
}

const THEME_DEFAULT = { mode: 'light', light: 'graph-paper', dark: 'midnight',
  custom: { paper: '#eef1f4', panel: '#ffffff', ink: '#1f2329', accent: '#7a3fb0' } };
/** The PC app's config.clean_theme: only known modes, preset names and #rrggbb colors get through. */
function cleanTheme(theme) {
  const base = structuredClone(THEME_DEFAULT);
  if (['light', 'dark', 'system'].includes(theme.mode)) base.mode = theme.mode;
  for (const slot of ['light', 'dark']) if (typeof theme[slot] === 'string' && /^[a-z0-9-]{1,40}$/.test(theme[slot])) base[slot] = theme[slot];
  for (const [k, v] of Object.entries(theme.custom || {})) {
    if (k in base.custom && typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)) base.custom[k] = v.toLowerCase();
  }
  return base;
}

const SETTINGS_DEFAULTS = { show_unearthed_arcana: false, show_homebrew: false, anthropic_api_key: '', model: DEFAULT_MODEL,
  theme: THEME_DEFAULT };
const now = () => Date.now() / 1000;
const summaryOf = (c) => {
  const classes = (c.data.classes || []).map((k) => `${k.name || '?'} ${k.level || 1}`).join(', ');
  return [((c.data.race || {}).name) || '', classes].filter(Boolean).join(' · ');
};

export async function createApi(store, srdDoc, { extractPdf, creaturesDoc } = {}) {
  // stat blocks for companions and Wild Shape (SRD 5.1); tests hand them in, the app fetches them
  if (creaturesDoc) creatures.setCreatures(creaturesDoc);
  else await creatures.loadCreatures();
  const lib = new Library(store, srdDoc.entries);
  await lib.load();
  const pdfs = new Pdfs(store, extractPdf);
  const claude = makeClaude({ lib, pdfs });

  const settings = async () => ({ ...SETTINGS_DEFAULTS, ...(((await store.get('settings', 'app')) || {}).value || {}) });
  /** Settings safe to show in the interface: never the key itself. */
  const publicSettings = (s) => {
    const { anthropic_api_key: key, ...rest } = s;
    return { ...rest, api_key_set: Boolean(key), api_key_hint: key.length > 8 ? `…${key.slice(-4)}` : '', models: MODELS };
  };
  const claudeConfig = async () => { const s = await settings(); return { apiKey: s.anthropic_api_key, model: s.model }; };
  const level = (v) => Math.max(1, Math.min(20, parseInt(v, 10) || 1));
  const requireConcept = (d) => {
    if (!(d.concept || '').trim()) throw new ApiError('Describe the character first.');
    return d.concept.trim();
  };
  const saveEntries = async (entries) => {
    const ids = [];
    for (const e of entries || []) if (e && e.name) ids.push(await lib.add(e));
    return ids;
  };
  const entryCounts = () => {
    const counts = {};
    for (const e of lib.entries) if (e.source.startsWith('pdf:')) counts[e.source] = (counts[e.source] || 0) + 1;
    return counts;
  };
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
  /** A character's version is when it was last saved; a save based on an older one is refused. */
  const charVersion = async (id) => {
    const row = await store.get('characters', Number(id));
    if (!row) throw new ApiError('Not found', 404);
    return row.updated;
  };
  const checkShape = (data) => {
    const problem = characterProblem(data);
    if (problem) throw new ApiError(problem);
    return data;
  };

  // [method, pattern, handler(params, query, body)]
  const routes = [
    ['GET', '/api/status', async () => ({
      config: publicSettings(await settings()), library: { ...lib.status(), imported: lib.importedCount() }, pdfs: (await store.all('pdfs')).length, template: null,
    })],
    ['POST', '/api/settings', async (p, q, body) => {
      const s = await settings();
      for (const k of ['show_unearthed_arcana', 'show_homebrew']) if (k in body) s[k] = Boolean(body[k]);
      if (body.anthropic_api_key) s.anthropic_api_key = String(body.anthropic_api_key).trim();
      if (body.clear_api_key) s.anthropic_api_key = '';
      if (body.model && MODELS.includes(body.model)) s.model = body.model;
      if (isObj(body.theme)) s.theme = cleanTheme(body.theme);
      await store.put('settings', { id: 'app', value: s });
      return { config: publicSettings(s) };
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
    ['POST', '/api/library/import', async (p, q, doc) => lib.importLibrary(doc)],
    ['POST', '/api/library/clear-imported', async () => ({ removed: await lib.clearImported() })],
    ['GET', '/api/classes/:slug/spells', async ({ slug }, q) => ({
      spells: lib.classSpells(slug, await tags(q), Number(q.get('max') ?? 9)),
    })],
    ['GET', '/api/spells', async (p, q) => ({ spells: lib.allSpells(await tags(q), Number(q.get('max') ?? 9)) })],
    ['GET', '/api/spell-effect/:id', async ({ id }, q) => {
      const e = lib.get(id);
      if (!e || e.kind !== 'spell') throw new ApiError('Not a spell', 404);
      return { effect: spellEffect(e.data, parseInt(q.get('level') || '1', 10) || 1) };
    }],
    ['POST', '/api/class-options', async (p, q, d) => ({ groups: lib.classOptionGroups(d.character || {}, await tags(q)) })],
    ['GET', '/api/magic-items', async (p, q) => ({ items: lib.magicItems(await tags(q)) })],
    ['POST', '/api/creatures/search', async (p, q, d) => ({
      creatures: creatures.search(d.q || '', d.mode in creatures.MODES ? d.mode : 'any', d.info || {}),
      source: 'SRD 5.1 (CC-BY-4.0)',
    })],
    ['GET', '/api/creatures/:name', async ({ name }) => {
      const c = creatures.byName(name);
      if (!c) throw new ApiError(`No creature called ${name}`, 404);
      return { creature: creatures.full(c) };
    }],
    ['GET', '/api/classes/:slug/subclasses', async ({ slug }, q) => ({ entries: lib.subclassesFor(slug, await tags(q)) })],

    ['GET', '/api/characters', async () => {
      const rows = await store.all('characters');
      rows.sort((a, b) => b.updated - a.updated);
      return { characters: rows.map((r) => ({ id: r.id, name: r.name || 'Unnamed', updated: r.updated, summary: summaryOf(r) })) };
    }],
    ['GET', '/api/characters/new', async (p, q) => {
      const character = newCharacter();
      if (q.get('mode') === 'manual') {
        Object.assign(character, { mode: 'manual', ability_method: 'manual', manual: newManual(),
          base_scores: Object.fromEntries(Object.keys(character.base_scores).map((a) => [a, 10])) });
      }
      return { character };
    }],
    ['POST', '/api/characters', async (p, q, body) => ({ id: await saveChar(checkShape(body.character || newCharacter())) })],
    ['GET', '/api/characters/:id', async ({ id }) => {
      const character = await getChar(id);
      ensureInventory(character);
      return { character, version: await charVersion(id) };
    }],
    ['GET', '/api/characters/:id/version', async ({ id }) => ({ version: await charVersion(id) })],
    ['PUT', '/api/characters/:id', async ({ id }, q, body) => {
      const data = checkShape(body.character || {});
      const current = await charVersion(id);
      if (body.version != null && Math.abs(Number(body.version) - current) > 1e-6) {
        throw new ApiError('This character was changed in another window.', 409, { character: await getChar(id), version: current });
      }
      await saveChar(data, id);
      return { ok: true, version: await charVersion(id) };
    }],
    ['DELETE', '/api/characters/:id', async ({ id }) => { await store.delete('characters', Number(id)); return { ok: true }; }],
    ['GET', '/api/characters/:id/export', async ({ id }) => ({ character: await getChar(id) })],
    ['POST', '/api/compute', async (p, q, body) => {
      const char = body.character || {};
      return { sheet: compute(char, lib.buildContext(char)) };
    }],
    ['POST', '/api/entries/bulk', async (p, q, body) => ({ ids: await saveEntries(body.entries) })],

    // ---------------------------------------------------------- your PDFs
    ['GET', '/api/pdfs', async () => ({ pdfs: await pdfs.list(entryCounts()) })],
    ['POST', '/api/pdfs', async (p, q, body, files) => {
      if (!files || !files.length) throw new ApiError('No file received');
      const results = [];
      for (const f of files) {
        if (!/\.pdf$/i.test(f.name || '')) { results.push({ filename: f.name, error: 'Not a PDF' }); continue; }
        try { results.push(await pdfs.ingest(f)); } catch (e) { results.push({ filename: f.name, error: e.message }); }
      }
      return { results };
    }],
    ['DELETE', '/api/pdfs/:id', async ({ id }, q) => {
      const gone = await pdfs.remove(id);
      if (gone && q.get('keep_entries') !== '1') {
        for (const e of lib.entries.filter((x) => x.source === `pdf:${gone.filename}`)) await lib.remove(e.id);
      }
      return { ok: Boolean(gone) };
    }],
    ['GET', '/api/pdfs/search', async (p, q) => ({ results: await pdfs.search(q.get('q') || '') })],
    ['GET', '/api/pdfs/:id/pages', async ({ id }, q) => {
      const start = parseInt(q.get('start') || '1', 10);
      return { text: await pdfs.pageRangeText(id, start, parseInt(q.get('end') || String(start), 10)) };
    }],
    ['GET', '/api/pdfs/:id/file', async ({ id }) => {
      const blob = await pdfs.file(id);
      if (!blob) throw new ApiError('Not found', 404);
      return { blob };
    }],
    ['POST', '/api/pdfs/:id/extract/prompt', async ({ id }, q, d) => ({
      prompt: await claude.extractPrompt(id, parseInt(d.start, 10) || 1, parseInt(d.end, 10) || 1, d.kind || 'spell'),
    })],
    ['POST', '/api/pdfs/:id/extract/reply', async ({ id }, q, d) => claude.extractFromReply(id, d.kind || 'spell', d.reply || '')],
    ['POST', '/api/pdfs/:id/extract', async ({ id }, q, d) => claude.extract(await claudeConfig(), id,
      parseInt(d.start, 10) || 1, parseInt(d.end, 10) || 1, d.kind || 'spell')],

    // ---------------------------------------------------------- drafting with Claude
    ['POST', '/api/claude/draft', async (p, q, d) => claude.draft(await claudeConfig(), requireConcept(d), level(d.level),
      await tags(q), newCharacter)],
    ['POST', '/api/claude/chat/draft-prompt', async (p, q, d) => ({
      prompt: await claude.draftPrompt1(requireConcept(d), level(d.level), await tags(q)),
    })],
    ['POST', '/api/claude/chat/draft-reply-1', async (p, q, d) => claude.draftReply1((d.concept || '').trim(), d.reply || '',
      await tags(q), newCharacter)],
    ['POST', '/api/claude/chat/draft-reply-2', async (p, q, d) => claude.draftReply2(d.character || {}, d.reply || '',
      d.warnings, d.summary || '')],
  ].map(([method, pattern, fn]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (m, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    return { method, re, keys, fn };
  });

  /** fetch()-like entry point: request(path, {method, json, files}) -> data, or throws ApiError. */
  async function request(url, opts = {}) {
    const method = (opts.method || (opts.json !== undefined || opts.files ? 'POST' : 'GET')).toUpperCase();
    const [path, qs = ''] = url.split('?');
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = path.match(r.re);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const data = await r.fn(params, new URLSearchParams(qs), opts.json || {}, opts.files || null);
      return structuredClone(data);
    }
    throw new ApiError(`This version of the app can’t do that yet (${method} ${path}).`, 404);
  }

  return { request, library: lib, pdfs };
}
