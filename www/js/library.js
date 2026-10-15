/* The library: built-in SRD content plus entries you add, behind one interface.
   Ported from the PC app's library.py. */
import { CLASS_RULES } from './srd.js';
import { slugify } from './rules.js';
import * as classOpts from './options.js';
import { analyzeTraits } from './wikiparse.js';
import * as wikiparse from './wikiparse.js';
import { WikiError } from './wiki.js';

const HIDDEN_TAGS = ['ua', 'homebrew'];
const BUILT_IN = new Set(['srd', 'wiki']);

export { analyzeTraits, skillChoice, skillField, asiChoices } from './wikiparse.js';

export function classSlug(entry) {
  const d = entry.data || {};
  if (entry.kind === 'class' && d.slug) return d.slug;
  if (entry.kind === 'class' && entry.source === 'wiki') return entry.path.replace(/^\/+|\/+$/g, '').split('#')[0];
  return d.slug || slugify(entry.name);
}

/** Mechanics for a class: the built-in table for the 13 known classes, the entry's own data otherwise. */
export function classRules(entry) {
  const data = (entry || {}).data || {};
  const slug = entry ? classSlug(entry) : '';
  const rules = {
    name: entry ? entry.name : '', hit_die: data.hit_die || 8,
    saves: data.saves || [], skill_count: data.skill_count || 2,
    skill_options: data.skill_options || [], spell_ability: data.spell_ability ?? null,
    caster: data.caster || (data.spell_ability ? 'full' : 'none'),
    prepares: data.prepares ?? null, armor: data.armor_list || [],
    weapons: data.weapon_list || ['simple'], subclass_level: data.subclass_level || 3,
    asi_levels: (data.asi_levels && data.asi_levels.length) ? data.asi_levels : null,
  };
  if (CLASS_RULES[slug]) Object.assign(rules, structuredClone(CLASS_RULES[slug]));
  rules.slug = slug;
  return rules;
}

/** A subrace's Ability Score Increase normally adds to the species' one. It replaces it when it says so, when it's
    all "of your choice" (variant human), or when it's a whole set by itself, +2 and +1. */
function subraceReplacesAsi(subTraits) {
  for (const t of subTraits) {
    if (!t.name.toLowerCase().includes('ability score')) continue;
    const low = (t.text || '').toLowerCase();
    if (low.includes('replace') || low.includes('instead of')) return true;
    if (low.includes('of your choice') && !/(strength|dexterity|constitution|intelligence|wisdom|charisma) score/.test(low)) return true;
    if (Object.values(analyzeTraits([t]).asi).reduce((a, b) => a + b, 0) >= 3) return true;
  }
  return false;
}

export function raceSelection(entry, variantName = null, subraceName = null) {
  const variants = ((entry || {}).data || {}).variants || [];
  if (!variants.length) return { name: entry ? entry.name : '', traits: [], analysis: analyzeTraits([]) };
  const variant = variants.find((v) => v.source === variantName) || variants[0];
  let traits = [...(variant.traits || [])];
  const sub = (variant.subraces || []).find((s) => s.name === subraceName) || null;
  let replaced = null;
  if (sub) {
    const subTraits = sub.traits || [];
    if (subraceReplacesAsi(subTraits)) {
      // the subrace's own ability score increase takes the place of the base one
      replaced = traits.find((t) => t.name.toLowerCase().includes('ability score')) || null;
      traits = traits.filter((t) => t !== replaced);
    }
    traits.push(...subTraits);
  }
  const analysis = analyzeTraits(traits);
  if (replaced) analysis.asi_replaced = replaced.text;
  const fixed = variant.fixed;
  if (fixed) {  // SRD and PDF entries carry explicit numbers; trust those over reading the text
    const asi = { ...(fixed.asi || {}) };
    for (const [k, v] of Object.entries((sub || {}).asi || {})) asi[k] = (asi[k] || 0) + v;
    analysis.asi = asi;
    for (const k of ['speed', 'size', 'darkvision', 'languages']) if (fixed[k]) analysis[k] = fixed[k];
    if (fixed.skill_choices) analysis.skill_choices = fixed.skill_choices;
    if (fixed.asi_flexible) analysis.asi_flexible = true;
    analysis.skills = [...new Set([...analysis.skills, ...(fixed.skills || []), ...((sub || {}).skills || [])])].sort();
  }
  const speedText = traits.filter((t) => t.name.toLowerCase() === 'speed').map((t) => t.text).join(' ');
  return { name: entry.name, variant: variant.source, subrace: sub ? sub.name : null, traits, analysis,
    speed_text: speedText.toLowerCase() };
}

/* ---------------------------------------------------------------- search */
const words = (s) => (s || '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
function searchBody(e) {
  const d = e.data || {};
  let body = d.text || d.description || '';
  if (!body) {
    body = ['intro', 'features', 'traits', 'variants'].map((k) => {
      const v = d[k];
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return JSON.stringify(v).slice(0, 20000);
      return '';
    }).join(' ');
  }
  return `${e.name} ${body}`;
}
/** Every word must appear; the last may be the start of a word (like the PC app's full-text search). */
function matches(e, q) {
  if (!e._words) e._words = new Set(words(searchBody(e)));
  const qs = words(q);
  if (!qs.length) return false;
  const last = qs.pop();
  return qs.every((w) => e._words.has(w)) && [...e._words].some((w) => w.startsWith(last));
}
const nocase = (a, b) => {
  const x = a.name.toLowerCase(), y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};
/** Searches list entries whose name matches first, then the ones that only mention it. */
const byRelevance = (q) => {
  const qs = words(q);
  const phrase = qs.join(' ');
  const rank = (e) => {
    const n = words(e.name), name = n.join(' ');
    if (name === phrase) return 0;
    if (name.startsWith(phrase)) return 1;
    return qs.every((w, i) => n.some((x) => (i === qs.length - 1 ? x.startsWith(w) : x === w))) ? 2 : 3;
  };
  return (a, b) => (rank(a) - rank(b)) || nocase(a, b);
};
const summary = ({ _words, data, ...e }) => e;
const dupKey = (e) => `${e.kind}|${(e.parent || '').toLowerCase()}|${(e.name || '').toLowerCase()}`;
const importKey = (e) => `${e.kind}|${e.source}|${e.path}|${e.parent}|${e.name}`;
export const THIRD_CASTER_LISTS = { fighter: 'wizard', rogue: 'wizard' };  // Eldritch Knight, Arcane Trickster

/* ---------------------------------------------------------------- the library */
export class Library {
  constructor(store, builtIn = []) {
    this.store = store;
    this.builtIn = builtIn;
    this.entries = [];
    this.byId = new Map();
  }

  async load() {
    const mine = (await this.store.all('entries')).map((e) => ({ ...e, source: e.source || 'custom' }));
    // An imported wiki entry replaces the SRD one with the same name: the SRD copy stays reachable by id (characters
    // made before the import still point at it) but drops out of lists, searches and lookups.
    const wiki = new Set(mine.filter((e) => e.source === 'wiki').map(dupKey));
    this.all = [...this.builtIn, ...mine];
    this.entries = this.all.filter((e) => !(e.source === 'srd' && wiki.has(dupKey(e))));
    this.byId = new Map(this.all.map((e) => [e.id, e]));
    // wiki last, so where both have the same page path the wiki entry wins
    this.byPath = new Map([...this.entries.filter((e) => e.source === 'srd'), ...this.entries.filter((e) => e.source === 'wiki')]
      .map((e) => [`${e.kind}:${e.path}`, e]));
  }

  /** Bring in a library exported from the PC app (DND Char Builder → Library → Export library for the phone app).
      Entries already imported are updated in place, so importing a newer export again is safe. */
  async importLibrary(doc) {
    if (!doc || doc.app !== 'character-forge-library' || !Array.isArray(doc.entries)) {
      throw Object.assign(new Error('That file isn’t a library export from the PC app.'), { status: 400 });
    }
    const existing = new Map((await this.store.all('entries')).filter((e) => e.imported).map((e) => [importKey(e), e.id]));
    const rows = [];
    for (const en of doc.entries) {
      if (!en || !en.kind || !en.name) continue;
      const e = { kind: String(en.kind), name: String(en.name), source: en.source || 'wiki', path: en.path || '',
        parent: en.parent || '', group: en.group || '', tags: Array.isArray(en.tags) ? en.tags : [],
        data: en.data && typeof en.data === 'object' ? en.data : {}, parsed: true, imported: true };
      const id = existing.get(importKey(e));
      if (id != null) e.id = id;
      rows.push(e);
    }
    await this.store.putMany('entries', rows);
    await this.load();
    const kinds = {};
    for (const e of rows) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
    return { added: rows.length - rows.filter((e) => e.id != null).length, updated: rows.filter((e) => e.id != null).length, kinds };
  }

  /** Remove everything that came from a PC library import (your own entries stay). */
  async clearImported() {
    const ids = (await this.store.all('entries')).filter((e) => e.imported).map((e) => e.id);
    await this.store.deleteMany('entries', ids);
    await this.load();
    return ids.length;
  }

  importedCount() { return this.all.filter((e) => e.imported).length; }

  get(id) { return this.byId.get(Number(id)) || null; }

  list({ kind = null, parent = null, query = '', includeTags = [], limit = 2000 } = {}) {
    const allowed = new Set(includeTags);
    const hidden = HIDDEN_TAGS.filter((t) => !allowed.has(t));
    return this.entries
      .filter((e) => (!kind || e.kind === kind) && (!parent || e.parent === parent))
      .filter((e) => !(e.tags || []).some((t) => hidden.includes(t)))
      .filter((e) => !query || matches(e, query))
      .sort(query ? byRelevance(query) : nocase).slice(0, limit).map(summary);
  }

  /** Case-insensitive lookup by name; prefers built-in entries, then the oldest of yours. */
  find(kind, name, parent = null) {
    const low = (name || '').toLowerCase();
    const hits = this.entries.filter((e) => e.kind === kind && e.name.toLowerCase() === low && (!parent || e.parent === parent));
    hits.sort((a, b) => (BUILT_IN.has(b.source) - BUILT_IN.has(a.source)) || a.id - b.id);
    return hits[0] || null;
  }

  status() {
    const kinds = {};
    for (const e of this.entries) {
      const k = (kinds[e.kind] = kinds[e.kind] || {});
      k[e.source] = (k[e.source] || 0) + 1;
    }
    return { pages_cached: 0, kinds };
  }

  /* ---------------------------------------------------------- reading the wiki (the store app only) */
  /** wiki: from wiki.js makeWiki(). Without one, or in a plain browser, entries are only what's built in or imported. */
  attachWiki(wiki) { this.wiki = wiki; }

  wikiAvailable() { return Boolean(this.wiki && this.wiki.available()); }

  /** Add or update entries the way the PC's db.upsert_entry does: the same kind, source, path and name is the same
      entry; new data is merged into the old, and an entry once parsed stays parsed. One write for the lot. */
  async upsertMany(rows) {
    const key = (e) => `${e.kind}|${e.source}|${e.path || ''}|${e.name}`;
    const stored = new Map(this.all.filter((e) => !this.builtIn.includes(e)).map((e) => [key(e), e]));
    const out = new Map();
    for (const r of rows) {
      const k = key(r);
      const old = out.get(k) || stored.get(k);
      const tags = [...new Set(r.tags || [])].sort();
      if (old) {
        const { _words, ...base } = old;
        out.set(k, { ...base, parent: r.parent || '', group: r.group || '', tags,
          ...(r.data != null ? { data: { ...(old.data || {}), ...r.data }, parsed: Boolean(r.parsed || old.parsed) } : {}) });
      } else {
        out.set(k, { kind: r.kind, name: r.name, source: r.source, path: r.path || '', parent: r.parent || '', group: r.group || '',
          tags, data: r.data || {}, parsed: Boolean(r.parsed) });
      }
    }
    await this.store.putMany('entries', [...out.values()]);
    await this.load();
  }

  findStored(kind, source, path, name = null) {
    return this.all.find((e) => e.kind === kind && e.source === source && e.path === path && (name == null || e.name === name)) || null;
  }

  /** Download the wiki front page and lineage list, then record every linked entry. */
  async syncIndex() {
    const found = [], errors = [];
    for (const path of ['/', '/lineage']) {
      try {
        found.push(...wikiparse.parseIndex(await this.wiki.fetch(path, true)));
      } catch (e) {
        if (!(e instanceof WikiError)) throw e;
        errors.push(e.message);
      }
    }
    const counts = {}, rows = [];
    for (const e of found) {
      const name = e.kind === 'spell-list' ? `${e.parent[0].toUpperCase()}${e.parent.slice(1).toLowerCase()} spell list` : e.name;
      rows.push({ kind: e.kind, name, source: 'wiki', path: e.path, parent: e.parent || '', group: e.group || '', tags: e.tags || [],
        data: e.variant_of ? { variant_of: e.variant_of } : null });
      counts[e.kind] = (counts[e.kind] || 0) + 1;
    }
    await this.upsertMany(rows);
    // make sure the core classes and their spell lists exist even if the front page changes
    const more = [];
    for (const [slug, rules] of Object.entries(CLASS_RULES)) {
      if (!this.all.some((e) => e.kind === 'class' && e.source === 'wiki' && e.name.toLowerCase() === rules.name.toLowerCase())) {
        more.push({ kind: 'class', name: rules.name, source: 'wiki', path: `/${slug}` });
      }
      if (rules.caster !== 'none' && !this.all.some((e) => e.kind === 'spell-list' && e.source === 'wiki' && e.parent === slug)) {
        more.push({ kind: 'spell-list', name: `${rules.name} spell list`, source: 'wiki', path: `/spells:${slug}`, parent: slug });
      }
    }
    if (more.length) await this.upsertMany(more);
    return { counts, errors };
  }

  /** An entry with full details: a wiki entry's page is downloaded and read the first time (or when the parser has
      changed, or on refresh). Without the wiki, entries come back as they are. */
  async ensureDetail(id, refresh = false) {
    const entry = this.get(id);
    if (!entry || entry.source !== 'wiki' || !this.wikiAvailable()) return entry;
    if (entry.parsed && !refresh && (entry.data || {})._v === wikiparse.PARSER_VERSION) return entry;
    const kind = entry.kind;
    const html = await this.wiki.fetch(entry.path, refresh);
    const base = { kind, name: entry.name, source: 'wiki', path: entry.path, parent: entry.parent, group: entry.group, tags: entry.tags, parsed: true };
    if (kind === 'class') {
      const slug = classSlug(entry);
      const data = { ...wikiparse.parseClass(html, slug), slug, _v: wikiparse.PARSER_VERSION };
      const rows = [{ ...base, data }];
      for (const sub of data.subclasses || []) {
        if (!this.findStored('subclass', 'wiki', sub.path)) {
          rows.push({ kind: 'subclass', name: sub.name, source: 'wiki', path: sub.path, parent: slug, group: sub.source || '', tags: sub.tags || [] });
        }
      }
      await this.upsertMany(rows);
    } else if (kind === 'spell-list') {
      const spells = wikiparse.parseSpellList(html);
      if (!spells.length) {
        await this.wiki.forget(entry.path);
        throw new WikiError(`Couldn't find any spells on the wiki's ${entry.name} page. Try downloading it again.`);
      }
      const rows = spells.map((sp) => ({ kind: 'spell', name: sp.name, source: 'wiki', path: sp.path, tags: sp.tags,
        data: Object.fromEntries(['level', 'school', 'casting_time', 'ritual', 'range', 'duration', 'components'].map((k) => [k, sp[k]])) }));
      rows.push({ ...base, data: { spells: spells.map((sp) => ({ path: sp.path, name: sp.name, level: sp.level })), _v: wikiparse.PARSER_VERSION } });
      await this.upsertMany(rows);
    } else {
      const parser = wikiparse.PARSERS[kind] || wikiparse.parseGeneric;
      const { name: _n, ...data } = parser(html);
      if (kind === 'background' && (entry.data || {}).variant_of) data.variant_note = `Variant of the background on ${entry.data.variant_of}`;
      data._v = wikiparse.PARSER_VERSION;
      await this.upsertMany([{ ...base, data }]);
    }
    return this.findStored(kind, 'wiki', entry.path, entry.name) || this.get(id);
  }

  /** Make sure everything a character points at has been read (before working out the sheet). */
  async ensureFor(char) {
    if (!this.wikiAvailable()) return;
    const ids = [(char.race || {}).id, (char.background || {}).id, ...(char.feats || []).map((f) => f.id)];
    for (const c of char.classes || []) ids.push(c.id, (c.subclass || {}).id);
    for (const id of ids) if (id) await this.ensureDetail(id).catch(() => null);
  }

  /** Read a class's spell list from the wiki first if it hasn't been (adding the entry if the index lacked it). */
  async ensureSpellList(slug, refresh = false) {
    if (!this.wikiAvailable()) return;
    slug = THIRD_CASTER_LISTS[slug] || slug;
    let list = this.all.find((e) => e.kind === 'spell-list' && e.parent === slug && e.source === 'wiki');
    if (!list && CLASS_RULES[slug] && CLASS_RULES[slug].caster !== 'none') {
      await this.upsertMany([{ kind: 'spell-list', name: `${CLASS_RULES[slug].name} spell list`, source: 'wiki', path: `/spells:${slug}`, parent: slug }]);
      list = this.all.find((e) => e.kind === 'spell-list' && e.parent === slug && e.source === 'wiki');
    }
    if (list) await this.ensureDetail(list.id, refresh);
  }

  /** Read whatever class option pages a character's option groups need (Eldritch Invocations, maneuvers...). */
  async prepareClassOptions(char) {
    if (!this.wikiAvailable()) return;
    await this.ensureFor(char);
    for (const [, spec] of classOpts.featLists(char, this.buildContext(char))) {
      if (spec && spec.page && !this.all.some((e) => e.kind === 'class-option' && e.path === spec.page)) {
        await this.upsertMany([{ kind: 'class-option', name: spec.label, source: 'wiki', path: spec.page, parent: spec.class, group: 'Quick Links' }]);
      } else if (spec && spec.feature) {
        const ce = this.find('class', (CLASS_RULES[spec.class] || {}).name || spec.class);
        if (ce) await this.ensureDetail(ce.id).catch(() => null);
      }
    }
    for (const g of this.classOptionGroups(char, ['ua', 'homebrew'])) {
      if (g.entry_id != null) await this.ensureDetail(g.entry_id).catch(() => null);
    }
  }

  /* ---------------------------------------------------------- download everything (the PC's "download all") */
  downloadStatus() {
    const j = this.job || { running: false, done: 0, total: 0, current: '', errors: [], finished: null, stage: '' };
    return { ...j, errors: j.errors.slice(-5), error_count: j.errors.length };
  }

  /** Fetch and read every wiki page into the library in the background, so all of it works offline. Pages already
      read are skipped, so after an interruption it carries on where it stopped. Returns false if already running. */
  startDownloadAll(includeTags = []) {
    if (!this.wikiAvailable()) throw new WikiError('Reading the wiki needs the Character Forge app installed on your phone.');
    if (this.job && this.job.running) return false;
    this.job = { running: true, done: 0, total: 0, current: '', errors: [], finished: null, stage: 'Reading the wiki’s lists', stop: false };
    this.downloadAll(includeTags).catch((e) => { this.job.errors.push(e.message); });
    return true;
  }

  stopDownloadAll() { if (this.job) this.job.stop = true; }

  async downloadAll(includeTags) {
    const job = this.job;
    const hidden = HIDDEN_TAGS.filter((t) => !includeTags.includes(t));
    const todo = (kinds) => this.all.filter((e) => e.source === 'wiki' && kinds.includes(e.kind)
      && !(e.parsed && (e.data || {})._v === wikiparse.PARSER_VERSION) && !(e.tags || []).some((t) => hidden.includes(t)));
    const step = async (label, fn) => {
      job.current = label;
      try { await fn(); } catch (e) { job.errors.push(`${label}: ${e.message}`); }
    };
    const run = async (entries) => {
      for (const e of entries) {
        if (job.stop) return;
        job.current = e.name;
        try { await this.ensureDetail(e.id); } catch (err) { job.errors.push(`${e.name}: ${err.message}`); }
        job.done += 1;
      }
    };
    try {
      await step('Wiki index', () => this.syncIndex());
      await step('All spells', () => this.ensureAllSpells());
      await step('Magic items', () => this.syncMagicItems());
      // classes and spell lists first: reading them adds the subclasses and spells
      job.stage = 'Classes and spell lists';
      const first = todo(['class', 'spell-list']);
      job.total = first.length;
      await run(first);
      job.stage = 'Everything else';
      const rest = todo(['race', 'subrace', 'background', 'feat', 'subclass', 'spell', 'class-option', 'item']);
      job.total += rest.length;
      await run(rest);
    } finally {
      Object.assign(job, { running: false, current: '', finished: Date.now() / 1000, stage: job.stop ? 'Stopped' : 'Done' });
    }
  }

  /** Load the wiki's full spell list once, so any spell can be searched and added. */
  async ensureAllSpells() {
    if (this.allSpellsDone || !this.wikiAvailable()) return;
    let html;
    try { html = await this.wiki.fetch('/spells'); } catch (e) { if (e instanceof WikiError) return; throw e; }
    const spells = wikiparse.parseSpellList(html);
    await this.upsertMany(spells.map((sp) => {
      const row = Object.fromEntries(['level', 'school', 'casting_time', 'ritual', 'range', 'duration', 'components'].map((k) => [k, sp[k]]));
      if (row.level == null) delete row.level;
      return { kind: 'spell', name: sp.name, source: 'wiki', path: sp.path, tags: sp.tags, data: row };
    }));
    this.allSpellsDone = spells.length > 0;
  }

  /** Read the wiki's magic item list (one request) and record every item; pages are read when used. */
  async syncMagicItems() {
    const items = wikiparse.parseMagicItemList(await this.wiki.fetch('/wondrous-items', true));
    if (!items.length) throw new WikiError('Couldn’t find any magic items on the wiki’s list. Try again later.');
    await this.upsertMany(items.map((it) => ({ kind: 'item', name: it.name, source: 'wiki', path: it.path, group: it.rarity, tags: it.tags,
      data: { rarity: it.rarity, item_type: it.item_type, attunement: it.attunement, book: it.source } })));
    return { count: items.length };
  }

  async add(entry) {
    const e = { kind: entry.kind, name: entry.name, source: entry.source || 'custom', path: entry.path || '',
      parent: entry.parent || '', group: entry.group || '', tags: entry.tags || [], data: entry.data || {}, parsed: true };
    const id = await this.store.put('entries', e);
    await this.load();
    return id;
  }

  async remove(id) {
    const e = this.get(id);
    if (!e) throw Object.assign(new Error('Not found'), { status: 404 });
    if (BUILT_IN.has(e.source) && !e.imported) throw Object.assign(new Error('Built-in entries can’t be deleted.'), { status: 400 });
    await this.store.delete('entries', e.id);
    await this.load();
  }

  classSpells(slug, includeTags = [], maxLevel = 9) {
    slug = THIRD_CASTER_LISTS[slug] || slug;
    const spells = [];
    // the wiki's list once it has been read (imported or downloaded), the SRD's until then
    const lists = this.all.filter((e) => e.kind === 'spell-list' && e.parent === slug && BUILT_IN.has(e.source));
    const list = lists.find((e) => e.source === 'wiki' && ((e.data || {}).spells || []).length) || lists.find((e) => e.source === 'srd') || lists[0];
    for (const s of (list && list.data.spells) || []) {
      const e = this.byPath.get(`spell:${s.path}`);
      if (e) spells.push(e);
    }
    const className = ((CLASS_RULES[slug] || {}).name || slug).toLowerCase();
    for (const e of this.entries) {
      if (e.kind !== 'spell' || BUILT_IN.has(e.source)) continue;
      const classes = (e.data.classes || []).map((c) => c.toLowerCase());
      if (classes.includes(className) || classes.includes(slug)) spells.push(e);
    }
    const allowed = new Set(includeTags);
    return spells
      .filter((s) => !(s.data.level != null && s.data.level > maxLevel))
      .filter((s) => !(s.tags || []).some((t) => HIDDEN_TAGS.includes(t) && !allowed.has(t)))
      .map((s) => ({ id: s.id, name: s.name, source: s.source, tags: s.tags || [],
        ...Object.fromEntries(['level', 'school', 'casting_time', 'ritual', 'range', 'duration', 'components'].map((k) => [k, s.data[k] ?? null])) }))
      .sort((a, b) => ((a.level ?? 99) - (b.level ?? 99)) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Every set of class options this character can pick from right now, with the options filled in.
      Option pages come from a library imported from the PC (the phone can't read the wiki itself). */
  classOptionGroups(char, includeTags = []) {
    const ctx = this.buildContext(char);
    const groups = classOpts.featureGroups(char, ctx);
    const classes = (char.classes || []).filter((c) => c.name);
    classes.forEach((c, i) => {
      const cc = ctx.classes[i] || {};
      const slug = classOpts.classSlug(c);
      const lvl = Math.max(1, Math.min(20, parseInt(c.level, 10) || 1));
      for (const e of this.list({ kind: 'class-option', parent: slug, includeTags: [...includeTags, 'homebrew'] })) {
        const path = e.path.split('#')[0];
        if (!classOpts.pageApplies(path, c)) continue;
        const count = classOpts.pageCount(path, slug, lvl, cc.detail, e.name);
        if (count === 0) continue;
        groups.push({ key: `${slug}|${path}`, class: slug, class_name: c.name, class_level: lvl, label: e.name, count,
          source: 'page', entry_id: e.id, options: [], error: '' });
      }
    });
    for (const [g, spec] of classOpts.featLists(char, ctx)) {
      if (spec && spec.page) {
        const e = this.entries.find((x) => x.kind === 'class-option' && x.path === spec.page);
        if (e) Object.assign(g, { source: 'feat-page', entry_id: e.id });
        else g.error = `The ${spec.label} options aren’t in this device’s library. Import your library from the PC to get them.`;
      } else if (spec && spec.feature) {
        const ce = this.find('class', (CLASS_RULES[spec.class] || {}).name || spec.class[0].toUpperCase() + spec.class.slice(1));
        const feat = ((ce && ce.data.features) || []).find((f) => (f.name || '').toLowerCase() === spec.feature.toLowerCase());
        g.options = ((feat && feat.options) || []).map((o) => ({ ...o }));
        if (!g.options.length) g.error = `Couldn't find the ${spec.label} options in the ${spec.class} class.`;
      }
      groups.push(g);
    }
    const hidden = HIDDEN_TAGS.filter((t) => !includeTags.includes(t));
    for (const g of groups) {
      if (!['page', 'feat-page'].includes(g.source) || g.entry_id == null) continue;
      const opts = ((this.get(g.entry_id) || {}).data || {}).options || [];
      g.options = opts.filter((o) => !(o.tags || []).some((t) => hidden.includes(t)));
      if (!opts.length) g.error = `The ${g.label} page has no options in this device’s library. Import your library from the PC again after opening it there.`;
    }
    return classOpts.markUnmet(groups, char);
  }

  /** Every magic item in the library (imported from the PC, your PDFs' and your own), for the equipment list. */
  magicItems(includeTags = []) {
    const hidden = HIDDEN_TAGS.filter((t) => !includeTags.includes(t));
    return this.entries.filter((e) => e.kind === 'item' && !(e.tags || []).some((t) => hidden.includes(t))).sort(nocase)
      .map((e) => {
        const d = e.data || {};
        return { id: e.id, name: e.name, source: e.source, rarity: d.rarity || e.group || '', item_type: d.item_type || '',
          attunement: Boolean(d.attunement), book: d.book || d.source || '', tags: e.tags || [] };
      });
  }

  /** Every spell the library knows, for feats that let you pick from any list (Fey Touched, Shadow Touched). */
  allSpells(includeTags = [], maxLevel = 9) {
    const hidden = HIDDEN_TAGS.filter((t) => !includeTags.includes(t));
    const seen = new Set(), out = [];
    const rows = this.entries.filter((e) => e.kind === 'spell')
      .sort((a, b) => ((b.source === 'wiki') - (a.source === 'wiki')) || nocase(a, b));
    for (const e of rows) {
      const lvl = e.data.level;
      if (lvl == null || lvl > maxLevel || (e.tags || []).some((t) => hidden.includes(t)) || seen.has(e.name.toLowerCase())) continue;
      seen.add(e.name.toLowerCase());
      out.push({ id: e.id, name: e.name, source: e.source, tags: e.tags || [],
        ...Object.fromEntries(['level', 'school', 'casting_time', 'ritual', 'range', 'duration', 'components'].map((k) => [k, e.data[k] ?? null])) });
    }
    return out.sort((a, b) => (a.level - b.level) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  subclassesFor(slug, includeTags = []) {
    return this.list({ kind: 'subclass', parent: slug, includeTags });
  }

  /** Everything the rules engine needs to know about a character's picks. */
  buildContext(char) {
    const warnings = [];
    const ctx = { classes: [], warnings, spells: {}, feats: {} };
    for (const c of char.classes || []) {
      const entry = c.id ? this.get(c.id) : null;
      const rules = entry ? classRules(entry) : structuredClone(CLASS_RULES[c.slug || ''] || {});
      let sub = null;
      if (c.subclass && c.subclass.id) {
        const se = this.get(c.subclass.id);
        sub = se ? se.data : null;
        if (!se) warnings.push(`Couldn't find ${c.subclass.name || 'the subclass'} in your library.`);
      }
      if (c.id && !entry) warnings.push(`Couldn't find ${c.name || 'a class'} in your library.`);
      ctx.classes.push({ rules, detail: entry ? entry.data : {}, subclass: sub });
    }
    const race = char.race || {};
    if (race.id) {
      const entry = this.get(race.id);
      if (entry) ctx.race = raceSelection(entry, race.variant, race.subrace);
      else warnings.push(`Couldn't find ${race.name || 'your species'} in your library.`);
    }
    const bg = char.background || {};
    if (bg.id) {
      const entry = this.get(bg.id);
      if (entry) ctx.background = { name: entry.name, ...entry.data };
      else warnings.push(`Couldn't find ${bg.name || 'your background'} in your library.`);
    }
    for (const f of char.feats || []) {
      const entry = f.id ? this.get(f.id) : null;
      if (entry) ctx.feats[String(f.id)] = entry.data;
    }
    for (const s of char.spells || []) {
      let e = s.id ? this.get(s.id) : null;
      if (!e && s.name) e = this.find('spell', s.name);
      if (e) {
        ctx.spells[String(s.id || '')] = e.data;
        ctx.spells[(s.name || '').toLowerCase()] = e.data;
      }
    }
    return ctx;
  }
}
