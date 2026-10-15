'use strict';
/* Level up: pick a class, see what the new level brings, choose hit points (and a subclass or ability
   increase when it's time), then apply it. The character before the level up is kept so it can be undone. */

let LU = null;

function luModal(html) {
  let back = $('.lu-back');
  if (!back) {
    back = document.createElement('div');
    back.className = 'modal-back lu-back';
    back.innerHTML = '<div class="modal lu-modal" role="dialog" aria-modal="true" aria-labelledby="lu-title"></div>';
    back.addEventListener('click', (ev) => { if (ev.target === back) closeLevelUp(); });
    document.body.append(back);
  }
  $('.lu-modal', back).innerHTML = `<button class="btn quiet close" data-act="lu-close" aria-label="Close">Close</button>${html}`;
}
function closeLevelUp() {
  const b = $('.lu-back');
  if (b) b.remove();
  const done = LU && LU.done;
  LU = null;
  if (done && S.view === 'builder' && S.tab !== 'play') renderStep();
}

async function openLevelUp() {
  const c = S.char;
  if (c.mode === 'manual') { openManualLevelUp(); return; }
  const classes = (c.classes || []).filter((x) => x.id);
  if (!classes.length) { toast('Pick a class on the Class step first.', 'error'); return; }
  const total = classes.reduce((t, x) => t + (+x.level || 1), 0);
  if (total >= 20) { toast('Already 20th level: that’s as high as the 2014 rules go.', 'error'); return; }
  LU = { choice: { class_index: 0 }, preview: null, hpMode: c.hp_mode === 'rolled' ? 'rolled' : 'average', hpRoll: null,
    subclass: '', asiMode: 'later', asi: { a: 'str', b: 'dex' }, done: null, all: await list('class') };
  if (classes.length === 1) LU.choice = { class_index: 0 };
  renderLevelUp();
  await loadPreview();
}

function luChoiceHtml() {
  const c = S.char, ch = LU.choice;
  const rows = c.classes.map((x, i) => x.id ? `<label class="check lu-class"><input type="radio" name="lu-class" value="i:${i}" ${ch.class_index === i ? 'checked' : ''}>
      <span><b>${esc(x.name)} ${x.level} → ${(+x.level || 1) + 1}</b>${x.subclass && x.subclass.name ? ` <span class="muted small">${esc(x.subclass.name)}</span>` : ''}</span></label>` : '').join('');
  const have = new Set(c.classes.map((x) => x.slug));
  const others = LU.all.filter((e) => !have.has(((e.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-'))));
  const newOn = ch.class_id != null;
  return `<fieldset class="lu-pick"><legend>Which class gets the level?</legend>${rows}
    <label class="check lu-class"><input type="radio" name="lu-class" value="new" ${newOn ? 'checked' : ''}><span><b>A new class</b> <span class="muted small">(multiclass)</span></span></label>
    ${newOn || !rows ? `<select id="lu-new-class" aria-label="New class">${options(others, ch.class_id, 'Choose a class…')}</select>
      ${ch.class_id ? `<p class="small" style="margin:4px 0 0">${mcReqText(classSlugOf(ch.class_id))}</p>` : ''}` : ''}</fieldset>`;
}
function classSlugOf(id) {
  const e = LU.all.find((x) => String(x.id) === String(id));
  return e ? e.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : '';
}

function luPreviewHtml() {
  const p = LU.preview;
  if (LU.loading) return '<p class="loading">Working out what changes…</p>';
  if (LU.error) return `<div class="note warn">${esc(LU.error)}</div>`;
  if (!p) return '';
  const hp = p.hp;
  const avgGain = Math.max(1, hp.average + hp.con) + hp.extra;
  const rollGain = LU.hpRoll != null ? Math.max(1, LU.hpRoll + hp.con) + hp.extra : null;
  const list = [];
  if (p.prof[1] !== p.prof[0]) list.push(`Proficiency bonus ${signed(p.prof[0])} → <b>${signed(p.prof[1])}</b>`);
  p.slots.forEach((s) => list.push(`${ord(s.level)}-level spell slots ${s.before} → <b>${s.after}</b>`));
  if (p.pact) list.push(`Pact slots ${p.pact.before ? `${p.pact.before.count} × ${ord(p.pact.before.level)}` : 'none'} → <b>${p.pact.after ? `${p.pact.after.count} × ${ord(p.pact.after.level)}` : 'none'}</b>`);
  p.spells.forEach((s) => {
    const bits = [];
    if (s.new) bits.push('you start casting spells');
    if (s.cantrips_known) bits.push(`cantrips ${s.cantrips_known[0] ?? 0} → <b>${s.cantrips_known[1]}</b>`);
    if (s.spells_known) bits.push(`spells known ${s.spells_known[0] ?? 0} → <b>${s.spells_known[1]}</b>`);
    if (s.prepared_count) bits.push(`spells prepared ${s.prepared_count[0] ?? 0} → <b>${s.prepared_count[1]}</b>`);
    if (s.max_spell_level && s.max_spell_level[1] > (s.max_spell_level[0] || 0)) bits.push(`you can now learn <b>${ord(s.max_spell_level[1])}-level</b> spells`);
    if (bits.length) list.push(`${esc(s.class)}: ${bits.join(', ')}`);
  });
  p.options.forEach((o) => list.push(`${esc(o.label)}: ${o.before} → <b>${o.after}</b> <span class="muted">(${o.after - o.picked > 0 ? `${o.after - o.picked} to pick` : 'all picked'})</span>`));
  p.resources.forEach((r) => list.push(r.before == null ? `New: <b>${esc(r.name)}</b>${r.after != null ? ` (${r.after})` : ''}`
    : `${esc(r.name)} ${r.before ?? '∞'}${r.die_before ? ` ${r.die_before}` : ''} → <b>${r.after ?? 'unlimited'}${r.die ? ` ${r.die}` : ''}</b>`));
  const asiHtml = p.asi > 0 ? `<fieldset class="lu-asi"><legend>Ability Score Improvement</legend>
      ${[['asi2', '+2 to one score'], ['asi11', '+1 to two scores'], ['feat', 'A feat instead (pick it on the Feats step next)'], ['later', 'Decide later']].map(([v, l]) =>
        `<label class="check"><input type="radio" name="lu-asi" value="${v}" ${LU.asiMode === v ? 'checked' : ''}>${l}</label>`).join('')}
      ${LU.asiMode === 'asi2' || LU.asiMode === 'asi11' ? `<div class="row" style="margin-top:6px">
        ${luAbSelect('a')}${LU.asiMode === 'asi11' ? luAbSelect('b') : ''}</div>` : ''}
    </fieldset>` : '';
  return `<p class="lu-summary"><b>${esc(p.summary)}</b> <span class="muted small">${esc(p.class_line)}</span></p>
    ${p.multiclass_problems.length ? `<div class="note warn small">${p.multiclass_problems.map(esc).join('<br>')} You can still do it if your DM allows.</div>` : ''}
    <fieldset class="lu-hp"><legend>Hit points</legend>
      ${p.new_level === 1 && p.class_index === 0 ? '<p class="small">First level: you get the full hit die.</p>' : `
      <label class="check"><input type="radio" name="lu-hp" value="average" ${LU.hpMode === 'average' ? 'checked' : ''}>Take the average: <b>+${avgGain}</b> <span class="muted small">(${hp.average} on the d${hp.die}${hp.con ? `, ${signed(hp.con)} Constitution` : ''}${hp.extra ? `, ${signed(hp.extra)} from features` : ''})</span></label>
      <label class="check"><input type="radio" name="lu-hp" value="rolled" ${LU.hpMode === 'rolled' ? 'checked' : ''}>Roll the d${hp.die}${rollGain != null ? `: rolled <b>${LU.hpRoll}</b>, so <b>+${rollGain}</b>` : ''}</label>
      ${LU.hpMode === 'rolled' ? `<div class="row" style="margin:4px 0 0 26px"><button class="btn small" data-act="lu-roll">${LU.hpRoll != null ? 'Roll again' : `Roll d${hp.die}`}</button>
        <label class="small">or type what you rolled <input type="number" min="1" max="${hp.die}" id="lu-roll-in" value="${LU.hpRoll ?? ''}" style="width:64px"></label></div>` : ''}
      ${S.char.hp_mode !== 'rolled' && LU.hpMode === 'rolled' ? '<p class="hint small" style="margin:4px 0 0">Your earlier levels keep their average hit points.</p>' : ''}`}
    </fieldset>
    ${p.needs_subclass ? `<fieldset><legend>Subclass</legend><select id="lu-subclass" aria-label="Subclass"><option value="">Choose later…</option>${(LU.subs || []).map((s) =>
      `<option value="${s.id}" ${String(LU.subclass) === String(s.id) ? 'selected' : ''}>${esc(optionName(s))}</option>`).join('')}</select>
      <p class="hint small">${esc(p.class_name)} picks a subclass at level ${p.subclass_level}.</p></fieldset>` : ''}
    ${asiHtml}
    ${list.length ? `<h3>Also changing</h3><ul class="lu-list">${list.map((x) => `<li>${x}</li>`).join('')}</ul>` : ''}
    ${p.features.length ? `<h3>New features</h3>${p.features.map((f) => `<details class="feature"><summary>${esc(f.name)}<span>${esc(f.source)}</span></summary><div class="prose">${prose(f.text) || '<p class="muted">No description stored.</p>'}</div></details>`).join('')}` : ''}
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-act="lu-close">Cancel</button>
      <button class="btn primary" data-act="lu-apply">Level up</button></div>`;
}
function luAbSelect(k) {
  return `<select data-lu-ab="${k}" aria-label="Ability">${ABILITIES.map((a) => `<option value="${a}" ${LU.asi[k] === a ? 'selected' : ''}>${AB_NAME[a]} (${(S.sheet.scores || {})[a] ?? ''})</option>`).join('')}</select>`;
}

const STEP_LABEL = { class: 'Class', feats: 'Feats & improvements', spells: 'Spells', options: 'Class & feat options',
  companions: 'Companions & forms', story: 'Features & story', m_spells: 'Spells', m_combat: 'Combat & attacks' };

/* What a level up leaves to look at: things to pick, and things you're allowed to change at a new level. */
function luTodo(p, d) {
  const todo = [], add = (step, text) => todo.push({ step, label: STEP_LABEL[step] || step, text, from: `${p.class_name} ${p.new_level}` });
  if (p.needs_subclass && !d.subclass) add('class', `Pick your ${p.class_name} subclass`);
  if (p.new_class) {
    const mc = ((S.srd || {}).multiclass || {})[p.slug];
    add('class', mc && mc.skills ? `Pick the skill${mc.skills > 1 ? 's' : ''} ${p.class_name} gives when you multiclass` : `Check what multiclassing into ${p.class_name} gives you`);
  }
  if (p.asi > 0 && (d.asiMode === 'later' || d.asiMode === 'feat')) add('feats', d.asiMode === 'feat' ? 'Pick your feat' : 'Use your Ability Score Improvement');
  if (p.spells.length) {
    const bits = [];
    p.spells.forEach((sp) => {
      if (sp.cantrips_known) bits.push(`learn ${sp.cantrips_known[1] - (sp.cantrips_known[0] || 0)} more ${sp.class} cantrip${sp.cantrips_known[1] - (sp.cantrips_known[0] || 0) === 1 ? '' : 's'}`);
      if (sp.spells_known) bits.push(`learn ${sp.spells_known[1] - (sp.spells_known[0] || 0)} more ${sp.class} spell${sp.spells_known[1] - (sp.spells_known[0] || 0) === 1 ? '' : 's'}`);
      if (sp.prepared_count) bits.push(`prepare up to ${sp.prepared_count[1]} ${sp.class} spells`);
      if (sp.max_spell_level && sp.max_spell_level[1] > (sp.max_spell_level[0] || 0)) bits.push(`${ord(sp.max_spell_level[1])}-level ${sp.class} spells are open to you`);
    });
    if (p.slug === 'wizard') bits.unshift(p.new_level === 1 ? 'six spells in your spellbook' : 'add two spells to your spellbook');
    add('spells', bits.length ? bits.join(', ').replace(/^./, (x) => x.toUpperCase()) : 'Learn your new spells');
  } else if (p.caster) add('spells', `Look over your ${p.class_name} spells (you can swap or re-prepare some when you level)`);
  const groups = p.class_groups || [];
  p.options.filter((o) => o.after > o.picked).forEach((o) => add('options', `Pick ${o.after - o.picked} more ${o.label}`));
  if (!p.options.some((o) => o.after > o.picked) && groups.length) add('options', `Look over your ${groups.map((g) => g.label).join(', ')} (some can be swapped when you level)`);
  if (p.wild_shape) add('companions', `Wild Shape now: ${p.wild_shape[1]}`);
  else if (p.features.some((f) => /wild shape|companion|familiar|steed/i.test(f.name))) add('companions', 'Set up companions and Wild Shape forms');
  return todo;
}
function addLevelupTodo(items) {
  const c = S.char;
  const keep = (c.levelup_todo || []).filter((i) => !items.some((n) => n.step === i.step && n.text === i.text));
  c.levelup_todo = keep.concat(items);
}

/* The reminder at the top of each step until every step a level up touched has been opened. */
function markLevelupSeen(step) {
  const c = S.char;
  if (LU || S.tab === 'play') return;   // the level up window is still open over this step
  if (!c || !(c.levelup_todo || []).some((i) => i.step === step)) return;
  c.levelup_todo = c.levelup_todo.filter((i) => i.step !== step);
  changed();
}
function levelupBannerHtml(play) {
  const items = (S.char && S.char.levelup_todo) || [];
  if (!items.length) return '';
  const steps = [];
  items.forEach((i) => { if (!steps.includes(i.step)) steps.push(i.step); });
  return `<div class="note warn lu-banner no-print"><div class="row" style="justify-content:space-between;align-items:flex-start">
      <div><b>Level up not finished.</b> ${play ? 'On the Build tab, look' : 'Look'} at:</div>
      <button class="btn quiet small" data-act="lu-todo-clear">I’ve got it, hide this</button></div>
    <ul>${steps.map((st) => `<li><button class="btn quiet small" data-act="lu-go" data-step="${esc(st)}">${esc(STEP_LABEL[st] || st)} →</button>
      <span class="small">${items.filter((i) => i.step === st).map((i) => esc(i.text)).join('; ')}</span></li>`).join('')}</ul></div>`;
}

function luDoneHtml() {
  const todo = LU.done.todo || [];
  const p = LU.done.preview;
  return `<h2 id="lu-title">Level up done</h2>
    <p>${esc(S.sheet ? S.sheet.class_line : p.class_line)}, ${S.sheet ? S.sheet.hp_max : ''} hit points.</p>
    ${todo.length ? `<h3>Still to look at</h3><p class="hint small">A reminder stays at the top of the Build tab until you’ve opened each of these.</p>
      <ul class="lu-todo">${todo.map((i) => `<li><button class="btn quiet" data-act="lu-go" data-step="${esc(i.step)}">${esc(i.text)} →</button></li>`).join('')}</ul>`
      : '<p class="muted">Nothing else to pick.</p>'}
    <div class="row" style="margin-top:14px;justify-content:space-between"><button class="btn quiet" data-act="lu-undo">Undo this level up</button>
      <button class="btn primary" data-act="lu-close">Done</button></div>`;
}

function renderLevelUp() {
  if (!LU) return;
  if (LU.done) { luModal(luDoneHtml()); return; }
  luModal(`<h2 id="lu-title">Level up ${esc(S.char.name || '')}</h2>${luChoiceHtml()}<div id="lu-preview">${luPreviewHtml()}</div>`);
}

async function loadPreview() {
  if (!LU) return;
  const ch = LU.choice;
  if (ch.class_id === '' || (ch.class_id == null && ch.class_index == null)) { LU.preview = null; renderLevelUp(); return; }
  LU.loading = true; LU.error = null;
  renderLevelUp();
  try {
    const { preview } = await api('/api/levelup/preview', { json: { character: S.char, choice: ch } });
    if (!LU) return;
    LU.preview = preview;
    LU.subs = preview.needs_subclass ? (await api(`/api/classes/${encodeURIComponent(preview.slug)}/subclasses`)).entries : [];
  } catch (e) { if (LU) LU.error = e.message; }
  if (!LU) return;
  LU.loading = false;
  LU.hpRoll = null;
  renderLevelUp();
}

Object.assign(ACTIONS, {
  'levelup-open': () => openLevelUp().catch((e) => toast(e.message, 'error')),
  'lu-close': () => closeLevelUp(),
  'lu-roll': () => {
    const p = LU.preview;
    LU.hpRoll = rollDamage({ label: `Hit points for ${p.class_name} ${p.new_level} (d${p.hp.die})`, dice: `1d${p.hp.die}`, heal: true }).total;
    renderLevelUp();
  },
  'lu-apply': (t) => busy(t, 'Leveling up…', async () => {
    const p = LU.preview;
    if (!p) return;
    if (LU.hpMode === 'rolled' && LU.hpRoll == null && !(p.new_level === 1 && p.class_index === 0)) throw new Error(`Roll the d${p.hp.die} (or type what you rolled) first, or take the average.`);
    const data = { hp_mode: LU.hpMode, hp_roll: LU.hpRoll };
    if (LU.subclass) {
      const s = (LU.subs || []).find((x) => String(x.id) === String(LU.subclass));
      if (s) data.subclass = { id: s.id, name: s.name, path: s.path };
    }
    if (p.asi > 0 && LU.asiMode === 'asi2') data.asi = { [LU.asi.a]: 2 };
    if (p.asi > 0 && LU.asiMode === 'asi11') {
      if (LU.asi.a === LU.asi.b) throw new Error('Pick two different scores for +1 each.');
      data.asi = { [LU.asi.a]: 1, [LU.asi.b]: 1 };
    }
    const { character } = await api('/api/levelup/apply', { json: { character: S.char, choice: LU.choice, data } });
    S.char = character;
    S.raceSel = null;
    await saveNow();
    const { sheet } = await api('/api/compute', { json: { character: S.char } });
    S.sheet = sheet;
    LU.done = { preview: p, subclass: data.subclass, asiMode: LU.asiMode };
    LU.done.todo = luTodo(p, LU.done);
    if (LU.done.todo.length) {
      addLevelupTodo(LU.done.todo);
      await saveNow();
      S.sheet = (await api('/api/compute', { json: { character: S.char } })).sheet;
    }
    renderBuilder();
    renderLevelUp();
  }),
  'lu-go': (t) => {
    if (LU) LU.done = null;   // going straight to another step: don't count the one underneath as looked at
    closeLevelUp();
    S.tab = 'build';
    S.step = t.dataset.step;
    renderBuilder();
    window.scrollTo(0, 0);
  },
  'lu-undo': () => undoLevelUp(),
  'lu-todo-clear': () => {
    S.char.levelup_todo = [];
    changed();
    $$('.lu-banner').forEach((el) => el.remove());
  },
  'levelup-undo': () => undoLevelUp(),
});

async function undoLevelUp() {
  const snaps = S.char.snapshots || [];
  const last = snaps[snaps.length - 1];
  if (!last) { toast('Nothing to undo.', 'error'); return; }
  if (!confirm(`Undo the last level up? The character goes back to how it was (${last.label.replace(/^Before /, 'before ')}).`)) return;
  const play = S.char.play;
  S.char = { ...last.character, snapshots: snaps.slice(0, -1), play };
  closeLevelUp();
  await saveNow();
  await computeNow();
  renderBuilder();
  toast('Level up undone.');
}

document.addEventListener('change', (e) => {
  const t = e.target;
  if (!LU) return;
  if (t.name === 'lu-class') {
    if (t.value === 'new') LU.choice = { class_id: '' };
    else LU.choice = { class_index: +t.value.slice(2) };
    loadPreview();
  } else if (t.id === 'lu-new-class') { LU.choice = { class_id: t.value ? +t.value : '' }; loadPreview(); }
  else if (t.name === 'lu-hp') { LU.hpMode = t.value; renderLevelUp(); }
  else if (t.id === 'lu-roll-in') { const v = Math.floor(+t.value); LU.hpRoll = v >= 1 && v <= LU.preview.hp.die ? v : null; renderLevelUp(); }
  else if (t.id === 'lu-subclass') LU.subclass = t.value;
  else if (t.name === 'lu-asi') { LU.asiMode = t.value; renderLevelUp(); }
  else if (t.dataset.luAb) { LU.asi[t.dataset.luAb] = t.value; }
});

/* ---------------------------------------------------------------- hand-written sheets */
function openManualLevelUp() {
  const m = S.char.manual || {};
  const level = +m.level || 1;
  if (level >= 20) { toast('Already 20th level.', 'error'); return; }
  const die = ((m.hit_dice || '').match(/d(\d+)/) || [])[1] || '8';
  LU = { manual: true };
  luModal(`<h2 id="lu-title">Level up ${esc(S.char.name || '')}</h2>
    <p class="hint">A hand-written sheet doesn’t know your class features, so this bumps the level and hit points; add new features and spells yourself.</p>
    <div class="edit-grid">
      <label class="field wide"><span>Class and level</span><input type="text" id="lum-class" value="${esc(m.class_text || '')}"></label>
      <label class="field"><span>New total level</span><input type="number" id="lum-level" value="${level + 1}" min="1" max="20"></label>
      <label class="field"><span>Hit die</span><select id="lum-die">${[6, 8, 10, 12].map((d) => `<option value="${d}" ${String(d) === die ? 'selected' : ''}>d${d}</option>`).join('')}</select></label>
      <label class="field"><span>Hit points gained</span><input type="number" id="lum-hp" min="1" value="${Math.max(1, +die / 2 + 1 + ((S.sheet || {}).mods || {}).con || 0)}"></label>
    </div>
    <div class="row"><button class="btn small" data-act="lum-avg">Average</button><button class="btn small" data-act="lum-roll">Roll it</button>
      <span class="small muted">Includes your Constitution modifier (${signed(((S.sheet || {}).mods || {}).con || 0)}).</span></div>
    <div class="row" style="margin-top:14px;justify-content:flex-end"><button class="btn" data-act="lu-close">Cancel</button><button class="btn primary" data-act="lum-apply">Level up</button></div>`);
}
Object.assign(ACTIONS, {
  'lum-avg': () => { const d = +$('#lum-die').value; $('#lum-hp').value = Math.max(1, d / 2 + 1 + ((S.sheet || {}).mods || {}).con || 0); },
  'lum-roll': () => {
    const d = +$('#lum-die').value, con = ((S.sheet || {}).mods || {}).con || 0;
    const r = rollDamage({ label: `Hit points (d${d})`, dice: `1d${d}`, mod: 0, heal: true }).total;
    $('#lum-hp').value = Math.max(1, r + con);
  },
  'lum-apply': async () => {
    const c = S.char, m = (c.manual = c.manual || {});
    const snap = JSON.parse(JSON.stringify(c));
    delete snap.snapshots;
    const level = Math.max(1, Math.min(20, +$('#lum-level').value || (+m.level || 1) + 1));
    const gain = Math.max(0, +$('#lum-hp').value || 0);
    const d = +$('#lum-die').value;
    m.class_text = $('#lum-class').value;
    m.hp_max = (+m.hp_max || 0) + gain;
    const hd = (m.hit_dice || '').match(/^\s*(\d+)\s*d\s*(\d+)\s*$/i);
    if (hd && +hd[2] === d) m.hit_dice = `${+hd[1] + (level - (+m.level || 1))}d${d}`;
    else if (!(m.hit_dice || '').trim()) m.hit_dice = `${level}d${d}`;
    m.level = level;
    c.snapshots = (c.snapshots || []).concat([{ label: `Before level ${level}`, character: snap }]).slice(-5);
    addLevelupTodo([{ step: 'story', label: STEP_LABEL.story, text: 'Add the features your new level gives', from: `Level ${level}` },
      { step: 'm_spells', label: STEP_LABEL.m_spells, text: 'Add new spells and update your spell slots', from: `Level ${level}` }]);
    closeLevelUp();
    await saveNow();
    await computeNow();
    renderBuilder();
    toast(`Level ${level}: +${gain} hit points. Add new features and spells on the Build tab.`);
  },
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && LU) closeLevelUp(); });
