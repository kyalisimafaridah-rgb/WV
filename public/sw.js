/**
 * Minimal service worker — required for Chrome/Android to treat this as an
 * installable PWA. Intentionally does no caching: this app is live data
 * (router status, vouchers), so we always want a fresh network fetch, not a
 * cached copy. This just satisfies the install criteria.
 */
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
