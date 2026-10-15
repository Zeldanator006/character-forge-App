'use strict';
/* Dice rolling for the character sheet: a fair roller plus the rules around it
   (advantage, Bless, Guidance, crits, Lucky, Reliable Talent, class extra damage). */

const Dice = (() => {
  function die(sides) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / sides) * sides;
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return (x % sides) + 1;
  }
  // "2d6+1d4-1" -> { terms: [{n, sides, sign}], flat }
  function parse(expr) {
    const clean = String(expr || '').toLowerCase().replace(/\s+/g, '');
    if (!clean) return null;
    const re = /([+-]?)(\d*)d(\d+)|([+-]?)(\d+)/g;
    const terms = [];
    let flat = 0, idx = 0, m;
    while ((m = re.exec(clean))) {
      if (m.index !== idx || (idx > 0 && !(m[1] || m[4]))) return null;
      idx = re.lastIndex;
      if (m[3]) {
        const n = m[2] === '' ? 1 : +m[2], sides = +m[3];
        if (n < 1 || n > 100 || sides < 1 || sides > 1000) return null;
        terms.push({ n, sides, sign: m[1] === '-' ? -1 : 1 });
      } else flat += (m[4] === '-' ? -1 : 1) * +m[5];
    }
    return idx === clean.length ? { terms, flat } : null;
  }
  return { die, parse };
})();

const ROLL_KINDS = { check: 'check', skill: 'check', init: 'check', save: 'save', death: 'save', attack: 'attack' };

function trayState() {
  if (!S.tray) {
    S.tray = { adv: 'normal', keepAdv: false, bless: false, guidance: false, bonus: '', riders: {}, custom: '',
      expr: '', history: [], collapsed: window.innerWidth <= 1200, nextId: 1 };
  }
  return S.tray;
}
const rollInfo = () => (S.sheet && S.sheet.roll) || { riders: [], crit_range: 20 };
const FOLLOW = new Map();

/* ---------------------------------------------------------------- d20 rolls */
function rollD20({ label, mod = 0, kind = 'check', proficient = false, follow, dis = '', ab = '', adv = [], plain = false, conditions = !plain }) {
  // plain: a companion's or beast form's numbers, so your own traits (Lucky, Reliable Talent, crit range) don't apply.
  // conditions: your conditions, exhaustion, cover and rage do (true for you, and for you in Wild Shape)
  const t = trayState(), r = plain ? { crit_range: 20 } : rollInfo();
  const group = ROLL_KINDS[kind] || 'check';
  const sit = conditions && typeof rollSituation === 'function' ? rollSituation(kind, ab) : { adv: [], dis: [], fail: '' };
  if (sit.fail) {
    if (!t.keepAdv) t.adv = 'normal';
    return pushResult({ label, total: 0, failed: true, detail: `No roll: while ${sit.fail.toLowerCase()} you fail Strength and Dexterity saving throws.`,
      flags: [[`Automatic failure (${sit.fail.toLowerCase()})`, 'bad']], follow: [] });
  }
  const advs = [...sit.adv, ...adv], diss = [...(dis ? [dis] : []), ...sit.dis];
  const anyAdv = advs.length || t.adv === 'adv', anyDis = diss.length || t.adv === 'dis';
  const mode = anyAdv && anyDis ? 'normal' : anyAdv ? 'adv' : anyDis ? 'dis' : 'normal';   // they cancel out
  const one = () => {
    const first = Dice.die(20);
    return r.lucky && first === 1 ? { v: Dice.die(20), lucky: true } : { v: first };
  };
  const a = one(), b = mode !== 'normal' ? one() : null;
  const nat = b ? (mode === 'adv' ? Math.max(a.v, b.v) : Math.min(a.v, b.v)) : a.v;
  let used = nat;
  const flags = [], extras = [];
  if (anyAdv && anyDis) {
    const a = advs.length ? advs.join(', ') : 'the dice panel', d = diss.length ? diss.join(', ') : 'the dice panel';
    flags.push([`Advantage (${a}) and disadvantage (${d}) cancel out`, 'info']);
  } else if (diss.length) flags.push([`Disadvantage from ${diss.join(', ')}`, 'info']);
  else if (advs.length) flags.push([`Advantage from ${advs.join(', ')}`, 'info']);
  if (a.lucky || (b && b.lucky)) flags.push(['Lucky: rerolled a 1', 'info']);
  if (kind === 'skill' && proficient && r.reliable_talent && used < 10) { used = 10; flags.push(['Reliable Talent: counted as 10', 'info']); }
  const addExtra = (name, expr) => {
    const p = Dice.parse(expr);
    if (!p) return;
    const rolls = [];
    let v = p.flat;
    p.terms.forEach((tm) => { for (let i = 0; i < tm.n; i++) { const d = Dice.die(tm.sides); rolls.push(d); v += tm.sign * d; } });
    extras.push({ name, v, rolls });
  };
  (sit.bonus || []).forEach((x) => extras.push({ name: x.name, v: x.v, rolls: [] }));   // cover on Dexterity saves
  if (t.bless && group !== 'check') addExtra('Bless', '1d4');
  if (t.guidance && group === 'check' && kind !== 'death') { addExtra('Guidance', '1d4'); t.guidance = false; flags.push(['Guidance used', 'info']); }
  if (t.bonus.trim()) addExtra('Extra', t.bonus.replace(/^\s*\+/, ''));
  const useMod = kind === 'death' ? 0 : mod;
  const total = used + useMod + extras.reduce((s, x) => s + x.v, 0);

  let detail = b ? `d20: ${a.v} and ${b.v}, ${mode === 'adv' ? 'advantage' : 'disadvantage'} keeps ${nat}` : `d20: ${nat}`;
  if (used !== nat) detail += ` (counted as ${used})`;
  if (useMod) detail += ` ${signed(useMod)}`;
  extras.forEach((x) => { detail += `, ${x.name} ${signed(x.v)}${x.rolls.length ? ` (${x.rolls.join(', ')})` : ''}`; });

  let crit = false, title = label;
  if (kind === 'attack') {
    crit = nat >= (r.crit_range || 20);
    if (crit) flags.unshift(['Critical hit', 'good']);
    else if (nat === 1) flags.unshift(['Natural 1: automatic miss', 'bad']);
  } else if (kind === 'death') {
    if (nat === 20) flags.unshift(['Natural 20: regain 1 hit point', 'good']);
    else if (nat === 1) flags.unshift(['Natural 1: two failures', 'bad']);
    else flags.unshift(total >= 10 ? ['Success', 'good'] : ['Failure', 'bad']);
  } else if (nat === 20) flags.unshift(['Natural 20', 'good']);
  else if (nat === 1) flags.unshift(['Natural 1', 'bad']);
  if (!t.keepAdv) t.adv = 'normal';
  return pushResult({ label: title, total, detail, flags, nat, follow: follow ? follow(crit) : [] });
}

/* ---------------------------------------------------------------- damage */
function riderApplies(rd, atk) {
  switch (rd.applies) {
    case 'weapon': return !!(atk && atk.weapon);
    case 'melee': return !!(atk && atk.weapon && atk.melee);
    case 'str-melee': return !!(atk && atk.weapon && atk.melee && atk.ability === 'str');
    case 'finesse-ranged': return !!(atk && atk.weapon && (atk.finesse || atk.ranged));
    case 'spell': return !!(atk && atk.spell);
    case 'pact': return !!(atk && atk.pact);
    default:
      if (String(rd.applies || '').startsWith('item:')) return !!(atk && atk.item === rd.applies.slice(5));
      return !!atk;   // 'any': any attack that hits
  }
}

function rollDamage({ label, dice, mod = 0, type = '', crit = false, attack = null, heal = false, extra = [] }) {
  const t = trayState(), r = rollInfo();
  const parts = [], flags = [];
  let flat = mod;
  const add = (expr, name, dtype, double) => {
    const p = Dice.parse(expr);
    if (!p) return null;
    p.terms.forEach((tm) => {
      const n = tm.n * (double ? 2 : 1);
      const rolls = Array.from({ length: n }, () => Dice.die(tm.sides));
      parts.push({ name, sides: tm.sides, rolls, sign: tm.sign, type: dtype });
    });
    flat += p.flat;
    return p;
  };
  const main = dice ? add(dice, '', type, crit) : null;
  (extra || []).forEach((x) => add(x.dice, x.name || '', x.type || '', crit));
  if (crit && attack && attack.weapon && attack.melee && r.extra_crit_dice && main && main.terms.length) {
    add(`${r.extra_crit_dice}d${main.terms[0].sides}`, 'Brutal critical', type, false);
  }
  if (!heal && attack) {
    (r.riders || []).forEach((rd) => {
      if (!t.riders[rd.id] || !riderApplies(rd, attack)) return;
      if (rd.dice) add(rd.dice, rd.name.replace(/\s*\(.*\)$/, ''), rd.type, crit);
      if (rd.flat) { flat += rd.flat; parts.push({ name: rd.name.replace(/\s*\(.*\)$/, ''), flatOnly: rd.flat }); }
      if (rd.once) { t.riders[rd.id] = false; flags.push([`${rd.name.replace(/\s*\(.*\)$/, '')} used`, 'info']); }
    });
    const cm = (t.custom || '').trim().match(/^\+?\s*(\d*d\d+(?:\s*[+-]\s*\d+)?)\s*(.*)$/i);
    if (cm) add(cm[1], cm[2] || 'extra', cm[2] || '', crit);
  }
  const diceTotal = parts.reduce((s, p) => s + (p.rolls ? p.sign * p.rolls.reduce((a, b) => a + b, 0) : 0), 0);
  const total = Math.max(0, diceTotal + flat);
  const bits = parts.filter((p) => p.rolls).map((p) => `${p.name ? p.name + ' ' : ''}${p.rolls.length}d${p.sides} (${p.rolls.join(', ')})`);
  const flatShown = flat - parts.reduce((s, p) => s + (p.flatOnly || 0), 0);
  let detail = bits.join(' + ');
  if (flatShown) detail += ` ${signed(flatShown)}`;
  parts.filter((p) => p.flatOnly).forEach((p) => { detail += `, ${p.name} ${signed(p.flatOnly)}`; });
  const types = [...new Set(parts.map((p) => p.type).filter(Boolean))];
  if (crit) flags.unshift(['Critical: dice doubled', 'good']);
  return pushResult({ label, total, detail, flags, unit: heal ? 'hit points' : (types.join(' + ') || 'damage') });
}

/* ---------------------------------------------------------------- what the sheet buttons do */
function doRoll(ds) {
  const sh = S.sheet;
  if (!sh) return;
  const r = rollInfo();
  const AB = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
  switch (ds.roll) {
    case 'check': return rollD20({ label: `${AB[ds.ab]} check`, mod: sh.mods[ds.ab] + (r.jack ? Math.floor(sh.prof / 2) : 0), kind: 'check', ab: ds.ab, dis: armorDis(ds.ab) });
    case 'save': return rollD20({ label: `${AB[ds.ab]} save`, mod: sh.saves[ds.ab].bonus, kind: 'save', ab: ds.ab, dis: armorDis(ds.ab) });
    case 'skill': {
      const s = sh.skills.find((x) => x.name === ds.skillRoll);
      return rollD20({ label: `${s.name} check`, mod: s.bonus, kind: 'skill', ab: s.ability, proficient: s.prof === 'proficient' || s.prof === 'expertise',
        dis: s.name === 'Stealth' && r.stealth_dis ? 'your armor (it’s noisy)' : armorDis(s.ability) });
    }
    case 'init': return rollD20({ label: 'Initiative', mod: sh.initiative, kind: 'init', ab: 'dex' });
    case 'death': {
      const res = rollD20({ label: 'Death saving throw', kind: 'death' });
      if (typeof applyDeathSave === 'function') applyDeathSave(res);
      return res;
    }
    case 'attack': return rollWeaponAttack(+ds.i);
    case 'damage': return rollWeaponDamage(+ds.i, { twoHanded: ds.two === '1' });
    case 'spell-attack': {
      const c = sh.spellcasting.find((x) => x.slug === ds.slug) || sh.spellcasting[0];
      return rollD20({ label: `${c.class} spell attack`, mod: c.attack, kind: 'attack' });
    }
    case 'hitdie': return rollDamage({ label: `Hit die (d${ds.sides})`, dice: `1d${ds.sides}`, mod: sh.mods.con, heal: true });
    case 'spell': return openSpellRoll(ds.id, ds.slug, +ds.level || 0, ds.name || 'Spell');
    default: return null;
  }
}

// Armor you aren't proficient with: disadvantage on Strength and Dexterity checks, saves and attacks.
function armorDis(ab) {
  return rollInfo().armor_dis && (ab === 'str' || ab === 'dex') ? 'armor you aren’t proficient with' : '';
}

function rollWeaponAttack(i) {
  const a = S.sheet.attacks[i];
  return rollD20({
    label: `${a.name} attack`, mod: a.bonus, kind: 'attack', ab: a.ability, dis: armorDis(a.ability),
    follow: (crit) => {
      const f = [{ label: crit ? 'Roll critical damage' : 'Roll damage', fn: () => rollWeaponDamage(i, { crit }) }];
      if (a.versatile) f.push({ label: `Two-handed${crit ? ' critical' : ''} (${a.versatile})`, fn: () => rollWeaponDamage(i, { crit, twoHanded: true }) });
      if (!crit) f.push({ label: 'Critical damage', fn: () => rollWeaponDamage(i, { crit: true }) });
      return f;
    },
  });
}
function rollWeaponDamage(i, { crit = false, twoHanded = false } = {}) {
  const a = S.sheet.attacks[i];
  const dice = twoHanded && a.versatile ? a.versatile : a.dice;
  return rollDamage({ label: `${a.name}${twoHanded ? ' (two-handed)' : ''} damage`, dice, mod: a.mod, type: a.type, crit, attack: a, extra: a.extra || [] });
}

/* ---------------------------------------------------------------- spells */
function spellDice(effect, slot) {
  const base = effect.damage ? effect.damage.dice : effect.heal ? effect.heal.dice : '';
  if (!base || !effect.per_slot || !slot || slot <= effect.base_level) return base;
  const [bn, bs] = base.split('d').map(Number);
  const [pn, ps] = effect.per_slot.split('d').map(Number);
  const extra = pn * (slot - effect.base_level);
  return bs === ps ? `${bn + extra}d${bs}` : `${base}+${extra}d${ps}`;
}

async function openSpellRoll(id, slug, knownLevel = 0, knownName = 'Spell') {
  const sh = S.sheet;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="btn quiet close" data-act="close-modal" aria-label="Close">Close</button><p class="loading">Reading the spell…</p></div>`;
  document.body.append(back);
  back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
  try {
    let effect, entry, problem = '';
    const blank = { level: knownLevel, attack: null, save: null, damage: null, heal: null, per_slot: null, base_level: knownLevel, note: '' };
    if (id) {
      try {
        effect = (await api(`/api/spell-effect/${id}?level=${sh.total_level}`)).effect;
        delete S.details[id];
        entry = await detail(id);
      } catch (e) { problem = e.message; }
    }
    effect = effect || blank;
    if (effect.level == null) { effect.level = knownLevel; effect.base_level = effect.base_level ?? knownLevel; }
    entry = entry || { name: knownName, kind: 'spell', source: 'custom', path: '', tags: [], data: {} };
    const caster = sh.spellcasting.find((x) => x.slug === slug) || sh.spellcasting[0] || null;
    const concentration = /concentration/i.test(((entry.data || {}).duration) || '')
      || Object.values(sh.spells || {}).flat().some((r) => r.name === entry.name && r.concentration);
    S.spellCtx = { id, name: entry.name, effect, caster, concentration };
    const slots = [];
    if (effect.level > 0) {
      for (let L = effect.level; L <= 9; L++) {
        if (L === effect.level || (sh.slots[L - 1] || 0) > 0 || (sh.pact && sh.pact.level === L)) slots.push(L);
      }
    }
    const mod = caster ? sh.mods[caster.ability] : 0;
    const AB = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
    let html = '';
    if (effect.attack && caster) html += `<button class="roll-btn" data-act="spell-roll" data-what="attack">Spell attack ${signed(caster.attack)}</button> `;
    if (effect.save) html += `<p style="margin:8px 0">Targets make a ${AB[effect.save]} saving throw${caster ? ` against DC <b>${caster.dc}</b>` : ''}${effect.half ? ', taking half damage on a success' : ''}.</p>`;
    const playing = S.tab === 'play' && typeof slotsLeft === 'function';
    if (slots.length) {
      html += `<div class="row" style="align-items:flex-end;margin-bottom:8px">
        <label class="field" style="margin:0"><span>Spell slot</span><select id="spell-slot">${slots.map((L) =>
          `<option value="${L}">${ord(L)} level${playing ? ` (${slotsLeft(L)} left)` : ''}</option>`).join('')}</select></label>
        ${playing ? '<button class="btn primary" data-act="cast-spell">Cast (use the slot)</button>' : ''}</div>`;
      if (playing && concentration) html += '<p class="small muted" style="margin:0 0 8px">Concentration: casting it starts concentration (and ends any other).</p>';
    } else if (effect.level === 0) {
      html += '<p class="small muted" style="margin:0 0 8px">Cantrip: no spell slot needed.</p>';
    }
    if (playing && concentration) html += '<button class="btn small" data-act="conc-start" style="margin-bottom:8px">Concentrate on it without using a slot</button> ';
    if (effect.damage) {
      const extra = (effect.damage.flat ? ` + ${effect.damage.flat}` : '') + (effect.damage.add_mod ? ` + ${mod}` : '');
      html += `<button class="roll-btn" data-act="spell-roll" data-what="damage">Roll damage: <span id="spell-dice">${spellDice(effect, effect.level)}</span>${extra} ${esc(effect.damage.type)}</button> `;
    }
    if (effect.heal) html += `<button class="roll-btn" data-act="spell-roll" data-what="heal">Roll healing: <span id="spell-dice">${spellDice(effect, effect.level)}</span>${effect.heal.add_mod ? ` + ${mod}` : ''}</button>`;
    if (effect.note) html += `<p class="hint" style="margin:8px 0 0">${esc(effect.note)}</p>`;
    if (problem) html += `<p class="hint" style="margin:8px 0 0">Couldn’t read this spell’s details (${esc(problem)}), so there’s nothing to roll automatically.</p>`;
    else if (!effect.attack && !effect.save && !effect.damage && !effect.heal) html += `<p class="hint" style="margin:8px 0 0">${id ? 'No dice found in this spell’s text.' : 'This spell isn’t from your library, so there’s nothing to read.'} Use “Roll any dice” in the dice panel if it needs a roll.</p>`;
    back.querySelector('.modal').innerHTML = `<button class="btn quiet close" data-act="close-modal" aria-label="Close">Close</button>
      <h2>${esc(entry.name)}</h2><div class="spell-roll">${html}<div class="roll-out"></div></div>${id && !problem ? renderEntry(entry).replace(/^<h2>.*?<\/h2>/, '') : ''}`;
    const sel = back.querySelector('#spell-slot');
    if (sel) sel.addEventListener('change', () => { back.querySelectorAll('#spell-dice').forEach((el) => { el.textContent = spellDice(effect, +sel.value); }); });
  } catch (e) {
    back.querySelector('.modal').innerHTML = `<button class="btn quiet close" data-act="close-modal">Close</button><div class="note warn">${esc(e.message)}</div>`;
  }
}

function rollSpell(what, { crit = false } = {}) {
  const ctx = S.spellCtx;
  if (!ctx) return null;
  const { effect, caster } = ctx;
  const sel = document.getElementById('spell-slot');
  const slot = sel ? +sel.value : effect.level;
  const mod = caster ? S.sheet.mods[caster.ability] : 0;
  const atk = { spell: true, weapon: false };
  if (what === 'attack') {
    return rollD20({ label: `${ctx.name}: spell attack`, mod: caster.attack, kind: 'attack',
      follow: (c) => (effect.damage ? [{ label: c ? 'Roll critical damage' : 'Roll damage', fn: () => rollSpell('damage', { crit: c }) }] : []) });
  }
  if (what === 'heal') {
    return rollDamage({ label: `${ctx.name}: healing`, dice: spellDice(effect, slot), mod: effect.heal.add_mod ? mod : 0, heal: true });
  }
  const d = effect.damage;
  const extra = ((S.sheet.roll || {}).spell_bonus || {})[String(ctx.name || '').toLowerCase()] || 0;   // Agonizing Blast
  return rollDamage({ label: `${ctx.name}${slot > effect.level ? ` (${ord(slot)} level)` : ''}: damage`, dice: spellDice(effect, slot),
    mod: (d.flat || 0) + (d.add_mod ? mod : 0) + extra, type: d.type, crit, attack: effect.attack ? atk : null });
}

function rollExpression(expr) {
  const p = Dice.parse(expr);
  if (!p || (!p.terms.length && !p.flat)) { toast('Write dice like 2d6+3 or 1d20.', 'error'); return null; }
  const parts = [];
  let total = p.flat;
  p.terms.forEach((tm) => {
    const rolls = Array.from({ length: tm.n }, () => Dice.die(tm.sides));
    total += tm.sign * rolls.reduce((a, b) => a + b, 0);
    parts.push(`${tm.n}d${tm.sides} (${rolls.join(', ')})`);
  });
  const flags = [];
  if (p.terms.length === 1 && p.terms[0].n === 1 && p.terms[0].sides === 20) {
    const v = total - p.flat;
    if (v === 20) flags.push(['Natural 20', 'good']);
    if (v === 1) flags.push(['Natural 1', 'bad']);
  }
  return pushResult({ label: expr.replace(/\s+/g, ''), total, detail: parts.join(' + ') + (p.flat ? ` ${signed(p.flat)}` : ''), flags });
}

/* ---------------------------------------------------------------- results & the tray */
function pushResult(res) {
  const t = trayState();
  res.id = t.nextId++;
  res.time = new Date();
  (res.follow || []).forEach((f, i) => FOLLOW.set(`${res.id}:${i}`, f.fn));
  t.history.unshift(res);
  t.history.length = Math.min(t.history.length, 40);
  document.querySelectorAll('.roll-out').forEach((el) => { el.innerHTML = resultHtml(res, true); });
  const hist = document.getElementById('roll-history');
  if (hist) hist.innerHTML = historyHtml();
  const last = document.querySelector('.tray-last');
  if (last) last.innerHTML = lastHtml();
  syncTrayInputs();
  showRollPeek(res);
  return res;
}

/* On a phone the dice panel is usually folded into a bar at the bottom; a roll then pops up just above it
   for a few seconds, with its details and the follow-up buttons (like Roll damage). */
let peekTimer;
function showRollPeek(res) {
  const live = document.getElementById('live');
  let peek = document.getElementById('roll-peek');
  if (!live || !live.classList.contains('tray-mode') || !live.classList.contains('collapsed') || getComputedStyle(live).position !== 'fixed') {
    if (peek) peek.hidden = true;
    return;
  }
  if (!peek) {
    peek = document.createElement('div');
    peek.id = 'roll-peek';
    peek.className = 'roll-peek';
    document.body.append(peek);
  }
  peek.innerHTML = `${resultHtml(res, true)}<button class="btn quiet small peek-close" data-act="peek-close">Hide</button>`;
  peek.style.bottom = `${live.offsetHeight + 8}px`;
  peek.hidden = false;
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => { peek.hidden = true; }, (res.follow || []).length ? 20000 : 8000);
}

function resultHtml(res, fresh) {
  if (!res) return '<p class="hint" style="margin:0">Tap any number on the sheet to roll it.</p>';
  return `<div class="roll-result${fresh ? ' fresh' : ''}" role="status" aria-live="polite">
    <div class="rr-label">${esc(res.label)}</div>
    <div class="rr-total">${res.total}${res.unit ? ` <span class="small muted" style="font:14px var(--sans)">${esc(res.unit)}</span>` : ''}</div>
    <div class="rr-detail">${esc(res.detail)}</div>
    ${(res.flags || []).map(([txt, k]) => `<span class="rr-flag ${k}">${esc(txt)}</span>`).join('')}
    ${(res.follow || []).length ? `<div class="row" style="margin-top:8px">${res.follow.map((f, i) =>
      `<button class="roll-btn" data-act="roll-follow" data-key="${res.id}:${i}">${esc(f.label)}</button>`).join('')}</div>` : ''}
  </div>`;
}
const lastHtml = () => { const l = trayState().history[0]; return l ? `${esc(l.label)}: <b>${l.total}</b>` : ''; };
function historyHtml() {
  const h = trayState().history;
  return h.length ? h.map((r) => `<li><span>${esc(r.label)}</span><b>${r.total}</b></li>`).join('') : '<li class="muted">No rolls yet.</li>';
}

function syncTrayInputs() {
  const t = trayState();
  document.querySelectorAll('[data-tray]').forEach((el) => {
    const k = el.dataset.tray;
    if (el.type === 'radio') el.checked = t[k] === el.value;
    else if (el.type === 'checkbox') el.checked = !!t[k];
  });
  document.querySelectorAll('[data-tray-rider]').forEach((el) => { el.checked = !!t.riders[el.dataset.trayRider]; });
}

function renderTray() {
  const t = trayState();
  const riders = rollInfo().riders || [];
  const d20Icon = '<svg class="die-ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1 14.5 4.8v6.4L8 15 1.5 11.2V4.8z" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.5 11.2 10H4.8z" fill="none" stroke="currentColor" stroke-width="1.1"/></svg>';
  return `<div class="tray">
    <div class="tray-head"><h2>${d20Icon}Dice</h2><span class="tray-last small">${lastHtml()}</span>
      <button class="btn quiet tray-collapse" data-act="tray-collapse" aria-expanded="${!t.collapsed}">${t.collapsed ? 'Show' : 'Hide'}</button></div>
    <div class="tray-body">
      <div class="roll-out">${resultHtml(t.history[0], false)}</div>
      <fieldset><legend>d20 rolls</legend>
        <div class="seg" role="radiogroup" aria-label="Advantage">
          ${[['normal', 'Normal'], ['adv', 'Advantage'], ['dis', 'Disadvantage']].map(([v, l]) =>
            `<label><input type="radio" name="tray-adv" value="${v}" data-tray="adv" ${t.adv === v ? 'checked' : ''}>${l}</label>`).join('')}
        </div>
        <label class="check small" style="margin-top:6px"><input type="checkbox" data-tray="keepAdv" ${t.keepAdv ? 'checked' : ''}>Keep it for every roll</label>
      </fieldset>
      <fieldset><legend>Bonuses on d20 rolls</legend>
        <div class="toggles">
          <label class="chip"><input type="checkbox" data-tray="bless" ${t.bless ? 'checked' : ''}>Bless: +1d4 attacks and saves</label>
          <label class="chip"><input type="checkbox" data-tray="guidance" ${t.guidance ? 'checked' : ''}>Guidance: +1d4 next check</label>
        </div>
        <input type="text" data-tray="bonus" value="${esc(t.bonus)}" placeholder="Anything else, like +1 or 1d4" style="width:100%;margin-top:6px" aria-label="Extra bonus on d20 rolls">
      </fieldset>
      <fieldset><legend>Extra damage when you hit</legend>
        <div class="toggles">${riders.map((rd) => `<label class="chip"><input type="checkbox" data-tray-rider="${esc(rd.id)}" ${t.riders[rd.id] ? 'checked' : ''}>${esc(rd.name)}</label>`).join('')}</div>
        <input type="text" data-tray="custom" value="${esc(t.custom)}" placeholder="Other, like 1d6 fire" style="width:100%;margin-top:6px" aria-label="Other extra damage">
        ${riders.some((rd) => rd.once) ? '<p class="hint small" style="margin:4px 0 0">Once-a-turn extras switch off after a damage roll.</p>' : ''}
      </fieldset>
      <fieldset><legend>Roll any dice</legend>
        <div class="quick-dice">${[4, 6, 8, 10, 12, 20, 100].map((n) => `<button class="roll-btn" data-act="quick-die" data-sides="${n}">d${n}</button>`).join('')}</div>
        <div class="row"><input type="text" data-tray="expr" value="${esc(t.expr)}" placeholder="2d6+3" class="grow" aria-label="Dice to roll" id="tray-expr">
          <button class="btn" data-act="roll-expr">Roll</button></div>
      </fieldset>
      <div class="row" style="justify-content:space-between"><h3 class="small" style="margin:0;font-family:var(--sans)">Recent rolls</h3>
        <button class="btn quiet small" data-act="clear-rolls">Clear</button></div>
      <ol class="history" id="roll-history">${historyHtml()}</ol>
    </div></div>`;
}
