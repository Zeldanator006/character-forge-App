/* Offline support: keeps the app's own files on the device so it opens without a connection.
   Bump VERSION whenever a file below changes, so devices fetch the new copies. */
const VERSION = 'v10';
const CACHE = `character-forge-${VERSION}`;
const FILES = [
  './', 'index.html', 'phone.css', 'manifest.webmanifest',
  // the PC app's interface (tools/sync_ui.sh)
  'ui/app.js', 'ui/companions.js', 'ui/dice.js', 'ui/feats.js', 'ui/gear.js', 'ui/levelup.js', 'ui/offline.js', 'ui/options.js',
  'ui/phone.js', 'ui/play.js', 'ui/story.js', 'ui/style.css', 'ui/theme.js',
  'js/api.js', 'js/boot.js', 'js/claude.js', 'js/creatures.js', 'js/dice.js', 'js/feats.js', 'js/gear.js', 'js/levelup.js',
  'js/library.js', 'js/options.js', 'js/pdfs.js', 'js/phone-ui.js', 'js/py.js', 'js/resources.js', 'js/rules.js', 'js/srd.js',
  'js/start.js', 'js/store.js', 'js/wiki.js', 'js/wikiparse.js',
  'vendor/anthropic-sdk.mjs', 'vendor/pdf-lib.mjs', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
  'data/srd-2014.json', 'data/creatures.json', 'data/field_map.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('character-forge-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// The app's own files come from the cache (fast, works offline); anything else goes to the network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
