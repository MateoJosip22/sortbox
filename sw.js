// Sortbox service worker: lets the app open with no connection.
// When you change any file, bump VERSION so devices pick up the new files.
const VERSION = 'sortbox-v1';
const FONT_CACHE = 'sortbox-fonts';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './cats.js',
  './parser.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== FONT_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: serve the saved copy, refresh it in the background
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(staleWhileRevalidate(req, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Opening the app: try the network first so updates show up, fall back to the saved page offline
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html', { ignoreSearch: true }).then(r => r || caches.match('./')))
    );
    return;
  }
  event.respondWith(staleWhileRevalidate(req, VERSION));
});

function staleWhileRevalidate(req, cacheName) {
  return caches.open(cacheName).then(cache =>
    cache.match(req, { ignoreSearch: true }).then(cached => {
      const network = fetch(req)
        .then(res => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; })
        .catch(() => cached);
      return cached || network;
    })
  );
}
