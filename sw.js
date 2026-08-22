/**
 * sw.js — service worker for Daily Briefing.
 *
 * Two different strategies, because the two assets have opposite needs:
 *
 *   index.html   network-first. It changes rarely but when it does you want
 *                the new version immediately, not three visits later. Falls
 *                back to cache when offline.
 *
 *   news.json    stale-while-revalidate. Serve the cached copy instantly so
 *                the page renders with no spinner, then fetch a fresh copy in
 *                the background for next time. The Action only rewrites this
 *                four times a day, so a few-minutes-stale read costs nothing.
 *
 * Bump CACHE when you change what's precached; the activate handler deletes
 * every older cache.
 *
 * Zero dependencies, same as the rest of the project.
 */
const CACHE = 'briefing-v1';

const PRECACHE = [
  './',
  './index.html',
  './news.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  // addAll fails the whole install if any single entry 404s, so add them
  // individually and tolerate misses — a missing icon shouldn't break offline.
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // never touch third-party

  // news.json — cached copy now, fresh copy for next time.
  // The page requests it with a cache-busting query string, so match on
  // pathname only or every request would be a cache miss.
  if (url.pathname.endsWith('/news.json')) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const key = new Request(url.origin + url.pathname);
      const cached = await c.match(key);
      const fresh = fetch(req)
        .then(r => { if (r && r.ok) c.put(key, r.clone()); return r; })
        .catch(() => null);
      return cached || (await fresh) || new Response('{"items":[]}',
        { headers: { 'Content-Type': 'application/json' } });
    })());
    return;
  }

  // Everything else — network first, cache as backup.
  e.respondWith((async () => {
    try {
      const r = await fetch(req);
      if (r && r.ok) (await caches.open(CACHE)).put(req, r.clone());
      return r;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // Navigations that miss the cache still need something to render.
      if (req.mode === 'navigate') {
        const shell = await caches.match('./index.html');
        if (shell) return shell;
      }
      throw new Error('offline and not cached');
    }
  })());
});
