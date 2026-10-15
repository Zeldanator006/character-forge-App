'use strict';
/* Feats: what each feat gives you, the picks it needs (spell lists, weapons), prerequisites,
   and the "Spells from feats" part of the Spells step. */

const FEAT_CLASS_NAMES = { bard: 'Bard', cleric: 'Cleric', druid: 'Druid', sorcerer: 'Sorcerer', warlock: 'Warlock', wizard: 'Wizard',
  artificer: 'Artificer', paladin: 'Paladin', ranger: 'Ranger' };

function featChoicesHtml(f, i, info) {
  const g = info.grants || {};
  const out = [];
  if ((info.gives || []).length) out.push(`<div class="small"><b>Gives you:</b> ${esc(info.gives.join('; '))}</div>`);
  const sp = g.spell_picks;
  if (sp && sp.choose_class) {
    out.push(`<label class="field inline-field"><span>Spell list</span><select data-change="feat-spell-class" data-i="${i}">
      <option value="">Choose a class…</option>${(sp.classes || []).map((k) => `<option value="${k}" ${f.spell_class === k ? 'selected' : ''}>${FEAT_CLASS_NAMES[k] || k}</option>`).join('')}</select></label>`);
  }
  if (g.weapons) {
    const chosen = f.weapons || [];
    const prof = new Set(((S.sheet || {}).gear_profs || {}).weapons || []);
    const full = chosen.length >= g.weapons;
    out.push(`<div class="small" style="margin-top:6px"><b>Weapons (${chosen.length} of ${g.weapons}):</b> ${esc(chosen.join(', ') || 'none yet')}</div>
      <details class="feat-weapons" ${chosen.length < g.weapons ? 'open' : ''}><summary class="small">Choose weapons</summary><div class="weapon-grid">
      ${Object.keys(S.srd.weapons).filter((w) => w !== 'Unarmed strike').map((w) => {
        const on = chosen.includes(w);
        const already = prof.has(w) && !on;
        return `<label class="check small ${already ? 'muted' : ''}"><input type="checkbox" data-act="feat-weapon" data-i="${i}" data-weapon="${esc(w)}" ${on ? 'checked' : ''} ${(full && !on) || already ? 'disabled' : ''}>${esc(w)}${already ? ' (already proficient)' : ''}</label>`;
      }).join('')}</div></details>`);
  }
  const links = [];
  if ((g.lists || []).length || g.inline) links.push('<a href="#" data-act="step" data-step="options">pick them on Class &amp; feat options</a>');
  if ((g.spells || []).length || sp) links.push('<a href="#" data-act="step" data-step="spells">choose the spells on the Spells step</a>');
  if (g.skills || g.skills_or_tools || g.expertise || g.tools || g.languages) links.push('<a href="#" data-act="step" data-step="skills">add the skills, tools or languages on the Skills step</a>');
  if (links.length) out.push(`<div class="small" style="margin-top:4px">Then ${links.join('; ')}.</div>`);
  return out.join('');
}

STEP_RENDER.feats = async () => {
  const c = S.char, sh = S.sheet;
  const feats = await list('feat');
  const race = await raceSelection();
  const infos = (sh && sh.feat_info) || [];
  const rows = [];
  for (let i = 0; i < (c.feats || []).length; i++) {
    const f = c.feats[i];
    let d = null;
    try { d = f.id ? await detail(f.id) : null; } catch (e) { d = null; }
    const opts = d ? d.data.asi_options || [] : [];
    const info = infos.find((x) => x.index === i) || {};
    const prereq = (d && d.data.prerequisite) || info.prerequisite || '';
    const problems = info.problems || [];
    rows.push(`<tr class="feat-main"><td><a href="#" data-act="show-entry" data-id="${f.id}">${esc(f.name)}</a>
        ${prereq ? `<div class="small ${problems.length ? 'warn-text' : 'muted'}">Prerequisite: ${esc(prereq)}${problems.length ? ` (you need ${esc(problems.join(', '))})` : ' ✓'}</div>` : ''}</td>
      <td><select data-change="feat-from" data-i="${i}"><option value="asi" ${f.from !== 'race' ? 'selected' : ''}>Level improvement</option>
        <option value="race" ${f.from === 'race' ? 'selected' : ''}>Species bonus feat</option></select></td>
      <td>${opts.length ? `<select data-change="feat-asi" data-i="${i}">${opts.map((a) => `<option value="${a}" ${f.asi === a ? 'selected' : ''}>+${d.data.asi_amount} ${AB_NAME[a]}</option>`).join('')}</select>` : '<span class="muted">–</span>'}</td>
      <td style="text-align:right"><button class="btn quiet danger" data-act="remove-feat" data-i="${i}">Remove</button></td></tr>
      ${info.grants ? `<tr class="feat-gives"><td colspan="4">${featChoicesHtml(f, i, info)}</td></tr>` : ''}`);
  }
  return `<div class="panel"><h2>Feats &amp; improvements</h2>
    <p>Your class levels give <b data-out="asi.available">${sh ? sh.asi.available : 0}</b> ability score improvements; you’re using <b data-out="asi.used">${sh ? sh.asi.used : 0}</b>.
      Each one is +2 to spend on scores, or one feat.${race && race.analysis.bonus_feat ? ' Your species also grants a bonus feat.' : ''}</p>
    <h3>Ability score increases from levels</h3>
    <div class="row">${ABILITIES.map((a) => `<label class="field" style="margin:0"><span>${AB_NAME[a]}</span>
      <input type="number" min="0" max="10" data-bind="improvements.${a}" value="${(c.improvements || {})[a] || 0}"></label>`).join('')}</div>
    <h3 style="margin-top:18px">Feats</h3>
    ${rows.length ? `<table class="list feats"><thead><tr><th>Feat</th><th>Taken as</th><th>Score increase</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="muted">No feats yet.</p>'}
    <div class="row" style="margin-top:10px"><select id="feat-pick">${options(feats, null, 'Choose a feat…')}</select>
      <button class="btn" data-act="add-feat">Add feat</button></div>
    <p class="hint small" style="margin-top:8px">Feats that let you pick something (Eldritch Adept’s invocation, Magic Initiate’s spells, Weapon Master’s weapons, Skilled’s skills…) show what to pick under their name. Prerequisites are checked against your character.</p></div>`;
};

/* ---------------------------------------------------------------- spells from feats (on the Spells step) */
async function featSpellList(cls) {
  S.featSpellLists = S.featSpellLists || {};
  const k = cls || '*';
  if (!S.featSpellLists[k]) {
    S.featSpellLists[k] = cls ? (await api(`/api/classes/${encodeURIComponent(cls)}/spells?max=1`)).spells
      : (await api('/api/spells?max=1')).spells;
  }
  return S.featSpellLists[k];
}

async function featSpellsHtml() {
  const c = S.char, sh = S.sheet;
  const infos = ((sh && sh.feat_info) || []).filter((x) => x.grants && ((x.grants.spells || []).length || x.grants.spell_picks));
  if (!infos.length) return '';
  let html = `<div class="panel"><h2>Spells from feats</h2>
    <p class="hint">These don’t count against your class’s limits. You can cast each 1st-level spell a feat gives you once per long rest without a slot (and with slots, if you have them).</p>`;
  for (const info of infos) {
    const f = c.feats[info.index] || {};
    const g = info.grants, sp = g.spell_picks, key = info.key;
    const caster = sh.spellcasting.find((x) => x.slug === `feat:${key}`);
    html += `<section class="caster feat-caster"><h3>${esc(info.name)}</h3>
      <p class="muted small">${caster ? `Cast with ${AB_NAME[caster.ability]}: save DC ${caster.dc}, spell attack ${signed(caster.attack)}.`
        : sp && sp.ability === 'asi' ? 'These use the ability the feat raises; choose it on the Feats step.'
          : sp && sp.choose_class ? 'These use the spellcasting ability of the class whose list you choose.' : ''}</p>`;
    if ((g.spells || []).length) {
      const have = (n) => (c.spells || []).some((s) => (s.name || '').toLowerCase() === n.toLowerCase());
      html += `<p>You learn ${g.spells.map((n) => `<b>${esc(n)}</b>${have(n) ? ' <span class="ok-text">✓</span>' : ''}`).join(', ')}.
        ${g.spells.some((n) => !have(n)) ? '<button class="btn small" data-act="add-granted">Add them</button>' : ''}</p>`;
    }
    if (sp) {
      const cls = sp.choose_class ? f.spell_class : (sp.classes || [])[0] || '';
      if (sp.choose_class && !cls) {
        html += `<label class="field inline-field"><span>Which class’s spell list</span><select data-change="feat-spell-class" data-i="${info.index}">
          <option value="">Choose a class…</option>${(sp.classes || []).map((k) => `<option value="${k}">${FEAT_CLASS_NAMES[k] || k}</option>`).join('')}</select></label>`;
      } else {
        let all = [];
        let err = '';
        try { all = await featSpellList(cls); } catch (e) { err = e.message; }
        if (err) html += `<div class="note warn">${esc(err)}</div>`;
        sp.picks.forEach((p, pi) => {
          const pool = all.filter((x) => x.level === p.level && (!p.schools || p.schools.includes(x.school)) && (!p.ritual || x.ritual));
          const mine = (c.spells || []).filter((s) => s.class === `feat:${key}` && !s.always_granted && (s.level || 0) === p.level);
          const full = mine.length >= p.count;
          const fid = `${key}-${pi}`;
          html += `<h4>${p.count} ${p.level === 0 ? 'cantrip' : `${ord(p.level)}-level spell`}${p.count > 1 ? 's' : ''} ${cls ? `from the ${FEAT_CLASS_NAMES[cls] || cls} list` : 'from any class’s list'}${p.schools ? ` (${p.schools.join(' or ')})` : ''}${p.ritual ? ', with the ritual tag' : ''}${p.note ? `: ${esc(p.note)}` : ''}
            <span class="limit inline ${mine.length > p.count ? 'over' : ''}"><b>${mine.length} / ${p.count}</b></span></h4>
            ${pool.length > 12 ? `<input type="search" class="opt-search" data-fs-q="${esc(fid)}" placeholder="Search" aria-label="Search spells">` : ''}
            <div class="fs-list" data-fs="${esc(fid)}">${pool.map((x) => {
              const on = mine.some((m) => (m.name || '').toLowerCase() === x.name.toLowerCase());
              return `<label class="check fs-row ${on ? 'picked' : ''}" data-name="${esc(x.name.toLowerCase())}"><input type="checkbox" data-act="feat-spell-toggle" data-feat="${esc(key)}"
                data-id="${x.id}" data-name="${esc(x.name)}" data-level="${x.level}" ${on ? 'checked' : ''} ${full && !on ? 'disabled' : ''}>${esc(x.name)}
                <span class="muted small">${esc(x.school || '')}${x.ritual ? ', ritual' : ''}</span></label>`;
            }).join('') || '<p class="muted small">No spells found. Open that class’s spell list on the Spells step once, or load the wiki index.</p>'}</div>`;
        });
      }
    }
    html += '</section>';
  }
  return html + '</div>';
}

Object.assign(ACTIONS, {
  'feat-weapon': (t) => {
    const f = S.char.feats[+t.dataset.i];
    const set = new Set(f.weapons || []);
    if (t.checked) set.add(t.dataset.weapon); else set.delete(t.dataset.weapon);
    f.weapons = [...set];
    changed();
    renderStep();
  },
  'feat-spell-toggle': (t) => {
    const key = t.dataset.feat;
    const spells = (S.char.spells = S.char.spells || []);
    const i = spells.findIndex((s) => s.class === `feat:${key}` && (s.name || '').toLowerCase() === t.dataset.name.toLowerCase());
    if (t.checked && i < 0) {
      spells.push({ id: +t.dataset.id, name: t.dataset.name, level: +t.dataset.level, class: `feat:${key}`, prepared: true, always: true });
    } else if (!t.checked && i >= 0) spells.splice(i, 1);
    changed();
    renderStep();
  },
});

Object.assign(CHANGES, {
  'feat-spell-class': (t) => {
    const f = S.char.feats[+t.dataset.i];
    if (!f) return;
    const before = f.spell_class;
    f.spell_class = t.value || undefined;
    const info = ((S.sheet || {}).feat_info || []).find((x) => x.index === +t.dataset.i);
    if (before && before !== t.value && info) {
      const n = (S.char.spells || []).length;
      S.char.spells = (S.char.spells || []).filter((s) => !(s.class === `feat:${info.key}` && !s.always_granted));
      if (S.char.spells.length < n) toast('Cleared the spells picked from the old list.');
    }
    changed();
    computeNow().then(() => renderStep());
  },
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.fsQ === undefined) return;
  const q = t.value.trim().toLowerCase();
  const box = document.querySelector(`[data-fs="${CSS.escape(t.dataset.fsQ)}"]`);
  if (box) $$('.fs-row', box).forEach((r) => { r.hidden = q && !r.dataset.name.includes(q); });
});
