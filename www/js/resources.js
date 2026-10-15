/* Limited-use class features, racial traits and feats, worked out from the character so the Play tab can track them.

   Ported from the PC app's resources.py; tests/helpers.test.mjs checks both give the same answers.
   Each resource is {id, name, max, reset, die, source, note}. max is null for "unlimited" (a 20th-level
   barbarian's rage). reset is "short" (comes back on a short or long rest), "long", or "" (never on its own).
   Core 2014 class features come from a table; anything else is read from the feature's own text
   ("a number of times equal to your Wisdom modifier", "Once you use this trait, you can't use it again until..."). */
import { slugify } from './rules.js';

export const ABILITY_WORDS = { strength: 'str', dexterity: 'dex', constitution: 'con', intelligence: 'int',
  wisdom: 'wis', charisma: 'cha' };
export const COUNT_WORDS = { once: 1, twice: 2, 'three times': 3, 'four times': 4, one: 1, two: 2, three: 3 };

// Features the class table below already covers (so their text isn't read a second time)
export const TABLE_NAMES = new Set([
  'action surge', 'arcane recovery', 'archdruid', 'bardic inspiration', 'channel divinity', 'cleansing touch',
  'combat superiority', 'combat wild shape', 'divine intervention', 'divine sense', 'flash of genius',
  'flexible casting', 'font of inspiration', 'font of magic', 'greater portent', 'harness divine power',
  "hexblade's curse", 'indomitable', 'ki', 'lay on hands', 'mystic arcanum', 'natural recovery', 'perfect self',
  'persistent rage', 'portent', 'rage', 'relentless', 'relentless rage', 'second wind', 'signature spells',
  'sorcery points', 'spell mastery', 'stroke of luck', 'superior inspiration', 'tides of chaos', 'wild shape',
]);

// Racial traits whose text doesn't say how often they work (null: not a limited resource)
export const RACE_TABLE = new Map([
  ['breath weapon', [1, 'short']], ['relentless endurance', [1, 'long']], ["stone's endurance", [1, 'short']],
  ['fury of the small', [1, 'short']], ['healing hands', [1, 'long']], ['hidden step', [1, 'short']],
  ['fey step', [1, 'short']], ['hungry jaws', [1, 'short']], ['savage attacks', null], ['lucky', null],
]);

const id = slugify;
const res = (name, mx, reset, source, { die = null, note = '', key = null } = {}) => (
  { id: key || id(name), name, max: mx, reset, die, source, note });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const get = (obj, key, def) => (obj != null && Object.hasOwn(obj, key) ? obj[key] : def);

/** table: [[fromLevel, value], ...] in order; the value for this level, or null below the first. */
function step(level, table) {
  let out = null;
  for (const [lv, val] of table) if (level >= lv) out = val;
  return out;
}

export function classTable(levelOf, sub, mods, prof) {
  const out = [];
  const lv = (k, def = null) => get(levelOf, k, def);
  const subOf = (k) => get(sub, k, '');
  if (lv('barbarian')) {
    const n = step(lv('barbarian'), [[1, 2], [3, 3], [6, 4], [12, 5], [17, 6], [20, null]]);
    const dmg = lv('barbarian') < 9 ? 2 : lv('barbarian') < 16 ? 3 : 4;
    out.push(res('Rage', n, 'long', 'Barbarian', {
      note: `+${dmg} damage on Strength melee attacks, advantage on Strength checks and saves, resistance to bludgeoning, piercing and slashing.`
        + (n === null ? ' Unlimited at 20th level.' : '') }));
  }
  if (lv('bard')) {
    const b = lv('bard');
    const die = step(b, [[1, 'd6'], [5, 'd8'], [10, 'd10'], [15, 'd12']]);
    out.push(res('Bardic Inspiration', Math.max(1, mods.cha), b >= 5 ? 'short' : 'long', 'Bard', { die,
      note: 'Bonus action: a creature within 60 feet gets a die to add to one check, attack or save.' }));
  }
  if (lv('cleric', 0) >= 2) {
    out.push(res('Channel Divinity', step(lv('cleric'), [[2, 1], [6, 2], [18, 3]]), 'short', 'Cleric'));
  }
  if (lv('cleric', 0) >= 10) {
    out.push(res('Divine Intervention', 1, 'long', 'Cleric', {
      note: `Roll d100; it works on ${lv('cleric')} or lower` + (lv('cleric') >= 20 ? ' (automatic at 20th level)' : '')
        + ". If it works, you can't use it again for 7 days." }));
  }
  if (lv('paladin')) {
    const p = lv('paladin');
    out.push(res('Lay on Hands', 5 * p, 'long', 'Paladin', { note: 'Pool of hit points to restore; 5 points cure a disease or poison.' }));
    out.push(res('Divine Sense', Math.max(1, 1 + mods.cha), 'long', 'Paladin'));
    if (p >= 3) out.push(res('Channel Divinity', 1, 'short', 'Paladin', { key: 'channel-divinity-paladin' }));
    if (p >= 14) out.push(res('Cleansing Touch', Math.max(1, mods.cha), 'long', 'Paladin'));
  }
  if (lv('druid', 0) >= 2) {
    const d = lv('druid');
    const moon = subOf('druid').includes('moon');
    const cr = moon ? (d >= 6 ? Math.max(1, Math.floor(d / 3)) : 1) : d >= 8 ? 1 : d >= 4 ? '1/2' : '1/4';
    out.push(res('Wild Shape', d >= 20 ? null : 2, 'short', 'Druid', {
      note: `Beasts up to CR ${cr}` + (d >= 8 ? '' : d >= 4 ? ', no flying' : ', no flying or swimming')
        + `, for up to ${Math.floor(d / 2)} hours.` + (moon ? ' Bonus action for you (Combat Wild Shape).' : '') }));
  }
  if (lv('fighter')) {
    const f = lv('fighter');
    out.push(res('Second Wind', 1, 'short', 'Fighter', { die: 'd10', note: `Bonus action: regain 1d10 + ${f} hit points.` }));
    out[out.length - 1].heal = f;
    if (f >= 2) out.push(res('Action Surge', f >= 17 ? 2 : 1, 'short', 'Fighter', { note: 'One extra action on your turn (once per turn).' }));
    if (f >= 9) out.push(res('Indomitable', step(f, [[9, 1], [13, 2], [17, 3]]), 'long', 'Fighter', { note: 'Reroll a failed saving throw.' }));
    if (subOf('fighter').startsWith('battle-master') && f >= 3) {
      out.push(res('Superiority Dice', step(f, [[3, 4], [7, 5], [15, 6]]), 'short', 'Battle Master', {
        die: step(f, [[3, 'd8'], [10, 'd10'], [18, 'd12']]),
        note: `Maneuver save DC ${8 + prof + Math.max(mods.str, mods.dex)}.` }));
    }
  }
  if (lv('monk', 0) >= 2) out.push(res('Ki', lv('monk'), 'short', 'Monk', { note: `Ki save DC ${8 + prof + mods.wis}.` }));
  if (lv('sorcerer', 0) >= 2) out.push(res('Sorcery Points', lv('sorcerer'), 'long', 'Sorcerer'));
  if (subOf('sorcerer').includes('wild-magic') && lv('sorcerer')) {
    out.push(res('Tides of Chaos', 1, 'long', 'Wild Magic', { note: 'Advantage on one attack, check or save.' }));
  }
  if (lv('warlock', 0) >= 11) {
    for (const [at, spellLevel] of [[11, 6], [13, 7], [15, 8], [17, 9]]) {
      if (lv('warlock') >= at) out.push(res(`Mystic Arcanum (${spellLevel}th level)`, 1, 'long', 'Warlock', { key: `arcanum-${spellLevel}` }));
    }
  }
  if (subOf('warlock').includes('hexblade') && lv('warlock')) {
    out.push(res("Hexblade's Curse", 1, 'short', 'Hexblade', {
      note: `Bonus action, 30 feet: +${prof} damage against the target, crits on 19-20, heal ${lv('warlock') + Math.max(1, mods.cha)} if it dies.` }));
  }
  if (lv('wizard')) {
    const levels = Math.ceil(lv('wizard') / 2);
    out.push(res('Arcane Recovery', 1, 'long', 'Wizard', {
      note: `Once a day after a short rest: recover spell slots totalling up to ${plural(levels, 'level')} (none 6th or higher).` }));
    out[out.length - 1].levels = levels;
  }
  if (subOf('wizard').includes('divination') && lv('wizard', 0) >= 2) {
    out.push(res('Portent', lv('wizard') >= 14 ? 3 : 2, 'long', 'Divination', {
      note: 'Roll the dice after a long rest and swap one for any d20 roll you can see.' }));
  }
  if (lv('artificer', 0) >= 7) {
    out.push(res('Flash of Genius', Math.max(1, mods.int), 'long', 'Artificer', { note: `Reaction: +${Math.max(0, mods.int)} to a check or save within 30 feet.` }));
  }
  if (lv('rogue', 0) >= 20) out.push(res('Stroke of Luck', 1, 'short', 'Rogue'));
  return out;
}

const USES_RE = /(?:you can|can) (?:use (?:this|it) (?:feature|trait|ability)?|do so|use it) ?(once|twice|three times|four times)/;
const ONCE_RE = new RegExp("once you use (?:this|it|the) (?:feature|trait|ability)?|you can't (?:use (?:it|this (?:feature|trait))|do so) again until|"
  + 'once with this trait|once without expending a spell slot|once per (?:short|long) rest|cast (?:it|this spell|the spell|that spell) once');

/** [max, reset] from a feature's own words, or null. */
export function readText(name, text, mods, prof) {
  const low = (text || '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
  if (!low) return null;
  let count = null;
  let m = low.match(/a number of times equal to (1 \+ )?your (strength|dexterity|constitution|intelligence|wisdom|charisma) modifier/);
  if (m) count = Math.max(1, (m[1] ? 1 : 0) + mods[ABILITY_WORDS[m[2]]]);
  else if (/a number of times equal to (?:your |twice your )?proficiency bonus/.test(low)) {
    count = prof * (low.includes('twice your proficiency') ? 2 : 1);
  } else {
    m = low.match(USES_RE);
    if (m) count = COUNT_WORDS[m[1]];
    else if (ONCE_RE.test(low)) count = 1;
  }
  if (count === null) return null;
  let reset;
  if (/short or long rest|short rest or a long rest|short rest/.test(low)) reset = 'short';
  else if (/long rest|at dawn|each dawn|next dawn/.test(low)) reset = 'long';
  else return null;
  return [count, reset];
}

/** Resources read out of feature, trait and feat text that the class table doesn't cover. */
export function fromFeatures(features, mods, prof, skip = [], level = 20) {
  const out = [], seen = new Set(skip);
  for (const f of features) {
    const name = (f.name || '').trim();
    const low = name.toLowerCase();
    if (!name || TABLE_NAMES.has(low) || low.startsWith('channel divinity') || seen.has(id(name))) continue;
    const src = f.source || '';
    if (src === 'Magic item') continue;
    const m = (f.text || '').toLowerCase().match(/(?:once|when) you reach (\d+)(?:st|nd|rd|th) level, you can cast/);
    if (m && level < parseInt(m[1], 10)) continue;
    let got = readText(name, f.text, mods, prof);
    if (!got && f.kind === 'race' && RACE_TABLE.get(low)) got = RACE_TABLE.get(low);
    if (!got) continue;
    seen.add(id(name));
    out.push(res(name, got[0], got[1], src));
  }
  return out;
}

export function compute(levelOf, subclassSlug, mods, prof, feats, features, level = null) {
  const out = classTable(levelOf, subclassSlug, mods, prof);
  if ((feats || []).some((f) => (f.name || '').trim().toLowerCase() === 'lucky')) {
    out.push(res('Luck Points', 3, 'long', 'Lucky feat', { note: 'Spend one to roll an extra d20 for an attack, check or save.' }));
  }
  const featureRows = features.filter((f) => !(f.source === 'Feat' && (f.name || '').trim().toLowerCase() === 'lucky'));
  level = level || Object.values(levelOf).reduce((a, b) => a + b, 0) || 1;
  out.push(...fromFeatures(featureRows, mods, prof, out.map((r) => r.id), level));
  return out;
}

export const CLASS_WORDS = ['artificer', 'barbarian', 'bard', 'cleric', 'druid', 'fighter', 'monk', 'paladin', 'ranger', 'rogue',
  'sorcerer', 'warlock', 'wizard'];
const CLASS_TEXT_RE = new RegExp(`\\b(${CLASS_WORDS.join('|')})\\b\\s*(\\d{1,2})?(?:\\s*\\(([^)]+)\\))?`, 'g');

/** 'Fighter 5 / Wizard 2 (Battle Master)' -> [{fighter: 5, wizard: 2}, {fighter: 'battle-master'}] */
export function levelsFromText(classText) {
  const levels = {}, subs = {};
  const low = (classText || '').toLowerCase();
  for (const m of low.matchAll(CLASS_TEXT_RE)) {
    levels[m[1]] = (levels[m[1]] || 0) + parseInt(m[2] || '1', 10);
    if (!m[3]) continue;
    subs[m[1]] = id(m[3]);
  }
  for (const [word, cls] of [['battle master', 'fighter'], ['hexblade', 'warlock'], ['wild magic', 'sorcerer'], ['moon', 'druid']]) {
    if (low.includes(word) && Object.hasOwn(levels, cls) && !Object.hasOwn(subs, cls)) subs[cls] = id(word);
  }
  return [levels, subs];
}
