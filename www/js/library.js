/* The library: built-in SRD content plus entries you add, behind one interface.
   Ported from the PC app's library.py and the trait reader in wikiparse.py. */
import { ABILITY_NAMES, CLASS_RULES, SKILLS } from './srd.js';
import { slugify } from './rules.js';
import * as classOpts from './options.js';

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

const CHOICE_RE = /(?:proficiency (?:in|with)|proficient in)\s+(?:your choice of\s+)?(one|two|three|four|a|an)\s+(of the following\s+)?(?:other\s+)?skills?\b([^.]*)/i;

/** 'proficiency with two of the following skills of your choice: A, B, C' -> {count, options};
    options is null when any skill may be chosen. */
export function skillChoice(text) {
  const m = (text || '').match(CHOICE_RE);
  if (!m) return null;
  const count = NUM_WORDS[m[1].toLowerCase()] || 1;
  const rest = m[3];
  if (!m[2] && !rest.toLowerCase().includes('of your choice') && !rest.includes(':')) return null;
  const options = m[2] || rest.includes(':') ? skillsIn(rest) : [];
  return { count, options: options.length ? options : null };
}

/** A background's 'Skill Proficiencies' line -> [fixed skills, choices]. */
export function skillField(text) {
  text = text || '';
  const m = text.match(/\b(choose|one of|two of|plus one|and one|from among|of your choice)\b/i);
  if (!m) return [skillsIn(text), []];
  const before = text.slice(0, m.index), after = text.slice(m.index);
  const n = after.match(/\b(one|two|three|four)\b/i);
  const count = n ? NUM_WORDS[n[1].toLowerCase()] || 1 : 1;
  const options = skillsIn(after);
  return [skillsIn(before), [{ count, options: options.length ? options : null, trait: 'Background' }]];
}

/** The 'of your choice' part of an Ability Score Increase trait, as picks: [[{count, amount, exclude}], alt or null]. */
export function asiChoices(low, fixed) {
  let picks = [], alt = null;
  let m = low.match(/increase one (?:ability )?score by (\d),? and (?:increase )?a different (?:ability )?score by (\d)(?:,? or increase (one|two|three) different (?:ability )?scores by (\d))?/);
  if (m) {
    picks = [{ count: 1, amount: parseInt(m[1], 10), exclude: [] }, { count: 1, amount: parseInt(m[2], 10), exclude: [] }];
    if (m[3]) alt = [{ count: NUM_WORDS[m[3]] || 3, amount: parseInt(m[4], 10), exclude: [] }];
    return [picks, alt];
  }
  const re = /\b(one|two|three|four|a)\b ((?:other |different )*)(?:ability )?scores?(?: of your choice)?,? (?:each )?(?:increases?|increase) by (\d)/g;
  for (m of low.matchAll(re)) {
    if (!m[0].includes('of your choice') && !m[2].includes('different') && !m[2].includes('other')) continue;
    const n = m[1] === 'a' ? 1 : NUM_WORDS[m[1]] || 1;
    picks.push({ count: n, amount: parseInt(m[3], 10), exclude: m[2].includes('other') ? Object.keys(fixed).sort() : [] });
  }
  return [picks, alt];
}

/** Pull numbers out of species traits: ability increases, speed, size, senses, skills. */
export function analyzeTraits(traits) {
  const out = { asi: {}, asi_note: '', asi_flexible: false, asi_choice: [], asi_alt: null, speed: null, size: '',
    darkvision: null, languages: '', skills: [], skill_choices: 0, bonus_feat: false, hp_per_level: 0,
    weapon_profs: [], armor_profs: [], choices: [] };
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
      if (/of your choice|one score by 2|different score|two different|three different/.test(low)) {
        out.asi_flexible = true;
        const [picks, alt] = asiChoices(low, out.asi);
        out.asi_choice.push(...picks);
        out.asi_alt = alt || out.asi_alt;
      }
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
    for (const m of body.matchAll(/(?:proficiency in|proficient in) (?:the )?([A-Za-z ,]+?) skills?\b/g)) {
      for (const sk of skillsIn(m[1])) if (!out.skills.includes(sk)) out.skills.push(sk);
    }
    const choice = skillChoice(body);
    if (choice) {
      choice.trait = t.name;
      out.choices.push(choice);
      out.skill_choices += choice.count;
    }
    let m = low.match(/proficiency with (?:the )?([a-z ,']+?)(?:\.|$)/);
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
    const lists = this.entries.filter((e) => e.kind === 'spell-list' && e.parent === slug && BUILT_IN.has(e.source));
    const list = lists.find((e) => e.source === 'wiki') || lists[0];
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
