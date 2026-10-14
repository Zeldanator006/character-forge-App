/* The library: built-in SRD content plus entries you add, behind one interface.
   Ported from the PC app's library.py and the trait reader in wikiparse.py. */
import { ABILITY_NAMES, CLASS_RULES, SKILLS } from './srd.js';
import { slugify } from './rules.js';

const NAME_TO_ABILITY = Object.fromEntries(Object.entries(ABILITY_NAMES).map(([k, v]) => [v.toLowerCase(), k]));
const ALL_SKILLS = Object.keys(SKILLS);
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const HIDDEN_TAGS = ['ua', 'homebrew'];
const BUILT_IN = new Set(['srd', 'wiki']);
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const splitList = (s) => (s || '').replace(/\band\b|\bor\b/g, ',').split(',')
  .map((p) => p.replace(/^[ .;]+|[ .;]+$/g, '')).filter(Boolean);
const skillsIn = (s) => {
  const low = (s || '').toLowerCase();
  return ALL_SKILLS.filter((sk) => new RegExp(`\\b${reEsc(sk.toLowerCase())}\\b`).test(low));
};

/** Pull numbers out of species traits: ability increases, speed, size, senses, skills. */
export function analyzeTraits(traits) {
  const out = { asi: {}, asi_note: '', asi_flexible: false, speed: null, size: '', darkvision: null, languages: '',
    skills: [], skill_choices: 0, bonus_feat: false, hp_per_level: 0, weapon_profs: [], armor_profs: [] };
  for (const t of traits) {
    const name = t.name.toLowerCase(), body = t.text || '';
    const low = body.toLowerCase();
    if (name.includes('ability score')) {
      out.asi_note = `${out.asi_note} ${body}`.trim();
      if (/ability scores each increase by 1/.test(low)) {
        for (const code of Object.keys(ABILITY_NAMES)) out.asi[code] = (out.asi[code] || 0) + 1;
      }
      for (const m of body.matchAll(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score(?:s)? (?:increases|increase|each increase) by (\d)/g)) {
        const code = NAME_TO_ABILITY[m[1].toLowerCase()];
        out.asi[code] = (out.asi[code] || 0) + parseInt(m[2], 10);
      }
      if (/of your choice|one score by 2|different score|two different|three different/.test(low)) out.asi_flexible = true;
    } else if (name === 'speed' || low.slice(0, 120).includes('walking speed')) {
      const m = low.match(/walking speed (?:is|of) (\d+)/);
      if (m && out.speed === null) out.speed = parseInt(m[1], 10);
    }
    if (name === 'size') {
      const m = low.match(/your size is (tiny|small|medium|large)/);
      const m2 = /you are (small or medium|medium or small)/.test(low);
      out.size = m ? m[1][0].toUpperCase() + m[1].slice(1) : (m2 ? 'Small or Medium' : '');
    }
    if (name.includes('darkvision')) {
      const m = low.match(/within (\d+) feet/);
      if (m) out.darkvision = parseInt(m[1], 10);
    }
    if (name === 'languages') out.languages = body.split('.')[0].replace(/^you can speak, read, and write\s+/i, '');
    if (name === 'feat' || low.includes('feat of your choice')) out.bonus_feat = true;
    if (/hit point maximum increases by 1,? and it increases by 1 every time you gain a level/.test(low)) out.hp_per_level += 1;
    for (const m of body.matchAll(/proficiency in (?:the )?([A-Za-z ,]+?) skills?\b/g)) {
      for (const sk of skillsIn(m[1])) if (!out.skills.includes(sk)) out.skills.push(sk);
    }
    let m = low.match(/proficiency in (\w+) (?:other )?skills? of your choice/);
    if (m) out.skill_choices += NUM_WORDS[m[1]] || 0;
    m = low.match(/proficiency with (?:the )?([a-z ,']+?)(?:\.|$)/);
    if (m && !m[1].includes('armor') && !m[1].includes('tools') && !m[1].includes('artisan')) {
      out.weapon_profs.push(...splitList(m[1]).map((w) => w.trim()).filter(Boolean));
    }
    m = low.match(/proficiency with (light|medium|heavy)(?: and (light|medium|heavy))? armor/);
    if (m) out.armor_profs.push(...[m[1], m[2]].filter(Boolean));
  }
  return out;
}

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

export function raceSelection(entry, variantName = null, subraceName = null) {
  const variants = ((entry || {}).data || {}).variants || [];
  if (!variants.length) return { name: entry ? entry.name : '', traits: [], analysis: analyzeTraits([]) };
  const variant = variants.find((v) => v.source === variantName) || variants[0];
  const traits = [...(variant.traits || [])];
  const sub = (variant.subraces || []).find((s) => s.name === subraceName) || null;
  if (sub) traits.push(...(sub.traits || []));
  const analysis = analyzeTraits(traits);
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
const summary = ({ _words, data, ...e }) => e;
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
    const mine = await this.store.all('entries');
    this.entries = [...this.builtIn, ...mine.map((e) => ({ ...e, source: e.source || 'custom' }))];
    this.byId = new Map(this.entries.map((e) => [e.id, e]));
    this.byPath = new Map(this.entries.filter((e) => BUILT_IN.has(e.source)).map((e) => [`${e.kind}:${e.path}`, e]));
  }

  get(id) { return this.byId.get(Number(id)) || null; }

  list({ kind = null, parent = null, query = '', includeTags = [], limit = 2000 } = {}) {
    const allowed = new Set(includeTags);
    const hidden = HIDDEN_TAGS.filter((t) => !allowed.has(t));
    return this.entries
      .filter((e) => (!kind || e.kind === kind) && (!parent || e.parent === parent))
      .filter((e) => !(e.tags || []).some((t) => hidden.includes(t)))
      .filter((e) => !query || matches(e, query))
      .sort(nocase).slice(0, limit).map(summary);
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
    if (BUILT_IN.has(e.source)) throw Object.assign(new Error('Built-in entries can’t be deleted.'), { status: 400 });
    await this.store.delete('entries', e.id);
    await this.load();
  }

  classSpells(slug, includeTags = [], maxLevel = 9) {
    slug = THIRD_CASTER_LISTS[slug] || slug;
    const spells = [];
    const list = this.entries.find((e) => e.kind === 'spell-list' && e.parent === slug && BUILT_IN.has(e.source));
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
