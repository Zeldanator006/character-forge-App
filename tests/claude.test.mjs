// Claude drafting and PDF extraction, with Claude's side faked: no network, no API key needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../www/js/api.js';
import { memoryStore } from '../www/js/store.js';
import { bestMatch, call, parseReply, similarity, CORE_SCHEMA } from '../www/js/claude.js';

const srd = JSON.parse(readFileSync(new URL('../www/data/srd-2014.json', import.meta.url), 'utf8'));
const fakeBook = {
  title: 'Homebrew Grimoire',
  pages: ['Introduction to the grimoire.', 'Glitter Bolt\n1st-level evocation\nA bolt of sparkling light. Wizards love it.',
    'The Stormborn are a hardy folk who walk through thunder. Stormborn have darkvision.'],
};
// Like pdf.js, the fake extractor empties the bytes it's given, so a kept copy must not share them
const creaturesDoc = JSON.parse(readFileSync(new URL('../www/data/creatures.json', import.meta.url), 'utf8'));
const fresh = () => createApi(memoryStore(), structuredClone(srd), {
  creaturesDoc,
  extractPdf: async (bytes) => { structuredClone(bytes.buffer, { transfer: [bytes.buffer] }); return structuredClone(fakeBook); },
});
const pdfFile = (name = 'grimoire.pdf') => new File([new Uint8Array([37, 80, 68, 70])], name, { type: 'application/pdf' });

test('matching names like Python’s difflib', () => {
  assert.equal(similarity('abcd', 'abcd'), 1);
  assert.equal(bestMatch('wizzard', ['Wizard', 'Warlock']), 'Wizard');
  assert.equal(bestMatch('School of Evocation', ['Evocation', 'Abjuration']), 'Evocation');
  assert.equal(bestMatch('Hill dwarf', ['Hill Dwarf']), 'Hill Dwarf');
  assert.equal(bestMatch('zzz', ['Wizard']), null);
});

test('pasted replies are read through code fences and chatter', () => {
  assert.deepEqual(parseReply('Here you go:\n```json\n{"a": 1}\n```\nEnjoy!'), { a: 1 });
  assert.deepEqual(parseReply('Sure! {"a": [1, 2]} hope that helps'), { a: [1, 2] });
  assert.throws(() => parseReply('no json here'), /Couldn’t read that reply/);
  assert.throws(() => parseReply('  '), /Paste Claude’s reply first/);
});

test('drafting through a Claude chat (two pasted replies)', async () => {
  const { request } = await fresh();
  const { prompt } = await request('/api/claude/chat/draft-prompt', { json: { concept: 'A grumpy dwarf cleric who brews ale', level: 3 } });
  assert.match(prompt, /grumpy dwarf cleric/);
  assert.match(prompt, /Classes: .*Cleric/);
  assert.match(prompt, /"race_bonus"/);
  assert.doesNotMatch(prompt, /D&D|Dungeons/);

  const reply1 = JSON.stringify({ name: 'Borra Alehand', race: 'dwarf', race_source: '', subrace: 'Hill dwarf',
    classes: [{ class: 'Cleric', subclass: 'Life Domain', level: 3 }], background: 'Acolyte', alignment: 'Neutral Good',
    base_scores: { str: 14, dex: 8, con: 14, int: 10, wis: 15, cha: 10 }, race_bonus: { str: 0, dex: 0, con: 2, int: 0, wis: 1, cha: 0 },
    concept_summary: 'A brewer turned healer.' });
  const r1 = await request('/api/claude/chat/draft-reply-1', { json: { concept: 'A grumpy dwarf cleric', reply: '```json\n' + reply1 + '\n```' } });
  assert.deepEqual(r1.warnings, []);
  assert.equal(r1.character.race.subrace, 'Hill Dwarf');
  assert.deepEqual(r1.character.race_bonus, { str: 0, dex: 0, con: 2, int: 0, wis: 1, cha: 0 });
  assert.equal(r1.character.classes[0].subclass.name, 'Life');           // "Life Domain" matched to the SRD's "Life"
  assert.match(r1.prompt, /Cleric \(class field: 'cleric', up to 2nd level/);
  assert.match(r1.prompt, /Background already gives skills: Insight, Religion/);

  const reply2 = JSON.stringify({ skills: ['Medicine', 'Persuasion', 'Insight'], expertise: [], feats: [], improvements: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    spells: [{ name: 'Sacred Flame', class: 'Cleric' }, { name: 'Cure Wounds', class: 'cleric' }, { name: 'Made Up Spell', class: 'cleric' }],
    armor: 'Chain mail', shield: true, weapons: ['Warhammer', 'Not A Weapon'], equipment: 'Brewing kit', tools: "Brewer's supplies",
    languages: 'Common, Dwarvish', personality_traits: 'Grumbles', ideals: 'Charity', bonds: 'The monastery', flaws: 'Stubborn',
    backstory: 'Brewed for monks.', appearance: 'Beard', notes: 'Pick Bless next level.' });
  const r2 = await request('/api/claude/chat/draft-reply-2', { json: { character: r1.character, reply: reply2, warnings: r1.warnings, summary: r1.summary } });
  const c = r2.character;
  assert.deepEqual(c.skills, ['Medicine', 'Persuasion']);                 // Insight comes from the background
  assert.deepEqual(c.spells.map((s) => s.name), ['Sacred Flame', 'Cure Wounds']);
  assert.deepEqual(r2.warnings, ['Spell ‘Made Up Spell’ wasn’t found.']);
  assert.deepEqual(c.weapons, []);                                       // the picks became inventory items
  assert.deepEqual(c.inventory.map((i) => [i.name, i.kind, Boolean(i.equipped)]),
    [['Chain mail', 'armor', true], ['Shield', 'shield', true], ['Warhammer', 'weapon', true], ['Brewing kit', 'gear', false]]);
  assert.equal(r2.notes, 'A brewer turned healer.\n\nPick Bless next level.');
  const { sheet } = await request('/api/compute', { json: { character: c } });
  assert.equal(sheet.ac, 18);                                              // chain mail 16 + shield
  assert.equal(sheet.class_line, 'Cleric 3 (Life)');
});

test('drafting with an API key sends a structured-output request to Claude', async () => {
  const sent = [];
  const fakeFetch = async (url, init) => {
    sent.push({ url: String(url), headers: new Headers(init.headers), body: JSON.parse(init.body) });
    const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 }, content: [] };
    const events = [
      { type: 'message_start', message: msg },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '{"ok": ' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'true}' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 10 } },
      { type: 'message_stop' },
    ];
    const body = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const out = await call({ apiKey: 'sk-ant-test', model: 'claude-opus-5-5', fetch: fakeFetch }, 'sys', 'hello', CORE_SCHEMA, 16000);
  assert.deepEqual(out, { ok: true });
  const [req] = sent;
  assert.match(req.url, /\/v1\/messages/);
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.equal(req.body.stream, true);
  assert.equal(req.body.output_config.format.type, 'json_schema');
  assert.equal(req.body.fallbacks, 'default');
  assert.match(req.headers.get('anthropic-beta'), /server-side-fallback-2026-07-01/);
  assert.equal(req.headers.get('anthropic-dangerous-direct-browser-access'), 'true');
  assert.equal(req.headers.get('x-api-key'), 'sk-ant-test');

  // Haiku has no server-side fallback: plain request
  sent.length = 0;
  await call({ apiKey: 'k', model: 'claude-haiku-5-5', fetch: fakeFetch }, 's', 'u', CORE_SCHEMA);
  assert.equal(sent[0].body.fallbacks, undefined);
  await assert.rejects(call({ apiKey: '' }, 's', 'u', CORE_SCHEMA), /API key in Settings/);
});

test('API key is stored but never shown back', async () => {
  const { request } = await fresh();
  let st = await request('/api/status');
  assert.equal(st.config.api_key_set, false);
  assert.equal(st.config.model, 'claude-opus-5-5');
  await request('/api/settings', { json: { anthropic_api_key: '  sk-ant-abcdefgh1234 ', model: 'claude-sonnet-5-5' } });
  st = await request('/api/status');
  assert.equal(st.config.api_key_set, true);
  assert.equal(st.config.api_key_hint, '…1234');
  assert.equal(st.config.anthropic_api_key, undefined);
  assert.equal(st.config.model, 'claude-sonnet-5-5');
  await request('/api/settings', { json: { clear_api_key: true } });
  assert.equal((await request('/api/status')).config.api_key_set, false);
  await assert.rejects(request('/api/claude/draft', { json: { concept: 'x', level: 1 } }), /API key in Settings/);
});

test('PDFs: add, search, preview pages, pull entries through a chat, delete', async () => {
  const { request } = await fresh();
  const up = await request('/api/pdfs', { files: [pdfFile(), new File(['x'], 'notes.txt')] });
  assert.equal(up.results[0].title, 'Homebrew Grimoire');
  assert.equal(up.results[0].pages, 3);
  assert.equal(up.results[1].error, 'Not a PDF');
  const id = up.results[0].id;
  assert.equal((await request('/api/status')).pdfs, 1);

  const hits = (await request('/api/pdfs/search?q=sparkl')).results;
  assert.equal(hits.length, 1);
  assert.equal(hits[0].page, 2);
  assert.match(hits[0].snip, /\[\[sparkling\]\]/);
  assert.match((await request(`/api/pdfs/${id}/pages?start=2&end=3`)).text, /=== Page 2 ===\nGlitter Bolt[\s\S]*=== Page 3 ===/);
  assert.equal((await request(`/api/pdfs/${id}/file`)).blob.size, 4);   // the whole file was kept

  const { prompt } = await request(`/api/pdfs/${id}/extract/prompt`, { json: { start: 2, end: 2, kind: 'spell' } });
  assert.match(prompt, /Book: Homebrew Grimoire\nPages 2-2/);
  const reply = JSON.stringify({ entries: [{ name: 'Glitter Bolt', page: 2, level: 1, school: 'Evocation', casting_time: '1 action',
    range: '60 feet', components: 'V, S', duration: 'Instantaneous', ritual: false, classes: ['Wizard'], description: 'A bolt of sparkling light.', higher_levels: '' }],
  notes: '' });
  const ex = await request(`/api/pdfs/${id}/extract/reply`, { json: { kind: 'spell', reply } });
  assert.equal(ex.entries[0].source, 'pdf:grimoire.pdf');
  assert.equal(ex.entries[0].path, 'p.2');
  await request('/api/entries/bulk', { json: { entries: ex.entries } });
  const spells = (await request('/api/classes/wizard/spells?max=1')).spells;
  assert.ok(spells.some((s) => s.name === 'Glitter Bolt' && s.source === 'pdf:grimoire.pdf'));
  assert.equal((await request('/api/pdfs')).pdfs[0].entries, 1);

  // drafting finds relevant passages in your books
  const draft = (await request('/api/claude/chat/draft-prompt', { json: { concept: 'A stormborn wanderer who loves thunder', level: 1 } })).prompt;
  assert.match(draft, /\[Homebrew Grimoire, page 3\]/);

  await request(`/api/pdfs/${id}`, { method: 'DELETE' });
  assert.equal((await request('/api/pdfs')).pdfs.length, 0);
  assert.ok(!(await request('/api/classes/wizard/spells?max=1')).spells.some((s) => s.name === 'Glitter Bolt'));
});
