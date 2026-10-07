// Orbit's service worker. It does one thing: when Orbit's server isn't answering,
// opening Orbit shows a friendly offline page instead of the browser's error.
// Everything else goes straight to the server, untouched and uncached.
const CACHE = 'orbit-offline-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add('/offline.html')).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return; // only page loads
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
