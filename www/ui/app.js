'use strict';

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

async function api(path, opts = {}) {
  const o = { ...opts };
  if (o.json !== undefined) {
    o.method = o.method || 'POST';
    o.headers = { 'Content-Type': 'application/json' };
    o.body = JSON.stringify(o.json);
    delete o.json;
  }
  let r;
  try { r = await fetch(path, o); } catch (e) { throw new Error('The app server isn’t answering. Is the window running start.bat still open?'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : null;
  if (!r.ok) throw new Error((data && data.error) || `Request failed (${r.status})`);
  return data;
}

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
  if (save) { S.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 600); }
  if (compute) { clearTimeout(computeTimer); computeTimer = setTimeout(computeNow, 250); }
}

/* Saving with more than one device (the PC and a phone on Wi-Fi). Each save says which version of the character
   it started from; if another device saved in between, the two sets of changes are merged field by field
   (where both changed the same thing, this device's change wins) instead of one overwriting the other. */
const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function mergeChar(base, mine, theirs) {
  const out = clone(theirs);
  const keys = new Set([...Object.keys(mine || {}), ...Object.keys(base || {})]);
  keys.forEach((k) => {
    const b = (base || {})[k], m = (mine || {})[k], t = (theirs || {})[k];
    if (same(m, b)) return;                       // only they changed it (or nobody did)
    const plain = (x) => x && typeof x === 'object' && !Array.isArray(x);
    if (plain(m) && plain(b) && plain(t) && !same(t, b)) {
      out[k] = mergeChar(b, m, t);                 // both changed this group: go one level down (hit points vs conditions)
    } else if (m === undefined) delete out[k];
    else out[k] = clone(m);
  });
  return out;
}
function pendingKey(id) { return `cb-pending-${id}`; }
function keepPending() {
  try { localStorage.setItem(pendingKey(S.charId), JSON.stringify({ version: S.charVersion, base: S.base, character: S.char, at: Date.now() })); }
  catch (e) { /* private mode: the change stays in memory until the PC is back */ }
}
function clearPending(id) { try { localStorage.removeItem(pendingKey(id)); } catch (e) { /* nothing kept */ } }
function readPending(id) { try { return JSON.parse(localStorage.getItem(pendingKey(id)) || 'null'); } catch (e) { return null; } }

function setConnected(ok) {
  if (S.connected === ok) return;
  S.connected = ok;
  let bar = $('#conn-bar');
  if (ok) {
    if (bar) { bar.remove(); toast('Connected to your PC again. Your changes are saved.'); }
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'conn-bar';
    bar.className = 'conn-bar';
    bar.setAttribute('role', 'status');
    bar.textContent = 'Can’t reach the app on your PC. Keep playing: changes are kept on this device and save as soon as it’s back.';
    document.body.append(bar);
  }
}

let saveChain = Promise.resolve();
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  // one save at a time, in order, so each starts from the version the one before it made
  saveChain = saveChain.then(saveOnce, saveOnce);
  return saveChain;
}
async function saveOnce(retry = 0) {
  if (!S.charId || !S.char) return;
  const id = S.charId, sent = clone(S.char);
  S.saving = true;
  let r = null, data = {};
  try {
    r = await fetch(`/api/characters/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character: sent, version: S.charVersion }) });
    data = await r.json().catch(() => ({}));
  } catch (e) { r = null; }
  S.saving = false;
  if (S.charId !== id) return;
  if (!r) {                                       // the PC isn't answering (phone out of Wi-Fi range, PC asleep)
    keepPending();
    setConnected(false);
  } else if (r.status === 409 && data.character) {
    const merged = mergeChar(S.base, S.char, data.character);
    S.charVersion = data.version;
    S.base = clone(data.character);
    S.char = merged;
    S.char.id = id;
    S.dirty = true;
    refreshAfterRemote();
    if (retry < 3) await saveOnce(retry + 1);
  } else if (!r.ok) {
    toast('Couldn’t save: ' + (data.error || `error ${r.status}`), 'error');
  } else {
    if (data.version != null) S.charVersion = data.version;
    S.base = sent;
    if (!saveTimer && same(S.char, sent)) S.dirty = false;
    clearPending(id);
    setConnected(true);
  }
}

/* Another device changed the character: show its version (keeping anything typed here that isn't saved yet). */
function refreshAfterRemote() {
  if (S.view !== 'builder') return;
  const typing = document.activeElement && document.activeElement.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
  computeNow();
  if (S.tab === 'play') renderPlayMain();
  else if (!typing) renderStep();
  const head = $('.char-head');
  if (head) head.outerHTML = charHeadHtml();
}

async function pollVersion() {
  if (window.OFFLINE || !S.charId || S.view !== 'builder' || document.visibilityState !== 'visible') return;
  if (S.saving || saveTimer) return;
  if (S.connected === false || readPending(S.charId)) { if (S.dirty || readPending(S.charId)) saveNow(); }
  let v;
  try {
    const r = await fetch(`/api/characters/${S.charId}/version`);
    if (!r.ok) return;
    v = (await r.json()).version;
  } catch (e) { setConnected(false); return; }
  setConnected(true);
  if (v == null || S.charVersion == null || v <= S.charVersion + 1e-6 || S.dirty || S.saving) return;
  const id = S.charId;
  const { character, version } = await api(`/api/characters/${id}`);
  if (S.charId !== id || S.dirty || S.saving) return;
  S.char = character;
  S.charVersion = version;
  S.base = clone(character);
  refreshAfterRemote();
}
setInterval(() => { pollVersion().catch(() => {}); }, 4000);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pollVersion().catch(() => {}); });
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
  if (S.tab === 'play') { renderPlayMain(); return; }
  if (S.step === 'sheet') renderStep();
  else if (S.step === 'spells' && S.spellsKey !== spellsKey()) renderStep();
  else if ((S.step === 'equipment' || S.step === 'm_gear') && S.gearKey !== gearKey()) renderStep();
}
function refreshOutputs() {
  const sh = S.sheet;
  if (!sh) return;
  const head = $('.char-head');
  if (head && S.char) {
    $('h1', head).textContent = S.char.name || 'Unnamed hero';
    $('.char-sub', head).textContent = [sh.class_line, sh.race_name].filter(Boolean).join(', ');
  }
  $$('[data-out]').forEach((el) => {
    let v = getPath(sh, el.dataset.out);
    if (el.dataset.fmt === 'signed') v = signed(v);
    el.textContent = v ?? '–';
  });
  $$('[data-attack-out]').forEach((el) => {
    const at = (sh.attacks || []).find((x) => String(x.src_index) === el.dataset.attackOut);
    el.textContent = at ? `${signed(at.bonus)} to hit, ${at.damage}` : '';
  });
  $$('[data-carry-bar]').forEach((el) => {
    const cw = sh.carry;
    if (!cw) return;
    el.firstElementChild.style.width = `${Math.min(100, Math.round((100 * cw.weight) / (cw.capacity || 1)))}%`;
    el.classList.toggle('over', cw.weight > cw.capacity);
  });
  $$('[data-asi-check]').forEach((el) => { el.innerHTML = asiCheckHtml(sh.race_asi); });
  $$('[data-mc-req]').forEach((el) => { el.innerHTML = mcReqText(el.dataset.mcReq); });
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
  if (S.view === 'builder' && view !== 'builder' && S.dirty) saveNow();
  S.view = view;
  if (view !== 'builder') setTimeout(setHash, 0);
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
  const libEmpty = !status.library.kinds.class;
  main.innerHTML = `
    <div class="row" style="justify-content:space-between;margin-bottom:16px">
      <h1>Characters</h1>
      <div class="row">
        <label class="btn" style="cursor:pointer">Import JSON<input type="file" accept=".json" id="import-json" hidden></label>
        <button class="btn" data-act="new-manual">Write a sheet by hand</button>
        <button class="btn primary" data-act="new-char">New character</button>
      </div>
    </div>
    ${libEmpty ? `<div class="panel" style="margin-bottom:16px">
      <h3>Load the wiki’s index first</h3>
      <p>The builder lists species, classes, backgrounds and feats from dnd5e.wikidot.com. Loading the index reads two pages and takes a few seconds; individual pages are downloaded as you use them and kept on this PC.</p>
      <button class="btn primary" data-act="sync" id="sync-first">Load wiki index</button></div>` : ''}
    ${characters.length ? `<div class="panel"><table class="list">
      <thead><tr><th>Name</th><th>Build</th><th>Last edited</th><th></th></tr></thead>
      <tbody>${characters.map((c) => `<tr class="clickable char-row" data-act="open-char" data-id="${c.id}">
        <td>${esc(c.name)}</td><td>${esc(c.summary || 'Not started')}</td>
        <td class="muted small">${new Date(c.updated * 1000).toLocaleString()}</td>
        <td style="text-align:right"><button class="btn quiet danger" data-act="del-char" data-id="${c.id}" aria-label="Delete ${esc(c.name)}">Delete</button></td></tr>`).join('')}
      </tbody></table></div>`
    : `<div class="panel"><p>No characters yet. Build one step by step from your library, describe an idea for Claude to draft, or write a sheet by hand and let the app work out the numbers.</p>
       <div class="row"><button class="btn primary" data-act="new-char">New character</button>
       <button class="btn" data-act="new-manual">Write a sheet by hand</button></div></div>`}`;
  // First start: load the index straight away so nobody has to find the button (once per visit, so an
  // offline start shows the button and its error instead of retrying forever).
  if (libEmpty && !S.autoSynced) { S.autoSynced = true; ACTIONS.sync($('#sync-first')); }
  $('#import-json').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const character = JSON.parse(await f.text());
      if (character && character.cb_table_changes) {   // a table copy's changes: merge into that character
        const id = await bringBackChanges(f, null);
        await openChar(id, null, 'play');
        return;
      }
      const { id } = await api('/api/characters', { json: { character } });
      await openChar(id);
    } catch (err) { toast('Couldn’t import: ' + err.message, 'error'); }
  });
}

async function openChar(id, step, tab) {
  let { character, version } = await api(`/api/characters/${id}`);
  if (S.tray && S.charId !== id) { S.tray.history = []; S.tray.riders = {}; FOLLOW.clear(); }
  // changes made here while the PC couldn't be reached
  const pending = window.OFFLINE ? null : readPending(id);
  const fromServer = clone(character);
  let restored = false;
  if (pending && pending.character) {
    character = pending.version === version ? pending.character : mergeChar(pending.base, pending.character, character);
    character.id = id;
    restored = true;
  }
  S.charId = id;
  S.char = character;
  S.charVersion = version;
  S.base = restored && pending.version === version && pending.base ? clone(pending.base) : fromServer;
  S.dirty = restored;
  S.tab = tab || (step ? 'build' : character.last_tab || 'build');
  if (!step || !steps().some(([k]) => k === step)) step = character.mode === 'manual' ? 'm_basics' : 'basics';
  S.sheet = null;
  S.raceSel = null;
  S.chatDraft = null;
  S.step = step;
  go('builder');
  computeNow();
  setHash();
  if (restored) { saveNow(); toast('Saved the changes you made on this device while your PC was out of reach.'); }
}
/* The address remembers which character is open, so reloading (or a phone's home-screen icon) comes back to it. */
function setHash() {
  if (window.OFFLINE) return;
  const h = S.view === 'builder' && S.charId ? `#c=${S.charId}&t=${S.tab === 'play' ? 'play' : 'build'}` : '';
  if (location.hash !== h) history.replaceState(null, '', h || location.pathname + location.search);
}

/* ================================================================ builder */
const STEPS = [
  ['concept', 'Start from an idea'], ['basics', 'Basics'], ['species', 'Species'], ['class', 'Class'],
  ['background', 'Background'], ['abilities', 'Ability scores'], ['skills', 'Skills'], ['feats', 'Feats & improvements'],
  ['options', 'Class & feat options'], ['spells', 'Spells'], ['equipment', 'Equipment & HP'], ['companions', 'Companions & forms'],
  ['story', 'Personality & story'], ['sheet', 'Review & export'],
];
const STEPS_MANUAL = [
  ['m_basics', 'Basics'], ['m_abilities', 'Abilities & skills'], ['m_combat', 'Combat & attacks'], ['m_spells', 'Spells'],
  ['m_gear', 'Equipment'], ['companions', 'Companions & forms'], ['story', 'Features & story'], ['sheet', 'Review & export'],
];
const steps = () => (S.char && S.char.mode === 'manual' ? STEPS_MANUAL : STEPS);
function stepDone(key) {
  const c = S.char;
  const m = c.manual || {};
  return ({
    m_basics: !!c.name && !!m.class_text, m_abilities: (c.skills || []).length > 0 || (m.save_profs || []).length > 0,
    m_combat: (m.attacks || []).length > 0 || !!m.hp_max, m_spells: (c.spells || []).length > 0,
    m_gear: (c.inventory || []).length > 0 || !!c.equipment,
    basics: !!c.name, species: !!(c.race && c.race.id), class: (c.classes || []).length > 0,
    background: !!(c.background && c.background.id), skills: (c.skills || []).length > 0,
    abilities: ABILITIES.some((a) => (c.base_scores || {})[a] !== 8),
    options: (c.class_options || []).length > 0,
    spells: (c.spells || []).length > 0, equipment: (c.inventory || []).length > 0 || (c.weapons || []).length > 0 || !!c.armor,
    story: !!(c.personality && c.personality.personality_traits) || !!c.backstory,
    companions: (c.companions || []).length > 0 || (c.forms || []).length > 0,
  })[key];
}

function charHeadHtml() {
  const sh = S.sheet || {}, c = S.char;
  return `<div class="char-head">
    <div class="char-id"><h1>${esc(c.name || 'Unnamed hero')}</h1><span class="char-sub muted">${esc([sh.class_line, sh.race_name].filter(Boolean).join(', '))}</span></div>
    <div class="head-right"><div class="head-actions">
      ${(c.snapshots || []).length ? '<button class="btn quiet small" data-act="levelup-undo">Undo level up</button>' : ''}
      <button class="btn quiet small" data-act="short-rest" title="Short rest: spend hit dice, get short-rest features back">Short rest</button>
      <button class="btn quiet small" data-act="long-rest" title="Long rest: hit points, spell slots and features come back">Long rest</button>
      <button class="btn small" data-act="levelup-open">Level up</button>
      <button class="btn quiet small" data-act="phone-open" title="Use this character on your phone">Phone</button></div>
    <div class="tabs" role="tablist" aria-label="Character">
      <button role="tab" aria-selected="${S.tab !== 'play'}" data-act="char-tab" data-tab="build">Build</button>
      <button role="tab" aria-selected="${S.tab === 'play'}" data-act="char-tab" data-tab="play">Play</button></div></div></div>`;
}
function renderBuilder() {
  if (S.tab === 'play') {
    $('#main').innerHTML = `${charHeadHtml()}<div class="play-layout">
      <section class="play-main" id="play-main"><p class="loading">Working out the numbers…</p></section>
      <aside class="live" id="live" aria-label="Dice"></aside></div>`;
    renderPlayMain();
    renderLive();
    return;
  }
  $('#main').innerHTML = `${charHeadHtml()}<div class="builder">
    <nav class="steps" aria-label="Steps" id="steps"></nav>
    <section class="step-body" id="step-body"></section>
    <aside class="live" id="live" aria-label="Live character sheet"></aside></div>`;
  renderSteps();
  renderStep();
  renderLive();
}
function renderSteps() {
  $('#steps').innerHTML = steps().map(([k, label]) => `<button data-act="step" data-step="${k}" ${S.step === k ? 'aria-current="step"' : ''}>
    <span>${esc(label)}</span>${stepDone(k) ? '<span class="done" aria-label="done">✓</span>' : ''}</button>`).join('');
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
  const list = steps();
  const idx = list.findIndex(([k]) => k === S.step);
  const prev = list[idx - 1], next = list[idx + 1];
  const scroll = window.scrollY;
  if (typeof markLevelupSeen === 'function') markLevelupSeen(S.step);
  body.innerHTML = (typeof levelupBannerHtml === 'function' ? levelupBannerHtml(false) : '') + html + `<div class="step-nav no-print">
    ${prev ? `<button class="btn" data-act="step" data-step="${prev[0]}">Back: ${esc(prev[1])}</button>` : '<span></span>'}
    ${next ? `<button class="btn primary" data-act="step" data-step="${next[0]}">Next: ${esc(next[1])}</button>` : ''}</div>`;
  window.scrollTo(0, scroll);
  $$('[data-caster]', body).forEach((el) => applySpellFilters(el.dataset.caster));
  refreshOutputs();
  renderSteps();
}

function renderLive() {
  const el = $('#live');
  if (!el) return;
  const c = S.char, sh = S.sheet;
  if (!sh) { el.innerHTML = '<p class="muted">Working out the numbers…</p>'; return; }
  const trayMode = S.tab === 'play';
  el.classList.toggle('tray-mode', trayMode);
  el.setAttribute('aria-label', trayMode ? 'Dice' : 'Live character sheet');
  if (trayMode) {
    const t = trayState();
    el.classList.toggle('collapsed', !!t.collapsed);
    if (!el.querySelector('.tray')) el.innerHTML = renderTray();
    else { const tl = el.querySelector('.tray-last'); if (tl) tl.innerHTML = lastHtml(); }
    return;
  }
  el.classList.remove('collapsed');
  const name = c.name || 'Unnamed hero';
  const line = [sh.class_line, sh.race_name, sh.background_name].filter(Boolean).join(', ');
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
      <ul>${sh.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>` : ((c.classes || []).length || sh.mode === 'manual' ? '<p class="note good" style="background:var(--box)">Everything checks out.</p>' : '')}`;
}

/* ---------------------------------------------------------------- steps */
const STEP_RENDER = {};

STEP_RENDER.concept = async () => {
  const st = S.status || (S.status = await api('/api/status'));
  const total = (S.char.classes || []).reduce((t, c) => t + (c.level || 1), 0) || 1;
  return `<div class="panel"><h2>Start from an idea</h2>
    <p class="hint">Describe who you want to play. Claude picks the species, class, background, scores, skills, spells and gear from your library (the wiki plus anything you pulled from your PDFs), and you can change any of it in the next steps.</p>
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
  if (!races.length) html += `<div class="note">The library is empty. Load the wiki index from the Characters page or Library.</div>`;
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
    const an = sel.analysis;
    html += `<h3>Ability score increases</h3>
      ${an.asi_note ? `<p class="hint">${esc(an.asi_note)}</p>` : ''}
      ${an.asi_replaced ? `<p class="note small">Your subrace’s increase replaces the species’ usual one (“${esc(an.asi_replaced)}”), so that one isn’t added.</p>` : ''}
      ${(an.asi_choice || []).length && !c.custom_origin ? '<p class="small"><b>Your choice:</b> fill in the scores you want below.</p>' : ''}
      <div class="row">${ABILITIES.map((a) => `<label class="field" style="margin:0"><span>${AB_NAME[a]}</span>
        <input type="number" min="0" max="3" data-bind="race_bonus.${a}" value="${(c.race_bonus || {})[a] || 0}"></label>`).join('')}</div>
      <p class="small" data-asi-check style="margin:8px 0 0">${asiCheckHtml((S.sheet || {}).race_asi)}</p>
      <label class="check" style="margin-top:10px"><input type="checkbox" data-bind="custom_origin" ${c.custom_origin ? 'checked' : ''}>
        Customizing Your Origin <span class="muted small">(Tasha’s Cauldron of Everything: move your species’ increases to any scores you like)</span></label>
      <p class="hint" style="margin-top:4px">Fixed increases are filled in from the listing. The app checks your numbers against the species and tells you if they don’t add up.</p>
      <h3>Traits</h3>${sel.traits.map((t) => `<p class="trait"><b>${esc(t.name)}.</b> ${esc(t.text)}</p>`).join('') || '<p class="muted">No traits found on this page.</p>'}`;
    if ((sel.analysis.choices || []).length) {
      const bg = c.background && c.background.id ? (await detail(c.background.id)).data : {};
      const elsewhere = (sel.analysis.skills || []).concat(bg.skills || [], c.bg_skills || []);
      html += `<h3>Skill choices from your species</h3>${choicePicker(sel.analysis.choices, c.race_skills || [], 'race-skill', elsewhere)}`;
    }
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

async function fixedSkills() {
  const c = S.char;
  const bg = c.background && c.background.id ? (await detail(c.background.id)).data : {};
  const race = await raceSelection();
  return { bg: (bg.skills || []).concat(c.bg_skills || []), race: (race ? race.analysis.skills : []).concat(c.race_skills || []) };
}

/* Skill choices a species or background offers ("two of the following skills of your choice"). */
function choicePicker(choices, picked, act, takenElsewhere) {
  const all = Object.keys((S.srd || {}).skills || {});
  const limit = choices.reduce((t, ch) => t + (ch.count || 0), 0);
  const anySkill = choices.some((ch) => !ch.options);
  const options = anySkill ? all : all.filter((n) => choices.some((ch) => (ch.options || []).includes(n)));
  const full = picked.length >= limit;
  return `${choices.map((ch) => `<p style="margin:8px 0 4px"><b>${esc(ch.trait || 'Choice')}:</b> choose ${ch.count}
      ${ch.options ? `from ${esc(ch.options.join(', '))}` : `skill${ch.count > 1 ? 's' : ''} of your choice`}</p>`).join('')}
    <p class="small muted" style="margin:0 0 4px">${picked.length} of ${limit} chosen</p>
    <div class="skill-picks">${options.map((name) => {
      const on = picked.includes(name);
      const elsewhere = !on && takenElsewhere.includes(name);
      return `<label class="check"><input type="checkbox" data-act="${act}" data-skill-name="${esc(name)}" ${on ? 'checked' : ''}
        ${elsewhere || (full && !on) ? 'disabled' : ''}>${esc(name)}${elsewhere ? ' <span class="small muted">already have</span>' : ''}</label>`;
    }).join('')}</div>`;
}

function skillPicker(options, limit, fixed, i) {
  const c = S.char;
  const chosen = (c.skills || []).filter((s) => options.includes(s) && !fixed.bg.includes(s) && !fixed.race.includes(s));
  const full = limit && chosen.length >= limit;
  return `<p style="margin:10px 0 4px"><b>Skills:</b> choose ${limit} <span class="muted">(${chosen.length} of ${limit} chosen)</span></p>
    <div class="skill-picks">${options.map((name) => {
      const from = fixed.bg.includes(name) ? 'background' : fixed.race.includes(name) ? 'species' : '';
      const on = !!from || (c.skills || []).includes(name);
      const disabled = from || (full && !on);
      return `<label class="check"><input type="checkbox" data-act="class-skill" data-skill-name="${esc(name)}" data-i="${i}"
        ${on ? 'checked' : ''} ${disabled ? 'disabled' : ''}>${esc(name)}${from ? ` <span class="small muted">from ${from}</span>` : ''}</label>`;
    }).join('')}</div>`;
}

STEP_RENDER.class = async () => {
  const classes = await list('class');
  const c = S.char;
  if (!c.classes.length) c.classes.push({ id: null, name: '', slug: '', level: 1, subclass: null });
  const fixed = await fixedSkills();
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
        const listOr = (v, fallback) => esc(v || fallback || 'None');
        info = `<h4>What ${esc(d.name)} gives you</h4>
          <dl class="entry-stats">
            <dt>Hit die</dt><dd>d${rules.hit_die}</dd>
            <dt>Saving throws</dt><dd>${(rules.saves || []).map((s) => AB_NAME[s]).join(', ') || '–'}</dd>
            <dt>Armor</dt><dd>${listOr(d.data.armor, (rules.armor || []).join(', '))}</dd>
            <dt>Weapons</dt><dd>${listOr(d.data.weapons, (rules.weapons || []).join(', '))}</dd>
            <dt>Tools</dt><dd>${listOr(d.data.tools)}</dd></dl>
          ${rules.skill_count ? skillPicker(rules.skill_options || [], rules.skill_count, fixed, 0) : ''}
          <p class="hint small">Need more skills, from a feat or your DM? Add them on the Skills step.</p>
          ${feats.length ? `<h4>Features to level ${row.level}</h4>${feats.map((f) => `<details class="feature"><summary>${esc(f.name)}<span>level ${f.level}</span></summary><div class="prose">${prose(f.text)}</div></details>`).join('')}` : ''}`;
      } else {
        const mc = ((S.srd || {}).multiclass || {})[rules.slug];
        if (mc) {
          const opts = mc.any_skill ? Object.keys((S.srd || {}).skills || {}) : (rules.skill_options || []);
          info = `<p class="small" style="margin:6px 0"><b>Multiclassing into ${esc(d.name)} gives:</b> ${esc(mc.text)}.</p>
            ${mc.skills ? skillPicker(opts, mc.skills, fixed, i) : ''}`;
        }
      }
    }
    if (c.classes.length > 1 && row.slug) info = `<p class="small mc-req" data-mc-req="${esc(row.slug)}">${mcReqText(row.slug)}</p>` + info;
    html += `<div class="row top-align" style="border-bottom:1px solid var(--grid);padding:10px 0">
      <label class="field grow"><span>${i === 0 ? 'Class' : 'Also a…'}</span><select data-change="pick-class" data-i="${i}">${options(classes, row.id, 'Choose a class…')}</select></label>
      <label class="field"><span>Level</span><input type="number" min="1" max="20" value="${row.level || 1}" data-change="class-level" data-i="${i}"></label>
      ${subHtml}
      ${c.classes.length > 1 ? `<button class="btn quiet danger" style="align-self:center" data-act="remove-class" data-i="${i}">Remove</button>` : ''}
    </div>${info}`;
  }
  html += `<div class="row" style="margin-top:12px"><button class="btn" data-act="add-class">Add another class (multiclass)</button>
    <span class="hint">Your first class sets saving throws and starting proficiencies; later classes add fewer.</span></div>
    <p class="hint" style="margin-top:10px">Features that let you pick from a list, like Eldritch Invocations, a Fighting Style or Metamagic, are picked on the <a href="#" data-act="step" data-step="options">Class options</a> step.</p></div>`;
  return html;
};

/* Multiclassing (2014): 13 in the class's key scores, for every class you have. */
function mcReqText(slug) {
  const req = ((S.srd || {}).multiclass_req_raw || {})[slug];
  if (!req) return '';
  const scores = (S.sheet || {}).scores || {};
  const ok = req.every((g) => g.some((a) => (scores[a] || 0) >= 13));
  const text = req.map((g) => g.map((a) => `${AB_NAME[a]} 13`).join(' or ')).join(' and ');
  return `<span class="${ok ? 'ok-text' : 'warn-text'}">${ok ? '✓' : '✗'} Multiclassing needs ${esc(text)}</span>`
    + (ok ? '' : ' <span class="muted">(for this class and every other class you have)</span>');
}

/* Species ability increases: what the species gives, and whether race_bonus matches. */
function asiCheckHtml(chk) {
  if (!chk) return '';
  if (chk.ok && !chk.message) return `<span class="ok-text">✓ Matches your species: ${esc(chk.expect)}</span>`;
  return `<span class="${chk.ok ? 'ok-text' : 'warn-text'}">${chk.ok ? '✓' : '✗'} ${esc(chk.message)}</span>`;
}

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
      ${(b.skill_choices || []).length ? `<h3>Skill choices from your background</h3>${choicePicker(b.skill_choices, c.bg_skills || [], 'bg-skill',
        (b.skills || []).concat((S.raceSel && S.raceSel.analysis.skills) || [], c.race_skills || []))}` : ''}
      ${b.equipment ? '<p class="hint">You can take this equipment on the <a href="#" data-act="step" data-step="equipment">Equipment &amp; HP</a> step, along with your class’s starting equipment.</p>' : ''}
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
  const bgSkills = (bg.skills || []).concat(c.bg_skills || []);
  const raceSkills = (race ? race.analysis.skills : []).concat(c.race_skills || []);
  const classOpts = rules ? rules.skill_options : [];
  const picked = (c.skills || []).filter((s) => !bgSkills.includes(s) && !raceSkills.includes(s)).length;
  const extra = '';
  const skills = Object.entries((S.srd || {}).skills || {});
  return `<div class="panel"><h2>Skills</h2>
    ${rules ? `<p>Your ${esc(rules.name)} picks ${rules.skill_count} on the Class step, and species or background choices are made on their steps. This is the full list: tick extra skills here if a feat or your DM gives you more. You have <b>${picked}</b> picked for your class or extra.</p>` : '<p class="hint">Choose a class first to see which skills it offers.</p>'}
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
const LIMIT_LABEL = { spellbook: 'in your spellbook', known: 'spells known', prepared: 'prepared' };
const LIMIT_HELP = {
  spellbook: 'Your spellbook starts with six 1st-level spells and gains two more each level. Each day you prepare some of them (tick Prepared under Your spells).',
  known: 'You know a fixed number of spells and can swap one for another when you gain a level.',
  prepared: 'You can prepare any spell on your list after a long rest. Pick the ones you have ready now; you can change them any time.',
};
function spellUi(slug) {
  S.spellUi = S.spellUi || {};
  return (S.spellUi[slug] = S.spellUi[slug] || { tab: null, q: '', school: '', ritual: false, more: false });
}
const isMine = (m, sc, sp) => m.class === sc.slug && (String(m.id) === String(sp.id) || (m.name || '').toLowerCase() === sp.name.toLowerCase());

STEP_RENDER.spells = async () => {
  const c = S.char, sh = S.sheet;
  S.spellsKey = spellsKey();
  if (!sh) return '<p class="loading">Working out spellcasting…</p>';
  const mine = c.spells || [];
  let html = `<div class="panel"><h2>Spells</h2>`;
  const classCasters = sh.spellcasting.filter((x) => x.type !== 'feat');
  if (!classCasters.length) {
    html += `<p>None of your classes cast spells at their current level.${(sh.feat_info || []).some((x) => x.grants && (x.grants.spells.length || x.grants.spell_picks)) ? ' Your feats’ spells are below.' : ' Spells from feats or species traits can still be added under Your spells.'}</p>`;
  }
  for (const sc of classCasters) {
    const ui = spellUi(sc.slug);
    const lkey = `spells:${sc.slug}:${sc.max_spell_level}`;
    let all = S.lists[lkey], loadError = '';
    if (!all) {
      try { all = S.lists[lkey] = (await api(`/api/classes/${encodeURIComponent(sc.slug)}/spells?max=${sc.max_spell_level}`)).spells; }
      catch (e) { loadError = e.message; all = []; }
    }
    const picked = mine.filter((m) => m.class === sc.slug && !m.always);
    const nCantrips = picked.filter((m) => !(m.level > 0)).length;
    const nLeveled = picked.length - nCantrips;
    const nPrepared = picked.filter((m) => m.level > 0 && m.prepared !== false).length;
    const hasCantrips = (sc.cantrips_known || 0) > 0 || all.some((x) => x.level === 0);
    const levels = [];
    if (hasCantrips) levels.push(0);
    for (let L = 1; L <= sc.max_spell_level; L++) levels.push(L);
    if (ui.tab === null || !levels.includes(ui.tab)) ui.tab = levels.includes(1) ? 1 : levels[0];
    const cantripFull = sc.cantrips_known != null && nCantrips >= sc.cantrips_known;
    const spellFull = sc.spell_limit != null && nLeveled >= sc.spell_limit;
    const schools = [...new Set(all.map((x) => x.school).filter(Boolean))].sort();
    const chip = (n, max, label) => `<div class="limit ${max != null && n > max ? 'over' : ''}"><b>${n}${max != null ? ` / ${max}` : ''}</b> ${label}</div>`;
    html += `<section class="caster" data-caster="${esc(sc.slug)}">
      <h3>${esc(sc.class)} ${sc.level}</h3>
      <p class="muted small" style="margin-top:-4px">${AB_NAME[sc.ability]}: save DC ${sc.dc}, spell attack ${signed(sc.attack)}.
        ${sc.max_spell_level ? `Your spell slots go up to ${ord(sc.max_spell_level)} level, so that’s the highest shown here.` : 'No spell slots yet at this level.'}</p>
      <div class="limits">
        ${hasCantrips ? chip(nCantrips, sc.cantrips_known, 'cantrips') : ''}
        ${sc.max_spell_level ? chip(nLeveled, sc.spell_limit, LIMIT_LABEL[sc.limit_kind] || 'spells') : ''}
        ${sc.slug === 'wizard' && sc.max_spell_level ? chip(nPrepared, sc.prepared_count, 'prepared today') : ''}
      </div>
      ${sc.limit_kind ? `<p class="hint small">${LIMIT_HELP[sc.limit_kind]}</p>` : ''}
      ${loadError || (!all.length && levels.length) ? `<div class="note warn">${esc(loadError || `No ${sc.class} spells were found on the wiki’s list.`)}
        <div style="margin-top:6px"><button class="btn" data-act="spell-reload" data-slug="${esc(sc.slug)}" data-max="${sc.max_spell_level}">Download the spell list again</button></div></div>` : ''}
      ${levels.length && all.length ? `
      <div class="spell-tabs" role="tablist" aria-label="${esc(sc.class)} spell levels">${levels.map((L) => {
        const n = picked.filter((m) => (m.level || 0) === L).length;
        const total = all.filter((x) => x.level === L).length;
        return `<button role="tab" aria-selected="${ui.tab === L}" data-act="spell-tab" data-slug="${esc(sc.slug)}" data-level="${L}">
          ${L === 0 ? 'Cantrips' : `${ord(L)} level`}<span class="tab-count">${n ? `${n} picked` : `${total} spell${total === 1 ? '' : 's'}`}</span></button>`;
      }).join('')}</div>
      <div class="row spell-filters">
        <input type="search" placeholder="Search ${esc(sc.class)} spells" data-spell-q="${esc(sc.slug)}" value="${esc(ui.q)}" class="grow" aria-label="Search spells">
        <select data-spell-school="${esc(sc.slug)}" aria-label="School"><option value="">Every school</option>${schools.map((x) => `<option ${ui.school === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
        <label class="check small"><input type="checkbox" data-spell-ritual="${esc(sc.slug)}" ${ui.ritual ? 'checked' : ''}>Rituals only</label>
      </div>
      ${levels.map((L) => {
        const full = (L === 0 ? cantripFull : spellFull) && !ui.more;
        const rows = all.filter((x) => x.level === L);
        return `<div class="spell-pane" data-pane="${L}" ${ui.tab === L ? '' : 'hidden'}>
          ${rows.map((x) => {
            const on = mine.some((m) => isMine(m, sc, x));
            return `<div class="spell-row2 ${on ? 'picked' : ''}" data-name="${esc(x.name.toLowerCase())}" data-school="${esc(x.school || '')}" data-ritual="${x.ritual ? 1 : 0}">
              <label class="check"><input type="checkbox" data-act="spell-toggle" data-id="${x.id}" data-name="${esc(x.name)}" data-level="${x.level ?? 0}" data-class="${esc(sc.slug)}"
                ${on ? 'checked' : ''} ${full && !on ? 'disabled' : ''}><b>${esc(x.name)}</b></label>
              <span class="tags">${x.ritual ? '<span class="tag">ritual</span>' : ''}${/concentration/i.test(x.duration || '') ? '<span class="tag">concentration</span>' : ''}${sourceTag(x)}</span>
              <span class="muted small">${esc(x.school || '')}</span><span class="muted small">${esc(x.casting_time || '')}</span><span class="muted small">${esc(x.range || '')}</span>
              <button class="btn quiet small" data-act="spell-more" data-id="${x.id}" aria-expanded="false">Details</button>
              <div class="spell-more" hidden></div></div>`;
          }).join('') || '<p class="muted">No spells at this level.</p>'}
          ${full && rows.some((x) => !mine.some((m) => isMine(m, sc, x))) ? `<p class="hint small" style="margin-top:8px">That’s the limit for your level.
            <button class="btn quiet small" data-act="spell-more-ok" data-slug="${esc(sc.slug)}">Let me pick more anyway</button></p>` : ''}
        </div>`;
      }).join('')}` : ''}
    </section>`;
  }
  if ((sh.granted_spells || []).length) {
    html += `<div class="note"><b>Spells your subclass or feats give you, not added yet:</b> ${sh.granted_spells.map((g) => esc(g.name)).join(', ')}
      <div style="margin-top:6px"><button class="btn" data-act="add-granted">Add them</button></div></div>`;
  }
  html += `</div>${typeof featSpellsHtml === 'function' ? await featSpellsHtml() : ''}<div class="panel"><h3>Your spells</h3>
    ${mine.length ? `<table class="list"><thead><tr><th>Spell</th><th>Level</th><th>Class</th><th>Prepared</th><th>Always prepared</th><th></th></tr></thead><tbody>
      ${[...mine].map((x, i) => [x, i]).sort((a, b) => (a[0].level || 0) - (b[0].level || 0) || (a[0].name || '').localeCompare(b[0].name || '')).map(([x, i]) => `<tr>
        <td>${x.id ? `<a href="#" data-act="show-entry" data-id="${x.id}">${esc(x.name)}</a>` : esc(x.name)}</td><td>${x.level ? ord(x.level) : 'cantrip'}</td>
        <td>${esc(((S.srd || {}).classes || {})[x.class] ? S.srd.classes[x.class].name
          : String(x.class || '').startsWith('feat:') ? ((sh.feat_info || []).find((fi) => `feat:${fi.key}` === x.class) || { name: 'Feat' }).name : (x.class || '–'))}</td>
        <td>${x.level ? `<input type="checkbox" data-change="spell-flag" data-flag="prepared" data-i="${i}" ${x.prepared !== false ? 'checked' : ''} aria-label="Prepared">` : ''}</td>
        <td><input type="checkbox" data-change="spell-flag" data-flag="always" data-i="${i}" ${x.always ? 'checked' : ''} aria-label="Always prepared"></td>
        <td style="text-align:right"><button class="btn quiet danger" data-act="remove-spell" data-i="${i}">Remove</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No spells picked yet.</p>'}
    <h4>Add a spell from any list</h4>
    <p class="hint">For spells granted by a subclass, feat or species trait (domain spells, Magic Initiate and so on). These don’t count against your limits.</p>
    <div class="row"><input type="search" id="any-spell-q" placeholder="Search all spells" class="grow">
      <button class="btn" data-act="any-spell-search">Search</button></div>
    <div id="any-spell-results"></div></div>`;
  return html;
};

function applySpellFilters(slug) {
  const ui = spellUi(slug);
  const box = document.querySelector(`[data-caster="${CSS.escape(slug)}"]`);
  if (!box) return;
  const q = ui.q.trim().toLowerCase();
  $$('.spell-row2', box).forEach((r) => {
    r.hidden = (q && !r.dataset.name.includes(q)) || (ui.school && r.dataset.school !== ui.school) || (ui.ritual && r.dataset.ritual !== '1');
  });
}

/* STEP_RENDER.equipment and STEP_RENDER.m_gear live in gear.js */

STEP_RENDER.story = async () => {
  const c = S.char;
  const p = c.personality || {};
  const field = (key, label, rows = 2) => `<label class="field"><span>${label}</span><textarea rows="${rows}" data-bind="personality.${key}">${esc(p[key] || '')}</textarea></label>`;
  return `<div class="panel"><h2>Personality &amp; story</h2>
    <div class="grid2">${field('personality_traits', 'Personality traits')}${field('ideals', 'Ideals')}${field('bonds', 'Bonds')}${field('flaws', 'Flaws')}</div>
    <label class="field"><span>Appearance</span><textarea rows="2" data-bind="appearance">${esc(c.appearance || '')}</textarea></label>
    <label class="field"><span>Backstory</span><textarea rows="6" data-bind="backstory">${esc(c.backstory || '')}</textarea></label>
    <label class="field"><span>Notes</span><textarea rows="3" data-bind="notes">${esc(c.notes || '')}</textarea></label></div>
  <div class="panel"><h2>${c.mode === 'manual' ? 'Features &amp; traits' : 'Extra features'}</h2>
    <p class="hint">${c.mode === 'manual' ? 'Class features, species traits, feats, magic items: anything you want on the sheet.' : 'Anything the builder doesn’t know about: a magic item, a boon from your DM, a homebrew trait. These print with your other features.'}</p>
    ${(c.extra_features || []).map((f, i) => `<div class="row top-align" style="border-bottom:1px solid var(--grid);padding:8px 0">
      <div style="width:220px"><label class="field"><span>Name</span><input type="text" data-bind="extra_features.${i}.name" value="${esc(f.name)}"></label>
        <label class="field"><span>Where it’s from</span><input type="text" data-bind="extra_features.${i}.source" value="${esc(f.source || '')}" placeholder="Rogue 3, Feat…"></label></div>
      <label class="field grow"><span>Description</span><textarea rows="2" data-bind="extra_features.${i}.text">${esc(f.text)}</textarea></label>
      <button class="btn quiet danger" style="align-self:center" data-act="remove-extra" data-i="${i}">Remove</button></div>`).join('')}
    <button class="btn" data-act="add-extra" style="margin-top:10px">Add a feature</button></div>`;
};

/* ---------------------------------------------------------------- hand-written sheets */
const abilitySelect = (bind, value, none = 'None') => `<select data-bind="${bind}">
  <option value="" ${!value ? 'selected' : ''}>${none}</option>${ABILITIES.map((a) => `<option value="${a}" ${value === a ? 'selected' : ''}>${AB_NAME[a]}</option>`).join('')}</select>`;
const mField = (label, bind, value, attrs = '', cls = '') => `<label class="field ${cls}"><span>${label}</span><input type="text" data-bind="${bind}" value="${esc(value ?? '')}" ${attrs}></label>`;
const mNum = (label, bind, value, attrs = '', cls = '') => `<label class="field ${cls}"><span>${label}</span><input type="number" data-bind="${bind}" value="${esc(value ?? '')}" ${attrs}></label>`;
function manualOf(c) { c.manual = c.manual || {}; return c.manual; }

STEP_RENDER.m_basics = async () => {
  const c = S.char, m = manualOf(c);
  const aligns = (S.srd || {}).alignments || [];
  return `<div class="panel"><h2>Basics</h2>
    <p class="hint">Copy in whatever your sheet says. Modifiers, skill bonuses, attack bonuses and spell DCs work themselves out from what you type, and you can roll everything on the Character sheet step.</p>
    <div class="grid2">
      ${mField('Character name', 'name', c.name)}${mField('Player name', 'player', c.player)}
      ${mField('Class and level', 'manual.class_text', m.class_text, 'placeholder="Blood Hunter 3 / Rogue 2"')}
      <label class="field"><span>Total character level</span><input type="number" min="1" max="20" data-bind="manual.level" value="${m.level || 1}">
        <small>Proficiency bonus <b data-out="prof" data-fmt="signed"></b></small></label>
      ${mField('Species', 'manual.race_text', m.race_text, 'placeholder="Hill dwarf"')}${mField('Background', 'manual.background_text', m.background_text)}
      <label class="field"><span>Alignment</span><select data-bind="alignment"><option value="">Choose…</option>
        ${aligns.map((a) => `<option ${c.alignment === a ? 'selected' : ''}>${a}</option>`).join('')}</select></label>
      ${mNum('Experience points', 'xp', c.xp || 0, 'min="0" style="width:120px"')}
      ${mField('Size', 'manual.size', m.size, 'placeholder="Medium"')}${mNum('Darkvision (feet)', 'manual.darkvision', m.darkvision, 'min="0" style="width:100px"')}
    </div></div>`;
};

STEP_RENDER.m_abilities = async () => {
  const c = S.char, m = manualOf(c);
  const skills = Object.entries((S.srd || {}).skills || {});
  return `<div class="panel"><h2>Ability scores</h2>
    <p class="hint">Your final scores, with every bonus already added.</p>
    <div class="row">${ABILITIES.map((a) => `<label class="field" style="margin:0"><span>${AB_NAME[a]}</span>
      <span class="row" style="gap:6px"><input type="number" min="1" max="30" data-bind="base_scores.${a}" value="${(c.base_scores || {})[a] ?? 10}">
      <span class="computed" data-out="mods.${a}" data-fmt="signed"></span></span></label>`).join('')}</div></div>
  <div class="panel"><h2>Saving throws</h2>
    <div class="skill-picks">${ABILITIES.map((a) => `<label class="check"><input type="checkbox" data-act="m-save" data-ab="${a}" ${(m.save_profs || []).includes(a) ? 'checked' : ''}>
      ${AB_NAME[a]} <span class="computed" data-out="saves.${a}.bonus" data-fmt="signed"></span></label>`).join('')}</div>
    <p class="hint small">Tick the saves you’re proficient in.</p></div>
  <div class="panel"><h2>Skills</h2>
    <table class="list"><thead><tr><th>Skill</th><th>Proficient</th><th>Expertise</th><th style="text-align:right">Bonus</th></tr></thead><tbody>
    ${skills.map(([name, ab]) => `<tr><td>${esc(name)} <span class="muted small">${ab.toUpperCase()}</span></td>
      <td><input type="checkbox" data-act="skill" data-skill-name="${esc(name)}" ${(c.skills || []).includes(name) ? 'checked' : ''} aria-label="Proficient in ${esc(name)}"></td>
      <td><input type="checkbox" data-act="expertise" data-skill-name="${esc(name)}" ${(c.expertise || []).includes(name) ? 'checked' : ''} aria-label="Expertise in ${esc(name)}"></td>
      <td style="text-align:right" class="num" data-skill="${esc(name)}"></td></tr>`).join('')}</tbody></table>
    <label class="check" style="margin-top:10px"><input type="checkbox" data-bind="manual.jack" ${m.jack ? 'checked' : ''}>Jack of All Trades (half proficiency on checks you’re not proficient in)</label>
    <div class="edit-grid" style="margin-top:10px">
      ${mNum('Proficiency bonus', 'manual.prof_override', m.prof_override, 'min="0" max="10" placeholder="auto"')}
      ${mNum('Extra passive Perception', 'manual.passive_bonus', m.passive_bonus || 0, 'title="For Observant and similar"')}
    </div>
    <p class="hint small">Leave proficiency bonus empty to work it out from your level.</p></div>
  <div class="panel"><h2>Other proficiencies</h2>
    <label class="field"><span>Armor, weapons and anything else</span><textarea rows="3" data-bind="manual.proficiencies" placeholder="Armor: light, medium, shields&#10;Weapons: simple, martial">${esc(m.proficiencies || '')}</textarea></label>
    <div class="grid2">${mField('Tools', 'tools', c.tools)}${mField('Languages', 'languages', c.languages)}</div></div>`;
};

const APPLIES = [['any', 'Any attack that hits'], ['weapon', 'Weapon attacks'], ['melee', 'Melee weapon attacks'],
  ['str-melee', 'Strength melee attacks'], ['finesse-ranged', 'Finesse or ranged weapons'], ['spell', 'Spell attacks']];

STEP_RENDER.m_combat = async () => {
  const c = S.char, m = manualOf(c);
  const attacks = m.attacks || [];
  const riders = m.riders || [];
  const weapons = Object.keys(((S.srd || {}).weapons) || {});
  return `<div class="panel"><h2>Defense &amp; health</h2>
    <div class="edit-grid">
      ${mNum('Armor class', 'manual.ac', m.ac, 'min="0" placeholder="10 + Dex"')}
      ${mField('AC comes from', 'manual.ac_note', m.ac_note, 'placeholder="Chain mail + shield"', 'wide')}
      ${mNum('Hit point maximum', 'manual.hp_max', m.hp_max, 'min="0"')}
      ${mField('Hit dice', 'manual.hit_dice', m.hit_dice, 'placeholder="3d10 + 2d8"')}
      ${mNum('Speed (feet)', 'manual.speed', m.speed, 'min="0"')}
      ${mNum('Extra initiative', 'manual.init_bonus', m.init_bonus || 0)}
    </div>
    <p class="computed">Initiative <span data-out="initiative" data-fmt="signed"></span>, armor class <span data-out="ac"></span></p></div>
  <div class="panel"><h2>Attacks</h2>
    ${attacks.map((a, i) => `<div class="edit-card">
      <div class="edit-grid">
        ${mField('Name', `manual.attacks.${i}.name`, a.name, 'placeholder="Longsword"', 'wide')}
        <label class="field"><span>Ability</span>${abilitySelect(`manual.attacks.${i}.ability`, a.ability, 'None')}</label>
        <label class="field"><span>Range</span><select data-bind="manual.attacks.${i}.range">
          <option value="melee" ${a.range !== 'ranged' ? 'selected' : ''}>Melee</option><option value="ranged" ${a.range === 'ranged' ? 'selected' : ''}>Ranged</option></select></label>
        ${mNum('Extra to hit', `manual.attacks.${i}.bonus`, a.bonus || 0)}
        ${mField('Damage dice', `manual.attacks.${i}.dice`, a.dice, 'placeholder="1d8"')}
        ${mNum('Extra damage', `manual.attacks.${i}.dmg_bonus`, a.dmg_bonus || 0)}
        ${mField('Damage type', `manual.attacks.${i}.type`, a.type, 'placeholder="slashing"')}
        ${mField('Two-handed dice', `manual.attacks.${i}.versatile`, a.versatile, 'placeholder="1d10"')}
        ${mField('Notes', `manual.attacks.${i}.notes`, a.notes, 'placeholder="finesse, light"', 'wide')}
      </div>
      <div class="row">
        <label class="check"><input type="checkbox" data-bind="manual.attacks.${i}.prof" ${a.prof !== false ? 'checked' : ''}>Proficient</label>
        <label class="check"><input type="checkbox" data-bind="manual.attacks.${i}.add_mod" ${a.add_mod !== false ? 'checked' : ''}>Add ability modifier to damage</label>
        <label class="check"><input type="checkbox" data-bind="manual.attacks.${i}.finesse" ${a.finesse ? 'checked' : ''}>Finesse</label>
        <span class="computed grow" data-attack-out="${i}"></span>
        <button class="btn quiet danger" data-act="m-remove-attack" data-i="${i}">Remove</button></div></div>`).join('') || '<p class="muted">No attacks yet.</p>'}
    <div class="row"><button class="btn" data-act="m-add-attack">Add an attack</button>
      <select id="m-weapon-pick" aria-label="Weapon"><option value="">Or start from a weapon…</option>${weapons.map((w) => `<option>${esc(w)}</option>`).join('')}</select>
      <button class="btn" data-act="m-add-weapon">Add weapon</button></div></div>
  <div class="panel"><h2>Extra damage &amp; dice rules</h2>
    <p class="hint">Extra damage shows up as switches in the dice panel, for things like Sneak Attack, Rage or a magic weapon’s 1d6 fire.</p>
    ${riders.map((r, i) => `<div class="edit-card"><div class="edit-grid">
      ${mField('Name', `manual.riders.${i}.name`, r.name, 'placeholder="Sneak Attack"', 'wide')}
      ${mField('Dice', `manual.riders.${i}.dice`, r.dice, 'placeholder="3d6"')}
      ${mNum('Flat bonus', `manual.riders.${i}.flat`, r.flat || 0)}
      ${mField('Damage type', `manual.riders.${i}.type`, r.type)}
      <label class="field wide"><span>Applies to</span><select data-bind="manual.riders.${i}.applies">${APPLIES.map(([v, l]) => `<option value="${v}" ${(r.applies || 'any') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div><div class="row"><label class="check"><input type="checkbox" data-bind="manual.riders.${i}.once" ${r.once ? 'checked' : ''}>Once per turn (switches off after a damage roll)</label>
      <button class="btn quiet danger" data-act="m-remove-rider" data-i="${i}">Remove</button></div></div>`).join('')}
    <button class="btn" data-act="m-add-rider">Add extra damage</button>
    <h4>Dice rules</h4>
    <div class="row">
      <label class="check"><input type="checkbox" data-bind="manual.lucky" ${m.lucky ? 'checked' : ''}>Lucky (reroll a natural 1 on d20 rolls)</label>
      <label class="check"><input type="checkbox" data-bind="manual.reliable_talent" ${m.reliable_talent ? 'checked' : ''}>Reliable Talent (proficient skill rolls under 10 count as 10)</label></div>
    <div class="edit-grid" style="margin-top:8px">
      <label class="field"><span>Critical hit on</span><select data-bind="manual.crit_range" data-num>${[[20, '20'], [19, '19–20'], [18, '18–20']].map(([v, l]) => `<option value="${v}" ${(+m.crit_range || 20) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${mNum('Extra weapon dice on a melee crit', 'manual.extra_crit_dice', m.extra_crit_dice || 0, 'min="0" max="5" title="Brutal Critical, Savage Attacks"', 'wide')}
    </div></div>`;
};

STEP_RENDER.m_spells = async () => {
  const c = S.char, m = manualOf(c);
  const slots = m.slots || [];
  const spells = c.spells || [];
  return `<div class="panel"><h2>Spellcasting</h2>
    <div class="edit-grid">
      ${mField('Spellcasting class', 'manual.spell_class', m.spell_class, 'placeholder="Wizard"', 'wide')}
      <label class="field"><span>Ability</span>${abilitySelect('manual.spell_ability', m.spell_ability, 'No spellcasting')}</label>
      ${mNum('Extra to save DC', 'manual.spell_dc_bonus', m.spell_dc_bonus || 0)}
      ${mNum('Extra to spell attacks', 'manual.spell_attack_bonus', m.spell_attack_bonus || 0)}
    </div>
    <p class="computed">Save DC <span data-out="spellcasting.0.dc"></span>, spell attack <span data-out="spellcasting.0.attack" data-fmt="signed"></span></p>
    <h4>Spell slots</h4>
    <div class="slot-grid">${Array.from({ length: 9 }, (_, n) => `<label class="field" style="margin:0"><span>${ord(n + 1)}</span>
      <input type="number" min="0" max="9" data-bind="manual.slots.${n}" value="${slots[n] || 0}"></label>`).join('')}</div>
    <div class="edit-grid" style="margin-top:10px">${mNum('Pact Magic slots', 'manual.pact_count', m.pact_count || 0, 'min="0" max="4"')}
      ${mNum('Pact slot level', 'manual.pact_level', m.pact_level || 0, 'min="0" max="5"')}</div></div>
  <div class="panel"><h2>Spells</h2>
    ${spells.length ? `<table class="list"><thead><tr><th>Spell</th><th>Level</th><th>Prepared</th><th>Notes</th><th></th></tr></thead><tbody>
      ${spells.map((sp, i) => `<tr><td><input type="text" data-bind="spells.${i}.name" value="${esc(sp.name)}" aria-label="Spell name">${sp.id ? ' <span class="tag">library</span>' : ''}</td>
        <td><input type="number" min="0" max="9" data-bind="spells.${i}.level" value="${sp.level || 0}" aria-label="Spell level"></td>
        <td><input type="checkbox" data-change="spell-flag" data-flag="prepared" data-i="${i}" ${sp.prepared !== false ? 'checked' : ''} aria-label="Prepared"></td>
        <td><input type="text" data-bind="spells.${i}.notes" value="${esc(sp.notes || '')}" placeholder="1 action, 60 ft" aria-label="Notes"></td>
        <td style="text-align:right"><button class="btn quiet danger" data-act="remove-spell" data-i="${i}">Remove</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">No spells yet.</p>'}
    <div class="row" style="margin-top:10px"><input type="text" id="m-spell-name" placeholder="Spell name" class="grow" aria-label="Spell name">
      <input type="number" id="m-spell-level" min="0" max="9" value="0" aria-label="Spell level" title="0 for a cantrip">
      <button class="btn" data-act="m-add-spell">Add spell</button></div>
    <h4>Or add it from your library</h4>
    <p class="hint">Spells from the library can be rolled from the sheet: attack, save DC and damage are read from their text.</p>
    <div class="row"><input type="search" id="any-spell-q" placeholder="Search all spells" class="grow"><button class="btn" data-act="any-spell-search">Search</button></div>
    <div id="any-spell-results"></div></div>`;
};

function sheetHtml(interactive) {
  const c = S.char, sh = S.sheet;
  const line = [sh.class_line, sh.race_name, sh.background_name, c.alignment].filter(Boolean).join(', ');
  const spells = Object.entries(sh.spells);
  const R = (roll, extra = '') => `data-act="sheet-roll" data-roll="${roll}" ${extra}`;
  const B = (attrs, inner, cls = '', label = '') => (interactive
    ? `<button class="${cls} rollable" ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>`
    : `<div class="${cls}">${inner}</div>`);
  const rb = (attrs, inner, cls = 'roll-btn', label = '') => (interactive
    ? `<button class="${cls}" ${attrs}${label ? ` aria-label="${esc(label)}"` : ''}>${inner}</button>` : `<span>${inner}</span>`);
  const gearText = (sh.inventory_lines || []).join(', ');
  const dot = (p) => `<span class="dot ${p === 'expertise' ? 'exp' : p === 'proficient' || p === true ? 'on' : p === 'half' ? 'half' : ''}"></span>`;
  return `<article class="sheet">
      <header><h1>${esc(c.name || 'Unnamed hero')}</h1><div class="muted">${esc(line)}${c.player ? `. Played by ${esc(c.player)}` : ''}</div></header>
      <div class="scores">${ABILITIES.map((a) => B(R('check', `data-ab="${a}"`),
        `<span class="ab" style="display:block">${AB_NAME[a]}</span><span class="mod" style="display:block">${signed(sh.mods[a])}</span><span class="val" style="display:block">${sh.scores[a]}</span>`,
        'score', `Roll a ${AB_NAME[a]} check`)).join('')}</div>
      <div class="combat">
        <div><b>${interactive && coverBonus() ? sh.ac + coverBonus() : sh.ac}</b><span>Armor class${sh.ac_note ? ` (${esc(sh.ac_note)})` : ''}${interactive && coverBonus() ? ` <b>+${coverBonus()} ${esc(coverName())}</b>` : ''}</span></div>
        ${B(R('init'), `<b>${signed(sh.initiative)}</b><span>Initiative</span>`, '', 'Roll initiative')}
        <div><b>${sh.speed}</b><span>Speed (ft)</span></div>
        <div><b>${sh.hp_max || '–'}</b><span>Hit points</span></div>
        <div><b>${esc(sh.hit_dice || '–')}</b><span>Hit dice</span></div>
        <div><b>${signed(sh.prof)}</b><span>Proficiency</span></div><div><b>${sh.passive_perception}</b><span>Passive perception</span></div></div>
      <div class="sheet-cols">
        <div><h3>Saving throws</h3>${ABILITIES.map((a) => B(R('save', `data-ab="${a}"`), `<span>${dot(sh.saves[a].prof)}${AB_NAME[a]}</span><b>${signed(sh.saves[a].bonus)}</b>`, 'kv')).join('')}
          <h3 id="pl-skills">Skills</h3>${sh.skills.map((x) => B(R('skill', `data-skill-roll="${esc(x.name)}"`), `<span>${dot(x.prof)}${esc(x.name)} <span class="muted small">${x.ability.toUpperCase()}</span></span><b>${signed(x.bonus)}</b>`, 'kv')).join('')}
          <p class="small muted" style="margin-top:8px">Passive Investigation ${sh.passive_investigation}, Insight ${sh.passive_insight}${sh.darkvision ? `. Darkvision ${sh.darkvision} ft` : ''}${sh.size ? `. Size: ${esc(sh.size)}` : ''}</p></div>
        <div><h3 id="pl-attacks">Attacks</h3>${sh.attacks.length ? `<table class="list attacks"><thead><tr><th>Weapon</th><th>Hit</th><th>Damage</th><th>Properties</th></tr></thead><tbody>
            ${sh.attacks.map((a, i) => `<tr><td>${esc(a.name)}</td>
              <td>${rb(R('attack', `data-i="${i}"`), signed(a.bonus), 'roll-btn', `Roll ${a.name} attack`)}</td>
              <td>${rb(R('damage', `data-i="${i}"`), esc(a.damage), 'roll-btn', `Roll ${a.name} damage`)}
                ${a.versatile ? rb(R('damage', `data-i="${i}" data-two="1"`), `2H ${esc(a.versatile)}`, 'roll-btn small') : ''}</td>
              <td class="small muted">${esc(a.properties)}${a.ammo ? `<span class="ammo ${a.ammo.qty ? '' : 'out'}">${a.ammo.qty} ${esc(a.ammo.name.toLowerCase())}${a.ammo.qty === 1 ? '' : 's'}</span>${interactive && a.ammo.item && a.ammo.qty ? ` <button class="roll-btn small" data-act="ammo-use" data-id="${esc(a.ammo.item)}" aria-label="Use one ${esc(a.ammo.name.toLowerCase())}">Use 1</button>` : ''}` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No weapons at the ready.</p>'}
          ${sh.spellcasting.length ? `<h3 id="pl-spells">Spellcasting</h3>${sh.spellcasting.map((x) => `<p>${esc(x.class)}: ${AB_NAME[x.ability]}, save DC <b>${x.dc}</b>,
              spell attack ${rb(R('spell-attack', `data-slug="${esc(x.slug)}"`), signed(x.attack))}${x.prepared_count != null ? `, prepares ${x.prepared_count}` : ''}</p>`).join('')}
            <p class="small">${sh.slots.map((n, i) => (n ? `${ord(i + 1)}-level slots: ${n}` : '')).filter(Boolean).join('; ')}${sh.pact ? `${sh.slots.some((n) => n) ? '; ' : ''}Pact slots: ${sh.pact.count} × ${ord(sh.pact.level)} level` : ''}</p>` : ''}
          ${spells.length ? `${sh.spellcasting.length ? '' : '<h3>Spells</h3>'}${spells.map(([lvl, rows]) => `<h4>${lvl === '0' ? 'Cantrips' : ord(+lvl) + ' level'}</h4><table class="list"><tbody>${rows.map((x) => `<tr ${x.level > 0 && !x.prepared && !x.always ? 'class="muted"' : ''}>
              <td>${x.id ? `<a href="#" data-act="show-entry" data-id="${x.id}">${esc(x.name)}</a>` : esc(x.name)}${x.ritual ? ' <span class="tag">R</span>' : ''}${x.concentration ? ' <span class="tag">C</span>' : ''}${x.level > 0 && !x.prepared && !x.always ? ' <span class="small">(not prepared)</span>' : ''}</td>
              <td class="small">${esc(x.casting_time || x.notes || '')}</td><td class="small">${esc(x.range)}</td>
              <td class="small muted">${interactive ? `<button class="roll-btn small" ${R('spell', `data-id="${x.id || ''}" data-slug="${esc(x.class)}" data-level="${x.level || 0}" data-name="${esc(x.name)}"`)}>Cast</button>` : esc(x.duration)}</td></tr>`).join('')}</tbody></table>`).join('')}` : ''}
          <h3>Proficiencies &amp; languages</h3><p>${sh.proficiencies.map(esc).join('<br>')}${sh.languages ? `${sh.proficiencies.length ? '<br>' : ''}Languages: ${esc(sh.languages)}` : ''}</p>
          <h3>Equipment</h3><p>${esc(gearText) || (c.equipment ? '' : '<span class="muted">None yet.</span>')}${c.equipment ? (gearText ? '<br>' : '') + esc(c.equipment).replace(/\n/g, '<br>') : ''}${sh.coins_text ? `<br>Coins: ${esc(sh.coins_text)}` : ''}${sh.treasure_cp ? `<br>Treasure worth ${esc(money(sh.treasure_cp))}` : ''}${sh.attunement && sh.attunement.used ? `<br>Attuned (${sh.attunement.used} of ${sh.attunement.max}): ${esc(sh.attunement.items.join(', '))}` : ''}${sh.carry ? `<br><span class="small muted">Carrying ${sh.carry.weight} of ${sh.carry.capacity} lb</span>` : ''}</p>
          <h3 id="pl-features">Features &amp; traits</h3>${sh.features.map((f) => `<details class="feature"><summary>${esc(f.name)}<span>${esc(f.source || '')}</span></summary><div class="prose">${prose(f.text) || '<p class="muted">No description stored.</p>'}</div></details>`).join('') || '<p class="muted">None yet.</p>'}
          ${companionsSheetHtml()}
          ${(c.personality && Object.values(c.personality).some(Boolean)) || c.backstory ? `<h3>Personality</h3>${[['personality_traits', 'Traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws']].filter(([k]) => c.personality[k]).map(([k, l]) => `<p><b>${l}.</b> ${esc(c.personality[k])}</p>`).join('')}${c.backstory ? `<h4>Backstory</h4><div class="prose">${prose(c.backstory)}</div>` : ''}` : ''}
        </div></div></article>`;
}

STEP_RENDER.sheet = async () => {
  const sh = S.sheet;
  if (!sh) return '<p class="loading">Working out the numbers…</p>';
  const st = S.status || {};
  return `<div class="row no-print" style="margin-bottom:14px">
      <a class="btn primary" href="/api/characters/${S.charId}/pdf?dl=1">Download PDF</a>
      <a class="btn" href="/api/characters/${S.charId}/pdf" target="_blank" rel="noopener">Open PDF</a>
      <button class="btn" data-act="official-pdf">Fill the official sheet</button>
      <button class="btn" data-act="print">Print this page</button>
      <a class="btn" href="/api/characters/${S.charId}/export">Export JSON</a>
      ${sh.mode !== 'manual' ? '<button class="btn quiet" data-act="hand-copy">Make a hand-written copy</button>' : ''}</div>
    <p class="hint no-print">This is how the sheet prints. To roll dice and track hit points, open the <a href="#" data-act="char-tab" data-tab="play">Play</a> tab.${st.template ? '' : ' To fill the official character sheet, add your fillable sheet PDF in Settings first.'}</p>
    ${sheetHtml(false)}`;
};

/* ================================================================ play tab */
const CONDITIONS = ['Blinded', 'Charmed', 'Deafened', 'Frightened', 'Grappled', 'Incapacitated', 'Invisible', 'Paralyzed',
  'Petrified', 'Poisoned', 'Prone', 'Restrained', 'Stunned', 'Unconscious'];

function playState() {
  const c = S.char;
  c.play = c.play || {};
  const p = c.play;
  p.slots_used = p.slots_used || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  p.pact_used = p.pact_used || 0;
  p.hd_used = p.hd_used || {};
  p.death = p.death || { s: 0, f: 0 };
  p.conditions = p.conditions || [];
  p.trackers = p.trackers || [];
  p.temp = p.temp || 0;
  p.exhaustion = p.exhaustion || 0;
  return p;
}
const maxHp = () => { const m = (S.sheet && S.sheet.hp_max) || 0; return exhaustionLevel() >= 4 ? Math.floor(m / 2) : m; };
function curHp() {
  const p = playState();
  return p.hp == null ? maxHp() : Math.min(p.hp, maxHp());
}
function hitDiceTotals() {
  const out = {};
  ((S.sheet && S.sheet.hit_dice) || '').replace(/(\d+)\s*d\s*(\d+)/gi, (_, n, d) => { out[d] = (out[d] || 0) + +n; return ''; });
  return out;
}
function savePlay() { changed({ compute: false }); renderPlayMain(); }

function pips(n, used, act, extra = '') {
  return Array.from({ length: n }, (_, i) => `<button class="pip ${i < used ? 'used' : ''}" data-act="${act}" data-n="${i}" ${extra}
    aria-label="${i < used ? 'Used' : 'Available'}; click to mark ${i < used ? 'available' : 'used'}"></button>`).join('');
}

function renderPlayMain() {
  const el = $('#play-main');
  if (!el) return;
  const sh = S.sheet;
  if (!sh) { el.innerHTML = '<p class="loading">Working out the numbers…</p>'; return; }
  const p = playState();
  const hp = curHp(), max = maxHp();
  const pct = max ? Math.max(0, Math.min(100, Math.round((hp / max) * 100))) : 0;
  const hd = hitDiceTotals();
  const slotRows = sh.slots.map((n, i) => (n ? `<div class="res-row"><span>${ord(i + 1)}</span><span class="pips">${pips(n, Math.min(p.slots_used[i] || 0, n), 'slot', `data-level="${i + 1}"`)}</span>
      <span class="muted small">${n - Math.min(p.slots_used[i] || 0, n)} left</span></div>` : '')).join('');
  const pactRow = sh.pact ? `<div class="res-row"><span>Pact (${ord(sh.pact.level)})</span><span class="pips">${pips(sh.pact.count, Math.min(p.pact_used, sh.pact.count), 'pact')}</span>
      <span class="muted small">${sh.pact.count - Math.min(p.pact_used, sh.pact.count)} left</span></div>` : '';
  const mode = S.char.mode === 'manual';
  const scroll = window.scrollY;
  el.innerHTML = `${levelupBannerHtml(true)}${playJumpHtml()}<div class="play-top">
    <div class="panel vitals" id="pl-vitals">
      <div class="hp-line">
        <div><span class="hp-cur ${hp === 0 ? 'down' : ''}">${hp}</span><span class="hp-max"> / ${max}</span><span class="muted small"> hit points</span>
          ${p.temp ? `<span class="tag temp">+${p.temp} temporary</span>` : ''}</div>
      </div>
      <div class="hp-bar" role="img" aria-label="${hp} of ${max} hit points"><span style="width:${pct}%"></span></div>
      <div class="row hp-controls">
        <input type="number" min="0" id="hp-amount" placeholder="Amount" aria-label="Amount of damage or healing">
        <button class="btn" data-act="hp-damage">Take damage</button>
        <button class="btn" data-act="hp-heal">Heal</button>
        <button class="btn quiet" data-act="hp-temp">Set temporary HP</button>
      </div>
      ${concentrationHtml()}
      <details class="small" style="margin-top:6px"><summary style="cursor:pointer">Change maximum hit points</summary>
        <div class="row" style="margin-top:6px">${mode
          ? `<label class="field" style="margin:0"><span>Maximum</span><input type="number" min="0" data-bind="manual.hp_max" value="${esc((S.char.manual || {}).hp_max ?? '')}"></label>`
          : `<label class="field" style="margin:0"><span>Add to the maximum</span><input type="number" data-bind="hp_bonus" value="${S.char.hp_bonus || 0}"></label>
             <span class="hint">For magic items, feats or your DM. Rolled hit points are set on Build, Equipment &amp; HP.</span>`}</div></details>
      ${hp === 0 ? `<div class="death">
        <div class="res-row"><span>Successes</span><span class="pips good">${pips(3, p.death.s, 'death-s')}</span></div>
        <div class="res-row"><span>Failures</span><span class="pips bad">${pips(3, p.death.f, 'death-f')}</span></div>
        <div class="row"><button class="btn primary" data-act="sheet-roll" data-roll="death">Roll a death saving throw</button>
          <span class="${p.death.f >= 3 ? 'warn-text' : p.death.s >= 3 ? 'ok-text' : 'muted'}">${p.death.f >= 3 ? 'Three failures: your character dies.' : p.death.s >= 3 ? 'Three successes: stable at 0 hit points.' : 'At 0 hit points you roll each turn.'}</span></div></div>` : ''}
      <div class="res-row hd-row"><span>Hit dice</span><span class="row" style="gap:6px">${Object.entries(hd).sort((a, b) => b[0] - a[0]).map(([d, n]) => {
        const used = Math.min(p.hd_used[d] || 0, n);
        return `<button class="roll-btn" data-act="spend-hd" data-sides="${d}" ${used >= n ? 'disabled' : ''}>Spend d${d} <span class="muted">(${n - used} of ${n} left)</span></button>`;
      }).join('') || '<span class="muted">None set</span>'}</span></div>
      <div class="row rests"><button class="btn" data-act="short-rest">Short rest</button><button class="btn" data-act="long-rest">Long rest</button>
        <label class="check"><input type="checkbox" data-act="inspiration" ${p.inspiration ? 'checked' : ''}>Inspiration</label></div>
    </div>
    <div class="panel resources" id="pl-res">
      ${resourcesHtml()}
      ${slotRows || pactRow ? `<h3>Spell slots</h3>${slotRows}${pactRow}<p class="hint small">Click a circle to mark a slot used, or use Cast on a spell.</p>` : ''}
      <h3>Trackers</h3>
      ${p.trackers.map((t, i) => `<div class="res-row"><span>${esc(t.name)}</span>
        <span class="pips">${t.max <= 12 ? pips(t.max, Math.min(t.used, t.max), 'tracker', `data-i="${i}"`) : `<button class="roll-btn small" data-act="tracker-step" data-i="${i}" data-d="-1">−</button> ${t.max - t.used} / ${t.max} <button class="roll-btn small" data-act="tracker-step" data-i="${i}" data-d="1">+</button>`}</span>
        <span class="muted small">${t.reset === 'short' ? 'short rest' : t.reset === 'long' ? 'long rest' : ''}</span>
        <button class="btn quiet danger small" data-act="tracker-remove" data-i="${i}" aria-label="Remove ${esc(t.name)}">Remove</button></div>`).join('') || '<p class="hint small">For Rage, Ki, Bardic Inspiration, Channel Divinity, charges on a magic item…</p>'}
      <div class="row tracker-add"><input type="text" id="tr-name" placeholder="Name, like Rage" class="grow" aria-label="Tracker name">
        <input type="number" id="tr-max" min="1" max="99" value="2" aria-label="Uses">
        <select id="tr-reset" aria-label="Comes back on"><option value="long">Long rest</option><option value="short">Short rest</option><option value="">Never</option></select>
        <button class="btn" data-act="tracker-add">Add</button></div>
      <h3 id="pl-cond">Conditions</h3>
      <div class="toggles">${CONDITIONS.map((cnd) => `<label class="chip"><input type="checkbox" data-act="condition" data-name="${cnd}" ${p.conditions.includes(cnd) ? 'checked' : ''}>${cnd}</label>`).join('')}</div>
      <label class="field" style="margin-top:8px;max-width:200px"><span>Exhaustion</span><select data-act-change="exhaustion">${[0, 1, 2, 3, 4, 5, 6].map((n) => `<option value="${n}" ${p.exhaustion === n ? 'selected' : ''}>${n ? `Level ${n}: ${EXHAUSTION_TEXT[n].toLowerCase()}` : 'None'}</option>`).join('')}</select></label>
      ${coverHtml()}
      ${conditionEffectsHtml(sh)}
    </div></div>
    <div id="pl-comp">${wildShapePanelHtml()}
    ${playCompanionsHtml()}</div>
    ${playInventoryHtml()}
    <p class="hint no-print" style="margin:14px 0 8px">Click any score, save, skill, attack or spell on the sheet to roll it.</p>
    ${sheetHtml(true)}`;
  window.scrollTo(0, scroll);
}

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
    <div class="row" style="margin-top:14px">${e.source === 'srd' ? '' : e.source === 'wiki' ? `<button class="btn quiet" data-act="refresh-entry" data-id="${e.id}">Download this page again</button>` : `<button class="btn quiet danger" data-act="delete-entry" data-id="${e.id}">Delete from library</button>`}</div>`;
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
      <div class="row"><span class="hint">${count('race')} species, ${count('class')} classes, ${count('subclass')} subclasses, ${count('background')} backgrounds, ${count('feat')} feats, ${count('spell')} spells known; ${status.library.pages_cached} wiki pages saved on this PC</span>
        <button class="btn" data-act="sync">${count('class') ? 'Refresh wiki index' : 'Load wiki index'}</button></div></div>
    <div class="panel" style="margin-bottom:16px" id="phone-lib"></div>
    <div class="two-pane"><div class="panel">
      <div class="row" style="margin-bottom:10px"><input type="search" id="lib-q" placeholder="Search names and text" class="grow">
        <select id="lib-kind"><option value="">Everything</option>${Object.entries(KIND_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div>
      <label class="check small" style="margin-bottom:8px"><input type="checkbox" id="lib-all">Include Unearthed Arcana and homebrew</label>
      <div class="results" id="lib-results"><p class="hint">Search, or pick a type to list everything of that kind. Spells appear once a class’s spell list has been opened.</p></div>
      <details style="margin-top:12px"><summary class="small" style="cursor:pointer">Add your own entry</summary>
        <div style="margin-top:8px"><div class="row"><select id="own-kind">${['feat', 'spell', 'background', 'item', 'other'].map((v) => `<option value="${v}">${KIND_LABEL[v]}</option>`).join('')}</select>
          <input type="text" id="own-name" placeholder="Name" class="grow"></div>
          <textarea id="own-text" rows="4" placeholder="Rules text" style="margin-top:8px"></textarea>
          <button class="btn" data-act="add-own" style="margin-top:6px">Save to library</button></div></details>
    </div><div class="panel" id="lib-detail"><p class="hint">Pick an entry to read it.</p></div></div>`;
  renderPhoneLib();
  let t;
  const run = () => { clearTimeout(t); t = setTimeout(libSearch, 250); };
  $('#lib-q').addEventListener('input', run);
  $('#lib-kind').addEventListener('change', run);
  $('#lib-all').addEventListener('change', run);
}
/* Getting the whole library onto the Character Forge phone app: download every page, then export one file. */
let phoneLibTimer;
async function renderPhoneLib() {
  const box = $('#phone-lib');
  if (!box) return;
  const { status: j } = await api('/api/wiki/download-all');
  const pct = j.total ? Math.round((100 * j.done) / j.total) : 0;
  box.innerHTML = `<h3>Use this library on your phone</h3>
    <p class="hint">The Character Forge phone app can import everything here. First download every wiki page (about a second per page, so a full library takes 20 to 30 minutes; you can keep using the app), then export the file and open it in the phone app under Settings → Import library. The file is for your own use; don’t share it.</p>
    ${j.running ? `<p><b>Downloading… ${j.done} of ${j.total || '?'}</b> ${j.current ? `<span class="muted">(${esc(j.current)})</span>` : ''}</p>
      <div style="height:8px;background:var(--grid);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--pen)"></div></div>`
      : `${j.finished ? `<p class="note good">Downloaded ${j.done} pages${j.error_count ? `; ${j.error_count} couldn’t be read` : ''}.</p>` : ''}`}
    ${j.error_count ? `<details><summary class="small" style="cursor:pointer">Problems</summary><p class="small">${j.errors.map(esc).join('<br>')}</p></details>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn" data-act="download-all" ${j.running ? 'disabled' : ''}>Download all wiki pages</button>
      <a class="btn primary" href="/api/library/export">Export library for the phone app</a></div>`;
  clearTimeout(phoneLibTimer);
  if (j.running) phoneLibTimer = setTimeout(() => { if (S.view === 'library') renderPhoneLib(); }, 2000);
}

async function libSearch() {
  if (!$('#lib-q')) return;   // left the Library page before the search ran
  const q = $('#lib-q').value.trim(), kind = $('#lib-kind').value, all = $('#lib-all').checked;
  const box = $('#lib-results');
  if (!q && !kind) { box.innerHTML = '<p class="hint">Search, or pick a type to list everything of that kind.</p>'; return; }
  const params = new URLSearchParams({ q, kind, limit: 400 });
  if (all) params.set('all', '1');
  try {
    const { entries } = await api(`/api/entries?${params}`);
    box.innerHTML = entries.length ? entries.map((e) => `<div class="result" data-act="lib-pick" data-id="${e.id}" role="button" tabindex="0">
      <span>${esc(e.name)} ${sourceTag(e)}</span><span class="kind">${esc(KIND_LABEL[e.kind] || e.kind)}${e.parent ? ', ' + esc(e.parent) : ''}</span></div>`).join('')
      : '<p class="hint">Nothing matches. Wiki pages are searchable by text once they’ve been opened at least once.</p>';
  } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
}

/* ================================================================ PDFs view */
async function renderPdfs() {
  const [{ pdfs }, status] = await Promise.all([api('/api/pdfs'), api('/api/status')]);
  S.status = status;
  const keySet = status.config.api_key_set;
  $('#main').innerHTML = `<h1>Your PDFs</h1>
    <p class="hint">Add sourcebooks, supplements or homebrew you own. Their text stays on this PC and becomes searchable; Claude can pull spells, species, feats, backgrounds, classes and subclasses out of chosen pages so they appear in the builder next to the wiki’s.</p>
    <label class="drop" id="drop"><input type="file" accept=".pdf" multiple id="pdf-file">
      <b>Drop PDFs here</b> or click to choose files</label>
    <div id="upload-out"></div>
    ${pdfs.length ? `<div class="panel" style="margin-top:16px"><table class="list"><thead><tr><th>Book</th><th>Pages</th><th>Entries pulled</th><th></th></tr></thead><tbody>
      ${pdfs.map((p) => `<tr><td><a href="/api/pdfs/${p.id}/file" target="_blank" rel="noopener">${esc(p.title)}</a><div class="small muted">${esc(p.filename)}</div>
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
  const fd = new FormData();
  [...files].forEach((f) => fd.append('file', f));
  try {
    const { results } = await api('/api/pdfs', { method: 'POST', body: fd });
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
  const [status, tpl] = await Promise.all([api('/api/status'), api('/api/template')]);
  S.status = status;
  const c = status.config;
  S.theme = { ...THEME_DEFAULT, ...(c.theme || {}) };
  if (!IS_LOCAL) {   // a phone on the Wi-Fi link: only the look of the app can change from here
    $('#main').innerHTML = `<h1>Settings</h1>
      <div class="panel" style="margin-bottom:16px" id="appearance">${appearanceHtml()}</div>
      <div class="panel" id="phone-settings">${await phoneSettingsHtml()}</div>`;
    return;
  }
  $('#main').innerHTML = `<h1>Settings</h1>
  <div class="panel" style="margin-bottom:16px" id="appearance">${appearanceHtml()}</div>
  <div class="panel" style="margin-bottom:16px" id="phone-settings"><p class="loading">Loading…</p></div>
  <div class="panel" style="margin-bottom:16px"><h2>Claude</h2>
    <p class="hint">Optional. Without a key, drafting characters and pulling entries from PDFs work by copying prompts into a Claude chat and pasting the replies back. With a key from the Claude Console (platform.claude.com, under Settings, API keys), the app does it in one click; calls are billed to that account, usually a few cents per character.</p>
    <div class="grid2"><label class="field"><span>Anthropic API key ${c.api_key_set ? `<span class="muted">(saved, ends ${esc(c.api_key_hint)})</span>` : ''}</span>
      <input type="password" id="api-key" placeholder="${c.api_key_set ? 'Paste a new key to replace it' : 'sk-ant-…'}" autocomplete="off"></label>
      <label class="field"><span>Model</span><select id="model">${c.models.map((m) => `<option ${m === c.model ? 'selected' : ''}>${m}</option>`).join('')}</select></label></div>
    <div class="row"><button class="btn primary" data-act="save-claude">Save</button>${c.api_key_set ? '<button class="btn quiet danger" data-act="clear-key">Remove saved key</button>' : ''}</div>
    <p class="hint small" style="margin-top:8px">The key is stored in config.json in the app folder on this PC.</p></div>
  <div class="panel" style="margin-bottom:16px"><h2>Wiki</h2>
    <label class="field" style="max-width:300px"><span>Seconds between page downloads</span><input type="number" id="delay" min="0.5" step="0.5" value="${c.wiki_delay_seconds}" style="width:100px"></label>
    <label class="check"><input type="checkbox" id="show-ua" ${c.show_unearthed_arcana ? 'checked' : ''}>Show Unearthed Arcana (playtest) options in the builder</label><br>
    <label class="check"><input type="checkbox" id="show-hb" ${c.show_homebrew ? 'checked' : ''}>Show the wiki’s homebrew options in the builder</label>
    <div style="margin-top:10px"><button class="btn" data-act="save-wiki">Save</button></div></div>
  <div class="panel"><h2>Fillable character sheet</h2>
    <p class="hint">“Fill the official sheet” writes your character into a fillable character sheet PDF you supply, such as the free fillable 5th edition sheet from the official D&amp;D site. Features and spells that don’t fit are added as extra pages.</p>
    ${tpl.template ? `<p>Using <b>${esc(tpl.template)}</b>: ${tpl.fields.length} fillable fields, ${Object.keys(tpl.field_map).length - tpl.unmatched.length} of ${Object.keys(tpl.field_map).length} of the app’s fields matched.</p>
      ${tpl.unmatched.length ? `<details><summary class="small" style="cursor:pointer">${tpl.unmatched.length} not matched (these stay blank)</summary>
        <p class="small">${tpl.unmatched.map(esc).join(', ')}</p>
        <p class="hint small">To match them, edit templates/field_map.json in the app folder: each app field points at a field name from your PDF. Your PDF’s field names: ${tpl.fields.slice(0, 400).map((f) => esc(f.name)).join(', ')}</p></details>` : ''}`
      : '<p>No sheet added yet.</p>'}
    <label class="btn" style="cursor:pointer;margin-top:8px">${tpl.template ? 'Replace sheet PDF' : 'Add a fillable sheet PDF'}<input type="file" accept=".pdf" id="tpl-file" hidden></label></div>`;
  refreshPhoneSettings();
  $('#tpl-file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    try { await api('/api/template', { method: 'POST', body: fd }); toast('Sheet added.'); renderSettings(); }
    catch (err) { toast(err.message, 'error'); }
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

/* ================================================================ appearance */
function swatchHtml(id, t, slot) {
  const pressed = S.theme[slot] === id;
  return `<button class="swatch" data-act="pick-theme" data-slot="${slot}" data-id="${id}" aria-pressed="${pressed}">
    <span class="sw-preview" style="background:${t.paper}">
      <span class="sw-card" style="background:${t.panel};color:${t.ink}">Aa<span class="sw-bar" style="background:${t.accent}"></span></span></span>
    <span class="sw-name">${esc(t.name)}</span></button>`;
}
function appearanceHtml() {
  const th = S.theme;
  const custom = { name: 'Custom', ...th.custom };
  const presets = (dark) => Object.entries(THEMES).filter(([, t]) => t.dark === dark);
  const cc = th.custom;
  const textOk = contrast(cc.ink, cc.panel) >= 4.5, accentOk = contrast(cc.accent, cc.panel) >= 3;
  return `<h2>Appearance</h2>
    <div class="seg" role="radiogroup" aria-label="Light or dark" style="margin-bottom:14px">
      ${[['light', 'Light'], ['dark', 'Dark'], ['system', 'Match my computer']].map(([v, l]) =>
        `<label><input type="radio" name="theme-mode" value="${v}" ${th.mode === v ? 'checked' : ''}>${l}</label>`).join('')}</div>
    <h3>Light theme</h3>
    <div class="swatches">${presets(false).map(([id, t]) => swatchHtml(id, t, 'light')).join('')}${swatchHtml('custom', custom, 'light')}</div>
    <h3>Dark theme</h3>
    <div class="swatches">${presets(true).map(([id, t]) => swatchHtml(id, t, 'dark')).join('')}${swatchHtml('custom', custom, 'dark')}</div>
    <h3>Custom colors</h3>
    <p class="hint">Pick Custom above to use these. Borders, muted text and highlights are mixed from these four colors automatically.</p>
    <div class="color-row">
      ${[['paper', 'Background'], ['panel', 'Panels'], ['ink', 'Text'], ['accent', 'Accent']].map(([k, l]) =>
        `<label class="field"><span>${l}</span><input type="color" data-color="${k}" value="${cc[k]}"></label>`).join('')}</div>
    <div class="row"><button class="btn" data-act="copy-theme">Start from the current theme</button>
      <span class="small ${textOk && accentOk ? 'muted' : ''}" style="${textOk && accentOk ? '' : 'color:var(--warn)'}">
        ${textOk && accentOk ? 'Text and accent are easy to read on the panels.' : `${!textOk ? 'Text is hard to read on the panels. ' : ''}${!accentOk ? 'The accent is hard to see on the panels.' : ''}`}</span></div>`;
}
let themeSaveTimer;
function saveTheme() {
  applyTheme(S.theme);
  const box = $('#appearance');
  if (box) {
    const focused = document.activeElement && document.activeElement.dataset.color;
    box.innerHTML = appearanceHtml();
    if (focused) { const el = box.querySelector(`[data-color="${focused}"]`); if (el) el.focus(); }
  }
  clearTimeout(themeSaveTimer);
  themeSaveTimer = setTimeout(() => api('/api/settings', { json: { theme: S.theme } }).catch((e) => toast(e.message, 'error')), 400);
}
function setCustomColor(key, value, rerender) {
  S.theme.custom = { ...S.theme.custom, [key]: value };
  const usingCustom = S.theme[resolveTheme(S.theme).mode] === 'custom';
  if (usingCustom) applyTheme(S.theme);
  if (rerender) saveTheme();
}

/* ================================================================ actions */
function hpAmount() {
  const v = Math.max(0, Math.floor(+(($('#hp-amount') || {}).value || 0)));
  if (!v) toast('Type an amount first.', 'error');
  return v;
}
function applyDeathSave(res) {
  if (S.tab !== 'play' || !res) return;
  const p = playState();
  if (res.nat === 20) { p.hp = 1; p.death = { s: 0, f: 0 }; toast('Natural 20: back up with 1 hit point.'); }
  else if (res.nat === 1) p.death.f = Math.min(3, p.death.f + 2);
  else if (res.total >= 10) p.death.s = Math.min(3, p.death.s + 1);
  else p.death.f = Math.min(3, p.death.f + 1);
  savePlay();
}
function useSlot(level) {
  const sh = S.sheet, p = playState();
  if ((sh.slots[level - 1] || 0) - (p.slots_used[level - 1] || 0) > 0) { p.slots_used[level - 1] = (p.slots_used[level - 1] || 0) + 1; return 'slot'; }
  if (sh.pact && sh.pact.level === level && p.pact_used < sh.pact.count) { p.pact_used += 1; return 'pact'; }
  return null;
}
function slotsLeft(level) {
  const sh = S.sheet, p = playState();
  return Math.max(0, (sh.slots[level - 1] || 0) - (p.slots_used[level - 1] || 0))
    + (sh.pact && sh.pact.level === level ? Math.max(0, sh.pact.count - p.pact_used) : 0);
}
const pipToggle = (used, n) => (n < used ? n : n + 1);

const ACTIONS = {
  'char-tab': (t) => {
    S.tab = t.dataset.tab === 'play' ? 'play' : 'build';
    S.char.last_tab = S.tab;
    changed({ compute: false });
    renderBuilder();
    setHash();
    window.scrollTo(0, 0);
  },
  'hp-damage': () => {
    const n = hpAmount();
    if (!n) return;
    const p = playState();
    const hp = curHp();
    let left = n;
    if (p.temp) { const soak = Math.min(p.temp, left); p.temp -= soak; left -= soak; }
    if (hp === 0 && left > 0) { p.death.f = Math.min(3, p.death.f + 1); toast('Damage at 0 hit points counts as a failed death saving throw.'); }
    p.hp = Math.max(0, hp - left);
    concentrationAfterDamage(n);
    savePlay();
  },
  'hp-heal': () => {
    const n = hpAmount();
    if (!n) return;
    const p = playState();
    if (curHp() === 0) p.death = { s: 0, f: 0 };
    p.hp = Math.min(maxHp(), curHp() + n);
    savePlay();
  },
  'hp-temp': () => {
    const v = Math.max(0, Math.floor(+(($('#hp-amount') || {}).value || 0)));
    playState().temp = v;
    savePlay();
  },
  'spend-hd': (t) => {
    const d = t.dataset.sides, p = playState(), total = hitDiceTotals()[d] || 0;
    if ((p.hd_used[d] || 0) >= total) return;
    const res = rollDamage({ label: `Hit die (d${d})`, dice: `1d${d}`, mod: S.sheet.mods.con, heal: true });
    p.hd_used[d] = (p.hd_used[d] || 0) + 1;
    if (curHp() === 0 && res.total > 0) p.death = { s: 0, f: 0 };
    p.hp = Math.min(maxHp(), curHp() + res.total);
    savePlay();
  },
  'short-rest-now': () => {
    const p = playState();
    p.pact_used = 0;
    p.trackers.forEach((t) => { if (t.reset === 'short') t.used = 0; });
    const charges = restoreCharges('short');
    const res = restoreResources('short');
    savePlay();
    return { charges, res };
  },
  'long-rest-now': () => {
    const p = playState();
    p.hp = null; p.temp = 0; p.death = { s: 0, f: 0 };
    p.slots_used = [0, 0, 0, 0, 0, 0, 0, 0, 0]; p.pact_used = 0;
    p.trackers.forEach((t) => { if (t.reset) t.used = 0; });
    let regain = Math.max(1, Math.floor((S.sheet.total_level || 1) / 2));
    Object.keys(hitDiceTotals()).sort((a, b) => b - a).forEach((d) => {
      const back = Math.min(regain, p.hd_used[d] || 0);
      p.hd_used[d] = (p.hd_used[d] || 0) - back;
      regain -= back;
    });
    p.exhaustion = Math.max(0, (p.exhaustion || 0) - 1);
    restoreResources('long');
    endConcentration();
    (S.char.companions || []).forEach((x) => { x.hp = null; });
    p.form = null;
    const charges = restoreCharges('long');
    savePlay();
    return { charges };
  },
  inspiration: (t) => { playState().inspiration = t.checked; changed({ compute: false }); },
  condition: (t) => {
    const p = playState(), set = new Set(p.conditions);
    t.checked ? set.add(t.dataset.name) : set.delete(t.dataset.name);
    p.conditions = CONDITIONS.filter((x) => set.has(x));
    if (t.checked && INCAPACITATING.includes(t.dataset.name)) endConcentration(`you're ${t.dataset.name.toLowerCase()}`);
    savePlay();
  },
  slot: (t) => { const p = playState(), i = +t.dataset.level - 1; p.slots_used[i] = pipToggle(p.slots_used[i] || 0, +t.dataset.n); savePlay(); },
  pact: (t) => { const p = playState(); p.pact_used = pipToggle(p.pact_used, +t.dataset.n); savePlay(); },
  'death-s': (t) => { const p = playState(); p.death.s = pipToggle(p.death.s, +t.dataset.n); savePlay(); },
  'death-f': (t) => { const p = playState(); p.death.f = pipToggle(p.death.f, +t.dataset.n); savePlay(); },
  tracker: (t) => { const tr = playState().trackers[+t.dataset.i]; tr.used = pipToggle(tr.used, +t.dataset.n); savePlay(); },
  'tracker-step': (t) => { const tr = playState().trackers[+t.dataset.i]; tr.used = Math.max(0, Math.min(tr.max, tr.used - +t.dataset.d)); savePlay(); },
  'tracker-remove': (t) => { playState().trackers.splice(+t.dataset.i, 1); savePlay(); },
  'tracker-add': () => {
    const name = ($('#tr-name').value || '').trim();
    if (!name) { toast('Give the tracker a name.', 'error'); return; }
    playState().trackers.push({ name, max: Math.max(1, Math.min(99, +$('#tr-max').value || 1)), used: 0, reset: $('#tr-reset').value });
    savePlay();
  },
  'cast-spell': () => {
    const ctx = S.spellCtx;
    if (!ctx) return;
    const sel = document.getElementById('spell-slot');
    const level = sel ? +sel.value : ctx.effect.level;
    const kind = useSlot(level);
    if (!kind) { toast(`No ${ord(level)}-level slots left. Pick another level or take a rest.`, 'error'); return; }
    if (ctx.concentration) startConcentration(ctx.name);
    changed({ compute: false });
    toast(`Cast ${ctx.name} with a ${kind === 'pact' ? 'pact' : ord(level) + '-level'} slot. ${slotsLeft(level)} left at that level.`);
    if (sel) [...sel.options].forEach((o) => { o.textContent = `${ord(+o.value)} level (${slotsLeft(+o.value)} left)`; });
    renderPlayMain();
  },
  'toggle-dark': () => {
    S.theme = S.theme || { ...THEME_DEFAULT };
    const current = resolveTheme(S.theme);
    S.theme.mode = current.dark ? 'light' : 'dark';
    saveTheme();
  },
  'pick-theme': (t) => { S.theme[t.dataset.slot] = t.dataset.id; S.theme.mode = t.dataset.slot; saveTheme(); },
  'copy-theme': () => {
    const cur = resolveTheme(S.theme);
    S.theme.custom = { paper: cur.paper, panel: cur.panel, ink: cur.ink, accent: cur.accent };
    S.theme[cur.dark ? 'dark' : 'light'] = 'custom';
    saveTheme();
  },
  'sheet-roll': (t) => { doRoll(t.dataset); },
  'roll-follow': (t) => { const fn = FOLLOW.get(t.dataset.key); if (fn) fn(); },
  'spell-roll': (t) => { rollSpell(t.dataset.what); },
  'quick-die': (t) => { rollExpression(`1d${t.dataset.sides}`); },
  'roll-expr': () => { const tr = trayState(); if (tr.expr.trim()) rollExpression(tr.expr); },
  'clear-rolls': () => { const tr = trayState(); tr.history = []; FOLLOW.clear(); const h = $('#roll-history'); if (h) h.innerHTML = historyHtml(); $$('.roll-out').forEach((el) => { el.innerHTML = resultHtml(null); }); const l = $('.tray-last'); if (l) l.innerHTML = ''; },
  'tray-collapse': (t) => {
    const tr = trayState();
    tr.collapsed = !tr.collapsed;
    $('#live').classList.toggle('collapsed', tr.collapsed);
    t.textContent = tr.collapsed ? 'Show' : 'Hide';
    t.setAttribute('aria-expanded', String(!tr.collapsed));
    const peek = document.getElementById('roll-peek');
    if (peek && !tr.collapsed) peek.hidden = true;
  },
  'new-manual': async (t) => busy(t, 'Creating…', async () => {
    const { character } = await api('/api/characters/new?mode=manual');
    const { id } = await api('/api/characters', { json: { character } });
    await openChar(id, 'm_basics');
  }),
  'hand-copy': async (t) => busy(t, 'Copying…', async () => {
    await saveNow();
    const { id } = await api(`/api/characters/${S.charId}/hand-written-copy`, { method: 'POST' });
    toast('Made a hand-written copy. The original is unchanged.');
    await openChar(id, 'm_basics');
  }),
  'm-save': (t) => {
    const m = manualOf(S.char), set = new Set(m.save_profs || []);
    t.checked ? set.add(t.dataset.ab) : set.delete(t.dataset.ab);
    m.save_profs = ABILITIES.filter((a) => set.has(a));
    changed();
  },
  'm-add-attack': () => {
    const m = manualOf(S.char);
    (m.attacks = m.attacks || []).push({ name: '', ability: 'str', prof: true, bonus: 0, dice: '1d6', dmg_bonus: 0, add_mod: true,
      type: '', range: 'melee', finesse: false, versatile: '', notes: '' });
    changed(); renderStep();
  },
  'm-add-weapon': () => {
    const name = $('#m-weapon-pick').value;
    const w = name && S.srd.weapons[name];
    if (!w) { toast('Choose a weapon first.', 'error'); return; }
    const m = manualOf(S.char), sc = S.char.base_scores || {};
    const finesse = w.properties.includes('finesse');
    const ability = w.ranged ? 'dex' : finesse && (+sc.dex || 10) > (+sc.str || 10) ? 'dex' : 'str';
    const vers = (w.properties.find((p) => p.startsWith('versatile')) || '').match(/\((\d+d\d+)\)/);
    (m.attacks = m.attacks || []).push({ name, ability, prof: true, bonus: 0, dice: w.damage === '1' ? '1' : w.damage, dmg_bonus: 0,
      add_mod: true, type: w.type, range: w.ranged ? 'ranged' : 'melee', finesse, versatile: vers ? vers[1] : '', notes: w.properties.join(', ') });
    changed(); renderStep();
  },
  'm-remove-attack': (t) => { manualOf(S.char).attacks.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'm-add-rider': () => {
    const m = manualOf(S.char);
    (m.riders = m.riders || []).push({ name: '', dice: '', flat: 0, type: '', applies: 'weapon', once: false });
    changed(); renderStep();
  },
  'm-remove-rider': (t) => { manualOf(S.char).riders.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'm-add-spell': () => {
    const name = ($('#m-spell-name') || {}).value || '';
    if (!name.trim()) { toast('Type the spell’s name first.', 'error'); return; }
    S.char.spells = S.char.spells || [];
    S.char.spells.push({ name: name.trim(), level: +($('#m-spell-level').value || 0), prepared: true, class: 'manual', notes: '' });
    changed(); renderStep();
  },
  go: (t, e) => { e.preventDefault(); go(t.dataset.view); },
  step: (t) => { S.step = t.dataset.step; if (S.dirty) saveNow(); renderStep(); renderLive(); window.scrollTo(0, 0); },
  'race-skill': (t) => {
    const set = new Set(S.char.race_skills || []);
    t.checked ? set.add(t.dataset.skillName) : set.delete(t.dataset.skillName);
    S.char.race_skills = [...set]; changed(); renderStep();
  },
  'bg-skill': (t) => {
    const set = new Set(S.char.bg_skills || []);
    t.checked ? set.add(t.dataset.skillName) : set.delete(t.dataset.skillName);
    S.char.bg_skills = [...set]; changed(); renderStep();
  },
  'class-skill': (t) => {
    const name = t.dataset.skillName, set = new Set(S.char.skills || []);
    t.checked ? set.add(name) : set.delete(name);
    S.char.skills = [...set];
    changed();
    renderStep();
  },
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
  sync: (t) => busy(t, 'Reading the wiki…', async () => {
    const r = await api('/api/wiki/sync', { method: 'POST' });
    S.lists = {};
    if (r.errors.length) toast(r.errors.join(' '), 'error');
    else toast(`Index loaded: ${r.counts.race || 0} species, ${r.counts.class || 0} classes, ${r.counts.background || 0} backgrounds, ${r.counts.feat || 0} feats.`);
    go(S.view === 'builder' ? 'characters' : S.view);
  }),
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
  'add-class': () => { S.char.classes.push({ id: null, name: '', slug: '', level: 1, subclass: null }); renderStep(); },
  'remove-class': (t) => { S.char.classes.splice(+t.dataset.i, 1); changed(); renderStep(); },
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
    changed();
    computeNow().then(renderStep);
  },
  'spell-tab': (t) => {
    const ui = spellUi(t.dataset.slug);
    ui.tab = +t.dataset.level;
    const box = t.closest('[data-caster]');
    $$('[role=tab]', box).forEach((b) => b.setAttribute('aria-selected', String(b === t)));
    $$('.spell-pane', box).forEach((p) => { p.hidden = +p.dataset.pane !== ui.tab; });
  },
  'spell-more': async (t) => {
    const box = t.parentElement.querySelector('.spell-more');
    const open = box.hidden;
    box.hidden = !open;
    t.setAttribute('aria-expanded', String(open));
    t.textContent = open ? 'Hide' : 'Details';
    if (open && !box.innerHTML.trim()) {
      box.innerHTML = '<p class="loading" style="padding:4px 0">Loading…</p>';
      try {
        const d = (await detail(t.dataset.id)).data;
        box.innerHTML = `<p class="small muted" style="margin:0 0 4px">${esc([d.components, d.duration].filter(Boolean).join('; '))}</p>
          <div class="prose">${prose(d.description || d.text || '') || '<p class="muted">No description stored.</p>'}</div>
          ${d.higher_levels ? `<p><b>At higher levels.</b> ${esc(d.higher_levels)}</p>` : ''}`;
      } catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
    }
  },
  'spell-more-ok': (t) => { spellUi(t.dataset.slug).more = true; renderStep(); },
  'spell-reload': (t) => busy(t, 'Downloading…', async () => {
    const key = `spells:${t.dataset.slug}:${t.dataset.max}`;
    S.lists[key] = (await api(`/api/classes/${encodeURIComponent(t.dataset.slug)}/spells?max=${t.dataset.max}&refresh=1`)).spells;
    renderStep();
  }),
  'remove-spell': (t) => { S.char.spells.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'any-spell-search': async () => {
    const q = $('#any-spell-q').value.trim();
    const box = $('#any-spell-results');
    if (!q) return;
    const { entries } = await api(`/api/entries?kind=spell&all=1&q=${encodeURIComponent(q)}&limit=40`);
    const cls = (S.sheet.spellcasting[0] || {}).slug || '';
    box.innerHTML = entries.length ? entries.map((e) => `<div class="result"><span data-act="show-entry" data-id="${e.id}">${esc(e.name)} ${sourceTag(e)}</span>
      <button class="btn quiet" data-act="add-any-spell" data-id="${e.id}" data-name="${esc(e.name)}" data-class="${esc(cls)}">Add</button></div>`).join('')
      : '<p class="hint">No match. Only spells from class lists you’ve opened, and from your PDFs, are searchable.</p>';
  },
  'add-granted': (t) => busy(t, 'Adding…', async () => {
    const missing = [];
    for (const g of S.sheet.granted_spells || []) {
      const { entries } = await api(`/api/entries?kind=spell&all=1&q=${encodeURIComponent(g.name)}&limit=20`);
      const hit = entries.find((e) => e.name.toLowerCase() === g.name.toLowerCase());
      if (!hit) { missing.push(g.name); continue; }
      const d = await detail(hit.id);
      S.char.spells.push({ id: d.id, name: d.name, level: d.data.level || 0, class: g.class, prepared: true, always: true,
        ...(String(g.class).startsWith('feat:') ? { always_granted: true } : {}) });
    }
    if (missing.length) toast(`Couldn’t find ${missing.join(', ')} in the library; open that class’s spell list once, or add them by hand.`, 'error');
    changed(); await computeNow(); renderStep();
  }),
  'add-any-spell': async (t) => {
    const d = await detail(t.dataset.id);
    S.char.spells = S.char.spells || [];
    const manual = S.char.mode === 'manual';
    S.char.spells.push({ id: d.id, name: d.name, level: d.data.level || 0, class: manual ? 'manual' : t.dataset.class, prepared: true, always: !manual });
    toast(`Added ${d.name}.`);
    changed(); renderStep();
  },
  'add-extra': () => { (S.char.extra_features = S.char.extra_features || []).push({ name: '', text: '' }); renderStep(); },
  'remove-extra': (t) => { S.char.extra_features.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'show-entry': (t, e) => { e.preventDefault(); showEntryModal(t.dataset.id); },
  'close-modal': (t) => t.closest('.modal-back').remove(),
  print: () => { $$('details').forEach((d) => { d.open = true; }); window.print(); },
  'official-pdf': async (t) => busy(t, 'Filling…', async () => {
    const r = await fetch(`/api/characters/${S.charId}/pdf?kind=official`);
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Couldn’t fill the sheet'); }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${S.char.name || 'character'} - filled sheet.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }),
  'download-all': async (t) => {
    if (!confirm('Download every wiki page? It takes about a second per page (20 to 30 minutes for everything). You can keep using the app meanwhile.')) return;
    await api('/api/wiki/download-all', { method: 'POST' });
    renderPhoneLib();
  },
  'lib-pick': async (t) => {
    $$('.result[aria-selected]').forEach((r) => r.removeAttribute('aria-selected'));
    t.setAttribute('aria-selected', 'true');
    const box = $('#lib-detail');
    box.innerHTML = '<p class="loading">Loading…</p>';
    try { box.innerHTML = renderEntry(await detail(t.dataset.id)); }
    catch (e) { box.innerHTML = `<div class="note warn">${esc(e.message)}</div>`; }
  },
  'refresh-entry': (t) => busy(t, 'Downloading…', async () => {
    const { entry } = await api(`/api/entries/${t.dataset.id}?refresh=1`);
    S.details[entry.id] = entry;
    const box = t.closest('.modal') || $('#lib-detail');
    box.innerHTML = (box.classList.contains('modal') ? '<button class="btn quiet close" data-act="close-modal">Close</button>' : '') + renderEntry(entry);
    toast('Updated from the wiki.');
  }),
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
      <a href="/api/pdfs/${r.pdf_id}/file#page=${r.page}" target="_blank" rel="noopener">${esc(r.title)}, page ${r.page}</a>
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
  'clear-key': async () => { await api('/api/settings', { json: { clear_api_key: true } }); renderSettings(); },
  'save-wiki': (t) => busy(t, 'Saving…', async () => {
    await api('/api/settings', { json: { wiki_delay_seconds: +$('#delay').value, show_unearthed_arcana: $('#show-ua').checked, show_homebrew: $('#show-hb').checked } });
    S.lists = {}; toast('Saved.');
  }),
};

const CHANGES = {
  'pick-race': async (t) => {
    const id = +t.value;
    if (!id) { S.char.race = {}; changed(); renderStep(); return; }
    const d = await detail(id);
    const v = (d.selections || [])[0];
    S.char.race = { id, name: d.name, variant: v ? v.variant : null, subrace: null };
    S.char.race_skills = [];
    S.raceSel = null;
    await applyRaceBonus();
    changed(); renderStep();
  },
  'race-variant': async (t) => { S.char.race.variant = t.value; S.char.race.subrace = null; S.char.race_skills = []; S.raceSel = null; await applyRaceBonus(); changed(); renderStep(); },
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
    S.char.bg_skills = [];
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
  if (t.tagName === 'A' && !t.getAttribute('href')?.startsWith('/api')) e.preventDefault();
  Promise.resolve(fn(t, e)).catch((err) => toast(err.message, 'error'));
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const m = $('.modal-back'); if (m) m.remove(); }
  if (e.key === 'Enter' && e.target.matches('.result[data-act]')) e.target.click();
  if (e.key === 'Enter' && e.target.id === 'any-spell-q') ACTIONS['any-spell-search']();
  if (e.key === 'Enter' && e.target.id === 'tray-expr') ACTIONS['roll-expr']();
  if (e.key === 'Enter' && e.target.id === 'm-spell-name') ACTIONS['m-add-spell']();
});
function trayInput(t) {
  const tr = trayState();
  if (t.dataset.trayRider !== undefined) { tr.riders[t.dataset.trayRider] = t.checked; return true; }
  if (t.dataset.tray === undefined) return false;
  const k = t.dataset.tray;
  if (t.type === 'radio') { if (t.checked) tr[k] = t.value; } else if (t.type === 'checkbox') tr[k] = t.checked; else tr[k] = t.value;
  return true;
}
document.addEventListener('input', (e) => {
  const t = e.target;
  if (trayInput(t)) return;
  if (t.dataset.color) { setCustomColor(t.dataset.color, t.value); return; }
  if (t.dataset.bind && S.char && !(t.tagName === 'SELECT' || t.type === 'checkbox' || t.type === 'radio')) {
    setPath(S.char, t.dataset.bind, readValue(t));
    changed();
    if (t.dataset.bind === 'name') renderLive();
  }
  if (t.dataset.spellQ !== undefined) { spellUi(t.dataset.spellQ).q = t.value; applySpellFilters(t.dataset.spellQ); return; }
  if (t.dataset.filter !== undefined) {
    const q = t.value.trim().toLowerCase();
    (S.filters = S.filters || {})[t.dataset.filter] = t.value;
    $$(`[data-spell-group="${CSS.escape(t.dataset.filter)}"] .spell-row`).forEach((r) => { r.hidden = q && !r.dataset.spellName.includes(q); });
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.tray !== undefined || t.dataset.trayRider !== undefined) { trayInput(t); return; }
  if (t.dataset.actChange === 'exhaustion') { playState().exhaustion = +t.value; savePlay(); return; }
  if (t.dataset.spellSchool !== undefined) { spellUi(t.dataset.spellSchool).school = t.value; applySpellFilters(t.dataset.spellSchool); return; }
  if (t.dataset.spellRitual !== undefined) { spellUi(t.dataset.spellRitual).ritual = t.checked; applySpellFilters(t.dataset.spellRitual); return; }
  if (t.dataset.color) { setCustomColor(t.dataset.color, t.value, true); return; }
  if (t.name === 'theme-mode') { S.theme.mode = t.value; saveTheme(); return; }
  if (t.dataset.bind && S.char && (t.tagName === 'SELECT' || t.type === 'checkbox')) {
    setPath(S.char, t.dataset.bind, readValue(t));
    changed();
  }
  const fn = CHANGES[t.dataset.change];
  if (fn) Promise.resolve(fn(t, e)).catch((err) => toast(err.message, 'error'));
});
window.addEventListener('beforeprint', () => $$('details').forEach((d) => { d.open = true; }));
window.addEventListener('beforeunload', () => {
  if (window.OFFLINE || !S.charId || !S.char || !S.dirty) return;
  keepPending();   // if this last save doesn't make it, the next visit finishes it
  fetch(`/api/characters/${S.charId}`, { method: 'PUT', keepalive: true, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character: S.char, version: S.charVersion }) });
});

(async function init() {
  // every script on the page has to be loaded first (the offline table copy answers requests instantly)
  if (document.readyState === 'loading') await new Promise((r) => document.addEventListener('DOMContentLoaded', r));
  try {
    const [srd, status] = await Promise.all([api('/api/srd'), api('/api/status')]);
    S.srd = srd;
    S.status = status;
    S.theme = { ...THEME_DEFAULT, ...(status.config.theme || {}) };
    applyTheme(S.theme);
    if (window.OFFLINE) {
      document.body.classList.add('offline');
      document.body.insertAdjacentHTML('afterbegin', offlineBarHtml());
      await openChar(window.OFFLINE.character.id, null, 'play');
      return;
    }
    const m = location.hash.match(/^#c=(\d+)(?:&t=(play|build))?/);
    if (m) {
      try { await openChar(+m[1], null, m[2] || 'play'); return; } catch (e) { history.replaceState(null, '', location.pathname); }
    }
    go('characters');
  } catch (e) {
    $('#main').innerHTML = `<div class="note warn">${esc(e.message)}</div>`;
  }
})();
