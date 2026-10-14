/* 2014 rules math: turns a character's choices into the numbers on the sheet.

   compute(char, ctx) is pure: `char` is the saved character, `ctx` holds the looked-up
   details for its classes, subclasses, race, background, feats and spells (built by
   library.buildContext). Problems are returned as warnings rather than errors, so a
   half-finished character still shows a sheet. A line-by-line port of the PC app's
   rules.py; tests/parity.test.mjs checks both give the same answers. */
import {
  ABILITIES, ABILITY_NAMES, ARMOR, DEFAULT_ASI_LEVELS, FULL_CASTER_SLOTS, PACT_SLOTS,
  POINT_BUY_BUDGET, POINT_BUY_COST, SKILLS, STANDARD_ARRAY, WEAPONS, modifier, ordinal, proficiencyBonus,
} from './srd.js';

const HIDDEN_RACE_TRAITS = new Set(['ability score increase', 'age', 'alignment', 'size', 'speed', 'languages',
  'creature type', 'language']);

/** Python's int(): whole numbers and numeric strings; anything else falls back to the default. */
export function toInt(v, def = 0) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.trunc(v) : def;
  if (typeof v === 'string' && /^\s*[-+]?\d+\s*$/.test(v)) return parseInt(v, 10);
  return def;
}
const fmt = (n) => (n >= 0 ? `+${n}` : String(n));
export const slugify = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const title = (s) => s.replace(/[A-Za-z]+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
const hasFeat = (feats, name) => feats.some((f) => (f.name || '').trim().toLowerCase() === name.toLowerCase());
const firstInt = (v) => { const m = String(v ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };
/** Python truthiness: empty lists and objects count as false. */
const T = (v) => Boolean(v) && !(Array.isArray(v) && !v.length)
  && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length);
const or = (...vals) => vals.find(T) ?? vals[vals.length - 1];
const maxOf = (arr) => (arr.length ? Math.max(...arr) : 0);
const inc = (map, key, by = 1) => map.set(key, (map.get(key) || 0) + by);

function abilityScores(char, warnings) {
  const base = or(char.base_scores, {});
  const raceBonus = or(char.race_bonus, {});
  const improvements = or(char.improvements, {});
  const scores = {}, parts = {};
  const featBonus = new Map();
  for (const f of char.feats || []) {
    const ab = f.asi, amt = toInt(f.asi_amount, 0);
    if (ABILITIES.includes(ab) && amt) inc(featBonus, ab, amt);
  }
  for (const a of ABILITIES) {
    const b = toInt(base[a], 10), r = toInt(raceBonus[a]), i = toInt(improvements[a]), f = featBonus.get(a) || 0;
    scores[a] = b + r + i + f;
    parts[a] = { base: b, race: r, asi: i, feat: f };
    if (scores[a] > 20) warnings.push(`${ABILITY_NAMES[a]} is ${scores[a]}; scores normally cap at 20.`);
  }
  const method = char.ability_method || 'manual';
  const vals = ABILITIES.map((a) => toInt(base[a], 10));
  if (method === 'point_buy') {
    if (vals.some((v) => v < 8 || v > 15)) warnings.push('Point buy scores must be between 8 and 15 before bonuses.');
    else {
      const spent = vals.reduce((t, v) => t + POINT_BUY_COST[v], 0);
      if (spent > POINT_BUY_BUDGET) warnings.push(`Point buy uses ${spent} points; the budget is ${POINT_BUY_BUDGET}.`);
    }
  } else if (method === 'standard') {
    const sorted = [...vals].sort((x, y) => y - x);
    if (sorted.join() !== STANDARD_ARRAY.join()) warnings.push('Standard array scores should be 15, 14, 13, 12, 10 and 8, each used once.');
  }
  return [scores, parts];
}

function singleClassCasterLevel(kind, lvl) {
  if (kind === 'full') return lvl;
  if (kind === 'half') return lvl >= 2 ? Math.ceil(lvl / 2) : 0;
  if (kind === 'artificer') return Math.ceil(lvl / 2);
  if (kind === 'third') return lvl >= 3 ? Math.ceil(lvl / 3) : 0;
  return 0;
}
function multiclassContribution(kind, lvl) {
  return ({ full: lvl, half: Math.floor(lvl / 2), artificer: Math.ceil(lvl / 2), third: Math.floor(lvl / 3) })[kind] || 0;
}
function slotsFor(casterLevel) {
  if (casterLevel <= 0) return Array(9).fill(0);
  const row = FULL_CASTER_SLOTS[Math.min(casterLevel, 20) - 1];
  return [...row, ...Array(9 - row.length).fill(0)];
}
function tableValue(table, level, ...names) {
  for (const row of table || []) {
    if (row._level === level) {
      for (const [col, val] of Object.entries(row)) {
        if (names.some((n) => col.toLowerCase().includes(n))) return firstInt(val);
      }
    }
  }
  return null;
}
function tableSlots(table, level) {
  for (const row of table || []) {
    if (row._level === level) {
      const out = [];
      for (let n = 1; n <= 9; n++) out.push(firstInt(row[ordinal(n)] || '') || 0);
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
  const warnings = [...(ctx.warnings || [])];
  const classes = (char.classes || []).filter((c) => c.name);
  const cctx = or(ctx.classes, []);
  while (cctx.length < classes.length) cctx.push({ rules: {}, detail: {}, subclass: null });
  const levels = classes.map((c) => Math.max(1, Math.min(20, toInt(c.level, 1))));
  const totalLevel = levels.reduce((a, b) => a + b, 0) || 1;
  if (totalLevel > 20) warnings.push(`Total level is ${totalLevel}; the maximum is 20.`);
  const prof = proficiencyBonus(totalLevel);

  const [scores, scoreParts] = abilityScores(char, warnings);
  const mods = Object.fromEntries(Object.entries(scores).map(([a, v]) => [a, modifier(v)]));
  const feats = or(char.feats, []);
  const race = or(ctx.race, {});
  const raceInfo = or(race.analysis, {});
  const background = or(ctx.background, {});

  const levelOf = new Map();
  const subclassSlug = {};
  classes.forEach((c, i) => {
    const slug = c.slug || slugify(c.name);
    inc(levelOf, slug, levels[i]);
    if (T(c.subclass) && c.subclass.name) {
      subclassSlug[slug] = (c.subclass.path || '').split(':').pop() || slugify(c.subclass.name);
    }
  });
  const lv = (slug) => levelOf.get(slug) || 0;
  const sub = (slug) => subclassSlug[slug] || '';

  // ---------------------------------------------------------- saves
  const firstRules = classes.length ? cctx[0].rules : {};
  const saveProfs = new Set(firstRules.saves || []);
  for (const f of feats) {
    if ((f.name || '').toLowerCase() === 'resilient' && ABILITIES.includes(f.asi)) saveProfs.add(f.asi);
  }
  (char.extra_save_profs || []).forEach((a) => saveProfs.add(a));
  const saves = Object.fromEntries(ABILITIES.map((a) => [a, { bonus: mods[a] + (saveProfs.has(a) ? prof : 0), prof: saveProfs.has(a) }]));

  // ---------------------------------------------------------- skills
  const bgSkills = new Set(background.skills || []);
  const raceSkills = new Set(raceInfo.skills || []);
  const chosen = new Set(char.skills || []);
  const proficient = new Set([...chosen, ...bgSkills, ...raceSkills]);
  const expertise = new Set(char.expertise || []);
  const jack = lv('bard') >= 2;
  const skills = [];
  for (const [name, ab] of Object.entries(SKILLS)) {
    let bonus, kind;
    if (expertise.has(name) && proficient.has(name)) [bonus, kind] = [mods[ab] + 2 * prof, 'expertise'];
    else if (proficient.has(name)) [bonus, kind] = [mods[ab] + prof, 'proficient'];
    else if (jack) [bonus, kind] = [mods[ab] + Math.floor(prof / 2), 'half'];
    else [bonus, kind] = [mods[ab], ''];
    const src = bgSkills.has(name) ? 'background' : raceSkills.has(name) ? 'race' : (chosen.has(name) ? 'chosen' : '');
    skills.push({ name, ability: ab, bonus, prof: kind, source: src });
  }
  for (const name of expertise) {
    if (!proficient.has(name)) warnings.push(`Expertise in ${name} needs proficiency in it first.`);
  }
  if (classes.length) {
    let allowed = toInt(firstRules.skill_count, 0) + toInt(raceInfo.skill_choices, 0);
    for (const slug of [...levelOf.keys()].slice(1)) allowed += ({ bard: 1, ranger: 1, rogue: 1 })[slug] || 0;
    if (hasFeat(feats, 'Skilled')) allowed += 3;
    const extra = [...chosen].filter((s) => !bgSkills.has(s) && !raceSkills.has(s));
    if (allowed && extra.length > allowed) {
      warnings.push(`${extra.length} skills picked, but your class and species allow ${allowed} (background skills are added on top).`);
    }
  }
  const skillBonus = Object.fromEntries(skills.map((s) => [s.name, s.bonus]));

  // ---------------------------------------------------------- hit points
  const con = mods.con;
  let hp = 0, idx = 0;
  const rolls = or(char.hp_rolls, []);
  const rolled = char.hp_mode === 'rolled';
  const dice = new Map();
  classes.forEach((c, i) => {
    const die = toInt(cctx[i].rules.hit_die, 8) || 8;
    inc(dice, die, levels[i]);
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
  hp += toInt(raceInfo.hp_per_level) * totalLevel;
  if (hasFeat(feats, 'Tough')) hp += 2 * totalLevel;
  if (sub('sorcerer').startsWith('draconic')) hp += lv('sorcerer');
  hp += toInt(char.hp_bonus);
  if (!classes.length) hp = 0;

  // ---------------------------------------------------------- armor class
  const armorName = char.armor || '';
  const shield = Boolean(char.shield);
  const armor = ARMOR[armorName];
  const armorProfs = new Set();
  cctx.slice(0, classes.length).forEach((cc) => (cc.rules.armor || []).forEach((a) => armorProfs.add(a)));
  (raceInfo.armor_profs || []).forEach((a) => armorProfs.add(a));
  for (const f of feats) {
    const n = (f.name || '').toLowerCase();
    if (n === 'lightly armored') { armorProfs.add('light'); armorProfs.add('shield'); }
    else if (n === 'moderately armored') { armorProfs.add('medium'); armorProfs.add('shield'); }
    else if (n === 'heavily armored') armorProfs.add('heavy');
  }
  let ac, acNote = '';
  if (armor) {
    const [cat, base, maxdexRaw] = armor;
    let maxdex = maxdexRaw;
    if (cat === 'medium' && hasFeat(feats, 'Medium Armor Master')) maxdex = 3;
    ac = base + (maxdex == null ? mods.dex : Math.min(mods.dex, maxdex));
    acNote = armorName;
    if (!armorProfs.has(cat)) warnings.push(`Not proficient with ${cat} armor (${armorName}).`);
  } else {
    const options = [[10 + mods.dex, 'Unarmored']];
    if (levelOf.has('barbarian')) options.push([10 + mods.dex + mods.con, 'Unarmored Defense']);
    if (levelOf.has('monk') && !shield) options.push([10 + mods.dex + mods.wis, 'Unarmored Defense']);
    if (sub('sorcerer').startsWith('draconic')) options.push([13 + mods.dex, 'Draconic Resilience']);
    // Python's max() on (ac, note) tuples: highest AC, ties broken by the later name alphabetically
    [ac, acNote] = options.reduce((best, o) => (o[0] > best[0] || (o[0] === best[0] && o[1] > best[1]) ? o : best));
  }
  if (shield) {
    ac += 2;
    acNote += ' + shield';
    if (!armorProfs.has('shield')) warnings.push('Not proficient with shields.');
  }
  ac += toInt(char.ac_bonus);

  // ---------------------------------------------------------- speed & initiative
  let speed = toInt(char.speed_override) || toInt(raceInfo.speed) || 30;
  const monk = lv('monk');
  if (monk >= 2 && !armor && !shield) speed += monk < 18 ? 10 + 5 * Math.floor((monk - 2) / 4) : 30;
  if (lv('barbarian') >= 5 && !(armor && armor[0] === 'heavy')) speed += 10;
  if (armor && armor[3] && scores.str < armor[3] && !(race.speed_text || '').includes('not reduced by wearing heavy armor')) {
    speed -= 10;
    warnings.push(`${armorName} needs Strength ${armor[3]}; speed drops by 10 feet.`);
  }
  if (hasFeat(feats, 'Mobile')) speed += 10;
  const initiative = mods.dex + (jack ? Math.floor(prof / 2) : 0) + (hasFeat(feats, 'Alert') ? 5 : 0);
  const passive = 10 + skillBonus.Perception + (hasFeat(feats, 'Observant') ? 5 : 0);

  // ---------------------------------------------------------- attacks
  const weaponProfs = new Set();
  cctx.slice(0, classes.length).forEach((cc) => (cc.rules.weapons || []).forEach((w) => weaponProfs.add(w.toLowerCase())));
  (raceInfo.weapon_profs || []).forEach((w) => weaponProfs.add(w.toLowerCase()));
  let maDie = 0;
  if (monk) maDie = monk < 5 ? 4 : monk < 11 ? 6 : monk < 17 ? 8 : 10;
  const attacks = [];
  for (const w of char.weapons || []) {
    const wname = typeof w === 'string' ? w : (w.name || '');
    const magic = typeof w === 'string' ? 0 : toInt(w.bonus);
    const data = WEAPONS[wname];
    if (!data) continue;
    const [cat, ranged, dmgBase, dtype, props] = data;
    let dmg = dmgBase;
    let ab = ranged ? 'dex' : 'str';
    if (props.includes('finesse')) ab = mods.dex > mods.str ? 'dex' : 'str';
    const monkWeapon = monk && !ranged && (['Unarmed strike', 'Shortsword'].includes(wname)
      || (cat === 'simple' && !props.includes('two-handed') && !props.includes('heavy')));
    if (monkWeapon) {
      ab = mods.dex > mods.str ? 'dex' : 'str';
      const current = dmg.includes('d') ? parseInt(dmg.split('d')[1], 10) : 1;
      if (maDie > current) dmg = `1d${maDie}`;
    }
    const isProf = wname === 'Unarmed strike' || weaponProfs.has(cat) || weaponProfs.has(wname.toLowerCase())
      || weaponProfs.has(wname.toLowerCase() + 's');
    const toHit = mods[ab] + (isProf ? prof : 0) + magic;
    const dmgMod = mods[ab] + magic;
    const damage = (dmg === '1' ? `${1 + dmgMod}` : `${dmg}${dmgMod === 0 ? '' : fmt(dmgMod)}`) + ` ${dtype}`;
    if (!isProf) warnings.push(`Not proficient with ${wname}; its attack bonus leaves out proficiency.`);
    attacks.push({ name: wname + (magic ? ` ${fmt(magic)}` : ''), bonus: toHit, damage, properties: props.join(', ') });
  }

  // ---------------------------------------------------------- spellcasting
  const casters = [], nonpact = [];
  let pact = null;
  classes.forEach((c, i) => {
    const lvl = levels[i], cc = cctx[i];
    const rules = cc.rules, detail = or(cc.detail, {});
    const slug = c.slug || slugify(c.name);
    let kind = rules.caster || 'none', ability = rules.spell_ability;
    const thirdSub = rules.third_caster_subclass;
    if (kind === 'none' && thirdSub && sub(slug).startsWith(thirdSub)) [kind, ability] = ['third', rules.third_caster_ability || 'int'];
    if (kind === 'none' || !ability) return;
    const mod = mods[ability];
    const info = {
      class: c.name, slug, level: lvl, type: kind, ability, dc: 8 + prof + mod, attack: prof + mod,
      cantrips_known: tableValue(detail.table, lvl, 'cantrips known'),
      spells_known: tableValue(detail.table, lvl, 'spells known'), prepared_count: null,
    };
    if (rules.prepares === 'full') info.prepared_count = Math.max(1, mod + lvl);
    else if (rules.prepares === 'half') info.prepared_count = Math.max(1, mod + Math.floor(lvl / 2));
    if (kind === 'pact') {
      const [count, slotLevel] = PACT_SLOTS[lvl - 1];
      pact = { count, level: slotLevel };
      const arcanum = maxOf([[11, 6], [13, 7], [15, 8], [17, 9]].filter(([at]) => lvl >= at).map(([, sp]) => sp));
      info.max_spell_level = Math.max(slotLevel, arcanum);
    } else {
      let own = slotsFor(singleClassCasterLevel(kind, lvl));
      if (!own.some(Boolean)) own = tableSlots(detail.table, lvl) || own;
      info.max_spell_level = maxOf(own.map((n, j) => (n ? j + 1 : 0)).filter(Boolean));
      nonpact.push([kind, lvl, detail]);
    }
    casters.push(info);
  });

  let slots = Array(9).fill(0);
  if (nonpact.length === 1) {
    const [kind, lvl, detail] = nonpact[0];
    const fromTable = tableSlots(detail.table, lvl);
    const computed = slotsFor(singleClassCasterLevel(kind, lvl));
    slots = computed.some(Boolean) ? computed : (fromTable || computed);
  } else if (nonpact.length > 1) {
    slots = slotsFor(nonpact.reduce((t, [k, l]) => t + multiclassContribution(k, l), 0));
  }

  const spellRows = {};
  const knownSpells = ctx.spells || {};
  const byClassMax = Object.fromEntries(casters.map((c) => [c.slug, c.max_spell_level]));
  const overallMax = maxOf(Object.values(byClassMax));
  const cantripsByClass = new Map();
  for (const s of char.spells || []) {
    const info = or(knownSpells[String(s.id)], knownSpells[(s.name || '').toLowerCase()], {});
    const lvl = toInt(s.level != null ? s.level : info.level, 0);
    const cls = s.class || '';
    const limit = cls in byClassMax ? byClassMax[cls] : overallMax;
    if (lvl > limit && !s.always) {
      warnings.push(`${s.name} is a ${ordinal(lvl)}-level spell; ${title(cls || 'your')} can cast up to ${limit ? ordinal(limit) : 'cantrips only'}.`);
    }
    if (lvl === 0) inc(cantripsByClass, cls);
    const row = {
      name: s.name, level: lvl, class: cls, prepared: 'prepared' in s ? T(s.prepared) : true, always: Boolean(s.always), id: s.id ?? null,
      school: info.school || '', casting_time: info.casting_time || '', range: info.range || '',
      components: info.components || '', duration: info.duration || '', ritual: Boolean(info.ritual),
      concentration: (info.duration || '').toLowerCase().includes('concentration'),
    };
    (spellRows[lvl] = spellRows[lvl] || []).push(row);
  }
  for (const c of casters) {
    const n = cantripsByClass.get(c.slug) || 0;
    if (c.cantrips_known != null && n > c.cantrips_known) {
      warnings.push(`${n} ${c.class} cantrips picked; ${c.cantrips_known} known at level ${c.level}.`);
    }
  }
  for (const k of Object.keys(spellRows)) {
    spellRows[k].sort((a, b) => ((a.name || '') < (b.name || '') ? -1 : (a.name || '') > (b.name || '') ? 1 : 0));
  }

  // ---------------------------------------------------------- features
  const features = [], granted = [];
  for (const t of race.traits || []) {
    if (!HIDDEN_RACE_TRAITS.has(t.name.trim().toLowerCase())) features.push({ name: t.name, source: race.name || 'Species', text: t.text });
  }
  classes.forEach((c, i) => {
    const lvl = levels[i], cc = cctx[i];
    const detail = or(cc.detail, {});
    const seen = new Set();
    for (const f of detail.features || []) {
      const fl = f.level;
      if (fl == null || fl > lvl || skipFeature(f.name) || seen.has(f.name)) continue;
      seen.add(f.name);
      features.push({ name: f.name, source: `${c.name} ${fl}`, level: fl, text: f.text || '' });
    }
    const subDetail = or(cc.subclass, {});
    const subLevel = toInt(cc.rules.subclass_level, 3);
    if (T(cc.subclass) && T(c.subclass) && lvl >= subLevel) {
      for (const f of subDetail.features || []) {
        const fl = f.level || subLevel;
        if (fl <= lvl) features.push({ name: f.name, source: `${c.subclass.name || 'Subclass'} ${fl}`, level: fl, text: f.text || '' });
      }
      for (const row of subDetail.bonus_spells || []) {
        if (row.level <= lvl) {
          for (const sp of row.spells) {
            if (!(char.spells || []).some((s) => (s.name || '').toLowerCase() === sp.toLowerCase())) {
              granted.push({ name: sp, class: c.slug || slugify(c.name), source: c.subclass.name });
            }
          }
        }
      }
    } else if (T(c.subclass) && lvl < subLevel) {
      warnings.push(`${c.name} picks a subclass at level ${subLevel}.`);
    }
  });
  const bf = or(background.feature, {});
  if (bf.name) features.push({ name: bf.name, source: `Background: ${background.name || ''}`, text: bf.text || '' });
  const featDetails = or(ctx.feats, {});
  for (const f of feats) {
    const d = or(featDetails[String(f.id)], {});
    features.push({ name: f.name, source: 'Feat', text: d.text || '' });
  }
  for (const f of char.extra_features || []) {
    if (f.name) features.push({ name: f.name, source: f.source || 'Custom', text: f.text || '' });
  }
  if (granted.length) {
    warnings.push(`${granted.length} always-prepared spell${granted.length > 1 ? 's' : ''} from your subclass not added yet (see the Spells step).`);
  }

  // ---------------------------------------------------------- ability score improvements
  let asiTotal = 0;
  classes.forEach((c, i) => {
    const asiLevels = or(cctx[i].rules.asi_levels, or(cctx[i].detail, {}).asi_levels, DEFAULT_ASI_LEVELS);
    asiTotal += asiLevels.filter((x) => x <= levels[i]).length;
  });
  const points = Object.values(or(char.improvements, {})).reduce((t, v) => t + toInt(v), 0);
  const asiFeats = feats.filter((f) => (f.from || 'asi') === 'asi').length;
  const used = points / 2 + asiFeats;
  if (used > asiTotal) warnings.push(`Using ${used} ability score improvements; your levels give ${asiTotal}.`);
  const raceFeats = feats.filter((f) => f.from === 'race').length;
  if (raceFeats && !raceInfo.bonus_feat) warnings.push("A feat is marked as coming from your species, but your species doesn't list a bonus feat.");

  // ---------------------------------------------------------- proficiencies text
  const firstDetail = classes.length ? or(cctx[0].detail, {}) : {};
  const profLines = [];
  if (classes.length) {
    profLines.push(`Armor: ${firstDetail.armor || or(firstRules.armor, []).join(', ') || 'None'}`);
    profLines.push(`Weapons: ${firstDetail.weapons || or(firstRules.weapons, []).join(', ')}`);
  }
  if ((raceInfo.weapon_profs || []).length) profLines.push('Species weapons: ' + raceInfo.weapon_profs.join(', '));
  const tools = [firstDetail.tools || '', background.tools || '', char.tools || ''].filter((t) => t && t.toLowerCase() !== 'none');
  if (tools.length) profLines.push('Tools: ' + tools.join('; '));
  const languages = char.languages || raceInfo.languages || '';

  const classLine = classes.map((c, i) => `${c.name} ${levels[i]}` + (T(c.subclass) && c.subclass.name ? ` (${c.subclass.name})` : '')).join(' / ');
  const hitDice = [...dice.entries()].sort((a, b) => b[0] - a[0] || b[1] - a[1]).map(([d, n]) => `${n}d${d}`).join(' + ');

  return {
    total_level: totalLevel, prof, scores, mods, score_parts: scoreParts,
    saves, skills, passive_perception: passive,
    passive_investigation: 10 + skillBonus.Investigation, passive_insight: 10 + skillBonus.Insight,
    initiative, ac, ac_note: acNote.trim(), speed,
    hp_max: hp, hit_dice: hitDice,
    attacks, spellcasting: casters, slots, pact, granted_spells: granted,
    spells: Object.fromEntries(Object.keys(spellRows).map(Number).sort((a, b) => a - b).map((k) => [String(k), spellRows[k]])),
    features, proficiencies: profLines, languages,
    asi: { available: asiTotal, used },
    class_line: classLine, size: raceInfo.size || '', darkvision: raceInfo.darkvision ?? null,
    warnings,
  };
}
