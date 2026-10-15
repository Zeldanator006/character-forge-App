'use strict';
/* Offline table copy: this file only goes into the single-file copy of a character (never the normal app).
   It answers the app's requests from the data saved in the file, and keeps changes in this browser. */
(function () {
  const O = window.OFFLINE;
  if (!O) return;
  const id = O.character.id;
  const KEY = `cb-table-${id}`;
  let store = null;
  let canStore = true;
  try {
    const raw = localStorage.getItem(KEY);
    store = raw ? JSON.parse(raw) : null;
  } catch (e) { canStore = false; }
  // a newer copy of the file wins over what an older one left behind
  if (store && store.made !== O.made) store = null;
  let char = store ? store.character : O.character;
  char.id = id;
  O.dirty = !!(store && store.dirty);
  O.canStore = canStore;
  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ made: O.made, character: char, dirty: true, saved: Date.now() }));
      O.canStore = true;
    } catch (e) { O.canStore = false; }
    O.dirty = true;
    if (typeof offlineBarRefresh === 'function') offlineBarRefresh();
  }
  O.current = () => char;

  const ok = (obj, status = 200) => Promise.resolve(new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } }));
  const no = (msg, status = 400) => ok({ error: msg }, status);
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts = {}) {
    const u = new URL(String(url), 'http://table.copy');
    const path = u.pathname, method = (opts.method || 'GET').toUpperCase();
    if (!path.startsWith('/api/')) return realFetch ? realFetch(url, opts) : no('Not available offline.', 404);
    const body = () => { try { return JSON.parse(opts.body || '{}'); } catch (e) { return {}; } };
    if (path === '/api/srd') return ok(O.srd);
    if (path === '/api/status') return ok(O.status);
    if (path === '/api/settings') {   // dark mode and colors: kept by the page itself (theme.js remembers them)
      const b = body();
      if (b.theme) O.status.config.theme = b.theme;
      return ok({ config: O.status.config });
    }
    if (path === '/api/characters' && method === 'GET') return ok({ characters: [{ id, name: char.name || 'Unnamed', summary: O.sheet.class_line || '', updated: O.made }] });
    if (path === `/api/characters/${id}/version`) return ok({ version: 0 });
    if (path === `/api/characters/${id}`) {
      if (method === 'GET') return ok({ character: char, version: 0 });
      if (method === 'PUT') { char = body().character || char; char.id = id; persist(); return ok({ ok: true, version: 0 }); }
    }
    // the numbers were worked out on the PC; play changes (hit points, slots, conditions) don't need them redone
    if (path === '/api/compute') return ok({ sheet: O.sheet });
    let m = path.match(/^\/api\/entries\/(\d+)$/);
    if (m) return O.entries[m[1]] ? ok({ entry: O.entries[m[1]] }) : no('That page isn’t in the table copy.', 404);
    m = path.match(/^\/api\/spell-effect\/(\d+)$/);
    if (m) return O.effects[m[1]] ? ok({ effect: O.effects[m[1]] }) : no('Not in the table copy.', 404);
    if (path === '/api/creatures/search') return ok({ creatures: O.wildshape_ok || [] });
    m = path.match(/^\/api\/creatures\/(.+)$/);
    if (m) {
      const c = O.creatures[decodeURIComponent(m[1])];
      return c ? ok({ creature: c }) : no('Only your saved forms and companions are in the table copy.', 404);
    }
    return no('That needs the app on your PC. The table copy only does what the Play tab does.');
  };
}());

/* The bar along the top of the table copy: what this is, and saving the changes for the PC. */
function offlineBarHtml() {
  const O = window.OFFLINE;
  const made = new Date(O.made * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  return `<div class="offline-bar no-print" id="offline-bar">
    <div><b>Table copy</b> <span class="small">made ${esc(made)}. Works without your PC.</span>
      <span class="small" id="offline-state">${offlineStateText()}</span></div>
    <button class="btn small primary" data-act="offline-save">Save changes for my PC</button></div>`;
}
function offlineStateText() {
  const O = window.OFFLINE;
  if (!O.canStore) return '<span class="warn-text">This browser won’t keep changes in the file, so save them before you close it.</span>';
  return O.dirty ? 'Changes are kept on this device.' : 'No changes yet.';
}
function offlineBarRefresh() { const el = document.getElementById('offline-state'); if (el) el.innerHTML = offlineStateText(); }

function offlineSaveChanges() {
  const O = window.OFFLINE;
  const char = O.current();
  const out = { cb_table_changes: 1, id: char.id, name: char.name, made: O.made, version: O.version, saved: Date.now() / 1000, character: char };
  const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${(char.name || 'character').replace(/[^\w\- ]+/g, '').trim() || 'character'} table changes.json`;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  if (typeof toast === 'function') toast('Saved. On your PC, open the character, click Phone, and bring these changes back.');
}
