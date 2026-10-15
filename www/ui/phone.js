'use strict';
/* Using the app on a phone at the table: the Wi-Fi link to the PC (with QR codes), the offline table copy,
   and bringing the table copy's changes back. */

const IS_LOCAL = ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(location.hostname);
// iPhones and iPads (iPadOS says it's a Mac, but has a touch screen)
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  try {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 3, scalable: true });
  } catch (e) { return ''; }
}

async function phoneStatus() { return (await api('/api/phone')).phone; }

/* The address phones use: the one the app picked, unless you chose another under "Phone can't connect?". */
function phoneBase(st) {
  const ip = S.phoneIp || st.addresses[0];
  return ip ? `http://${ip}:${st.port}/` : '';
}
function phoneLinkHtml(st, hash = '') {
  if (!st.running) return '';
  if (!st.urls.length && !S.phoneIp) return '<div class="note warn">This PC doesn’t seem to be on a network right now. Connect it to your Wi-Fi and try again.</div>';
  const base = phoneBase(st);
  const link = `${base}?key=${encodeURIComponent(st.key)}${hash}`;
  const others = st.addresses.filter((ip) => `http://${ip}:${st.port}/` !== base);
  return `<div class="qr-row"><div class="qr" role="img" aria-label="QR code for ${esc(link)}">${qrSvg(link)}</div>
    <div><p style="margin-top:0"><b>Scan this with your phone’s camera.</b> It opens the app and remembers the phone, so next time just open the address:</p>
      <p><code class="addr">${esc(base)}</code></p>
      ${others.length ? `<p class="small muted">If that doesn’t work, this PC also answers at ${others.map((ip) => `<code>http://${esc(ip)}:${st.port}/</code>`).join(', ')}.</p>` : ''}
      <p class="small muted">No camera? Open that address on the phone and type this code: <code class="addr">${esc(st.key)}</code></p>
      <p class="small"><b>Use this address, not the one in this PC’s address bar.</b> <code>127.0.0.1</code> always means “this same device”, so on a phone it points at the phone itself.</p>
      <p class="small muted">The phone has to be on the same Wi-Fi as this PC, and the app has to be running here.</p></div></div>`;
}

/* ---------------------------------------------------------------- when the phone can't connect */
function phoneHelpHtml() {
  return `<details class="phone-help" ${S.phoneHelpOpen ? 'open' : ''}><summary data-act="phone-help-toggle">Phone says the site can’t be reached?</summary>
    <ol class="small">
      <li><b>Open the address in Safari</b> (on Android, Chrome). If you get a page asking for a code, the connection works: type the code shown here.</li>
      <li><b>Chrome, Firefox or Edge on an iPhone</b> need permission to reach devices at home: on the iPhone, open Settings, then Apps, then that browser (or Privacy &amp; Security, then Local Network), and turn on <b>Local Network</b>.</li>
      <li><b>Same network:</b> the phone has to be on your home Wi-Fi, not mobile data, and not a guest network (guest networks keep devices apart).</li>
      <li><b>This PC:</b> Windows Firewall often blocks phones. Check it here:</li>
    </ol>
    <div class="row"><button class="btn" data-act="phone-check">Check this PC</button></div>
    <div id="phone-check-out">${S.phoneCheck ? phoneCheckHtml(S.phoneCheck) : ''}</div></details>`;
}

function phoneCheckHtml(r) {
  if (r.loading) return '<p class="loading">Checking Windows Firewall and your network (a few seconds)…</p>';
  if (r.fixStarted) {
    return `<div class="note">Windows asked for permission on this PC. If you said yes, a window ran the fix: when it says <b>Done</b>, close it and try the phone again.
      <div class="row" style="margin-top:6px"><button class="btn small" data-act="phone-check">Check again</button></div></div>`;
  }
  let html = '';
  if (r.supported === false) {
    html += '<p class="small">This check is for Windows. On a Mac, open System Settings, Network, Firewall, Options, and allow incoming connections for Python.</p>';
  } else if (r.error) {
    html += `<div class="note warn small">${esc(r.error)}</div>`;
  } else if (r.ok) {
    html += '<div class="note good small">Windows Firewall lets phones reach the app, and your network is set up for it. If the phone still can’t connect, try the steps above, or another address below.</div>';
  } else {
    html += `<div class="note warn small"><b>Found the problem:</b><ul>${r.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }
  if (r.supported !== false && (r.fixable || r.error)) {
    html += `<div class="row" style="margin:8px 0"><button class="btn primary" data-act="phone-fix">Fix it</button>
      <span class="small muted">Windows asks for permission, then a window removes the rules that block the app and lets phones in on this port. Only phones with your code get in, and only while the phone link is on.</span></div>`;
  }
  const addrs = (r.addresses || []).filter((a) => a.ip);
  const st = r.phone || {};
  if (addrs.length > 1 && st.running) {
    const cur = phoneBase(st);
    html += `<p class="small" style="margin:10px 0 4px"><b>This PC’s addresses.</b> The QR code uses the one marked; if your PC has extra network adapters, the right one is usually called Wi-Fi or Ethernet.</p>
      <table class="list small"><tbody>${addrs.map((a) => {
        const url = `http://${a.ip}:${st.port}/`;
        return `<tr><td><code>${esc(url)}</code></td><td>${esc(a.alias || '')}${a.virtual ? ' <span class="muted">(virtual adapter, probably not this one)</span>' : a.vpn ? ' <span class="muted">(VPN: reaches a phone that uses it too, from anywhere)</span>' : ''}</td>
          <td style="text-align:right">${url === cur ? '<b>In the QR code</b>' : `<button class="btn quiet small" data-act="phone-use-ip" data-ip="${esc(a.ip)}">Use this one</button>`}</td></tr>`;
      }).join('')}</tbody></table>`;
  }
  return html;
}

async function rerenderPhoneBoxes() {
  if ($('#phone-settings')) await refreshPhoneSettings();
  if ($('.phone-modal')) await renderPhoneModal();
}

/* ---------------------------------------------------------------- Settings: Use it on your phone */
async function phoneSettingsHtml() {
  if (!IS_LOCAL) {
    return `<h2>Use it on your phone</h2><p>You’re connected from another device. Phone settings are changed on the PC.</p>`;
  }
  let st;
  try { st = await phoneStatus(); } catch (e) { return `<h2>Use it on your phone</h2><div class="note warn">${esc(e.message)}</div>`; }
  return `<h2>Use it on your phone</h2>
    <p class="hint">Let phones and tablets on your Wi-Fi open the app running on this PC. Everything stays in sync: change hit points on the phone and the PC shows it a few seconds later. Only devices that scanned the code (it holds a private key) get in.</p>
    <label class="check"><input type="checkbox" data-act="phone-toggle" ${st.running ? 'checked' : ''}> Let my phone connect over Wi-Fi</label>
    ${st.error ? `<div class="note warn" style="margin-top:8px">${esc(st.error)}</div>` : ''}
    ${st.running ? `<div style="margin-top:12px">${phoneLinkHtml(st)}</div>
      <p class="hint small">The first time, Windows may ask whether Python can use your networks: tick <b>both</b> boxes (private and public) and click Allow. If the phone can’t connect, use <b>Check this PC</b> below.
      On the phone, use your browser’s <b>Add to Home Screen</b> to get an app icon.</p>
      <button class="btn quiet small" data-act="phone-newkey">New code (phones that scanned the old one are signed out)</button>
      ${phoneHelpHtml()}` : ''}
    <p class="hint small" style="margin-top:10px">Playing somewhere without this PC? Each character’s <b>Phone</b> button (at the top of the character) makes an offline table copy.</p>`;
}

async function refreshPhoneSettings() {
  const box = $('#phone-settings');
  if (box) box.innerHTML = await phoneSettingsHtml();
}

/* ---------------------------------------------------------------- the Phone window for a character */
async function openPhoneModal() {
  if (!S.charId) return;
  if (S.dirty) await saveNow();
  const back = document.createElement('div');
  back.className = 'modal-back phone-back';
  back.innerHTML = '<div class="modal phone-modal" role="dialog" aria-modal="true" aria-labelledby="phone-title"><p class="loading">Loading…</p></div>';
  back.addEventListener('click', (ev) => { if (ev.target === back) back.remove(); });
  document.body.append(back);
  await renderPhoneModal();
}

async function renderPhoneModal() {
  const box = $('.phone-modal');
  if (!box) return;
  const name = esc(S.char.name || 'this character');
  const hash = `#c=${S.charId}&t=play`;
  let wifi;
  if (!IS_LOCAL) {
    wifi = '<p>You’re already using the Wi-Fi link: this page talks to the app on your PC, and changes save there.</p>';
  } else {
    let st;
    try { st = await phoneStatus(); } catch (e) { st = { running: false, error: e.message }; }
    wifi = st.running ? `${phoneLinkHtml(st, hash)}<p class="small muted">This code opens ${name} straight on the Play tab.</p>${phoneHelpHtml()}`
      : `<p>Turn on the Wi-Fi link to open this character on your phone, with everything kept in sync with this PC.</p>
         ${st.error ? `<div class="note warn">${esc(st.error)}</div>` : ''}
         <button class="btn primary" data-act="phone-toggle-modal">Let my phone connect</button>`;
  }
  const copyUrl = `/api/characters/${S.charId}/table-copy`;
  let st2 = null;
  if (IS_LOCAL) { try { st2 = await phoneStatus(); } catch (e) { st2 = null; } }
  const copyQr = st2 && st2.running && phoneBase(st2) ? `${phoneBase(st2)}api/characters/${S.charId}/table-copy?key=${encodeURIComponent(st2.key)}` : '';
  const offline = IS_IOS
    ? `<p>An iPhone or iPad can’t use the offline table copy: Apple doesn’t let a downloaded web page run. To play on this phone away from your PC:</p>
       <ul class="small"><li><b>Keep the PC running at home and use the Wi-Fi link from anywhere</b> with a VPN that joins the phone and the PC into one network, such as Tailscale (free for personal use): install it on both, sign in with the same account, and the PC lists one more address in Settings. Scan the QR code for that address once.</li>
         <li><b>Take the sheet as a PDF</b> (Review &amp; export on the PC): it opens in Files or Books, without dice or tracking.</li>
         <li><b>An Android phone, a tablet or a laptop</b> can run the offline table copy; download it from the PC’s Phone window.</li></ul>`
    : `<p>A single file with ${name}’s Play tab inside: hit points, spell slots, class features, conditions, dice, inventory and companions. It works with no connection and keeps your changes on the device. Afterwards, save the changes and bring them back here.</p>
    <p class="note small"><b>Not for iPhone or iPad:</b> Apple doesn’t let a downloaded web page run there. On an iPhone, use the Wi-Fi link.</p>
    <div class="row"><a class="btn" href="${copyUrl}" download>Download the table copy</a>
      ${copyQr ? '<button class="btn quiet" data-act="phone-copy-qr">Or scan to download it on an Android phone</button>' : ''}</div>
    <div id="copy-qr" hidden>${copyQr ? `<div class="qr" style="margin-top:10px">${qrSvg(copyQr)}</div>` : ''}</div>
    <p class="hint small">Android: open the downloaded file from Chrome’s Downloads. Tablets and laptops: open it in any browser. The copy is a snapshot: make a new one after you change the character on the PC.</p>`;
  box.innerHTML = `<button class="btn quiet close" data-act="close-modal" aria-label="Close">Close</button>
    <h2 id="phone-title">Use ${name} on your phone</h2>
    <h3>At home: over Wi-Fi</h3>${wifi}
    <h3>${IS_IOS ? 'Away from your PC' : 'Anywhere: an offline table copy'}</h3>
    ${offline}
    ${IS_IOS ? '' : `<h3>Back from the table</h3>
    <p>In the table copy, tap <b>Save changes for my PC</b>, get that file to this PC, and choose it here. Hit points, slots, features used, conditions, inventory, coins and companions come back.</p>
    <label class="btn" style="cursor:pointer">Bring back table changes<input type="file" accept=".json,application/json" id="table-changes-file" hidden></label>`}`;
}

async function bringBackChanges(file, charId) {
  let data;
  try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('That file isn’t a table copy’s changes.'); }
  if (!data.cb_table_changes) throw new Error('That file isn’t a table copy’s changes (it should be named “… table changes.json”).');
  const target = charId || data.id;
  const res = await api(`/api/characters/${target}/table-changes`, { json: data });
  if (S.charId === target) {
    S.char = res.character;
    S.charVersion = res.version;
    S.base = clone(res.character);
    S.dirty = false;
    clearPending(target);
    if (S.view === 'builder') { renderBuilder(); computeNow(); }
  }
  toast(`Brought back the changes from the table.${res.note ? ' ' + res.note : ''}`);
  return target;
}

Object.assign(ACTIONS, {
  'phone-open': () => openPhoneModal().catch((e) => toast(e.message, 'error')),
  'phone-toggle': (t) => busy(null, '', async () => {
    const { phone } = await api('/api/phone', { json: { enabled: t.checked } });
    if (t.checked && !phone.running) toast(phone.error || 'Couldn’t start the Wi-Fi link.', 'error');
    await refreshPhoneSettings();
  }),
  'phone-toggle-modal': (t) => busy(t, 'Starting…', async () => {
    const { phone } = await api('/api/phone', { json: { enabled: true } });
    if (!phone.running) toast(phone.error || 'Couldn’t start the Wi-Fi link.', 'error');
    await renderPhoneModal();
  }),
  'phone-newkey': (t) => busy(t, 'Making a new code…', async () => {
    if (!confirm('Make a new code? Phones that connected with the old one will need to scan again.')) return;
    await api('/api/phone', { json: { new_key: true } });
    await refreshPhoneSettings();
  }),
  'phone-copy-qr': () => { const el = $('#copy-qr'); if (el) el.hidden = !el.hidden; },
  'phone-help-toggle': (t) => { S.phoneHelpOpen = !t.closest('details').open; },
  'phone-check': async () => {
    S.phoneHelpOpen = true;
    S.phoneCheck = { loading: true };
    $$('#phone-check-out').forEach((el) => { el.innerHTML = phoneCheckHtml(S.phoneCheck); });
    try { S.phoneCheck = await api('/api/phone/check'); } catch (e) { S.phoneCheck = { error: e.message, fixable: true }; }
    $$('#phone-check-out').forEach((el) => { el.innerHTML = phoneCheckHtml(S.phoneCheck); });
  },
  'phone-fix': (t) => busy(t, 'Asking Windows…', async () => {
    const r = await api('/api/phone/fix', { json: {} });
    if (!r.started) throw new Error(r.supported ? 'Couldn’t start the fix. Try running tools\\phone-firewall.ps1 by right-clicking it and choosing Run with PowerShell.' : 'This fix is for Windows.');
    S.phoneCheck = { ...S.phoneCheck, fixStarted: true };
    $$('#phone-check-out').forEach((el) => { el.innerHTML = phoneCheckHtml(S.phoneCheck); });
  }),
  'phone-use-ip': async (t) => {
    S.phoneIp = t.dataset.ip;
    await rerenderPhoneBoxes();
    toast(`The QR code now uses ${t.dataset.ip}. Scan it again on the phone.`);
  },
  'offline-save': () => offlineSaveChanges(),
  'jump': (t) => {
    const el = document.getElementById(t.dataset.target);
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY - 56;
    window.scrollTo({ top, behavior: 'smooth' });
  },
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id !== 'table-changes-file' || !t.files[0]) return;
  bringBackChanges(t.files[0], S.charId).then(() => { const m = t.closest('.modal-back'); if (m) m.remove(); })
    .catch((err) => toast(err.message, 'error'));
});

/* ---------------------------------------------------------------- the jump bar on the Play tab (phones) */
function playJumpHtml() {
  const sh = S.sheet || {}, c = S.char || {};
  const items = [['pl-vitals', 'HP'], ['pl-res', 'Features'], ['pl-cond', 'Conditions']];
  if ((c.companions || []).length || (sh.companions || {}).wild_shape || (playState().form)) items.push(['pl-comp', 'Companions']);
  items.push(['play-inv', 'Gear'], ['pl-attacks', 'Attacks']);
  if ((sh.spellcasting || []).length) items.push(['pl-spells', 'Spells']);
  items.push(['pl-skills', 'Skills'], ['pl-features', 'Traits']);
  return `<nav class="jump-bar no-print" aria-label="Jump to">${items.map(([id, l]) => `<button class="chip" data-act="jump" data-target="${id}">${l}</button>`).join('')}</nav>`;
}
