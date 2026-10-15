/* Opens the device's storage and starts the on-device API that js/boot.js hands the interface's requests to. */
import { createApi } from './api.js';
import { idbStore } from './store.js';

(async function start() {
  try {
    const srd = await (await fetch('data/srd-2014.json')).json();
    window.CF.started(await createApi(idbStore(), srd));
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    window.CF.failed(e);
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
