/* Claude features: drafting characters from a concept, and pulling entries out of your PDFs.
   A port of the PC app's claude_ai.py. Two ways to run each one:
   - with an API key: the app calls Claude directly (official Anthropic SDK, structured outputs)
   - without one: the app builds a prompt to paste into a Claude chat and reads the pasted reply */
import { Anthropic } from '../vendor/anthropic-sdk.mjs';
import { ABILITIES, ALIGNMENTS, ARMOR, CLASS_RULES, SKILLS, WEAPONS, ordinal } from './srd.js';
import { compute } from './rules.js';
import * as gear from './gear.js';
import { classRules, classSlug, raceSelection } from './library.js';

export class ClaudeError extends Error {}

export const MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'];
export const DEFAULT_MODEL = 'claude-opus-5-5';
// Models that accept server-side refusal fallbacks ("default" routing picks the substitute model)
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1']);

/** One Messages API request that must answer with JSON matching `schema`. Streamed, so long answers don't time out. */
export async function call({ apiKey, model, fetch }, system, user, schema, maxTokens = 16000) {
  if (!apiKey) throw new ClaudeError('Add your Anthropic API key in Settings first.');
  model = MODELS.includes(model) ? model : DEFAULT_MODEL;
  // `fetch` is only passed by tests, to see the request without a network
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(fetch ? { fetch } : {}) });
  const params = {
    model, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }],
    output_config: { format: { type: 'json_schema', schema } },
  };
  let message;
  try {
    message = FALLBACK_MODELS.has(model)
      ? await client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }).finalMessage()
      : await client.messages.stream(params).finalMessage();
  } catch (e) {
    throw friendlyError(e);
  }
  if (message.stop_reason === 'refusal') throw new ClaudeError('Claude declined this request.');
  if (message.stop_reason === 'max_tokens') throw new ClaudeError('Claude’s answer was cut off. Try fewer pages at a time.');
  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  try { return JSON.parse(text); } catch (e) { throw new ClaudeError('Claude’s reply wasn’t valid JSON; try again.'); }
}

function friendlyError(e) {
  if (e instanceof Anthropic.AuthenticationError) return new ClaudeError('Claude rejected the API key. Check it in Settings.');
  if (e instanceof Anthropic.PermissionDeniedError) return new ClaudeError('This API key isn’t allowed to use that model. Pick another model in Settings.');
  if (e instanceof Anthropic.RateLimitError) return new ClaudeError('Claude is busy or your account hit its rate limit. Wait a minute and try again.');
  if (e instanceof Anthropic.BadRequestError) return new ClaudeError(`Claude couldn’t take this request: ${e.message}`);
  if (e instanceof Anthropic.APIConnectionError) return new ClaudeError('Couldn’t reach Claude. Check your internet connection.');
  if (e instanceof Anthropic.APIError) return new ClaudeError(`Claude API error ${e.status ?? ''}: ${e.message}`);
  return e instanceof Error ? e : new ClaudeError(String(e));
}

/* ---------------------------------------------------------------- schemas */
const obj = (props) => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false });
const arr = (items) => ({ type: 'array', items });
const S = { type: 'string' }, I = { type: 'integer' }, B = { type: 'boolean' };
const ABILITY_ENUM = { type: 'string', enum: ABILITIES };
const ASI_OBJ = obj(Object.fromEntries(ABILITIES.map((a) => [a, I])));
const TRAIT = obj({ name: S, text: S });
const FEATURE = obj({ name: S, level: I, text: S });

export const EXTRACT_SCHEMAS = {
  spell: obj({ name: S, page: I, level: I, school: S, casting_time: S, range: S, components: S, duration: S, ritual: B,
    classes: arr(S), description: S, higher_levels: S }),
  race: obj({ name: S, page: I, intro: S, asi: ASI_OBJ, asi_note: S, speed: I, size: S, darkvision: I, languages: S,
    skills: arr(S), traits: arr(TRAIT), subraces: arr(obj({ name: S, asi: ASI_OBJ, traits: arr(TRAIT) })) }),
  background: obj({ name: S, page: I, skills: arr(S), tools: S, languages: S, equipment: S, feature_name: S, feature_text: S, text: S }),
  feat: obj({ name: S, page: I, prerequisite: S, asi_options: arr(ABILITY_ENUM), asi_amount: I, text: S }),
  subclass: obj({ name: S, page: I, parent_class: S, intro: S, features: arr(FEATURE),
    bonus_spells: arr(obj({ level: I, spells: arr(S) })) }),
  class: obj({ name: S, page: I, hit_die: I, saves: arr(ABILITY_ENUM), skill_count: I, skill_options: arr(S),
    spell_ability: { type: 'string', enum: [...ABILITIES, 'none'] },
    caster: { type: 'string', enum: ['full', 'half', 'third', 'pact', 'none'] },
    prepares: { type: 'string', enum: ['full', 'half', 'none'] },
    armor: arr({ type: 'string', enum: ['light', 'medium', 'heavy', 'shield'] }),
    weapons: arr(S), tools: S, subclass_level: I, asi_levels: arr(I), features: arr(FEATURE),
    cantrips_known: arr(I), spells_known: arr(I) }),
  item: obj({ name: S, page: I, text: S }),
  other: obj({ name: S, page: I, text: S }),
};
const KIND_HINTS = {
  spell: "spells (level 0 = cantrip; 'classes' lists the class spell lists it appears on)",
  race: 'playable races/species and their subraces (asi uses 0 for no change; speed in feet; darkvision 0 if none)',
  background: 'character backgrounds',
  feat: 'feats (asi_options empty and asi_amount 0 if the feat gives no ability increase)',
  subclass: "subclasses (parent_class is the base class name, e.g. 'Wizard'; feature level is the class level gained)",
  class: 'base classes (cantrips_known / spells_known: 20 numbers for levels 1-20, or empty if not used)',
  item: 'magic items or equipment',
  other: 'any other rules content (optional rules, class options, etc.)',
};
export const CORE_SCHEMA = obj({
  name: S, race: S, race_source: S, subrace: S,
  classes: arr(obj({ class: S, subclass: S, level: I })),
  background: S, alignment: { type: 'string', enum: ALIGNMENTS },
  base_scores: ASI_OBJ, race_bonus: ASI_OBJ, concept_summary: S,
});
export const DETAIL_SCHEMA = obj({
  skills: arr({ type: 'string', enum: Object.keys(SKILLS) }),
  expertise: arr({ type: 'string', enum: Object.keys(SKILLS) }),
  feats: arr(obj({ name: S, asi: { type: 'string', enum: [...ABILITIES, 'none'] }, from: { type: 'string', enum: ['asi', 'race'] } })),
  improvements: ASI_OBJ,
  spells: arr(obj({ name: S, class: S })),
  armor: { type: 'string', enum: ['None', ...Object.keys(ARMOR)] },
  shield: B,
  weapons: arr({ type: 'string', enum: Object.keys(WEAPONS) }),
  equipment: S, tools: S, languages: S,
  personality_traits: S, ideals: S, bonds: S, flaws: S, backstory: S, appearance: S, notes: S,
});

/* ---------------------------------------------------------------- copy-and-paste mode (no API key) */
export function chatPrompt(system, user, schema) {
  return `${system}\n\n${user}\n\n`
    + 'Reply with only one JSON object and no other text, so it can be pasted into the app. '
    + `It must follow this JSON Schema (every property is required):\n${JSON.stringify(schema)}`;
}

/** Read JSON out of a pasted chat reply, tolerating code fences and stray words around it. */
export function parseReply(text) {
  text = (text || '').trim();
  if (!text) throw new ClaudeError('Paste Claude’s reply first.');
  const candidates = [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
  if (starts.length) candidates.push(text.slice(Math.min(...starts), Math.max(text.lastIndexOf('}'), text.lastIndexOf(']')) + 1));
  candidates.push(text);
  for (const c of candidates) {
    try { return JSON.parse(c); } catch (e) { /* try the next */ }
  }
  throw new ClaudeError('Couldn’t read that reply. Copy Claude’s whole answer (it starts with { ) and paste it again.');
}

/* ---------------------------------------------------------------- name matching */
const slug = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export function parentSlug(name) {
  const s = slug(name);
  for (const [k, rules] of Object.entries(CLASS_RULES)) if (s === k || s === slug(rules.name)) return k;
  return s;
}
/** Similarity like Python's difflib.SequenceMatcher.ratio(): matched characters over total length. */
export function similarity(a, b) {
  const matched = (x, y) => {
    if (!x || !y) return 0;
    let best = 0, bi = 0, bj = 0;
    for (let i = 0; i < x.length; i++) {
      for (let j = 0; j < y.length; j++) {
        let k = 0;
        while (i + k < x.length && j + k < y.length && x[i + k] === y[j + k]) k++;
        if (k > best) [best, bi, bj] = [k, i, j];
      }
    }
    return best ? best + matched(x.slice(0, bi), y.slice(0, bj)) + matched(x.slice(bi + best), y.slice(bj + best)) : 0;
  };
  return a.length + b.length ? (2 * matched(a, b)) / (a.length + b.length) : 1;
}
export function bestMatch(name, options) {
  if (!name || !options.length) return null;
  const low = new Map(options.map((o) => [o.toLowerCase(), o]));
  const n = name.toLowerCase().trim();
  if (low.has(n)) return low.get(n);
  const closest = (cutoff) => {
    let best = null, score = cutoff;
    for (const k of low.keys()) { const r = similarity(n, k); if (r >= score) [best, score] = [k, r]; }
    return best;
  };
  let m = closest(0.75);
  if (m) return low.get(m);
  const contains = [...low.keys()].filter((o) => o.includes(n) || n.includes(o));
  if (contains.length) return low.get(contains.reduce((a, b) => (b.length < a.length ? b : a)));
  m = closest(0.6);
  return m ? low.get(m) : null;
}

/* ---------------------------------------------------------------- the feature set, bound to a library */
export function makeClaude({ lib, pdfs, settings }) {
  const entryByName = (kind, name, parent = null) => {
    if (!name) return null;
    const hit = lib.find(kind, name, parent);
    if (hit) return hit;
    const candidates = lib.list({ kind, parent, includeTags: ['ua', 'homebrew'] });
    let match = bestMatch(name, candidates.map((c) => c.name));
    if (!match) {  // "Evocation" vs "School of Evocation"
      const c = candidates.find((x) => x.name.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(x.name.toLowerCase()));
      match = c ? c.name : null;
    }
    return match ? lib.find(kind, match, parent) : null;
  };
  const optionsForDraft = (tags) => {
    const names = (kind) => lib.list({ kind, includeTags: tags }).map((e) => e.name);
    const subclasses = {};
    for (const e of lib.list({ kind: 'subclass', includeTags: tags })) (subclasses[e.parent] = subclasses[e.parent] || []).push(e.name);
    return { races: names('race'), classes: names('class'), backgrounds: names('background'), feats: names('feat'), subclasses };
  };
  const num = (v, def = 0) => { const n = parseInt(String(v ?? '').trim().replace(/^\+/, ''), 10); return Number.isNaN(n) ? def : n; };

  /* ------------------------------------------------ drafting */
  async function coreRequest(concept, level, tags) {
    const opts = optionsForDraft(tags);
    if (!opts.classes.length) throw new ClaudeError('The library is empty.');
    const pdfContext = await pdfs.contextFor(concept);
    const subLines = Object.keys(opts.subclasses).sort().map((k) => `- ${k}: ${opts.subclasses[k].join(', ')}`).join('\n');
    const system = 'You are building a character for the 5th edition of the world’s most popular fantasy roleplaying game, '
      + "using the 2014 rules, for the user's personal character builder. Choose ONLY from the options listed (names must match exactly). "
      + 'Base ability scores must follow point buy (27 points, each 8-15 before bonuses). race_bonus holds the species’ ability increases; '
      + 'if the species lets the player choose, choose what fits the concept. Leave subclass empty if the class level is below the level '
      + 'where that class picks one. race_source and subrace may be empty strings.';
    let user = `Character concept: ${concept}\nTarget total level: ${level} (split across classes only if the concept asks for multiclassing)\n\n`
      + `Species: ${opts.races.join(', ')}\n\nClasses: ${opts.classes.join(', ')}\n\nSubclasses by class:\n${subLines}\n\n`
      + `Backgrounds: ${opts.backgrounds.join(', ')}\n`;
    if (pdfContext) user += `\nRelevant passages from the user's own books (homebrew or supplements):\n${pdfContext}\n`;
    return [system, user];
  }

  function applyCore(core, newCharacter) {
    if (!core || typeof core !== 'object' || Array.isArray(core)) {
      throw new ClaudeError('That reply isn’t the character outline the app asked for. Copy the step 1 prompt again.');
    }
    const warnings = [], char = newCharacter();
    char.name = core.name || 'Unnamed';
    char.alignment = ALIGNMENTS.includes(core.alignment) ? core.alignment : '';
    char.ability_method = 'point_buy';
    const base = core.base_scores || {};
    char.base_scores = Object.fromEntries(ABILITIES.map((a) => [a, Math.max(8, Math.min(15, num(base[a], 10)))]));

    const raceEntry = entryByName('race', core.race);
    if (raceEntry) {
      const variants = raceEntry.data.variants || [];
      const vnames = variants.map((v) => v.source);
      const vname = bestMatch(core.race_source, vnames) || vnames[0] || null;
      const variant = variants.find((v) => v.source === vname) || {};
      const snames = (variant.subraces || []).map((x) => x.name);
      const sname = snames.length ? bestMatch(core.subrace, snames) : null;
      char.race = { id: raceEntry.id, name: raceEntry.name, variant: vname, subrace: sname };
      const sel = raceSelection(raceEntry, vname, sname);
      const fixed = sel.analysis.asi;
      if (Object.keys(fixed).length && !sel.analysis.asi_flexible) {
        char.race_bonus = Object.fromEntries(ABILITIES.map((a) => [a, fixed[a] || 0]));
      } else {
        const bonus = core.race_bonus || {};
        char.race_bonus = Object.fromEntries(ABILITIES.map((a) => [a, num(bonus[a])]));
      }
    } else warnings.push(`Species ‘${core.race}’ wasn’t found in the library.`);

    for (const c of core.classes || []) {
      if (!c || typeof c !== 'object') continue;
      const ce = entryByName('class', c.class);
      if (!ce) { warnings.push(`Class ‘${c.class}’ wasn’t found in the library.`); continue; }
      const s = classSlug(ce);
      const rules = classRules(ce);
      const lvl = Math.max(1, Math.min(20, num(c.level, 1)));
      const row = { id: ce.id, name: ce.name, slug: s, level: lvl, subclass: null };
      if (c.subclass && lvl >= (rules.subclass_level || 3)) {
        const se = entryByName('subclass', c.subclass, s);
        if (se) row.subclass = { id: se.id, name: se.name, path: se.path };
        else warnings.push(`Subclass ‘${c.subclass}’ wasn’t found for ${ce.name}.`);
      }
      char.classes.push(row);
    }
    const be = entryByName('background', core.background);
    if (be) {
      char.background = { id: be.id, name: be.name };
      char.tools = be.data.tools || '';
    } else warnings.push(`Background ‘${core.background}’ wasn’t found in the library.`);
    return [char, warnings];
  }

  const backgroundSkills = (char) => {
    const bg = char.background || {};
    const e = bg.id ? lib.get(bg.id) : null;
    return (e && e.data.skills) || [];
  };

  async function detailsRequest(concept, char, tags) {
    const opts = optionsForDraft(tags);
    const pdfContext = await pdfs.contextFor(concept);
    let raceNote = '', raceInfo = {};
    if ((char.race || {}).id && lib.get(char.race.id)) {
      const sel = raceSelection(lib.get(char.race.id), char.race.variant, char.race.subrace);
      raceNote = sel.traits.map((t) => `${t.name}: ${(t.text || '').slice(0, 300)}`).join('\n');
      raceInfo = sel.analysis;
    }
    const bgSkills = backgroundSkills(char);
    const preview = compute(char, lib.buildContext(char));
    const spellLines = preview.spellcasting.map((info) => {
      const spells = lib.classSpells(info.slug, tags, info.max_spell_level);
      const counts = [];
      if (info.cantrips_known != null) counts.push(`${info.cantrips_known} cantrips`);
      if (info.spells_known != null) counts.push(`${info.spells_known} spells known`);
      if (info.prepared_count != null) {
        counts.push(info.slug === 'wizard'
          ? `prepares ${info.prepared_count} spells each day (a wizard's spellbook holds 6 + 2 per level after 1st)`
          : `prepares ${info.prepared_count} spells each day`);
      }
      const names = spells.map((x) => `${x.name} (${x.level})`).join('; ');
      const top = info.max_spell_level ? `${ordinal(info.max_spell_level)} level` : 'cantrips only';
      return `${info.class} (class field: '${info.slug}', up to ${top}, ${counts.join(', ') || 'see class rules'}): ${names}`;
    });
    const classLines = (char.classes || []).map((c) => {
      const rules = classRules(lib.get(c.id));
      return `${c.name} ${c.level}: skill choices ${rules.skill_count} from ${(rules.skill_options || []).join(', ')}; `
        + `armor ${(rules.armor || []).join(', ') || 'none'}; weapons ${(rules.weapons || []).join(', ')}`;
    });
    const system = 'You finish a 5th edition (2014 rules) character for the user’s builder. Use only listed options.';
    let user = `Concept: ${concept}\nSo far: ${preview.class_line}, species ${(char.race || {}).name || '?'}, `
      + `background ${(char.background || {}).name || '?'}.\nBackground already gives skills: ${bgSkills.join(', ') || 'none'} (don't repeat them).\n`
      + `Species traits:\n${raceNote || 'n/a'}\nSpecies extra skill choices: ${raceInfo.skill_choices || 0}; bonus feat from species: ${raceInfo.bonus_feat ? 'yes' : 'no'}\n`
      + `Classes:\n${classLines.join('\n')}\n`
      + `Ability score improvements available from levels: ${preview.asi.available} (each is +2 points in 'improvements' or one feat with from='asi')\n`
      + `Current scores: ${JSON.stringify(preview.scores)}\nFeats available: ${opts.feats.join(', ')}\n`
      + (spellLines.length ? `Spell options (name (level)):\n${spellLines.join('\n')}\n` : 'No spellcasting yet.\n')
      + 'Pick skills (class picks only, plus species picks if any), expertise only if a class feature grants it, feats, improvements, '
      + 'spells (respect the counts; cantrips are level 0; class field uses the given value), starting armor and weapons the character '
      + 'is proficient with, and short roleplay details.';
    if (pdfContext) user += `\n\nRelevant passages from the user's books:\n${pdfContext.slice(0, 6000)}`;
    return [system, user];
  }

  function applyDetails(char, detail, warnings) {
    if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
      throw new ClaudeError('That reply isn’t the character details the app asked for. Copy the step 2 prompt again.');
    }
    const bgSkills = backgroundSkills(char);
    char.skills = (detail.skills || []).filter((x) => x in SKILLS && !bgSkills.includes(x));
    char.expertise = (detail.expertise || []).filter((x) => x in SKILLS);
    const imp = detail.improvements || {};
    char.improvements = Object.fromEntries(ABILITIES.map((a) => [a, num(imp[a])]));
    char.feats = [];
    for (const f of detail.feats || []) {
      if (!f || typeof f !== 'object') continue;
      const fe = entryByName('feat', f.name);
      if (!fe) { warnings.push(`Feat ‘${f.name}’ wasn’t found.`); continue; }
      const feat = { id: fe.id, name: fe.name, from: ['asi', 'race'].includes(f.from) ? f.from : 'asi' };
      const amt = fe.data.asi_amount || 0;
      if (amt && (fe.data.asi_options || []).includes(f.asi)) Object.assign(feat, { asi: f.asi, asi_amount: amt });
      char.feats.push(feat);
    }
    const slugs = (char.classes || []).map((c) => c.slug);
    char.spells = [];
    for (let sp of detail.spells || []) {
      if (typeof sp === 'string') sp = { name: sp };
      let s = sp.class ? parentSlug(sp.class) : null;
      if (!slugs.includes(s)) s = slugs[0] || '';
      const se = entryByName('spell', sp.name);
      if (!se) { warnings.push(`Spell ‘${sp.name}’ wasn’t found.`); continue; }
      char.spells.push({ id: se.id, name: se.name, level: se.data.level ?? null, class: s, prepared: true });
    }
    char.armor = detail.armor in ARMOR ? detail.armor : '';
    char.shield = Boolean(detail.shield);
    char.weapons = (detail.weapons || []).filter((w) => w in WEAPONS);
    // turn the picks into inventory items, then clear the old free-text gear fields (claude_ai.py does the same)
    delete char.inventory;
    gear.ensureInventory(char);
    char.inventory = gear.mergeItems([], char.inventory);
    const [items, coins] = gear.itemsFromText(detail.equipment || '');
    const have = new Set(char.inventory.map((i) => i.name));
    gear.mergeItems(char.inventory, items.filter((i) => !(gear.role(i) && have.has(i.name))));
    char.coins = Object.fromEntries(['cp', 'sp', 'ep', 'gp', 'pp'].map((k) => [k, ((char.coins || {})[k] ?? 0) + (coins[k] ?? 0)]));
    [char.armor, char.shield, char.weapons] = ['', false, []];
    char.equipment = '';
    char.gear_start = { method: 'claude' };
    if (detail.tools) char.tools = detail.tools;
    char.languages = detail.languages || '';
    char.personality = Object.fromEntries(['personality_traits', 'ideals', 'bonds', 'flaws'].map((k) => [k, detail[k] || '']));
    char.backstory = detail.backstory || '';
    char.appearance = detail.appearance || '';
    return char;
  }

  /* ------------------------------------------------ PDF extraction */
  async function extractRequest(pdfId, start, end, kind) {
    if (!EXTRACT_SCHEMAS[kind]) throw new ClaudeError(`Unknown kind: ${kind}`);
    const info = await pdfs.get(pdfId);
    if (!info) throw new ClaudeError('That PDF isn’t in the library.');
    const text = await pdfs.pageRangeText(pdfId, start, end);
    if (!text.trim()) throw new ClaudeError('No text on those pages. Scanned PDFs need OCR first.');
    if (text.length > 150000) throw new ClaudeError('That’s a lot of text at once; pick 30 pages or fewer.');
    const schema = obj({ entries: arr(EXTRACT_SCHEMAS[kind]), notes: S });
    const system = "You turn pages from the user's own 5th edition (2014 rules) roleplaying game books into structured entries for "
      + `their personal character builder. Extract every complete ${KIND_HINTS[kind]} found on these pages. `
      + 'Copy rules text faithfully and completely so it can be read on a character sheet; fix broken line wraps and hyphenation '
      + "from PDF extraction. 'page' is the page marker the entry starts on. If an entry is cut off by the end of the page range, "
      + "include what is there and say so in notes. Use empty strings, 0 or empty lists for fields that don't apply. "
      + "Put anything worth flagging in 'notes'.";
    const user = `Book: ${info.title}\nPages ${start}-${end}:\n\n${text}`;
    return { system, user, schema, info };
  }
  const extractFinish = (kind, result, info) => {
    if (Array.isArray(result)) result = { entries: result };
    const entries = (result.entries || []).filter((e) => e && typeof e === 'object').map((e) => normalizeExtracted(kind, e, info));
    return { entries: entries.filter((e) => e.name), notes: result.notes || '' };
  };

  return {
    async draft(cfg, concept, level, tags, newCharacter) {
      const [system, user] = await coreRequest(concept, level, tags);
      const core = await call(cfg, system, user, CORE_SCHEMA, 16000);
      const [char, warnings] = applyCore(core, newCharacter);
      const [system2, user2] = await detailsRequest(concept, char, tags);
      const detail = await call(cfg, system2, user2, DETAIL_SCHEMA, 16000);
      applyDetails(char, detail, warnings);
      const notes = [core.concept_summary || '', detail.notes || ''].filter(Boolean).join('\n\n');
      return { character: char, notes, warnings };
    },
    async draftPrompt1(concept, level, tags) {
      const [system, user] = await coreRequest(concept, level, tags);
      return chatPrompt(system, user, CORE_SCHEMA);
    },
    async draftReply1(concept, reply, tags, newCharacter) {
      const core = parseReply(reply);
      const [char, warnings] = applyCore(core, newCharacter);
      if (!char.classes.length) {
        throw new ClaudeError('No class from the reply matched your library. Check the reply was for step 1, or build the character by hand.');
      }
      const [system, user] = await detailsRequest(concept, char, tags);
      return { character: char, warnings, summary: core.concept_summary || '', prompt: chatPrompt(system, user, DETAIL_SCHEMA) };
    },
    draftReply2(char, reply, warnings = [], summary = '') {
      const detail = parseReply(reply);
      warnings = [...(warnings || [])];
      applyDetails(char, detail, warnings);
      return { character: char, notes: [summary, detail.notes || ''].filter(Boolean).join('\n\n'), warnings };
    },
    async extract(cfg, pdfId, start, end, kind) {
      const r = await extractRequest(pdfId, start, end, kind);
      return extractFinish(kind, await call(cfg, r.system, r.user, r.schema, 64000), r.info);
    },
    async extractPrompt(pdfId, start, end, kind) {
      const r = await extractRequest(pdfId, start, end, kind);
      return chatPrompt(r.system, r.user, r.schema);
    },
    async extractFromReply(pdfId, kind, reply) {
      const info = await pdfs.get(pdfId);
      if (!info) throw new ClaudeError('That PDF isn’t in the library.');
      if (!EXTRACT_SCHEMAS[kind]) throw new ClaudeError(`Unknown kind: ${kind}`);
      return extractFinish(kind, parseReply(reply), info);
    },
  };
}

/** Shape an extracted entry like the built-in ones so the builder treats both alike. */
export function normalizeExtracted(kind, e, pdfInfo) {
  const out = { kind, name: (e.name || '').trim(), source: `pdf:${pdfInfo.filename}`, path: `p.${e.page || ''}`, parent: '', data: {} };
  const book = pdfInfo.title || pdfInfo.filename;
  const nonzero = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v));
  if (kind === 'spell') {
    out.data = Object.fromEntries(['level', 'school', 'casting_time', 'range', 'components', 'duration', 'ritual', 'classes',
      'description', 'higher_levels'].map((k) => [k, e[k] ?? null]));
    out.data.source = book;
  } else if (kind === 'race') {
    const clean = (ts) => (ts || []).filter((t) => t && typeof t === 'object' && t.name);
    const variant = {
      source: book, intro: e.intro || '', traits: clean(e.traits),
      fixed: { asi: nonzero(e.asi), speed: e.speed || null, size: e.size || '', darkvision: e.darkvision || null,
        languages: e.languages || '', skills: e.skills || [] },
      subraces: (e.subraces || []).filter((s) => s && typeof s === 'object')
        .map((s) => ({ name: s.name, traits: clean(s.traits), asi: nonzero(s.asi) })),
    };
    if (e.asi_note) {
      variant.traits = [{ name: 'Ability Score Increase', text: e.asi_note },
        ...variant.traits.filter((t) => t.name.toLowerCase() !== 'ability score increase')];
    }
    out.data = { variants: [variant] };
  } else if (kind === 'background') {
    out.data = { source: book, skills: (e.skills || []).filter((s) => s in SKILLS), tools: e.tools || '', languages: e.languages || '',
      equipment: e.equipment || '', feature: { name: e.feature_name || '', text: e.feature_text || '' }, text: e.text || '' };
  } else if (kind === 'feat') {
    out.data = { source: book, prerequisite: e.prerequisite || '', asi_options: e.asi_options || [], asi_amount: e.asi_amount || 0, text: e.text || '' };
  } else if (kind === 'subclass') {
    out.parent = parentSlug(e.parent_class);
    out.data = { source: book, intro: e.intro || '', features: e.features || [], bonus_spells: e.bonus_spells || [] };
  } else if (kind === 'class') {
    const ck = e.cantrips_known || [], sk = e.spells_known || [];
    const table = [];
    for (let lvl = 1; lvl <= 20; lvl++) {
      const row = { _level: lvl, Level: ordinal(lvl) };
      if (ck.length >= lvl && ck[lvl - 1]) row['Cantrips Known'] = String(ck[lvl - 1]);
      if (sk.length >= lvl && sk[lvl - 1]) row['Spells Known'] = String(sk[lvl - 1]);
      table.push(row);
    }
    const ability = e.spell_ability;
    out.data = {
      source: book, slug: slug(e.name), hit_die: e.hit_die || 8, saves: e.saves || [], skill_count: e.skill_count || 2,
      skill_options: ((e.skill_options || []).filter((s) => s in SKILLS).length ? (e.skill_options || []).filter((s) => s in SKILLS) : Object.keys(SKILLS)),
      spell_ability: ability == null || ability === 'none' ? null : ability, caster: e.caster || 'none',
      prepares: e.prepares == null || e.prepares === 'none' ? null : e.prepares,
      armor_list: e.armor || [], weapon_list: (e.weapons || []).map((w) => w.toLowerCase()),
      weapons: (e.weapons || []).join(', '), armor: (e.armor || []).join(', '), tools: e.tools || '',
      subclass_level: e.subclass_level || 3, asi_levels: e.asi_levels || [], features: e.features || [], table,
    };
  } else {
    out.data = { source: book, text: e.text || '' };
  }
  return out;
}
