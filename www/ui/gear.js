'use strict';
/* Equipment: starting gear from your class and background, the inventory, and the equipment list.
   Anything you're proficient with is shown in bold; anything you aren't is greyed out. */

const COINS = ['pp', 'gp', 'ep', 'sp', 'cp'];
const COIN_CP = { pp: 1000, gp: 100, ep: 50, sp: 10, cp: 1 };
const SHOP_TABS = [['all', 'Everything'], ['weapon', 'Weapons'], ['armor', 'Armor'], ['gear', 'Adventuring gear'],
  ['tool', 'Tools & instruments'], ['pack', 'Packs'], ['magic', 'Magic items']];
const SHOP_GROUPS = {
  weapon: ['simple melee', 'simple ranged', 'martial melee', 'martial ranged'], armor: ['light', 'medium', 'heavy', 'shield'],
  gear: ['gear', 'ammo', 'consumable', 'focus'], tool: ['tool', 'instrument'], pack: ['pack'],
};
const GROUP_LABEL = {
  'simple melee': 'Simple melee weapons', 'simple ranged': 'Simple ranged weapons', 'martial melee': 'Martial melee weapons',
  'martial ranged': 'Martial ranged weapons', light: 'Light armor', medium: 'Medium armor', heavy: 'Heavy armor', shield: 'Shields',
  gear: 'Adventuring gear', ammo: 'Ammunition', consumable: 'Potions, oil and supplies', focus: 'Spellcasting focuses and spellbooks',
  tool: 'Tools and kits', instrument: 'Musical instruments', pack: 'Equipment packs',
};
const KIND_ORDER = { armor: 0, shield: 1, weapon: 2, magic: 3, ammo: 4, focus: 5, tool: 6, instrument: 7, consumable: 8, treasure: 9, gear: 10, pack: 11 };

/* ---------------------------------------------------------------- small helpers */
function money(cp) {
  cp = +cp || 0;
  if (!cp) return 'free';
  if (cp >= 100) return `${+(cp / 100).toFixed(2)} gp`;
  if (cp >= 10 && Number.isInteger(cp / 10)) return `${cp / 10} sp`;
  return `${+cp.toFixed(2)} cp`;
}
const lbs = (w) => { w = +w || 0; return w ? `${+w.toFixed(2)} lb` : '–'; };
const coinTotal = (coins) => COINS.reduce((t, k) => t + (+(coins || {})[k] || 0) * COIN_CP[k], 0);
const purseText = () => {
  const c = (S.char && S.char.coins) || {};
  return COINS.filter((k) => +c[k]).map((k) => `${c[k]} ${k}`).join(', ') || 'no coins';
};
const newId = () => Math.random().toString(16).slice(2, 12);

// Pay `cost` copper from a purse, spending small coins first and taking change. Returns the new purse, or null.
function payCoins(coins, cost) {
  const left = Object.fromEntries(COINS.map((k) => [k, Math.max(0, Math.floor(+(coins || {})[k] || 0))]));
  if (coinTotal(left) < cost) return null;
  let owe = cost;
  for (const k of ['cp', 'sp', 'ep', 'gp', 'pp']) {
    const use = Math.min(left[k], Math.floor(owe / COIN_CP[k]));
    left[k] -= use;
    owe -= use * COIN_CP[k];
  }
  if (owe > 0) {
    const k = ['cp', 'sp', 'ep', 'gp', 'pp'].find((d) => left[d] > 0 && COIN_CP[d] >= owe);
    left[k] -= 1;
    let change = COIN_CP[k] - owe;
    for (const d of ['gp', 'sp', 'cp']) {
      if (COIN_CP[d] >= COIN_CP[k]) continue;
      const n = Math.floor(change / COIN_CP[d]);
      left[d] += n;
      change -= n * COIN_CP[d];
    }
  }
  return left;
}

let CATALOG_BY = null;
function catalogItem(name) {
  if (!CATALOG_BY) {
    CATALOG_BY = {};
    ((S.srd && S.srd.catalog) || []).forEach((x) => { CATALOG_BY[x.name] = x; if (x.base) CATALOG_BY[x.base] = x; });
  }
  return CATALOG_BY[name] || null;
}

function itemRole(it) {
  if (!it) return '';
  if (it.weapon && String(it.weapon.damage || '').trim()) return 'weapon';
  const a = it.armor;
  if (a && ['light', 'medium', 'heavy', 'shield'].includes(a.category)) return a.category === 'shield' ? 'shield' : 'armor';
  const b = it.base, srd = S.srd || { weapons: {}, armor: {} };
  if (b && srd.weapons[b]) return 'weapon';
  if (b === 'Shield') return 'shield';
  if (b && srd.armor[b]) return 'armor';
  return '';
}

/* 'yes' (proficient), 'focus' (your spellcasting focus), 'no' (not proficient) or '' (anyone can use it) */
function profStatus(name, kind) {
  const gp = S.sheet && S.sheet.gear_profs;
  if (!gp || !S.srd) return '';
  if (S.srd.weapons[name]) return gp.weapons.includes(name) ? 'yes' : 'no';
  if (name === 'Shield') return gp.shield ? 'yes' : 'no';
  const a = S.srd.armor[name];
  if (a) return gp.armor.includes(a.category) ? 'yes' : 'no';
  if ((gp.focus || []).includes(name)) return 'focus';
  kind = kind || (catalogItem(name) || {}).kind;
  if (kind === 'tool' || kind === 'instrument') return (gp.tools || []).includes(name) ? 'yes' : 'no';
  return '';
}
// the same, for an inventory item (which may have its own stats, a bond or a proficiency override)
function itemProf(it) {
  const role = itemRole(it), gp = S.sheet && S.sheet.gear_profs;
  if (!gp) return '';
  if (role === 'weapon') {
    if (it.bond === 'pact' || it.prof === 'yes') return 'yes';
    if (it.prof === 'no') return 'no';
    if (it.base && S.srd.weapons[it.base]) return profStatus(it.base);
    return (gp.weapon_cats || []).includes((it.weapon || {}).category || 'simple') ? 'yes' : 'no';
  }
  if (role === 'armor') {
    const cat = it.armor && it.armor.category ? it.armor.category : (S.srd.armor[it.base] || {}).category;
    return gp.armor.includes(cat) ? 'yes' : 'no';
  }
  if (role === 'shield') return gp.shield ? 'yes' : 'no';
  return profStatus(it.base || it.name, it.kind);
}
const PROF_TAG = {
  yes: '<span class="tag prof">proficient</span>', focus: '<span class="tag prof">your focus</span>',
  no: '<span class="tag noprof">not proficient</span>',
};
const profCls = (st) => (st === 'yes' || st === 'focus' ? 'is-prof' : st === 'no' ? 'not-prof' : '');
const profRank = (st) => (st === 'yes' || st === 'focus' ? 0 : st === '' ? 1 : 2);

function itemInfo(name) {
  const srd = S.srd;
  const w = srd.weapons[name];
  if (w) return `${w.damage} ${w.type}${w.properties.length ? `; ${w.properties.join(', ')}` : ''}`;
  if (name === 'Shield') return '+2 AC';
  const a = srd.armor[name];
  if (a) {
    return `${a.category} armor, AC ${a.base}${a.category === 'heavy' ? '' : a.maxdex == null ? ' + Dex' : ` + Dex (max ${a.maxdex})`}`
      + `${a.str ? `; Str ${a.str}` : ''}${a.stealth ? '; Stealth disadvantage' : ''}`;
  }
  return '';
}

// stats line for an inventory item, using its own stats when it has them
function itemStatsText(it) {
  const role = itemRole(it);
  if (role === 'weapon') {
    const w = weaponStats(it);
    const props = w.properties.map((p) => (p === 'versatile' && w.versatile ? `versatile (${w.versatile})` : (p === 'ammunition' || p === 'thrown') && w.range ? `${p} (${w.range})` : p));
    if (w.ranged && w.range && !props.some((p) => /^(ammunition|thrown)/.test(p))) props.push(`range ${w.range}`);
    return `${w.category} ${w.ranged ? 'ranged' : 'melee'}, ${w.damage} ${w.type}${props.length ? `; ${props.join(', ')}` : ''}`;
  }
  if (role === 'armor') {
    const a = armorStats(it);
    return `${a.category} armor, AC ${a.ac}${a.category === 'heavy' ? '' : a.maxdex === '' ? ' + Dex' : ` + Dex (max ${a.maxdex})`}${+a.str ? `; Str ${a.str}` : ''}${a.stealth ? '; Stealth disadvantage' : ''}`;
  }
  if (role === 'shield') return `+${it.armor && it.armor.category === 'shield' ? +it.armor.ac || 2 : 2} AC`;
  if (it.contents) return it.contents.map(([n, q]) => (q > 1 ? `${n} ×${q}` : n)).join(', ');
  return '';
}

// a weapon's stats in editable form: its own, or the weapon it works as
function weaponStats(it) {
  if (it.weapon && String(it.weapon.damage || '').trim()) {
    return { category: 'simple', ranged: false, damage: '', type: '', properties: [], versatile: '', range: '', ...it.weapon,
      properties: [...(it.weapon.properties || [])] };
  }
  const w = S.srd.weapons[it.base] || { category: 'simple', ranged: false, damage: '1d6', type: 'slashing', properties: [] };
  const out = { category: w.category, ranged: !!w.ranged, damage: w.damage, type: w.type, properties: [], versatile: '', range: '' };
  w.properties.forEach((p) => {
    const m = p.match(/^([a-z-]+)\s*\(([^)]*)\)/);
    const flag = m ? m[1] : p;
    if ((S.srd.weapon_flags || []).includes(flag)) out.properties.push(flag);
    if (m && flag === 'versatile') out.versatile = m[2];
    if (m && (flag === 'ammunition' || flag === 'thrown')) out.range = m[2].replace(/\s*range\s*/, '');
  });
  return out;
}
function armorStats(it) {
  if (it.armor && ['light', 'medium', 'heavy'].includes(it.armor.category)) {
    return { ac: 11, maxdex: '', str: 0, stealth: false, ...it.armor, maxdex: it.armor.maxdex == null ? '' : String(it.armor.maxdex) };
  }
  const a = S.srd.armor[it.base] || { category: 'light', base: 11, maxdex: null, str: 0, stealth: false };
  return { category: a.category, ac: a.base, maxdex: a.category === 'heavy' ? '0' : a.maxdex == null ? '' : String(a.maxdex), str: a.str || 0, stealth: !!a.stealth };
}

function acIfWorn(base) {
  const sh = S.sheet, a = S.srd.armor[base];
  if (!sh || !a) return null;
  const dex = sh.mods.dex;
  let ac = a.base + (a.category === 'heavy' ? 0 : a.maxdex == null ? dex : Math.min(dex, a.maxdex));
  const held = (S.char.inventory || []).find((i) => itemRole(i) === 'shield' && i.equipped);
  if (held) ac += 2 + (+held.bonus || 0);
  return ac + (+S.char.ac_bonus || 0);
}

const gearKey = () => {
  const sh = S.sheet || {};
  return JSON.stringify([sh.gear_profs, sh.mods && sh.mods.dex, sh.attunement && sh.attunement.used, sh.pact_blade]);
};

/* ---------------------------------------------------------------- adding to the inventory */
function mergeItem(inv, it) {
  const stackable = !['armor', 'shield', 'pack'].includes(it.kind) && !it.notes;
  const same = stackable && inv.find((x) => x.name === it.name && x.kind === it.kind && (+x.bonus || 0) === (+it.bonus || 0)
    && !x.notes && x.carried !== false);
  if (same) same.qty = (+same.qty || 0) + (+it.qty || 1);
  else inv.push(it);
}

function addItems(items, { replace = false, coins = null } = {}) {
  const c = S.char;
  if (replace) {
    c.inventory = [];
    c.coins = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  }
  c.inventory = c.inventory || [];
  items.forEach((it) => mergeItem(c.inventory, it));
  if (coins) {
    c.coins = c.coins || {};
    Object.entries(coins).forEach(([k, v]) => { c.coins[k] = (+c.coins[k] || 0) + v; });
  }
  // put on armor and pick up a shield if nothing is worn yet and you can use them
  for (const role of ['armor', 'shield']) {
    if (c.inventory.some((i) => itemRole(i) === role && i.equipped)) continue;
    const pick = items.filter((i) => itemRole(i) === role && c.inventory.includes(i) && itemProf(i) !== 'no')
      .sort((a, b) => (acIfWorn(b.base) || armorStats(b).ac || 0) - (acIfWorn(a.base) || armorStats(a).ac || 0))[0];
    if (pick) pick.equipped = true;
  }
}

async function makeItems(list) {
  return (await api('/api/gear/make', { json: { items: list } })).items;
}

/* ---------------------------------------------------------------- starting equipment */
function gearPick() {
  if (!S.gearPick || S.gearPick.charId !== S.charId) {
    S.gearPick = { charId: S.charId, method: null, opt: {}, pick: {}, bg: true, gold: '', goldNote: '' };
  }
  return S.gearPick;
}

async function startingGearData() {
  const c = S.char, cl = (c.classes || [])[0] || {}, bg = c.background || {};
  const key = `${cl.id || ''}:${bg.id || ''}`;
  S.startGear = S.startGear || {};
  if (!S.startGear[key]) {
    S.startGear[key] = await api(`/api/starting-gear?class_id=${cl.id || ''}&background_id=${bg.id || ''}`);
  }
  return S.startGear[key];
}

function choiceSelect(e, key) {
  const pk = gearPick();
  const opts = e.options.map((n) => [n, profStatus(n)]);
  const good = opts.filter(([, s]) => s !== 'no'), bad = opts.filter(([, s]) => s === 'no');
  if (!e.options.includes(pk.pick[key])) pk.pick[key] = (good[0] || opts[0])[0];
  const cur = pk.pick[key];
  const label = (n) => { const w = S.srd.weapons[n]; return w ? `${n} (${w.damage} ${w.type})` : n; };
  const o = ([n]) => `<option value="${esc(n)}" ${n === cur ? 'selected' : ''}>${esc(label(n))}</option>`;
  const inner = good.length && bad.length
    ? `<optgroup label="Proficient">${good.map(o).join('')}</optgroup><optgroup label="Not proficient">${bad.map(o).join('')}</optgroup>`
    : opts.map(o).join('');
  return `<span class="gi choose ${profCls(profStatus(cur))}"><select data-change="sg-pick" data-key="${key}" aria-label="Choose ${esc(e.label)}">${inner}</select>${e.qty > 1 ? ` ×${e.qty}` : ''}</span>`;
}

function entryHtml(e, key) {
  if (e.coins) return `<span class="gi coin">${Object.entries(e.coins).map(([k, v]) => `${v} ${k}`).join(', ')}</span>`;
  if (e.choose) return choiceSelect(e, key);
  const it = e.item, st = profStatus(it.base || it.name, it.kind);
  const title = it.contents ? ` title="${esc(it.contents.map(([n, q]) => (q > 1 ? `${n} ×${q}` : n)).join(', '))}"` : '';
  return `<span class="gi ${profCls(st)}"${title}>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}${st === 'no' ? ' <span class="small">(not proficient)</span>' : ''}${it.contents ? ' <span class="small muted">(pack)</span>' : ''}</span>`;
}

// the option to start on: the first one where you can use everything
function defaultOption(line) {
  const ok = (opt) => opt.every((e) => !e.item || profStatus(e.item.base || e.item.name, e.item.kind) !== 'no');
  const i = line.options.findIndex(ok);
  return i < 0 ? 0 : i;
}

async function startGearBody() {
  const c = S.char, pk = gearPick();
  if (!(c.classes || []).some((x) => x.id)) return '<p class="hint">Choose a class on the Class step to see its starting equipment.</p>';
  const d = await startingGearData();
  if (!pk.method) pk.method = d.class.length ? 'class' : 'gold';
  const has = (c.inventory || []).length > 0;
  const w = d.wealth;
  let html = `<div class="row" role="radiogroup" aria-label="How to get your equipment" style="margin-bottom:6px">
    <label class="check"><input type="radio" name="sg-method" value="class" data-change="sg-method" ${pk.method === 'class' ? 'checked' : ''}>Take my class’s starting equipment</label>
    <label class="check"><input type="radio" name="sg-method" value="gold" data-change="sg-method" ${pk.method === 'gold' ? 'checked' : ''}>Start with gold instead${w ? ` (${w.dice} × ${w.mult} gp)` : ''}</label></div>`;
  if (pk.method === 'class') {
    if (!d.class.length) {
      html += `<p class="note">The app doesn’t have a starting equipment list for ${esc(d.class_name || 'this class')}. Start with gold, or add items from the list below.</p>`;
    } else {
      html += `<p class="hint small">From ${esc(d.class_name)}. Pick one option on each line. <b>Bold</b> items are ones you’re proficient with.</p>`;
      html += d.class.map((line, i) => {
        if (pk.opt[i] == null || pk.opt[i] >= line.options.length) pk.opt[i] = defaultOption(line);
        const multi = line.options.length > 1;
        return `<div class="sg-line"><span class="sg-num">${i + 1}</span><div class="sg-opts">${line.options.map((opt, j) => {
          const body = opt.map((e, k) => entryHtml(e, `${i}-${j}-${k}`)).join('<span class="sg-plus">+</span>');
          if (!multi) return `<div class="sg-opt single"><span class="sg-letter" aria-hidden="true">✓</span><span class="sg-items">${body}</span></div>`;
          const on = pk.opt[i] === j;
          return `<label class="sg-opt ${on ? 'on' : ''}"><input type="radio" name="sg-${i}" value="${j}" data-change="sg-opt" data-i="${i}" ${on ? 'checked' : ''}>
            <span class="sg-letter">${String.fromCharCode(97 + j)}</span><span class="sg-items">${body}</span></label>`;
        }).join('')}</div></div>`;
      }).join('');
    }
    if (d.background.length) {
      html += `<div class="sg-bg"><label class="check"><input type="checkbox" data-change="sg-bg" ${pk.bg ? 'checked' : ''}><b>Also take your background’s equipment</b>&nbsp;(${esc(d.background_name)})</label>
        <div class="sg-items ${pk.bg ? '' : 'off'}">${d.background.map((e, k) => entryHtml(e, `bg-${k}`)).join('<span class="sg-plus">+</span>')}</div></div>`;
    }
    if (d.class.length || d.background.length) {
      html += `<div class="row" style="margin-top:14px">${has
        ? `<button class="btn primary" data-act="sg-apply" data-mode="replace">Replace my inventory with this</button>
           <button class="btn" data-act="sg-apply" data-mode="add">Add it to what I have</button>
           <span class="hint small">Replacing also resets your coins.</span>`
        : '<button class="btn primary" data-act="sg-apply" data-mode="replace">Add to my inventory</button>'}</div>`;
    }
  } else {
    html += `<p class="hint">Instead of your class’s and background’s equipment, start with gold and buy everything from the list below.</p>
      <div class="row"><label class="field" style="margin:0"><span>Gold pieces</span><input type="number" min="0" id="sg-gold" value="${esc(pk.gold)}" data-change="sg-gold"></label>
        ${w ? `<button class="btn" data-act="sg-roll-gold" style="align-self:flex-end">Roll ${w.dice} × ${w.mult}</button>` : ''}
        <span class="hint small" style="align-self:flex-end">${esc(pk.goldNote || '')}</span></div>
      <div class="row" style="margin-top:12px">${has
        ? `<button class="btn primary" data-act="sg-gold-apply" data-mode="replace">Replace my inventory with this gold</button>
           <button class="btn" data-act="sg-gold-apply" data-mode="add">Add it to my coins</button>`
        : '<button class="btn primary" data-act="sg-gold-apply" data-mode="replace">Start with this gold</button>'}</div>`;
  }
  return html;
}

async function startGearPanel() {
  const c = S.char;
  const body = await startGearBody();
  if ((c.inventory || []).length) {
    const st = c.gear_start || {};
    const said = st.method === 'class' ? 'You took your class’s starting equipment.' : st.method === 'gold' ? `You started with ${st.gold} gp.`
      : st.method === 'claude' ? 'Claude picked your starting equipment.' : 'You have equipment already.';
    return `<details class="panel start-gear"><summary><h2>Starting equipment</h2><span class="muted small">${said} Open this to choose again.</span></summary>
      <div id="start-gear">${body}</div></details>`;
  }
  return `<div class="panel start-gear"><h2>Starting equipment</h2><div id="start-gear">${body}</div></div>`;
}
async function renderStartGear() {
  const el = $('#start-gear');
  if (el) el.innerHTML = await startGearBody();
}

/* ---------------------------------------------------------------- the inventory */
const BOND_LABEL = { pact: 'pact weapon', hex: 'hex weapon', bond: 'bonded', kensei: 'kensei weapon' };
const WHEN_LABEL = { dawn: 'at dawn', long: 'on a long rest', short: 'on a short rest', never: 'never' };
const isMagic = (it) => !!(it.magic || (it.effects || []).length || it.kind === 'magic');

function sortItems(inv) {
  return [...inv].sort((a, b) => (KIND_ORDER[itemRole(a) || a.kind] ?? 10) - (KIND_ORDER[itemRole(b) || b.kind] ?? 10)
    || (a.name || '').localeCompare(b.name || ''));
}

function effectText(e) {
  const v = +e.value || 0, sv = signed(v);
  const ab = AB_NAME[e.ability] || 'an ability';
  switch (e.type) {
    case 'ac': return `${sv} AC`;
    case 'save': return `${sv} to ${e.ability && e.ability !== 'all' ? `${AB_NAME[e.ability]} saves` : 'saving throws'}`;
    case 'score_set': return `${ab} becomes ${v}`;
    case 'score_inc': return `${sv} ${ab} (up to ${+e.cap || 20})`;
    case 'attack': return `${sv} to weapon attacks`;
    case 'damage': return `${sv} to weapon damage`;
    case 'spell_attack': return `${sv} to spell attacks`;
    case 'spell_dc': return `${sv} to spell save DC`;
    case 'skill': return `${sv} ${e.skill || 'skill'}`;
    case 'init': return `${sv} initiative`;
    case 'speed': return `${sv} ft speed`;
    case 'hp': return `${sv} hit point maximum`;
    case 'extra_damage': return `+${e.dice || '?'}${e.dtype ? ` ${e.dtype}` : ''} damage${e.switch ? ' (a switch when rolling)' : ''}`;
    case 'resist': return `resistance to ${e.dtype || '?'}`;
    case 'note': return e.text || '';
    default: return '';
  }
}
const effectsSummary = (it) => (it.effects || []).map(effectText).filter(Boolean).join('; ');

function invRow(it, { equip, play }) {
  const role = itemRole(it), st = itemProf(it), m = it.magic || {};
  const qty = +it.qty || 0;
  const box = (field, label, on, title = '') => `<label class="check small"${title ? ` title="${title}"` : ''}><input type="checkbox" data-inv="${field}" data-id="${it.id}" ${on ? 'checked' : ''}>${label}</label>`;
  let use = null;
  if (equip) {
    const label = role === 'armor' ? 'Wearing' : role === 'shield' ? 'Holding' : role === 'weapon' ? 'Ready' : isMagic(it) ? 'Using' : '';
    use = [label ? box('equipped', label, it.equipped, role === 'weapon' ? 'Ready weapons are listed in your attacks' : '') : '',
      m.attune ? box('attuned', 'Attuned', m.attuned, 'Counts toward how many items you can be attuned to') : ''].filter(Boolean).join('');
  }
  const tags = [];
  if (st === 'no') tags.push(PROF_TAG.no);
  if (it.magic) tags.push(`<span class="tag magic">${esc(m.rarity || 'magic')}</span>`);
  if (m.attune && !m.attuned) tags.push('<span class="tag warn">not attuned</span>');
  if (it.bond) tags.push(`<span class="tag bond">${BOND_LABEL[it.bond] || 'bound'}</span>`);
  if (it.carried === false) tags.push('<span class="tag">not carried</span>');
  const info = itemStatsText(it), fx = effectsSummary(it);
  const ch = it.charges || {}, chMax = +ch.max || 0, chLeft = Math.max(0, chMax - (+ch.used || 0));
  const charges = chMax ? `<div class="small charges">${play ? `<button class="roll-btn small" data-act="charge" data-id="${it.id}" data-d="1" ${chLeft ? '' : 'disabled'}>Use a charge</button> ` : ''}<b>${chLeft}</b> of ${chMax} charges left<span class="muted">${ch.when === 'never' ? '' : `, regains ${esc(ch.regain || 'all')} ${WHEN_LABEL[ch.when || 'dawn']}`}</span>${chLeft < chMax ? ` <button class="roll-btn small" data-act="charge" data-id="${it.id}" data-d="-1" aria-label="Get a charge back">+1</button>` : ''}</div>` : '';
  const worth = +it.value_cp ? ` <span class="small muted">worth ${money(+it.value_cp)}${qty > 1 ? ' each' : ''}</span>` : '';
  const sellable = it.kind === 'treasure' && +it.value_cp;
  return `<tr class="${qty === 0 ? 'empty' : ''}">
    ${use !== null ? `<td class="use">${use}</td>` : ''}
    <td><span class="inv-name ${profCls(st)}">${esc(it.name)}${+it.bonus ? ` ${signed(+it.bonus)}` : ''}</span>${tags.join('')}${worth}
      ${info ? `<div class="small muted">${esc(info)}</div>` : ''}${fx ? `<div class="small fx">${esc(fx)}</div>` : ''}${charges}${it.notes ? `<div class="small">${esc(it.notes)}</div>` : ''}</td>
    <td class="qty">${play
      ? `<span class="stepper"><button class="roll-btn small" data-act="inv-step" data-id="${it.id}" data-d="-1" aria-label="One fewer ${esc(it.name)}">−</button><b>${qty}</b><button class="roll-btn small" data-act="inv-step" data-id="${it.id}" data-d="1" aria-label="One more ${esc(it.name)}">+</button></span>`
      : `<input type="number" min="0" value="${qty}" data-inv="qty" data-id="${it.id}" aria-label="How many ${esc(it.name)}">`}</td>
    <td class="num wt">${lbs((+it.weight || 0) * qty)}</td>
    <td class="acts"><button class="btn quiet small" data-act="inv-edit" data-id="${it.id}">Edit</button>
      ${!play && it.contents ? `<button class="btn quiet small" data-act="inv-unpack" data-id="${it.id}">Unpack</button>` : ''}
      ${sellable ? `<button class="btn quiet small" data-act="inv-sell" data-id="${it.id}">Sell</button>` : ''}
      ${play ? '' : `<button class="btn quiet danger small" data-act="inv-remove" data-id="${it.id}" aria-label="Remove ${esc(it.name)}">Remove</button>`}</td>
  </tr>`;
}

function attunementHtml() {
  const sh = S.sheet || {}, att = sh.attunement, inv = S.char.inventory || [];
  if (!att || !(att.used || inv.some((i) => (i.magic || {}).attune))) return '';
  const n = Math.max(att.max, att.used);
  return `<div class="attune ${att.used > att.max ? 'over' : ''}"><span>Attuned to <b>${att.used}</b> of ${att.max}</span>
    <span class="apips" aria-hidden="true">${Array.from({ length: n }, (_, i) => `<span class="${i < att.used ? 'on' : ''}"></span>`).join('')}</span>
    <span class="muted small">${esc(att.items.join(', ') || 'Tick Attuned on an item once you’ve spent a short rest with it.')}</span></div>`;
}

function invInner({ equip, play }) {
  const c = S.char, sh = S.sheet || {};
  const inv = c.inventory || (c.inventory = []);
  const carry = sh.carry || { weight: 0, capacity: 0 };
  const pct = Math.min(100, Math.round((100 * carry.weight) / (carry.capacity || 1)));
  const treasure = inv.filter((i) => i.kind === 'treasure').reduce((t, i) => t + (+i.value_cp || 0) * (+i.qty || 0), 0);
  const head = `<tr>${equip ? '<th>Use</th>' : ''}<th>Item</th><th>Qty</th><th class="num wt">Weight</th><th></th></tr>`;
  const rows = sortItems(inv).map((it) => invRow(it, { equip, play })).join('');
  return `<div class="inv-head">${play ? '' : '<h2>Inventory</h2>'}<button class="btn" data-act="item-new">Create an item</button></div>
    ${attunementHtml()}
    ${inv.length ? `<table class="list inv"><thead>${head}</thead><tbody>${rows}</tbody></table>`
      : `<p class="muted">Nothing yet. ${S.char.mode === 'manual' ? 'Add items from the list below, or create your own.' : 'Take your class’s starting equipment above, add items from the list below, or create your own.'}</p>`}
    <div class="inv-foot">
      <div class="carry">Carrying <b data-out="carry.weight">${carry.weight}</b> of <span data-out="carry.capacity">${carry.capacity}</span> lb
        <div class="carry-bar ${carry.weight > carry.capacity ? 'over' : ''}" data-carry-bar><span style="width:${pct}%"></span></div>
        ${treasure ? `<div class="small" style="margin-top:4px">Treasure worth <b>${money(treasure)}</b></div>` : ''}</div>
      <div class="row coins">${COINS.map((k) => `<label class="field"><span>${k}</span><input type="number" min="0" data-bind="coins.${k}" value="${(c.coins || {})[k] || 0}" aria-label="${k}"></label>`).join('')}</div>
    </div>
    ${equip && !sh.unarmed_auto ? `<label class="check small" style="margin-top:8px"><input type="checkbox" data-bind="unarmed" ${c.unarmed ? 'checked' : ''}>Show an unarmed strike in my attacks</label>` : ''}
    ${!equip && !play ? '<p class="hint small" style="margin:8px 0 0">On a hand-written sheet, item effects aren’t added to the numbers you typed; include them in your totals.</p>' : ''}
    ${play ? '<p class="hint small" style="margin:8px 0 0">To buy items or take starting equipment, open Build.</p>'
      : `<label class="field" style="margin:12px 0 0"><span>Other gear and notes</span><textarea rows="2" data-bind="equipment" placeholder="Anything you’d rather jot down than list">${esc(c.equipment || '')}</textarea></label>`}`;
}

function inventoryPanel(opts) {
  return `<div class="panel" id="inv-panel" data-equip="${opts.equip ? 1 : 0}" data-play="${opts.play ? 1 : 0}">${invInner(opts)}</div>`;
}
function rerenderInv() {
  const el = $('#inv-panel');
  if (el) el.innerHTML = invInner({ equip: el.dataset.equip === '1', play: el.dataset.play === '1' });
  const purse = $('#shop-purse');
  if (purse) purse.textContent = `(${purseText()})`;
}
function afterItemChange() {
  if (S.tab === 'play') renderPlayMain();
  else rerenderInv();
}

function invField(t) {
  const it = (S.char.inventory || []).find((x) => x.id === t.dataset.id);
  if (!it) return;
  const f = t.dataset.inv;
  if (f === 'equipped') {
    it.equipped = t.checked;
    const role = itemRole(it);
    if (t.checked && (role === 'armor' || role === 'shield')) {
      S.char.inventory.forEach((x) => { if (x !== it && itemRole(x) === role) x.equipped = false; });
    }
    afterItemChange();
  } else if (f === 'attuned') {
    it.magic = it.magic || {};
    it.magic.attuned = t.checked;
    if (t.checked) it.equipped = true;
    afterItemChange();
  } else if (f === 'qty') {
    it.qty = Math.max(0, Math.floor(+t.value || 0));
    const wt = t.closest('tr').querySelector('.wt');
    if (wt) wt.textContent = lbs((+it.weight || 0) * it.qty);
  }
  changed();
}

function addCoins(cp) {
  const c = S.char;
  c.coins = c.coins || {};
  let rest = Math.round(cp);
  [['gp', 100], ['sp', 10], ['cp', 1]].forEach(([k, v]) => {
    const n = Math.floor(rest / v);
    c.coins[k] = (+c.coins[k] || 0) + n;
    rest -= n * v;
  });
}

// magic item charges come back on rests
function restoreCharges(rest) {
  const back = [];
  (S.char.inventory || []).forEach((it) => {
    const ch = it.charges;
    if (!ch || !(+ch.max > 0) || !(+ch.used > 0)) return;
    const when = ch.when || 'dawn';
    if (when === 'never' || (rest === 'short' && when !== 'short')) return;
    let n = +ch.used;
    const p = /^\s*all\s*$/i.test(ch.regain || '') || !(ch.regain || '').trim() ? null : Dice.parse(ch.regain);
    if (p) {
      n = p.flat;
      p.terms.forEach((tm) => { for (let i = 0; i < tm.n; i++) n += tm.sign * Dice.die(tm.sides); });
    }
    n = Math.max(0, Math.min(+ch.used, n));
    ch.used = +ch.used - n;
    if (n) back.push(`${it.name} +${n}`);
  });
  return back;
}

/* ---------------------------------------------------------------- the item editor */
const ITEM_TYPES = [['weapon', 'Weapon'], ['armor', 'Armor'], ['shield', 'Shield'], ['magic', 'Magic item (ring, cloak, wand, wondrous item…)'],
  ['consumable', 'Potion, scroll or other consumable'], ['treasure', 'Treasure (gems, art, trade goods)'], ['gear', 'Other gear']];
const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
const BOND_OPTIONS = [['', 'Not bound'], ['pact', 'Pact weapon (Pact of the Blade)'], ['hex', 'Hex weapon (Hexblade’s Hex Warrior)'],
  ['bond', 'Weapon Bond (Eldritch Knight)'], ['kensei', 'Kensei weapon (Way of the Kensei)']];
const BOND_HELP = {
  pact: 'You’re proficient with your pact weapon and it counts as magical. Hexblades attack with Charisma; Improved Pact Weapon and Lifedrinker are set in the Pact of the Blade box.',
  hex: 'You can attack with Charisma instead of Strength or Dexterity. It can’t be two-handed, and only one weapon at a time.',
  bond: 'It can’t be knocked out of your hand while you’re conscious, and you can summon it to your hand as a bonus action. Up to two weapons.',
  kensei: 'Counts as a monk weapon: it uses your Martial Arts die and Dexterity if that’s better.',
};
const EFFECTS = [['ac', 'Bonus to AC'], ['save', 'Bonus to saving throws'], ['score_set', 'Sets an ability score (like Gauntlets of Ogre Power)'],
  ['score_inc', 'Raises an ability score'], ['attack', 'Bonus to weapon attack rolls'], ['damage', 'Bonus to weapon damage rolls'],
  ['spell_attack', 'Bonus to spell attack rolls'], ['spell_dc', 'Bonus to spell save DC'], ['skill', 'Bonus to a skill'],
  ['init', 'Bonus to initiative'], ['speed', 'Extra speed'], ['hp', 'Extra hit points'], ['extra_damage', 'Extra damage on a hit'],
  ['resist', 'Damage resistance'], ['note', 'Something else (shown with your features)']];
const TREASURE_PRESETS = [['Gem', [10, 50, 100, 500, 1000, 5000]], ['Art object', [25, 250, 750, 2500, 7500]]];

function editorType(it) {
  const r = itemRole(it);
  if (r) return r;
  return ['magic', 'consumable', 'treasure'].includes(it.kind) ? it.kind : 'gear';
}
const editItem = (id) => (id === 'draft' ? S.draft : (S.char.inventory || []).find((x) => x.id === id));
const newDraft = () => ({ id: newId(), name: '', kind: 'gear', qty: 1, weight: 0, src: 'custom' });

function effectRow(e, i, id) {
  const f = (k) => `data-it="effects.${i}.${k}" data-id="${id}"`;
  const num = (label, k, v, attrs = '') => `<label class="field"><span>${label}</span><input type="number" ${f(k)} value="${esc(v ?? '')}" ${attrs}></label>`;
  const pick = (label, k, v, opts, cls = '') => `<label class="field ${cls}"><span>${label}</span><select ${f(k)}>${opts.map(([o, l]) => `<option value="${esc(o)}" ${String(v ?? '') === String(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const abil = ABILITIES.map((a) => [a, AB_NAME[a]]);
  const types = (S.srd.damage_types || []).map((d) => [d, d]);
  let body;
  switch (e.type) {
    case 'save': body = num('Bonus', 'value', e.value) + pick('Which saves', 'ability', e.ability || 'all', [['all', 'All of them']].concat(abil)); break;
    case 'score_set': body = pick('Ability', 'ability', e.ability || 'str', abil) + num('Becomes', 'value', e.value, 'min="1" max="30"'); break;
    case 'score_inc': body = pick('Ability', 'ability', e.ability || 'str', abil) + num('Increase', 'value', e.value) + num('Up to', 'cap', e.cap || 20, 'min="1" max="30"'); break;
    case 'skill': body = pick('Skill', 'skill', e.skill || 'Perception', Object.keys(S.srd.skills).map((k) => [k, k]), 'wide') + num('Bonus', 'value', e.value); break;
    case 'extra_damage': body = `<label class="field"><span>Dice</span><input type="text" ${f('dice')} value="${esc(e.dice || '')}" placeholder="1d6"></label>`
      + pick('Damage type', 'dtype', e.dtype || 'fire', types)
      + `<label class="check small wide" style="align-self:center"><input type="checkbox" ${f('switch')} ${e.switch ? 'checked' : ''}>Only sometimes (a switch in the dice panel)</label>`; break;
    case 'resist': body = pick('Damage type', 'dtype', e.dtype || 'fire', types.concat([['all damage', 'all damage']]), 'wide'); break;
    case 'note': body = `<label class="field" style="grid-column:1/-1"><span>What it does</span><input type="text" ${f('text')} value="${esc(e.text || '')}" placeholder="Advantage on Stealth checks while the hood is up"></label>`; break;
    case 'speed': body = num('Feet', 'value', e.value, 'step="5"'); break;
    default: body = num('Bonus', 'value', e.value);
  }
  const label = (EFFECTS.find(([k]) => k === e.type) || [0, 'Effect'])[1];
  return `<div class="effect-row"><div class="row" style="justify-content:space-between"><b class="small">${esc(label)}</b>
    <button class="btn quiet danger small" data-act="effect-remove" data-id="${id}" data-i="${i}">Remove</button></div>
    <div class="edit-grid">${body}</div></div>`;
}

function itemEditorHtml(it, isNew) {
  const id = isNew ? 'draft' : it.id;
  const type = editorType(it);
  const srd = S.srd, manual = S.char.mode === 'manual';
  const f = (path, extra = '') => `data-it="${path}" data-id="${id}" ${extra}`;
  const num = (label, path, v, attrs = '', cls = '') => `<label class="field ${cls}"><span>${label}</span><input type="number" ${f(path)} value="${esc(v ?? '')}" ${attrs}></label>`;
  const txt = (label, path, v, attrs = '', cls = '') => `<label class="field ${cls}"><span>${label}</span><input type="text" ${f(path)} value="${esc(v ?? '')}" ${attrs}></label>`;
  const pick = (label, path, v, opts, attrs = '', cls = '') => `<label class="field ${cls}"><span>${label}</span><select ${f(path, attrs)}>${opts.map(([o, l]) => `<option value="${esc(o)}" ${String(v ?? '') === String(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;
  const chk = (label, path, on, attrs = '') => `<label class="check"><input type="checkbox" ${f(path, attrs)} ${on ? 'checked' : ''}>${label}</label>`;
  const abil = ABILITIES.map((a) => [a, AB_NAME[a]]);
  let html = `<div class="item-editor" data-editor="${id}"><h2>${isNew ? 'Create an item' : `Edit ${esc(it.name || 'item')}`}</h2>`;
  if (isNew) {
    html += `<details class="lib-start"><summary>Start from a magic item (the wiki’s or your PDFs’)</summary>
      <div class="row" style="margin-top:8px"><input type="search" id="lib-item-q" placeholder="Search magic items, like cloak or +1" class="grow" aria-label="Search magic items">
        <button class="btn" data-act="lib-item-search">Search</button></div>
      <div id="lib-item-results" class="results lib-results"></div>
      <p class="hint small">Picking one fills in its rarity, attunement, charges, description and the effects the app can read from it. Check them, then add.</p></details>`;
  }
  html += `<div class="edit-grid">
      ${pick('What is it?', 'type', type, ITEM_TYPES, 'data-redraw', 'wide')}
      ${txt('Name', 'name', it.name, `placeholder="${type === 'treasure' ? 'Ruby' : type === 'weapon' ? 'Flame Tongue' : type === 'magic' ? 'Ring of Protection' : 'Name'}" id="item-name"`, 'wide')}
      ${num('How many', 'qty', it.qty ?? 1, 'min="0"')}
      ${num('Weight each (lb)', 'weight', it.weight || 0, 'min="0" step="0.05"')}
      ${num('Worth each (gp)', 'value_gp', it.value_cp ? +(it.value_cp / 100).toFixed(2) : '', `min="0" step="0.01" placeholder="${it.cost_cp ? +(it.cost_cp / 100).toFixed(2) : ''}"`)}
    </div>`;
  if ((it.variants || []).length > 1) {
    const cur = it.variants.findIndex((v) => v.rarity === (it.magic || {}).rarity);
    html += `<div class="edit-grid">${pick('Which version', 'variant', cur < 0 ? 0 : cur, it.variants.map((v, i) => [i, `+${v.bonus} (${v.rarity})`]), 'data-redraw', 'wide')}</div>`;
  }
  if (type === 'treasure') {
    html += `<div class="presets">${TREASURE_PRESETS.map(([what, vals]) => `<span class="small muted">${what}:</span>${vals.map((v) =>
      `<button class="btn quiet small" data-act="item-preset" data-what="${what}" data-gp="${v}">${v.toLocaleString()} gp</button>`).join('')}`).join('<br>')}</div>`;
  }
  if (type === 'weapon') {
    const w = weaponStats(it);
    const base = it.base && srd.weapons[it.base] ? it.base : '';
    const own = !!(it.weapon && String(it.weapon.damage || '').trim());
    html += `<h3>Weapon</h3><div class="edit-grid">
      ${pick('Works like', 'base_weapon', own ? '' : base, [['', own && base ? `Its own stats (started from ${base.toLowerCase()})` : 'Its own stats']].concat(Object.keys(srd.weapons).filter((n) => n !== 'Unarmed strike').map((n) => [n, n])), 'data-redraw', 'wide')}
      ${pick('Category', 'weapon.category', w.category, [['simple', 'Simple'], ['martial', 'Martial']])}
      ${pick('Melee or ranged', 'weapon.ranged', w.ranged ? '1' : '', [['', 'Melee'], ['1', 'Ranged']], 'data-redraw')}
      ${txt('Damage dice', 'weapon.damage', w.damage, 'placeholder="1d8"')}
      ${pick('Damage type', 'weapon.type', w.type, (srd.damage_types || []).map((d) => [d, d]))}
      ${w.ranged || w.properties.includes('thrown') || w.properties.includes('ammunition') ? txt('Range (feet)', 'weapon.range', w.range, 'placeholder="80/320"') : ''}
      ${w.properties.includes('versatile') ? txt('Two-handed damage', 'weapon.versatile', w.versatile, 'placeholder="1d10"') : ''}
    </div>
    <div class="prop-checks">${(srd.weapon_flags || []).map((p) => `<label class="check small"><input type="checkbox" data-it="weapon.prop" data-prop="${p}" data-id="${id}" data-redraw ${w.properties.includes(p) ? 'checked' : ''}>${p}</label>`).join('')}</div>
    <div class="edit-grid">
      ${num('Magic bonus', 'bonus', it.bonus || 0, 'min="-5" max="5"')}
      ${pick('Proficient', 'prof', it.prof || '', [['', 'Work it out'], ['yes', 'Yes'], ['no', 'No']])}
      ${pick('Attack with', 'ability', it.ability || '', [['', 'The usual ability']].concat(abil))}
      ${manual ? '' : pick('Bound', 'bond', it.bond || '', BOND_OPTIONS, 'data-redraw', 'wide')}
    </div>${it.bond && BOND_HELP[it.bond] ? `<p class="hint small">${BOND_HELP[it.bond]}</p>` : ''}
    <p class="hint small">“Works like” copies a weapon from the rules; change any stat to make it your own. “Attack with” is for things like Shillelagh or a Battle Smith’s Intelligence.</p>`;
  }
  if (type === 'armor') {
    const a = armorStats(it);
    const own = !!(it.armor && ['light', 'medium', 'heavy'].includes(it.armor.category));
    html += `<h3>Armor</h3><div class="edit-grid">
      ${pick('Works like', 'base_armor', own ? '' : (it.base || ''), [['', own && it.base ? `Its own stats (started from ${it.base.toLowerCase()})` : 'Its own stats']].concat(Object.keys(srd.armor).map((n) => [n, `${n} (${srd.armor[n].category})`])), 'data-redraw', 'wide')}
      ${pick('Type', 'armor.category', a.category, [['light', 'Light'], ['medium', 'Medium'], ['heavy', 'Heavy']], 'data-redraw')}
      ${num('Armor class', 'armor.ac', a.ac, 'min="0" max="30"')}
      ${a.category === 'heavy' ? '' : pick('Dexterity bonus', 'armor.maxdex', a.maxdex, [['', 'Full modifier'], ['2', 'Up to +2'], ['3', 'Up to +3'], ['0', 'None']])}
      ${num('Strength needed', 'armor.str', +a.str || '', 'min="0" max="30" placeholder="none"')}
      ${num('Magic bonus', 'bonus', it.bonus || 0, 'min="-5" max="5"')}
    </div>${chk('Disadvantage on Stealth checks', 'armor.stealth', a.stealth)}`;
  }
  if (type === 'shield') {
    html += `<h3>Shield</h3><div class="edit-grid">
      ${num('AC bonus', 'shield_ac', it.armor && it.armor.category === 'shield' ? it.armor.ac : 2, 'min="0" max="10"')}
      ${num('Magic bonus', 'bonus', it.bonus || 0, 'min="-5" max="5"')}</div>`;
  }
  const magicOn = type === 'magic' || !!it.magic;
  const m = it.magic || {}, ch = it.charges || {};
  html += `<h3>Magic</h3>${type === 'magic' ? '' : chk('It’s a magic item', 'magic_on', magicOn, 'data-redraw')}`;
  if (magicOn) {
    html += `<div class="edit-grid">
        ${pick('Rarity', 'magic.rarity', m.rarity || '', [['', '–']].concat(RARITIES.map((r) => [r, r])))}
        ${num('Charges', 'charges.max', ch.max || '', 'min="0" placeholder="none" data-redraw')}
        ${+ch.max ? txt('Regains', 'charges.regain', ch.regain || '', 'placeholder="1d6+1, or all"') : ''}
        ${+ch.max ? pick('When', 'charges.when', ch.when || 'dawn', [['dawn', 'At dawn (long rest)'], ['long', 'On a long rest'], ['short', 'On a short rest'], ['never', 'Never']]) : ''}
      </div>
      <div class="row">${chk('Requires attunement', 'magic.attune', m.attune, 'data-redraw')}
        ${m.attune ? chk('I’m attuned to it', 'magic.attuned', m.attuned) : ''}
        ${['weapon', 'armor', 'shield'].includes(type) ? '' : chk('Using it (worn or held)', 'equipped', it.equipped)}</div>
      <label class="field" style="margin-top:10px"><span>What it does</span><textarea rows="3" data-it="magic.desc" data-id="${id}">${esc(m.desc || '')}</textarea></label>
      <h4>Effects on your sheet</h4>
      <p class="hint small">These count while you’re using the item${['weapon', 'armor', 'shield'].includes(type) ? ` (${type === 'weapon' ? 'ready' : type === 'armor' ? 'wearing it' : 'holding it'})` : ''}, and attuned to it if it needs that.${manual ? ' A hand-written sheet doesn’t add them to the numbers you typed.' : ''}</p>
      ${(it.effects || []).map((e, i) => effectRow(e, i, id)).join('')}
      <select ${f('new_effect', 'data-redraw')} aria-label="Add an effect"><option value="">Add an effect…</option>${EFFECTS.map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>`;
  }
  html += `<label class="field" style="margin-top:12px"><span>Notes</span><input type="text" ${f('notes')} value="${esc(it.notes || '')}" placeholder="Where you found it, who it belonged to…"></label>`;
  if (isNew) {
    html += `${manual && type === 'weapon' ? `<label class="check"><input type="checkbox" id="item-to-attacks" ${S.draftToAttacks !== false ? 'checked' : ''}>Also add it to my attacks</label>` : ''}
      <div class="row" style="margin-top:12px"><button class="btn primary" data-act="item-add">Add to my inventory</button><button class="btn" data-act="item-close">Cancel</button></div>`;
  } else {
    const each = +it.value_cp || Math.floor((+it.cost_cp || 0) / 2);
    html += `<div class="row" style="margin-top:12px"><button class="btn primary" data-act="item-close">Done</button>
      ${each ? `<button class="btn" data-act="inv-sell" data-id="${id}">Sell ${(+it.qty || 0) > 1 ? 'them' : 'it'} for ${money(each * (+it.qty || 0))}${it.value_cp ? '' : ' (half price)'}</button>` : ''}
      <button class="btn quiet danger" data-act="inv-remove" data-id="${id}">Remove from inventory</button></div>`;
  }
  return html + '</div>';
}

function openItemEditor(id) {
  $$('.modal-back').forEach((x) => x.remove());
  if (id === 'draft') { S.draft = newDraft(); S.draftToAttacks = true; }
  const it = editItem(id);
  if (!it) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal item-modal" role="dialog" aria-modal="true" aria-label="${id === 'draft' ? 'Create an item' : 'Edit item'}">
    <button class="btn quiet close" data-act="item-close" aria-label="Close">Close</button>${itemEditorHtml(it, id === 'draft')}</div>`;
  document.body.append(back);
  back.addEventListener('click', (ev) => { if (ev.target === back) closeItemEditor(); });
  const first = back.querySelector('.item-editor select, .item-editor input');
  if (first) first.focus();
}
function closeItemEditor() {
  const was = !!$('.item-modal');
  $$('.modal-back').forEach((x) => x.remove());
  S.draft = null;
  if (was) afterItemChange();
}
let redrawing = false;
function redrawEditor() {
  const box = $('.item-modal .item-editor');
  if (!box || redrawing) return;
  redrawing = true;
  try {
    // let a field that's being typed in save first: removing it would fire its change event mid-redraw
    const active = box.contains(document.activeElement) ? document.activeElement : null;
    const key = active && (active.dataset.it ? `[data-it="${active.dataset.it}"]${active.dataset.prop ? `[data-prop="${active.dataset.prop}"]` : ''}` : active.dataset.act ? `[data-act="${active.dataset.act}"]` : '');
    if (active) active.blur();
    redrawEditorNow(box);
    const again = key && $(`.item-modal ${key}`);
    if (again) again.focus();
  } finally { redrawing = false; }
}
function redrawEditorNow(box) {
  const id = box.dataset.editor, it = editItem(id);
  if (!it) return;
  const open = !!(box.querySelector('.lib-start') || {}).open;
  const results = ($('#lib-item-results') || {}).innerHTML || '';
  box.outerHTML = itemEditorHtml(it, id === 'draft');
  const ls = $('.item-modal .lib-start');
  if (ls && open) { ls.open = true; $('#lib-item-results').innerHTML = results; }
}

function ensureWeapon(it) {
  if (!(it.weapon && String(it.weapon.damage || '').trim())) it.weapon = weaponStats(it);
}
function ensureArmor(it) {
  if (!(it.armor && ['light', 'medium', 'heavy'].includes(it.armor.category))) it.armor = armorStats(it);
}
function applyType(it, type) {
  const role = itemRole(it);
  if (type === 'weapon') {
    delete it.armor;
    if (role !== 'weapon') {
      if (it.base && !S.srd.weapons[it.base]) delete it.base;
      it.weapon = { category: 'simple', ranged: false, damage: '1d6', type: 'bludgeoning', properties: [], versatile: '', range: '' };
    }
    if (it.equipped == null) it.equipped = true;
  } else if (type === 'armor') {
    delete it.weapon;
    if (role !== 'armor') { delete it.base; it.armor = { category: 'light', ac: 11, maxdex: '', str: 0, stealth: false }; }
  } else if (type === 'shield') {
    delete it.weapon;
    delete it.base;
    it.armor = { category: 'shield', ac: (it.armor && it.armor.category === 'shield' && it.armor.ac) || 2 };
  } else {
    delete it.weapon;
    delete it.armor;
    if (it.base && (S.srd.weapons[it.base] || S.srd.armor[it.base] || it.base === 'Shield')) delete it.base;
    delete it.bond;
    if (type === 'magic') {
      it.magic = it.magic || { rarity: '', attune: false };
      if (it.equipped == null) it.equipped = true;
    }
  }
  it.kind = type;
}

function setItemField(t) {
  const id = t.dataset.id, it = editItem(id);
  if (!it) return;
  const path = t.dataset.it;
  const val = t.type === 'checkbox' ? t.checked : t.value;
  const n = (v) => (v === '' ? 0 : +v);
  switch (path) {
    case 'type': applyType(it, val); break;
    case 'value_gp': it.value_cp = val === '' ? 0 : Math.round(+val * 100); break;
    case 'qty': it.qty = Math.max(0, Math.floor(n(val))); break;
    case 'weight': it.weight = Math.max(0, n(val)); break;
    case 'bonus': it.bonus = Math.max(-5, Math.min(5, Math.trunc(n(val)))); break;
    case 'base_weapon':
    case 'base_armor':
      if (val) {
        it.base = val;
        delete it[path === 'base_weapon' ? 'weapon' : 'armor'];
        const cat = catalogItem(val);
        if (cat && !(+it.weight)) it.weight = cat.weight;
        if (cat && !(+it.cost_cp)) it.cost_cp = cat.cost_cp;
      } else if (path === 'base_weapon') it.weapon = weaponStats(it);
      else it.armor = armorStats(it);
      break;
    case 'weapon.prop': {
      ensureWeapon(it);
      const props = new Set(it.weapon.properties || []);
      if (val) props.add(t.dataset.prop); else props.delete(t.dataset.prop);
      it.weapon.properties = (S.srd.weapon_flags || []).filter((p) => props.has(p));
      break;
    }
    case 'weapon.ranged': ensureWeapon(it); it.weapon.ranged = !!val; break;
    case 'shield_ac': it.armor = { category: 'shield', ac: Math.max(0, Math.trunc(n(val))) }; delete it.base; break;
    case 'magic_on':
      if (val) it.magic = it.magic || { rarity: '', attune: false };
      else { delete it.magic; delete it.effects; delete it.charges; }
      break;
    case 'magic.attuned':
      it.magic = it.magic || {};
      it.magic.attuned = val;
      if (val) it.equipped = true;
      break;
    case 'new_effect':
      if (val) (it.effects = it.effects || []).push({ type: val, value: ['speed'].includes(val) ? 10 : val === 'score_set' ? 19 : 1 });
      break;
    case 'variant': {
      const v = (it.variants || [])[+val];
      if (!v) break;
      it.magic = it.magic || {};
      it.magic.rarity = v.rarity;
      if (itemRole(it)) it.bonus = v.bonus;
      (it.effects || []).forEach((e) => { if (e.type === 'spell_attack' || e.type === 'spell_dc') e.value = v.bonus; });
      break;
    }
    case 'charges.max':
      it.charges = it.charges || { used: 0, regain: '', when: 'dawn' };
      it.charges.max = Math.max(0, Math.floor(n(val)));
      it.charges.used = Math.min(+it.charges.used || 0, it.charges.max);
      break;
    default: {
      if (path.startsWith('weapon.')) ensureWeapon(it);
      if (path.startsWith('armor.')) ensureArmor(it);
      if (path.startsWith('magic.')) it.magic = it.magic || {};
      if (path.startsWith('charges.')) it.charges = it.charges || { max: 0, used: 0 };
      let v = val;
      if (t.type === 'number') v = val === '' ? '' : +val;
      setPath(it, path, v);
    }
  }
  if (id !== 'draft') changed();
}

/* ---------------------------------------------------------------- Pact of the Blade */
function pactPanel() {
  const sh = S.sheet || {}, pb = sh.pact_blade;
  if (!pb || !pb.available || S.char.mode === 'manual') return '<div id="pact-panel" hidden></div>';
  const blade = { ...(S.char.pact_blade || {}), ...(pb.flags || {}) };
  const fromOptions = new Set(pb.picked || []);
  const melee = Object.entries(S.srd.weapons).filter(([n, w]) => !w.ranged && n !== 'Unarmed strike').map(([n]) => n);
  const forms = melee.concat(blade.improved ? (S.srd.bow_forms || []) : []);
  const inv = (S.char.inventory || []).filter((i) => i.bond === 'pact');
  const current = (inv.find((i) => i.src === 'pact') || {}).base || 'Longsword';
  const box = (key, label, min) => (pb.level >= min ? `<label class="check"${fromOptions.has(key) ? ' title="Picked on the Class options step"' : ''}><input type="checkbox" data-bind="pact_blade.${key}" data-change="pact-redraw" ${blade[key] ? 'checked' : ''} ${fromOptions.has(key) ? 'disabled' : ''}>${label}</label>` : '');
  return `<div class="panel" id="pact-panel"><h2>Pact of the Blade</h2>
    <label class="check"><input type="checkbox" data-bind="pact_blade.has" data-change="pact-redraw" ${blade.has ? 'checked' : ''} ${fromOptions.has('has') ? 'disabled' : ''}>I chose Pact of the Blade as my Pact Boon</label>
    ${fromOptions.size ? '<span class="hint small"> (picked on the Class options step)</span>' : ''}
    ${blade.has ? `<p class="hint">As an action you create your pact weapon in your empty hand, in any form you like. You’re proficient with it and it counts as magical.${pb.hexblade ? ' As a Hexblade, you attack with Charisma.' : ''}</p>
      <div class="row"><select id="pact-form" aria-label="Pact weapon form">${forms.map((n) => `<option ${n === current ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
        <button class="btn" data-act="pact-create">${inv.some((i) => i.src === 'pact') ? 'Change my pact weapon' : 'Create my pact weapon'}</button></div>
      <p class="hint small">${inv.length ? `Your pact weapon: ${esc(inv.map((i) => i.name).join(', '))}. ` : ''}To make a magic weapon your pact weapon, click Edit on it and set Bound to “Pact weapon”.</p>
      <h4>Invocations</h4><div class="row">
        ${box('improved', 'Improved Pact Weapon', 3)}${box('thirsting', 'Thirsting Blade', 5)}${box('smite', 'Eldritch Smite', 5)}${box('lifedrinker', 'Lifedrinker', 12)}</div>
      <p class="hint small">Eldritch Smite and Lifedrinker show up as switches in the dice panel when you roll pact weapon damage.</p>` : ''}</div>`;
}

/* ---------------------------------------------------------------- the equipment list */
function shopState() {
  if (!S.shop) S.shop = { q: '', tab: 'all', prof: false, pay: false };
  return S.shop;
}

function shopRow(x, st) {
  const base = x.base || x.name;
  const ac = x.kind === 'armor' && S.char.mode !== 'manual' ? acIfWorn(base) : null;
  return `<div class="shop-row ${profCls(st)}">
    <span class="sr-name">${esc(x.name)}${x.per > 1 ? ` <span class="muted small">×${x.per}</span>` : ''}${st ? PROF_TAG[st] : ''}</span>
    <span class="sr-info small">${esc(x.info || '')}${ac != null ? ` <b class="ac-prev">your AC ${ac}</b>` : ''}</span>
    <span class="sr-cost small">${money(x.cost_cp)}</span><span class="sr-wt small muted">${lbs(x.weight)}</span>
    <button class="btn small" data-act="shop-add" data-name="${esc(x.name)}" aria-label="Add ${esc(x.name)}">Add</button></div>`;
}

const RARITY_ORDER = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact', 'varies'];
async function loadMagicItems(force) {
  if (!S.magicItems || force) S.magicItems = (await api('/api/magic-items')).items;
  return S.magicItems;
}
function magicListHtml() {
  const sp = shopState(), q = sp.q.trim().toLowerCase();
  if (!S.magicItems) {
    if (!S.magicLoading) {
      S.magicLoading = loadMagicItems()
        .then(() => { const el = $('#shop-list'); if (el && shopState().tab === 'magic') el.innerHTML = magicListHtml(); })
        .catch((e) => toast(e.message, 'error'))
        .finally(() => { S.magicLoading = null; });
    }
    return '<p class="loading">Loading magic items…</p>';
  }
  if (!S.magicItems.some((i) => i.source === 'wiki')) {
    return `<div class="note">The magic item list hasn’t been read from the wiki yet (one page, a few seconds).
      <div style="margin-top:8px"><button class="btn primary" data-act="magic-sync">Load magic items from the wiki</button></div></div>
      ${S.magicItems.length ? magicRows(S.magicItems, q, sp) : ''}`;
  }
  return magicRows(S.magicItems, q, sp);
}
function magicRows(all, q, sp) {
  let rows = all.filter((i) => (!q || i.name.toLowerCase().includes(q) || (i.item_type || '').includes(q))
    && (!sp.rarity || i.rarity === sp.rarity) && (!sp.attuneOnly || !i.attunement));
  const total = rows.length;
  rows = rows.slice(0, 250);
  const rarities = RARITY_ORDER.filter((r) => all.some((i) => i.rarity === r));
  return `<div class="row magic-filters"><select data-shop="rarity" aria-label="Rarity"><option value="">Any rarity</option>${rarities.map((r) =>
      `<option value="${r}" ${sp.rarity === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <label class="check small"><input type="checkbox" data-shop="attuneOnly" ${sp.attuneOnly ? 'checked' : ''}>No attunement needed</label>
      <span class="hint small">${total} item${total === 1 ? '' : 's'}${total > rows.length ? `, showing the first ${rows.length}; search to narrow it down` : ''}</span></div>
    ${rows.map((i) => `<div class="shop-row magic-row">
      <span class="sr-name">${esc(i.name)}${i.rarity ? `<span class="tag magic">${esc(i.rarity)}</span>` : ''}${(i.tags || []).includes('ua') ? '<span class="tag ua">UA</span>' : ''}</span>
      <span class="sr-info small">${esc(i.item_type || 'item')}${i.attunement ? ', requires attunement' : ''}</span>
      <span class="sr-cost small muted">${esc(i.source === 'wiki' ? i.book || 'wiki' : i.source.startsWith('pdf:') ? 'your PDF' : 'yours')}</span><span></span>
      <button class="btn small" data-act="magic-add" data-id="${i.id}" aria-label="Add ${esc(i.name)}">Add</button></div>`).join('') || '<p class="muted">No magic items match.</p>'}`;
}
function renderShopList() {
  const l = $('#shop-list');
  if (!l) return;
  l.innerHTML = shopState().tab === 'magic' ? magicListHtml() : shopListHtml();
}

function shopListHtml() {
  const sp = shopState(), q = sp.q.trim().toLowerCase();
  if (sp.tab === 'magic') return magicListHtml();
  const groups = sp.tab === 'all' ? Object.values(SHOP_GROUPS).flat() : SHOP_GROUPS[sp.tab];
  let out = '';
  for (const g of groups) {
    let rows = ((S.srd && S.srd.catalog) || []).filter((x) => x.group === g)
      .map((x) => [x, profStatus(x.base || x.name, x.kind)]);
    if (q) rows = rows.filter(([x]) => x.name.toLowerCase().includes(q) || (x.info || '').toLowerCase().includes(q));
    if (sp.prof) rows = rows.filter(([, st]) => st !== 'no');
    if (!rows.length) continue;
    rows.sort((a, b) => profRank(a[1]) - profRank(b[1]));
    out += `<h4 class="shop-group">${GROUP_LABEL[g]}</h4>${rows.map(([x, st]) => shopRow(x, st)).join('')}`;
  }
  return out || '<p class="muted">Nothing matches.</p>';
}

function shopPanel() {
  const sp = shopState(), manual = S.char.mode === 'manual';
  return `<div class="panel" id="shop"><h2>Add equipment</h2>
    <p class="hint">Things you’re proficient with are in <b>bold</b> and listed first${manual ? ' (going by the proficiencies you typed)' : ''}; things you aren’t proficient with are greyed out.</p>
    <div class="spell-tabs shop-tabs" role="tablist" aria-label="Kinds of equipment">${SHOP_TABS.map(([k, l]) =>
      `<button role="tab" aria-selected="${sp.tab === k}" data-act="shop-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="row shop-filters"><input type="search" class="grow" data-shop="q" value="${esc(sp.q)}" placeholder="Search equipment" aria-label="Search equipment">
      <label class="check small"><input type="checkbox" data-shop="prof" ${sp.prof ? 'checked' : ''}>Only what I’m proficient with</label>
      <label class="check small"><input type="checkbox" data-shop="pay" ${sp.pay ? 'checked' : ''}>Pay from my coins <span class="muted" id="shop-purse">(${esc(purseText())})</span></label></div>
    <div id="shop-list">${shopListHtml()}</div>
    <div class="custom-item"><b>Not on the list?</b> <button class="btn" data-act="item-new">Create your own item</button>
      <span class="hint small">Homebrew weapons and armor, magic items, treasure, anything else.</span></div></div>`;
}

/* ---------------------------------------------------------------- steps */
function hpPanel() {
  const c = S.char;
  const levels = [];
  (c.classes || []).forEach((cl, ci) => { for (let l = 0; l < (cl.level || 1); l++) if (!(ci === 0 && l === 0)) levels.push(cl.name || 'class'); });
  const rolls = c.hp_rolls || [];
  return `<div class="panel"><h2>Hit points</h2>
    <div class="row" style="margin-bottom:10px">
      <label class="check"><input type="radio" name="hpm" value="average" data-change="hp-mode" ${c.hp_mode !== 'rolled' ? 'checked' : ''}>Take the average each level</label>
      <label class="check"><input type="radio" name="hpm" value="rolled" data-change="hp-mode" ${c.hp_mode === 'rolled' ? 'checked' : ''}>Enter my rolls</label></div>
    ${c.hp_mode === 'rolled' ? `<p class="hint">First level always gets the full hit die. Enter what you rolled for each later level (before your Constitution modifier).</p>
      <div class="row">${levels.map((n, i) => `<label class="field" style="margin:0"><span>Level ${i + 2} (${esc(n)})</span>
        <input type="number" min="1" max="12" data-change="hp-roll" data-i="${i}" value="${rolls[i] || ''}"></label>`).join('') || '<span class="muted">Only one level so far.</span>'}</div>` : ''}
    <div class="grid3" style="margin-top:12px">
      <label class="field"><span>Extra max HP</span><input type="number" data-bind="hp_bonus" value="${c.hp_bonus || 0}"></label>
      <label class="field"><span>Extra AC (ring of protection…)</span><input type="number" data-bind="ac_bonus" value="${c.ac_bonus || 0}"></label>
      <label class="field"><span>Speed override (ft)</span><input type="number" data-bind="speed_override" value="${c.speed_override || ''}"></label></div>
    <p>Maximum hit points: <b data-out="hp_max"></b> (hit dice <span data-out="hit_dice"></span>). Armor class <b data-out="ac"></b>.</p></div>`;
}

STEP_RENDER.equipment = async () => {
  S.gearKey = gearKey();
  S.char.inventory = S.char.inventory || [];
  return (await startGearPanel()) + inventoryPanel({ equip: true }) + pactPanel() + shopPanel() + hpPanel();
};

STEP_RENDER.m_gear = async () => {
  S.gearKey = gearKey();
  S.char.inventory = S.char.inventory || [];
  return inventoryPanel({ equip: false }) + shopPanel();
};

function playInventoryHtml() {
  const c = S.char, sh = S.sheet || {};
  const n = (c.inventory || []).length;
  return `<details class="panel inv-play" id="play-inv" ${S.playInvOpen ? 'open' : ''}>
    <summary><h3>Inventory</h3><span class="muted small">${n} item${n === 1 ? '' : 's'}${sh.carry ? `, ${sh.carry.weight} lb` : ''}${sh.coins_text ? `; ${esc(sh.coins_text)}` : ''}</span></summary>
    <div id="inv-panel" data-equip="${c.mode === 'manual' ? 0 : 1}" data-play="1">${invInner({ equip: c.mode !== 'manual', play: true })}</div></details>`;
}

/* ---------------------------------------------------------------- actions */
Object.assign(ACTIONS, {
  'sg-apply': (t) => busy(t, 'Adding…', async () => {
    const d = await startingGearData(), pk = gearPick();
    const want = [], coins = {};
    const take = (entries, prefix, src) => entries.forEach((e, k) => {
      if (e.coins) Object.entries(e.coins).forEach(([cn, v]) => { coins[cn] = (coins[cn] || 0) + v; });
      else if (e.item) want.push({ name: e.item.base || e.item.name, qty: e.item.qty || 1, src });
      else if (e.choose) want.push({ name: pk.pick[`${prefix}-${k}`] || e.options[0], qty: e.qty || 1, src });
    });
    d.class.forEach((line, i) => { const j = pk.opt[i] ?? 0; take(line.options[j] || [], `${i}-${j}`, 'class'); });
    if (pk.bg) take(d.background, 'bg', 'background');
    const items = await makeItems(want);
    addItems(items, { replace: t.dataset.mode === 'replace', coins });
    S.char.gear_start = { method: 'class' };
    changed();
    await renderStep();
    toast(`Added ${items.length} item${items.length === 1 ? '' : 's'} to your inventory.`);
  }),
  'sg-roll-gold': async () => {
    const d = await startingGearData();
    const w = d.wealth, p = w && Dice.parse(w.dice);
    if (!p) return;
    const rolls = [];
    p.terms.forEach((tm) => { for (let i = 0; i < tm.n; i++) rolls.push(Dice.die(tm.sides)); });
    const sum = rolls.reduce((a, b) => a + b, 0);
    const pk = gearPick();
    pk.gold = sum * w.mult;
    pk.goldNote = `Rolled ${rolls.join(' + ')} = ${sum}, × ${w.mult} = ${pk.gold} gp`;
    renderStartGear();
  },
  'sg-gold-apply': (t) => {
    const input = $('#sg-gold');
    const gold = Math.max(0, Math.floor(+(input && input.value) || 0));
    if (!gold) { toast('Roll or type how much gold you start with first.', 'error'); return; }
    if (t.dataset.mode === 'replace') {
      S.char.inventory = [];
      S.char.coins = { cp: 0, sp: 0, ep: 0, gp: gold, pp: 0 };
    } else {
      S.char.coins = S.char.coins || {};
      S.char.coins.gp = (+S.char.coins.gp || 0) + gold;
    }
    S.char.gear_start = { method: 'gold', gold };
    shopState().pay = true;
    changed();
    renderStep();
    toast(`You have ${gold} gp to spend. Buy gear from the list below; “Pay from my coins” is on.`);
  },
  'inv-edit': (t) => openItemEditor(t.dataset.id),
  'inv-remove': (t) => {
    const inv = S.char.inventory || [];
    const i = inv.findIndex((x) => x.id === t.dataset.id);
    if (i >= 0) inv.splice(i, 1);
    changed();
    if ($('.item-modal')) closeItemEditor(); else afterItemChange();
  },
  'inv-sell': (t) => {
    const inv = S.char.inventory || [];
    const it = inv.find((x) => x.id === t.dataset.id);
    if (!it) return;
    const qty = +it.qty || 0;
    const total = (+it.value_cp || Math.floor((+it.cost_cp || 0) / 2)) * qty;
    if (!total) { toast('Set what it’s worth first (Edit, then “Worth each”).', 'error'); return; }
    if (!confirm(`Sell ${it.name}${qty > 1 ? ` ×${qty}` : ''} for ${money(total)}?`)) return;
    addCoins(total);
    inv.splice(inv.indexOf(it), 1);
    changed();
    if ($('.item-modal')) closeItemEditor(); else afterItemChange();
    toast(`Sold ${it.name} for ${money(total)}.`);
  },
  'charge': (t) => {
    const it = (S.char.inventory || []).find((x) => x.id === t.dataset.id);
    if (!it || !it.charges) return;
    const ch = it.charges;
    ch.used = Math.max(0, Math.min(+ch.max || 0, (+ch.used || 0) + +t.dataset.d));
    changed();
    afterItemChange();
  },
  'item-new': () => openItemEditor('draft'),
  'item-close': () => closeItemEditor(),
  'item-preset': (t) => {
    const it = S.draft || editItem(($('.item-modal .item-editor') || { dataset: {} }).dataset.editor);
    if (!it) return;
    it.value_cp = +t.dataset.gp * 100;
    if (!it.name || /^(Gem|Art object) \(/.test(it.name)) it.name = `${t.dataset.what} (${(+t.dataset.gp).toLocaleString()} gp)`;
    if (!it.weight) it.weight = t.dataset.what === 'Gem' ? 0 : 1;
    if (it !== S.draft) changed();
    redrawEditor();
  },
  'effect-remove': (t) => {
    const it = editItem(t.dataset.id);
    if (!it || !it.effects) return;
    it.effects.splice(+t.dataset.i, 1);
    if (t.dataset.id !== 'draft') changed();
    redrawEditor();
  },
  'item-add': () => {
    const it = S.draft;
    if (!it) return;
    if (!(it.name || '').trim()) { toast('Give the item a name first.', 'error'); const n = $('#item-name'); if (n) n.focus(); return; }
    const item = JSON.parse(JSON.stringify(it));
    item.name = item.name.trim();
    const box = $('#item-to-attacks');
    if (S.char.mode === 'manual' && box && box.checked && itemRole(item) === 'weapon') {
      const w = weaponStats(item), b = +item.bonus || 0;
      const m = manualOf(S.char);
      (m.attacks = m.attacks || []).push({
        name: item.name + (b ? ` ${signed(b)}` : ''), ability: w.properties.includes('finesse') || w.ranged ? 'dex' : 'str',
        range: w.ranged ? 'ranged' : 'melee', prof: true, bonus: b, dice: w.damage, dmg_bonus: b, add_mod: true, type: w.type,
        versatile: w.versatile || '', notes: w.properties.join(', '), finesse: w.properties.includes('finesse'), kind: 'weapon',
      });
    }
    addItems([item]);
    changed();
    closeItemEditor();
    toast(`Added ${item.name}.`);
  },
  'lib-item-search': async () => {
    const q = (($('#lib-item-q') || {}).value || '').trim().toLowerCase();
    const box = $('#lib-item-results');
    if (!box) return;
    const all = await loadMagicItems();
    const hits = all.filter((i) => !q || i.name.toLowerCase().includes(q)).slice(0, 60);
    box.innerHTML = (hits.map((e) => `<div class="result" role="button" tabindex="0" data-act="lib-item-pick" data-id="${e.id}">
        <span>${esc(e.name)}</span><span class="kind">${esc([e.rarity, e.source === 'wiki' ? 'wiki' : e.source.startsWith('pdf:') ? 'your PDF' : 'yours'].filter(Boolean).join(', '))}</span></div>`).join('')
      || `<p class="muted small">No magic items match.</p>`)
      + (all.some((i) => i.source === 'wiki') ? '' : '<div class="row" style="margin-top:6px"><button class="btn" data-act="magic-sync" data-then="lib">Load magic items from the wiki</button></div>');
  },
  'lib-item-pick': (t) => busy(null, '', async () => {
    if (!S.draft) return;
    const { item } = await api('/api/gear/from-entry', { json: { id: +t.dataset.id } });
    S.draft = { ...item, id: S.draft.id, qty: S.draft.qty || 1 };
    redrawEditor();
    toast(`Filled in from ${item.name}. Check the stats and effects, then add it.`);
  }),
  'magic-sync': (t) => busy(t, 'Reading the wiki…', async () => {
    const r = await api('/api/wiki/magic-items', { method: 'POST' });
    await loadMagicItems(true);
    toast(`${r.count} magic items loaded from the wiki.`);
    if (t.dataset.then === 'lib') ACTIONS['lib-item-search']();
    else renderShopList();
  }),
  'magic-add': (t) => busy(t, 'Adding…', async () => {
    const { item } = await api('/api/gear/from-entry', { json: { id: +t.dataset.id } });
    addItems([item]);
    changed();
    rerenderInv();
    if ((item.variants || []).length > 1) {
      openItemEditor(item.id);
      toast(`${item.name} comes in more than one version; pick yours here.`);
    } else {
      toast(`Added ${item.name}${item.magic && item.magic.attune ? '. Tick Attuned once you’ve attuned to it' : ''}.`);
    }
  }),
  'pact-create': () => {
    const form = ($('#pact-form') || {}).value;
    if (!form) return;
    const inv = S.char.inventory || (S.char.inventory = []);
    for (let i = inv.length - 1; i >= 0; i--) if (inv[i].src === 'pact') inv.splice(i, 1);
    inv.push({ id: newId(), name: `Pact weapon (${form.toLowerCase()})`, kind: 'weapon', base: form, qty: 1, weight: 0, cost_cp: 0,
      equipped: true, bond: 'pact', src: 'pact', notes: 'Disappears if it’s more than 5 feet from you for 1 minute, or if you dismiss it.' });
    changed();
    rerenderInv();
    const pp = $('#pact-panel');
    if (pp) pp.outerHTML = pactPanel();
    toast(`Your pact weapon is a ${form.toLowerCase()}. It’s at the ready in your attacks.`);
  },
  'inv-unpack': (t) => busy(t, 'Unpacking…', async () => {
    const inv = S.char.inventory || [];
    const pack = inv.find((x) => x.id === t.dataset.id);
    if (!pack || !pack.contents) return;
    const n = Math.max(1, +pack.qty || 1);
    const items = await makeItems(pack.contents.map(([name, q]) => ({ name, qty: q * n, src: pack.src || '' })));
    inv.splice(inv.indexOf(pack), 1);
    addItems(items);
    changed();
    rerenderInv();
    toast(`Unpacked ${pack.name}.`);
  }),
  'inv-step': (t) => {
    const it = (S.char.inventory || []).find((x) => x.id === t.dataset.id);
    if (!it) return;
    it.qty = Math.max(0, (+it.qty || 0) + +t.dataset.d);
    changed();
    rerenderInv();
  },
  'ammo-use': (t) => {
    const it = (S.char.inventory || []).find((x) => x.id === t.dataset.id);
    if (!it || !(+it.qty > 0)) { toast('None left.', 'error'); return; }
    it.qty = +it.qty - 1;
    changed();
  },
  'shop-tab': (t) => {
    shopState().tab = t.dataset.tab;
    $$('.shop-tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b === t)));
    renderShopList();
  },
  'shop-add': async (t) => {
    const x = ((S.srd && S.srd.catalog) || []).find((e) => e.name === t.dataset.name);
    if (!x) return;
    let paid = '';
    if (shopState().pay) {
      const left = payCoins(S.char.coins || {}, x.cost_cp);
      if (!left) {
        toast(`Not enough coins: ${x.name} costs ${money(x.cost_cp)} and you have ${purseText()}. Untick “Pay from my coins” to add it anyway.`, 'error');
        return;
      }
      S.char.coins = left;
      paid = ` for ${money(x.cost_cp)}`;
    }
    const items = await makeItems([{ name: x.base || x.name, qty: x.per || 1, src: 'bought' }]);
    addItems(items);
    changed();
    rerenderInv();
    toast(`Added ${x.name}${x.per > 1 ? ` ×${x.per}` : ''}${paid}.`);
  },
});

Object.assign(CHANGES, {
  'sg-method': (t) => { gearPick().method = t.value; renderStartGear(); },
  'sg-opt': (t) => { gearPick().opt[+t.dataset.i] = +t.value; renderStartGear(); },
  'sg-pick': (t) => {
    const pk = gearPick(), [i, j] = t.dataset.key.split('-');
    pk.pick[t.dataset.key] = t.value;
    if (i !== 'bg') pk.opt[+i] = +j;
    renderStartGear();
  },
  'sg-bg': (t) => { gearPick().bg = t.checked; renderStartGear(); },
  'sg-gold': (t) => { gearPick().gold = t.value; },
  'pact-redraw': () => { const pp = $('#pact-panel'); if (pp) pp.outerHTML = pactPanel(); },
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.shop === 'q') {
    shopState().q = t.value;
    renderShopList();
  } else if (t.dataset.inv && (t.type === 'text' || t.type === 'number')) invField(t);
  else if (t.dataset.it && (t.type === 'text' || t.type === 'number' || t.tagName === 'TEXTAREA')) setItemField(t);
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.shop === 'prof') {
    shopState().prof = t.checked;
    renderShopList();
  } else if (t.dataset.shop === 'pay') shopState().pay = t.checked;
  else if (t.dataset.shop === 'rarity') { shopState().rarity = t.value; renderShopList(); }
  else if (t.dataset.shop === 'attuneOnly') { shopState().attuneOnly = t.checked; renderShopList(); }
  else if (t.dataset.inv && (t.type === 'checkbox' || t.tagName === 'SELECT')) invField(t);
  else if (t.dataset.it) {
    if (t.type === 'checkbox' || t.tagName === 'SELECT') setItemField(t);
    if (t.hasAttribute('data-redraw')) redrawEditor();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('.item-modal')) { e.stopImmediatePropagation(); closeItemEditor(); }
  if (e.key === 'Enter' && e.target.id === 'lib-item-q') ACTIONS['lib-item-search']();
}, true);
document.addEventListener('toggle', (e) => { if (e.target.id === 'play-inv') S.playInvOpen = e.target.open; }, true);
