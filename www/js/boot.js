'use strict';
/* Loads before the interface. The interface in ui/ is the PC app's own (copied by tools/sync_ui.sh); it talks to a
   server with fetch('/api/...'). Here there is no server: those requests go to js/api.js on the device instead,
   once js/start.js has opened the device's storage. Everything else goes to the network as usual. */
(function () {
  let resolve, reject;
  const ready = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  ready.catch(() => {});
  window.CF = { ready, api: null, started(api) { this.api = api; resolve(api); }, failed: reject };

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);

  /** Whatever the interface sent as the body: JSON text, or a form with files (PDF uploads). */
  function readBody(body) {
    if (body instanceof FormData) return { files: [...body.values()].filter((v) => v instanceof Blob) };
    if (typeof body === 'string' && body) {
      try { return { json: JSON.parse(body) }; } catch (e) { return { json: {} }; }
    }
    return {};
  }

  window.fetch = async function (input, opts = {}) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/^\/api\//.test(url)) return realFetch(input, opts);
    let api;
    try { api = await ready; } catch (e) { return json({ error: e.message }, 503); }
    try {
      const data = await api.request(url, { method: (opts.method || 'GET').toUpperCase(), ...readBody(opts.body) });
      if (data && data.blob instanceof Blob) return new Response(data.blob, { headers: { 'Content-Type': data.blob.type || 'application/octet-stream' } });
      return json(data ?? {});
    } catch (e) {
      if (!e.status) console.error(e);   // a bug, not an answer like "not found"
      return json({ error: e.message, ...(e.data || {}) }, e.status || 500);
    }
  };
}());
