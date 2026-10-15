/* Your PDFs: text extraction, search and page access, all on the device.
   A port of the PC app's pdfs.py. Text comes from pdf.js (loaded only when a PDF is added). */

export function cleanText(text) {
  return (text || '').replace(/­/g, '')
    .replace(/-\n(?=[a-z])/g, '')           // re-join hyphenated line breaks
    .replace(/[ \t]+/g, ' ')
    .trim();
}
export const looksScanned = (pages, chars) => pages > 0 && (chars === 0 || (pages >= 3 && chars / pages < 80));
const words = (s) => (s || '').toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

/** Read every page's text with pdf.js. Returns { title, pages: [text, ...] }. */
export async function extractWithPdfjs(bytes) {
  const pdfjs = await import('../vendor/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  let doc;
  try {
    doc = await task.promise;
  } catch (e) {
    if (e && e.name === 'PasswordException') throw new Error('This PDF is password protected.');
    throw new Error('This file couldn’t be read as a PDF.');
  }
  let title = '';
  try { title = ((await doc.getMetadata()).info || {}).Title || ''; } catch (e) { /* no metadata */ }
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map((it) => (it.str || '') + (it.hasEOL ? '\n' : '')).join(''));
      page.cleanup();
    } catch (e) {
      pages.push('');  // one bad page shouldn't stop the import
    }
  }
  await task.destroy();
  return { title, pages };
}

export class Pdfs {
  constructor(store, extract = extractWithPdfjs) {
    this.store = store;
    this.extract = extract;
  }

  async list(entryCounts = {}) {
    const rows = await this.store.all('pdfs');
    return rows.map(({ texts, ...p }) => ({ ...p, scanned: looksScanned(p.pages, p.chars), entries: entryCounts[`pdf:${p.filename}`] || 0 }))
      .sort((a, b) => a.title.toLowerCase().localeCompare(b.title.toLowerCase()));
  }

  async get(id) { return (await this.store.get('pdfs', Number(id))) || null; }

  /** Add a PDF (a File or Blob with a name): keep the file, extract each page's text. */
  async ingest(file) {
    const filename = (file.name || 'upload.pdf').replace(/[^\w.\- ()]+/g, '_');
    const bytes = new Uint8Array(await file.arrayBuffer());
    // pdf.js takes ownership of the bytes it reads (they come back empty), so give it a copy and keep ours
    const { title: rawTitle, pages: raw } = await this.extract(bytes.slice());
    const texts = raw.map(cleanText);
    let title = (rawTitle || '').trim();
    if (!title || ['untitled', 'untitled document', 'document'].includes(title.toLowerCase())) title = filename.replace(/\.pdf$/i, '');
    const chars = texts.reduce((t, p) => t + p.length, 0);
    const old = (await this.store.all('pdfs')).find((p) => p.filename === filename);
    const row = { filename, title, pages: texts.length, chars, added: Date.now() / 1000, texts };
    if (old) row.id = old.id;
    const id = await this.store.put('pdfs', row);
    await this.store.put('pdf_files', { id, blob: new Blob([bytes], { type: 'application/pdf' }) });
    return { id, filename, title, pages: texts.length, chars, scanned: looksScanned(texts.length, chars) };
  }

  async file(id) {
    const row = await this.store.get('pdf_files', Number(id));
    return row ? row.blob : null;
  }

  async remove(id) {
    const p = await this.get(id);
    if (!p) return null;
    await this.store.delete('pdfs', p.id);
    await this.store.delete('pdf_files', p.id);
    return p;
  }

  async pageRangeText(id, start, end) {
    const p = await this.get(id);
    if (!p) return '';
    const out = [];
    for (let n = Math.max(1, start); n <= Math.min(end, p.pages); n++) out.push(`=== Page ${n} ===\n${p.texts[n - 1] || ''}`);
    return out.join('\n\n');
  }

  /** Pages containing every word (the last may be the start of a word), best first, with a marked snippet. */
  async search(query, limit = 30) {
    const qs = words(query);
    if (!qs.length) return [];
    const last = qs[qs.length - 1];
    const hits = [];
    for (const p of await this.store.all('pdfs')) {
      p.texts.forEach((text, i) => {
        const ws = words(text);
        if (!qs.slice(0, -1).every((q) => ws.includes(q)) || !ws.some((w) => w.startsWith(last))) return;
        const score = ws.filter((w) => qs.some((q, k) => (k === qs.length - 1 ? w.startsWith(q) : w === q))).length;
        hits.push({ pdf_id: p.id, page: i + 1, title: p.title, filename: p.filename, score, snip: snippet(text, qs) });
      });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score, ...h }) => h);
  }

  /** Best-matching passages for a free-text concept (used when drafting with Claude). */
  async contextFor(query, maxChars = 12000) {
    const qs = [...new Set((query || '').match(/[A-Za-z']{4,}/g) || [])].slice(0, 12).map((w) => w.toLowerCase());
    if (!qs.length) return '';
    const scored = [];
    for (const p of await this.store.all('pdfs')) {
      p.texts.forEach((text, i) => {
        const ws = words(text);
        const score = ws.filter((w) => qs.includes(w)).length;
        if (score) scored.push({ score, title: p.title, page: i + 1, text });
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = [];
    let used = 0;
    for (const r of scored.slice(0, 6)) {
      const chunk = `[${r.title}, page ${r.page}]\n${r.text.slice(0, 3000)}`;
      if (used + chunk.length > maxChars) break;
      out.push(chunk);
      used += chunk.length;
    }
    return out.join('\n\n');
  }
}

/** About 28 words around the first match, with matches wrapped in [[ ]] (the interface turns those into highlights). */
function snippet(text, qs) {
  const tokens = text.replace(/\s+/g, ' ').split(' ');
  const isHit = (t) => {
    const w = t.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
    return qs.some((q, k) => (k === qs.length - 1 ? w.startsWith(q) : w === q));
  };
  const first = Math.max(0, tokens.findIndex(isHit));
  const from = Math.max(0, first - 10), to = Math.min(tokens.length, from + 28);
  return (from ? '… ' : '') + tokens.slice(from, to).map((t) => (isHit(t) ? `[[${t}]]` : t)).join(' ') + (to < tokens.length ? ' …' : '');
}
