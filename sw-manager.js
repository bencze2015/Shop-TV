// Modest shell cache for the Workout Manager PWA (manage.html), scoped to that page only via
// the {scope:'/manage.html'} option passed at registration -- this worker never controls
// index.html (the TV), so it can never affect what the TV renders.
//
// It only ever caches the static app shell (HTML/JS/manifest/icons). It NEVER caches anything
// under /api/ -- those requests are left completely untouched and always go straight to the
// network, so a workout or a completion checkmark can never be served stale from here. Bump
// CACHE_NAME to force every client onto a fresh shell on the next load.

const CACHE_NAME = 'shop-tv-manager-shell-v1';
const SHELL_URLS = [
  '/manage.html',
  '/manager.js',
  '/manifest-manager.json',
  '/icons/icon-120.png',
  '/icons/icon-152.png',
  '/icons/icon-167.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Live data always goes straight to the network, untouched -- no caching, no fallback.
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Stale-while-revalidate for the shell only: serve the cached copy instantly for a fast open,
  // and in the background fetch a fresh copy to serve next time. Worst case on a version bump is
  // one load of a shell that's a few minutes old -- never a stale workout or completion state.
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fresh = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    )
  );
});
