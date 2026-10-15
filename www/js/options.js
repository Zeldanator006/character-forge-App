/* Class options: the picks some class features give you.

   Ported from the PC app's options.py; tests/helpers.test.mjs checks both give the same answers.
   Two kinds of source:
   - option pages on the wiki, linked from the front page as a class's "Quick Links"
     (Eldritch Invocations, Battle Master maneuvers, artificer infusions, Four Elements disciplines...);
   - choices written into a class or subclass feature as a bold list (Fighting Style, Pact Boon,
     Metamagic, Hunter's Prey, Totem Spirit...).
   How many you may pick comes from the class table ("Invocations Known"), from the feature's own
   wording ("two of the following ... another one at 10th and 17th level"), or from KNOWN_COUNTS. */
import * as featRules from './feats.js';
import { ordinal } from './srd.js';
import { slugify } from './rules.js';
import { asciiDigits } from './creatures.js';

export const KNOWN_COUNTS = {
  '/fighter:battle-master:maneuvers': { 3: 3, 7: 5, 10: 7, 15: 9 },
  '/monk:four-elements:disciplines': { 3: 1, 6: 2, 11: 3, 17: 4 },
};
export const PACT_KEYS = { 'pact of the blade': 'has', 'improved pact weapon': 'improved', 'thirsting blade': 'thirsting',
  'eldritch smite': 'smite', lifedrinker: 'lifedrinker' };

/** Python truthiness: empty lists and objects count as false. */
const T = (v) => Boolean(v) && !(Array.isArray(v) && !v.length)
  && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const or = (v, def) => (T(v) ? v : def);
/** Python's str(): what an id looks like as a dict key. */
const pyStr = (v) => (v == null ? 'None' : v === true ? 'True' : v === false ? 'False' : String(v));
const clamp = (lvl) => Math.max(1, Math.min(20, lvl));
const title = (s) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

/** int(str(v).strip()): whole numbers and numeric strings (not booleans, which str() spells "True"). */
function int(v, def = 0) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : def;
  if (typeof v === 'string') {
    const s = asciiDigits(v);
    if (/^\s*[-+]?\d+(?:_\d+)*\s*$/.test(s)) return parseInt(s.replace(/_/g, ''), 10);
  }
  return def;
}

/** {level: total} -> the total at `level` (keys may be strings after a trip through JSON). */
export function atLevel(steps, level) {
  let bestLevel = -1, best = 0;
  for (const [key, v] of Object.entries(or(steps, {}))) {
    const k = int(key);
    if (bestLevel < k && k <= level) [bestLevel, best] = [k, v];
  }
  return best;
}

/** A count from the class table, like 'Invocations Known' for Eldritch Invocations. */
export function tableKnown(table, level, label) {
  const words = ((label || '').toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length >= 5);
  if (!words.length) return null;
  for (const row of table || []) {
    if (row._level !== level) continue;
    for (const [col, val] of Object.entries(row)) {
      const low = String(col).toLowerCase();
      if (low.includes('known') && words.some((w) => low.includes(w.replace(/s+$/, '').slice(0, 6)))) {
        const m = pyStr(val).match(/\d+/);
        return m ? parseInt(m[0], 10) : 0;
      }
    }
  }
  return null;
}

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export const classSlug = (c) => c.slug || slugify(c.name);

function subclassSlug(c) {
  const sub = or(c.subclass, {});
  return sub.path ? sub.path.split(':').pop() : norm(sub.name).replace(/ /g, '-');
}

const EXTRA_OPTION_RE = /(?:second|another|additional) option from the ([\p{L}\p{N}_' ]+?) (?:class )?feature/iu;

/** Groups that come from features with a bold list of choices (no network needed). */
export function featureGroups(char, ctx) {
  const out = [];
  const classes = (char.classes || []).filter((c) => c.name);
  const cctx = ctx.classes || [];
  classes.slice(0, cctx.length).forEach((c, i) => {
    const cc = cctx[i];
    const slug = classSlug(c), lvl = clamp(int(c.level, 1));
    const detail = or(cc.detail, {}), sub = or(cc.subclass, {});
    const subLevel = int(or(cc.rules, {}).subclass_level, 3) || 3;
    const feats = (detail.features || []).map((f) => [f, f.level || 1]);
    if (T(sub) && T(c.subclass) && lvl >= subLevel) feats.push(...(sub.features || []).map((f) => [f, f.level || subLevel]));
    const groups = new Map();
    for (const [f, flevel] of feats) {
      if (flevel > lvl) continue;
      if (!T(f.options)) continue;
      const count = atLevel(f.choose, lvl) || 1;
      const key = `${slug}|${f.name}`;
      if (!groups.has(key)) {
        groups.set(key, { key, class: slug, class_name: c.name, class_level: lvl,
          label: f.name, count, source: 'feature', options: f.options,
          error: '' });
      }
    }
    for (const [f, flevel] of feats) {
      if (flevel > lvl) continue;
      const m = (f.text || '').match(EXTRA_OPTION_RE);
      if (!m) continue;
      for (const g of groups.values()) {
        if (norm(g.label) === norm(m[1])) g.count += 1;
      }
    }
    out.push(...groups.values());
  });
  return out;
}

export function pageCount(path, slug, level, detail, label) {
  const known = tableKnown(or(detail, {}).table, level, label);
  if (known !== null) return known;
  if (Object.hasOwn(KNOWN_COUNTS, path)) return atLevel(KNOWN_COUNTS[path], level);
  return null;
}

/** A page under a subclass (/fighter:battle-master:maneuvers) only counts for that subclass. */
export function pageApplies(path, charClass) {
  const segs = path.replace(/^\/+|\/+$/g, '').split(':');
  if (segs.length < 3) return true;
  return subclassSlug(charClass).startsWith(segs[1]);
}

/** Python's `x in coll` for a list, set or string. */
const isIn = (x, coll) => (coll instanceof Set ? coll.has(x) : coll.includes(x));

/** Why an option's prerequisite isn't met yet ('' when it is, or when we can't tell). */
export function unmet(prereq, info) {
  const p = (prereq || '').toLowerCase();
  if (!p) return '';
  const reasons = [];
  let m = p.match(/(\d+)(?:st|nd|rd|th)[- ]level/);
  if (m && info.level < parseInt(m[1], 10)) reasons.push(`needs ${ordinal(parseInt(m[1], 10))} level`);
  for (const pact of ['blade', 'chain', 'tome', 'talisman']) {
    if (p.includes(`pact of the ${pact}`) && !isIn(`pact of the ${pact}`, info.picked)) reasons.push(`needs Pact of the ${title(pact)}`);
  }
  m = p.match(/([a-z' ]+?) cantrip/);
  if (m) {
    let spell = m[1].trim().split(' or ').pop().trim();
    spell = spell.replace(/^(the|a|an)\s+/, '');
    if (spell && !isIn(spell, info.spells)) reasons.push(`needs the ${spell} cantrip`);
  }
  m = p.match(/(?:the )?([a-z' ]+?) patron/);
  if (m) {
    const patron = m[1].trim().replaceAll('the ', '');
    if (patron && !isIn(patron, info.subclass)) reasons.push(`needs the ${title(patron)} patron`);
  }
  return reasons.join('; ');
}

export function markUnmet(groups, char) {
  const picked = new Set((char.class_options || []).map((o) => (o.name || '').toLowerCase()));
  const spells = new Set((char.spells || []).map((s) => (s.name || '').toLowerCase()));
  const classes = new Map((char.classes || []).filter((c) => c.name).map((c) => [classSlug(c), c]));
  for (const g of groups) {
    const c = classes.get(g.class) || {};
    const info = { level: g.class_level, picked, spells,
      subclass: ((or(c.subclass, {})).name || '').toLowerCase() };
    for (const o of g.options) {
      if (T(g.needs_class) && T(o.prerequisite)) o.unmet = `only a ${g.class} can take this one through the feat`;
      else o.unmet = unmet(o.prerequisite, info);
    }
  }
  return groups;
}

/** {group key: how many may be picked} for the rules checks (no network). */
export function allowedCounts(char, ctx) {
  const out = Object.fromEntries(featureGroups(char, ctx).map((g) => [g.key, g.count]));
  for (const [g] of featLists(char, ctx)) out[g.key] = g.count;
  const classes = (char.classes || []).filter((c) => c.name);
  const cctx = ctx.classes || [];
  classes.slice(0, cctx.length).forEach((c, i) => {
    const cc = cctx[i];
    const slug = classSlug(c), lvl = clamp(int(c.level, 1));
    for (const o of char.class_options || []) {
      const key = o.key || '';
      if (key.startsWith(`${slug}|/`) && !Object.hasOwn(out, key)) {
        out[key] = pageCount(key.slice(key.indexOf('|') + 1), slug, lvl, cc.detail ?? null, o.label ?? null);
      }
    }
  });
  return out;
}

/** Option lists that feats open up: [group stub, list spec] pairs, without the options themselves. */
export function featLists(char, ctx) {
  const out = [];
  const levels = new Map((char.classes || []).filter((c) => c.name).map((c) => [classSlug(c), clamp(int(c.level, 1))]));
  const total = [...levels.values()].reduce((a, b) => a + b, 0) || 1;
  for (const f of char.feats || []) {
    const featDetails = or(ctx.feats, {}), fid = pyStr(f.id);
    const d = or(Object.hasOwn(featDetails, fid) ? featDetails[fid] : null, {});
    const g = featRules.grants(f.name, d.text || f.text || '');
    const fkey = featRules.featKey(f);
    for (const [listId, n] of g.lists) {
      const spec = featRules.LISTS[listId];
      out.push([{ key: `feat:${fkey}|${listId}`, class: spec.class, class_name: f.name || 'Feat',
        class_level: levels.has(spec.class) ? levels.get(spec.class) : total, label: spec.label, count: n,
        source: 'feat', feat: f.name ?? null, options: [], error: '',
        needs_class: Boolean(spec.prereq_needs_class) && !levels.has(spec.class) }, spec]);
    }
    if (!T(g.inline)) continue;
    const inline = g.inline;
    out.push([{ key: `feat:${fkey}|inline`, class: '', class_name: f.name || 'Feat',
      class_level: total, label: inline.label, count: inline.count, source: 'feat',
      feat: f.name ?? null, options: inline.options.map((o) => ({ ...o })), error: '',
      needs_class: false }, null]);
  }
  return out;
}

/** Pact of the Blade and its invocations, from the options picked. */
export function pactFlags(char) {
  const flags = {};
  for (const o of char.class_options || []) {
    const name = (o.name || '').trim().toLowerCase();
    if (Object.hasOwn(PACT_KEYS, name)) flags[PACT_KEYS[name]] = true;
  }
  return flags;
}
