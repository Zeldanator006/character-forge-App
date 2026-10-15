'use strict';
/* Where the phone app differs from the PC app's interface (ui/, loaded before this file): Settings, backups,
   files saved to the device instead of downloaded from a server, and nothing that needs the PC (the wiki,
   phones on the Wi-Fi, the fillable sheet). Everything else is the PC app's code as it is. */

/* In the store app the wiki can be read (native HTTP); show its buttons there */
if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.CapacitorHttp
  && (!window.Capacitor.isNativePlatform || window.Capacitor.isNativePlatform())) document.body.classList.add('wiki-ok');

const fileName = (n) => (n || 'character').replace(/[^\w\- ]+/g, '').trim() || 'character';

/** Save a file to the device: the share sheet where there is one (phones), a download otherwise. */
async function saveFile(name, data, type = 'application/json') {
  const file = new File([data], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------------------------------------------------------- links the PC serves as files */
// The PC interface links straight to /api/... for downloads; here those are answered on the device.
document.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href^="/api/"]');
  if (!a) return;
  e.preventDefault();
  e.stopPropagation();
  const href = a.getAttribute('href');
  const path = href.split('#')[0];
  // open the window now, while the tap still counts as the user's (pop-up blockers)
  const win = a.target === '_blank' && !/\/pdf(\?|$)/.test(path) ? window.open('', '_blank') : null;
  (async () => {
    if (/^\/api\/characters\/\d+\/pdf/.test(path)) {   // the sheet PDF is made on the PC; here the page prints
      $$('details').forEach((d) => { d.open = true; });
      window.print();
      return;
    }
    const r = await fetch(path);
    if (!r.ok) throw new Error(((await r.json().catch(() => null)) || {}).error || 'That isn’t available in the phone app.');
    if ((r.headers.get('content-type') || '').includes('json')) {
      const data = await r.json();
      if (win) win.close();
      if (data.character) await saveFile(`${fileName(data.character.name)}.json`, JSON.stringify(data.character, null, 2));
      else await saveFile(path.split('/').pop() + '.json', JSON.stringify(data, null, 2));
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob) + (href.includes('#') ? '#' + href.split('#')[1] : '');
    if (win) win.location.href = url;
    else await saveFile(path.split('/').pop(), blob, blob.type);
  })().catch((err) => { if (win) win.close(); toast(err.message, 'error'); });
}, true);

/* ---------------------------------------------------------------- settings */
renderSettings = async function renderSettings() {   // eslint-disable-line no-func-assign
  const status = await api('/api/status');
  S.status = status;
  const c = status.config;
  S.theme = { ...THEME_DEFAULT, ...(c.theme || {}) };
  let persisted = null;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : null; } catch (e) { /* unknown */ }
  $('#main').innerHTML = `<h1>Settings</h1>
  <div class="panel" style="margin-bottom:16px" id="appearance">${appearanceHtml()}</div>
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
      ${status.library.imported ? '<button class="btn quiet danger" data-act="clear-imported">Remove imported entries</button>' : ''}</div>
    <label class="check" style="margin-top:10px"><input type="checkbox" id="show-ua" data-change="phone-tags" ${c.show_unearthed_arcana ? 'checked' : ''}>Show Unearthed Arcana (playtest) options in the builder</label><br>
    <label class="check"><input type="checkbox" id="show-hb" data-change="phone-tags" ${c.show_homebrew ? 'checked' : ''}>Show homebrew options in the builder</label></div>
  ${c.wiki_available ? `<div class="panel" style="margin-bottom:16px"><h2>Wiki</h2>
    <p class="hint">Pages from dnd5e.wikidot.com are downloaded the first time you open them and kept on this device, so later visits are instant and work offline. ${status.library.pages_cached} pages saved so far.</p>
    <div class="row"><button class="btn primary" data-act="sync">${(status.library.kinds.class || {}).wiki ? 'Refresh wiki index' : 'Load wiki index'}</button></div>
    <label class="field" style="max-width:300px;margin-top:10px"><span>Seconds between page downloads</span><input type="number" id="delay" min="0.5" step="0.5" value="${c.wiki_delay_seconds}" style="width:100px" data-change="phone-delay"></label>
    <h3 style="margin-top:14px">Download everything</h3>
    <p class="hint">Saves every page of the wiki on this phone, so the whole library works offline. It reads one page a second, so it takes a while (around an hour); keep the app open. If it stops, start it again and it carries on where it left off.</p>
    <div id="dl-all"></div></div>` : ''}
  <div class="panel" style="margin-bottom:16px"><h2>Your data</h2>
    <p class="hint">Characters and entries you add are saved on this device only. Back them up to keep them safe or to move them to another device.</p>
    ${persisted === false ? '<p class="note">This browser may clear saved data if the device runs low on space. Installing the app (Add to Home screen) or making regular backups keeps your characters safe.</p>' : ''}
    <div class="row"><button class="btn primary" data-act="backup">Back up everything</button>
      <label class="btn" style="cursor:pointer">Restore a backup<input type="file" accept=".json,application/json" id="restore-file" hidden></label></div>
    <p class="hint small" style="margin-top:8px">Restoring adds the backup’s characters and entries next to what’s already here; nothing is overwritten.</p></div>
  <div class="panel"><h2>About</h2>
    <p>Character Forge builds characters for the world’s most popular fantasy tabletop roleplaying game, 5th edition (2014 rules), and runs them at the table. It works offline once loaded.</p>
    <p class="hint small">This work includes material taken from the System Reference Document 5.1 (“SRD 5.1”) by Wizards of the Coast LLC and available at
      <a href="https://dnd.wizards.com/resources/systems-reference-document" target="_blank" rel="noopener">dnd.wizards.com/resources/systems-reference-document</a>.
      The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at
      <a href="https://creativecommons.org/licenses/by/4.0/legalcode" target="_blank" rel="noopener">creativecommons.org/licenses/by/4.0/legalcode</a>.</p>
    <p class="hint small">Character Forge is unofficial and not affiliated with or endorsed by Wizards of the Coast.</p></div>`;
  if (c.wiki_available) renderDownloadAll();
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
        delete ch.id;
        await api('/api/characters', { json: { character: ch } });
      }
      S.lists = {}; S.details = {};
      toast(`Restored ${(doc.characters || []).length} characters and ${(doc.entries || []).length} entries.`);
    } catch (err) { toast('Couldn’t restore: ' + err.message, 'error'); }
    e.target.value = '';
  });
};

/** The "Download everything" progress in Settings; refreshes itself while the download runs. */
let dlTimer, dlWasRunning = false;
async function renderDownloadAll() {
  const box = $('#dl-all');
  if (!box) return;
  const { status: j } = await api('/api/wiki/download-all');
  if (dlWasRunning && !j.running) { dlWasRunning = false; renderSettings(); return; }   // update the page counts too
  dlWasRunning = j.running;
  const pct = j.total ? Math.round((100 * j.done) / j.total) : 0;
  box.innerHTML = j.running
    ? `<p><b>${esc(j.stage)}… ${j.total ? `${j.done} of ${j.total}` : ''}</b> ${j.current ? `<span class="muted">(${esc(j.current)})</span>` : ''}</p>
      <div style="height:8px;background:var(--grid);border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--pen)"></div></div>
      <div class="row" style="margin-top:8px"><button class="btn quiet" data-act="dl-stop">Stop</button></div>`
    : `${j.finished ? `<p class="note ${j.stage === 'Done' ? 'good' : ''}">${j.stage === 'Done' ? 'Finished' : 'Stopped'}: ${j.done} pages read${j.error_count ? `; ${j.error_count} couldn’t be read` : ''}.</p>` : ''}
      <div class="row"><button class="btn primary" data-act="dl-start">${j.finished ? 'Download the rest again' : 'Download everything'}</button></div>`;
  if (j.error_count) box.insertAdjacentHTML('beforeend', `<details><summary class="small" style="cursor:pointer">Problems</summary><p class="small">${j.errors.map(esc).join('<br>')}</p></details>`);
  clearTimeout(dlTimer);
  if (!j.running && j.finished) { S.lists = {}; S.details = {}; }   // lists made before the download are out of date
  if (j.running) dlTimer = setTimeout(() => { if (S.view === 'settings') renderDownloadAll(); }, 2000);
}

Object.assign(ACTIONS, {
  'dl-start': async () => {
    if (!confirm('Download every page of the wiki to this phone? It takes about an hour at one page a second. Keep the app open while it runs.')) return;
    await api('/api/wiki/download-all', { method: 'POST' });
    S.lists = {}; S.details = {};
    renderDownloadAll();
  },
  'dl-stop': async () => { await api('/api/wiki/download-all/stop', { method: 'POST' }); renderDownloadAll(); },
});

Object.assign(CHANGES, {
  'phone-delay': async (t) => {
    await api('/api/settings', { json: { wiki_delay_seconds: Math.max(0.5, +t.value || 1) } });
    toast('Saved.');
  },
  'phone-tags': async () => {
    await api('/api/settings', { json: { show_unearthed_arcana: $('#show-ua').checked, show_homebrew: $('#show-hb').checked } });
    S.lists = {}; S.details = {};
    toast('Saved.');
  },
});

Object.assign(ACTIONS, {
  'clear-imported': async () => {
    if (!confirm('Remove every entry imported from your PC? Characters that use them will show warnings until you import again.')) return;
    const { removed } = await api('/api/library/clear-imported', { method: 'POST' });
    S.lists = {}; S.details = {};
    toast(`Removed ${removed} entries.`); renderSettings();
  },
  backup: (t) => busy(t, 'Packing…', async () => {
    const { characters } = await api('/api/characters');
    const full = [];
    for (const c of characters) full.push((await api(`/api/characters/${c.id}`)).character);
    const mine = (await api('/api/entries?all=1')).entries.filter((e) => e.source !== 'srd');
    const entries = [];
    for (const e of mine) entries.push((await api(`/api/entries/${e.id}`)).entry);
    const stamp = new Date().toISOString().slice(0, 10);
    await saveFile(`Character Forge backup ${stamp}.json`, JSON.stringify({ app: 'character-forge', version: 1, characters: full, entries }, null, 2));
  }),
});
