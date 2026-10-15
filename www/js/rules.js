/* 2014 rules math: turns a character's choices into the numbers on the sheet.

   compute(char, ctx) is pure: `char` is the saved character, `ctx` holds the looked-up
   details for its classes, subclasses, race, background, feats and spells (built by
   library.buildContext). Problems are returned as warnings rather than errors, so a
   half-finished character still shows a sheet. computeManual() does the same for a sheet the
   player fills in by hand, computeAny() picks between them, and toManual() turns a built
   character into a hand-written one. A line-by-line port of the PC app's rules.py;
   tests/parity.test.mjs checks both give the same answers. */
import * as featRules from './feats.js';
import * as gear from './gear.js';
import * as classOpts from './options.js';
import * as classResources from './resources.js';
import * as creatures from './creatures.js';
import {
  ABILITIES, ABILITY_NAMES, CANTRIPS_KNOWN, DEFAULT_ASI_LEVELS, FULL_CASTER_SLOTS, MULTICLASS_PROFS, PACT_SLOTS,
  POINT_BUY_BUDGET, POINT_BUY_COST, SKILLS, SPELLS_KNOWN, STANDARD_ARRAY, WEAPONS, modifier, ordinal, proficiencyBonus,
} from './srd.js';
import { T, or, get, isDict, pyStr, jsonKey, toInt, fmtG, title, sorted, list, sum, setdefault } from './py.js';

export { toInt };

export const HIDDEN_RACE_TRAITS = new Set(['ability score increase', 'age', 'alignment', 'size', 'speed', 'languages',
  'creature type', 'language']);

const fmt = (n) => (n >= 0 ? `+${n}` : String(n));
/** A name as a URL-style slug. A function declaration, so modules that import it back from here can use it at load time. */
export function slugify(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
const has = (obj, key) => typeof key === 'string' && Object.hasOwn(obj, key);
const orStr = (v) => (T(v) ? v : '');
const hasFeat = (feats, name) => feats.some((f) => orStr(get(f, 'name')).trim().toLowerCase() === name.toLowerCase());
const firstInt = (v) => { const m = pyStr(v).match(/\d+/); return m ? parseInt(m[0], 10) : null; };
const maxOf = (arr) => (arr.length ? Math.max(...arr) : 0);
const eqList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const desc = (arr) => [...arr].sort((x, y) => y - x);
const classSlugOf = (c) => or(get(c, 'slug'), slugify(get(c, 'name')));

export function abilityScores(char, warnings) {
  const base = or(get(char, 'base_scores'), {});
  const raceBonus = or(get(char, 'race_bonus'), {});
  const improvements = or(get(char, 'improvements'), {});
  const scores = {}, parts = {};
  const featBonus = {};
  for (const f of list(or(get(char, 'feats'), []))) {
    const ab = get(f, 'asi'), amt = toInt(get(f, 'asi_amount'), 0);
    if (ABILITIES.includes(ab) && amt) featBonus[ab] = get(featBonus, ab, 0) + amt;
  }
  for (const a of ABILITIES) {
    const b = toInt(get(base, a), 10), r = toInt(get(raceBonus, a)), i = toInt(get(improvements, a)), f = get(featBonus, a, 0);
    scores[a] = b + r + i + f;
    parts[a] = { base: b, race: r, asi: i, feat: f };
    if (scores[a] > 20) warnings.push(`${ABILITY_NAMES[a]} is ${scores[a]}; scores normally cap at 20.`);
  }
  const method = or(get(char, 'ability_method'), 'manual');
  const vals = ABILITIES.map((a) => toInt(get(base, a), 10));
  if (method === 'point_buy') {
    if (vals.some((v) => v < 8 || v > 15)) warnings.push('Point buy scores must be between 8 and 15 before bonuses.');
    else {
      const spent = sum(vals.map((v) => POINT_BUY_COST[v]));
      if (spent > POINT_BUY_BUDGET) warnings.push(`Point buy uses ${spent} points; the budget is ${POINT_BUY_BUDGET}.`);
    }
  } else if (method === 'standard') {
    if (!eqList(desc(vals), STANDARD_ARRAY)) warnings.push('Standard array scores should be 15, 14, 13, 12, 10 and 8, each used once.');
  }
  return [scores, parts];
}

function picksText(picks) {
  return picks.map((p) => {
    const n = toInt(get(p, 'count'), 1);
    const word = get({ 1: 'one score', 2: 'two different scores', 3: 'three different scores' }, String(n), `${n} different scores`);
    const not = T(get(p, 'exclude')) ? ` (not ${p.exclude.map((a) => ABILITY_NAMES[a]).join(', ')})` : '';
    return `+${pyStr(get(p, 'amount'))} to ${word}${not}`;
  }).join(' and ');
}

function amounts(fixed, picks) {
  const out = Object.values(fixed).filter((v) => v);
  for (const p of list(or(picks, []))) out.push(...Array(Math.max(0, toInt(get(p, 'count'), 1))).fill(toInt(get(p, 'amount'), 1)));
  return desc(out);
}

/** Does race_bonus match what the species gives? {ok, message, expect}, or null when there's nothing to check.
    With Customizing Your Origin (Tasha's) the same increases may go on any scores. */
export function raceAsiCheck(char, raceInfo) {
  if (!T(raceInfo) || !T(get(or(get(char, 'race'), {}), 'id'))) return null;
  const fixed = {};
  for (const [a, v] of Object.entries(or(get(raceInfo, 'asi'), {}))) if (toInt(v)) fixed[a] = toInt(v);
  const picks = list(or(get(raceInfo, 'asi_choice'), []));
  const alt = or(get(raceInfo, 'asi_alt'), null);
  if (!T(fixed) && !T(picks)) return null;
  if (T(get(raceInfo, 'asi_flexible')) && !T(picks)) return null;
  const rb = or(get(char, 'race_bonus'), {});
  const bonus = Object.fromEntries(ABILITIES.map((a) => [a, toInt(get(rb, a))]));
  const given = desc(Object.values(bonus).filter((v) => v));
  let expect = [Object.entries(fixed).map(([a, v]) => `+${v} ${ABILITY_NAMES[a]}`).join(', '), picksText(picks)].filter(Boolean).join(' and ');
  if (T(alt)) expect += `, or ${picksText(alt)}`;
  if (Object.values(bonus).some((v) => v < 0)) return { ok: false, expect, message: 'Species bonuses can’t be negative.' };
  if (T(get(char, 'custom_origin'))) {
    const options = [amounts(fixed, picks), ...(T(alt) ? [amounts(fixed, alt)] : [])];
    if (options.some((o) => eqList(o, given))) {
      return { ok: true, expect, message: 'Customizing your origin: your species’ increases are on the scores you chose.' };
    }
    const want = options.map((o) => o.map((v) => `+${v}`).join(', ')).join(' or ');
    return { ok: false, expect,
      message: `With Customizing Your Origin you move your species’ increases (${want}) to any scores, but these add up to `
        + `${given.map((v) => `+${v}`).join(', ') || 'nothing'}.` };
  }
  const short = Object.entries(fixed).filter(([a, v]) => bonus[a] < v).map(([a]) => a);
  if (short.length) {
    return { ok: false, expect,
      message: `Your species gives ${expect}; ${short.map((a) => ABILITY_NAMES[a]).join(', ')} is missing some. Turn on Customizing Your Origin if you moved it.` };
  }
  // what's left once the fixed increases are taken out has to fit the "pick N scores" part
  const left = {};
  for (const a of ABILITIES) if (bonus[a] - get(fixed, a, 0)) left[a] = bonus[a] - get(fixed, a, 0);
  const fits = (pk) => {
    if (!eqList(desc(Object.values(left)), amounts({}, pk))) return false;
    // "+1 to two different scores (not Charisma)"
    const banned = new Set();
    for (const p of list(pk)) for (const x of list(or(get(p, 'exclude'), []))) banned.add(x);
    return !Object.keys(left).some((a) => banned.has(a));
  };
  if (fits(picks) || (T(alt) && fits(alt))) {
    if (T(picks) && !T(left)) return { ok: false, expect, message: `Pick your species’ increases: ${expect}.` };
    return { ok: true, expect, message: '' };
  }
  if (!T(left) && T(picks)) return { ok: false, expect, message: `Pick your species’ increases: ${expect}.` };
  return { ok: false, expect,
    message: `Your species gives ${expect}, but the bonuses here don’t match. Turn on Customizing Your Origin if you moved them.` };
}

export const MULTICLASS_REQ = {
  barbarian: [['str']], bard: [['cha']], cleric: [['wis']], druid: [['wis']], fighter: [['str', 'dex']],
  monk: [['dex'], ['wis']], paladin: [['str'], ['cha']], ranger: [['dex'], ['wis']], rogue: [['dex']],
  sorcerer: [['cha']], warlock: [['cha']], wizard: [['int']], artificer: [['int']],
};

/** 2014 multiclassing needs 13 in the listed scores (each inner list is 'any one of these'). */
export function multiclassProblems(slug, scores, name = null) {
  const req = get(MULTICLASS_REQ, slug);
  if (!T(req)) return [];
  const missing = [];
  for (const group of req) {
    if (group.some((a) => get(scores, a, 10) >= 13)) continue;
    missing.push(group.map((a) => ABILITY_NAMES[a]).join(' or ') + ' 13');
  }
  if (!missing.length) return [];
  return [`Multiclassing into or out of ${or(name, title(slug))} needs ${missing.join(' and ')}.`];
}

export function multiclassReqText(slug) {
  const req = get(MULTICLASS_REQ, slug);
  return T(req) ? req.map((g) => g.map((a) => ABILITY_NAMES[a]).join(' or ') + ' 13').join(' and ') : '';
}

/** Steps a level up asked the player to look at that they haven't opened yet. */
export function levelupWarnings(char) {
  const items = list(or(get(char, 'levelup_todo'), [])).filter((i) => isDict(i) && T(get(i, 'step')));
  const labels = [];
  for (const i of items) if (T(get(i, 'label')) && !labels.includes(i.label)) labels.push(i.label);
  return labels.length ? [`Level up not finished: look at ${labels.join(', ')}.`] : [];
}

function singleClassCasterLevel(kind, lvl) {
  if (kind === 'full') return lvl;
  if (kind === 'half') return lvl >= 2 ? Math.ceil(lvl / 2) : 0;
  if (kind === 'artificer') return Math.ceil(lvl / 2);
  if (kind === 'third') return lvl >= 3 ? Math.ceil(lvl / 3) : 0;
  return 0;
}
function multiclassContribution(kind, lvl) {
  return get({ full: lvl, half: Math.floor(lvl / 2), artificer: Math.ceil(lvl / 2), third: Math.floor(lvl / 3) }, kind, 0);
}
function slotsFor(casterLevel) {
  if (casterLevel <= 0) return Array(9).fill(0);
  const row = FULL_CASTER_SLOTS[Math.min(casterLevel, 20) - 1];
  return [...row, ...Array(9 - row.length).fill(0)];
}
function tableValue(table, level, ...names) {
  for (const row of list(or(table, []))) {
    if (get(row, '_level') === level) {
      for (const [col, val] of Object.entries(row)) {
        if (names.some((n) => col.toLowerCase().includes(n))) return firstInt(val);
      }
    }
  }
  return null;
}
function tableSlots(table, level) {
  for (const row of list(or(table, []))) {
    if (get(row, '_level') === level) {
      const out = [];
      for (let n = 1; n <= 9; n++) out.push(firstInt(or(get(row, ordinal(n)), '')) || 0);
      return out.some(Boolean) ? out : null;
    }
  }
  return null;
}
function skipFeature(name) {
  const low = name.toLowerCase();
  return low.includes('ability score improvement') || low.endsWith(' feature') || low.endsWith(' features')
    || ['class features', 'multiclassing', 'optional class features'].includes(low);
}

export function compute(char, ctx) {
  const warnings = [...list(or(get(ctx, 'warnings'), []))];
  const classes = list(or(get(char, 'classes'), [])).filter((c) => T(get(c, 'name')));
  const cctx = or(get(ctx, 'classes'), []);
  while (cctx.length < classes.length) cctx.push({ rules: {}, detail: {}, subclass: null });
  const levels = classes.map((c) => Math.max(1, Math.min(20, toInt(get(c, 'level'), 1))));
  const totalLevel = sum(levels) || 1;
  if (totalLevel > 20) warnings.push(`Total level is ${totalLevel}; the maximum is 20.`);
  const prof = proficiencyBonus(totalLevel);

  const [scores, scoreParts] = abilityScores(char, warnings);
  const using = gear.gearInUse(char);
  const fx = gear.itemEffects(using.inventory);
  for (const [ab, val] of Object.entries(fx.score_set)) {  // items that set a score (Gauntlets of Ogre Power)
    if (has(scores, ab) && scores[ab] < val) {
      scoreParts[ab].item = val - scores[ab];
      scores[ab] = val;
    }
  }
  for (const [ab, n, cap] of fx.score_inc) {  // items that raise a score, up to a cap
    if (has(scores, ab)) {
      const now = Math.min(Math.max(cap, scores[ab]), scores[ab] + n);
      scoreParts[ab].item = get(scoreParts[ab], 'item', 0) + now - scores[ab];
      scores[ab] = now;
    }
  }
  const mods = Object.fromEntries(Object.entries(scores).map(([a, v]) => [a, modifier(v)]));
  const feats = list(or(get(char, 'feats'), []));
  const featDetails = or(get(ctx, 'feats'), {});
  const featGives = feats.map((f) => [f, featRules.grants(get(f, 'name'),
    or(get(or(get(featDetails, pyStr(get(f, 'id'))), {}), 'text'), get(f, 'text'), ''))]);
  const race = or(get(ctx, 'race'), {});
  const raceInfo = or(get(race, 'analysis'), {});
  const background = or(get(ctx, 'background'), {});

  const levelOf = {};
  const subclassSlug = {};
  classes.forEach((c, i) => {
    const slug = classSlugOf(c);
    levelOf[slug] = get(levelOf, slug, 0) + levels[i];
    if (T(get(c, 'subclass')) && T(get(c.subclass, 'name'))) {
      subclassSlug[slug] = or(orStr(get(c.subclass, 'path')).split(':').pop(), slugify(c.subclass.name));
    }
  });
  const lv = (slug) => get(levelOf, slug, 0);
  const sub = (slug) => get(subclassSlug, slug, '');
  if (Object.keys(levelOf).length > 1) {
    const names = {};
    for (const c of classes) setdefault(names, classSlugOf(c), get(c, 'name'));
    for (const [slug, name] of Object.entries(names)) warnings.push(...multiclassProblems(slug, scores, name));
  }
  warnings.push(...levelupWarnings(char));
  const raceAsi = raceAsiCheck(char, raceInfo);
  if (raceAsi && !raceAsi.ok) warnings.push(raceAsi.message);

  // ---------------------------------------------------------- saves
  const firstRules = classes.length ? cctx[0].rules : {};
  const saveProfs = new Set(list(or(get(firstRules, 'saves'), [])));
  for (const f of feats) {
    if (orStr(get(f, 'name')).toLowerCase() === 'resilient' && ABILITIES.includes(get(f, 'asi'))) saveProfs.add(f.asi);
  }
  for (const a of list(or(get(char, 'extra_save_profs'), []))) saveProfs.add(a);
  const saves = Object.fromEntries(ABILITIES.map((a) => [a, {
    bonus: mods[a] + (saveProfs.has(a) ? prof : 0) + get(fx.save, 'all', 0) + get(fx.save, a, 0), prof: saveProfs.has(a) }]));

  // ---------------------------------------------------------- skills
  const bgPicks = new Set(list(or(get(char, 'bg_skills'), [])));
  const racePicks = new Set(list(or(get(char, 'race_skills'), [])));
  const bgSkills = new Set([...list(or(get(background, 'skills'), [])), ...bgPicks]);
  const raceSkills = new Set([...list(or(get(raceInfo, 'skills'), [])), ...racePicks]);
  const chosen = new Set(list(or(get(char, 'skills'), [])));
  const proficient = new Set([...chosen, ...bgSkills, ...raceSkills]);
  for (const [label, picks, choices] of [['species', racePicks, list(or(get(raceInfo, 'choices'), []))],
    ['background', bgPicks, list(or(get(background, 'skill_choices'), []))]]) {
    const limit = sum(choices.map((ch) => toInt(get(ch, 'count'))));
    if (picks.size > limit) warnings.push(`${picks.size} skills picked from your ${label}; it gives ${limit}.`);
    else if (choices.length && picks.size < limit) {
      const d = limit - picks.size;
      warnings.push(`Your ${label} lets you pick ${d} more skill${d > 1 ? 's' : ''}.`);
    }
  }
  const expertise = new Set(list(or(get(char, 'expertise'), [])));
  const jack = lv('bard') >= 2;
  const skills = [];
  for (const [name, ab] of Object.entries(SKILLS)) {
    let bonus, kind;
    if (expertise.has(name) && proficient.has(name)) [bonus, kind] = [mods[ab] + 2 * prof, 'expertise'];
    else if (proficient.has(name)) [bonus, kind] = [mods[ab] + prof, 'proficient'];
    else if (jack) [bonus, kind] = [mods[ab] + Math.floor(prof / 2), 'half'];
    else [bonus, kind] = [mods[ab], ''];
    const src = bgSkills.has(name) ? 'background' : raceSkills.has(name) ? 'race' : (chosen.has(name) ? 'chosen' : '');
    bonus += get(fx.skill, name, 0);
    skills.push({ name, ability: ab, bonus, prof: kind, source: src });
  }
  for (const name of expertise) {
    if (!proficient.has(name)) warnings.push(`Expertise in ${pyStr(name)} needs proficiency in it first.`);
  }
  if (classes.length) {
    let allowed = toInt(get(firstRules, 'skill_count'), 0);
    for (const slug of Object.keys(levelOf).slice(1)) allowed += get({ bard: 1, ranger: 1, rogue: 1 }, slug, 0);
    allowed += sum(featGives.map(([, g]) => g.skills + g.skills_or_tools));
    const extra = [...chosen].filter((s) => !bgSkills.has(s) && !raceSkills.has(s));
    if (allowed && extra.length > allowed) {
      warnings.push(`${extra.length} skills picked for your class; it gives ${allowed}. Fine if a feat or your DM gives more.`);
    }
  }
  const skillBonus = Object.fromEntries(skills.map((s) => [s.name, s.bonus]));

  // ---------------------------------------------------------- hit points
  const con = mods.con;
  let hp = 0, idx = 0;
  const rolls = list(or(get(char, 'hp_rolls'), []));
  const rolled = get(char, 'hp_mode') === 'rolled';
  const dice = new Map();
  classes.forEach((c, i) => {
    const die = toInt(get(cctx[i].rules, 'hit_die'), 8) || 8;
    dice.set(die, (dice.get(die) || 0) + levels[i]);
    for (let n = 0; n < levels[i]; n++) {
      let gain;
      if (i === 0 && n === 0) gain = die;
      else {
        const r = rolled && idx < rolls.length ? toInt(rolls[idx]) : 0;
        gain = r >= 1 && r <= die ? r : Math.floor(die / 2) + 1;
        idx += 1;
      }
      hp += Math.max(1, gain + con);
    }
  });
  hp += toInt(get(raceInfo, 'hp_per_level')) * totalLevel;
  if (hasFeat(feats, 'Tough')) hp += 2 * totalLevel;
  if (sub('sorcerer').startsWith('draconic')) hp += lv('sorcerer');
  hp += toInt(get(char, 'hp_bonus')) + fx.hp;
  if (!classes.length) hp = 0;

  // ---------------------------------------------------------- proficiencies
  const armorProfs = new Set(), weaponProfs = new Set();
  const bonusTexts = [];
  classes.forEach((c, i) => {
    const cp = classProfs(c, cctx[i], i);
    list(cp.armor).forEach((a) => armorProfs.add(a));
    list(cp.weapons).forEach((w) => weaponProfs.add(w.toLowerCase()));
  });
  classes.forEach((c, i) => {
    const lvl = levels[i], cc = cctx[i];
    const sb = or(get(cc, 'subclass'), {});
    if (T(sb) && T(get(c, 'subclass')) && lvl >= toInt(get(cc.rules, 'subclass_level'), 3)) {
      for (const f of list(or(get(sb, 'features'), []))) {
        if (or(get(f, 'level'), 0) <= lvl) bonusTexts.push(...gainedProfs(orStr(get(f, 'text'))));
      }
    }
  });
  for (const clause of bonusTexts) {
    for (const [k, word] of [['light', 'light armor'], ['medium', 'medium armor'], ['heavy', 'heavy armor'], ['shield', 'shield']]) {
      if (clause.includes(word)) armorProfs.add(k);
    }
    for (const k of ['simple', 'martial']) if (clause.includes(`${k} weapons`)) weaponProfs.add(k);
    for (const w of Object.keys(WEAPONS)) if (clause.includes(w.toLowerCase())) weaponProfs.add(w.toLowerCase());
  }
  list(or(get(raceInfo, 'armor_profs'), [])).forEach((a) => armorProfs.add(a));
  list(or(get(raceInfo, 'weapon_profs'), [])).forEach((w) => weaponProfs.add(w.toLowerCase()));
  for (const f of feats) {
    const n = orStr(get(f, 'name')).toLowerCase();
    if (n === 'lightly armored') { armorProfs.add('light'); armorProfs.add('shield'); }
    else if (n === 'moderately armored') { armorProfs.add('medium'); armorProfs.add('shield'); }
    else if (n === 'heavily armored') armorProfs.add('heavy');
    else if (n === 'weapon master') list(or(get(f, 'weapons'), [])).forEach((w) => weaponProfs.add(w.toLowerCase()));
  }

  // ---------------------------------------------------------- armor class
  const worn = using.armor.length ? using.armor[0] : null;
  const held = using.shields.length ? using.shields[0] : null;
  if (using.armor.length > 1) warnings.push(`Wearing ${using.armor.length} suits of armor; only ${pyStr(get(worn, 'name'))} counts.`);
  if (using.shields.length > 1) warnings.push('Holding more than one shield; only one counts.');
  const armor = worn ? gear.armorStats(worn) : null;
  const armorLabel = worn ? or(get(worn, 'name'), gear.displayName(or(get(worn, 'base'), ''))) : '';
  const shield = held !== null;
  let ac, acNote = '';
  if (armor) {
    const [cat, base] = armor;
    let maxdex = armor[2];
    if (cat === 'medium' && hasFeat(feats, 'Medium Armor Master') && maxdex !== null) maxdex = Math.max(maxdex, 3);
    const dexPart = cat === 'heavy' ? 0 : maxdex === null ? mods.dex : Math.min(mods.dex, maxdex);
    const abonus = gear.magicActive(worn) ? toInt(get(worn, 'bonus')) : 0;
    ac = base + dexPart + abonus;
    acNote = armorLabel + (abonus && !/[+-]\d/.test(armorLabel) ? ` ${fmt(abonus)}` : '');
    if (!armorProfs.has(cat)) {
      warnings.push(`Not proficient with ${cat} armor (${armorLabel}): disadvantage on Strength and Dexterity rolls, and no spellcasting.`);
    }
  } else {
    const options = [[10 + mods.dex, 'Unarmored']];
    if (has(levelOf, 'barbarian')) options.push([10 + mods.dex + mods.con, 'Unarmored Defense']);
    if (has(levelOf, 'monk') && !shield) options.push([10 + mods.dex + mods.wis, 'Unarmored Defense']);
    if (sub('sorcerer').startsWith('draconic')) options.push([13 + mods.dex, 'Draconic Resilience']);
    // Python's max() on (ac, note) tuples: highest AC, ties broken by the later name alphabetically
    [ac, acNote] = options.reduce((best, o) => (o[0] > best[0] || (o[0] === best[0] && o[1] > best[1]) ? o : best));
  }
  if (shield) {
    const sbonus = gear.magicActive(held) ? toInt(get(held, 'bonus')) : 0;
    ac += gear.shieldAc(held) + sbonus;
    acNote += ' + shield' + (sbonus ? ` ${fmt(sbonus)}` : '');
    if (!armorProfs.has('shield')) warnings.push('Not proficient with shields: disadvantage on Strength and Dexterity rolls, and no spellcasting.');
  }
  ac += toInt(get(char, 'ac_bonus')) + fx.ac;
  if (fx.ac) {
    acNote += ' + ' + list(get(fx.sources, 'ac', [])).map((x) => (x.includes(' ') ? x.slice(0, x.lastIndexOf(' ')) : x)).join(', ');
  }
  const armorNonprof = Boolean((armor && !armorProfs.has(armor[0])) || (shield && !armorProfs.has('shield')));
  const stealthDis = Boolean(armor && armor[4]);

  // ---------------------------------------------------------- speed & initiative
  let speed = toInt(get(char, 'speed_override')) || toInt(get(raceInfo, 'speed')) || 30;
  const monk = lv('monk');
  if (monk >= 2 && !armor && !shield) speed += monk < 18 ? 10 + 5 * Math.floor((monk - 2) / 4) : 30;
  if (lv('barbarian') >= 5 && !(armor && armor[0] === 'heavy')) speed += 10;
  if (armor && armor[3] && scores.str < armor[3] && !String(get(race, 'speed_text', '') ?? '').includes('not reduced by wearing heavy armor')) {
    speed -= 10;
    warnings.push(`${armorLabel} needs Strength ${armor[3]}; speed drops by 10 feet.`);
  }
  if (hasFeat(feats, 'Mobile')) speed += 10;
  speed += fx.speed;
  const initiative = mods.dex + (jack ? Math.floor(prof / 2) : 0) + (hasFeat(feats, 'Alert') ? 5 : 0) + fx.init;
  const passive = 10 + skillBonus.Perception + (hasFeat(feats, 'Observant') ? 5 : 0);

  // ---------------------------------------------------------- attacks
  let maDie = 0;
  if (monk) maDie = monk < 5 ? 4 : monk < 11 ? 6 : monk < 17 ? 8 : 10;
  const pickedFlags = classOpts.pactFlags(char);
  const blade = { ...or(get(char, 'pact_blade'), {}), ...pickedFlags };
  const warlock = lv('warlock');
  const hexblade = sub('warlock').startsWith('hexblade');
  const ready = using.weapons.map((w) => [w, gear.weaponStats(w)]);
  const legacyUnarmed = !Array.isArray(get(char, 'inventory')) && list(or(get(char, 'weapons'), [])).includes('Unarmed strike');
  if (monk || T(get(char, 'unarmed')) || legacyUnarmed) ready.push([null, WEAPONS['Unarmed strike']]);
  const bonds = {};
  for (const [w] of ready) if (w && T(get(w, 'bond'))) bonds[jsonKey(w.bond)] = get(bonds, jsonKey(w.bond), 0) + 1;
  if (get(bonds, 'hex', 0) > 1) warnings.push('Only one weapon can be your hex weapon at a time.');
  if (get(bonds, 'bond', 0) > 2) warnings.push('Weapon Bond works with up to two weapons.');
  if (get(bonds, 'pact', 0) && warlock < 3) warnings.push("Pact weapons come from the warlock's Pact of the Blade, at 3rd level.");
  const inventory = using.inventory;
  const attacks = [];
  for (const [item, data] of ready) {
    if (!data) continue;
    const [cat, ranged, dmg0, dtype] = data;
    let dmg = dmg0;
    const props = [...data[4]];
    const wname = item ? or(get(item, 'base'), '') : 'Unarmed strike';
    const label = or(item ? or(get(item, 'name'), wname) : 'Unarmed strike', 'Weapon');
    const bond = or(get(or(item, {}), 'bond'), '');
    const active = item ? gear.magicActive(item) : true;
    if (item && !active) warnings.push(`${label} needs attunement; its magic doesn't work until you're attuned to it.`);
    let magic = item && active ? toInt(get(item, 'bonus')) : 0;
    let ab = ranged ? 'dex' : 'str';
    if (props.includes('finesse')) ab = mods.dex > mods.str ? 'dex' : 'str';
    const monkWeapon = monk && !ranged && (['Unarmed strike', 'Shortsword'].includes(wname) || bond === 'kensei'
      || (cat === 'simple' && !props.includes('two-handed') && !props.includes('heavy')));
    if (monkWeapon) {
      ab = mods.dex > mods.str ? 'dex' : 'str';
      const current = dmg.includes('d') ? strictInt(dmg.split('d')[1]) : 1;
      if (maDie > current) dmg = `1d${maDie}`;
    }
    if (bond === 'hex' || (bond === 'pact' && hexblade && warlock >= 3)) {
      if (mods.cha >= mods[ab]) ab = 'cha';
      if (bond === 'hex' && props.includes('two-handed')) warnings.push(`${label} is two-handed, so it can't be your hex weapon.`);
    }
    if (ABILITIES.includes(get(or(item, {}), 'ability'))) ab = item.ability;
    const override = get(or(item, {}), 'prof');
    let isProf;
    if (bond === 'pact' || override === 'yes') isProf = true;
    else if (override === 'no') isProf = false;
    else isProf = weaponProf(wname || label, cat, weaponProfs);
    if (bond === 'pact') {
      if (T(get(blade, 'improved')) && !magic) magic = 1;
      if (ranged && !(T(get(blade, 'improved')) && gear.BOW_FORMS.includes(wname))) {
        warnings.push(`${label}: a pact weapon is a melee weapon (or a bow or crossbow with Improved Pact Weapon).`);
      }
    }
    if (bond === 'pact' || magic || (item && T(get(item, 'magic')))) props.push('magical');
    if (bond) props.push(get(gear.BOND_LABEL, bond, 'bonded'));
    const toHit = mods[ab] + (isProf ? prof : 0) + magic + fx.attack;
    const dmgMod = mods[ab] + magic + fx.damage;
    const extras = [...(item ? get(fx.extra, jsonKey(get(item, 'id')), []) : []), ...get(fx.extra, '*', [])];
    let damage = (dmg === '1' ? `${1 + dmgMod}` : `${dmg}${dmgMod === 0 ? '' : fmt(dmgMod)}`) + (dtype ? ` ${dtype}` : '');
    damage += extras.map((e) => ` + ${e.dice}${e.type ? ' ' + e.type : ''}`).join('');
    if (!isProf) warnings.push(`Not proficient with ${label}; its attack bonus leaves out proficiency.`);
    let versatile = null;
    for (const p of props) {
      const m = p.startsWith('versatile') ? p.match(/\((\d+d\d+)\)/) : null;
      if (m) { versatile = m[1]; break; }
    }
    if (monkWeapon && versatile && maDie && strictInt(versatile.split('d')[1]) <= maDie) versatile = null;
    const name = label + (magic && !/[+-]\d/.test(label) ? ` ${fmt(magic)}` : '');
    let ammo = null;
    if (has(gear.AMMO_FOR, wname)) {
      const stock = inventory.filter((i) => get(i, 'name') === gear.AMMO_FOR[wname] && get(i, 'carried', true) !== false);
      ammo = { name: gear.AMMO_FOR[wname], qty: sum(stock.map((i) => toInt(get(i, 'qty'), 1))),
        item: stock.length ? get(stock[0], 'id') : null };
    }
    if (item && toInt(get(item, 'qty'), 1) > 1) props.push(`${toInt(get(item, 'qty'))} carried`);
    attacks.push({ name, bonus: toHit, damage, properties: props.join(', '),
      ability: ab, prof: isProf, magic, dice: dmg === '1' ? '' : dmg,
      mod: dmg === '1' ? 1 + dmgMod : dmgMod, type: dtype, versatile,
      melee: !ranged, ranged, finesse: props.includes('finesse'), weapon: true,
      item: item ? get(item, 'id') : null, ammo, extra: extras,
      pact: bond === 'pact', bond });
    if (ammo !== null && ammo.qty === 0 && bond !== 'pact') {
      warnings.push(`No ${ammo.name.toLowerCase()}s for your ${label.toLowerCase()}; add some on the Equipment step.`);
    }
  }

  // ---------------------------------------------------------- spellcasting
  const casters = [], nonpact = [];
  let pact = null;
  classes.forEach((c, i) => {
    const lvl = levels[i], cc = cctx[i];
    const rules = cc.rules, detail = or(get(cc, 'detail'), {});
    const slug = classSlugOf(c);
    let kind = or(get(rules, 'caster'), 'none'), ability = get(rules, 'spell_ability');
    const thirdSub = get(rules, 'third_caster_subclass');
    if (kind === 'none' && T(thirdSub) && sub(slug).startsWith(thirdSub)) [kind, ability] = ['third', get(rules, 'third_caster_ability', 'int')];
    if (kind === 'none' || !T(ability)) return;
    const mod = mods[ability];
    let key = kind === 'third' ? sub(slug) : slug;
    key = ['eldritch-knight', 'arcane-trickster'].find((k) => key.startsWith(k)) ?? key;
    let cantrips = tableValue(get(detail, 'table'), lvl, 'cantrips known');
    let known = tableValue(get(detail, 'table'), lvl, 'spells known');
    if (cantrips === null && has(CANTRIPS_KNOWN, key)) cantrips = CANTRIPS_KNOWN[key][lvl - 1];
    if (known === null && has(SPELLS_KNOWN, key)) known = SPELLS_KNOWN[key][lvl - 1];
    const info = { class: get(c, 'name'), slug, level: lvl, type: kind, ability,
      dc: 8 + prof + mod + fx.spell_dc, attack: prof + mod + fx.spell_attack,
      cantrips_known: cantrips, spells_known: known, prepared_count: null,
      list: kind === 'third' ? 'wizard' : slug };
    const prepares = get(rules, 'prepares');
    if (prepares === 'full') info.prepared_count = Math.max(1, mod + lvl);
    else if (prepares === 'half') info.prepared_count = Math.max(1, mod + Math.floor(lvl / 2));
    // how many leveled spells this class may have on the sheet
    if (slug === 'wizard') [info.spell_limit, info.limit_kind] = [6 + 2 * (lvl - 1), 'spellbook'];
    else if (known !== null) [info.spell_limit, info.limit_kind] = [known, 'known'];
    else if (info.prepared_count !== null) [info.spell_limit, info.limit_kind] = [info.prepared_count, 'prepared'];
    else [info.spell_limit, info.limit_kind] = [null, ''];
    if (kind === 'pact') {
      const [count, slotLevel] = PACT_SLOTS[lvl - 1];
      pact = { count, level: slotLevel };
      const arcanum = maxOf([[11, 6], [13, 7], [15, 8], [17, 9]].filter(([at]) => lvl >= at).map(([, sp]) => sp));
      info.max_spell_level = Math.max(slotLevel, arcanum);
    } else {
      let own = slotsFor(singleClassCasterLevel(kind, lvl));
      if (!own.some(Boolean)) own = tableSlots(get(detail, 'table'), lvl) || own;
      info.max_spell_level = maxOf(own.map((n, j) => (n ? j + 1 : 0)).filter(Boolean));
      nonpact.push([kind, lvl, detail]);
    }
    casters.push(info);
  });

  // feats that grant spells cast with their own ability (Magic Initiate, Fey Touched, ...)
  for (const [f, g] of featGives) {
    const sp = or(get(g, 'spell_picks'), {});
    let ab = or(get(sp, 'ability'), get(g, 'spell_ability'), '');
    if (!T(g.spells) && !T(sp)) continue;
    const spClasses = list(or(get(sp, 'classes'), []));
    const chosenList = spClasses.includes(get(f, 'spell_class')) ? f.spell_class : (spClasses.length === 1 ? spClasses[0] : '');
    if (ab === 'class') ab = get(featRules.CLASS_ABILITY, chosenList, '');
    else if (ab === 'asi') ab = ABILITIES.includes(get(f, 'asi')) ? f.asi : '';
    if (!ABILITIES.includes(ab)) continue;
    casters.push({ class: or(get(f, 'name'), 'Feat'), slug: `feat:${featRules.featKey(f)}`, level: totalLevel,
      type: 'feat', ability: ab, dc: 8 + prof + mods[ab] + fx.spell_dc,
      attack: prof + mods[ab] + fx.spell_attack, cantrips_known: null, spells_known: null,
      prepared_count: null, list: chosenList, spell_limit: null, limit_kind: '',
      max_spell_level: 9 });
  }

  let slots = Array(9).fill(0);
  if (nonpact.length === 1) {
    const [kind, lvl, detail] = nonpact[0];
    const fromTable = tableSlots(get(detail, 'table'), lvl);
    const computed = slotsFor(singleClassCasterLevel(kind, lvl));
    slots = computed.some(Boolean) ? computed : (fromTable || computed);
  } else if (nonpact.length > 1) {
    slots = slotsFor(sum(nonpact.map(([k, l]) => multiclassContribution(k, l))));
  }

  const spellRows = {};
  const knownSpells = or(get(ctx, 'spells'), {});
  const byClassMax = {};
  for (const c of casters) byClassMax[c.slug] = c.max_spell_level;
  const overallMax = maxOf(Object.values(byClassMax));
  const cantripsByClass = {};
  const charSpells = list(or(get(char, 'spells'), []));
  for (const s of charSpells) {
    const info = or(get(knownSpells, pyStr(get(s, 'id'))), get(knownSpells, (get(s, 'name', '') || '').toLowerCase()), {});
    const lvl = toInt(get(s, 'level') !== null ? get(s, 'level') : get(info, 'level'), 0);
    const cls = or(get(s, 'class'), '');
    const limit = has(byClassMax, cls) ? byClassMax[cls] : overallMax;
    if (lvl > limit && !T(get(s, 'always'))) {
      warnings.push(`${pyStr(get(s, 'name'))} is a ${ordinal(lvl)}-level spell; `
        + `${title(cls || 'your')} can cast up to ${limit ? ordinal(limit) : 'cantrips only'}.`);
    }
    if (lvl === 0) cantripsByClass[cls] = get(cantripsByClass, cls, 0) + 1;
    const row = { name: get(s, 'name'), level: lvl, class: cls, prepared: T(get(s, 'prepared', true)),
      always: T(get(s, 'always')), id: get(s, 'id'),
      school: get(info, 'school', ''), casting_time: get(info, 'casting_time', ''),
      range: get(info, 'range', ''), components: get(info, 'components', ''),
      duration: get(info, 'duration', ''), ritual: T(get(info, 'ritual')),
      concentration: orStr(get(info, 'duration')).toLowerCase().includes('concentration') };
    setdefault(spellRows, lvl, []).push(row);
  }
  for (const c of casters) {
    const n = get(cantripsByClass, c.slug, 0);
    if (c.cantrips_known !== null && n > c.cantrips_known) {
      warnings.push(`${n} ${pyStr(c.class)} cantrips picked; ${c.cantrips_known} known at level ${c.level}.`);
    }
  }
  for (const k of Object.keys(spellRows)) {
    spellRows[k].sort((a, b) => { const x = a.name || '', y = b.name || ''; return x < y ? -1 : x > y ? 1 : 0; });
  }

  // ---------------------------------------------------------- features
  const features = [], granted = [];
  for (const t of list(or(get(race, 'traits'), []))) {
    if (!HIDDEN_RACE_TRAITS.has(t.name.trim().toLowerCase())) {
      features.push({ name: t.name, source: get(race, 'name', 'Species'), text: t.text, kind: 'race' });
    }
  }
  classes.forEach((c, i) => {
    const lvl = levels[i], cc = cctx[i];
    const detail = or(get(cc, 'detail'), {});
    const seen = new Set();
    for (const f of list(or(get(detail, 'features'), []))) {
      const fl = get(f, 'level');
      if (fl === null || fl > lvl || skipFeature(f.name) || seen.has(f.name)) continue;
      seen.add(f.name);
      features.push({ name: f.name, source: `${pyStr(get(c, 'name'))} ${fl}`, level: fl, text: get(f, 'text', '') });
    }
    const sb = or(get(cc, 'subclass'), {});
    const subLevel = toInt(get(cc.rules, 'subclass_level'), 3);
    if (T(sb) && T(get(c, 'subclass')) && lvl >= subLevel) {
      for (const f of list(or(get(sb, 'features'), []))) {
        const fl = or(get(f, 'level'), subLevel);
        if (fl <= lvl) {
          features.push({ name: f.name, source: get(c.subclass, 'name', 'Subclass') + ` ${fl}`, level: fl, text: get(f, 'text', '') });
        }
      }
      for (const row of list(or(get(sb, 'bonus_spells'), []))) {
        if (row.level <= lvl) {
          for (const sp of row.spells) {
            if (!charSpells.some((s) => orStr(get(s, 'name')).toLowerCase() === sp.toLowerCase())) {
              granted.push({ name: sp, class: classSlugOf(c), source: get(c.subclass, 'name') });
            }
          }
        }
      }
    } else if (T(get(c, 'subclass')) && lvl < subLevel) {
      warnings.push(`${pyStr(get(c, 'name'))} picks a subclass at level ${subLevel}.`);
    }
  });
  const bf = or(get(background, 'feature'), {});
  if (T(get(bf, 'name'))) features.push({ name: bf.name, source: `Background: ${pyStr(get(background, 'name', ''))}`, text: get(bf, 'text', '') });
  for (const f of feats) {
    const d = or(get(featDetails, pyStr(get(f, 'id'))), {});
    features.push({ name: get(f, 'name'), source: 'Feat', text: get(d, 'text', '') });
  }
  for (const f of list(or(get(char, 'extra_features'), []))) {
    if (T(get(f, 'name'))) features.push({ name: f.name, source: or(get(f, 'source'), 'Custom'), text: get(f, 'text', '') });
  }
  for (const n of fx.notes) features.push({ name: n.name, source: 'Magic item', text: n.text });
  const classOptions = list(or(get(char, 'class_options'), []));
  for (const o of classOptions) {
    if (T(get(o, 'name'))) features.push({ name: o.name, source: or(get(o, 'label'), 'Class option'), text: or(get(o, 'text'), '') });
  }

  // ---------------------------------------------------------- class options (invocations, maneuvers, ...)
  const allowed = classOpts.allowedCounts(char, ctx);
  const chosenByGroup = {};
  for (const o of classOptions) if (T(get(o, 'key'))) chosenByGroup[o.key] = get(chosenByGroup, o.key, 0) + 1;
  const spellNames = new Set(charSpells.map((x) => orStr(get(x, 'name')).toLowerCase()));
  const pickedNames = new Set(classOptions.map((o) => orStr(get(o, 'name')).toLowerCase()));
  for (const o of classOptions) {
    const at = classes.findIndex((c) => classSlugOf(c) === get(o, 'class'));
    const clsLvl = at >= 0 ? levels[at] : totalLevel;
    const subName = at >= 0 ? or(get(or(get(classes[at], 'subclass'), {}), 'name'), '') : '';
    let why = classOpts.unmet(get(o, 'prerequisite'), { level: clsLvl, picked: pickedNames, spells: spellNames,
      subclass: subName.toLowerCase() });
    if (orStr(get(o, 'key')).startsWith('feat:') && T(get(o, 'prerequisite')) && !has(levelOf, get(o, 'class'))) {
      why = `taken through a feat, only a ${pyStr(get(o, 'class'))} can pick one with a prerequisite`;
    }
    if (why) warnings.push(`${pyStr(get(o, 'name'))}: ${why}.`);
  }
  for (const [key, n] of Object.entries(chosenByGroup)) {
    const limit = get(allowed, key);
    const hit = classOptions.find((o) => get(o, 'key') === key);
    const label = hit ? get(hit, 'label') : 'options';
    if (limit !== null && limit !== undefined && n > limit) warnings.push(`${n} ${pyStr(label)} picked; your level gives ${limit}.`);
  }
  for (const [key, name, text] of INVOCATION_TEXT) {
    if (T(get(blade, key)) && !has(pickedFlags, key)) features.push({ name, source: 'Eldritch invocation', text });
  }

  // ---------------------------------------------------------- feats
  const raceSel = or(get(char, 'race'), {});
  const prereqInfo = {
    scores, armor: armorProfs, caster: T(casters.filter((c) => c.type !== 'feat')) || T(pact),
    martial: weaponProfs.has('martial') || Object.entries(WEAPONS).some(([w, d]) => d[0] === 'martial'
      && (weaponProfs.has(w.toLowerCase()) || weaponProfs.has(w.toLowerCase() + 's'))),
    race: [or(get(raceSel, 'name'), ''), or(get(raceSel, 'subrace'), ''), or(get(race, 'name'), '')].join(' ').toLowerCase(),
    level: totalLevel,
  };
  const featInfo = [];
  featGives.forEach(([f, g], i) => {
    const d = or(get(featDetails, pyStr(get(f, 'id'))), {});
    const problems = featRules.prerequisiteProblems(or(get(d, 'prerequisite'), get(f, 'prerequisite')), prereqInfo);
    if (problems.length) warnings.push(`${pyStr(get(f, 'name'))} needs ${problems.join(', ')}.`);
    const key = featRules.featKey(f);
    for (const sp of g.spells) {
      if (!spellNames.has(sp.toLowerCase())) granted.push({ name: sp, class: `feat:${key}`, source: get(f, 'name') });
    }
    if (g.weapons && list(or(get(f, 'weapons'), [])).length < g.weapons) {
      warnings.push(`${pyStr(get(f, 'name'))} lets you pick ${g.weapons} weapons; choose them on the Feats step.`);
    }
    const pickedSpells = charSpells.filter((s) => get(s, 'class') === `feat:${key}` && !T(get(s, 'always_granted')));
    featInfo.push({ index: i, key, name: get(f, 'name'), prerequisite: or(get(d, 'prerequisite'), ''),
      problems, gives: featRules.summary(g), grants: g, spells_picked: pickedSpells.length });
  });

  if (granted.length) {
    warnings.push(`${granted.length} always-prepared spell${granted.length > 1 ? 's' : ''} from your subclass `
      + 'or feats not added yet (see the Spells step).');
  }

  // ---------------------------------------------------------- ability score improvements
  let asiTotal = 0;
  classes.forEach((c, i) => {
    const cc = cctx[i];
    const asiLevels = or(get(cc.rules, 'asi_levels'), get(or(get(cc, 'detail'), {}), 'asi_levels'), DEFAULT_ASI_LEVELS);
    asiTotal += asiLevels.filter((x) => x <= levels[i]).length;
  });
  const points = sum(Object.values(or(get(char, 'improvements'), {})).map((v) => toInt(v)));
  const asiFeats = feats.filter((f) => or(get(f, 'from'), 'asi') === 'asi').length;
  const used = points / 2 + asiFeats;
  if (used > asiTotal) warnings.push(`Using ${fmtG(used)} ability score improvements; your levels give ${asiTotal}.`);
  const raceFeats = feats.filter((f) => get(f, 'from') === 'race').length;
  if (raceFeats && !T(get(raceInfo, 'bonus_feat'))) {
    warnings.push("A feat is marked as coming from your species, but your species doesn't list a bonus feat.");
  }

  // ---------------------------------------------------------- proficiencies text
  const firstDetail = or(classes.length ? get(cctx[0], 'detail') : {}, {});
  const profLines = [];
  if (classes.length) {
    const armorTxt = or(get(firstDetail, 'armor'), list(or(get(firstRules, 'armor'), [])).join(', '), 'None');
    const weaponsTxt = or(get(firstDetail, 'weapons'), list(or(get(firstRules, 'weapons'), [])).join(', '));
    profLines.push(`Armor: ${armorTxt}`);
    profLines.push(`Weapons: ${weaponsTxt}`);
  }
  if (T(get(raceInfo, 'weapon_profs'))) profLines.push('Species weapons: ' + raceInfo.weapon_profs.join(', '));
  const tools = [get(firstDetail, 'tools', ''), get(background, 'tools', ''), get(char, 'tools', '')]
    .filter((t) => T(t) && t.toLowerCase() !== 'none');
  if (bonusTexts.length) profLines.push('From your subclass: ' + bonusTexts.join('; '));
  if (fx.resist.length) profLines.push('Resistances (items): ' + sorted(new Set(fx.resist)).join(', '));
  if (tools.length) profLines.push('Tools: ' + tools.join('; '));
  const languages = or(get(char, 'languages'), get(raceInfo, 'languages'), '');

  const classLine = classes.map((c, i) => `${pyStr(c.name)} ${levels[i]}`
    + (T(get(c, 'subclass')) && T(get(c.subclass, 'name')) ? ` (${c.subclass.name})` : '')).join(' / ');

  // ---------------------------------------------------------- dice roller
  const traitNames = new Set(list(or(get(race, 'traits'), [])).map((t) => orStr(get(t, 'name')).trim().toLowerCase()));
  const fighterSub = sub('fighter');
  let critRange = 20;
  if (fighterSub.startsWith('champion') && lv('fighter') >= 3) critRange = lv('fighter') >= 15 ? 18 : 19;
  const barb = lv('barbarian');
  const brutal = barb >= 17 ? 3 : barb >= 13 ? 2 : barb >= 9 ? 1 : 0;
  const riders = [];
  if (lv('rogue')) {
    const n = Math.ceil(lv('rogue') / 2);
    riders.push({ id: 'sneak', name: `Sneak Attack (${n}d6)`, dice: `${n}d6`, flat: 0, type: '',
      applies: 'finesse-ranged', once: true });
  }
  if (barb) {
    const rage = barb < 9 ? 2 : barb < 16 ? 3 : 4;
    riders.push({ id: 'rage', name: `Rage (+${rage})`, dice: '', flat: rage, type: '', applies: 'str-melee', once: false });
  }
  if (lv('paladin') >= 2) {
    riders.push({ id: 'smite', name: 'Divine Smite (2d8)', dice: '2d8', flat: 0, type: 'radiant', applies: 'melee', once: true });
  }
  if (spellNames.has('hex')) {
    riders.push({ id: 'hex', name: 'Hex (1d6)', dice: '1d6', flat: 0, type: 'necrotic', applies: 'any', once: false });
  }
  if (spellNames.has("hunter's mark")) {
    riders.push({ id: 'mark', name: "Hunter's Mark (1d6)", dice: '1d6', flat: 0, type: '', applies: 'weapon', once: false });
  }
  if (T(get(blade, 'lifedrinker')) && warlock >= 12) {
    riders.push({ id: 'lifedrinker', name: `Lifedrinker (+${Math.max(1, mods.cha)} necrotic)`, dice: '',
      flat: Math.max(1, mods.cha), type: 'necrotic', applies: 'pact', once: false });
  }
  if (T(get(blade, 'smite')) && warlock >= 5 && pact) {
    const n = 1 + pact.level;
    riders.push({ id: 'eldritch-smite', name: `Eldritch Smite (${n}d8)`, dice: `${n}d8`, flat: 0,
      type: 'force', applies: 'pact', once: true });
  }
  riders.push(...fx.riders);
  const roll = { lucky: traitNames.has('lucky'), reliable_talent: lv('rogue') >= 11,
    war_caster: hasFeat(feats, 'War Caster'),
    crit_range: critRange, extra_crit_dice: brutal + (traitNames.has('savage attacks') ? 1 : 0),
    riders, jack, stealth_dis: stealthDis, armor_dis: armorNonprof,
    spell_bonus: classOptions.some((o) => orStr(get(o, 'name')).toLowerCase() === 'agonizing blast')
      ? { 'eldritch blast': Math.max(0, mods.cha) } : {} };

  // ---------------------------------------------------------- equipment
  const toolText = [...tools, ...bonusTexts, pyStr(or(get(raceInfo, 'tools'), ''))].join(' ');
  const gearProfs = {
    armor: sorted([...armorProfs].filter((a) => ['light', 'medium', 'heavy'].includes(a))),
    shield: armorProfs.has('shield'),
    weapons: Object.entries(WEAPONS).filter(([w, d]) => w !== 'Unarmed strike' && weaponProf(w, d[0], weaponProfs)).map(([w]) => w),
    weapon_cats: ['simple', 'martial'].filter((k) => weaponProfs.has(k)),
    tools: gear.toolProfs(toolText),
    focus: gear.usableFocus(Object.keys(levelOf), casters.length > 0),
  };
  const carried = carry(char, scores.str, race, using.inventory);
  const attuned = attunement(using.inventory, gear.attunementLimit(levelOf));
  if (attuned.used > attuned.max) warnings.push(`Attuned to ${attuned.used} items; you can be attuned to ${attuned.max} at a time.`);
  if (carried.weight > carried.capacity) {
    warnings.push(`Carrying ${fmtG(carried.weight)} lb; your carrying capacity is ${carried.capacity} lb.`);
  }

  return {
    total_level: totalLevel, prof, scores, mods, score_parts: scoreParts,
    saves, skills, passive_perception: passive,
    passive_investigation: 10 + skillBonus.Investigation, passive_insight: 10 + skillBonus.Insight,
    initiative, ac, ac_note: acNote.trim(), speed,
    hp_max: hp, hit_dice: [...dice.entries()].sort((a, b) => b[0] - a[0]).map(([d, n]) => `${n}d${d}`).join(' + '),
    attacks, spellcasting: casters, slots, pact, granted_spells: granted,
    spells: Object.fromEntries(Object.keys(spellRows).map(Number).sort((a, b) => a - b).map((k) => [String(k), spellRows[k]])),
    features, proficiencies: profLines, languages,
    asi: { available: asiTotal, used },
    class_line: classLine, size: or(get(raceInfo, 'size'), ''), darkvision: get(raceInfo, 'darkvision'),
    race_name: or(get(raceSel, 'subrace'), get(raceSel, 'name'), ''),
    background_name: or(get(or(get(char, 'background'), {}), 'name'), ''),
    roll, mode: 'builder', warnings,
    gear_profs: gearProfs, carry: carried, inventory_lines: gear.inventoryLines(using.inventory),
    coins_text: gear.coinsText(get(char, 'coins')), unarmed_auto: Boolean(monk), attunement: attuned,
    resistances: sorted(new Set(fx.resist)), treasure_cp: gear.treasureValue(using.inventory),
    feat_info: featInfo,
    pact_blade: { available: warlock >= 3, hexblade, level: warlock, flags: blade, picked: sorted(Object.keys(pickedFlags)) },
    race_asi: raceAsi,
    resources: classResources.compute(levelOf, subclassSlug, mods, prof, feats, features, totalLevel),
    companions: creatures.companionInfo(levelOf, subclassSlug, charSpells.map((x) => or(get(x, 'name'), '')),
      classOptions.map((o) => or(get(o, 'name'), '')), prof),
  };
}

/** int() that throws on what Python's int() rejects (a weapon's damage die). */
function strictInt(s) {
  if (!/^\s*[-+]?\d+\s*$/.test(s)) throw new Error(`invalid literal for int(): '${s}'`);
  return parseInt(s, 10);
}

/** Armor and weapon proficiencies a class grants: all of them for your first class, fewer when multiclassing. */
export function classProfs(c, cc, index) {
  const rules = or(get(cc, 'rules'), {});
  const slug = classSlugOf(c);
  if (index > 0 && has(MULTICLASS_PROFS, slug)) return MULTICLASS_PROFS[slug];
  return { armor: or(get(rules, 'armor'), []), weapons: or(get(rules, 'weapons'), []) };
}

export function weaponProf(wname, cat, weaponProfs) {
  const low = wname.toLowerCase();
  return wname === 'Unarmed strike' || weaponProfs.has(cat) || weaponProfs.has(low) || weaponProfs.has(low + 's')
    || (low.endsWith('s') && weaponProfs.has(low.slice(0, -1)));
}

const GAINED_RE = /\b(?:gain|get)s? proficiency (?:with|in) ([^.]*)/gi;

/** Clauses like 'heavy armor and martial weapons' from 'you gain proficiency with heavy armor and martial weapons'. */
export function gainedProfs(text) {
  const out = [];
  for (const m of (text || '').matchAll(GAINED_RE)) {
    const clause = m[1].trim().toLowerCase();
    if (['armor', 'shield', 'weapon', 'tools', 'kit', 'supplies', 'instrument'].some((w) => clause.includes(w))
      || Object.keys(WEAPONS).some((w) => clause.includes(w.toLowerCase()))) {
      out.push(clause.slice(0, 120));
    }
  }
  return out;
}

export function manualGearProfs(text, tools) {
  const t = (text || '').toLowerCase();
  const armor = t.includes('all armor') ? ['light', 'medium', 'heavy']
    : ['light', 'medium', 'heavy'].filter((a) => new RegExp(`\\b${a}\\b(?:[^.\\n]*?)armou?r|armou?r[^\\n]*\\b${a}\\b`).test(t));
  const profs = new Set();
  if (/\bsimple\b/.test(t)) profs.add('simple');
  if (/\bmartial\b/.test(t)) profs.add('martial');
  for (const w of Object.keys(WEAPONS)) if (t.includes(w.toLowerCase())) profs.add(w.toLowerCase());
  return { armor, shield: t.includes('shield'),
    weapons: Object.entries(WEAPONS).filter(([w, d]) => w !== 'Unarmed strike' && weaponProf(w, d[0], profs)).map(([w]) => w),
    weapon_cats: ['simple', 'martial'].filter((k) => profs.has(k)),
    tools: gear.toolProfs(t + ' ' + (tools || '')), focus: [] };
}

export const INVOCATION_TEXT = [
  ['improved', 'Improved Pact Weapon', 'Your pact weapon can be a shortbow, longbow, light crossbow or heavy crossbow, '
    + "you can use it as a spellcasting focus, and if it isn't a magic weapon it gets +1 to attack and damage rolls."],
  ['thirsting', 'Thirsting Blade', 'You can attack with your pact weapon twice, instead of once, whenever you take the '
    + 'Attack action on your turn.'],
  ['smite', 'Eldritch Smite', 'Once per turn when you hit with your pact weapon, you can expend a warlock spell slot to '
    + 'deal an extra 1d8 force damage, plus another 1d8 per level of the slot, and you can knock a Huge or smaller '
    + 'creature prone.'],
  ['lifedrinker', 'Lifedrinker', 'When you hit with your pact weapon, the creature takes extra necrotic damage equal '
    + 'to your Charisma modifier (minimum 1).'],
];

export function attunement(inventory, limit) {
  const items = inventory.filter((i) => T(get(or(get(i, 'magic'), {}), 'attune')) && T(get(or(get(i, 'magic'), {}), 'attuned')))
    .map((i) => or(get(i, 'name'), 'Item'));
  return { used: items.length, max: limit, items };
}

export function carry(char, strength, race, inventory) {
  const traits = list(or(get(race, 'traits'), [])).map((t) => orStr(get(t, 'name')).toLowerCase()).join(' ');
  const size = orStr(get(or(get(race, 'analysis'), {}), 'size')).toLowerCase();
  const mult = traits.includes('powerful build') || size.includes('large') ? 2 : 1;
  const capacity = strength * 15 * mult;
  return { weight: gear.totalWeight(inventory, get(char, 'coins')), capacity, push: capacity * 2 };
}

export function diceText(dice, mod, dtype = '') {
  dice = orStr(dice).trim();
  const text = !dice || /^\d+$/.test(dice) ? String(toInt(dice) + mod) : dice + (mod === 0 ? '' : fmt(mod));
  return (text + (T(dtype) ? ` ${dtype}` : '')).trim();
}

/** Numbers for a sheet the player fills in by hand. Typed values win; everything else is worked out. */
export function computeManual(char, ctx = null) {
  ctx = or(ctx, {});
  const m = or(get(char, 'manual'), {});
  const warnings = levelupWarnings(char);
  const level = Math.max(1, Math.min(20, toInt(get(m, 'level'), 1)));
  const prof = toInt(get(m, 'prof_override')) || proficiencyBonus(level);
  const baseScores = or(get(char, 'base_scores'), {});
  const scores = Object.fromEntries(ABILITIES.map((a) => [a, toInt(get(baseScores, a), 10)]));
  const mods = Object.fromEntries(Object.entries(scores).map(([a, v]) => [a, modifier(v)]));
  const saveProfs = new Set(list(or(get(m, 'save_profs'), [])));
  const saves = Object.fromEntries(ABILITIES.map((a) => [a, { bonus: mods[a] + (saveProfs.has(a) ? prof : 0), prof: saveProfs.has(a) }]));
  const proficient = new Set(list(or(get(char, 'skills'), []))), expertise = new Set(list(or(get(char, 'expertise'), [])));
  const jack = T(get(m, 'jack'));
  const skills = [];
  for (const [name, ab] of Object.entries(SKILLS)) {
    let bonus, kind;
    if (expertise.has(name) && proficient.has(name)) [bonus, kind] = [mods[ab] + 2 * prof, 'expertise'];
    else if (proficient.has(name)) [bonus, kind] = [mods[ab] + prof, 'proficient'];
    else if (jack) [bonus, kind] = [mods[ab] + Math.floor(prof / 2), 'half'];
    else [bonus, kind] = [mods[ab], ''];
    skills.push({ name, ability: ab, bonus, prof: kind, source: proficient.has(name) ? 'chosen' : '' });
  }
  for (const name of expertise) {
    if (!proficient.has(name)) warnings.push(`Expertise in ${pyStr(name)} needs proficiency in it first.`);
  }
  const skillBonus = Object.fromEntries(skills.map((x) => [x.name, x.bonus]));

  const attacks = [];
  list(or(get(m, 'attacks'), [])).forEach((a, srcIndex) => {
    if (!orStr(get(a, 'name')).trim()) return;
    const ab = ABILITIES.includes(get(a, 'ability')) ? a.ability : null;
    const amod = ab ? mods[ab] : 0;
    const toHit = amod + (T(get(a, 'prof', true)) ? prof : 0) + toInt(get(a, 'bonus'));
    const dmgMod = (T(get(a, 'add_mod', true)) ? amod : 0) + toInt(get(a, 'dmg_bonus'));
    const dice = orStr(get(a, 'dice')).trim();
    const flat = /^\d*$/.test(dice);
    attacks.push({
      name: a.name.trim(), bonus: toHit, damage: diceText(dice, dmgMod, get(a, 'type', '')),
      properties: get(a, 'notes', ''), ability: ab || '', prof: T(get(a, 'prof', true)),
      magic: toInt(get(a, 'bonus')), dice: flat ? '' : dice, mod: flat ? toInt(dice) + dmgMod : dmgMod,
      type: get(a, 'type', ''), versatile: orStr(get(a, 'versatile')).trim() || null,
      melee: get(a, 'range', 'melee') !== 'ranged', ranged: get(a, 'range') === 'ranged',
      finesse: T(get(a, 'finesse')), weapon: get(a, 'kind', 'weapon') === 'weapon', src_index: srcIndex,
    });
  });

  const casters = [];
  let pact = null;
  const ability = get(m, 'spell_ability');
  if (ABILITIES.includes(ability)) {
    const mod = mods[ability];
    casters.push({ class: or(get(m, 'spell_class'), 'Spellcasting').trim(), slug: 'manual', level,
      type: 'manual', ability, dc: 8 + prof + mod + toInt(get(m, 'spell_dc_bonus')),
      attack: prof + mod + toInt(get(m, 'spell_attack_bonus')), cantrips_known: null,
      spells_known: null, prepared_count: null, max_spell_level: 9 });
  }
  const raw = [...list(or(get(m, 'slots'), [])), ...Array(9).fill(0)];
  const slots = raw.slice(0, 9).map((x) => Math.max(0, toInt(x)));
  if (toInt(get(m, 'pact_count')) && toInt(get(m, 'pact_level'))) {
    pact = { count: toInt(m.pact_count), level: Math.max(1, Math.min(5, toInt(m.pact_level))) };
  }

  const spellRows = {}, knownSpells = or(get(ctx, 'spells'), {});
  for (const sp of list(or(get(char, 'spells'), []))) {
    if (!orStr(get(sp, 'name')).trim()) continue;
    const info = or(get(knownSpells, pyStr(get(sp, 'id'))), get(knownSpells, sp.name.toLowerCase()), {});
    const lvl = toInt(![null, ''].includes(get(sp, 'level')) ? get(sp, 'level') : get(info, 'level'), 0);
    setdefault(spellRows, lvl, []).push({
      name: sp.name, level: lvl, class: 'manual', prepared: T(get(sp, 'prepared', true)),
      always: T(get(sp, 'always')), id: get(sp, 'id'), school: get(info, 'school', ''),
      casting_time: get(info, 'casting_time', ''), range: get(info, 'range', ''),
      components: get(info, 'components', ''), duration: get(info, 'duration', ''),
      ritual: T(get(info, 'ritual')), concentration: orStr(get(info, 'duration')).toLowerCase().includes('concentration'),
      notes: get(sp, 'notes', '') });
  }
  for (const k of Object.keys(spellRows)) spellRows[k].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const features = list(or(get(char, 'extra_features'), [])).filter((f) => orStr(get(f, 'name')).trim())
    .map((f) => ({ name: f.name, source: or(get(f, 'source'), ''), text: get(f, 'text', '') }));
  const profLines = (or(get(m, 'proficiencies'), '')).split('\n').map((line) => line.trim()).filter(Boolean);
  if (orStr(get(char, 'tools')).trim()) profLines.push('Tools: ' + char.tools.trim());
  const hp = toInt(get(m, 'hp_max'));
  const initiative = mods.dex + (jack ? Math.floor(prof / 2) : 0) + toInt(get(m, 'init_bonus'));
  const inv = list(or(get(char, 'inventory'), [])).filter(isDict);
  const riders = [];
  list(or(get(m, 'riders'), [])).forEach((r, i) => {
    if (!orStr(get(r, 'name')).trim()) return;
    riders.push({ ...r, id: or(get(r, 'id'), `r${i}`), flat: toInt(get(r, 'flat')), once: T(get(r, 'once')),
      applies: or(get(r, 'applies'), 'any') });
  });
  return {
    total_level: level, prof, scores, mods,
    score_parts: Object.fromEntries(ABILITIES.map((a) => [a, { base: scores[a], race: 0, asi: 0, feat: 0 }])),
    saves, skills,
    passive_perception: 10 + skillBonus.Perception + toInt(get(m, 'passive_bonus')),
    passive_investigation: 10 + skillBonus.Investigation, passive_insight: 10 + skillBonus.Insight,
    initiative,
    ac: toInt(get(m, 'ac')) || 10 + mods.dex,
    ac_note: orStr(get(m, 'ac_note')).trim(),
    speed: toInt(get(m, 'speed')) || 30,
    hp_max: hp, hit_dice: orStr(get(m, 'hit_dice')).trim(),
    attacks, spellcasting: casters, slots, pact, granted_spells: [],
    spells: Object.fromEntries(Object.keys(spellRows).map(Number).sort((a, b) => a - b).map((k) => [String(k), spellRows[k]])),
    features, proficiencies: profLines, languages: or(get(char, 'languages'), ''),
    asi: { available: 0, used: 0 }, class_line: orStr(get(m, 'class_text')).trim(),
    size: orStr(get(m, 'size')).trim(), darkvision: toInt(get(m, 'darkvision')) || null,
    race_name: orStr(get(m, 'race_text')).trim(), background_name: orStr(get(m, 'background_text')).trim(),
    roll: { lucky: T(get(m, 'lucky')), reliable_talent: T(get(m, 'reliable_talent')),
      crit_range: Math.max(15, Math.min(20, toInt(get(m, 'crit_range'), 20))),
      extra_crit_dice: toInt(get(m, 'extra_crit_dice')), riders, jack,
      war_caster: features.some((f) => orStr(get(f, 'name')).trim().toLowerCase() === 'war caster') },
    mode: 'manual', warnings,
    gear_profs: manualGearProfs(get(m, 'proficiencies'), get(char, 'tools')),
    carry: carry(char, scores.str, {}, inv),
    inventory_lines: gear.inventoryLines(inv), coins_text: gear.coinsText(get(char, 'coins')),
    attunement: attunement(inv, 3), treasure_cp: gear.treasureValue(inv), resistances: [],
    resources: manualResources(m, mods, prof, level, features, char),
    companions: manualCompanions(m, prof, char),
  };
}

/** A hand-written sheet names its classes in text ("Fighter 5 / Wizard 2"); that's enough for the table. */
function manualResources(m, mods, prof, level, features) {
  const [levels, subs] = classResources.levelsFromText(get(m, 'class_text'));
  const feats = features.filter((f) => orStr(get(f, 'source')).toLowerCase().startsWith('feat')).map((f) => ({ name: f.name }));
  return classResources.compute(levels, subs, mods, prof, feats, features, level);
}

function manualCompanions(m, prof, char) {
  const [levels, subs] = classResources.levelsFromText(get(m, 'class_text'));
  const names = list(or(get(char, 'extra_features'), [])).map((f) => or(get(f, 'name'), ''));
  return creatures.companionInfo(levels, subs, list(or(get(char, 'spells'), [])).map((x) => or(get(x, 'name'), '')), names, prof);
}

export function computeAny(char, ctx) {
  if (get(char, 'mode') === 'manual') return computeManual(char, ctx);
  return compute(char, ctx);
}

/** A hand-written copy of a built character: every number is kept and becomes editable. */
export function toManual(char, sheet) {
  const out = {};
  for (const [k, v] of Object.entries(char)) if (k !== 'id') out[k] = v;
  const jack = sheet.skills.some((x) => x.prof === 'half');
  const prof = sheet.prof;
  const attacks = sheet.attacks.map((a) => {
    const ab = or(get(a, 'ability'), '');
    const amod = get(sheet.mods, ab, 0);
    const dice = or(get(a, 'dice'), '');
    return {
      name: a.name, ability: ab, prof: T(get(a, 'prof')), bonus: a.bonus - amod - (T(get(a, 'prof')) ? prof : 0),
      dice: dice || String(a.mod - amod), dmg_bonus: dice ? a.mod - amod : 0, add_mod: true,
      type: get(a, 'type', ''), versatile: or(get(a, 'versatile'), ''), notes: get(a, 'properties', ''),
      range: T(get(a, 'ranged')) ? 'ranged' : 'melee', finesse: T(get(a, 'finesse')), kind: 'weapon' };
  });
  const caster = sheet.spellcasting.length ? sheet.spellcasting[0] : null;
  const pact = or(get(sheet, 'pact'), {});
  Object.assign(out, {
    mode: 'manual',
    base_scores: { ...sheet.scores }, ability_method: 'manual',
    race_bonus: Object.fromEntries(ABILITIES.map((a) => [a, 0])), improvements: Object.fromEntries(ABILITIES.map((a) => [a, 0])),
    skills: sheet.skills.filter((x) => ['proficient', 'expertise'].includes(x.prof)).map((x) => x.name),
    expertise: sheet.skills.filter((x) => x.prof === 'expertise').map((x) => x.name),
    extra_features: sheet.features.map((f) => ({ name: f.name, source: get(f, 'source', ''), text: get(f, 'text', '') })),
    languages: or(get(sheet, 'languages'), ''), tools: '',
    spells: list(or(get(char, 'spells'), [])).map((sp) => ({ ...sp, class: 'manual' })),
    manual: {
      class_text: sheet.class_line, level: sheet.total_level,
      race_text: get(sheet, 'race_name', ''), background_text: get(sheet, 'background_name', ''),
      save_profs: ABILITIES.filter((a) => T(sheet.saves[a].prof)), jack,
      ac: sheet.ac, ac_note: get(sheet, 'ac_note', ''), hp_max: sheet.hp_max, speed: sheet.speed,
      hit_dice: sheet.hit_dice, init_bonus: sheet.initiative - sheet.mods.dex - (jack ? Math.floor(prof / 2) : 0),
      passive_bonus: sheet.passive_perception - 10 - sheet.skills.find((x) => x.name === 'Perception').bonus,
      attacks,
      spell_ability: caster ? caster.ability : '',
      spell_class: sheet.spellcasting.map((c) => c.class).join(' / '),
      slots: [...sheet.slots],
      pact_count: get(pact, 'count', 0), pact_level: get(pact, 'level', 0),
      proficiencies: sheet.proficiencies.join('\n'),
      size: get(sheet, 'size', ''), darkvision: or(get(sheet, 'darkvision'), ''),
      lucky: sheet.roll.lucky, reliable_talent: sheet.roll.reliable_talent,
      crit_range: sheet.roll.crit_range, extra_crit_dice: sheet.roll.extra_crit_dice,
      riders: sheet.roll.riders.map((r) => ({ name: r.name, dice: r.dice, flat: r.flat, type: r.type, applies: r.applies, once: r.once })),
    },
  });
  return out;
}
