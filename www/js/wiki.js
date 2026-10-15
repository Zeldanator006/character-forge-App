/* Polite fetcher for dnd5e.wikidot.com with a permanent cache on the device, ported from the PC app's wiki.py.

   Each page is downloaded once and kept in the device's storage; later requests read that copy. Requests are spaced
   out (1 second by default) so the wiki is never hammered. A web page isn't allowed to read another site, so this
   only works inside the Character Forge app from the app stores, where Capacitor's native HTTP does the request. */

export class WikiError extends Error {
  constructor(message) { super(message); this.status = 502; }
}

export const WIKI_BASE = 'https://dnd5e.wikidot.com';
const USER_AGENT = 'Character-Forge/1.0 (personal character builder; caches pages on the device)';
export const NOT_IN_BROWSER = 'Reading the wiki needs the Character Forge app from the app store (a web browser isn’t '
  + 'allowed to read another site). On the web, import your library from the PC instead.';

/** The native HTTP of the store app, or null in a plain browser. */
export function nativeHttp() {
  const cap = globalThis.Capacitor;
  const http = cap && cap.Plugins && cap.Plugins.CapacitorHttp;
  return http && (!cap.isNativePlatform || cap.isNativePlatform()) ? http : null;
}

/** Download one URL: {status, text}. Native HTTP when there is one, fetch() otherwise (which a browser blocks). */
async function defaultTransport(url) {
  const http = nativeHttp();
  if (http) {
    const r = await http.get({ url, headers: { 'User-Agent': USER_AGENT }, responseType: 'text', connectTimeout: 30000, readTimeout: 30000 });
    return { status: r.status, text: typeof r.data === 'string' ? r.data : String(r.data ?? '') };
  }
  const r = await fetch(url, { headers: { Accept: 'text/html' } });
  return { status: r.status, text: await r.text() };
}

const clean = (path) => (path || '').split('#')[0] || '/';

/** makeWiki({store, delaySeconds, transport, base}): {fetch(path, refresh), forget(path), cachedCount(), available()}.
    delaySeconds may be a function, so a changed setting applies at once. */
export function makeWiki({ store, delaySeconds = 1, transport = null, base = WIKI_BASE }) {
  const send = transport || defaultTransport;
  let last = 0;
  let queue = Promise.resolve();   // one request at a time, like the PC's lock
  const delay = async () => Number(typeof delaySeconds === 'function' ? await delaySeconds() : delaySeconds) || 1;

  async function download(path) {
    const wait = (await delay()) * 1000 - (Date.now() - last);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    let resp;
    try {
      resp = await send(base.replace(/\/+$/, '') + path);
    } catch (e) {
      if (!transport && !nativeHttp()) throw new WikiError(NOT_IN_BROWSER);
      throw new WikiError(`Couldn't reach the wiki (${e.name || 'error'}). Check your internet connection.`);
    } finally {
      last = Date.now();
    }
    if (resp.status === 404) throw new WikiError(`The wiki has no page at ${path}`);
    if (resp.status >= 400) throw new WikiError(`The wiki answered ${resp.status} for ${path}`);
    const html = resp.text || '';
    if (!html.includes('id="page-content"') && !html.includes("id='page-content'")) {
      throw new WikiError(`The wiki sent back an unexpected page for ${path} (maybe a busy or sign-in page). Wait a moment and try again.`);
    }
    await store.put('wiki_pages', { id: path, html, fetched: Date.now() / 1000 });
    return html;
  }

  return {
    /** Can this device read the wiki at all? (a test transport, or the store app's native HTTP) */
    available: () => Boolean(transport || nativeHttp()),
    async fetch(path, refresh = false) {
      path = clean(path);
      if (!refresh) {
        const row = await store.get('wiki_pages', path);
        if (row) return row.html;
      }
      const run = queue.then(() => download(path));
      queue = run.catch(() => {});
      return run;
    },
    /** Drop a cached page so the next request downloads it again. */
    async forget(path) { await store.delete('wiki_pages', clean(path)); },
    cachedCount: () => store.count('wiki_pages'),
  };
}
