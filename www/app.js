/* Character Forge interface. Adapted from the PC app's app/static/app.js: the screens are the same,
   but every /api call is answered on the device by js/api.js instead of a server. */
import { createApi } from './js/api.js';
import { idbStore } from './js/store.js';

/* ================================================================ helpers */
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const signed = (n) => (n == null || isNaN(n) ? '–' : (n >= 0 ? '+' : '') + n);
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const AB_NAME = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const KIND_LABEL = { race: 'Species', class: 'Class', subclass: 'Subclass', background: 'Background', feat: 'Feat', spell: 'Spell',
  'spell-list': 'Spell list', 'class-option': 'Class option', item: 'Item', other: 'Other' };
const PB_COST = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

const S = {
  view: 'characters', step: 'concept', char: null, charId: null, sheet: null,
  srd: null, status: null, lists: {}, details: {}, raceSel: null, libSel: null, extract: null,
};

let API = null;
async function api(path, opts = {}) {
  if (!API) throw new Error('The app is still starting. Try again in a moment.');
  return API.request(path, opts);
}

/** Save a file to the device: the share sheet where there is one (phones), a download otherwise. */
async function saveFile(name, text, type = 'application/json') {
  const file = new File([text], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
const fileName = (n) => (n || 'character').replace(/[^\w\- ]+/g, '').trim() || 'character';

let toastTimer;
function toast(msg, kind = 'info') {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.append(t); }
  t.className = 'toast' + (kind === 'error' ? ' error' : '');
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), kind === 'error' ? 9000 : 3500);
}

async function busy(btn, label, fn) {
  const old = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await fn(); }
  catch (e) { toast(e.message, 'error'); }
  finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = old; } }
}

function prose(text) {
  if (!text) return '';
  const blocks = String(text).split(/\n\s*\n/);
  return blocks.map((b) => {
    const lines = b.split('\n').filter((l) => l.trim());
    if (!lines.length) return '';
    if (lines.every((l) => l.startsWith('- '))) return '<ul>' + lines.map((l) => `<li>${esc(l.slice(2))}</li>`).join('') + '</ul>';
    if (lines.length === 1 && /^#{1,6} /.test(lines[0])) return `<h4>${esc(lines[0].replace(/^#+ /, ''))}</h4>`;
    return `<p>${lines.map((l) => esc(l.replace(/^#+ /, ''))).join('<br>')}</p>`;
  }).join('');
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k) => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  o[keys[keys.length - 1]] = value;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

function readValue(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.type === 'number' || el.dataset.num !== undefined) return el.value === '' ? 0 : Number(el.value);
  return el.value;
}

async function list(kind, extra = '') {
  const key = kind + extra;
  if (!S.lists[key]) S.lists[key] = (await api(`/api/entries?kind=${kind}${extra}`)).entries;
  return S.lists[key];
}
async function detail(id) {
  if (!id) return null;
  if (!S.details[id]) S.details[id] = (await api(`/api/entries/${id}`)).entry;
  return S.details[id];
}
const sourceTag = (e) => (e.source === 'wiki' || e.source === 'srd' ? '' : e.source.startsWith('pdf:') ? `<span class="tag pdf">PDF</span>` : `<span class="tag">yours</span>`)
  + (e.tags || []).filter((t) => t === 'ua' || t === 'homebrew').map((t) => `<span class="tag ua">${t === 'ua' ? 'UA' : 'homebrew'}</span>`).join('');
const optionName = (e) => e.name + (e.source.startsWith('pdf:') ? ' (your PDF)' : e.source === 'custom' ? ' (yours)' : '')
  + ((e.tags || []).includes('ua') ? ' (UA)' : '');

function options(entries, selectedId, placeholder) {
  return `<option value="">${esc(placeholder)}</option>` + entries.map((e) =>
    `<option value="${e.id}" ${String(e.id) === String(selectedId) ? 'selected' : ''}>${esc(optionName(e))}</option>`).join('');
}

/* ================================================================ save & compute */
let saveTimer, computeTimer, computeSeq = 0;
function changed({ save = true, compute = true } = {}) {
  if (save) { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); }
  if (compute) { clearTimeout(computeTimer); computeTimer = setTimeout(computeNow, 250); }
}
async function saveNow() {
  if (!S.charId || !S.char) return;
  try { await api(`/api/characters/${S.charId}`, { method: 'PUT', json: { character: S.char } }); }
  catch (e) { toast('Couldn’t save: ' + e.message, 'error'); }
}
async function computeNow() {
  if (!S.char) return;
  const seq = ++computeSeq;
  try {
    const { sheet } = await api('/api/compute', { json: { character: S.char } });
    if (seq !== computeSeq) return;
    S.sheet = sheet;
    renderLive();
    afterCompute();
  } catch (e) { toast(e.message, 'error'); }
}
function afterCompute() {
  refreshOutputs();
  if (S.view !== 'builder') return;
  if (S.step === 'sheet') renderStep();
  else if (S.step === 'spells' && S.spellsKey !== spellsKey()) renderStep();
}
function refreshOutputs() {
  const sh = S.sheet;
  if (!sh) return;
  $$('[data-out]').forEach((el) => {
    let v = getPath(sh, el.dataset.out);
    if (el.dataset.fmt === 'signed') v = signed(v);
    el.textContent = v ?? '–';
  });
  $$('[data-skill]').forEach((el) => {
    const s = sh.skills.find((x) => x.name === el.dataset.skill);
    if (s) el.textContent = signed(s.bonus);
  });
  const pb = $('#pb-left');
  if (pb && S.char) {
    const spent = ABILITIES.reduce((t, a) => t + (PB_COST[S.char.base_scores[a]] ?? 99), 0);
    pb.textContent = spent > 200 ? 'Point buy scores must be 8–15' : `${27 - spent} of 27 points left`;
    pb.classList.toggle('warn', spent > 27);
  }
}

/* ================================================================ routing */
function go(view) {
  if (S.view === 'builder' && view !== 'builder') saveNow();
  S.view = view;
  $$('.top nav button').forEach((b) => {
    const on = b.dataset.view === view || (view === 'builder' && b.dataset.view === 'characters');
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  ({ characters: renderCharacters, builder: renderBuilder, library: renderLibrary, pdfs: renderPdfs, settings: renderSettings })[view]();
  window.scrollTo(0, 0);
}

/* ================================================================ characters view */
async function renderCharacters() {
  const main = $('#main');
  main.innerHTML = '<p class="loading">Loading characters…</p>';
  const [{ characters }, status] = await Promise.all([api('/api/characters'), api('/api/status')]);
  S.status = status;
  main.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:16px">
      <h1>Characters</h1>
      <div class="row">
        <label class="btn" style="cursor:pointer">Import character file<input type="file" accept=".json,application/json" id="import-json" hidden></label>
        <button class="btn primary" data-act="new-char">New character</button>
      </div>
    </div>
    ${characters.length ? `<div class="panel"><table class="list">
      <thead><tr><th>Name</th><th>Build</th><th>Last edited</th><th></th></tr></thead>
      <tbody>${characters.map((c) => `<tr class="clickable char-row" data-act="open-char" data-id="${c.id}">
        <td>${esc(c.name)}</td><td>${esc(c.summary || 'Not started')}</td>
        <td class="muted small">${new Date(c.updated * 1000).toLocaleString()}</td>
        <td style="text-align:right"><button class="btn quiet danger" data-act="del-char" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`
    : `<div class="panel"><p>No characters yet. Start one from scratch, or describe an idea and let Claude draft it. The sheet fills itself in as you go.</p>
       <button class="btn primary" data-act="new-char">New character</button></div>`}`;
  $('#import-json').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const character = JSON.parse(await f.text());
      const { id } = await api('/api/characters', { json: { character } });
      await openChar(id);
    } catch (err) { toast('Couldn’t import: ' + err.message, 'error'); }
  });
}

async function openChar(id, step = 'basics') {
  const { character } = await api(`/api/characters/${id}`);
  S.charId = id;
  S.char = character;
  S.sheet = null;
  S.raceSel = null;
  S.chatDraft = null;
  S.step = step;
  go('builder');
  computeNow();
}

/* ================================================================ builder */
const STEPS = [
  ['concept', 'Start from an idea'], ['basics', 'Basics'], ['species', 'Species'], ['class', 'Class'],
  ['background', 'Background'], ['abilities', 'Ability scores'], ['skills', 'Skills'], ['feats', 'Feats & improvements'],
  ['spells', 'Spells'], ['equipment', 'Equipment & HP'], ['story', 'Personality & story'], ['sheet', 'Character sheet'],
];
function stepDone(key) {
  const c = S.char;
  return ({
    basics: !!c.name, species: !!(c.race && c.race.id), class: (c.classes || []).length > 0,
    background: !!(c.background && c.background.id), skills: (c.skills || []).length > 0,
    abilities: ABILITIES.some((a) => (c.base_scores || {})[a] !== 8),
    spells: (c.spells || []).length > 0, equipment: (c.weapons || []).length > 0 || !!c.armor,
    story: !!(c.personality && c.personality.personality_traits) || !!c.backstory,
  })[key];
}

function renderBuilder() {
  $('#main').innerHTML = `<div class="builder">
    <nav class="steps" aria-label="Steps" id="steps"></nav>
    <section class="step-body" id="step-body"></section>
    <aside class="live" id="live" aria-label="Live character sheet"></aside></div>`;
  renderSteps();
  renderStep();
  renderLive();
}
function renderSteps() {
  const bar = $('#steps');
  if (!bar) return;
  bar.innerHTML = STEPS.map(([k, label]) => `<button data-act="step" data-step="${k}" ${S.step === k ? 'aria-current="step"' : ''}>
    <span>${esc(label)}</span>${stepDone(k) ? '<span class="done" aria-label="done">✓</span>' : ''}</button>`).join('');
  // on phones the steps scroll sideways: keep the current one in view
  const cur = $('[aria-current="step"]', bar);
  if (cur && bar.scrollWidth > bar.clientWidth) bar.scrollLeft = cur.offsetLeft - (bar.clientWidth - cur.offsetWidth) / 2;
}

let stepSeq = 0;
async function renderStep() {
  const body = $('#step-body');
  if (!body) return;
  const seq = ++stepSeq;
  const fn = STEP_RENDER[S.step];
  if (!body.innerHTML.trim()) body.innerHTML = '<p class="loading">Loading…</p>';
  let html;
  try { html = await fn(); }
  catch (e) { html = `<div class="note warn">${esc(e.message)}</div>`; }
  if (seq !== stepSeq) return;
  const idx = STEPS.findIndex(([k]) => k === S.step);
  const prev = STEPS[idx - 1], next = STEPS[idx + 1];
  const scroll = window.scrollY;
  body.innerHTML = html + `<div class="step-nav no-print">
    ${prev ? `<button class="btn" data-act="step" data-step="${prev[0]}">Back: ${esc(prev[1])}</button>` : '<span></span>'}
    ${next ? `<button class="btn primary" data-act="step" data-step="${next[0]}">Next: ${esc(next[1])}</button>` : ''}</div>`;
  window.scrollTo(0, scroll);
  $$('[data-filter]', body).forEach((f) => { if (f.value) f.dispatchEvent(new Event('input', { bubbles: true })); });
  refreshOutputs();
  renderSteps();
}

function renderLive() {
  const el = $('#live');
  if (!el) return;
  const c = S.char, sh = S.sheet;
  if (!sh) { el.innerHTML = '<p class="muted">Working out the numbers…</p>'; return; }
  const name = c.name || 'Unnamed hero';
  const line = [sh.class_line, c.race && (c.race.subrace || c.race.name), c.background && c.background.name].filter(Boolean).join(', ');
  el.innerHTML = `<h2>${esc(name)}</h2>
    <p class="classline"><span>${esc(line || 'Pick a species and class to begin')}</span></p>
    <div class="scores">${ABILITIES.map((a) => `<div class="score"><div class="ab">${a.toUpperCase()}</div>
      <div class="mod">${signed(sh.mods[a])}</div><div class="val">${sh.scores[a]}</div></div>`).join('')}</div>
    <div class="combat">
      <div><b>${sh.ac}</b><span>Armor class</span></div>
      <div><b>${sh.hp_max || '–'}</b><span>Hit points</span></div>
      <div><b>${signed(sh.initiative)}</b><span>Initiative</span></div>
      <div><b>${sh.speed}</b><span>Speed (ft)</span></div>
      <div><b>${signed(sh.prof)}</b><span>Proficiency</span></div>
      <div><b>${sh.passive_perception}</b><span>Passive perception</span></div>
    </div>
    <div class="saves">${ABILITIES.map((a) => `<div><span class="dot ${sh.saves[a].prof ? 'on' : ''}"></span>${AB_NAME[a].slice(0, 3)} save <b class="num">${signed(sh.saves[a].bonus)}</b></div>`).join('')}</div>
    ${sh.spellcasting.length ? `<div class="saves" style="grid-template-columns:1fr">${sh.spellcasting.map((s) =>
      `<div>${esc(s.class)} spells: save DC <b>${s.dc}</b>, attack <b>${signed(s.attack)}</b></div>`).join('')}
      ${sh.slots.some((n) => n) ? `<div class="muted">Slots: ${sh.slots.map((n, i) => (n ? `${ord(i + 1)} ×${n}` : '')).filter(Boolean).join(', ')}</div>` : ''}
      ${sh.pact ? `<div class="muted">Pact slots: ${sh.pact.count} × ${ord(sh.pact.level)}</div>` : ''}</div>` : ''}
    ${sh.warnings.length ? `<div class="warnings"><b>${sh.warnings.length} rule ${sh.warnings.length === 1 ? 'check' : 'checks'}</b>
      <ul>${sh.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : (c.classes.length ? '<p class="note good" style="background:#fff">Everything checks out.</p>' : '')}`;
}

/* ---------------------------------------------------------------- steps */
const STEP_RENDER = {};

STEP_RENDER.concept = async () => {
  const st = S.status || (S.status = await api('/api/status'));
  const total = (S.char.classes || []).reduce((t, c) => t + (c.level || 1), 0) || 1;
  return `<div class="panel"><h2>Start from an idea</h2>
    <p class="hint">Describe who you want to play. Claude picks the species, class, background, scores, skills, spells and gear from your library (the built-in rules plus anything you added or pulled from your PDFs), and you can change any of it in the next steps.</p>
    ${st.config.api_key_set ? '' : `<p class="note">No API key needed: the app gives you two prompts to paste into a Claude chat, and you paste each reply back. With a key in <a href="#" data-act="go" data-view="settings">Settings</a>, it does this for you.</p>`}
    <label class="field"><span>Character idea</span>
      <textarea rows="5" data-bind="concept" placeholder="A grumpy dwarf cleric who used to brew ale for a monastery, good in a brawl">${esc(S.char.concept || '')}</textarea></label>
    <div class="row">
      <label class="field" style="margin:0"><span>Level</span><input type="number" min="1" max="20" id="draft-level" value="${total}"></label>
      ${st.config.api_key_set
        ? `<button class="btn primary" data-act="draft" style="align-self:flex-end">Draft with Claude</button>
           <button class="btn quiet" data-act="chat-draft-start" style="align-self:flex-end">Use a Claude chat instead</button>`
        : `<button class="btn primary" data-act="chat-draft-start" style="align-self:flex-end">Copy step 1 prompt</button>`}
    </div>
    <div id="chat-draft">${S.chatDraft ? chatBox(S.chatDraft) : ''}</div>
    <div id="draft-result"></div></div>
    <p class="hint" style="margin-top:12px">Rather build it yourself? Skip ahead to Basics.</p>`;
};

STEP_RENDER.basics = async () => {
  const c = S.char;
  const aligns = (S.srd || {}).alignments || [];
  return `<div class="panel"><h2>Basics</h2>
    <div class="grid2">
      <label class="field"><span>Character name</span><input type="text" data-bind="name" value="${esc(c.name)}"></label>
      <label class="field"><span>Player name</span><input type="text" data-bind="player" value="${esc(c.player)}"></label>
      <label class="field"><span>Alignment</span><select data-bind="alignment"><option value="">Choose…</option>
        ${aligns.map((a) => `<option ${c.alignment === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      <label class="field"><span>Experience points</span><input type="number" min="0" data-bind="xp" value="${c.xp || 0}" style="width:120px"></label>
    </div></div>`;
};

STEP_RENDER.species = async () => {
  const races = await list('race');
  const c = S.char;
  let html = `<div class="panel"><h2>Species</h2>
    <label class="field"><span>Species</span><select data-change="pick-race">${options(races, c.race && c.race.id, 'Choose a species…')}</select></label>`;
  if (c.race && c.race.id) {
    const d = await detail(c.race.id);
    const sels = d.selections || [];
    const variant = sels.find((v) => v.variant === c.race.variant) || sels[0];
    html += '<div class="grid2">';
    if (sels.length > 1) {
      html += `<label class="field"><span>Version</span><select data-change="race-variant">${sels.map((v) =>
        `<option ${variant && v.variant === variant.variant ? 'selected' : ''}>${esc(v.variant)}</option>`).join('')}</select></label>`;
    }
    if (variant && variant.subraces.length) {
      html += `<label class="field"><span>Subrace</span><select data-change="race-subrace"><option value="">None</option>${variant.subraces.map((s) =>
        `<option ${c.race.subrace === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>`;
    }
    html += '</div>';
    const sel = await raceSelection();
    html += `<h3>Ability score increases</h3>
      ${sel.analysis.asi_note ? `<p class="hint">${esc(sel.analysis.asi_note)}</p>` : ''}
      <div class="row">${ABILITIES.map((a) => `<label class="field" style="margin:0"><span>${AB_NAME[a]}</span>
        <input type="number" min="0" max="3" data-bind="race_bonus.${a}" value="${(c.race_bonus || {})[a] || 0}"></label>`).join('')}</div>
      <p class="hint" style="margin-top:8px">Filled in from the listing. Change them if you use custom origins or your species lets you choose.</p>
      <h3>Traits</h3>${sel.traits.map((t) => `<p class="trait"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('') || '<p class="muted">No traits found on this page.</p>'}`;
  }
  return html + '</div>';
};

async function raceSelection() {
  const r = S.char.race;
  if (!r || !r.id) return null;
  const key = `${r.id}|${r.variant}|${r.subrace}`;
  if (!S.raceSel || S.raceSel.key !== key) {
    const q = new URLSearchParams({ variant: r.variant || '', subrace: r.subrace || '' });
    S.raceSel = { key, ...(await api(`/api/race/${r.id}/selection?${q}`)).selection };
  }
  return S.raceSel;
}
async function applyRaceBonus() {
  const sel = await raceSelection();
  if (!sel) return;
  S.char.race_bonus = Object.fromEntries(ABILITIES.map((a) => [a, sel.analysis.asi[a] || 0]));
}

STEP_RENDER.class = async () => {
  const classes = await list('class');
  const c = S.char;
  if (!c.classes.length) c.classes.push({ id: null, name: '', slug: '', level: 1, subclass: null });
  let html = `<div class="panel"><h2>Class</h2>`;
  for (let i = 0; i < c.classes.length; i++) {
    const row = c.classes[i];
    let subHtml = '';
    let info = '';
    if (row.id) {
      const d = await detail(row.id);
      const rules = d.rules || {};
      const subs = (await api(`/api/classes/${encodeURIComponent(rules.slug)}/subclasses`)).entries;
      const subLevel = rules.subclass_level || 3;
      subHtml = row.level >= subLevel
        ? `<label class="field"><span>Subclass</span><select data-change="pick-subclass" data-i="${i}">${options(subs, row.subclass && row.subclass.id, 'Choose a subclass…')}</select></label>`
        : `<p class="hint" style="align-self:center">Subclass at level ${subLevel}</p>`;
      if (i === 0) {
        const feats = (d.data.features || []).filter((f) => f.level && f.level <= row.level);
        info = `<div class="grid2 small" style="margin-top:6px">
          <div><b>Hit die</b> d${rules.hit_die} &nbsp; <b>Saves</b> ${(rules.saves || []).map((s) => AB_NAME[s]).join(', ')}</div>
          <div><b>Skills</b> pick ${rules.skill_count} from ${(rules.skill_options || []).length === 18 ? 'any skill' : (rules.skill_options || []).join(', ')}</div></div>
          ${feats.length ? `<h4>Features to level ${row.level}</h4>${feats.map((f) => `<details class="feature"><summary>${esc(f.name)}<span>level ${f.level}</span></summary><div class="prose">${prose(f.text)}</div></details>`).join('')}` : ''}`;
      }
    }
    html += `<div class="row top-align" style="border-bottom:1px solid var(--grid);padding:10px 0">
      <label class="field grow"><span>${i === 0 ? 'Class' : 'Also a…'}</span><select data-change="pick-class" data-i="${i}">${options(classes, row.id, 'Choose a class…')}</select></label>
      <label class="field"><span>Level</span><input type="number" min="1" max="20" value="${row.level || 1}" data-change="class-level" data-i="${i}"></label>
      ${subHtml}
      ${c.classes.length > 1 ? `<button class="btn quiet danger" style="align-self:center" data-act="remove-class" data-i="${i}">Remove</button>` : ''}
    </div>${info}`;
  }
  html += `<div class="row" style="margin-top:12px"><button class="btn" data-act="add-class">Add another class (multiclass)</button>
    <span class="hint">Your first class sets saving throws and starting proficiencies.</span></div></div>`;
  return html;
};

STEP_RENDER.background = async () => {
  const bgs = await list('background');
  const c = S.char;
  let html = `<div class="panel"><h2>Background</h2>
    <label class="field"><span>Background</span><select data-change="pick-background">${options(bgs, c.background && c.background.id, 'Choose a background…')}</select></label>`;
  if (c.background && c.background.id) {
    const d = await detail(c.background.id);
    const b = d.data;
    html += `<dl class="entry-stats">
      <dt>Skills</dt><dd>${esc((b.skills || []).join(', ') || b.skills_text || '–')}</dd>
      <dt>Tools</dt><dd>${esc(b.tools || '–')}</dd><dt>Languages</dt><dd>${esc(b.languages || '–')}</dd>
      <dt>Equipment</dt><dd>${esc(b.equipment || '–')}</dd></dl>
      ${b.equipment ? '<button class="btn" data-act="bg-gear">Add this equipment to my gear</button>' : ''}
      ${b.feature && b.feature.name ? `<h3>Feature: ${esc(b.feature.name)}</h3><div class="prose">${prose(b.feature.text)}</div>` : ''}
      ${b.variant_note ? `<p class="hint">${esc(b.variant_note)}; check the page for what the variant changes.</p>` : ''}`;
  }
  return html + '</div>';
};

STEP_RENDER.abilities = async () => {
  const c = S.char, sh = S.sheet;
  const m = c.ability_method || 'point_buy';
  const arr = (S.srd && S.srd.standard_array) || [15, 14, 13, 12, 10, 8];
  const parts = (sh && sh.score_parts) || {};
  const input = (a) => {
    const v = c.base_scores[a];
    if (m === 'standard') {
      return `<select data-bind="base_scores.${a}" data-num>${arr.map((n) => `<option ${n === v ? 'selected' : ''}>${n}</option>`).join('')}</select>`;
    }
    return `<input type="number" min="${m === 'point_buy' ? 8 : 3}" max="${m === 'point_buy' ? 15 : 20}" data-bind="base_scores.${a}" value="${v}">`;
  };
  return `<div class="panel"><h2>Ability scores</h2>
    <div class="row" role="radiogroup" aria-label="Method" style="margin-bottom:12px">
      ${[['point_buy', 'Point buy'], ['standard', 'Standard array'], ['manual', 'Rolled or entered']].map(([k, l]) =>
        `<label class="check"><input type="radio" name="am" value="${k}" data-change="ability-method" ${m === k ? 'checked' : ''}>${l}</label>`).join('')}
    </div>
    ${m === 'point_buy' ? '<p class="note" id="pb-left"></p>' : ''}
    ${m === 'manual' ? '<p><button class="btn" data-act="roll">Roll 4d6, drop the lowest</button> <span class="hint" id="roll-out"></span></p>' : ''}
    <table class="list ability-table"><thead><tr><th>Ability</th><th>Base</th><th>Species</th><th>Improvements</th><th>Feats</th><th>Score</th><th>Modifier</th></tr></thead>
    <tbody>${ABILITIES.map((a) => `<tr><td>${AB_NAME[a]}</td><td>${input(a)}</td>
      <td class="num" data-out="score_parts.${a}.race" data-fmt="signed">${signed((c.race_bonus || {})[a] || 0)}</td>
      <td class="num" data-out="score_parts.${a}.asi" data-fmt="signed">${signed((c.improvements || {})[a] || 0)}</td>
      <td class="num" data-out="score_parts.${a}.feat" data-fmt="signed">${signed((parts[a] || {}).feat || 0)}</td>
      <td class="total" data-out="scores.${a}"></td><td class="num" data-out="mods.${a}" data-fmt="signed"></td></tr>`).join('')}</tbody></table>
    <p class="hint" style="margin-top:10px">Species increases are set on the Species step; level-up increases and feats on Feats &amp; improvements.</p></div>`;
};

STEP_RENDER.skills = async () => {
  const c = S.char, sh = S.sheet;
  const first = c.classes[0];
  const rules = first && first.id ? (await detail(first.id)).rules : null;
  const bg = c.background && c.background.id ? (await detail(c.background.id)).data : {};
  const race = await raceSelection();
  const bgSkills = bg.skills || [];
  const raceSkills = race ? race.analysis.skills : [];
  const classOpts = rules ? rules.skill_options : [];
  const picked = (c.skills || []).filter((s) => !bgSkills.includes(s) && !raceSkills.includes(s)).length;
  const extra = race && race.analysis.skill_choices ? ` plus ${race.analysis.skill_choices} of any from your species` : '';
  const skills = Object.entries((S.srd || {}).skills || {});
  return `<div class="panel"><h2>Skills</h2>
    ${rules ? `<p>Pick <b>${rules.skill_count}</b> from your ${esc(rules.name)} list${extra}. You’ve picked <b>${picked}</b>. Skills from your background and species are already marked.</p>` : '<p class="hint">Choose a class first to see which skills it offers.</p>'}
    <table class="list"><thead><tr><th>Skill</th><th>Proficient</th><th>Expertise</th><th style="text-align:right">Bonus</th></tr></thead><tbody>
    ${skills.map(([name, ab]) => {
      const fixed = bgSkills.includes(name) ? 'background' : raceSkills.includes(name) ? 'species' : '';
      const on = fixed || (c.skills || []).includes(name);
      const offered = classOpts.includes(name);
      return `<tr><td>${esc(name)} <span class="muted small">${ab.toUpperCase()}</span>${offered && !fixed ? ' <span class="tag">class</span>' : ''}</td>
        <td><label class="check"><input type="checkbox" data-act="skill" data-skill-name="${esc(name)}" ${on ? 'checked' : ''} ${fixed ? 'disabled' : ''}>${fixed ? `<span class="muted small">from ${fixed}</span>` : ''}</label></td>
        <td><input type="checkbox" class="check" data-act="expertise" data-skill-name="${esc(name)}" ${(c.expertise || []).includes(name) ? 'checked' : ''} aria-label="Expertise in ${esc(name)}"></td>
        <td style="text-align:right" class="num" data-skill="${esc(name)}"></td></tr>`;
    }).join('')}</tbody></table>
    <p class="hint">Expertise comes from features like the rogue’s and bard’s; only tick it if one of yours grants it.</p>
    <div class="grid2" style="margin-top:12px">
      <label class="field"><span>Tool proficiencies</span><input type="text" data-bind="tools" value="${esc(c.tools || '')}" placeholder="${esc(bg.tools || '')}"></label>
      <label class="field"><span>Languages</span><input type="text" data-bind="languages" value="${esc(c.languages || '')}" placeholder="${esc((race && race.analysis.languages) || 'Common')}"></label>
    </div></div>`;
};

STEP_RENDER.feats = async () => {
  const c = S.char, sh = S.sheet;
  const feats = await list('feat');
  const race = await raceSelection();
  const rows = [];
  for (let i = 0; i < (c.feats || []).length; i++) {
    const f = c.feats[i];
    const d = f.id ? await detail(f.id) : null;
    const opts = d ? d.data.asi_options || [] : [];
    rows.push(`<tr><td><a href="#" data-act="show-entry" data-id="${f.id}">${esc(f.name)}</a>
      ${d && d.data.prerequisite ? `<div class="hint small">Prerequisite: ${esc(d.data.prerequisite)}</div>` : ''}</td>
      <td><select data-change="feat-from" data-i="${i}"><option value="asi" ${f.from !== 'race' ? 'selected' : ''}>Level improvement</option>
        <option value="race" ${f.from === 'race' ? 'selected' : ''}>Species bonus feat</option></select></td>
      <td>${opts.length ? `<select data-change="feat-asi" data-i="${i}">${opts.map((a) => `<option value="${a}" ${f.asi === a ? 'selected' : ''}>+${d.data.asi_amount} ${AB_NAME[a]}</option>`).join('')}</select>` : '<span class="muted">–</span>'}</td>
      <td style="text-align:right"><button class="btn quiet danger" data-act="remove-feat" data-i="${i}">Remove</button></td></tr>`);
  }
  return `<div class="panel"><h2>Feats &amp; improvements</h2>
    <p>Your class levels give <b data-out="asi.available">${sh ? sh.asi.available : 0}</b> ability score improvements; you’re using <b data-out="asi.used">${sh ? sh.asi.used : 0}</b>.
      Each one is +2 to spend on scores, or one feat.${race && race.analysis.bonus_feat ? ' Your species also grants a bonus feat.' : ''}</p>
    <h3>Ability score increases from levels</h3>
    <div class="row">${ABILITIES.map((a) => `<label class="field" style="margin:0"><span>${AB_NAME[a]}</span>
      <input type="number" min="0" max="10" data-bind="improvements.${a}" value="${(c.improvements || {})[a] || 0}"></label>`).join('')}</div>
    <h3 style="margin-top:18px">Feats</h3>
    ${rows.length ? `<table class="list"><thead><tr><th>Feat</th><th>Taken as</th><th>Score increase</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="muted">No feats yet.</p>'}
    <div class="row" style="margin-top:10px"><select id="feat-pick">${options(feats, null, 'Choose a feat…')}</select>
      <button class="btn" data-act="add-feat">Add feat</button></div></div>`;
};

function spellsKey() {
  return (S.sheet ? S.sheet.spellcasting : []).map((s) => `${s.slug}:${s.max_spell_level}`).join(',');
}
STEP_RENDER.spells = async () => {
  const c = S.char, sh = S.sheet;
  S.spellsKey = spellsKey();
  if (!sh) return '<p class="loading">Working out spellcasting…</p>';
  const mine = c.spells || [];
  let html = `<div class="panel"><h2>Spells</h2>`;
  if (!sh.spellcasting.length) {
    html += `<p>None of your classes cast spells at their current level. Spells from feats or species traits can still be added below.</p>`;
  }
  for (const sc of sh.spellcasting) {
    const lkey = `spells:${sc.slug}:${sc.max_spell_level}`;
    if (!S.lists[lkey]) S.lists[lkey] = (await api(`/api/classes/${encodeURIComponent(sc.slug)}/spells?max=${sc.max_spell_level}`)).spells;
    const all = S.lists[lkey];
    const pickedHere = mine.filter((s) => s.class === sc.slug);
    const cantrips = pickedHere.filter((s) => (s.level || 0) === 0).length;
    const leveled = pickedHere.length - cantrips;
    const counts = [];
    if (sc.cantrips_known != null) counts.push(`${cantrips} of ${sc.cantrips_known} cantrips`);
    else counts.push(`${cantrips} cantrips`);
    if (sc.spells_known != null) counts.push(`${leveled} of ${sc.spells_known} spells known`);
    else if (sc.prepared_count != null) counts.push(`${leveled} spells (prepare ${sc.prepared_count} a day${sc.slug === 'wizard' ? '; a new spellbook holds 6 + 2 per level after 1st' : ''})`);
    else counts.push(`${leveled} spells`);
    const byLevel = {};
    all.forEach((s) => { (byLevel[s.level ?? '?'] = byLevel[s.level ?? '?'] || []).push(s); });
    html += `<h3 style="margin-top:16px">${esc(sc.class)} <span class="muted small" style="font-family:var(--sans)">save DC ${sc.dc}, attack ${signed(sc.attack)}, up to ${sc.max_spell_level ? ord(sc.max_spell_level) + ' level' : 'cantrips'}</span></h3>
      <p class="hint">${counts.join('; ')}</p>
      <input type="search" placeholder="Filter ${esc(sc.class)} spells" data-filter="${esc(sc.slug)}" value="${esc((S.filters || {})[sc.slug] || '')}" style="width:100%">
      ${all.length ? '' : '<p class="note">No spell list for this class. Spells you add to your Library that name this class will show here.</p>'}
      ${Object.keys(byLevel).sort((a, b) => a - b).map((lvl) => `<div class="spell-level" data-spell-group="${esc(sc.slug)}">
        <h4>${lvl === '0' ? 'Cantrips' : ord(+lvl) + ' level'}</h4>
        ${byLevel[lvl].map((s) => {
          const on = mine.some((m) => m.class === sc.slug && (m.id === s.id || (m.name || '').toLowerCase() === s.name.toLowerCase()));
          return `<div class="spell-row ${on ? 'picked' : ''}" data-spell-name="${esc(s.name.toLowerCase())}">
            <input type="checkbox" data-act="spell-toggle" data-id="${s.id}" data-name="${esc(s.name)}" data-level="${s.level ?? 0}" data-class="${esc(sc.slug)}" ${on ? 'checked' : ''} aria-label="${esc(s.name)}">
            <span class="name" data-act="show-entry" data-id="${s.id}">${esc(s.name)} ${sourceTag(s)}${s.ritual ? ' <span class="tag">ritual</span>' : ''}</span>
            <span class="muted small">${esc(s.school || '')}</span><span class="muted small">${esc(s.casting_time || '')}</span></div>`;
        }).join('')}</div>`).join('')}`;
  }
  if ((sh.granted_spells || []).length) {
    html += `<div class="note"><b>Always prepared from your subclass:</b> ${sh.granted_spells.map((g) => esc(g.name)).join(', ')}
      <div style="margin-top:6px"><button class="btn" data-act="add-granted">Add them</button></div></div>`;
  }
  html += `</div><div class="panel"><h3>Your spells</h3>
    ${mine.length ? `<table class="list"><thead><tr><th>Spell</th><th>Level</th><th>Class</th><th>Prepared</th><th>Always prepared</th><th></th></tr></thead><tbody>
      ${mine.map((s, i) => `<tr><td><a href="#" data-act="show-entry" data-id="${s.id}">${esc(s.name)}</a></td><td>${s.level ? ord(s.level) : 'cantrip'}</td>
        <td>${esc(s.class || '–')}</td>
        <td><input type="checkbox" data-change="spell-flag" data-flag="prepared" data-i="${i}" ${s.prepared !== false ? 'checked' : ''} aria-label="Prepared"></td>
        <td><input type="checkbox" data-change="spell-flag" data-flag="always" data-i="${i}" ${s.always ? 'checked' : ''} aria-label="Always prepared"></td>
        <td style="text-align:right"><button class="btn quiet danger" data-act="remove-spell" data-i="${i}">Remove</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No spells picked yet.</p>'}
    <h4>Add a spell from any list</h4>
    <p class="hint">For spells granted by a subclass, feat or species trait (domain spells, Magic Initiate and so on).</p>
    <div class="row"><input type="search" id="any-spell-q" placeholder="Search all spells" class="grow">
      <button class="btn" data-act="any-spell-search">Search</button></div>
    <div id="any-spell-results"></div></div>`;
  return html;
};

STEP_RENDER.equipment = async () => {
  const c = S.char;
  const srd = S.srd || { armor: {}, weapons: {} };
  const armorOpts = Object.entries(srd.armor).map(([n, a]) => `<option value="${esc(n)}" ${c.armor === n ? 'selected' : ''}>${esc(n)} (${a.category}, AC ${a.base}${a.category === 'light' ? ' + Dex' : a.category === 'medium' ? ' + Dex, max 2' : ''})</option>`).join('');
  const weapons = Object.entries(srd.weapons);
  const wgroup = (cat) => weapons.filter(([, w]) => w.category === cat).map(([n, w]) =>
    `<label class="check"><input type="checkbox" data-act="weapon" data-weapon="${esc(n)}" ${(c.weapons || []).includes(n) ? 'checked' : ''}>${esc(n)} <span class="muted small">${esc(w.damage)}</span></label>`).join('');
  const levels = [];
  (c.classes || []).forEach((cl, ci) => { for (let l = 0; l < (cl.level || 1); l++) if (!(ci === 0 && l === 0)) levels.push(cl.name || 'class'); });
  const rolls = c.hp_rolls || [];
  return `<div class="panel"><h2>Equipment</h2>
    <div class="grid2"><label class="field"><span>Armor</span><select data-bind="armor"><option value="">No armor</option>${armorOpts}</select></label>
      <label class="check" style="margin-top:22px"><input type="checkbox" data-bind="shield" ${c.shield ? 'checked' : ''}>Carrying a shield (+2 AC)</label></div>
    <h3>Weapons</h3><h4>Simple</h4><div class="weapon-grid">${wgroup('simple')}</div>
    <h4>Martial</h4><div class="weapon-grid">${wgroup('martial')}</div>
    <label class="field" style="margin-top:14px"><span>Other gear</span><textarea rows="4" data-bind="equipment">${esc(c.equipment || '')}</textarea></label>
    <div class="row">${['pp', 'gp', 'ep', 'sp', 'cp'].map((k) => `<label class="field" style="margin:0"><span>${k}</span><input type="number" min="0" data-bind="coins.${k}" value="${(c.coins || {})[k] || 0}" style="width:90px"></label>`).join('')}</div>
  </div>
  <div class="panel"><h2>Hit points</h2>
    <div class="row" style="margin-bottom:10px">
      <label class="check"><input type="radio" name="hpm" value="average" data-change="hp-mode" ${c.hp_mode !== 'rolled' ? 'checked' : ''}>Take the average each level</label>
      <label class="check"><input type="radio" name="hpm" value="rolled" data-change="hp-mode" ${c.hp_mode === 'rolled' ? 'checked' : ''}>Enter my rolls</label></div>
    ${c.hp_mode === 'rolled' ? `<p class="hint">First level always gets the full hit die. Enter what you rolled for each later level (before your Constitution modifier).</p>
      <div class="row">${levels.map((n, i) => `<label class="field" style="margin:0"><span>Level ${i + 2} (${esc(n)})</span>
        <input type="number" min="1" max="12" data-change="hp-roll" data-i="${i}" value="${rolls[i] || ''}"></label>`).join('') || '<span class="muted">Only one level so far.</span>'}</div>` : ''}
    <div class="grid3" style="margin-top:12px">
      <label class="field"><span>Extra max HP</span><input type="number" data-bind="hp_bonus" value="${c.hp_bonus || 0}"></label>
      <label class="field"><span>Extra AC (magic items)</span><input type="number" data-bind="ac_bonus" value="${c.ac_bonus || 0}"></label>
      <label class="field"><span>Speed override (ft)</span><input type="number" data-bind="speed_override" value="${c.speed_override || ''}"></label></div>
    <p>Maximum hit points: <b data-out="hp_max"></b> (hit dice <span data-out="hit_dice"></span>)</p></div>`;
};

STEP_RENDER.story = async () => {
  const c = S.char;
  const p = c.personality || {};
  const field = (key, label, rows = 2) => `<label class="field"><span>${label}</span><textarea rows="${rows}" data-bind="personality.${key}">${esc(p[key] || '')}</textarea></label>`;
  return `<div class="panel"><h2>Personality &amp; story</h2>
    <div class="grid2">${field('personality_traits', 'Personality traits')}${field('ideals', 'Ideals')}${field('bonds', 'Bonds')}${field('flaws', 'Flaws')}</div>
    <label class="field"><span>Appearance</span><textarea rows="2" data-bind="appearance">${esc(c.appearance || '')}</textarea></label>
    <label class="field"><span>Backstory</span><textarea rows="6" data-bind="backstory">${esc(c.backstory || '')}</textarea></label>
    <label class="field"><span>Notes</span><textarea rows="3" data-bind="notes">${esc(c.notes || '')}</textarea></label></div>
  <div class="panel"><h2>Extra features</h2>
    <p class="hint">Anything the builder doesn’t know about: a magic item, a boon from your DM, a homebrew trait. These print with your other features.</p>
    ${(c.extra_features || []).map((f, i) => `<div class="row top-align" style="border-bottom:1px solid var(--grid);padding:8px 0">
      <label class="field" style="width:220px"><span>Name</span><input type="text" data-bind="extra_features.${i}.name" value="${esc(f.name)}"></label>
      <label class="field grow"><span>Description</span><textarea rows="2" data-bind="extra_features.${i}.text">${esc(f.text)}</textarea></label>
      <button class="btn quiet danger" style="align-self:center" data-act="remove-extra" data-i="${i}">Remove</button></div>`).join('')}
    <button class="btn" data-act="add-extra" style="margin-top:10px">Add a feature</button></div>`;
};

STEP_RENDER.sheet = async () => {
  const c = S.char, sh = S.sheet;
  if (!sh) return '<p class="loading">Working out the numbers…</p>';
  const line = [sh.class_line, c.race && (c.race.subrace || c.race.name), c.background && c.background.name, c.alignment].filter(Boolean).join(', ');
  const spells = Object.entries(sh.spells);
  return `<div class="row no-print" style="margin-bottom:14px">
      <button class="btn primary" data-act="print">Print or save as PDF</button>
      <button class="btn" data-act="export-json">Export character file</button></div>
    <article class="sheet">
      <header><h1>${esc(c.name || 'Unnamed hero')}</h1><div class="muted">${esc(line)}${c.player ? `. Played by ${esc(c.player)}` : ''}</div></header>
      <div class="scores">${ABILITIES.map((a) => `<div class="score"><div class="ab">${AB_NAME[a]}</div><div class="mod">${signed(sh.mods[a])}</div><div class="val">${sh.scores[a]}</div></div>`).join('')}</div>
      <div class="combat">
        <div><b>${sh.ac}</b><span>Armor class${sh.ac_note ? ` (${esc(sh.ac_note)})` : ''}</span></div>
        <div><b>${signed(sh.initiative)}</b><span>Initiative</span></div><div><b>${sh.speed}</b><span>Speed (ft)</span></div>
        <div><b>${sh.hp_max}</b><span>Hit points</span></div><div><b>${esc(sh.hit_dice || '–')}</b><span>Hit dice</span></div>
        <div><b>${signed(sh.prof)}</b><span>Proficiency</span></div><div><b>${sh.passive_perception}</b><span>Passive perception</span></div></div>
      <div class="sheet-cols">
        <div><h3>Saving throws</h3>${ABILITIES.map((a) => `<div class="kv"><span><span class="dot ${sh.saves[a].prof ? 'on' : ''}"></span>${AB_NAME[a]}</span><b>${signed(sh.saves[a].bonus)}</b></div>`).join('')}
          <h3>Skills</h3>${sh.skills.map((s) => `<div class="kv"><span><span class="dot ${s.prof === 'expertise' ? 'exp' : s.prof === 'proficient' ? 'on' : s.prof === 'half' ? 'half' : ''}"></span>${esc(s.name)} <span class="muted small">${s.ability.toUpperCase()}</span></span><b>${signed(s.bonus)}</b></div>`).join('')}
          <p class="small muted" style="margin-top:8px">Passive Investigation ${sh.passive_investigation}, Insight ${sh.passive_insight}${sh.darkvision ? `. Darkvision ${sh.darkvision} ft` : ''}${sh.size ? `. Size: ${esc(sh.size)}` : ''}</p></div>
        <div><h3>Attacks</h3>${sh.attacks.length ? `<table class="list"><thead><tr><th>Weapon</th><th>Hit</th><th>Damage</th><th>Properties</th></tr></thead><tbody>
            ${sh.attacks.map((a) => `<tr><td>${esc(a.name)}</td><td class="num">${signed(a.bonus)}</td><td>${esc(a.damage)}</td><td class="small muted">${esc(a.properties)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No weapons chosen.</p>'}
          ${sh.spellcasting.length ? `<h3>Spellcasting</h3>${sh.spellcasting.map((s) => `<p>${esc(s.class)}: ${AB_NAME[s.ability]}, save DC <b>${s.dc}</b>, spell attack <b>${signed(s.attack)}</b>${s.prepared_count != null ? `, prepares ${s.prepared_count}` : ''}</p>`).join('')}
            <p class="small">${sh.slots.map((n, i) => (n ? `${ord(i + 1)}-level slots: ${n}` : '')).filter(Boolean).join('; ')}${sh.pact ? `${sh.slots.some((n) => n) ? '; ' : ''}Pact slots: ${sh.pact.count} × ${ord(sh.pact.level)} level` : ''}</p>
            ${spells.map(([lvl, rows]) => `<h4>${lvl === '0' ? 'Cantrips' : ord(+lvl) + ' level'}</h4><table class="list"><tbody>${rows.map((s) => `<tr><td><a href="#" data-act="show-entry" data-id="${s.id}">${esc(s.name)}</a>${s.ritual ? ' <span class="tag">R</span>' : ''}${s.concentration ? ' <span class="tag">C</span>' : ''}</td><td class="small">${esc(s.casting_time)}</td><td class="small">${esc(s.range)}</td><td class="small muted">${esc(s.duration)}</td></tr>`).join('')}</tbody></table>`).join('')}` : ''}
          <h3>Proficiencies &amp; languages</h3><p>${sh.proficiencies.map(esc).join('<br>')}${sh.languages ? `<br>Languages: ${esc(sh.languages)}` : ''}</p>
          <h3>Equipment</h3><p>${esc([c.armor, c.shield ? 'Shield' : ''].concat((c.weapons || []).filter((w) => w !== 'Unarmed strike')).filter(Boolean).join(', '))}${c.equipment ? '<br>' + esc(c.equipment).replace(/\n/g, '<br>') : ''}</p>
          <h3>Features &amp; traits</h3>${sh.features.map((f) => `<details class="feature"><summary>${esc(f.name)}<span>${esc(f.source || '')}</span></summary><div class="prose">${prose(f.text) || '<p class="muted">No description stored.</p>'}</div></details>`).join('')}
          ${(c.personality && Object.values(c.personality).some(Boolean)) || c.backstory ? `<h3>Personality</h3>${[['personality_traits', 'Traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws']].filter(([k]) => c.personality[k]).map(([k, l]) => `<p><b>${l}.</b> ${esc(c.personality[k])}</p>`).join('')}${c.backstory ? `<h4>Backstory</h4><div class="prose">${prose(c.backstory)}</div>` : ''}` : ''}
        </div></div></article>`;
};

/* ================================================================ entry display (library + popups) */
function renderEntry(e) {
  const d = e.data || {};
  const link = e.source === 'srd' ? 'From the System Reference Document 5.1 (CC-BY-4.0).' : e.source === 'wiki' ? `<a href="https://dnd5e.wikidot.com${esc(e.path)}" target="_blank" rel="noopener">View on the wiki</a>` : esc(e.source.replace(/^pdf:/, 'From your PDF: ') + (e.path && e.path.startsWith('p.') ? `, page ${e.path.slice(2)}` : ''));
  let body = '';
  if (e.kind === 'spell') {
    const lvl = d.level === 0 ? `${d.school || ''} cantrip` : d.level ? `${ord(d.level)}-level ${(d.school || '').toLowerCase()}` : '';
    body = `<p><i>${esc(lvl)}${d.ritual ? ' (ritual)' : ''}</i></p>
      <dl class="entry-stats"><dt>Casting time</dt><dd>${esc(d.casting_time)}</dd><dt>Range</dt><dd>${esc(d.range)}</dd>
      <dt>Components</dt><dd>${esc(d.components)}</dd><dt>Duration</dt><dd>${esc(d.duration)}</dd>
      ${d.classes && d.classes.length ? `<dt>Spell lists</dt><dd>${esc(d.classes.join(', '))}</dd>` : ''}</dl>
      <div class="prose">${prose(d.description)}</div>${d.higher_levels ? `<p><b>At higher levels.</b> ${esc(d.higher_levels)}</p>` : ''}`;
  } else if (e.kind === 'race') {
    body = (d.variants || []).map((v) => `${(d.variants || []).length > 1 ? `<h3>${esc(v.source)}</h3>` : ''}${v.intro ? `<p><i>${esc(v.intro)}</i></p>` : ''}
      ${(v.traits || []).map((t) => `<p class="trait"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('')}
      ${(v.subraces || []).map((s) => `<h4>${esc(s.name)}</h4>${(s.traits || []).map((t) => `<p class="trait"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('')}`).join('')}`).join('');
  } else if (e.kind === 'class') {
    const r = e.rules || {};
    body = `<dl class="entry-stats"><dt>Hit die</dt><dd>d${r.hit_die || '?'}</dd><dt>Saves</dt><dd>${(r.saves || []).map((s) => AB_NAME[s]).join(', ')}</dd>
      <dt>Armor</dt><dd>${esc(d.armor || (r.armor || []).join(', ') || 'none')}</dd><dt>Weapons</dt><dd>${esc(d.weapons || (r.weapons || []).join(', '))}</dd></dl>
      ${(d.features || []).map((f) => `<details class="feature"><summary>${esc(f.name)}<span>${f.level ? 'level ' + f.level : ''}</span></summary><div class="prose">${prose(f.text)}</div></details>`).join('')}`;
  } else if (e.kind === 'subclass') {
    body = `${d.intro ? `<div class="prose">${prose(d.intro)}</div>` : ''}${(d.features || []).map((f) => `<details class="feature" open><summary>${esc(f.name)}<span>${f.level ? 'level ' + f.level : ''}</span></summary><div class="prose">${prose(f.text)}</div></details>`).join('')}`;
  } else if (e.kind === 'background') {
    body = `<dl class="entry-stats"><dt>Skills</dt><dd>${esc((d.skills || []).join(', '))}</dd><dt>Tools</dt><dd>${esc(d.tools || '–')}</dd>
      <dt>Languages</dt><dd>${esc(d.languages || '–')}</dd><dt>Equipment</dt><dd>${esc(d.equipment || '–')}</dd></dl>
      ${d.feature && d.feature.name ? `<h4>Feature: ${esc(d.feature.name)}</h4><div class="prose">${prose(d.feature.text)}</div>` : ''}`;
  } else if (e.kind === 'feat') {
    body = `${d.prerequisite ? `<p><i>Prerequisite: ${esc(d.prerequisite)}</i></p>` : ''}<div class="prose">${prose(d.text)}</div>`;
  } else if (e.kind === 'spell-list') {
    body = `<p>${(d.spells || []).length} spells. Open the Spells step of a character to pick from this list.</p>`;
  } else {
    body = `<div class="prose">${prose(d.text || d.description || '')}</div>`;
  }
  return `<h2>${esc(e.name)}</h2><p class="hint">${esc(KIND_LABEL[e.kind] || e.kind)}${d.source ? `, ${esc(d.source)}` : ''}. ${link} ${sourceTag(e)}</p>${body}
    <div class="row" style="margin-top:14px">${e.source === 'srd' || e.source === 'wiki' ? '' : `<button class="btn quiet danger" data-act="delete-entry" data-id="${e.id}">Delete from library</button>`}</div>`;
}

async function showEntryModal(id) {
  if (!id || id === 'undefined' || id === 'null') { toast('This item isn’t linked to a library entry.'); return; }
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><button class="btn quiet close" data-act="close-modal" aria-label="Close">Close</button><div class="loading">Loading…</div></div>`;
  document.body.append(back);
  back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
  try {
    const e = await detail(id);
    back.querySelector('.modal').innerHTML = `<button class="btn quiet close" data-act="close-modal" aria-label="Close">Close</button>${renderEntry(e)}`;
  } catch (err) { back.querySelector('.loading').textContent = err.message; }
}

/* ================================================================ library view */
async function renderLibrary() {
  const status = await api('/api/status');
  S.status = status;
  const k = status.library.kinds;
  const count = (kind) => Object.values(k[kind] || {}).reduce((a, b) => a + b, 0);
  $('#main').innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:12px">
      <h1>Library</h1>
      <span class="hint">${count('race')} species, ${count('class')} classes, ${count('subclass')} subclasses, ${count('background')} backgrounds, ${count('feat')} feats, ${count('spell')} spells</span></div>
    <div class="two-pane"><div class="panel">
      <div class="row" style="margin-bottom:10px"><input type="search" id="lib-q" placeholder="Search names and text" class="grow">
        <select id="lib-kind"><option value="">Everything</option>${Object.entries(KIND_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <div class="results" id="lib-results"><p class="hint">Search, or pick a type to list everything of that kind.</p></div>
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer">Add your own entry</summary>
        <div style="margin-top:8px"><div class="row"><select id="own-kind">${['feat', 'spell', 'background', 'item', 'other'].map((v) => `<option value="${v}">${KIND_LABEL[v]}</option>`).join('')}</select>
          <input type="text" id="own-name" placeholder="Name" class="grow"></div>
          <textarea id="own-text" rows="4" placeholder="Rules text" style="margin-top:8px"></textarea>
          <button class="btn" data-act="add-own" style="margin-top:6px">Save to library</button></div></details>
    </div><div class="panel" id="lib-detail"><p class="hint">Pick an entry to read it.</p></div></div>`;
  let t;
  const run = () => { clearTimeout(t); t = setTimeout(libSearch, 250); };
  $('#lib-q').addEventListener('input', run);
  $('#lib-kind').addEventListener('change', run);
}
async function libSearch() {
  const q = $('#lib-q').value.trim(), kind = $('#lib-kind').value;
  const box = $('#lib-results');
  if (!q && !kind) { box.innerHTML = '<p class="hint">Search, or pick a type to list everything of that kind.</p>'; return; }
  const params = new URLSearchParams({ q, kind, limit: 400 });
  try {
    const { entries } = await api(`/api/entries?${params}`);
    box.innerHTML = entries.length ? entries.map((e) => `<div class="result" data-act="lib-pick" data-id="${e.id}" role="button" tabindex="0">
      <span>${esc(e.name)} ${sourceTag(e)}</span><span class="kind">${esc(KIND_LABEL[e.kind] || e.kind)}${e.parent ? ', ' + esc(e.parent) : ''}</span></div>`).join('')
      : '<p class="hint">Nothing matches.</p>';
  } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
}

/* ================================================================ PDFs view */
async function renderPdfs() {
  const [{ pdfs }, status] = await Promise.all([api('/api/pdfs'), api('/api/status')]);
  S.status = status;
  const keySet = status.config.api_key_set;
  $('#main').innerHTML = `<h1>Your PDFs</h1>
    <p class="hint">Add sourcebooks, supplements or homebrew you own. They stay on this device and their text becomes searchable; Claude can pull spells, species, feats, backgrounds, classes and subclasses out of chosen pages so they appear in the builder next to the built-in ones.</p>
    <label class="drop" id="drop"><input type="file" accept=".pdf" multiple id="pdf-file">
      <b>Drop PDFs here</b> or tap to choose files</label>
    <div id="upload-out"></div>
    ${pdfs.length ? `<div class="panel" style="margin-top:16px"><table class="list"><thead><tr><th>Book</th><th>Pages</th><th>Entries pulled</th><th></th></tr></thead><tbody>
      ${pdfs.map((p) => `<tr><td><a href="#" data-act="open-pdf" data-id="${p.id}">${esc(p.title)}</a><div class="small muted">${esc(p.filename)}</div>
        ${p.scanned ? '<div class="small" style="color:var(--warn)">Little or no text found: this looks like a scanned book. Run it through OCR first (for example, “Make searchable” in a PDF editor).</div>' : ''}</td>
        <td class="num">${p.pages}</td><td class="num">${p.entries}</td>
        <td style="text-align:right"><button class="btn quiet danger" data-act="del-pdf" data-id="${p.id}">Remove</button></td></tr>`).join('')}</tbody></table></div>

    <div class="two-pane" style="margin-top:16px">
      <div class="panel"><h3>Search your books</h3>
        <div class="row"><input type="search" id="pdf-q" placeholder="e.g. hexblade curse" class="grow"><button class="btn" data-act="pdf-search">Search</button></div>
        <div id="pdf-results" style="margin-top:10px"></div></div>
      <div class="panel"><h3>Pull entries with Claude</h3>
        <p class="hint">Pick a book and a page range (30 pages or fewer works best), say what’s on those pages, and review what Claude finds before saving it.</p>
        <div class="grid2">
          <label class="field"><span>Book</span><select id="ex-pdf">${pdfs.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select></label>
          <label class="field"><span>What’s on the pages</span><select id="ex-kind">
            ${[['spell', 'Spells'], ['race', 'Species'], ['subclass', 'Subclasses'], ['class', 'A whole class'], ['feat', 'Feats'], ['background', 'Backgrounds'], ['item', 'Magic items'], ['other', 'Other rules']].map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></label>
          <label class="field"><span>From page</span><input type="number" id="ex-start" min="1" value="1"></label>
          <label class="field"><span>To page</span><input type="number" id="ex-end" min="1" value="5"></label></div>
        <div class="row"><button class="btn" data-act="preview-pages">Preview page text</button>
          ${keySet ? '<button class="btn primary" data-act="extract">Pull entries</button><button class="btn quiet" data-act="chat-extract-start">Use a Claude chat instead</button>'
            : '<button class="btn primary" data-act="chat-extract-start">Copy prompt for Claude</button>'}</div>
        ${keySet ? '' : '<p class="hint small" style="margin-top:8px">Without an API key, you paste the prompt into a Claude chat and paste the reply back here. Around 15 pages at a time pastes comfortably.</p>'}
        <div id="extract-out" style="margin-top:12px"></div></div></div>` : ''}`;
  const drop = $('#drop'), input = $('#pdf-file');
  input.addEventListener('change', () => uploadPdfs(input.files));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadPdfs(e.dataTransfer.files); });
  const q = $('#pdf-q');
  if (q) q.addEventListener('keydown', (e) => { if (e.key === 'Enter') ACTIONS['pdf-search'](); });
}
async function uploadPdfs(files) {
  if (!files || !files.length) return;
  const out = $('#upload-out');
  out.innerHTML = `<p class="loading">Reading ${files.length} PDF${files.length > 1 ? 's' : ''}… large books take a minute.</p>`;
  try {
    const { results } = await api('/api/pdfs', { files: [...files] });
    const bad = results.filter((r) => r.error);
    toast(`Added ${results.length - bad.length} PDF${results.length - bad.length === 1 ? '' : 's'}.`);
    await renderPdfs();
    if (bad.length) $('#upload-out').innerHTML = bad.map((b) => `<div class="note warn">${esc(b.filename)}: ${esc(b.error)}</div>`).join('');
  } catch (e) { out.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
}
function renderExtract() {
  const box = $('#extract-out');
  const ex = S.extract;
  if (!box || !ex) return;
  box.innerHTML = `${ex.notes ? `<p class="note">${esc(ex.notes)}</p>` : ''}
    ${ex.entries.length ? `<p>${ex.entries.length} found. Untick anything you don’t want, then save.</p>
      ${ex.entries.map((e, i) => `<div style="border-bottom:1px solid var(--grid);padding:6px 0"><label class="check"><input type="checkbox" data-ex="${i}" checked>
        <b>${esc(e.name)}</b> <span class="muted small">${esc(KIND_LABEL[e.kind])}${e.parent ? ' for ' + esc(e.parent) : ''}, ${esc(e.path.replace('p.', 'page '))}</span></label>
        <details><summary class="small" style="cursor:pointer">Preview</summary>${renderEntry({ ...e, id: '', tags: [] }).replace(/<div class="row" style="margin-top:14px">[\s\S]*$/, '')}</details></div>`).join('')}
      <button class="btn primary" data-act="save-extract" style="margin-top:10px">Save to library</button>` : '<p>Nothing found on those pages. Check the page range with Preview page text.</p>'}`;
}

/* ================================================================ settings view */
async function renderSettings() {
  const status = await api('/api/status');
  S.status = status;
  let persisted = null;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* unknown */ }
  const c = status.config;
  $('#main').innerHTML = `<h1>Settings</h1>
  <div class="panel" style="margin-bottom:16px"><h2>Claude</h2>
    <p class="hint">Optional. Without a key, drafting characters and pulling entries from PDFs work by copying prompts into a Claude chat and pasting the replies back. With a key from the Claude Console (platform.claude.com, under Settings, API keys), the app does it in one tap; calls are billed to that account, usually a few cents per character.</p>
    <div class="grid2"><label class="field"><span>Anthropic API key ${c.api_key_set ? `<span class="muted">(saved, ends ${esc(c.api_key_hint)})</span>` : ''}</span>
      <input type="password" id="api-key" placeholder="${c.api_key_set ? 'Paste a new key to replace it' : 'sk-ant-…'}" autocomplete="off"></label>
      <label class="field"><span>Model</span><select id="model">${c.models.map((m) => `<option ${m === c.model ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
    <div class="row"><button class="btn primary" data-act="save-claude">Save</button>${c.api_key_set ? '<button class="btn quiet danger" data-act="clear-key">Remove saved key</button>' : ''}</div>
    <p class="hint small" style="margin-top:8px">The key is saved on this device only and sent only to Anthropic. Anyone who can open the app on this device can use it, so remove it before lending the device out.</p></div>
  <div class="panel" style="margin-bottom:16px"><h2>Library from your PC</h2>
    <p class="hint">The built-in library is the free SRD content. To use everything from your PC app’s library (wiki pages, PDFs, your own entries), open DND Char Builder on the PC, go to Library, download all wiki pages, then export the library and open that file here. It stays on this device and is for your own use; don’t share it.</p>
    ${status.library.imported ? `<p class="note good">${status.library.imported} entries imported from your PC. Where an imported entry has the same name as an SRD one, the imported one is used.</p>` : ''}
    <div class="row"><label class="btn primary" style="cursor:pointer">Import library<input type="file" accept=".json,application/json" id="import-lib" hidden></label>
      ${status.library.imported ? '<button class="btn quiet danger" data-act="clear-imported">Remove imported entries</button>' : ''}</div></div>
  <div class="panel" style="margin-bottom:16px"><h2>Your data</h2>
    <p class="hint">Characters and entries you add are saved on this device only. Back them up to keep them safe or to move them to another device.</p>
    ${persisted === false ? '<p class="note">This browser may clear saved data if the device runs low on space. Installing the app (Add to Home screen) or making regular backups keeps your characters safe.</p>' : ''}
    <div class="row"><button class="btn primary" data-act="backup">Back up everything</button>
      <label class="btn" style="cursor:pointer">Restore a backup<input type="file" accept=".json,application/json" id="restore-file" hidden></label></div>
    <p class="hint small" style="margin-top:8px">Restoring adds the backup’s characters and entries next to what’s already here; nothing is overwritten.</p></div>
  <div class="panel"><h2>About</h2>
    <p>Character Forge builds characters for the world’s most popular fantasy tabletop roleplaying game, 5th edition (2014 rules). It works offline once loaded.</p>
    <p class="hint small">This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at
      <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noopener">dnd.wizards.com/resources/systems-reference-document</a>.
      The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at
      <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">creativecommons.org/licenses/by/4.0/legalcode</a>.</p>
    <p class="hint small">Character Forge is unofficial and not affiliated with or endorsed by Wizards of the Coast.</p></div>`;
  $('#import-lib').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    toast('Importing…');
    try {
      const r = await api('/api/library/import', { json: JSON.parse(await f.text()) });
      S.lists = {}; S.details = {};
      toast(`Imported ${r.added + r.updated} entries${r.updated ? ` (${r.updated} updated)` : ''}.`);
      renderSettings();
    } catch (err) { toast('Couldn’t import: ' + (err instanceof SyntaxError ? 'that isn’t a library file.' : err.message), 'error'); }
    e.target.value = '';
  });
  $('#restore-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const doc = JSON.parse(await f.text());
      if (doc.app !== 'character-forge') throw new Error('That file isn’t a Character Forge backup.');
      const idMap = {};
      for (const en of doc.entries || []) {
        const { id: oldId } = en;
        const { id } = await api('/api/entries', { json: { kind: en.kind, name: en.name, source: en.source, path: en.path, parent: en.parent, group: en.group, tags: en.tags, data: en.data } });
        idMap[oldId] = id;
      }
      const remap = (o) => { if (o && idMap[o.id]) o.id = idMap[o.id]; };
      for (const ch of doc.characters || []) {
        remap(ch.race); remap(ch.background);
        (ch.classes || []).forEach((c) => { remap(c); remap(c.subclass); });
        (ch.feats || []).forEach(remap); (ch.spells || []).forEach(remap);
        await api('/api/characters', { json: { character: ch } });
      }
      S.lists = {}; S.details = {};
      toast(`Restored ${(doc.characters || []).length} characters and ${(doc.entries || []).length} entries.`);
    } catch (err) { toast('Couldn’t restore: ' + err.message, 'error'); }
    e.target.value = '';
  });
}

/* ================================================================ copy-and-paste with a Claude chat */
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall back below */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

function chatBox(job, copied) {
  const isDraft = job.kind === 'draft';
  const title = isDraft ? `Step ${job.stage} of 2` : 'Pull entries with a Claude chat';
  const where = isDraft && job.stage === 2 ? 'into the same Claude chat' : 'into a new Claude chat';
  const status = copied === false ? 'Copy the prompt below' : 'The prompt is copied. Paste it';
  return `<div class="panel" data-chat="${isDraft ? 'draft' : 'extract'}" style="margin-top:14px;border-color:var(--pen)">
    <h3>${title}</h3>
    <p>${status} ${where} and send it. When Claude answers, copy its whole reply and paste it below.</p>
    <div class="row" style="margin-bottom:10px">
      <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Open a new Claude chat</a>
      <button class="btn" data-act="chat-copy">Copy the prompt again</button>
      <button class="btn quiet" data-act="chat-cancel">Cancel</button></div>
    <details ${copied === false ? 'open' : ''}><summary class="small" style="cursor:pointer">See the prompt</summary>
      <textarea readonly rows="6" style="margin-top:6px;font-size:13px">${esc(job.prompt)}</textarea></details>
    <label class="field" style="margin-top:10px"><span>Claude’s reply</span>
      <textarea class="chat-reply" rows="6" placeholder="Paste the reply here. It should start with {"></textarea></label>
    <button class="btn primary" data-act="chat-reply">Use this reply</button></div>`;
}

async function useDraft(res) {
  S.char = { ...res.character, concept: S.char.concept };
  S.raceSel = null;
  await saveNow();
  await computeNow();
  const out = $('#draft-result');
  if (out) {
    out.innerHTML = `<div class="note good">Drafted ${esc(S.char.name)}. Look through each step to adjust anything.</div>
      ${res.notes ? `<div class="prose">${prose(res.notes)}</div>` : ''}
      ${res.warnings.length ? `<div class="note warn">${res.warnings.map(esc).join('<br>')}</div>` : ''}
      <button class="btn primary" data-act="step" data-step="sheet">See the sheet</button>`;
  }
  renderSteps();
}

/* ================================================================ actions */
const ACTIONS = {
  go: (t, e) => { e.preventDefault(); go(t.dataset.view); },
  step: (t) => { S.step = t.dataset.step; saveNow(); renderStep(); window.scrollTo(0, 0); },
  'new-char': async (t) => busy(t, 'Creating…', async () => {
    const { character } = await api('/api/characters/new');
    const { id } = await api('/api/characters', { json: { character } });
    await openChar(id, 'concept');
  }),
  'open-char': (t, e) => { if (e.target.closest('[data-act="del-char"]')) return; openChar(+t.dataset.id); },
  'del-char': async (t, e) => {
    e.stopPropagation();
    if (!confirm('Delete this character? This can’t be undone.')) return;
    await api(`/api/characters/${t.dataset.id}`, { method: 'DELETE' });
    renderCharacters();
  },
  'add-class': () => { S.char.classes.push({ id: null, name: '', slug: '', level: 1, subclass: null }); renderStep(); },
  'remove-class': (t) => { S.char.classes.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'bg-gear': async () => {
    const d = await detail(S.char.background.id);
    S.char.equipment = [S.char.equipment, d.data.equipment].filter(Boolean).join('\n');
    changed(); toast('Added to Other gear on the Equipment step.');
  },
  roll: () => {
    const rolls = ABILITIES.map(() => { const d = [1, 2, 3, 4].map(() => 1 + Math.floor(Math.random() * 6)).sort((a, b) => a - b); return { d, total: d[1] + d[2] + d[3] }; });
    ABILITIES.forEach((a, i) => { S.char.base_scores[a] = rolls[i].total; });
    changed();
    renderStep().then(() => { const o = $('#roll-out'); if (o) o.textContent = 'Rolled ' + rolls.map((r) => `${r.total} [${r.d.join(' ')}]`).join(', ') + '. Swap scores around by typing in the boxes.'; });
  },
  skill: (t) => {
    const name = t.dataset.skillName, set = new Set(S.char.skills || []);
    t.checked ? set.add(name) : set.delete(name);
    S.char.skills = [...set]; changed();
  },
  expertise: (t) => {
    const name = t.dataset.skillName, set = new Set(S.char.expertise || []);
    t.checked ? set.add(name) : set.delete(name);
    S.char.expertise = [...set]; changed();
  },
  'add-feat': async () => {
    const id = $('#feat-pick').value;
    if (!id) return;
    const d = await detail(id);
    const opts = d.data.asi_options || [];
    S.char.feats = S.char.feats || [];
    S.char.feats.push({ id: d.id, name: d.name, from: 'asi', ...(opts.length ? { asi: opts[0], asi_amount: d.data.asi_amount } : {}) });
    changed(); renderStep();
  },
  'remove-feat': (t) => { S.char.feats.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'spell-toggle': (t) => {
    const { id, name, level, class: cls } = t.dataset;
    S.char.spells = S.char.spells || [];
    const idx = S.char.spells.findIndex((s) => s.class === cls && (String(s.id) === id || (s.name || '').toLowerCase() === name.toLowerCase()));
    if (t.checked && idx < 0) S.char.spells.push({ id: +id, name, level: +level, class: cls, prepared: true });
    if (!t.checked && idx >= 0) S.char.spells.splice(idx, 1);
    t.closest('.spell-row').classList.toggle('picked', t.checked);
    changed();
    clearTimeout(S.spellRender);
    S.spellRender = setTimeout(renderStep, 400);
  },
  'remove-spell': (t) => { S.char.spells.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'any-spell-search': async () => {
    const q = $('#any-spell-q').value.trim();
    const box = $('#any-spell-results');
    if (!q) return;
    const { entries } = await api(`/api/entries?kind=spell&all=1&q=${encodeURIComponent(q)}&limit=40`);
    const cls = (S.sheet.spellcasting[0] || {}).slug || '';
    box.innerHTML = entries.length ? entries.map((e) => `<div class="result"><span data-act="show-entry" data-id="${e.id}">${esc(e.name)} ${sourceTag(e)}</span>
      <button class="btn quiet" data-act="add-any-spell" data-id="${e.id}" data-name="${esc(e.name)}" data-class="${esc(cls)}">Add</button></div>`).join('')
      : '<p class="hint">No spell by that name in your library.</p>';
  },
  'add-granted': (t) => busy(t, 'Adding…', async () => {
    const missing = [];
    for (const g of S.sheet.granted_spells || []) {
      const { entries } = await api(`/api/entries?kind=spell&all=1&q=${encodeURIComponent(g.name)}&limit=20`);
      const hit = entries.find((e) => e.name.toLowerCase() === g.name.toLowerCase());
      if (!hit) { missing.push(g.name); continue; }
      const d = await detail(hit.id);
      S.char.spells.push({ id: d.id, name: d.name, level: d.data.level || 0, class: g.class, prepared: true, always: true });
    }
    if (missing.length) toast(`Couldn’t find ${missing.join(', ')} in the library; add them by hand from Library.`, 'error');
    changed(); await computeNow(); renderStep();
  }),
  'add-any-spell': async (t) => {
    const d = await detail(t.dataset.id);
    S.char.spells = S.char.spells || [];
    S.char.spells.push({ id: d.id, name: d.name, level: d.data.level || 0, class: t.dataset.class, prepared: true, always: true });
    toast(`Added ${d.name}.`);
    changed(); renderStep();
  },
  weapon: (t) => {
    const set = new Set(S.char.weapons || []);
    t.checked ? set.add(t.dataset.weapon) : set.delete(t.dataset.weapon);
    S.char.weapons = [...set]; changed();
  },
  'add-extra': () => { (S.char.extra_features = S.char.extra_features || []).push({ name: '', text: '' }); renderStep(); },
  'remove-extra': (t) => { S.char.extra_features.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'show-entry': (t, e) => { e.preventDefault(); showEntryModal(t.dataset.id); },
  'close-modal': (t) => t.closest('.modal-back').remove(),
  print: () => { $$('details').forEach((d) => { d.open = true; }); window.print(); },
  'lib-pick': async (t) => {
    $$('.result[aria-selected]').forEach((r) => r.removeAttribute('aria-selected'));
    t.setAttribute('aria-selected', 'true');
    const box = $('#lib-detail');
    box.innerHTML = '<p class="loading">Loading…</p>';
    try { box.innerHTML = renderEntry(await detail(t.dataset.id)); }
    catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
  },
  'delete-entry': async (t) => {
    if (!confirm('Delete this entry from your library?')) return;
    await api(`/api/entries/${t.dataset.id}`, { method: 'DELETE' });
    S.lists = {}; delete S.details[t.dataset.id];
    const m = t.closest('.modal-back');
    if (m) m.remove(); else { $('#lib-detail').innerHTML = '<p class="hint">Deleted.</p>'; libSearch(); }
  },
  'add-own': async () => {
    const name = $('#own-name').value.trim(), kind = $('#own-kind').value, text = $('#own-text').value.trim();
    if (!name) { toast('Give the entry a name.', 'error'); return; }
    const data = kind === 'spell' ? { description: text, level: 0, classes: [] } : { text };
    await api('/api/entries', { json: { kind, name, data, source: 'custom' } });
    S.lists = {};
    toast(`Saved ${name}.`);
    $('#own-name').value = ''; $('#own-text').value = '';
  },
  draft: (t) => busy(t, 'Claude is drafting… (about a minute)', async () => {
    if ((S.char.classes || []).some((c) => c.id) && !confirm('Replace this character’s current choices with a new draft?')) return;
    const level = +($('#draft-level').value || 1);
    const res = await api('/api/claude/draft', { json: { concept: S.char.concept || '', level } });
    await useDraft(res);
  }),
  'chat-draft-start': (t) => busy(t, 'Building the prompt…', async () => {
    if (!(S.char.concept || '').trim()) throw new Error('Describe the character first.');
    if ((S.char.classes || []).some((c) => c.id) && !confirm('Replace this character’s current choices with a new draft?')) return;
    const level = +($('#draft-level').value || 1);
    const { prompt } = await api('/api/claude/chat/draft-prompt', { json: { concept: S.char.concept, level } });
    S.chatDraft = { kind: 'draft', stage: 1, prompt };
    const copied = await copyText(prompt);
    $('#chat-draft').innerHTML = chatBox(S.chatDraft, copied);
  }),
  'chat-copy': async (t) => {
    const box = t.closest('[data-chat]');
    const job = box.dataset.chat === 'draft' ? S.chatDraft : S.chatExtract;
    const ok = await copyText(job.prompt);
    toast(ok ? 'Prompt copied.' : 'Couldn’t copy automatically; open “See the prompt” and copy it from there.', ok ? 'info' : 'error');
  },
  'chat-reply': (t) => busy(t, 'Reading the reply…', async () => {
    const box = t.closest('[data-chat]');
    const reply = $('.chat-reply', box).value;
    if (box.dataset.chat === 'extract') {
      const job = S.chatExtract;
      S.extract = await api(`/api/pdfs/${job.pdf}/extract/reply`, { json: { kind: job.kind, reply } });
      S.chatExtract = null;
      renderExtract();
      return;
    }
    const job = S.chatDraft;
    if (job.stage === 1) {
      const r = await api('/api/claude/chat/draft-reply-1', { json: { concept: S.char.concept, reply } });
      S.chatDraft = { kind: 'draft', stage: 2, prompt: r.prompt, character: r.character, warnings: r.warnings, summary: r.summary };
      const copied = await copyText(r.prompt);
      $('#chat-draft').innerHTML = chatBox(S.chatDraft, copied);
    } else {
      const res = await api('/api/claude/chat/draft-reply-2', { json: { character: job.character, reply, warnings: job.warnings, summary: job.summary } });
      S.chatDraft = null;
      $('#chat-draft').innerHTML = '';
      await useDraft(res);
    }
  }),
  'chat-cancel': (t) => {
    const box = t.closest('[data-chat]');
    if (box.dataset.chat === 'draft') S.chatDraft = null; else S.chatExtract = null;
    box.remove();
  },
  'chat-extract-start': (t) => busy(t, 'Building the prompt…', async () => {
    const body = { start: +$('#ex-start').value, end: +$('#ex-end').value, kind: $('#ex-kind').value };
    if (body.end < body.start) throw new Error('The last page comes before the first.');
    const pdf = $('#ex-pdf').value;
    const { prompt } = await api(`/api/pdfs/${pdf}/extract/prompt`, { json: body });
    S.chatExtract = { kind: body.kind, pdf, prompt };
    const copied = await copyText(prompt);
    $('#extract-out').innerHTML = chatBox(S.chatExtract, copied);
  }),
  'del-pdf': async (t) => {
    if (!confirm('Remove this PDF and the entries pulled from it?')) return;
    await api(`/api/pdfs/${t.dataset.id}`, { method: 'DELETE' });
    S.lists = {}; renderPdfs();
  },
  'pdf-search': async () => {
    const q = $('#pdf-q').value.trim();
    if (!q) return;
    const { results } = await api(`/api/pdfs/search?q=${encodeURIComponent(q)}`);
    $('#pdf-results').innerHTML = results.length ? results.map((r) => `<div style="border-bottom:1px solid var(--grid);padding:6px 0">
      <a href="#" data-act="open-pdf" data-id="${r.pdf_id}" data-page="${r.page}">${esc(r.title)}, page ${r.page}</a>
      <div class="small">${esc(r.snip).replace(/\[\[/g, '<mark>').replace(/\]\]/g, '</mark>')}</div></div>`).join('') : '<p class="hint">No matches.</p>';
  },
  'preview-pages': async () => {
    const id = $('#ex-pdf').value, s = $('#ex-start').value, e = $('#ex-end').value;
    const { text } = await api(`/api/pdfs/${id}/pages?start=${s}&end=${e}`);
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal"><button class="btn quiet close" data-act="close-modal">Close</button><h3>Pages ${s}–${e}</h3>
      <pre style="white-space:pre-wrap;font:13px/1.45 var(--sans)">${esc(text || 'No text on these pages.')}</pre></div>`;
    back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
    document.body.append(back);
  },
  extract: (t) => busy(t, 'Claude is reading… (up to a few minutes)', async () => {
    const body = { start: +$('#ex-start').value, end: +$('#ex-end').value, kind: $('#ex-kind').value };
    if (body.end < body.start) throw new Error('The last page comes before the first.');
    S.extract = await api(`/api/pdfs/${$('#ex-pdf').value}/extract`, { json: body });
    renderExtract();
  }),
  'save-extract': async (t) => busy(t, 'Saving…', async () => {
    const keep = $$('[data-ex]').filter((c) => c.checked).map((c) => S.extract.entries[+c.dataset.ex]);
    await api('/api/entries/bulk', { json: { entries: keep } });
    S.lists = {};
    toast(`Saved ${keep.length} entr${keep.length === 1 ? 'y' : 'ies'}. They now appear in the builder.`);
    S.extract = null;
    renderPdfs();
  }),
  'save-claude': (t) => busy(t, 'Saving…', async () => {
    await api('/api/settings', { json: { anthropic_api_key: $('#api-key').value, model: $('#model').value } });
    toast('Saved.'); renderSettings();
  }),
  'clear-imported': async () => {
    if (!confirm('Remove every entry imported from your PC? Characters that use them will show warnings until you import again.')) return;
    const { removed } = await api('/api/library/clear-imported', { method: 'POST' });
    S.lists = {}; S.details = {};
    toast(`Removed ${removed} entries.`); renderSettings();
  },
  'clear-key': async () => { await api('/api/settings', { json: { clear_api_key: true } }); renderSettings(); },
  'open-pdf': async (t, e) => {
    e.preventDefault();
    const win = window.open('', '_blank');  // open first, while the tap still counts as a user action (pop-up blockers)
    const { blob } = await api(`/api/pdfs/${t.dataset.id}/file`);
    const url = URL.createObjectURL(blob) + (t.dataset.page ? `#page=${t.dataset.page}` : '');
    if (win) win.location.href = url; else location.href = url;
  },
  'export-json': async () => {
    await saveNow();
    const { character } = await api(`/api/characters/${S.charId}/export`);
    await saveFile(`${fileName(character.name)}.json`, JSON.stringify(character, null, 2));
  },
  'backup': (t) => busy(t, 'Packing…', async () => {
    const { characters } = await api('/api/characters');
    const full = [];
    for (const c of characters) full.push((await api(`/api/characters/${c.id}`)).character);
    const mine = (await api('/api/entries?all=1')).entries.filter((e) => e.source !== 'srd');
    const entries = [];
    for (const e of mine) entries.push((await api(`/api/entries/${e.id}`)).entry);
    const stamp = new Date().toISOString().slice(0, 10);
    await saveFile(`Character Forge backup ${stamp}.json`, JSON.stringify({ app: 'character-forge', version: 1, characters: full, entries }, null, 2));
  }),
};

const CHANGES = {
  'pick-race': async (t) => {
    const id = +t.value;
    if (!id) { S.char.race = {}; changed(); renderStep(); return; }
    const d = await detail(id);
    const v = (d.selections || [])[0];
    S.char.race = { id, name: d.name, variant: v ? v.variant : null, subrace: null };
    S.raceSel = null;
    await applyRaceBonus();
    changed(); renderStep();
  },
  'race-variant': async (t) => { S.char.race.variant = t.value; S.char.race.subrace = null; S.raceSel = null; await applyRaceBonus(); changed(); renderStep(); },
  'race-subrace': async (t) => { S.char.race.subrace = t.value || null; S.raceSel = null; await applyRaceBonus(); changed(); renderStep(); },
  'pick-class': async (t) => {
    const i = +t.dataset.i, id = +t.value;
    if (!id) return;
    const sel = t;
    sel.disabled = true;
    try {
      const d = await detail(id);
      S.char.classes[i] = { id, name: d.name, slug: d.rules.slug, level: S.char.classes[i].level || 1, subclass: null };
      changed(); renderStep();
    } catch (e) { toast(e.message, 'error'); sel.disabled = false; }
  },
  'class-level': (t) => { S.char.classes[+t.dataset.i].level = Math.max(1, Math.min(20, +t.value || 1)); changed(); renderStep(); },
  'pick-subclass': async (t) => {
    const i = +t.dataset.i;
    if (!t.value) { S.char.classes[i].subclass = null; changed(); return; }
    const subs = (await api(`/api/classes/${encodeURIComponent(S.char.classes[i].slug)}/subclasses`)).entries;
    const e = subs.find((s) => String(s.id) === t.value);
    S.char.classes[i].subclass = { id: e.id, name: e.name, path: e.path };
    changed(); renderStep();
  },
  'pick-background': async (t) => {
    const id = +t.value;
    if (!id) { S.char.background = {}; changed(); renderStep(); return; }
    const d = await detail(id);
    S.char.background = { id, name: d.name };
    if (!S.char.tools && d.data.tools) S.char.tools = d.data.tools;
    changed(); renderStep();
  },
  'ability-method': (t) => {
    S.char.ability_method = t.value;
    if (t.value === 'standard') {
      const arr = [15, 14, 13, 12, 10, 8];
      ABILITIES.forEach((a, i) => { S.char.base_scores[a] = arr[i]; });
    } else if (t.value === 'point_buy') {
      ABILITIES.forEach((a) => { const v = S.char.base_scores[a]; if (v < 8 || v > 15) S.char.base_scores[a] = 8; });
    }
    changed(); renderStep();
  },
  'feat-from': (t) => { S.char.feats[+t.dataset.i].from = t.value; changed(); },
  'feat-asi': (t) => { S.char.feats[+t.dataset.i].asi = t.value; changed(); },
  'spell-flag': (t) => { S.char.spells[+t.dataset.i][t.dataset.flag] = t.checked; changed(); },
  'hp-mode': (t) => { S.char.hp_mode = t.value; changed(); renderStep(); },
  'hp-roll': (t) => { S.char.hp_rolls = S.char.hp_rolls || []; S.char.hp_rolls[+t.dataset.i] = +t.value || 0; changed(); },
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = ACTIONS[t.dataset.act];
  if (!fn) return;
  if (t.tagName === 'A' && !/^https?:/.test(t.getAttribute('href') || '')) e.preventDefault();
  Promise.resolve(fn(t, e)).catch((err) => toast(err.message, 'error'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const m = $('.modal-back'); if (m) m.remove(); }
  if (e.key === 'Enter' && e.target.matches('.result[data-act]')) e.target.click();
  if (e.key === 'Enter' && e.target.id === 'any-spell-q') ACTIONS['any-spell-search']();
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.bind && S.char && !(t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'radio')) {
    setPath(S.char, t.dataset.bind, readValue(t));
    changed();
    if (t.dataset.bind === 'name') renderLive();
  }
  if (t.dataset.filter !== undefined) {
    const q = t.value.trim().toLowerCase();
    (S.filters = S.filters || {})[t.dataset.filter] = t.value;
    $$(`[data-spell-group="${CSS.escape(t.dataset.filter)}"] .spell-row`).forEach((r) => { r.hidden = q && !r.dataset.spellName.includes(q); });
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.bind && S.char && (t.tagName === 'SELECT' || t.type === 'checkbox')) {
    setPath(S.char, t.dataset.bind, readValue(t));
    changed();
  }
  const fn = CHANGES[t.dataset.change];
  if (fn) Promise.resolve(fn(t, e)).catch((err) => toast(err.message, 'error'));
});
window.addEventListener('beforeprint', () => $$('details').forEach((d) => { d.open = true; }));
window.addEventListener('pagehide', () => saveNow());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });

(async function init() {
  try {
    const srd = await (await fetch('data/srd-2014.json')).json();
    API = await createApi(idbStore(), srd);
    S.srd = await api('/api/srd');
    go('characters');
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    $('#main').innerHTML = `<div class="note warn">${esc(e.message)}</div>`;
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
