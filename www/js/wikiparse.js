/* Parsers for dnd5e.wikidot.com pages, ported from the PC app's wikiparse.py; tests/wiki.test.mjs checks both
   give the same answers.

   Every parser takes raw page HTML and returns plain objects. The HTML is first turned into structured text
   (headings marked with '#', list items with '- ', bold labels kept inline), and most fields are read from that
   text. The Python uses BeautifulSoup; here the page goes through the browser's DOMParser (or linkedom in tests,
   see setHtmlParser) and the few BeautifulSoup calls the parsers need are written out below. */
import { ABILITY_NAMES, ARMOR, CLASS_RULES, NAME_TO_ABILITY, SKILLS, WEAPONS } from './srd.js';
import { itemEffectsFromText } from './gear.js';
import { capitalize } from './py.js';

export { itemEffectsFromText };
export const SITE = 'dnd5e.wikidot.com';
export const PARSER_VERSION = 6;
const KNOWN_CLASSES = new Set(Object.keys(CLASS_RULES));
const ALL_SKILLS = Object.keys(SKILLS);

const BLOCK_TAGS = new Set(['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table',
  'thead', 'tbody', 'tr', 'blockquote', 'hr', 'pre', 'dl', 'dt', 'dd']);
const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
const ORD_RE = /^(\d{1,2})(?:st|nd|rd|th)\b/i;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------------------------------------------------------------- a little of BeautifulSoup, on the DOM */
let parseHtml = (html) => new DOMParser().parseFromString(html, 'text/html');
/** Tests run under Node, which has no DOMParser: they hand in linkedom's parser. */
export function setHtmlParser(fn) { parseHtml = fn; }

const ELEMENT = 1, TEXT = 3, CDATA = 4, COMMENT = 8;
const tagName = (n) => (n && n.nodeType === ELEMENT ? n.tagName.toLowerCase() : null);
const isString = (n) => n.nodeType === TEXT || n.nodeType === CDATA || n.nodeType === COMMENT;   // NavigableString
const NOT_TEXT = new Set(['script', 'style', 'template']);   // BeautifulSoup keeps these strings out of get_text

/** Every node inside n, in document order (BeautifulSoup's .descendants). */
function* descendants(n) {
  for (let c = n.firstChild; c; c = c.nextSibling) {
    yield c;
    if (c.firstChild) yield* descendants(c);
  }
}
const elements = (n) => [...descendants(n)].filter((c) => c.nodeType === ELEMENT);

/** get_text(sep, strip): the text strings inside n (not comments, scripts or styles), joined. */
function getText(n, sep = '', strip = false) {
  const out = [];
  const walk = (node) => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === TEXT || c.nodeType === CDATA) {
        const t = strip ? c.data.trim() : c.data;
        if (!strip || t) out.push(t);
      } else if (c.nodeType === ELEMENT && !NOT_TEXT.has(tagName(c))) walk(c);
    }
  };
  if (n.nodeType === TEXT) return strip ? n.data.trim() : n.data;
  walk(n);
  return out.join(sep);
}
const text1 = (n) => getText(n, ' ', true);

/** Does element el match a BeautifulSoup-style filter: name (string, list or RegExp) and attrs. */
function matches(el, name, attrs = {}) {
  const t = tagName(el);
  if (!t) return false;
  if (name instanceof RegExp ? !name.test(t) : Array.isArray(name) ? !name.includes(t) : name && t !== name) return false;
  for (const [k, want] of Object.entries(attrs)) {
    if (k === 'class_') {
      const cls = (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);
      if (!cls.includes(want) && el.getAttribute('class') !== want) return false;
      continue;
    }
    const v = el.getAttribute(k);
    if (want === true) { if (v == null) return false; } else if (want instanceof RegExp) { if (v == null || !want.test(v)) return false; } else if (v !== want) return false;
  }
  return true;
}
function findAll(n, name, attrs = {}, recursive = true) {
  const pool = recursive ? elements(n) : [...n.childNodes].filter((c) => c.nodeType === ELEMENT);
  return pool.filter((el) => matches(el, name, attrs));
}
const find = (n, name, attrs = {}) => elements(n).find((el) => matches(el, name, attrs)) || null;
function findParent(n, name) {
  for (let p = n.parentNode; p && p.nodeType === ELEMENT; p = p.parentNode) if (matches(p, name)) return p;
  return null;
}
const select = (n, css) => [...n.querySelectorAll(css)];
const nextSiblings = (n) => { const out = []; for (let s = n.nextSibling; s; s = s.nextSibling) if (s.nodeType === ELEMENT) out.push(s); return out; };
/** find_next(name): the first matching element after n in document order (its own children included). */
function findNext(n, name) {
  const all = elements(n.ownerDocument);
  for (let i = all.indexOf(n) + 1; i < all.length; i++) if (matches(all[i], name)) return all[i];
  return null;
}

/* ---------------------------------------------------------------- html helpers */
export const soup = (html) => parseHtml(html || '');

export function contentRoot(doc) {
  return doc.getElementById('page-content') || doc.body || doc.documentElement || doc;
}

export function pageTitle(doc) {
  const el = doc.getElementById('page-title');
  if (el && getText(el, '', true)) return text1(el);
  const t = find(doc, 'title');
  // BeautifulSoup's title.string: only when the title holds exactly one string
  if (t && t.childNodes.length === 1 && isString(t.firstChild) && t.firstChild.data) return t.firstChild.data.split(' - ')[0].trim();
  return '';
}

function skip(node) {
  const t = tagName(node);
  if (['script', 'style', 'noscript'].includes(t)) return true;
  if (['toc', 'page-info', 'page-tags'].includes(node.getAttribute('id'))) return true;
  const classes = (node.getAttribute('class') || '').split(/\s+/);
  return classes.some((c) => ['toc', 'yui-nav', 'page-tags', 'footnotes-footer', 'printuser'].includes(c));
}

/** Turn an HTML element into readable structured text. */
export function toText(node) {
  const parts = [];
  const walk = (n) => {
    if (n.nodeType === COMMENT) return;
    if (n.nodeType === TEXT || n.nodeType === CDATA) { parts.push(n.data); return; }
    if (n.nodeType !== ELEMENT && n.nodeType !== 9) return;
    if (n.nodeType === ELEMENT && skip(n)) return;
    const name = tagName(n);
    if (name === 'br') { parts.push('\n'); return; }
    if (name === 'td' || name === 'th') parts.push(' | ');
    const block = BLOCK_TAGS.has(name);
    if (block) parts.push('\n');
    if (HEADINGS.includes(name)) parts.push('#'.repeat(+name[1]) + ' ');
    else if (name === 'li') parts.push('- ');
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
    if (block) parts.push('\n');
  };
  walk(node);
  const lines = [];
  let blank = false;
  for (let line of parts.join('').split('\n')) {
    line = line.replace(/[ \t\xa0​]+/g, ' ').trim();
    if (line.startsWith('|')) line = line.replace(/^[| ]+|[| ]+$/g, '').trim();
    if (!line) {
      if (!blank && lines.length) lines.push('');
      blank = true;
      continue;
    }
    // "- " alone (li wrapping a p): merge with the next content line
    if (lines.length && lines[lines.length - 1] === '-') lines[lines.length - 1] = '- ' + line;
    else lines.push(line);
    blank = false;
  }
  return lines.join('\n').trim();
}

export function labelValue(text, label) {
  const m = text.match(new RegExp(`^(?:- )?${reEsc(label)}\\s*:\\s*(.+)$`, 'mi'));
  return m ? m[1].trim() : null;
}

/** [path, fragment] for links on the wiki, or null for other links. */
export function normPath(href) {
  if (!href || href.startsWith('javascript') || href.startsWith('mailto') || href.startsWith('#')) return null;
  const m = href.match(/^(?:https?:\/\/(?:www\.)?dnd5e\.wikidot\.com)?(\/[^?#]*)?(?:\?[^#]*)?(#.*)?$/);
  if (!m || (m[1] === undefined && !href.startsWith('/'))) return null;
  return [m[1] || '/', m[2] || ''];
}

export function parseOrdinal(s) {
  const m = (s || '').trim().match(ORD_RE);
  return m ? parseInt(m[1], 10) : null;
}

const stripPunct = (p) => p.replace(/^[ .;]+|[ .;]+$/g, '');
export function splitList(s) {
  return (s || '').replace(/\band\b|\bor\b/g, ',').split(',').map(stripPunct).filter(Boolean);
}

export function abilitiesIn(s) {
  const found = [];
  for (const word of (s || '').match(/[A-Za-z]+/g) || []) {
    const code = NAME_TO_ABILITY[word.toLowerCase()];
    if (code && !found.includes(code)) found.push(code);
  }
  return found;
}

export function skillsIn(s) {
  const low = (s || '').toLowerCase();
  return ALL_SKILLS.filter((sk) => new RegExp(`\\b${reEsc(sk.toLowerCase())}\\b`).test(low));
}

/** Split text on headings of exactly `level` '#'. Returns [preamble, [[title, body]]]. */
export function sections(text, level) {
  const ms = [...text.matchAll(new RegExp(`^${'#'.repeat(level)} (.+)$`, 'gm'))];
  if (!ms.length) return [text, []];
  const pre = text.slice(0, ms[0].index).trim();
  const out = ms.map((m, i) => {
    const end = i + 1 < ms.length ? ms[i + 1].index : text.length;
    return [m[1].trim(), text.slice(m.index + m[0].length, end).trim()];
  });
  return [pre, out];
}

export function firstLevelMention(text) {
  let m = (text || '').match(/(?:At|Starting at|Beginning at|When you reach|By|Also at|Once you reach)\s+(\d{1,2})(?:st|nd|rd|th)\s+level/i);
  if (!m) m = (text || '').match(/(\d{1,2})(?:st|nd|rd|th)[- ]level/i);
  return m ? parseInt(m[1], 10) : null;
}

/* ---------------------------------------------------------------- index */
/** Read the wiki front page (or /lineage) and list every linked entry: kind (class, subclass, class-option, race,
    background, feat, spell-list), name, path, group, parent and tags (ua / homebrew). */
export function parseIndex(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const out = [], seen = new Set();
  let hMajor = '', hMinor = '', currentClass = null;
  for (const el of elements(root)) {
    const t = tagName(el);
    if (HEADINGS.includes(t)) {
      const txt = text1(el);
      if (t === 'h1' || t === 'h2') {
        hMajor = txt; hMinor = '';
        currentClass = null;
        const a = find(el, 'a');
        const p = a ? normPath(a.getAttribute('href')) : null;
        if (p && txt.toLowerCase().startsWith('the ') && /^\/[a-z0-9-]+$/.test(p[0])) currentClass = p[0].slice(1);
      } else hMinor = txt;
      continue;
    }
    if (t !== 'a') continue;
    const p = normPath(el.getAttribute('href'));
    if (!p) continue;
    const [path, frag] = p;
    const name = text1(el);
    if (!name || name === '(a)') continue;
    const context = `${hMajor} ${hMinor}`.toLowerCase();
    const tags = [];
    if (context.includes('unearthed arcana') || path.endsWith('-ua') || name.toLowerCase().includes('(ua)')) tags.push('ua');
    if (context.includes('homebrew') || name.toLowerCase().includes('(homebrew)') || path.endsWith('-hb')) tags.push('homebrew');
    let entry = null;
    const segs = path.replace(/^\/+|\/+$/g, '').split(':');
    if (segs[0] === 'lineage' && segs.length === 2) entry = { kind: 'race' };
    else if (segs[0] === 'background' && segs.length === 2) {
      if (segs[1] === 'optional-features') continue;
      entry = { kind: 'background' };
      if (frag) entry.variant_of = path;
    } else if (segs[0] === 'feat' && segs.length === 2) entry = { kind: 'feat' };
    else if (segs[0] === 'spells' && segs.length === 2 && KNOWN_CLASSES.has(segs[1])) entry = { kind: 'spell-list', parent: segs[1] };
    else if (segs.length === 1 && segs[0] && findParent(el, HEADINGS) && (KNOWN_CLASSES.has(segs[0]) || segs[0] === currentClass)) {
      entry = { kind: 'class' };
    } else if (segs.length >= 2 && (KNOWN_CLASSES.has(segs[0]) || segs[0] === currentClass)) {
      entry = segs.length === 2 && !hMinor.toLowerCase().includes('quick links')
        ? { kind: 'subclass', parent: segs[0] } : { kind: 'class-option', parent: segs[0] };
    }
    if (!entry) continue;
    const key = JSON.stringify([entry.kind, path + frag, name]);
    if (seen.has(key)) continue;
    seen.add(key);
    Object.assign(entry, { name: name.replace(/\s+/g, ' '), path: path + frag, group: hMinor || hMajor, tags });
    if (!('parent' in entry)) entry.parent = '';
    out.push(entry);
  }
  return out;
}

/* ---------------------------------------------------------------- spells */
export const SCHOOLS = ['Abjuration', 'Conjuration', 'Divination', 'Enchantment', 'Evocation', 'Illusion', 'Necromancy', 'Transmutation'];

function tabSections(root) {
  const nav = find(root, 'div', { class_: 'yui-navset' });
  if (!nav) return null;
  const labels = select(nav, 'ul.yui-nav > li').map(text1);
  const content = find(nav, 'div', { class_: 'yui-content' });
  const panes = content ? findAll(content, 'div', {}, false) : [];
  if (!labels.length || !panes.length) return null;
  return labels.slice(0, panes.length).map((l, i) => [l, panes[i]]);
}

function levelFromLabel(label) {
  if (!label) return null;
  if (label.toLowerCase().includes('cantrip')) return 0;
  const m = label.match(/(\d)/);
  return m ? parseInt(m[1], 10) : null;
}

/** A row's cells by header, falling back to position (the parsers' col()). */
const colOf = (row, texts) => (key, idx) => {
  for (const [h, v] of row) if (h.includes(key)) return v;
  return texts.length > idx ? texts[idx] : '';
};
const rowMap = (header, texts) => {
  const m = new Map();
  header.forEach((h, i) => { if (i < texts.length) m.set(h, texts[i]); });
  return m;
};

/** A class spell list page (/spells:wizard) or the full /spells page. */
export function parseSpellList(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const tabbed = tabSections(root);
  const nav = find(root, 'div', { class_: 'yui-navset' });
  const navContent = nav ? find(nav, 'div', { class_: 'yui-content' }) : null;
  const navTables = navContent ? findAll(navContent, 'table') : [];
  const labels = nav ? select(nav, 'ul.yui-nav > li').map(text1) : [];
  let groups;
  if (labels.length && navTables.length === labels.length) {
    // one table per tab: pair them directly, nested panes are not always direct children
    groups = labels.map((l, i) => [levelFromLabel(l), navTables[i]]);
  } else if (tabbed) groups = tabbed.map(([l, pane]) => [levelFromLabel(l), pane]);
  else {
    const tables = findAll(root, 'table');
    groups = tables.map((t, i) => [tables.length === 10 ? i : null, t]);
  }
  const spells = [], seen = new Set();
  const SPELL_LINK = /spell:/;
  for (const [level, pane] of groups) {
    for (const table of tagName(pane) === 'table' ? [pane] : findAll(pane, 'table')) {
      let header = [];
      for (const tr of findAll(table, 'tr')) {
        const texts = findAll(tr, ['td', 'th']).map(text1);
        const a = find(tr, 'a', { href: SPELL_LINK });
        if (!a) {
          if (texts.length && texts[0].toLowerCase().startsWith('spell')) header = texts.map((t) => t.toLowerCase());
          continue;
        }
        const p = normPath(a.getAttribute('href'));
        if (!p) continue;
        const col = colOf(header.length ? rowMap(header, texts) : new Map(), texts);
        const name = text1(a);
        const schoolWords = col('school', 1).split(/\s+/).filter(Boolean);
        const school = schoolWords.length ? capitalize(schoolWords[0]) : '';
        const cast = col('casting', 2);
        const ritual = /\sR$/.test(cast);
        const tags = [];
        const extra = schoolWords.length > 1 ? schoolWords.slice(1) : [];
        if (extra.includes('T')) tags.push('technomagic');
        if (extra.some((x) => ['D', 'DG', 'DC'].includes(x))) tags.push('dunamancy');
        if (name.toLowerCase().includes('(ua)')) tags.push('ua');
        if (seen.has(p[0])) continue;
        seen.add(p[0]);
        spells.push({ name, path: p[0], level, school, casting_time: cast.replace(/\s+R$/, '').trim(), ritual,
          range: col('range', 3), duration: col('duration', 4), components: col('component', 5), tags });
      }
    }
  }
  return spells;
}

export function parseSpell(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  const lines = text.split('\n').filter((l) => l.trim());
  const data = { name: pageTitle(doc), source: labelValue(text, 'Source') || '' };
  let level = null, school = '', ritual = false;
  for (const line of lines.slice(0, 8)) {
    let m = line.match(/^(\d)(?:st|nd|rd|th)[- ]level (\w+)(?:\s*\((ritual)\))?/i);
    if (m) { level = parseInt(m[1], 10); school = capitalize(m[2]); ritual = Boolean(m[3]); break; }
    m = line.match(/^(\w+) cantrip/i);
    if (m) { level = 0; school = capitalize(m[1]); break; }
  }
  Object.assign(data, { level, school, ritual });
  for (const [key, label] of [['casting_time', 'Casting Time'], ['range', 'Range'], ['components', 'Components'], ['duration', 'Duration']]) {
    data[key] = labelValue(text, label) || '';
  }
  let classes = [];
  for (const p of findAll(root, ['p', 'div'])) {
    if (getText(p).includes('Spell Lists') && find(p, 'a')) {
      classes = findAll(p, 'a').filter((a) => (a.getAttribute('href') || '').includes('spells:')).map((a) => getText(a, '', true));
      if (classes.length) break;
    }
  }
  if (!classes.length) {
    const m = text.match(/^Spell Lists\.\s*(.+)$/m);
    classes = m ? splitList(m[1]) : [];
  }
  data.classes = classes;
  const desc = [];
  let higher = '', started = false;
  for (const line of lines) {
    if (/^Duration\s*:/i.test(line)) { started = true; continue; }
    if (!started) continue;
    if (line.startsWith('At Higher Levels.')) { higher = line.slice('At Higher Levels.'.length).trim(); continue; }
    if (line.startsWith('Spell Lists.')) break;
    desc.push(line);
  }
  data.description = desc.join('\n').trim();
  data.higher_levels = higher;
  if (data.concentration == null) data.concentration = data.duration.toLowerCase().includes('concentration');
  return data;
}

/* ---------------------------------------------------------------- classes */
/** 'Choose two from Arcana, History...' -> [2, [...]]; 'Choose any three' -> [3, all]. */
export function parseSkillChoice(s) {
  if (!s) return [0, []];
  const m = s.match(/choose\s+(any\s+)?(\w+)/i);
  let count = 0;
  if (m) {
    const word = m[2].toLowerCase();
    count = NUM_WORDS[word] || (/^\d+$/.test(word) ? parseInt(word, 10) : 0);
    if (m[1] || /any \w+ skills?/i.test(s)) return [count, [...ALL_SKILLS]];
  }
  return [count, skillsIn(s)];
}

function classTable(root) {
  for (const table of findAll(root, 'table')) {
    const rows = findAll(table, 'tr');
    let header = null, start = 0;
    for (const [i, tr] of rows.entries()) {
      const cells = findAll(tr, ['td', 'th']).map(text1);
      if (cells.length && cells[0].trim().toLowerCase() === 'level') { header = cells; start = i + 1; break; }
    }
    if (!header) continue;
    const out = [];
    for (const tr of rows.slice(start)) {
      const cells = findAll(tr, ['td', 'th']).map(text1);
      const lvl = cells.length ? parseOrdinal(cells[0]) : null;
      if (!lvl) continue;
      const row = { _level: lvl };
      header.forEach((h, i) => { if (i < cells.length) row[h] = cells[i]; });
      out.push(row);
    }
    if (out.length) return [header, out];
  }
  return [[], []];
}

function featureNames(cell) {
  return (cell || '').split(/,\s*(?![^()]*\))/).map((p) => p.trim()).filter((p) => p && p !== '-' && p !== '—');
}

const normFeature = (name) => name.replace(/\((optional|[^)]*)\)/gi, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

export function parseClass(html, slug = '') {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  const name = pageTitle(doc);
  const [header, table] = classTable(root);
  let hitDie = null;
  let m = text.match(/Hit Dice\s*:\s*1d(\d+)/i);
  if (m) hitDie = parseInt(m[1], 10);
  const saves = abilitiesIn(labelValue(text, 'Saving Throws') || '');
  const [skillCount, skillOptions] = parseSkillChoice(labelValue(text, 'Skills') || '');
  let spellAbility = null;
  m = text.match(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) is your spellcasting ability/);
  if (m) spellAbility = NAME_TO_ABILITY[m[1].toLowerCase()];
  const featureLevels = {}, asiLevels = [];
  for (const row of table) {
    for (const [col, val] of Object.entries(row)) {
      if (col.toLowerCase() !== 'features') continue;
      for (const f of featureNames(val)) {
        const k = normFeature(f);
        if (!(k in featureLevels)) featureLevels[k] = row._level;
        if (f.toLowerCase().includes('ability score improvement')) asiLevels.push(row._level);
      }
    }
  }
  const features = [];
  const [, h3] = sections(text, 3);
  const choices = featureOptions(root, 3);
  for (const [title, body] of h3) {
    const lvl = featureLevels[normFeature(title)] || firstLevelMention(body);
    const f = { name: title, level: lvl, text: body };
    if (choices[title] && CHOICE_WORDS.test(body)) { f.options = choices[title]; f.choose = choiceCount(body, lvl); }
    features.push(f);
  }
  const subclasses = [];
  let tag = [];
  if (slug) {
    const pat = new RegExp(`^/${reEsc(slug)}:[^:]+$`);
    for (const tr of findAll(root, 'tr')) {
      const a = find(tr, 'a', { href: true });
      const p = a ? normPath(a.getAttribute('href')) : null;
      const rowText = text1(tr).toLowerCase();
      if (!(p && pat.test(p[0]))) {
        if (rowText.includes('unearthed arcana')) tag = ['ua'];
        else if (rowText.includes('homebrew')) tag = ['homebrew'];
        continue;
      }
      const cells = findAll(tr, ['td', 'th']).map(text1);
      subclasses.push({ name: text1(a), path: p[0], source: cells.length > 1 ? cells[1] : '', tags: [...tag] });
    }
  }
  return {
    equipment: equipmentLines(root),
    name, slug, hit_die: hitDie, saves, skill_count: skillCount, skill_options: skillOptions,
    armor: labelValue(text, 'Armor') || '', weapons: labelValue(text, 'Weapons') || '',
    tools: labelValue(text, 'Tools') || '', spell_ability: spellAbility,
    table_header: header, table, features,
    asi_levels: [...new Set(asiLevels)].sort((a, b) => a - b), subclasses,
  };
}

/** The bullet list under a class page's Equipment heading. */
function equipmentLines(root) {
  for (const h of findAll(root, /^h[1-6]$/)) {
    if (!['equipment', 'starting equipment'].includes(text1(h).replace(/^:+|:+$/g, '').toLowerCase())) continue;
    const lines = [];
    for (const sib of nextSiblings(h)) {
      if (/^h[1-6]$/.test(tagName(sib) || '')) break;
      for (const li of findAll(sib, 'li')) {
        const t = text1(li).replace(/\s+/g, ' ').trim();
        if (t) lines.push(t);
      }
    }
    if (lines.length) return lines;
  }
  return [];
}

export function parseSubclass(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  const features = [];
  let [pre, h3] = sections(text, 3);
  if (!h3.length) [pre, h3] = sections(text, 2);
  let choices = featureOptions(root, 3);
  if (!Object.keys(choices).length) choices = featureOptions(root, 2);
  for (const [title, body] of h3) {
    const f = { name: title, level: firstLevelMention(body), text: body };
    if (choices[title] && CHOICE_WORDS.test(body)) { f.options = choices[title]; f.choose = choiceCount(body, f.level); }
    features.push(f);
  }
  const bonus = [];
  for (const table of findAll(root, 'table')) {
    for (const tr of findAll(table, 'tr')) {
      const cells = findAll(tr, ['td', 'th']);
      if (cells.length < 2) continue;
      const lvl = parseOrdinal(text1(cells[0]));
      const links = findAll(tr, 'a', { href: /spell:/ }).map(text1);
      if (lvl && links.length) bonus.push({ level: lvl, spells: links });
    }
  }
  return { name: pageTitle(doc), source: labelValue(text, 'Source') || '', intro: pre, features, bonus_spells: bonus };
}

/* ---------------------------------------------------------------- species */
const TRAIT_RE = /^- ([A-Z][^.:]{1,60}?)[.:]\s+(.+)$/;

function traitsOf(text) {
  const traits = [];
  for (const line of text.split('\n')) {
    const m = line.match(TRAIT_RE);
    if (m) traits.push({ name: m[1].trim(), text: m[2].trim() });
    else if (traits.length && line && !line.startsWith('#') && !line.startsWith('- ') && !line.startsWith('|')) {
      // continuation paragraph belonging to the previous trait (tables, extra paragraphs)
      traits[traits.length - 1].text += '\n' + line;
    }
  }
  return traits;
}

function intro(text) {
  for (const line of text.split('\n')) if (line && !line.startsWith('#') && !line.startsWith('- ') && !line.startsWith('Source:')) return line;
  return '';
}

function variantOf(source, text) {
  let [pre, subs] = sections(text, 2);
  if (!subs.length) [pre, subs] = sections(text, 3);
  let baseTraits = traitsOf(pre);
  let subraces = [];
  for (const [title, body] of subs) {
    const t = traitsOf(body);
    if (t.length) subraces.push({ name: title, intro: intro(body), traits: t });
  }
  if (!baseTraits.length && subraces.length === 1 && !source) {
    // page with no base block: treat the single section as the base
    baseTraits = subraces[0].traits; subraces = [];
  }
  return { source: source || (labelValue(text, 'Source') || ''), intro: intro(pre), traits: baseTraits, subraces };
}

export function parseRace(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  let variants = [];
  const tabbed = tabSections(root);
  if (tabbed) for (const [label, pane] of tabbed) variants.push(variantOf(label, toText(pane)));
  else {
    const text = toText(root);
    const [, h1] = sections(text, 1);
    if (h1.length) {
      for (const [title, body] of h1) {
        const v = variantOf(title, body);
        if (v.traits.length || v.subraces.length) variants.push(v);
      }
    } else variants.push(variantOf('', text));
  }
  variants = variants.filter((v) => v.traits.length || v.subraces.length);
  return { name: pageTitle(doc), variants };
}

const CHOICE_RE = /(?:proficiency (?:in|with)|proficient in)\s+(?:your choice of\s+)?(one|two|three|four|a|an)\s+(of the following\s+)?(?:other\s+)?skills?\b([^.]*)/i;

/** 'proficiency with two of the following skills of your choice: A, B, C' -> {count, options};
    options is null when any skill may be chosen. */
export function skillChoice(text) {
  const m = (text || '').match(CHOICE_RE);
  if (!m) return null;
  const count = NUM_WORDS[m[1].toLowerCase()] || 1;
  const rest = m[3];
  if (!m[2] && !rest.toLowerCase().includes('of your choice') && !rest.includes(':')) return null;
  const options = m[2] || rest.includes(':') ? skillsIn(rest) : [];
  return { count, options: options.length ? options : null };
}

/** A background's 'Skill Proficiencies' line -> [fixed skills, choices]. */
export function skillField(text) {
  text = text || '';
  const m = text.match(/\b(choose|one of|two of|plus one|and one|from among|of your choice)\b/i);
  if (!m) return [skillsIn(text), []];
  const before = text.slice(0, m.index), after = text.slice(m.index);
  const n = after.match(/\b(one|two|three|four)\b/i);
  const count = n ? NUM_WORDS[n[1].toLowerCase()] || 1 : 1;
  const options = skillsIn(after);
  return [skillsIn(before), [{ count, options: options.length ? options : null, trait: 'Background' }]];
}

/** The 'of your choice' part of an Ability Score Increase trait, as picks: [[{count, amount, exclude}], alt or null]. */
export function asiChoices(low, fixed) {
  let picks = [], alt = null;
  let m = low.match(/increase one (?:ability )?score by (\d),? and (?:increase )?a different (?:ability )?score by (\d)(?:,? or increase (one|two|three) different (?:ability )?scores by (\d))?/);
  if (m) {
    picks = [{ count: 1, amount: parseInt(m[1], 10), exclude: [] }, { count: 1, amount: parseInt(m[2], 10), exclude: [] }];
    if (m[3]) alt = [{ count: NUM_WORDS[m[3]] || 3, amount: parseInt(m[4], 10), exclude: [] }];
    return [picks, alt];
  }
  const re = /\b(one|two|three|four|a)\b ((?:other |different )*)(?:ability )?scores?(?: of your choice)?,? (?:each )?(?:increases?|increase) by (\d)/g;
  for (m of low.matchAll(re)) {
    if (!m[0].includes('of your choice') && !m[2].includes('different') && !m[2].includes('other')) continue;
    const n = m[1] === 'a' ? 1 : NUM_WORDS[m[1]] || 1;
    picks.push({ count: n, amount: parseInt(m[3], 10), exclude: m[2].includes('other') ? Object.keys(fixed).sort() : [] });
  }
  return [picks, alt];
}

/** Pull numbers out of species traits: ability increases, speed, size, senses, skills. */
export function analyzeTraits(traits) {
  const out = { asi: {}, asi_note: '', asi_flexible: false, asi_choice: [], asi_alt: null, speed: null, size: '',
    darkvision: null, languages: '', skills: [], skill_choices: 0, bonus_feat: false, hp_per_level: 0,
    weapon_profs: [], armor_profs: [], choices: [] };
  for (const t of traits) {
    const name = t.name.toLowerCase(), body = t.text || '';
    const low = body.toLowerCase();
    if (name.includes('ability score')) {
      out.asi_note = `${out.asi_note} ${body}`.trim();
      if (/ability scores each increase by 1/.test(low)) {
        for (const code of Object.keys(ABILITY_NAMES)) out.asi[code] = (out.asi[code] || 0) + 1;
      }
      for (const m of body.matchAll(/(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) score(?:s)? (?:increases|increase|each increase) by (\d)/g)) {
        const code = NAME_TO_ABILITY[m[1].toLowerCase()];
        out.asi[code] = (out.asi[code] || 0) + parseInt(m[2], 10);
      }
      if (/of your choice|one score by 2|different score|two different|three different/.test(low)) {
        out.asi_flexible = true;
        const [picks, alt] = asiChoices(low, out.asi);
        out.asi_choice.push(...picks);
        out.asi_alt = alt || out.asi_alt;
      }
    } else if (name === 'speed' || low.slice(0, 120).includes('walking speed')) {
      const m = low.match(/walking speed (?:is|of) (\d+)/);
      if (m && out.speed === null) out.speed = parseInt(m[1], 10);
    }
    if (name === 'size') {
      const m = low.match(/your size is (tiny|small|medium|large)/);
      const m2 = /you are (small or medium|medium or small)/.test(low);
      out.size = m ? capitalize(m[1]) : (m2 ? 'Small or Medium' : '');
    }
    if (name.includes('darkvision')) {
      const m = low.match(/within (\d+) feet/);
      if (m) out.darkvision = parseInt(m[1], 10);
    }
    if (name === 'languages') out.languages = body.split('.')[0].replace(/^you can speak, read, and write\s+/i, '');
    if (name === 'feat' || low.includes('feat of your choice')) out.bonus_feat = true;
    if (/hit point maximum increases by 1,? and it increases by 1 every time you gain a level/.test(low)) out.hp_per_level += 1;
    for (const m of body.matchAll(/(?:proficiency in|proficient in) (?:the )?([A-Za-z ,]+?) skills?\b/g)) {
      for (const sk of skillsIn(m[1])) if (!out.skills.includes(sk)) out.skills.push(sk);
    }
    const choice = skillChoice(body);
    if (choice) {
      choice.trait = t.name;
      out.choices.push(choice);
      out.skill_choices += choice.count;
    }
    let m = low.match(/proficiency with (?:the )?([a-z ,']+?)(?:\.|$)/);
    if (m && !m[1].includes('armor') && !m[1].includes('tools') && !m[1].includes('artisan')) {
      out.weapon_profs.push(...splitList(m[1]).map((w) => w.trim()).filter(Boolean));
    }
    m = low.match(/proficiency with (light|medium|heavy)(?: and (light|medium|heavy))? armor/);
    if (m) out.armor_profs.push(...[m[1], m[2]].filter(Boolean));
  }
  return out;
}

/* ---------------------------------------------------------------- backgrounds and feats */
export function parseBackground(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  const [skills, skillChoices] = skillField(labelValue(text, 'Skill Proficiencies') || '');
  let featureName = '', featureText = '';
  let m = text.match(/^#+ Feature:\s*(.+)$/m);
  if (m) {
    featureName = m[1].trim();
    const rest = text.slice(m.index + m[0].length);
    const nxt = rest.match(/^#+ /m);
    featureText = nxt ? rest.slice(0, nxt.index).trim() : rest.trim();
  } else {
    m = text.match(/^Feature:\s*(.+)$/m);
    if (m) featureName = m[1].trim();
  }
  return {
    name: pageTitle(doc).replace(/^Background:\s*/, ''), source: labelValue(text, 'Source') || '',
    skills, skill_choices: skillChoices, skills_text: labelValue(text, 'Skill Proficiencies') || '',
    tools: labelValue(text, 'Tool Proficiencies') || '',
    languages: labelValue(text, 'Languages') || '',
    equipment: labelValue(text, 'Equipment') || '',
    feature: { name: featureName, text: featureText },
    characteristics: characteristics(root),
    text,
  };
}

/** A background's Suggested Characteristics tables: {personality_traits: [...], ideals, bonds, flaws}. */
function characteristics(root) {
  const out = {};
  const keys = [['personality trait', 'personality_traits'], ['ideal', 'ideals'], ['bond', 'bonds'], ['flaw', 'flaws']];
  for (const h of findAll(root, /^h[1-6]$/)) {
    const title = text1(h).toLowerCase();
    const hit = keys.find(([k]) => title.startsWith(k));
    const key = hit ? hit[1] : null;
    if (!key || key in out) continue;
    const table = findNext(h, 'table');
    const rows = [];
    for (const tr of table ? findAll(table, 'tr') : []) {
      const cells = findAll(tr, 'td');
      if (cells.length >= 2 && getText(cells[cells.length - 1], '', true)) rows.push(text1(cells[cells.length - 1]).replace(/\s+/g, ' '));
    }
    if (rows.length) out[key] = rows;
  }
  return out;
}

export function parseFeat(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  let asiOptions = [], asiAmount = 0;
  let m = text.match(/Increase your ([A-Za-z, ]+?) score by (\d)/);
  if (m) { asiOptions = abilitiesIn(m[1]); asiAmount = parseInt(m[2], 10); } else {
    m = text.match(/Increase (?:the chosen|one) ability score(?: of your choice)? by (\d)/i);
    if (m) { asiOptions = Object.keys(ABILITY_NAMES); asiAmount = parseInt(m[1], 10); }
  }
  const body = text.split('\n').filter((l) => !l.startsWith('Source:')).join('\n');
  return { name: pageTitle(doc), source: labelValue(text, 'Source') || '', prerequisite: labelValue(text, 'Prerequisite') || '',
    asi_options: asiOptions, asi_amount: asiAmount, text: body.trim() };
}

/* ---------------------------------------------------------------- magic items */
export const RARITIES = ['common', 'uncommon', 'rare', 'very rare', 'legendary', 'artifact'];
export const ITEM_TYPES = { 'wondrous item': 'wondrous', weapon: 'weapon', armor: 'armor', ring: 'ring', potion: 'potion',
  rod: 'rod', staff: 'staff', wand: 'wand', scroll: 'scroll', ammunition: 'ammunition', shield: 'shield' };

/** The wiki's magic item list (/wondrous-items): one table per rarity tab. */
export function parseMagicItemList(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const nav = find(root, 'div', { class_: 'yui-navset' });
  let groups = [];
  if (nav) {
    const labels = select(nav, 'ul.yui-nav > li').map(text1);
    const content = find(nav, 'div', { class_: 'yui-content' });
    const tables = content ? findAll(content, 'table') : [];
    const panes = content ? findAll(content, 'div', {}, false) : [];
    if (labels.length && tables.length === labels.length) groups = labels.map((l, i) => [l, tables[i]]);
    else if (labels.length && panes.length === labels.length) groups = labels.map((l, i) => [l, panes[i]]);
  }
  if (!groups.length) groups = findAll(root, 'table').map((t) => ['', t]);
  const items = [], seen = new Set();
  for (const [label, node] of groups) {
    const rarity = RARITIES.includes(label.trim().toLowerCase()) ? label.trim().toLowerCase() : '';
    for (const table of tagName(node) === 'table' ? [node] : findAll(node, 'table')) {
      let header = [];
      for (const tr of findAll(table, 'tr')) {
        const texts = findAll(tr, ['td', 'th']).map(text1);
        const a = find(tr, 'a', { href: true });
        const p = a ? normPath(a.getAttribute('href')) : null;
        if (!(p && /^\/wondrous-items:[^:/]+$/.test(p[0]))) {
          if (texts.length && texts[0].toLowerCase().includes('item')) header = texts.map((t) => t.toLowerCase());
          continue;
        }
        if (seen.has(p[0])) continue;
        seen.add(p[0]);
        const col = colOf(header.length ? rowMap(header, texts) : new Map(), texts);
        const kind = col('type', 1), attuned = col('attun', 2), source = col('source', 3);
        const tags = /\bUA\b/.test(source) || getText(a).toLowerCase().includes('(ua)') ? ['ua'] : [];
        if (/\bHB\b|homebrew/i.test(source)) tags.push('homebrew');
        const k = kind.trim().toLowerCase();
        items.push({ name: text1(a), path: p[0], rarity, item_type: ITEM_TYPES[k] || k || 'wondrous',
          attunement: Boolean(attuned) && !['-', '–', '—', 'No', 'no'].includes(attuned.trim()), source, tags });
      }
    }
  }
  return items;
}

const numWord = (w) => ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 }[String(w).toLowerCase()] || (/^\d+$/.test(String(w)) ? parseInt(w, 10) : null));

/** A magic item page: its type line, rarity, attunement, charges, bonus and the effects we can read. */
export function parseMagicItem(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  const out = { name: pageTitle(doc), source: labelValue(text, 'Source') || '', item_type: '', rarity: '',
    attunement: false, attune_by: '', works_as: '', bonus: 0, variants: [], charges: 0,
    regain: '', when: '', effects: [], type_line: '' };
  const typeRe = /^(wondrous item|weapon|armor|ring|potion|rod|staff|wand|scroll|ammunition|shield)\b\s*(?:\(([^)]*)\))?\s*,\s*(.+)$/i;
  const bodyLines = [];
  for (const line of text.split('\n')) {
    const clean = line.trim().replace(/^[*_ ]+|[*_ ]+$/g, '');
    if (!out.type_line) {
      const m = clean.match(typeRe);
      if (m) {
        out.type_line = clean;
        const kind = m[1].toLowerCase(), detail = (m[2] || '').trim(), rest = m[3];
        out.item_type = ITEM_TYPES[kind] || kind;
        if (out.item_type === 'armor' && detail.toLowerCase().includes('shield')) out.item_type = 'shield';
        const low = rest.toLowerCase();
        out.rarity = ['very rare', 'uncommon', 'common', 'rare', 'legendary', 'artifact'].find((r) => new RegExp(`\\b${r}\\b`).test(low))
          || (low.includes('varies') ? 'varies' : '');
        out.attunement = low.includes('requires attunement');
        const by = rest.match(/requires attunement by ([^)]+)/i);
        out.attune_by = by ? by[1].trim() : '';
        out.variants = [...rest.matchAll(/(uncommon|very rare|rare|legendary)\s*\(\+(\d)\)/gi)].map((v) => ({ rarity: v[1].toLowerCase(), bonus: parseInt(v[2], 10) }));
        if (out.variants.length > 1) out.rarity = 'varies';
        out.works_as = worksAs(detail);
        out.type_detail = detail;
        continue;
      }
    }
    if (clean.toLowerCase().startsWith('source:') || clean === out.name) continue;
    if (out.type_line) bodyLines.push(line);
  }
  let body = bodyLines.join('\n').trim();
  body = body.replace(/\n*This text is from a page on the DND 5th Edition community wiki[\s\S]*$/, '').trim();
  out.text = body;
  if (out.item_type === 'staff' && !out.works_as && /\bquarterstaff\b/i.test(body)) out.works_as = 'Quarterstaff';
  let m = body.match(/\bhas (\d+) charges\b/i);
  if (m) {
    out.charges = parseInt(m[1], 10);
    const r = body.match(/regains? (all|\d+d\d+(?:\s*[+−-]\s*\d+)?|\d+)\s+(?:expended )?charges?[^.]*?(dawn|long rest|short rest)?[.]/i);
    if (r) {
      out.regain = r[1].replace(/−/g, '-').replace(/\s+/g, '').toLowerCase();
      const when = (r[2] || '').toLowerCase();
      out.when = when.includes('long') ? 'long' : when.includes('short') ? 'short' : 'dawn';
    }
  }
  m = body.match(/\+(\d) bonus to attack and damage rolls made with (?:this|these|a piece of this) (?:magic )?(?:weapon|ammunition|\w+)/i);
  if (m && ['weapon', 'ammunition', 'staff'].includes(out.item_type)) out.bonus = parseInt(m[1], 10);
  m = body.match(/\+(\d) bonus to AC while (?:you (?:wear|are wearing)|wearing) this armor/i)
    || body.match(/\+(\d) bonus to AC (?:in addition to the shield's normal bonus|while (?:holding|wielding) this shield)/i)
    || body.match(/(?:holding|wielding) this shield, you have a \+(\d) bonus to AC/i);
  if (m && ['armor', 'shield'].includes(out.item_type)) out.bonus = parseInt(m[1], 10);
  if (!out.bonus && out.variants.length && ['weapon', 'armor', 'shield', 'ammunition'].includes(out.item_type)) out.bonus = out.variants[0].bonus;
  out.effects = itemEffectsFromText(body, out);
  return out;
}

function worksAs(detail) {
  const d = detail.toLowerCase().trim();
  if (!d || d.startsWith('any') || d.startsWith('a ') || d.startsWith('an ') || d.includes(' or ') || d.includes(',')) return '';
  for (const name of Object.keys(WEAPONS)) if (d === name.toLowerCase() || d === name.toLowerCase() + 's') return name;
  for (const name of Object.keys(ARMOR)) if (d === name.toLowerCase() || d === name.toLowerCase() + ' armor') return name;
  if (d === 'shield') return 'Shield';
  return '';
}

/* ---------------------------------------------------------------- class options */
export const CHOICE_WORDS = /\bchoose\b|of your choice|one of the following|the following options|following features/i;

/** A page of class options (Eldritch Invocations, Battle Master maneuvers, artificer infusions...). Each option is a
    heading; the most common heading level on the page is taken to be the options' level. */
export function parseOptionPage(html) {
  const doc = soup(html);
  const root = contentRoot(doc);
  const text = toText(root);
  const counts = new Map();
  for (const m of text.matchAll(/^(#{2,5}) /gm)) counts.set(m[1].length, (counts.get(m[1].length) || 0) + 1);
  const options = [];
  if (counts.size) {
    // max by (count, -level): the most common level, the higher heading when tied
    let level = null;
    for (const [k, c] of counts) if (level === null || c > counts.get(level) || (c === counts.get(level) && k < level)) level = k;
    const pat = new RegExp(`^${'#'.repeat(level)} (.+)$`);
    let context = '', cur = null;
    for (const line of text.split('\n')) {
      const hm = line.match(/^(#+) (.+)$/);
      if (hm && hm[1].length < level) { context = hm[2]; cur = null; continue; }
      const m = line.match(pat);
      if (m) { cur = { name: m[1].trim(), lines: [], context }; options.push(cur); continue; }
      if (cur) cur.lines.push(line);
    }
  }
  const out = [];
  for (const o of options) {
    const name = o.name;
    if (['table of contents', 'contents'].includes(name.toLowerCase()) || name.length > 60) continue;
    let body = o.lines.join('\n').trim();
    const source = labelValue(body, 'Source') || '';
    const prereq = labelValue(body, 'Prerequisites') || labelValue(body, 'Prerequisite') || '';
    body = body.replace(/^(?:- )?(?:Source|Prerequisites?)\s*:.*$\n?/gmi, '').trim();
    const tags = /unearthed arcana/i.test(o.context) || name.toLowerCase().includes('(ua)') ? ['ua'] : [];
    out.push({ name, source, prerequisite: prereq.replace(/^[ *]+|[ *]+$/g, ''), text: body, tags });
  }
  if (!out.length) {
    for (const tr of findAll(root, 'tr')) {
      const cells = findAll(tr, 'td').map(text1);
      if (cells.length >= 2 && cells[0] && cells[0].length < 60) out.push({ name: cells[0], source: '', prerequisite: '', text: cells.slice(1).join(' '), tags: [] });
    }
  }
  return { name: pageTitle(doc), options: out };
}

/** Choices written as bold list items inside features (Fighting Style, Pact Boon, Metamagic, Hunter's Prey...):
    {feature title: [{name, source, text}]}. */
export function featureOptions(root, level) {
  const found = {};
  let current = null;
  const heading = `h${level}`;
  for (const el of elements(root)) {
    const t = tagName(el);
    if (HEADINGS.includes(t) && +t[1] <= level) { current = t === heading ? text1(el) : null; continue; }
    if (current === null || t !== 'li' || findParent(el, 'li')) continue;
    const first = [...el.childNodes].find((c) => !(isString(c) && !c.data.trim())) || null;
    if (!(first && first.nodeType === ELEMENT && ['strong', 'b'].includes(tagName(first)))) continue;
    const raw = text1(first);
    const whole = text1(el).replace(/\s+/g, ' ');
    const rest = whole.startsWith(raw) ? whole.slice(raw.length).trim() : whole;
    let name = raw.trim().replace(/[.:]+$/, '').trim();
    const src = name.match(/\(([A-Z][A-Za-z:&' ]{1,12})\)$/);
    let source = '';
    if (src && name.length > src[0].length + 2) { source = src[1]; name = name.slice(0, src.index).trim(); }
    if (!name || name.length > 60) continue;
    (found[current] = found[current] || []).push({ name, source, text: rest.replace(/^[.: ]+/, '').trim() });
  }
  return Object.fromEntries(Object.entries(found).filter(([, v]) => v.length >= 2));
}

/** How many options a feature lets you pick, and when you get more: {level: total} ({} if unknown). */
export function choiceCount(text, level = null) {
  const t = (text || '').replace(/\s+/g, ' ');
  const m = t.match(/\b(one|two|three|four|five|\d)\b (?:[\w' -]{0,40}? )?(?:of the following|of your choice)/i);
  const base = m ? numWord(m[1]) : null;
  if (base == null) return {};
  const start = level || firstLevelMention(t) || 1;
  const steps = new Map([[start, base]]);
  for (const [, n, lvls] of t.matchAll(/\b(another|one|two|three) (?:additional |more |other )?[\w' -]{0,30}?(?:of your choice )?at ((?:\d+(?:st|nd|rd|th)(?: level)?(?:,? (?:and )?)?)+)/gi)) {
    const add = n.toLowerCase() === 'another' ? 1 : (numWord(n) || 1);
    for (const [, lv] of lvls.matchAll(/(\d+)(?:st|nd|rd|th)/g)) {
      if (+lv > start) steps.set(+lv, (steps.get(+lv) || 0) + add);
    }
  }
  let total = 0;
  const out = {};
  for (const lv of [...steps.keys()].sort((a, b) => a - b)) { total += steps.get(lv); out[lv] = total; }
  return out;
}

export function parseGeneric(html) {
  const doc = soup(html);
  return { name: pageTitle(doc), text: toText(contentRoot(doc)) };
}

export const PARSERS = {
  spell: parseSpell, race: parseRace, background: parseBackground, feat: parseFeat, subclass: parseSubclass,
  item: parseMagicItem, 'class-option': parseOptionPage,
};
