/* What a feat gives beyond its description: picks from class lists, spells, skills and the like,
   plus whether a character meets its prerequisite.

   Ported from the PC app's feats.py; tests/helpers.test.mjs checks both give the same answers.
   Well-known feats are listed by name (their wording differs between printings); anything else is
   read from its text, so homebrew and PDF feats written the usual way work too. */
import { ABILITY_NAMES, ordinal } from './srd.js';
import { slugify } from './rules.js';

export const NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5 };
export const CASTER_LISTS = ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'];
export const CLASS_ABILITY = { bard: 'cha', sorcerer: 'cha', warlock: 'cha', paladin: 'cha', cleric: 'wis', druid: 'wis',
  ranger: 'wis', wizard: 'int', artificer: 'int' };

export const LISTS = {
  invocations: { label: 'Eldritch Invocations', class: 'warlock', page: '/warlock:eldritch-invocations',
    prereq_needs_class: true, one: 'Eldritch Invocation', many: 'Eldritch Invocations' },
  'fighting-style': { label: 'Fighting Style', class: 'fighter', feature: 'Fighting Style',
    one: 'Fighting Style option', many: 'Fighting Style options' },
  metamagic: { label: 'Metamagic', class: 'sorcerer', feature: 'Metamagic',
    one: 'Metamagic option', many: 'Metamagic options' },
  maneuvers: { label: 'Maneuvers', class: 'fighter', page: '/fighter:battle-master:maneuvers',
    one: 'Battle Master maneuver', many: 'Battle Master maneuvers' },
};

export const ELEMENTS = ['Acid', 'Cold', 'Fire', 'Lightning', 'Thunder'].map((n) => ({ name: n,
  text: `Spells you cast ignore resistance to ${n.toLowerCase()} damage, and when you roll ${n.toLowerCase()} damage for a spell, you can treat any 1 on a damage die as a 2.`,
  source: '' }));

export const KNOWN = {
  'eldritch adept': { lists: [['invocations', 1]] },
  'fighting initiate': { lists: [['fighting-style', 1]] },
  'metamagic adept': { lists: [['metamagic', 2]] },
  'martial adept': { lists: [['maneuvers', 2]] },
  'elemental adept': { inline: { label: 'Damage type', count: 1, options: ELEMENTS } },
  'magic initiate': { spell_picks: { classes: CASTER_LISTS, choose_class: true, ability: 'class',
    picks: [{ count: 2, level: 0 }, { count: 1, level: 1 }] } },
  'artificer initiate': { spell_picks: { classes: ['artificer'], ability: 'int',
    picks: [{ count: 1, level: 0 }, { count: 1, level: 1 }] } },
  'fey touched': { spells: ['Misty Step'], spell_picks: { classes: [], ability: 'asi',
    picks: [{ count: 1, level: 1, schools: ['Divination', 'Enchantment'] }] } },
  'shadow touched': { spells: ['Invisibility'], spell_picks: { classes: [], ability: 'asi',
    picks: [{ count: 1, level: 1, schools: ['Illusion', 'Necromancy'] }] } },
  telekinetic: { spells: ['Mage Hand'], spell_ability: 'asi' },
  telepathic: { spells: ['Detect Thoughts'], spell_ability: 'asi' },
  'ritual caster': { spell_picks: { classes: CASTER_LISTS, choose_class: true, ability: 'class',
    picks: [{ count: 2, level: 1, ritual: true }] } },
  'spell sniper': { spell_picks: { classes: CASTER_LISTS, choose_class: true, ability: 'class',
    picks: [{ count: 1, level: 0, note: 'one that needs an attack roll' }] } },
  'drow high magic': { spells: ['Detect Magic', 'Levitate', 'Dispel Magic'], spell_ability: 'cha' },
  'wood elf magic': { spells: ['Longstrider', 'Pass without Trace'], spell_ability: 'wis',
    spell_picks: { classes: ['druid'], ability: 'wis', picks: [{ count: 1, level: 0 }] } },
  'fey teleportation': { spells: ['Misty Step'], spell_ability: 'int' },
  'svirfneblin magic': { spells: ['Nondetection', 'Blindness/Deafness', 'Blur', 'Disguise Self'], spell_ability: 'int' },
  skilled: { skills_or_tools: 3 },
  'skill expert': { skills: 1, expertise: 1 },
  prodigy: { skills: 1, tools: 1, languages: 1, expertise: 1 },
  linguist: { languages: 3 },
  'weapon master': { weapons: 4 },
};
export const EMPTY = { lists: [], inline: null, spells: [], spell_ability: '', spell_picks: null, skills: 0,
  skills_or_tools: 0, expertise: 0, tools: 0, languages: 0, weapons: 0 };
export const NOT_SPELLS = new Set(['same', 'following', 'chosen', 'first', '1st-level', 'selected', 'other']);

const n = (word) => { const k = String(word).toLowerCase(); return Object.hasOwn(NUM, k) ? NUM[k] : 1; };
/** Python truthiness: empty lists and objects count as false. */
const T = (v) => Boolean(v) && !(Array.isArray(v) && !v.length)
  && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const capitalize = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const title = (s) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

export function featKey(f) {
  return String(f.id || slugify(f.name));
}

const LIST_PATTERNS = [
  [/\b(one|two|three)\s+eldritch invocations?\b/i, 'invocations'],
  [/\b(one|two)\s+fighting style options?\b/i, 'fighting-style'],
  [/\b(one|two|three)\s+metamagic options?\b/i, 'metamagic'],
  [/\b(one|two|three)\s+maneuvers?\b[^.]*\bbattle master\b/i, 'maneuvers'],
];

/** What a feat lets you pick or gives you outright. */
export function grants(name, text) {
  const key = (name || '').trim().toLowerCase().replace(/\s*\((?:ua|hb|homebrew)\)\s*$/, '');
  if (Object.hasOwn(KNOWN, key)) {
    const g = { ...EMPTY, ...KNOWN[key] };
    return { ...g, lists: g.lists.map((x) => [...x]) };
  }
  const g = { ...EMPTY, lists: [], spells: [] };
  const t = (text || '').replace(/\s+/g, ' ');
  for (const [pat, listId] of LIST_PATTERNS) {
    const m = t.match(pat);
    if (!m) continue;
    g.lists.push([listId, n(m[1])]);
  }
  for (const [, sp] of t.matchAll(/\byou (?:also )?learn the ([a-z][a-z' /-]{2,40}?) (?:spell|cantrip)\b/gi)) {
    const words = sp.split(/\s+/).filter(Boolean);
    if (!NOT_SPELLS.has(words[0].toLowerCase())) {
      g.spells.push(words.map((w) => (['of', 'the', 'without', 'and'].includes(w) ? w : capitalize(w))).join(' '));
    }
  }
  let m = t.match(/proficiency in (one|two|three) skills? of your choice/i);
  if (m) g.skills = n(m[1]);
  m = t.match(/any combination of (one|two|three) skills or tools/i);
  if (m) g.skills_or_tools = n(m[1]);
  if (/proficiency bonus is doubled/i.test(t) && /skills? (?:in which|that) you (?:have|are) proficien/i.test(t)) g.expertise = 1;
  m = t.match(/proficiency with (one|two|three|four) weapons? of your choice/i);
  if (m) g.weapons = n(m[1]);
  m = t.match(/learn (one|two|three) languages? of your choice/i);
  if (m) g.languages = n(m[1]);
  const picks = [];
  for (const [, count, kind] of t.matchAll(/\b(one|two|three)\s+(cantrips?|1st-level spells?)\b(?: of your choice)?/gi)) {
    picks.push({ count: n(count), level: kind.toLowerCase().startsWith('cantrip') ? 0 : 1 });
  }
  if (picks.length) {
    let classes = [];
    const cm = t.match(/choose (?:a|one of the following) class(?:es)?:?\s*([a-z, ]+?)(?:\.|$)/i);
    if (cm) {
      classes = [...CASTER_LISTS, 'artificer', 'paladin', 'ranger'].filter((c) => new RegExp(`\\b${c}\\b`, 'i').test(cm[1]));
    } else {
      const lm = t.match(/\b(bard|cleric|druid|sorcerer|warlock|wizard|artificer|paladin|ranger)(?:'s)? (?:spell list|cantrip)/i);
      classes = lm ? [lm[1].toLowerCase()] : [];
    }
    const from = (t.match(/must be from the ([a-z ,]+?) schools?/i) || [null, ''])[1] || '';
    const schools = [...from.matchAll(/\b(abjuration|conjuration|divination|enchantment|evocation|illusion|necromancy|transmutation)\b/gi)]
      .map((x) => x[1]);
    for (const p of picks) {
      if (schools.length) p.schools = schools.map(capitalize);
      if (/ritual tag/i.test(t)) p.ritual = true;
    }
    g.spell_picks = { classes, choose_class: Boolean(cm) && classes.length > 1,
      ability: cm ? 'class' : classes.length === 1 ? (Object.hasOwn(CLASS_ABILITY, classes[0]) ? CLASS_ABILITY[classes[0]] : '') : '',
      picks };
  }
  return g;
}

/** 'Pick 1 Eldritch Invocation; 2 cantrips and a 1st-level spell' for the Feats step. */
export function summary(g) {
  const parts = [];
  for (const [listId, k] of g.lists) parts.push(`${k} ${k > 1 ? LISTS[listId].many : LISTS[listId].one}`);
  if (T(g.inline)) parts.push(`${g.inline.count} ${g.inline.label.toLowerCase()}`);
  if (T(g.spells)) parts.push('the ' + g.spells.join(', ') + (g.spells.length === 1 ? ' spell' : ' spells'));
  const sp = g.spell_picks;
  if (T(sp)) {
    const bits = sp.picks.map((p) => `${p.count} ${p.level === 0 ? 'cantrip' : ordinal(p.level) + '-level spell'}${p.count > 1 ? 's' : ''}`);
    const where = T(sp.choose_class) ? "from a class's list" : (sp.classes || []).length === 1 ? `from the ${sp.classes[0]} list` : '';
    parts.push(bits.join(' and ') + (where ? ` ${where}` : ''));
  }
  for (const [key, word] of [['skills', 'skill'], ['skills_or_tools', 'skill or tool'], ['expertise', 'expertise'],
    ['tools', 'tool'], ['languages', 'language'], ['weapons', 'weapon']]) {
    const k = g[key] || 0;
    if (!k) continue;
    parts.push(key !== 'expertise' ? `${k} ${word}${k > 1 && key !== 'expertise' ? 's' : ''}` : 'expertise in 1 skill');
  }
  return parts;
}

export const RACES = ['dragonborn', 'dwarf', 'elf', 'gnome', 'half-elf', 'half-orc', 'halfling', 'human', 'tiefling', 'orc', 'goblin',
  'kobold', 'aasimar', 'tabaxi', 'firbolg', 'goliath', 'kenku', 'lizardfolk', 'tortle', 'genasi', 'triton', 'yuan-ti'];

// Python's (?<![\w-])word(?![\w-]), without lookbehind (older Safari can't parse it); \w is Unicode-aware there
const WORDISH = /[\p{L}\p{N}_-]/u;
function hasWord(text, word) {
  for (let i = text.indexOf(word); i !== -1; i = text.indexOf(word, i + 1)) {
    const before = i > 0 ? text[i - 1] : '', after = text[i + word.length] || '';
    if (!(before && WORDISH.test(before)) && !(after && WORDISH.test(after))) return true;
  }
  return false;
}
/** Python's `x in coll` for a list, set or string. */
const isIn = (x, coll) => (coll instanceof Set ? coll.has(x) : coll.includes(x));
const NAMES = Object.values(ABILITY_NAMES).map((x) => x.toLowerCase()).join('|');
const ABILITY_REQ_RE = new RegExp(`((?:${NAMES})(?:(?:,|,? or|,? and) (?:${NAMES}))*) (?:score of )?(\\d+) or higher`);

/** What's missing for a feat's prerequisite (empty when it's met, or when we can't tell). */
export function prerequisiteProblems(prereq, info) {
  const p = (prereq || '').toLowerCase();
  if (!p) return [];
  const out = [];
  let m = p.match(ABILITY_REQ_RE);
  if (m) {
    const abs = [...m[1].matchAll(new RegExp(NAMES, 'g'))].map((a) => a[0].slice(0, 3));
    const need = parseInt(m[2], 10);
    const score = (a) => (Object.hasOwn(info.scores, a) ? info.scores[a] : 0);
    const ok = m[1].includes(' and ') ? abs.every((a) => score(a) >= need) : abs.some((a) => score(a) >= need);
    if (!ok) out.push(`${abs.map((a) => ABILITY_NAMES[a]).join(' or ')} ${need}`);
  }
  for (const cat of ['light', 'medium', 'heavy']) {
    if (p.includes(`proficiency with ${cat} armor`) && !isIn(cat, info.armor)) out.push(`proficiency with ${cat} armor`);
  }
  if (p.includes('proficiency with a shield') && !isIn('shield', info.armor)) out.push('proficiency with shields');
  if (p.includes('proficiency with a martial weapon') && !T(info.martial)) out.push('proficiency with a martial weapon');
  if (/ability to cast at least one spell|spellcasting (?:or pact magic )?feature|pact magic feature/.test(p) && !T(info.caster)) {
    out.push('the ability to cast spells');
  }
  const races = RACES.filter((r) => hasWord(p, r));
  if (races.length && !races.some((r) => hasWord(info.race, r))) {
    const sub = p.match(/\(([\p{L}\p{N}_]+)\)/u);
    if (!(sub && info.race.includes(sub[1]))) out.push(races.map(title).join(' or '));
  }
  m = p.match(/(\d+)(?:st|nd|rd|th) level/);
  if (m && info.level < parseInt(m[1], 10)) out.push(`${ordinal(parseInt(m[1], 10))} level`);
  return out;
}
