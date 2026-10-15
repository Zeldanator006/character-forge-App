'use strict';
/* Companions and forms: familiars, beast companions, steeds, summons, creatures you make yourself, and Wild Shape.
   Stat blocks come from the SRD 5.1 (bundled with the app); each companion keeps its own copy, so you can edit it. */

const CMP_KINDS = [['familiar', 'Familiar'], ['companion', 'Beast companion'], ['steed', 'Steed'], ['any', 'Summon or other creature'], ['custom', 'Make your own']];
const CMP_KIND_LABEL = { familiar: 'Familiar', companion: 'Beast companion', steed: 'Steed', any: 'Creature', custom: 'Creature', summon: 'Summon' };
const cmpInfo = () => (S.sheet && S.sheet.companions) || {};
const abMod = (v) => Math.floor(((+v || 10) - 10) / 2);
const CREATURES = {};

function cmpUi() {
  if (!S.cmpUi || S.cmpUi.charId !== S.charId) {
    const info = cmpInfo();
    S.cmpUi = { charId: S.charId, mode: info.find_familiar ? 'familiar' : info.beast_master ? 'companion' : info.find_steed ? 'steed' : 'any', q: '', wsq: '', all: null };
  }
  return S.cmpUi;
}
async function creature(name) {
  if (!CREATURES[name]) CREATURES[name] = (await api(`/api/creatures/${encodeURIComponent(name)}`)).creature;
  return CREATURES[name];
}
function cmpSearchInfo() {
  const info = cmpInfo();
  return { chain: !!info.chain, greater_steed: !!info.greater_steed, wild_shape: info.wild_shape || null };
}

function addFlat(dice, n) {
  const m = String(dice || '').replace(/\s+/g, '').match(/^(\d*d\d+)?([+-]\d+)?$/);
  if (!m) return dice;
  const flat = (+(m[2] || 0)) + n;
  if (!m[1]) return String(flat);
  return m[1] + (flat > 0 ? `+${flat}` : flat < 0 ? String(flat) : '');
}
const speedText = (sp) => {
  sp = sp || {};
  const parts = 'walk' in sp || !Object.keys(sp).length ? [`${sp.walk || 0} ft.`] : [];
  ['burrow', 'climb', 'fly', 'swim'].forEach((k) => { if (sp[k]) parts.push(`${k} ${sp[k]} ft.${k === 'fly' && sp.hover ? ' (hover)' : ''}`); });
  return parts.join(', ') || '0 ft.';
};
const crText = (cr) => (cr == null ? '?' : cr === 0.125 ? '1/8' : cr === 0.25 ? '1/4' : cr === 0.5 ? '1/2' : String(cr));

/* A Beast Master's companion (2014) adds your proficiency bonus to AC, attacks, damage, and its proficient saves
   and skills, and has at least 4 hit points per ranger level. */
function effectiveBlock(cmp) {
  const b = JSON.parse(JSON.stringify(cmp.block || {}));
  const info = cmpInfo();
  if (cmp.kind === 'companion' && info.beast_master) {
    const p = info.prof || 2;
    b.ac = (b.ac || 10) + p;
    b.hp = Math.max(b.hp || 0, 4 * (info.ranger_level || 0));
    (b.actions || []).forEach((a) => {
      if (a.attack == null) return;
      a.attack += p;
      if ((a.damage || []).length) a.damage[0].dice = addFlat(a.damage[0].dice, p);
    });
    Object.keys(b.skills || {}).forEach((k) => { b.skills[k] += p; });
    Object.keys(b.saves || {}).forEach((k) => { b.saves[k] += p; });
    b.bonus_note = `Ranger’s Companion: +${p} (your proficiency bonus) to AC, attacks and damage; at least ${4 * (info.ranger_level || 0)} hit points.`;
  }
  return b;
}

/* You in Wild Shape: the beast's body with your mind. Intelligence, Wisdom and Charisma stay yours, and you keep
   your save and skill proficiencies, using whichever bonus is higher. */
function formBlock() {
  const f = playState().form;
  if (!f) return null;
  const sh = S.sheet, b = JSON.parse(JSON.stringify(f.block));
  b.scores = b.scores || {};
  ['int', 'wis', 'cha'].forEach((a) => { b.scores[a] = sh.scores[a]; });
  b.saves = { ...(b.saves || {}) };
  ABILITIES.forEach((a) => {
    if (!(sh.saves[a] || {}).prof) return;
    const v = abMod(b.scores[a]) + sh.prof;
    if (b.saves[a] == null || v > b.saves[a]) b.saves[a] = v;
  });
  b.skills = { ...(b.skills || {}) };
  (sh.skills || []).filter((x) => x.prof === 'proficient' || x.prof === 'expertise').forEach((x) => {
    const v = abMod(b.scores[x.ability]) + (x.prof === 'expertise' ? 2 : 1) * sh.prof;
    if (b.skills[x.name] == null || v > b.skills[x.name]) b.skills[x.name] = v;
  });
  return b;
}

/* ---------------------------------------------------------------- the stat block */
function statBlockHtml(b, { owner, title, hp, play = false, open = false, acBonus = 0, acNote = '' } = {}) {
  const R = (what, extra = '') => `data-act="cmp-roll" data-owner="${esc(owner)}" data-what="${what}" ${extra}`;
  const scores = ABILITIES.map((a) => {
    const v = (b.scores || {})[a] ?? 10;
    return `<button class="sb-score roll-btn" ${R('check', `data-ab="${a}"`)} title="Roll a ${AB_NAME[a]} check"><span>${a.toUpperCase()}</span><b>${v}</b><span>${signed(abMod(v))}</span></button>`;
  }).join('');
  const saves = Object.entries(b.saves || {}).map(([a, v]) => `<button class="roll-btn small" ${R('save', `data-ab="${a}"`)}>${AB_NAME[a] || a} ${signed(v)}</button>`).join(' ');
  const skills = Object.entries(b.skills || {}).map(([k, v]) => `<button class="roll-btn small" ${R('skill', `data-cskill="${esc(k)}"`)}>${esc(k)} ${signed(v)}</button>`).join(' ');
  const line = (label, v) => (v && (!Array.isArray(v) || v.length) ? `<div><b>${label}</b> ${esc(Array.isArray(v) ? v.join('; ') : v)}</div>` : '');
  const rollBtns = (a, i) => (a.attack != null ? `<button class="roll-btn small" ${R('attack', `data-n="${i}"`)}>${signed(a.attack)} to hit</button> ` : '')
    + (a.damage || []).map((d, k) => `<button class="roll-btn small" ${R('damage', `data-n="${i}" data-k="${k}"`)}>${k ? '+ ' : ''}${esc(`${d.dice} ${d.type || ''}`.trim())}</button>`).join(' ');
  const quick = (b.actions || []).map((a, i) => ((a.damage || []).length || a.attack != null || a.save
    ? `<div class="sb-attack"><b>${esc(a.name)}</b> ${rollBtns(a, i)}${a.save ? ` <span class="small muted">DC ${a.save.dc} ${esc(AB_NAME[a.save.ability] || a.save.ability || '')} save</span>` : ''}</div>` : '')).join('');
  const actions = (b.actions || []).map((a) => `<div class="sb-action"><b>${esc(a.name)}.</b>${a.usage ? ` <span class="muted small">(${esc(a.usage)})</span>` : ''}
      ${a.text ? `<span class="small">${esc(a.text)}</span>` : ''}</div>`).join('');
  const maxHp = b.hp || 0;
  const hpNow = hp == null ? maxHp : hp;
  return `<div class="statblock">
    <div class="sb-head"><b>${esc(title || b.name)}</b> <span class="muted small">${title && title !== b.name ? `${esc(b.name)}, ` : ''}${esc(b.size || '')} ${esc(b.type || '')}${b.cr != null ? `, CR ${crText(b.cr)}` : ''}</span></div>
    <div class="sb-line"><span>AC <b>${b.ac + acBonus}</b>${b.ac_note ? ` <span class="muted small">(${esc(b.ac_note)})</span>` : ''}${acBonus ? ` <span class="small">(+${acBonus} ${esc(acNote)})</span>` : ''}</span>
      <span>HP <b>${play ? `${hpNow} / ${maxHp}` : maxHp}</b>${b.hit_dice ? ` <span class="muted small">(${esc(b.hit_dice)})</span>` : ''}</span>
      <span>Speed ${esc(speedText(b.speed))}</span></div>
    <div class="sb-scores">${scores}</div>
    ${saves ? `<div class="sb-rolls"><b>Saves</b> ${saves}</div>` : ''}
    ${skills ? `<div class="sb-rolls"><b>Skills</b> ${skills}</div>` : ''}
    <div class="sb-more small">${line('Senses', b.senses)}${line('Languages', b.languages)}${line('Resistances', b.resist)}${line('Immunities', b.immune)}${line('Condition immunities', b.cond_immune)}</div>
    ${quick ? `<div class="sb-attacks">${quick}</div>` : ''}
    ${b.bonus_note ? `<p class="small note" style="margin:6px 0">${esc(b.bonus_note)}</p>` : ''}
    <details class="sb-details" ${open ? 'open' : ''}><summary class="small">Traits and actions</summary>
      ${(b.traits || []).map((t) => `<p class="small"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('')}
      ${actions ? `<h4>Actions</h4>${actions}` : ''}
      ${(b.reactions || []).length ? `<h4>Reactions</h4>${b.reactions.map((t) => `<p class="small"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('')}` : ''}
    </details>
  </div>`;
}

function blockFor(owner) {
  if (owner === 'form') return formBlock();
  if (owner.startsWith('cmp:')) { const c = (S.char.companions || [])[+owner.slice(4)]; return c ? effectiveBlock(c) : null; }
  if (owner.startsWith('form:')) return CREATURES[owner.slice(5)] || null;
  return null;
}
function ownerName(owner, b) {
  if (owner.startsWith('cmp:')) { const c = (S.char.companions || [])[+owner.slice(4)]; return (c && c.name) || b.name; }
  return b.name;
}

function cmpRoll(t) {
  const b = blockFor(t.dataset.owner);
  if (!b) return;
  const who = ownerName(t.dataset.owner, b);
  const ds = t.dataset;
  // in Wild Shape the beast is you: your conditions, exhaustion and cover count. A companion has its own.
  const mine = ds.owner === 'form';
  const o = { plain: true, conditions: mine };
  if (ds.what === 'check') return rollD20({ label: `${who}: ${AB_NAME[ds.ab]} check`, mod: abMod((b.scores || {})[ds.ab]), kind: 'check', ab: ds.ab, ...o });
  if (ds.what === 'save') return rollD20({ label: `${who}: ${AB_NAME[ds.ab]} save`, mod: (b.saves || {})[ds.ab] ?? abMod((b.scores || {})[ds.ab]), kind: 'save', ab: ds.ab, ...o });
  if (ds.what === 'skill') {
    const ab = ((S.srd || {}).skills || {})[ds.cskill] || '';
    return rollD20({ label: `${who}: ${ds.cskill}`, mod: (b.skills || {})[ds.cskill] || 0, kind: 'skill', ab, ...o });
  }
  const a = (b.actions || [])[+ds.n];
  if (!a) return null;
  // the first damage entry is the hit; later ones are often conditional (poison on a failed save), so they roll on their own
  const damage = (crit, k = 0) => {
    const d = (a.damage || [])[k];
    if (!d) return null;
    return rollDamage({ label: `${who}: ${a.name}${k ? ` (${d.type || 'extra'})` : ''}${crit ? ' (critical)' : ''}`, dice: d.dice, type: d.type || '', crit });
  };
  if (ds.what === 'attack') {
    return rollD20({ label: `${who}: ${a.name}`, mod: a.attack, kind: 'attack', ...o,
      follow: (crit) => (a.damage || []).map((d, k) => ({ label: `${k ? 'Extra' : crit ? 'Critical' : 'Roll'} damage${k ? ` (${d.type || d.dice})` : ''}`, fn: () => damage(crit, k) })) });
  }
  return damage(false, +ds.k || 0);
}

/* ---------------------------------------------------------------- the builder step */
function cmpSourcesHtml() {
  const info = cmpInfo(), out = [];
  if (info.find_familiar) out.push(`<li><b>Familiar.</b> ${info.chain ? 'Pact of the Chain: a familiar, which can also be an imp, pseudodragon, quasit or sprite, and can attack with its reaction.' : 'You know Find Familiar: a spirit in the shape of a small animal.'}</li>`);
  if (info.beast_master) out.push(`<li><b>Ranger’s Companion.</b> A beast of CR 1/4 or lower, Medium or smaller. It adds your proficiency bonus (+${info.prof}) to its AC, attacks and damage.</li>`);
  if (info.find_steed) out.push(`<li><b>Steed.</b> Find ${info.greater_steed ? 'Greater ' : ''}Steed: ${info.greater_steed ? 'a griffon, pegasus, dire wolf, rhinoceros or saber-toothed tiger, or ' : ''}a warhorse, pony, camel, elk or mastiff.</li>`);
  if (info.wild_shape) out.push(`<li><b>Wild Shape.</b> ${esc(info.wild_shape.text)}</li>`);
  return out.length ? `<ul class="small">${out.join('')}</ul>`
    : '<p class="hint">Nothing on your sheet gives a companion yet (Find Familiar, Pact of the Chain, Find Steed, a Beast Master ranger or a druid’s Wild Shape). You can still add any creature: a summon, a mount, a pet.</p>';
}

function cmpListHtml() {
  const list = S.char.companions || [];
  if (!list.length) return '<p class="muted">No companions yet.</p>';
  return list.map((x, i) => `<div class="cmp-card">
    <div class="row cmp-edit">
      <label class="field grow" style="margin:0"><span>Name</span><input type="text" data-cmp-field="name" data-i="${i}" value="${esc(x.name || '')}" placeholder="${esc(x.block.name)}"></label>
      <label class="field" style="margin:0"><span>What it is</span><select data-cmp-field="kind" data-i="${i}">${CMP_KINDS.filter(([k]) => k !== 'custom').map(([k, l]) => `<option value="${k}" ${x.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button class="btn quiet danger small" data-act="cmp-remove" data-i="${i}" style="align-self:flex-end">Remove</button></div>
    ${statBlockHtml(effectiveBlock(x), { owner: `cmp:${i}`, title: x.name || x.block.name })}
    <label class="field" style="margin:8px 0 0"><span>Notes</span><textarea rows="1" data-cmp-field="notes" data-i="${i}" placeholder="Where it came from, what it’s like">${esc(x.notes || '')}</textarea></label>
  </div>`).join('');
}

const RESULT_PAGE = 40;
function cmpResultRows(list, forForms) {
  if (!list.length) return '<p class="muted small">Nothing matches.</p>';
  const ui = cmpUi(), which = forForms ? 'form' : 'cmp';
  const forms = new Set(S.char.forms || []);
  const shown = ui.all === which ? list : list.slice(0, RESULT_PAGE);
  return `<table class="list cmp-results"><tbody>${shown.map((c) => `<tr>
    <td><button class="linkish" data-act="cmp-preview" data-name="${esc(c.name)}" data-for="${which}"><b>${esc(c.name)}</b></button><br><span class="muted small">${esc(c.size)} ${esc(c.type)}</span></td>
    <td class="small">CR ${esc(c.cr_text)}</td><td class="small">AC ${c.ac}, HP ${c.hp}</td><td class="small">${esc(c.speed)}</td>
    <td style="text-align:right;white-space:nowrap">
      <button class="btn quiet small" data-act="cmp-preview" data-name="${esc(c.name)}" data-for="${which}">Look</button>
      ${forForms ? `<button class="btn small" data-act="form-toggle" data-name="${esc(c.name)}">${forms.has(c.name) ? 'Saved ✓' : 'Save form'}</button>`
        : `<button class="btn small" data-act="cmp-add" data-name="${esc(c.name)}">Add</button>`}</td></tr>`).join('')}</tbody></table>
    ${shown.length < list.length ? `<p class="small" style="margin:6px 0 0">${shown.length} of ${list.length} shown. Search to narrow it down, or
      <button class="btn quiet small" data-act="cmp-all" data-for="${which}">show all ${list.length}</button></p>` : ''}`;
}

async function refreshCmpResults() {
  const ui = cmpUi(), box = $('#cmp-results');
  if (!box) return;
  if (ui.mode === 'custom') { box.innerHTML = customCreatureHtml(); return; }
  const { creatures } = await api('/api/creatures/search', { json: { q: ui.q, mode: ui.mode, info: cmpSearchInfo() } });
  ui.cmpList = creatures;
  if (ui.all === 'cmp') ui.all = null;
  if ($('#cmp-results')) $('#cmp-results').innerHTML = cmpResultRows(creatures, false);
}
async function refreshFormResults() {
  const ui = cmpUi(), box = $('#form-results');
  if (!box) return;
  const { creatures } = await api('/api/creatures/search', { json: { q: ui.wsq, mode: 'wildshape', info: cmpSearchInfo() } });
  ui.formList = creatures;
  if (ui.all === 'form') ui.all = null;
  if ($('#form-results')) $('#form-results').innerHTML = cmpResultRows(creatures, true);
}

/* A creature's full stat block in a window over the list, so the page doesn't jump around. */
function openCreatureModal(block, which) {
  $$('.cmp-modal-back').forEach((el) => el.remove());
  const back = document.createElement('div');
  back.className = 'modal-back cmp-modal-back';
  const saved = (S.char.forms || []).includes(block.name);
  back.innerHTML = `<div class="modal cmp-modal" role="dialog" aria-modal="true" aria-label="${esc(block.name)}">
    <button class="btn quiet close" data-act="close-modal" aria-label="Close">Close</button>
    ${statBlockHtml(block, { owner: `form:${block.name}`, open: true })}
    <div class="row" style="justify-content:flex-end;margin-top:12px">
      <button class="btn" data-act="close-modal">Close</button>
      ${which === 'form' ? `<button class="btn primary" data-act="form-toggle" data-name="${esc(block.name)}">${saved ? 'Saved ✓ (remove)' : 'Save this form'}</button>`
        : `<button class="btn primary" data-act="cmp-add" data-name="${esc(block.name)}">Add ${esc(block.name)}</button>`}</div></div>`;
  back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
  document.body.append(back);
  const btn = back.querySelector('.btn.primary');
  if (btn) btn.focus();
}

function customCreatureHtml() {
  return `<div class="edit-grid custom-creature">
    <label class="field wide"><span>Name</span><input type="text" id="cc-name" placeholder="Bramble the hound"></label>
    <label class="field"><span>Size</span><select id="cc-size">${['Tiny', 'Small', 'Medium', 'Large', 'Huge', 'Gargantuan'].map((s) => `<option ${s === 'Medium' ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
    <label class="field"><span>Type</span><input type="text" id="cc-type" value="beast"></label>
    <label class="field"><span>Armor class</span><input type="number" id="cc-ac" value="12" min="0"></label>
    <label class="field"><span>Hit points</span><input type="number" id="cc-hp" value="10" min="1"></label>
    <label class="field"><span>Speed (ft)</span><input type="number" id="cc-walk" value="30" min="0"></label>
    <label class="field"><span>Fly / swim (ft)</span><span class="row" style="gap:4px"><input type="number" id="cc-fly" value="0" min="0" style="width:64px" aria-label="Fly speed"><input type="number" id="cc-swim" value="0" min="0" style="width:64px" aria-label="Swim speed"></span></label>
    ${ABILITIES.map((a) => `<label class="field"><span>${AB_NAME[a]}</span><input type="number" id="cc-${a}" value="10" min="1" max="30"></label>`).join('')}
    <label class="field" style="grid-column:1/-1"><span>Attacks, one per line: name, to hit, damage, type</span>
      <textarea rows="3" id="cc-attacks" placeholder="Bite, +4, 1d6+2, piercing&#10;Claws, +4, 2d4+2, slashing"></textarea></label>
    <label class="field" style="grid-column:1/-1"><span>Traits and anything else</span><textarea rows="2" id="cc-traits" placeholder="Keen Smell. Advantage on Perception checks that rely on smell."></textarea></label>
  </div><button class="btn primary" data-act="cmp-custom">Add this creature</button>`;
}

STEP_RENDER.companions = async () => {
  const c = S.char, info = cmpInfo(), ui = cmpUi();
  c.companions = c.companions || [];
  let html = `<div class="panel"><h2>Companions &amp; forms</h2>
    <p class="hint">Familiars, animal companions, steeds and summons get their own stat block with rollable attacks, and hit points you track on the Play tab. Stat blocks come from the free SRD 5.1; anything else you can make yourself.</p>
    ${cmpSourcesHtml()}
    <div id="cmp-list">${cmpListHtml()}</div></div>`;
  html += `<div class="panel"><h3>Add a companion</h3>
    <div class="row" style="align-items:flex-end">
      <label class="field" style="margin:0"><span>Kind</span><select id="cmp-mode">${CMP_KINDS.map(([k, l]) => `<option value="${k}" ${ui.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${ui.mode === 'custom' ? '' : `<label class="field grow" style="margin:0"><span>Search</span><input type="search" id="cmp-q" value="${esc(ui.q)}" placeholder="owl, wolf, horse, elemental…"></label>`}
    </div>
    <div id="cmp-results" style="margin-top:10px"><p class="loading">Loading…</p></div></div>`;
  if (info.wild_shape || (c.forms || []).length) {
    const ws = info.wild_shape;
    html += `<div class="panel"><h3>Wild Shape forms</h3>
      ${ws ? `<p class="small">${esc(ws.text)}</p>` : '<p class="hint">Your sheet doesn’t have Wild Shape right now; these are kept in case.</p>'}
      <p class="hint small">Save the beasts you’ve seen and like to use. On the Play tab you can turn into one, and its hit points are tracked separately from yours.</p>
      <div id="form-saved">${formsSavedHtml()}</div>
      ${ws ? `<label class="field" style="margin-top:10px"><span>Find a beast you can turn into</span><input type="search" id="form-q" value="${esc(ui.wsq)}" placeholder="wolf, bear, spider…"></label>
      <div id="form-results"><p class="loading">Loading…</p></div>` : ''}</div>`;
  }
  setTimeout(() => { refreshCmpResults().catch((e) => toast(e.message, 'error')); refreshFormResults().catch(() => {}); }, 0);
  return html;
};

function formsSavedHtml() {
  const forms = S.char.forms || [];
  return forms.length ? `<div class="toggles">${forms.map((n) => `<span class="chip">${esc(n)} <button class="btn quiet small" data-act="form-toggle" data-name="${esc(n)}" aria-label="Remove ${esc(n)}">×</button></span>`).join('')}</div>`
    : '<p class="muted small">No forms saved yet.</p>';
}
function addCompanion(block, kind) {
  const c = S.char;
  c.companions = c.companions || [];
  c.companions.push({ id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`, kind, name: '', block, hp: null, notes: '' });
  changed();
}

function parseCustomAttacks(text) {
  return String(text || '').split('\n').map((l) => l.split(',').map((x) => x.trim())).filter((p) => p[0]).map(([name, hit, dice, type]) => {
    const atk = parseInt(String(hit || '').replace(/\s+/g, ''), 10);
    const ok = dice && Dice.parse(dice);
    return { name, text: '', attack: isNaN(atk) ? null : atk, damage: ok ? [{ dice: dice.replace(/\s+/g, ''), type: type || '' }] : [] };
  });
}

Object.assign(ACTIONS, {
  'cmp-roll': (t) => cmpRoll(t),
  'cmp-add': (t) => busy(t, 'Adding…', async () => {
    const block = await creature(t.dataset.name);
    const ui = cmpUi();
    addCompanion(JSON.parse(JSON.stringify(block)), ui.mode === 'any' ? 'summon' : ui.mode);
    const modal = t.closest('.modal-back');
    if (modal) modal.remove();
    if ($('#cmp-list')) $('#cmp-list').innerHTML = cmpListHtml();
    toast(`${block.name} added to your companions, at the top of this step. Give it a name if you like.`);
  }),
  'cmp-preview': async (t) => {
    const name = t.dataset.name;
    try { openCreatureModal(CREATURES[name] || await creature(name), t.dataset.for); }
    catch (e) { toast(e.message, 'error'); }
  },
  'cmp-all': (t) => {
    const ui = cmpUi(), which = t.dataset.for;
    ui.all = which;
    if (which === 'form') $('#form-results').innerHTML = cmpResultRows(ui.formList || [], true);
    else $('#cmp-results').innerHTML = cmpResultRows(ui.cmpList || [], false);
  },
  'cmp-remove': (t) => {
    const x = S.char.companions[+t.dataset.i];
    if (!confirm(`Remove ${x.name || x.block.name}?`)) return;
    S.char.companions.splice(+t.dataset.i, 1);
    changed();
    if ($('#cmp-list')) $('#cmp-list').innerHTML = cmpListHtml();
    if (S.tab === 'play') renderPlayMain();
  },
  'cmp-custom': () => {
    const v = (id) => ($(`#cc-${id}`) || {}).value || '';
    const name = v('name').trim();
    if (!name) { toast('Give it a name first.', 'error'); $('#cc-name').focus(); return; }
    const speed = { walk: +v('walk') || 0 };
    if (+v('fly')) speed.fly = +v('fly');
    if (+v('swim')) speed.swim = +v('swim');
    const traits = v('traits').split('\n').filter((l) => l.trim()).map((l) => {
      const m = l.match(/^([^.]{1,40})\.\s+(.*)$/);
      return m ? { name: m[1], text: m[2] } : { name: 'Note', text: l.trim() };
    });
    const block = { name, size: v('size'), type: v('type') || 'creature', cr: null, ac: +v('ac') || 10, ac_note: '', hp: +v('hp') || 1, hit_dice: '',
      speed, scores: Object.fromEntries(ABILITIES.map((a) => [a, +v(a) || 10])), skills: {}, saves: {}, senses: '', languages: '',
      resist: [], immune: [], vulnerable: [], cond_immune: [], traits, actions: parseCustomAttacks(v('attacks')), reactions: [], custom: true };
    addCompanion(block, 'custom');
    $('#cmp-list').innerHTML = cmpListHtml();
    toast(`${name} added.`);
  },
  'form-toggle': (t) => {
    const set = new Set(S.char.forms || []);
    const n = t.dataset.name;
    if (set.has(n)) set.delete(n); else set.add(n);
    S.char.forms = [...set].sort();
    changed();
    if ($('#form-saved')) $('#form-saved').innerHTML = formsSavedHtml();
    if ($('#form-results') && cmpUi().formList) $('#form-results').innerHTML = cmpResultRows(cmpUi().formList, true);
    const mb = t.closest('.cmp-modal') ? t : null;
    if (mb) mb.textContent = set.has(n) ? 'Saved ✓ (remove)' : 'Save this form';
    if (S.tab === 'play') renderPlayMain();
  },
});

let cmpTimer;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'cmp-q') { cmpUi().q = t.value; clearTimeout(cmpTimer); cmpTimer = setTimeout(() => refreshCmpResults(), 220); }
  else if (t.id === 'form-q') { cmpUi().wsq = t.value; clearTimeout(cmpTimer); cmpTimer = setTimeout(() => refreshFormResults(), 220); }
  else if (t.dataset.cmpField === 'name' || t.dataset.cmpField === 'notes') {
    const x = (S.char.companions || [])[+t.dataset.i];
    if (x) { x[t.dataset.cmpField] = t.value; changed({ compute: false }); }
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'cmp-mode') { const ui = cmpUi(); ui.mode = t.value; ui.q = ''; ui.all = null; renderStep(); }
  else if (t.dataset.cmpField === 'kind') {
    const x = (S.char.companions || [])[+t.dataset.i];
    if (x) { x.kind = t.value; changed({ compute: false }); $('#cmp-list').innerHTML = cmpListHtml(); }
  }
});

/* ---------------------------------------------------------------- the Play tab */
function cmpHp(x) { const max = effectiveBlock(x).hp || 0; return x.hp == null ? max : Math.min(x.hp, max); }

function playCompanionsHtml() {
  const list = S.char.companions || [];
  if (!list.length) return '';
  return `<div class="panel cmp-play"><h3>Companions</h3>
    <div class="cmp-grid">${list.map((x, i) => {
      const b = effectiveBlock(x), hp = cmpHp(x), max = b.hp || 0;
      const pct = max ? Math.round((100 * hp) / max) : 0;
      return `<div class="cmp-card">
        ${statBlockHtml(b, { owner: `cmp:${i}`, title: x.name || b.name, hp, play: true })}
        <div class="hp-bar small-bar" role="img" aria-label="${hp} of ${max} hit points"><span style="width:${pct}%"></span></div>
        <div class="row" style="gap:6px;margin-top:6px">
          <input type="number" min="0" data-cmp-amt="${i}" placeholder="Amount" aria-label="Amount for ${esc(x.name || b.name)}" style="width:90px">
          <button class="btn small" data-act="cmp-hp" data-i="${i}" data-d="-1">Damage</button>
          <button class="btn small" data-act="cmp-hp" data-i="${i}" data-d="1">Heal</button>
          <button class="btn quiet small" data-act="cmp-full" data-i="${i}">Full HP</button>
          ${hp === 0 ? `<span class="warn-text small">${x.kind === 'familiar' ? 'Gone: cast Find Familiar to call it back.' : x.kind === 'steed' ? 'Gone: cast Find Steed to call it back.' : 'Down.'}</span>` : ''}
        </div></div>`;
    }).join('')}</div>
    <p class="hint small">Rolls here use the creature’s own numbers; your conditions don’t apply to it. Long rests heal companions to full.</p></div>`;
}

function wildShapePanelHtml() {
  const info = cmpInfo(), p = playState();
  const ws = info.wild_shape;
  if (!ws && !p.form) return '';
  if (p.form) {
    const f = p.form, pct = f.max ? Math.round((100 * f.hp) / f.max) : 0;
    return `<div class="panel ws-panel"><div class="row" style="justify-content:space-between"><h3 style="margin:0">Wild Shape: ${esc(f.name)}</h3>
        <button class="btn" data-act="ws-revert">Change back</button></div>
      <p class="small">Beast hit points <b>${f.hp} / ${f.max}</b>. Damage comes off these first; at 0 you change back and the rest carries over to you. Take damage and heal with the buttons at the top.</p>
      <div class="hp-bar" role="img" aria-label="${f.hp} of ${f.max} beast hit points"><span style="width:${pct}%"></span></div>
      ${formEffectsHtml()}
      ${statBlockHtml(formBlock(), { owner: 'form', title: f.name, hp: f.hp, play: true, open: true, acBonus: coverBonus(), acNote: coverName() })}
      <p class="hint small">Your Intelligence, Wisdom and Charisma, your save and skill proficiencies (where they beat the beast’s) and your class and species features carry over; you can’t cast spells (until Beast Spells at 18th level).</p></div>`;
  }
  const forms = S.char.forms || [];
  const res = (S.sheet.resources || []).find((r) => r.id === 'wild-shape');
  const left = res ? (res.max == null ? '∞' : res.max - Math.min(resUsed('wild-shape'), res.max)) : 0;
  return `<div class="panel ws-panel"><h3>Wild Shape <span class="muted small">${left} use${left === 1 ? '' : 's'} left</span></h3>
    <p class="small">${esc(ws.text)}</p>
    <div class="row" style="align-items:flex-end">
      <label class="field grow" style="margin:0"><span>Turn into</span><select id="ws-pick">${forms.length ? forms.map((n) => `<option>${esc(n)}</option>`).join('') : ''}<option value="">Another beast…</option></select></label>
      <input type="text" id="ws-other" placeholder="Beast name, like Wolf" ${forms.length ? 'hidden' : ''} aria-label="Beast name">
      <button class="btn primary" data-act="ws-transform">Transform</button></div>
    ${forms.length ? '' : '<p class="hint small">Save favorite forms on the Build tab, Companions &amp; forms step.</p>'}</div>`;
}

function formEffectsHtml() {
  const p = playState(), bits = [];
  p.conditions.forEach((c) => bits.push(c.toLowerCase()));
  if (p.exhaustion) bits.push(`exhaustion ${p.exhaustion}`);
  if (coverBonus()) bits.push(`${coverName()} (+${coverBonus()} AC and Dexterity saves)`);
  else if (p.cover === 'full') bits.push('full cover');
  if (rageOn()) bits.push('raging');
  return bits.length ? `<p class="note small" style="margin:8px 0">Still in effect on your beast form: <b>${esc(bits.join(', '))}</b>. Its rolls below include them.</p>` : '';
}

Object.assign(ACTIONS, {
  'cmp-hp': (t) => {
    const x = S.char.companions[+t.dataset.i];
    const box = $(`[data-cmp-amt="${t.dataset.i}"]`);
    const n = Math.max(0, Math.floor(+(box && box.value) || 0));
    if (!n) { toast('Type an amount first.', 'error'); return; }
    const max = effectiveBlock(x).hp || 0;
    x.hp = Math.max(0, Math.min(max, cmpHp(x) + n * +t.dataset.d));
    savePlay();
  },
  'cmp-full': (t) => { S.char.companions[+t.dataset.i].hp = null; savePlay(); },
  'ws-transform': (t) => busy(t, 'Changing…', async () => {
    const pick = $('#ws-pick'), other = $('#ws-other');
    const name = (pick && pick.value) || (other && other.value.trim());
    if (!name) { toast('Pick a beast first.', 'error'); return; }
    let block;
    try { block = await creature(name); } catch (e) { throw new Error(`No SRD beast called “${name}”. Check the spelling, or pick one on the Build tab.`); }
    const { creatures: ok } = await api('/api/creatures/search', { json: { q: block.name, mode: 'wildshape', info: cmpSearchInfo() } });
    if (!ok.some((c) => c.name === block.name) && !confirm(`${block.name} is outside your Wild Shape limits (${cmpInfo().wild_shape.text}) Transform anyway?`)) return;
    const res = (S.sheet.resources || []).find((r) => r.id === 'wild-shape');
    const cost = block.type === 'elemental' ? 2 : 1;
    if (res && res.max != null) {
      if (res.max - resUsed('wild-shape') < cost) { toast('No Wild Shape uses left. Take a short or long rest.', 'error'); return; }
      setResUsed('wild-shape', resUsed('wild-shape') + cost);
    }
    playState().form = { name: block.name, hp: block.hp, max: block.hp, block: JSON.parse(JSON.stringify(block)) };
    savePlay();
    toast(`You turn into a ${block.name.toLowerCase()}.`);
  }),
  'ws-revert': () => { playState().form = null; savePlay(); toast('You change back.'); },
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'ws-pick') { const o = $('#ws-other'); if (o) o.hidden = !!e.target.value; }
});

/* Damage and healing go to the beast first while you're in Wild Shape. */
const baseHpDamage = ACTIONS['hp-damage'], baseHpHeal = ACTIONS['hp-heal'];
ACTIONS['hp-damage'] = () => {
  const p = playState();
  if (!p.form) return baseHpDamage();
  const n = hpAmount();
  if (!n) return;
  let left = n;
  if (p.temp) { const soak = Math.min(p.temp, left); p.temp -= soak; left -= soak; }
  const soak = Math.min(p.form.hp, left);
  p.form.hp -= soak;
  left -= soak;
  if (p.form.hp <= 0) {
    const name = p.form.name;
    p.form = null;
    if (left > 0) p.hp = Math.max(0, curHp() - left);
    toast(`Your ${name.toLowerCase()} form drops to 0 hit points and you change back${left > 0 ? `; ${left} damage carries over to you` : ''}.`);
  }
  concentrationAfterDamage(n);
  savePlay();
};
ACTIONS['hp-heal'] = () => {
  const p = playState();
  if (!p.form) return baseHpHeal();
  const n = hpAmount();
  if (!n) return;
  p.form.hp = Math.min(p.form.max, p.form.hp + n);
  savePlay();
};

/* ---------------------------------------------------------------- the printed sheet */
function companionsSheetHtml() {
  const list = (S.char.companions || []);
  const forms = S.char.forms || [];
  if (!list.length && !forms.length) return '';
  return `<h3>Companions &amp; forms</h3>${list.map((x) => {
    const b = effectiveBlock(x);
    const atks = (b.actions || []).filter((a) => a.attack != null).map((a) => `${a.name} ${signed(a.attack)}${(a.damage || []).length ? `, ${a.damage.map((d) => `${d.dice} ${d.type || ''}`.trim()).join(' + ')}` : ''}`);
    return `<p><b>${esc(x.name || b.name)}</b> <span class="muted small">${x.name ? `${esc(b.name)}, ` : ''}${esc(CMP_KIND_LABEL[x.kind] || 'Creature').toLowerCase()}</span><br>
      AC ${b.ac}, HP ${b.hp}, speed ${esc(speedText(b.speed))}${atks.length ? `<br><span class="small">${esc(atks.join('; '))}</span>` : ''}</p>`;
  }).join('')}${forms.length ? `<p><b>Wild Shape forms:</b> ${esc(forms.join(', '))}</p>` : ''}`;
}
