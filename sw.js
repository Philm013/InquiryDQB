/* InquiryDQB service worker
   - Precaches the app shell so the teacher console and student app open instantly and work offline
     (saved boards open without a connection; live sessions still need the internet for peer discovery).
   - HTML / JS / CSS: network-first (4s timeout) so updates arrive immediately, cache as the offline fallback.
   - Fonts, icons and vendored libraries: cache-first.
   Bump CACHE_VERSION whenever the shell files change shape (it also forces a clean-up of old caches). */
const CACHE_VERSION = 'dqb-v2.0.0';
const SHELL = [
  './', 'index.html', 'landing.css', 'landing.js',
  'Teacher/', 'Teacher/index.html', 'Teacher/app.css', 'Teacher/app.js', 'Teacher/shell.js', 'Teacher/shell-sheets.js', 'Teacher/shell-home.js', 'Teacher/manifest.webmanifest',
  'Student/', 'Student/index.html', 'Student/app.css', 'Student/app.js', 'Student/manifest.webmanifest',
  'shared/ui.css', 'shared/ui.js', 'shared/net.js', 'shared/icons.js', 'shared/boot.js', 'shared/sw-register.js',
  'vendor/peerjs.min.js', 'vendor/qrcode.min.js', 'vendor/confetti.min.js',
  'fonts/fonts.css', 'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2', 'fonts/patrick-hand-latin.woff2', 'fonts/patrick-hand-latin-ext.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // add individually so one missing file never blocks the install
    await Promise.allSettled(SHELL.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dqb-') && k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

const isStatic = (url) => /\/(fonts|icons|vendor)\//.test(url.pathname) || /\.(woff2?|png|webp|svg|ico)$/.test(url.pathname);

async function networkFirst(request, timeoutMs) {
  const cache = await caches.open(CACHE_VERSION);
  try {
    const res = await Promise.race([
      fetch(request),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))
    ]);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    if (hit) return hit;
    if (request.mode === 'navigate') {
      const fallback = await cache.match(new URL(request.url).pathname.includes('/Student') ? 'Student/index.html' : (new URL(request.url).pathname.includes('/Teacher') ? 'Teacher/index.html' : 'index.html'));
      if (fallback) return fallback;
    }
    throw e;
  }
}
async function cacheFirst(request) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res && res.ok) cache.put(request, res.clone());
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // PeerJS signalling etc. goes straight to the network
  event.respondWith(isStatic(url) ? cacheFirst(req) : networkFirst(req, 4000));
});
