/* Creatures for familiars, companions, steeds, summons and Wild Shape, from the SRD 5.1 stat blocks
   in data/creatures.json (CC-BY-4.0, via the 5e-bits 5e-database project).

   Ported from the PC app's creatures.py; tests/helpers.test.mjs checks both give the same answers.
   The stat blocks are big, so they aren't imported with the module: call loadCreatures() once
   (it fetches the file, which the service worker keeps offline), or setCreatures(doc) with data
   you already have, before the lookups below. */

export const FAMILIARS = ['Bat', 'Cat', 'Crab', 'Frog', 'Hawk', 'Lizard', 'Octopus', 'Owl', 'Poisonous Snake', 'Quipper', 'Rat',
  'Raven', 'Sea Horse', 'Spider', 'Weasel'];
export const CHAIN_FAMILIARS = ['Imp', 'Pseudodragon', 'Quasit', 'Sprite'];
export const STEEDS = ['Warhorse', 'Pony', 'Camel', 'Elk', 'Mastiff'];
export const GREATER_STEEDS = ['Griffon', 'Pegasus', 'Dire Wolf', 'Rhinoceros', 'Saber-Toothed Tiger'];
export const ELEMENTALS = ['Air Elemental', 'Earth Elemental', 'Fire Elemental', 'Water Elemental'];
export const SMALL_SIZES = ['Tiny', 'Small', 'Medium'];

export const MODES = {
  familiar: 'Familiar (Find Familiar)',
  companion: 'Beast companion (Beast Master ranger)',
  steed: 'Steed (Find Steed)',
  wildshape: 'Wild Shape form',
  any: 'Summon or other creature',
};

const DATA_URL = new URL('../data/creatures.json', import.meta.url);
let creatures = null;
let loading = null;

/** Python truthiness: empty lists and objects count as false. */
const T = (v) => Boolean(v) && !(Array.isArray(v) && !v.length)
  && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const get = (obj, key, def) => (obj != null && Object.hasOwn(obj, key) ? obj[key] : def);

/** Use stat blocks already loaded: the whole creatures.json document, or just its list. */
export function setCreatures(doc) {
  creatures = Array.isArray(doc) ? doc : doc.creatures;
  return creatures;
}

/** Fetch data/creatures.json once (later calls share the same request). */
export function loadCreatures(url = DATA_URL) {
  if (creatures) return Promise.resolve(creatures);
  loading ||= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Couldn't load creatures (${r.status})`);
    return r.json();
  }).then(setCreatures).catch((e) => { loading = null; throw e; });
  return loading;
}

export function allCreatures() {
  if (!creatures) throw new Error('Creatures are not loaded yet: call loadCreatures() first.');
  return creatures;
}

export function byName(name) {
  const low = (name || '').trim().toLowerCase();
  return allCreatures().find((c) => c.name.toLowerCase() === low) ?? null;
}

// ---------------------------------------------------------- challenge ratings as fractions
// Python's fractions.Fraction, just enough for CR: exact values as BigInt [numerator, denominator].
const RATIONAL = /^\s*([-+]?)(?=\d|\.\d)(\d*|\d+(?:_\d+)*)(?:(?:\s*\/\s*(\d+(?:_\d+)*))?|(?:\.(\d*|\d+(?:_\d+)*))?(?:E([-+]?\d+(?:_\d+)*))?)\s*$/i;
/** Unicode decimal digits (Arabic-Indic, Devanagari...) as ASCII, as Python's int() and Fraction() read them. */
export function asciiDigits(s) {
  return s.replace(/\p{Nd}/gu, (ch) => {
    let start = ch.codePointAt(0);
    while (/\p{Nd}/u.test(String.fromCodePoint(start - 1))) start -= 1;  // digit blocks run 0-9, back to back
    return String((ch.codePointAt(0) - start) % 10);
  });
}
const babs = (x) => (x < 0n ? -x : x);
const gcd = (a, b) => { a = babs(a); b = babs(b); while (b) [a, b] = [b, a % b]; return a; };
const floorDiv = (a, b) => { const q = a / b; return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q; };
const reduce = (n, d) => {
  if (d === 0n) throw new RangeError(`Fraction(${n}, 0)`);
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1n;
  return [n / g, d / g];
};

/** Fraction(v): numbers are taken exactly (as Python does with floats), strings like "1/4" or "0.5" are parsed. */
function fraction(v) {
  if (typeof v === 'boolean') return [v ? 1n : 0n, 1n];
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new RangeError(`Cannot convert ${v} to a fraction`);
    let d = 1n;
    while (!Number.isInteger(v)) { v *= 2; d *= 2n; }  // doubling is exact, so this is the float's true value
    return reduce(BigInt(v), d);
  }
  if (typeof v === 'string') {
    const m = asciiDigits(v).match(RATIONAL);
    if (!m) throw new RangeError(`Invalid literal for Fraction: ${JSON.stringify(v)}`);
    const clean = (s) => (s || '').replace(/_/g, '');
    let n = BigInt(clean(m[2]) || '0');
    let d = 1n;
    if (m[3] !== undefined) d = BigInt(clean(m[3]));
    else {
      if (m[4]) { const dec = clean(m[4]); n = n * 10n ** BigInt(dec.length) + BigInt(dec); d = 10n ** BigInt(dec.length); }
      if (m[5]) { const e = BigInt(clean(m[5])); if (e >= 0n) n *= 10n ** e; else d *= 10n ** -e; }
    }
    if (m[1] === '-') n = -n;
    return reduce(n, d);
  }
  throw new TypeError('argument should be a string or a number');
}

/** Fraction.limit_denominator: the closest fraction with a denominator of at most `max`. */
function limitDenominator([num, den], max) {
  if (den <= max) return [num, den];
  let [p0, q0, p1, q1] = [0n, 1n, 1n, 0n];
  let [n, d] = [num, den];
  for (;;) {
    const a = floorDiv(n, d);
    const q2 = q0 + a * q1;
    if (q2 > max) break;
    [p0, q0, p1, q1] = [p1, q1, p0 + a * p1, q2];
    [n, d] = [d, n - a * d];
  }
  const k = floorDiv(max - q0, q1);
  if (2n * d * (q0 + k * q1) <= den) return [p1, q1];
  return [p0 + k * p1, q0 + k * q1];
}

export function crText(cr) {
  if (cr == null) return '?';
  const [n, d] = limitDenominator(fraction(cr), 8n);
  return d === 1n ? String(n) : `${n}/${d}`;
}

/** "1/4" -> 0.25; null when it isn't a number (Python's str(text) never parses for null, booleans or lists). */
export function crValue(text) {
  if (typeof text === 'number') {
    if (!Number.isFinite(text)) return null;
    return text + 0;  // -0 becomes 0, as float(Fraction(...)) never gives -0.0
  }
  if (typeof text !== 'string') return null;
  const m = asciiDigits(text.trim()).match(RATIONAL);
  if (!m) return null;
  const clean = (s) => (s || '').replace(/_/g, '');
  if (m[3] !== undefined) {
    const n = BigInt(clean(m[2]) || '0'), d = BigInt(clean(m[3]));
    if (d === 0n) return null;
    const [rn, rd] = reduce(m[1] === '-' ? -n : n, d);
    return Number(rn) / Number(rd) + 0;
  }
  // a decimal: Number() rounds the exact value correctly, as float(Fraction) does
  return Number(`${m[1]}${clean(m[2]) || '0'}.${clean(m[4]) || '0'}e${clean(m[5]) || '0'}`) + 0;
}

// ---------------------------------------------------------- stat blocks
export function speedText(speed) {
  speed = T(speed) ? speed : {};
  const parts = Object.hasOwn(speed, 'walk') || !T(speed) ? [T(speed.walk) ? `${speed.walk} ft.` : '0 ft.'] : [];
  for (const k of ['burrow', 'climb', 'fly', 'swim']) {
    if (T(get(speed, k))) parts.push(`${k} ${speed[k]} ft.` + (k === 'fly' && T(speed.hover) ? ' (hover)' : ''));
  }
  return parts.join(', ') || '0 ft.';
}

export function summary(c) {
  return { name: c.name, size: c.size, type: c.type, cr: c.cr, cr_text: crText(c.cr),
    ac: c.ac, hp: c.hp, speed: speedText(c.speed),
    fly: T(get(c.speed, 'fly')), swim: T(get(c.speed, 'swim')) };
}

export function full(c) {
  return { ...c, cr_text: crText(c.cr), speed_text: speedText(c.speed) };
}

/** 2014 Wild Shape limits for a druid level (null below 2nd). */
export function wildShapeRules(druidLevel, moon = false) {
  if (druidLevel < 2) return null;
  let maxCr;
  if (T(moon)) maxCr = druidLevel >= 6 ? Math.max(1, Math.floor(druidLevel / 3)) : 1;
  else maxCr = druidLevel >= 8 ? 1 : druidLevel >= 4 ? 0.5 : 0.25;
  const fly = druidLevel >= 8;
  const swim = druidLevel >= 4;
  const limits = fly ? [] : ['no flying speed', ...(swim ? [] : ['no swimming speed'])];
  let text = `Beasts of CR ${crText(maxCr)} or lower` + (limits.length ? `, ${limits.join(' or ')}` : '');
  const elementals = T(moon) ? druidLevel >= 10 : moon;
  if (T(elementals)) text += '. Elemental Wild Shape: spend two uses to become an air, earth, fire or water elemental';
  const hours = Math.floor(druidLevel / 2);
  return { max_cr: maxCr, cr_text: crText(maxCr), fly, swim, elementals,
    hours, text: text + `. Lasts up to ${hours} hour${hours !== 1 ? 's' : ''}.`,
    moon };
}

export function companionInfo(levelOf, subclassSlug, spellNames, optionNames, prof) {
  const spells = new Set(spellNames.map((s) => s.toLowerCase()));
  const opts = new Set(optionNames.map((o) => o.toLowerCase()));
  const ranger = get(levelOf, 'ranger', 0);
  const beastMaster = ranger >= 3 && (get(subclassSlug, 'ranger') || '').includes('beast');
  const druid = get(levelOf, 'druid', 0);
  return {
    prof,
    find_familiar: spells.has('find familiar') || opts.has('pact of the chain'),
    chain: opts.has('pact of the chain'),
    find_steed: spells.has('find steed') || spells.has('find greater steed'),
    greater_steed: spells.has('find greater steed'),
    beast_master: beastMaster, ranger_level: ranger,
    wild_shape: wildShapeRules(druid, (get(subclassSlug, 'druid') || '').includes('moon')),
  };
}

export function allowed(c, mode, info = null) {
  info = T(info) ? info : {};
  // Python's `a or (b and c)` hands back b itself when it's falsy (0 or None, say), so these can too
  const either = (base, flag, extra) => base.includes(c.name) || (T(flag) ? extra.includes(c.name) : flag);
  if (mode === 'familiar') return either(FAMILIARS, get(info, 'chain', true), CHAIN_FAMILIARS);
  if (mode === 'steed') return either(STEEDS, get(info, 'greater_steed', true), GREATER_STEEDS);
  if (mode === 'companion') return c.type === 'beast' && c.cr <= 0.25 && SMALL_SIZES.includes(c.size);
  if (mode === 'wildshape') {
    const ws = T(info.wild_shape) ? info.wild_shape : wildShapeRules(20);
    if (T(ws.elementals) && ELEMENTALS.includes(c.name)) return true;
    if (c.type !== 'beast' || c.cr > ws.max_cr) return false;
    if (T(get(c.speed, 'fly')) && !T(ws.fly)) return false;
    return !(T(get(c.speed, 'swim')) && !T(ws.swim));
  }
  return true;
}

export function search(q = '', mode = 'any', info = null, maxCr = null, limit = 400) {
  const words = (q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const c of allCreatures()) {
    const hay = `${c.name} ${c.type} ${c.size}`.toLowerCase();
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    if (maxCr != null && c.cr > maxCr) continue;
    if (!allowed(c, mode, info)) continue;
    out.push(summary(c));
  }
  // sorted by (cr, name); Array.prototype.sort is stable, like Python's
  out.sort((a, b) => (a.cr - b.cr) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return limit == null ? out : out.slice(0, limit);
}

// ---------------------------------------------------------- companions as they play
function addFlat(dice, n) {
  const m = (dice || '').match(/^\s*(\d*d\d+)?\s*([+-]\s*\d+)?\s*$/);
  if (!m) return dice;
  if (!m[1]) return String(parseInt((m[2] || '0').replace(/ /g, ''), 10) + n);
  const flat = parseInt((m[2] || '0').replace(/ /g, ''), 10) + n;
  return m[1] + (flat > 0 ? `+${flat}` : flat < 0 ? `${flat}` : '');
}

/** A companion's stat block as it plays. A Beast Master's companion (2014) adds the ranger's proficiency bonus
    to its AC, attack and damage rolls, and saves and skills it's proficient in, and has at least 4 HP per ranger level. */
export function effective(block, kind, info) {
  const b = JSON.parse(JSON.stringify(T(block) ? block : {}));
  if (kind === 'companion' && T((T(info) ? info : {}).beast_master)) {
    const p = info.prof || 2;
    const rangerLevel = info.ranger_level || 0;
    b.ac = (b.ac || 10) + p;
    b.hp = Math.max(b.hp || 0, 4 * rangerLevel);
    for (const a of T(b.actions) ? b.actions : []) {
      if (a.attack == null) continue;
      a.attack += p;
      if (!T(a.damage)) continue;
      a.damage[0].dice = addFlat(a.damage[0].dice, p);
    }
    b.skills = Object.fromEntries(Object.entries(T(b.skills) ? b.skills : {}).map(([k, v]) => [k, v + p]));
    b.saves = Object.fromEntries(Object.entries(T(b.saves) ? b.saves : {}).map(([k, v]) => [k, v + p]));
    b.bonus_note = `Ranger's Companion: +${p} to AC, attacks and damage; at least ${4 * rangerLevel} hit points.`;
  }
  return b;
}
