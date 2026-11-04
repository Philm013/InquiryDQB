/* InquiryDQB service worker
   - Precaches the app shell so the teacher console and student app open instantly and work offline
     (saved boards open without a connection; live sessions still need the internet for peer discovery).
   - The install is all or nothing for the app shell (CORE): every file must download, each with a time limit,
     or the install fails and the browser tries again on the next visit. A half-filled cache never takes over.
     EXTRA files (landing page, fonts, icons, manifests) are best effort and are topped up on later visits.
   - HTML / JS / CSS: network-first (4s timeout) so updates arrive immediately, cache as the offline fallback.
   - Fonts, icons and vendored libraries: cache-first.
   Bump CACHE_VERSION whenever the shell files change shape (it also forces a clean-up of old caches). */
const CACHE_VERSION = 'dqb-v2.1.0';
const CORE = [
  'Teacher/', 'Teacher/index.html', 'Teacher/app.css', 'Teacher/app.js', 'Teacher/shell.js', 'Teacher/shell-sheets.js', 'Teacher/shell-home.js',
  'Student/', 'Student/index.html', 'Student/app.css', 'Student/app.js',
  'shared/ui.css', 'shared/ui.js', 'shared/net.js', 'shared/icons.js', 'shared/boot.js', 'shared/sw-register.js',
  'vendor/peerjs.min.js', 'vendor/qrcode.min.js', 'vendor/confetti.min.js'
];
const EXTRA = [
  './', 'index.html', 'landing.css', 'landing.js',
  'Teacher/manifest.webmanifest', 'Student/manifest.webmanifest',
  'fonts/fonts.css', 'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2', 'fonts/patrick-hand-latin.woff2', 'fonts/patrick-hand-latin-ext.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'favicon.ico'
];
const DOWNLOAD_TIMEOUT_MS = 30000;            // per file: a stalled request must not keep the worker "installing" for minutes

const cacheable = (res) => !!res && res.status === 200 && res.type === 'basic';

/** Downloads one file into the cache, bypassing the HTTP cache; rejects on an HTTP error or after the time limit. */
async function store(cache, path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    let res = await fetch(new Request(path, { cache: 'reload', signal: ctrl.signal }));
    if (!cacheable(res)) throw new Error(`${path}: HTTP ${res.status}`);
    // hosts with "pretty URLs" redirect index.html; a redirected response can't answer a navigation, so keep only the content
    if (res.redirected) res = new Response(await res.blob(), { status: 200, headers: res.headers });
    await cache.put(path, res);
  } finally {
    clearTimeout(timer);
  }
}
const storeWithRetry = (cache, path) => store(cache, path).catch(() => store(cache, path));

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await Promise.all(CORE.map((p) => storeWithRetry(cache, p)));       // any failure fails the install (retried next visit)
    await Promise.allSettled(EXTRA.map((p) => store(cache, p)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('dqb-') && k !== CACHE_VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/** Re-downloads anything that is missing from the cache (an EXTRA file that failed at install time). Once per worker start. */
let toppingUp = null;
function topUp() {
  if (!toppingUp) {
    toppingUp = (async () => {
      const cache = await caches.open(CACHE_VERSION);
      const have = new Set((await cache.keys()).map((r) => r.url));
      const missing = CORE.concat(EXTRA).filter((p) => !have.has(new URL(p, self.location.href).href));
      await Promise.allSettled(missing.map((p) => store(cache, p)));
    })().catch(() => { /* try again next time the worker starts */ });
  }
  return toppingUp;
}

const isStatic = (url) => /\/(fonts|icons|vendor)\//.test(url.pathname) || /\.(woff2?|png|webp|svg|ico)$/.test(url.pathname);

/** Pages are stored without their query string (join codes, co-host keys), so each page is cached once. */
const keyFor = (req, url) => (req.mode === 'navigate' ? url.origin + url.pathname : req);

async function fromCache(req, url) {
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(keyFor(req, url));
  if (hit || req.mode !== 'navigate') return hit;
  // offline navigation to a page that was never stored: open the matching app instead of the browser's error page
  return cache.match(url.pathname.includes('/Student') ? 'Student/' : url.pathname.includes('/Teacher') ? 'Teacher/' : './');
}

function networkFirst(event, url, timeoutMs) {
  const req = event.request;
  const network = fetch(req);
  // keep the stored copy fresh whenever the network answers, even if the cache answered first (clone before the page reads the body)
  event.waitUntil(network.then((res) => {
    if (!cacheable(res)) return undefined;
    const copy = res.clone();
    return caches.open(CACHE_VERSION).then((c) => c.put(keyFor(req, url), copy));
  }).catch(() => { /* offline, or the response could not be stored */ }));
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs, null); });
  return Promise.race([network, slow]).then(async (res) => {
    clearTimeout(timer);
    if (res) return res;
    return (await fromCache(req, url)) || network;                          // slow network: cached copy, or keep waiting
  }, async (err) => {
    clearTimeout(timer);
    const hit = await fromCache(req, url);
    if (hit) return hit;
    throw err;
  });
}

async function cacheFirst(event) {
  const req = event.request;
  const cache = await caches.open(CACHE_VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (cacheable(res)) event.waitUntil(cache.put(req, res.clone()).catch(() => {}));
  return res;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;   // DevTools probes; fetch() would throw on these
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;            // PeerJS signalling etc. goes straight to the network
  if (req.mode === 'navigate') event.waitUntil(topUp());
  event.respondWith(isStatic(url) ? cacheFirst(event) : networkFirst(event, url, 4000));
});
