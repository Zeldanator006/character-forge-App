'use strict';
/* "Write it with Claude" for the Personality & story step: a short idea in, personality, appearance and backstory out.
   Everything it writes lands in the normal fields, so it stays editable, and Undo puts back what was there. */

const STORY_FIELDS = [['personality_traits', 'Personality traits'], ['ideals', 'Ideals'], ['bonds', 'Bonds'], ['flaws', 'Flaws'],
  ['appearance', 'Appearance'], ['backstory', 'Backstory'], ['name', 'Name']];
const STORY_ROLLS = [['personality_traits', 'trait'], ['ideals', 'ideal'], ['bonds', 'bond'], ['flaws', 'flaw']];

function storyValue(c, k) {
  if (k === 'name' || k === 'appearance' || k === 'backstory') return c[k] || '';
  return (c.personality || {})[k] || '';
}
function storyUi() {
  const c = S.char;
  if (!S.storyUi || S.storyUi.charId !== S.charId) {
    const empty = STORY_FIELDS.filter(([k]) => !storyValue(c, k).trim()).map(([k]) => k);
    S.storyUi = { charId: S.charId, idea: '', length: 'medium', fields: empty.length ? empty : STORY_FIELDS.map(([k]) => k).filter((k) => k !== 'name'), chat: null, undo: null };
  }
  return S.storyUi;
}
function storyRequest() {
  const ui = storyUi();
  const idea = ($('#story-idea') || {}).value;
  if (idea !== undefined) ui.idea = idea;
  return { character: S.char, idea: ui.idea, fields: ui.fields, length: ui.length };
}

async function backgroundTables() {
  const bg = S.char.background || {};
  if (!bg.id) return {};
  try { return ((await detail(bg.id)).data || {}).characteristics || {}; } catch (e) { return {}; }
}

async function storyPanelHtml() {
  const st = S.status || (S.status = await api('/api/status'));
  const ui = storyUi(), c = S.char;
  const key = st.config.api_key_set;
  const tables = c.mode === 'manual' ? {} : await backgroundTables();
  const rolls = STORY_ROLLS.filter(([k]) => (tables[k] || []).length);
  return `<div class="panel story-ai"><h2>Write it with Claude</h2>
    <p class="hint">Give a simple idea and Claude writes these to fit your ${c.mode === 'manual' ? 'character' : 'species, class and background'}. What it writes goes into the fields below, where you can change anything.</p>
    ${key ? '' : '<p class="note">No API key needed: the app gives you a prompt to paste into a Claude chat, and you paste the reply back.</p>'}
    <label class="field"><span>Your idea</span><textarea id="story-idea" rows="2" placeholder="Raised by smugglers, owes a debt to a sea hag, terrible at lying">${esc(ui.idea)}</textarea></label>
    <div class="row story-fields"><span class="small"><b>Write:</b></span>${STORY_FIELDS.map(([k, l]) => `<label class="check small"><input type="checkbox" data-story-field="${k}" ${ui.fields.includes(k) ? 'checked' : ''}>${l}${storyValue(c, k).trim() ? '' : ' <span class="muted">(empty)</span>'}</label>`).join('')}</div>
    <div class="row" style="margin-top:8px">
      <label class="field" style="margin:0"><span>Backstory length</span><select id="story-length">${[['short', 'Short'], ['medium', 'Medium'], ['long', 'Long']].map(([v, l]) => `<option value="${v}" ${ui.length === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${key ? `<button class="btn primary" data-act="story-write" style="align-self:flex-end">Write it</button>
               <button class="btn quiet" data-act="story-chat-start" style="align-self:flex-end">Use a Claude chat instead</button>`
        : '<button class="btn primary" data-act="story-chat-start" style="align-self:flex-end">Copy the prompt</button>'}
      ${ui.undo ? '<button class="btn" data-act="story-undo" style="align-self:flex-end">Undo</button>' : ''}
    </div>
    <div id="story-chat">${ui.chat ? storyChatBox(ui.chat) : ''}</div>
    ${rolls.length ? `<p class="small" style="margin:12px 0 0">Or roll on your background’s tables: ${rolls.map(([k, l]) =>
      `<button class="btn quiet small" data-act="story-roll" data-field="${k}">Random ${l}</button>`).join('')}</p>` : ''}
  </div>`;
}

function storyChatBox(chat, copied) {
  return `<div class="panel" data-story-chat style="margin-top:14px;border-color:var(--pen)">
    <p>${copied === false ? 'Copy the prompt below' : 'The prompt is copied. Paste it'} into a new Claude chat and send it. When Claude answers, copy its whole reply and paste it below.</p>
    <div class="row" style="margin-bottom:10px">
      <a class="btn" href="https://claude.ai/new" target="_blank" rel="noopener">Open a new Claude chat</a>
      <button class="btn" data-act="story-copy">Copy the prompt again</button>
      <button class="btn quiet" data-act="story-chat-cancel">Cancel</button></div>
    <details ${copied === false ? 'open' : ''}><summary class="small" style="cursor:pointer">See the prompt</summary>
      <textarea readonly rows="6" style="margin-top:6px;font-size:13px">${esc(chat.prompt)}</textarea></details>
    <label class="field" style="margin-top:10px"><span>Claude’s reply</span>
      <textarea id="story-reply" rows="5" placeholder="Paste the reply here. It should start with {"></textarea></label>
    <button class="btn primary" data-act="story-reply">Use this reply</button></div>`;
}

function applyStory(story) {
  const c = S.char, ui = storyUi();
  c.personality = c.personality || {};
  ui.undo = { name: c.name, appearance: c.appearance, backstory: c.backstory, personality: { ...c.personality } };
  let n = 0;
  Object.entries(story).forEach(([k, v]) => {
    if (!v) return;
    n += 1;
    if (k === 'name' || k === 'appearance' || k === 'backstory') c[k] = v;
    else c.personality[k] = v;
  });
  ui.chat = null;
  changed();
  renderStep();
  renderLive();
  refreshOutputs();
  toast(`Filled in ${n} field${n === 1 ? '' : 's'}. Change anything below; Undo puts back what was there.`);
}

const baseStoryStep = STEP_RENDER.story;
STEP_RENDER.story = async () => (await storyPanelHtml()) + (await baseStoryStep());

Object.assign(ACTIONS, {
  'story-write': (t) => busy(t, 'Claude is writing…', async () => {
    const req = storyRequest();
    if (!req.fields.length) throw new Error('Tick at least one thing to write.');
    const { story } = await api('/api/claude/story', { json: req });
    applyStory(story);
  }),
  'story-chat-start': (t) => busy(t, 'Building the prompt…', async () => {
    const req = storyRequest();
    if (!req.fields.length) throw new Error('Tick at least one thing to write.');
    const { prompt } = await api('/api/claude/chat/story-prompt', { json: req });
    storyUi().chat = { prompt, fields: req.fields };
    const copied = await copyText(prompt);
    $('#story-chat').innerHTML = storyChatBox(storyUi().chat, copied);
  }),
  'story-copy': async () => {
    const ok = await copyText(storyUi().chat.prompt);
    toast(ok ? 'Prompt copied.' : 'Couldn’t copy automatically; open “See the prompt” and copy it from there.', ok ? 'info' : 'error');
  },
  'story-chat-cancel': () => { storyUi().chat = null; $('#story-chat').innerHTML = ''; },
  'story-reply': (t) => busy(t, 'Reading the reply…', async () => {
    const { story } = await api('/api/claude/chat/story-reply', { json: { reply: $('#story-reply').value, fields: storyUi().chat.fields } });
    applyStory(story);
  }),
  'story-undo': () => {
    const ui = storyUi(), u = ui.undo, c = S.char;
    if (!u) return;
    c.name = u.name; c.appearance = u.appearance; c.backstory = u.backstory; c.personality = u.personality;
    ui.undo = null;
    changed();
    renderStep();
    renderLive();
    toast('Put back what was there before.');
  },
  'story-roll': async (t) => {
    const k = t.dataset.field;
    const rows = (await backgroundTables())[k] || [];
    if (!rows.length) return;
    const pick = rows[Dice.die(rows.length) - 1];
    const c = S.char;
    c.personality = c.personality || {};
    const cur = (c.personality[k] || '').trim();
    if (cur.includes(pick)) return;
    c.personality[k] = cur ? `${cur}\n${pick}` : pick;
    changed();
    renderStep();
  },
});

document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.storyField !== undefined) {
    const ui = storyUi();
    const set = new Set(ui.fields);
    if (t.checked) set.add(t.dataset.storyField); else set.delete(t.dataset.storyField);
    ui.fields = STORY_FIELDS.map(([k]) => k).filter((k) => set.has(k));
  } else if (t.id === 'story-length') storyUi().length = t.value;
});
document.addEventListener('input', (e) => { if (e.target.id === 'story-idea') storyUi().idea = e.target.value; });
