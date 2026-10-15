'use strict';
/* Class options: Eldritch Invocations, Pact Boon, Fighting Style, Metamagic, Battle Master maneuvers and the like. */

function optUi(key) {
  S.optUi = S.optUi || {};
  return (S.optUi[key] = S.optUi[key] || { q: '', more: false, ignore: false });
}
const samePick = (p, key, name) => p.key === key && (p.name || '').toLowerCase() === (name || '').toLowerCase();

function optGroupHtml(g, picks) {
  const ui = optUi(g.key);
  const mine = picks.filter((p) => p.key === g.key);
  const full = g.count != null && mine.length >= g.count && !ui.more;
  const q = ui.q.trim().toLowerCase();
  const rows = g.options.map((o) => {
    const on = mine.some((p) => samePick(p, g.key, o.name));
    const blocked = !on && (full || (o.unmet && !ui.ignore));
    const hide = q && !o.name.toLowerCase().includes(q);
    return `<div class="opt-row ${on ? 'picked' : ''} ${o.unmet ? 'unmet' : ''}" data-name="${esc(o.name.toLowerCase())}" ${hide ? 'hidden' : ''}>
      <label class="check"><input type="checkbox" data-act="opt-toggle" data-group="${esc(g.key)}" data-name="${esc(o.name)}" ${on ? 'checked' : ''} ${blocked ? 'disabled' : ''}><b>${esc(o.name)}</b></label>
      <span class="small ${o.unmet ? 'warn-text' : 'muted'}">${o.unmet ? esc(o.unmet[0].toUpperCase() + o.unmet.slice(1)) : o.prerequisite ? `Prerequisite: ${esc(o.prerequisite)}` : ''}</span>
      <span class="tags">${o.source ? `<span class="tag">${esc(o.source)}</span>` : ''}${(o.tags || []).includes('ua') ? '<span class="tag ua">UA</span>' : ''}</span>
      <button class="btn quiet small" data-act="opt-more" aria-expanded="false">Details</button>
      <div class="opt-text prose" hidden>${prose(o.text) || '<p class="muted">No description.</p>'}</div></div>`;
  }).join('');
  const leftover = g.options.some((o) => !mine.some((p) => samePick(p, g.key, o.name)));
  return `<section class="opt-group" data-group="${esc(g.key)}">
    <h3>${esc(g.label)} <span class="muted small">${String(g.source || '').startsWith('feat') ? `from the ${esc(g.feat || g.class_name)} feat` : `from ${esc(g.class_name)} ${g.class_level}`}</span></h3>
    <div class="limits"><div class="limit ${g.count != null && mine.length > g.count ? 'over' : ''}"><b>${mine.length}${g.count != null ? ` / ${g.count}` : ''}</b> picked</div>
      ${g.count == null ? '<span class="hint small">The app can’t tell how many you get; check your class.</span>' : ''}</div>
    ${g.error ? `<div class="note warn">${esc(g.error)} ${g.entry_id ? `<button class="btn small" data-act="opt-reload" data-id="${g.entry_id}">Download it again</button>` : ''}</div>` : ''}
    ${g.options.length > 8 ? `<input type="search" class="opt-search" data-opt-q="${esc(g.key)}" value="${esc(ui.q)}" placeholder="Search ${esc(g.label)}" aria-label="Search ${esc(g.label)}">` : ''}
    <div class="opt-list">${rows}</div>
    ${full && leftover ? `<p class="hint small">That’s all your level gives. <button class="btn quiet small" data-act="opt-more-ok" data-group="${esc(g.key)}">Let me pick more anyway</button></p>` : ''}
    ${g.options.some((o) => o.unmet) ? `<label class="check small" style="margin-top:6px"><input type="checkbox" data-act="opt-ignore" data-group="${esc(g.key)}" ${ui.ignore ? 'checked' : ''}>Let me pick options I don’t qualify for</label>` : ''}
  </section>`;
}

STEP_RENDER.options = async () => {
  const c = S.char;
  if (!(c.classes || []).some((x) => x.id)) {
    return '<div class="panel"><h2>Class &amp; feat options</h2><p class="hint">Choose a class on the Class step first.</p></div>';
  }
  const { groups } = await api('/api/class-options', { json: { character: c } });
  S.optGroups = groups;
  const picks = c.class_options || [];
  let html = `<div class="panel"><h2>Class &amp; feat options</h2>
    <p class="hint">Some class features and feats let you pick from a list: Eldritch Invocations (also through Eldritch Adept), a Pact Boon, a Fighting Style (also Fighting Initiate), Metamagic, Battle Master maneuvers and so on. Your picks print with your features. Options you don’t qualify for yet are greyed out, with the reason.</p>
    ${groups.length ? groups.map((g) => optGroupHtml(g, picks)).join('')
      : '<p>Nothing to pick yet. Lists show up here as you gain the levels for them (a warlock’s invocations at 2nd level, for example) or take a feat that gives one.</p>'}</div>`;
  const known = new Set(groups.map((g) => g.key));
  html += `<div class="panel"><h3>Your picks</h3>
    ${picks.length ? `<table class="list"><tbody>${picks.map((p, i) => `<tr><td><b>${esc(p.name)}</b></td>
        <td class="muted small">${esc(p.label || 'Class option')}${p.key && !known.has(p.key) && p.key !== 'custom' ? ' (not available at your current level)' : ''}</td>
        <td style="text-align:right"><button class="btn quiet danger small" data-act="opt-remove" data-i="${i}">Remove</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Nothing picked yet.</p>'}
    <details style="margin-top:10px"><summary class="small" style="cursor:pointer">Add one by hand (homebrew, or from a book)</summary>
      <div class="edit-grid" style="margin-top:8px">
        <label class="field wide"><span>Which list</span><select id="opt-hand-group">${groups.map((g) => `<option value="${esc(g.key)}">${esc(g.label)} (${esc(g.class_name)})</option>`).join('')}<option value="custom">Something else</option></select></label>
        <label class="field wide"><span>Name</span><input type="text" id="opt-hand-name" placeholder="Devil’s Sight"></label>
        <label class="field" style="grid-column:1/-1"><span>What it does</span><textarea rows="2" id="opt-hand-text"></textarea></label></div>
      <button class="btn" data-act="opt-hand">Add</button></details></div>`;
  return html;
};

Object.assign(ACTIONS, {
  'opt-toggle': (t) => {
    const g = (S.optGroups || []).find((x) => x.key === t.dataset.group);
    if (!g) return;
    const o = g.options.find((x) => x.name === t.dataset.name);
    const picks = (S.char.class_options = S.char.class_options || []);
    const i = picks.findIndex((p) => samePick(p, g.key, t.dataset.name));
    if (t.checked && i < 0 && o) {
      picks.push({ key: g.key, class: g.class, label: g.label, name: o.name, text: o.text || '', source: o.source || '',
        prerequisite: o.prerequisite || '' });
    } else if (!t.checked && i >= 0) picks.splice(i, 1);
    changed();
    renderStep();
  },
  'opt-more': (t) => {
    const box = t.parentElement.querySelector('.opt-text');
    box.hidden = !box.hidden;
    t.setAttribute('aria-expanded', String(!box.hidden));
    t.textContent = box.hidden ? 'Details' : 'Hide';
  },
  'opt-more-ok': (t) => { optUi(t.dataset.group).more = true; renderStep(); },
  'opt-ignore': (t) => { optUi(t.dataset.group).ignore = t.checked; renderStep(); },
  'opt-remove': (t) => { S.char.class_options.splice(+t.dataset.i, 1); changed(); renderStep(); },
  'opt-reload': (t) => busy(t, 'Downloading…', async () => {
    await api(`/api/entries/${t.dataset.id}?refresh=1`);
    renderStep();
  }),
  'opt-hand': () => {
    const name = $('#opt-hand-name').value.trim();
    if (!name) { toast('Give it a name first.', 'error'); $('#opt-hand-name').focus(); return; }
    const key = $('#opt-hand-group').value;
    const g = (S.optGroups || []).find((x) => x.key === key);
    (S.char.class_options = S.char.class_options || []).push({
      key: g ? g.key : 'custom', class: g ? g.class : '', label: g ? g.label : 'Class option', name, text: $('#opt-hand-text').value.trim(),
    });
    changed();
    renderStep();
  },
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.optQ === undefined) return;
  const ui = optUi(t.dataset.optQ);
  ui.q = t.value;
  const q = ui.q.trim().toLowerCase();
  const box = t.closest('.opt-group');
  $$('.opt-row', box).forEach((r) => { r.hidden = q && !r.dataset.name.includes(q); });
});
