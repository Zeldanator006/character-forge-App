/* Offline support: keeps the app's own files on the device so it opens without a connection.
   Bump VERSION whenever a file below changes, so devices fetch the new copies. */
const VERSION = 'v5';
const CACHE = `character-forge-${VERSION}`;
const FILES = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'js/api.js', 'js/claude.js', 'js/library.js', 'js/pdfs.js', 'js/rules.js', 'js/srd.js', 'js/store.js',
  'vendor/anthropic-sdk.mjs', 'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs',
  'data/srd-2014.json',
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
