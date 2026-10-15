/* Level up: what changes when a character gains a level in one class, worked out by comparing the sheet
   before and after, plus the bookkeeping for hit point rolls.

   Ported from the PC app's levelup.py; tests/levelup.test.mjs checks both give the same answers. The PC app
   reaches its library through a module; here the library is passed in: anything with get(id) (a library entry
   or null) and buildContext(char), such as library.js's Library. withLibrary(lib) binds it once. */
import * as rules from './rules.js';
import * as classOpts from './options.js';
import { classRules } from './library.js';
import { ABILITIES, ordinal } from './srd.js';
import { T, or, get, pyStr, strInt, list, setdefault } from './py.js';

const badChoice = (message) => Object.assign(new Error(message), { status: 400 });
const strictInt = (v) => {
  if (typeof v === 'number' && Number.isInteger(v)) return v;
  if (typeof v === 'boolean') return Number(v);
  if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return parseInt(v, 10);
  throw badChoice("That class isn't in the library.");
};
const copy = (v) => structuredClone(v);

/** A copy of the character with one more level: choice is {class_index: i} or {class_id: entry id}.
    Returns [new character, index of the class that went up]. */
export function bumped(char, choice, lib) {
  const after = copy(char);
  delete after.snapshots;
  const classes = setdefault(after, 'classes', []);
  if (T(get(choice, 'class_id'))) {
    const e = lib.get(strictInt(choice.class_id));
    if (!T(e) || get(e, 'kind') !== 'class') throw badChoice("That class isn't in the library.");
    const slug = classRules(e).slug;
    for (const [i, c] of classes.entries()) {
      if (get(c, 'slug') === slug) {
        c.level = strInt(get(c, 'level'), 1) + 1;
        return [after, i];
      }
    }
    classes.push({ id: e.id, name: e.name, slug, level: 1, subclass: null });
    return [after, classes.length - 1];
  }
  const i = strInt(get(choice, 'class_index'), -1);
  if (!(i >= 0 && i < classes.length)) throw badChoice('Pick a class to level up.');
  classes[i].level = strInt(get(classes[i], 'level'), 1) + 1;
  return [after, i];
}

/** Where this level's hit point roll goes in hp_rolls (rolls skip your very first level, then run class by class). */
export function rollIndex(classes, idx) {
  let pos = 0;
  classes.slice(0, Math.max(0, idx + 1)).forEach((c, i) => {
    const lvl = strInt(get(c, 'level'), 1);
    if (i < idx) pos += lvl - (i === 0 ? 1 : 0);
    else pos += lvl - 1 - (i === 0 ? 1 : 0);
  });
  return Math.max(0, pos);
}

const pairKey = (f) => JSON.stringify([get(f, 'name'), get(f, 'source')]);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function preview(char, choice, lib) {
  const beforeCtx = lib.buildContext(char);
  const before = rules.compute(char, beforeCtx);
  const [afterChar, idx] = bumped(char, choice, lib);
  const afterCtx = lib.buildContext(afterChar);
  const after = rules.compute(afterChar, afterCtx);
  const cls = afterChar.classes[idx];
  const crules = idx < afterCtx.classes.length ? afterCtx.classes[idx].rules : {};
  const newLevel = strInt(get(cls, 'level'), 1);
  const die = strInt(get(crules, 'hit_die'), 8) || 8;
  const total = after.total_level;

  const seen = new Set(before.features.map(pairKey));
  const newFeatures = after.features.filter((f) => !seen.has(pairKey(f)) && get(f, 'kind') !== 'race')
    .map((f) => ({ name: f.name, source: or(get(f, 'source'), ''), text: or(get(f, 'text'), '') }));

  const subLevel = strInt(get(crules, 'subclass_level'), 3);
  const needsSubclass = !T(get(or(get(cls, 'subclass'), {}), 'name')) && newLevel >= subLevel;

  const spells = [];
  const bySlug = {};
  for (const c of before.spellcasting) bySlug[c.slug] = c;
  for (const c of after.spellcasting) {
    if (get(c, 'type') === 'feat') continue;
    const b = get(bySlug, c.slug, {});
    const change = { class: c.class, slug: c.slug, new: !T(b) };
    for (const k of ['cantrips_known', 'spells_known', 'prepared_count']) {
      if (get(c, k) !== null && get(c, k) !== get(b, k)) change[k] = [get(b, k), get(c, k)];
    }
    if (get(c, 'max_spell_level') !== get(b, 'max_spell_level')) change.max_spell_level = [get(b, 'max_spell_level'), get(c, 'max_spell_level')];
    if (Object.keys(change).length > 3 || change.new) spells.push(change);
  }
  const slots = [];
  before.slots.forEach((a, n) => {
    const z = after.slots[n];
    if (n < after.slots.length && a !== z) slots.push({ level: n + 1, before: a, after: z });
  });
  const pact = same(get(before, 'pact'), get(after, 'pact')) ? null : { before: get(before, 'pact'), after: get(after, 'pact') };

  const groups = (ch, ctx) => {
    const out = new Map();
    for (const g of classOpts.featureGroups(ch, ctx)) out.set(g.key, g);
    return out;
  };
  const gb = groups(char, beforeCtx), ga = groups(afterChar, afterCtx);
  const picked = new Map();
  for (const o of list(or(get(afterChar, 'class_options'), []))) picked.set(get(o, 'key'), (picked.get(get(o, 'key')) || 0) + 1);
  const options = [];
  for (const [key, g] of ga) {
    const was = or(get(or(gb.get(key), {}), 'count'), 0);
    const now = get(g, 'count');
    if (now !== null && now > was) {
      options.push({ key, label: get(g, 'label'), class_name: get(g, 'class_name'), before: was, after: now,
        picked: picked.get(key) || 0 });
    }
  }

  const slug = or(get(cls, 'slug'), '');
  const classGroups = [...ga].filter(([, g]) => get(g, 'class') === slug && !pyStr(or(get(g, 'source'), '')).startsWith('feat'))
    .map(([key, g]) => ({ key, label: get(g, 'label'), count: get(g, 'count'), picked: picked.get(key) || 0 }));
  const wsBefore = get(or(get(or(get(before, 'companions'), {}), 'wild_shape'), {}), 'text');
  const wsAfter = get(or(get(or(get(after, 'companions'), {}), 'wild_shape'), {}), 'text');

  const rb = {};
  for (const r of list(or(get(before, 'resources'), []))) rb[r.id] = r;
  const resources = [];
  for (const r of list(or(get(after, 'resources'), []))) {
    const old = get(rb, r.id);
    if (!T(old)) resources.push({ name: r.name, before: null, after: r.max, die: get(r, 'die') });
    else if (get(old, 'max') !== get(r, 'max') || get(old, 'die') !== get(r, 'die')) {
      resources.push({ name: r.name, before: get(old, 'max'), after: r.max, die: get(r, 'die'), die_before: get(old, 'die') });
    }
  }

  const mc = after.warnings.filter((w) => w.startsWith('Multiclassing'));
  const beforeHp = before.hp_max;
  const avg = Math.floor(die / 2) + 1;
  return {
    class_index: idx, class_name: get(cls, 'name'), slug: get(cls, 'slug'),
    new_class: T(get(choice, 'class_id')) && idx === afterChar.classes.length - 1 && newLevel === 1,
    new_level: newLevel, total_level: total, class_line: after.class_line,
    hp: { die, average: avg, con: after.mods.con, before: beforeHp,
      after_average: after.hp_max, roll_index: rollIndex(afterChar.classes, idx),
      mode: or(get(char, 'hp_mode'), 'average'), extra: after.hp_max - beforeHp - Math.max(1, avg + after.mods.con) },
    prof: [before.prof, after.prof],
    features: newFeatures, needs_subclass: needsSubclass, subclass_level: subLevel,
    asi: after.asi.available - before.asi.available,
    spells, slots, pact, options, resources,
    multiclass_problems: mc, class_groups: classGroups,
    caster: after.spellcasting.some((c) => c.slug === slug) || Boolean(T(get(after, 'pact')) && slug === 'warlock'),
    wild_shape: T(wsAfter) && wsAfter !== wsBefore ? [wsBefore, wsAfter] : null,
    summary: `${pyStr(get(cls, 'name'))} ${ordinal(newLevel)} level (character level ${total})`,
  };
}

/** Record this level's hit points. mode 'average' or 'rolled' (value = the die roll). Switching an
    average character to rolled fills earlier levels with the average so nothing else changes. */
export function applyHp(char, idxRoll, die, mode, value = null) {
  const avg = Math.floor(die / 2) + 1;
  let rolls = [...list(or(get(char, 'hp_rolls'), []))];
  if (get(char, 'hp_mode') !== 'rolled') {
    if (mode !== 'rolled') return char;
    // earlier levels keep taking the average (0 means "average" in hp_rolls)
    char.hp_mode = 'rolled';
    rolls = Array(Math.max(0, idxRoll)).fill(0);
  }
  while (rolls.length < idxRoll) rolls.push(0);
  const at = idxRoll < 0 ? Math.max(0, rolls.length + idxRoll) : idxRoll;
  rolls.splice(at, 0, mode === 'rolled' ? Math.max(1, Math.min(die, strInt(value, avg))) : avg);
  char.hp_rolls = rolls;
  return char;
}

/** Apply a level up chosen in the dialog. data: hp_mode, hp_roll, subclass {id, name, path}, asi {ab: n}. */
export function apply(char, choice, data, lib) {
  const snap = copy(char);
  delete snap.snapshots;
  const [after, idx] = bumped(char, choice, lib);
  const ctx = lib.buildContext(after);
  const crules = idx < ctx.classes.length ? ctx.classes[idx].rules : {};
  const die = strInt(get(crules, 'hit_die'), 8) || 8;
  const isFirst = idx === 0 && strInt(get(after.classes[0], 'level'), 1) === 1;
  if (!isFirst) {
    applyHp(after, rollIndex(after.classes, idx), die, or(get(data, 'hp_mode'), 'average'), get(data, 'hp_roll'));
  }
  const sub = get(data, 'subclass');
  if (T(sub) && T(get(sub, 'name'))) after.classes[idx].subclass = { id: get(sub, 'id'), name: sub.name, path: or(get(sub, 'path'), '') };
  const imp = setdefault(after, 'improvements', {});
  for (const [ab, n] of Object.entries(or(get(data, 'asi'), {}))) {
    if (ABILITIES.includes(ab) && strInt(n)) imp[ab] = strInt(get(imp, ab)) + strInt(n);
  }
  const snaps = [...list(or(get(char, 'snapshots'), []))];
  snaps.push({ label: `Before ${pyStr(after.classes[idx].name)} ${pyStr(after.classes[idx].level)}`, character: snap });
  after.snapshots = snaps.slice(-5);
  return after;
}

/** The functions above with the library filled in. */
export function withLibrary(lib) {
  return {
    bumped: (char, choice) => bumped(char, choice, lib),
    preview: (char, choice) => preview(char, choice, lib),
    apply: (char, choice, data) => apply(char, choice, data, lib),
    applyHp, rollIndex,
  };
}
