'use strict';
/* Play tab extras: class resources tracked for you, conditions and exhaustion that change your rolls,
   and concentration (who you're concentrating on, and the save when you take damage). */

/* ================================================================ class resources */
function resUsed(id) { return (playState().res_used || {})[id] || 0; }
function setResUsed(id, n) {
  const p = playState();
  p.res_used = p.res_used || {};
  p.res_used[id] = Math.max(0, n);
}
function resourceList() { return (S.sheet && S.sheet.resources) || []; }
const RESET_LABEL = { short: 'short or long rest', long: 'long rest', '': 'doesn’t come back on its own' };

function resourceRowHtml(r) {
  const used = r.max == null ? 0 : Math.min(resUsed(r.id), r.max);
  const left = r.max == null ? null : r.max - used;
  let track;
  if (r.max == null) track = '<span class="muted small">Unlimited</span>';
  else if (r.max <= 12) track = `<span class="pips">${pips(r.max, used, 'res-pip', `data-id="${esc(r.id)}"`)}</span>`;
  else {
    track = `<span class="row res-pool" style="gap:6px">
      <button class="roll-btn small" data-act="res-step" data-id="${esc(r.id)}" data-d="1" aria-label="Use one">−</button>
      <b>${left}</b><span class="muted small">/ ${r.max}</span>
      <button class="roll-btn small" data-act="res-step" data-id="${esc(r.id)}" data-d="-1" aria-label="Get one back">+</button>
      <input type="number" min="1" max="${r.max}" class="res-amt" data-res-amt="${esc(r.id)}" placeholder="Amount" aria-label="Amount of ${esc(r.name)} to spend">
      <button class="btn small" data-act="res-spend" data-id="${esc(r.id)}">Spend</button></span>`;
  }
  const useBtn = r.die || r.id === 'rage' || r.heal
    ? `<button class="roll-btn small" data-act="res-use" data-id="${esc(r.id)}" ${left === 0 ? 'disabled' : ''}>${r.id === 'rage' ? (rageOn() ? 'Raging' : 'Rage!') : r.heal ? `Use: heal 1${r.die}+${r.heal}` : `Use: roll 1${r.die}`}</button>`
    : '';
  return `<div class="res-row res-auto"><span title="${esc(r.source)}">${esc(r.name)}${r.die && !r.heal ? ` <span class="muted small">(${r.die})</span>` : ''}</span>
      ${track}
      <span class="muted small">${esc(RESET_LABEL[r.reset] || '')}</span>
      ${useBtn || '<span></span>'}
      ${r.note ? `<p class="res-note small muted">${esc(r.note)}</p>` : ''}</div>`;
}

function resourcesHtml() {
  const list = resourceList();
  if (!list.length) return '';
  return `<h3>Class features</h3>${list.map(resourceRowHtml).join('')}
    <p class="hint small">Worked out from your classes, species and feats. Rests bring them back on their own.</p>`;
}

function restoreResources(rest) {
  const p = playState();
  const back = [];
  resourceList().forEach((r) => {
    if (!r.reset || (rest === 'short' && r.reset !== 'short')) return;
    if (resUsed(r.id)) { back.push(r.name); setResUsed(r.id, 0); }
  });
  if (rest === 'long') p.raging = false;
  return back;
}

const rageOn = () => !!(S.tray && S.tray.riders && S.tray.riders.rage);

Object.assign(ACTIONS, {
  'res-pip': (t) => { setResUsed(t.dataset.id, pipToggle(resUsed(t.dataset.id), +t.dataset.n)); savePlay(); },
  'res-step': (t) => {
    const r = resourceList().find((x) => x.id === t.dataset.id);
    if (!r) return;
    setResUsed(r.id, Math.min(r.max, resUsed(r.id) + +t.dataset.d));
    savePlay();
  },
  'res-spend': (t) => {
    const r = resourceList().find((x) => x.id === t.dataset.id);
    const box = $(`[data-res-amt="${CSS.escape(t.dataset.id)}"]`);
    const n = Math.floor(+(box && box.value) || 0);
    if (!r || n < 1) { toast('Type how many to spend.', 'error'); return; }
    const left = r.max - resUsed(r.id);
    if (n > left) { toast(`Only ${left} left.`, 'error'); return; }
    setResUsed(r.id, resUsed(r.id) + n);
    toast(`${r.name}: spent ${n}, ${left - n} left.`);
    savePlay();
  },
  'res-use': (t) => {
    const r = resourceList().find((x) => x.id === t.dataset.id);
    if (!r) return;
    if (r.max != null && resUsed(r.id) >= r.max) { toast(`No ${r.name} left. Take a rest.`, 'error'); return; }
    if (r.id === 'rage' && rageOn()) {
      trayState().riders.rage = false;
      toast('Rage ended.');
      syncTrayInputs();
      savePlay();
      return;
    }
    if (r.max != null) setResUsed(r.id, resUsed(r.id) + 1);
    if (r.id === 'rage') {
      trayState().riders.rage = true;
      syncTrayInputs();
      toast('Raging: the extra damage is on in the dice panel, with advantage on Strength checks and saves. Click Raging to end it.');
    } else if (r.heal) {
      const res = rollDamage({ label: r.name, dice: `1${r.die}`, mod: r.heal, heal: true });
      const p = playState();
      if (curHp() === 0 && res.total > 0) p.death = { s: 0, f: 0 };
      p.hp = Math.min(maxHp(), curHp() + res.total);
    } else if (r.die) {
      rollDamage({ label: r.name, dice: `1${r.die}`, heal: false });
      trayState().history[0].unit = '';
    }
    savePlay();
  },
});

/* ================================================================ conditions */
const CONDITION_TEXT = {
  Blinded: 'Your attacks have disadvantage; attacks against you have advantage. You fail checks that need sight.',
  Charmed: 'You can’t attack the charmer, and it has advantage on social checks against you.',
  Deafened: 'You fail checks that need hearing.',
  Frightened: 'Disadvantage on checks and attacks while you can see the source; you can’t move closer to it.',
  Grappled: 'Your speed is 0.',
  Incapacitated: 'No actions or reactions.',
  Invisible: 'Your attacks have advantage; attacks against you have disadvantage.',
  Paralyzed: 'Incapacitated, can’t move or speak. You fail Strength and Dexterity saves; hits from within 5 feet are critical.',
  Petrified: 'Incapacitated; you fail Strength and Dexterity saves and resist all damage.',
  Poisoned: 'Disadvantage on attacks and ability checks.',
  Prone: 'Your attacks have disadvantage. Melee attacks against you have advantage, ranged ones disadvantage.',
  Restrained: 'Speed 0. Disadvantage on your attacks and Dexterity saves; attacks against you have advantage.',
  Stunned: 'Incapacitated; you fail Strength and Dexterity saves; attacks against you have advantage.',
  Unconscious: 'Incapacitated and prone; you fail Strength and Dexterity saves; hits from within 5 feet are critical.',
};
const EXHAUSTION_TEXT = ['', 'Disadvantage on ability checks', 'Speed halved', 'Disadvantage on attacks and saving throws',
  'Hit point maximum halved', 'Speed reduced to 0', 'Death'];
const INCAPACITATING = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'];

function exhaustionLevel() { return (S.char && S.char.play && S.char.play.exhaustion) || 0; }

/* What conditions do to one d20 roll: reasons for advantage, disadvantage, or an automatic failure. */
function rollSituation(kind, ab) {
  const p = (S.char && S.char.play) || {};
  const cond = new Set(p.conditions || []);
  const ex = p.exhaustion || 0;
  const group = ROLL_KINDS[kind] || 'check';
  const adv = [], dis = [], bonus = [];
  let fail = '';
  const has = (list, out) => list.forEach((c) => { if (cond.has(c)) out.push(c.toLowerCase()); });
  if (group === 'attack') {
    has(['Blinded', 'Frightened', 'Poisoned', 'Prone', 'Restrained'], dis);
    has(['Invisible'], adv);
    if (ex >= 3) dis.push(`exhaustion level ${ex}`);
  } else if (group === 'check') {
    has(['Frightened', 'Poisoned'], dis);
    if (ex >= 1) dis.push(`exhaustion level ${ex}`);
    if (ab === 'str' && rageOn()) adv.push('Rage');
  } else {
    if (ex >= 3) dis.push(`exhaustion level ${ex}`);
    if (ab === 'dex' && cond.has('Restrained')) dis.push('restrained');
    if (ab === 'dex' && coverBonus()) bonus.push({ name: coverName().replace(/^./, (x) => x.toUpperCase()), v: coverBonus() });
    if (ab === 'str' || ab === 'dex') fail = ['Paralyzed', 'Stunned', 'Unconscious', 'Petrified'].find((c) => cond.has(c)) || '';
    if (ab === 'str' && rageOn()) adv.push('Rage');
  }
  return { adv, dis, fail, bonus };
}

function conditionEffectsHtml(sh) {
  const p = playState();
  const lines = [];
  const ex = p.exhaustion || 0;
  let speed = sh.speed;
  const zero = p.conditions.find((c) => ['Grappled', 'Restrained', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'].includes(c));
  if (ex >= 5 || zero) speed = 0;
  else if (ex >= 2) speed = Math.floor(sh.speed / 2);
  if (speed !== sh.speed) lines.push(`Speed <b>${speed} ft</b> <span class="muted">(normally ${sh.speed}; ${zero ? esc(zero.toLowerCase()) : `exhaustion ${ex}`})</span>`);
  if (ex >= 4) lines.push(`Hit point maximum <b>${maxHp()}</b> <span class="muted">(halved by exhaustion)</span>`);
  if (coverBonus()) lines.push(`<b>${esc(coverName().replace(/^./, (x) => x.toUpperCase()))}.</b> Armor class <b>${sh.ac + coverBonus()}</b> <span class="muted">(normally ${sh.ac})</span>, +${coverBonus()} on Dexterity saving throws.`);
  else if (p.cover === 'full') lines.push('<b>Full cover.</b> You can’t be targeted directly by attacks or spells, though area effects can still reach you.');
  if (ex >= 6) lines.push('<span class="warn-text">Exhaustion level 6: your character dies.</span>');
  if (p.conditions.some((c) => INCAPACITATING.includes(c))) lines.push('Incapacitated: no actions or reactions.');
  p.conditions.forEach((c) => lines.push(`<b>${esc(c)}.</b> ${esc(CONDITION_TEXT[c] || '')}`));
  if (ex) lines.push(`<b>Exhaustion ${ex}.</b> ${EXHAUSTION_TEXT.slice(1, ex + 1).join('; ')}.`);
  return lines.length
    ? `<ul class="effects small">${lines.map((l) => `<li>${l}</li>`).join('')}</ul><p class="hint small">The dice panel applies advantage, disadvantage and automatic failures from these for you.</p>`
    : '';
}

/* ================================================================ concentration */
function concentrationHtml() {
  const p = playState();
  const c = p.concentration;
  if (!c && !p.conc_check) return '';
  const sh = S.sheet;
  const warCaster = !!((sh.roll || {}).war_caster);
  return `<div class="conc ${p.conc_check ? 'pending' : ''}">
    ${c ? `<div class="row" style="justify-content:space-between"><span>Concentrating on <b>${esc(c.name)}</b></span>
      <button class="btn quiet small" data-act="conc-end">End it</button></div>` : ''}
    ${p.conc_check && c ? `<div class="row" style="margin-top:6px"><span class="small">You took damage: make a Constitution save, DC <b>${p.conc_check.dc}</b>${warCaster ? ' (advantage from War Caster)' : ''}.</span>
      <button class="btn primary small" data-act="conc-save">Roll it</button>
      <button class="btn quiet small" data-act="conc-skip">Skip</button></div>` : ''}
  </div>`;
}

function startConcentration(name) {
  const p = playState();
  const old = p.concentration;
  p.concentration = { name };
  p.conc_check = null;
  if (old && old.name !== name) toast(`Stopped concentrating on ${old.name} to concentrate on ${name}.`);
}
function endConcentration(why) {
  const p = playState();
  if (!p.concentration) return;
  const name = p.concentration.name;
  p.concentration = null;
  p.conc_check = null;
  if (why) toast(`Concentration on ${name} ends: ${why}.`);
}
/* Call after hit points drop. */
function concentrationAfterDamage(amount) {
  const p = playState();
  if (!p.concentration || !amount) return;
  if (curHp() === 0) { endConcentration('you dropped to 0 hit points'); return; }
  const dc = Math.max(10, Math.floor(amount / 2));
  p.conc_check = { dc: p.conc_check ? Math.max(p.conc_check.dc, dc) : dc };
}

Object.assign(ACTIONS, {
  'conc-start': () => {
    const ctx = S.spellCtx;
    if (!ctx) return;
    startConcentration(ctx.name);
    toast(`Concentrating on ${ctx.name}.`);
    savePlay();
  },
  'conc-end': () => { endConcentration(); savePlay(); },
  'conc-skip': () => { playState().conc_check = null; savePlay(); },
  'conc-save': () => {
    const p = playState(), sh = S.sheet;
    if (!p.conc_check) return;
    const dc = p.conc_check.dc;
    const res = rollD20({ label: `Concentration (DC ${dc})`, mod: sh.saves.con.bonus, kind: 'save', ab: 'con',
      adv: (sh.roll || {}).war_caster ? ['War Caster'] : [] });
    p.conc_check = null;
    if (res.total >= dc && !res.failed) res.flags.unshift(['Concentration holds', 'good']);
    else { res.flags.unshift(['Concentration lost', 'bad']); endConcentration(); }
    $$('.roll-out').forEach((el) => { el.innerHTML = resultHtml(res, true); });
    savePlay();
  },
});

/* ================================================================ cover */
const COVER = [['', 'None'], ['half', 'Half cover: +2 AC and Dexterity saves'], ['three', 'Three-quarters cover: +5 AC and Dexterity saves'],
  ['full', 'Full cover: can’t be targeted directly']];
function coverBonus() { const c = (S.char && S.char.play && S.char.play.cover) || ''; return c === 'half' ? 2 : c === 'three' ? 5 : 0; }
function coverName() { const c = (S.char && S.char.play && S.char.play.cover) || ''; return { half: 'half cover', three: 'three-quarters cover', full: 'full cover' }[c] || ''; }
function coverHtml() {
  const cur = playState().cover || '';
  return `<label class="field" style="margin-top:8px;max-width:340px"><span>Cover</span><select data-act-change="cover">${COVER.map(([v, l]) =>
    `<option value="${v}" ${cur === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
}
document.addEventListener('change', (e) => {
  if (e.target.dataset.actChange !== 'cover') return;
  playState().cover = e.target.value;
  savePlay();
  if (coverBonus()) toast(`${coverName().replace(/^./, (x) => x.toUpperCase())}: AC ${S.sheet.ac + coverBonus()}, and +${coverBonus()} on Dexterity saves.`);
});

/* ================================================================ rests */
function restModal(html) {
  let back = $('.rest-back');
  if (!back) {
    back = document.createElement('div');
    back.className = 'modal-back rest-back';
    back.innerHTML = '<div class="modal rest-modal" role="dialog" aria-modal="true" aria-labelledby="rest-title"></div>';
    back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
    document.body.append(back);
  }
  $('.rest-modal', back).innerHTML = `<button class="btn quiet close" data-act="rest-close" aria-label="Close">Close</button>${html}`;
}

function restBackList(kind) {
  const p = playState(), sh = S.sheet, out = [];
  const short = kind === 'short';
  if (!short) {
    if (curHp() < maxHp() || p.temp) out.push(`Hit points back to <b>${maxHp()}</b>${p.temp ? ' (temporary hit points end)' : ''}`);
    if (p.slots_used.some((n) => n)) out.push('All spell slots');
    const regain = Math.max(1, Math.floor((sh.total_level || 1) / 2));
    const usedHd = Object.values(p.hd_used).reduce((t, n) => t + (+n || 0), 0);
    if (usedHd) out.push(`Hit dice: you get back ${Math.min(regain, usedHd)} of the ${usedHd} you spent`);
    if (p.exhaustion) out.push(`Exhaustion ${p.exhaustion} → ${p.exhaustion - 1}`);
    if (p.concentration) out.push(`Concentration on ${esc(p.concentration.name)} ends`);
    if (p.form) out.push(`Wild Shape ends (you change back from ${esc(p.form.name)})`);
    if ((S.char.companions || []).some((x) => x.hp != null)) out.push('Companions heal to full');
  }
  if (sh.pact && p.pact_used) out.push(`Pact slots (${p.pact_used} used)`);
  resourceList().filter((r) => r.reset && (!short || r.reset === 'short') && resUsed(r.id)).forEach((r) => out.push(esc(r.name)));
  p.trackers.filter((t) => t.used && (short ? t.reset === 'short' : t.reset)).forEach((t) => out.push(esc(t.name)));
  (S.char.inventory || []).filter((it) => it.charges && +it.charges.used > 0
    && (short ? it.charges.when === 'short' : (it.charges.when || 'dawn') !== 'never')).forEach((it) => out.push(`Charges on ${esc(it.name)}${it.charges.regain && !/^all$/i.test(it.charges.regain) ? ` (${esc(it.charges.regain)})` : ''}`));
  return out;
}

function renderRest() {
  const kind = S.restKind;
  if (!kind || !S.sheet) return;
  const p = playState();
  const back = restBackList(kind);
  let html = `<h2 id="rest-title">${kind === 'short' ? 'Short rest' : 'Long rest'}</h2>
    <p class="hint">${kind === 'short' ? 'At least an hour of downtime. Spend hit dice to heal, then finish the rest.' : 'Eight hours, with no more than two of them on light activity.'}</p>
    <p>Hit points <b>${curHp()} / ${maxHp()}</b>${p.temp ? ` <span class="tag temp">+${p.temp} temporary</span>` : ''}</p>`;
  if (kind === 'short') {
    const hd = hitDiceTotals();
    html += `<h3>Spend hit dice</h3><div class="row" style="gap:6px">${Object.entries(hd).sort((a, b) => b[0] - a[0]).map(([d, n]) => {
      const used = Math.min(p.hd_used[d] || 0, n);
      return `<button class="roll-btn" data-act="rest-hd" data-sides="${d}" ${used >= n || curHp() >= maxHp() ? 'disabled' : ''}>Spend a d${d} <span class="muted">(${n - used} of ${n} left)</span></button>`;
    }).join('') || '<span class="muted">No hit dice set.</span>'}</div>
    <p class="small muted" style="margin:4px 0 0">Each one heals the roll ${signed(S.sheet.mods.con)} (your Constitution modifier).</p>
    <div class="roll-out rest-roll" style="margin-top:8px"></div>`;
    const ar = resourceList().find((r) => r.id === 'arcane-recovery');
    if (ar && (!resUsed(ar.id) || S.arcaneLeft != null)) {
      const left = S.arcaneLeft ?? ar.levels;
      const usable = p.slots_used.map((n, i) => [i + 1, n]).filter(([L, n]) => n > 0 && L <= 5 && L <= left);
      html += `<div class="note small" style="margin-top:10px"><b>Arcane Recovery.</b> ${esc(ar.note)}
        <div class="row" style="gap:6px;margin-top:6px">${usable.length ? usable.map(([L]) => `<button class="btn small" data-act="rest-arcane" data-level="${L}">Get back a ${ord(L)}-level slot</button>`).join('')
          : `<span class="muted">${S.arcaneLeft != null ? (left ? `Slots back. ${left} level${left === 1 ? '' : 's'} left over, but nothing else it can bring back.` : 'Slots back.') : 'No spent slots it can bring back.'}</span>`}</div></div>`;
    }
  }
  html += `<h3>${kind === 'short' ? 'What comes back' : 'What comes back'}</h3>
    ${back.length ? `<ul class="lu-list">${back.map((x) => `<li>${x}</li>`).join('')}</ul>` : `<p class="muted">${kind === 'short' ? 'Nothing you’ve used comes back on a short rest.' : 'Nothing is used up right now.'}</p>`}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-act="rest-close">Cancel</button>
      <button class="btn primary" data-act="rest-finish">Finish the ${kind} rest</button></div>`;
  restModal(html);
}

Object.assign(ACTIONS, {
  'short-rest': () => { S.restKind = 'short'; S.arcaneLeft = null; renderRest(); },
  'long-rest': () => { S.restKind = 'long'; renderRest(); },
  'rest-close': () => { const b = $('.rest-back'); if (b) b.remove(); S.restKind = null; S.arcaneLeft = null; },
  'rest-hd': (t) => {
    const res = ACTIONS['spend-hd'](t);
    renderRest();
    const last = trayState().history[0];
    const box = $('.rest-roll');
    if (box && last) box.innerHTML = resultHtml(last, true);
    return res;
  },
  'rest-arcane': (t) => {
    const ar = resourceList().find((r) => r.id === 'arcane-recovery');
    const L = +t.dataset.level, p = playState();
    if (!ar || !(p.slots_used[L - 1] > 0)) return;
    S.arcaneLeft = (S.arcaneLeft ?? ar.levels) - L;
    p.slots_used[L - 1] -= 1;
    setResUsed(ar.id, 1);
    savePlay();
    renderRest();
  },
  'rest-finish': () => {
    const kind = S.restKind;
    const back = restBackList(kind).filter((x) => !x.startsWith('Charges on'))
      .map((x) => x.replace(/<[^>]+>/g, '').replace(/&#39;/g, '’').replace(/&amp;/g, '&'));
    ACTIONS['rest-close']();
    const done = (kind === 'short' ? ACTIONS['short-rest-now']() : ACTIONS['long-rest-now']()) || {};
    const charges = done.charges || [];
    toast(`${kind === 'short' ? 'Short' : 'Long'} rest done.${back.length ? ` Back: ${back.join('; ')}.` : ''}${charges.length ? ` Charges: ${charges.join(', ')}.` : ''}`);
  },
});

Object.assign(ACTIONS, {
  'peek-close': () => { const p = document.getElementById('roll-peek'); if (p) p.hidden = true; clearTimeout(peekTimer); },
});
