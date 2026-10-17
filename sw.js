/* Offline support for the installed game. Network first, so edits show up
   straight away when online; the cache is only a fallback. */
const CACHE = 'whg-v6';
const SHELL = ['./', './index.html', './style.css', './js/levels.js', './js/cues.js', './js/vex.js', './js/online.js', './js/race.js', './js/render.js', './js/game.js', './js/level-worker.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // Own files are revalidated with the server every time (no-cache), so a stale HTTP cache
  // can't hand back an old version while online.
  const own = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(
    fetch(e.request, own ? { cache: 'no-cache' } : undefined)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
