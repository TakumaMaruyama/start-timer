const CACHE_NAME = 'swim-timer-v8';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/manifest.json?v=8',
  '/icons/pace-clock.svg',
  '/icons/pace-clock-180.png',
  '/icons/pace-clock-192.png',
  '/icons/pace-clock-512.png',
  '/icons/pace-clock-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name.startsWith('swim-timer-') && name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  // Only cache GET requests
  if (event.request.method !== 'GET') return;

  // Installation names must come from the current page and manifest when online.
  const pathname = new URL(event.request.url).pathname;
  const preferNetwork = event.request.mode === 'navigate' ||
    pathname === '/index.html' || pathname === '/manifest.json';

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(
        event.request,
        preferNetwork ? { cache: 'no-store' } : undefined,
      ).then((networkResponse) => {
        if (networkResponse && networkResponse.ok) {
          const responseClone = networkResponse.clone();
          return caches.open(CACHE_NAME).then((cache) =>
            cache.put(event.request, responseClone),
          ).then(() => networkResponse);
        }
        return networkResponse;
      }).catch(() => {
        // Offline fallback for navigation and already-cached assets.
        if (event.request.mode === 'navigate') {
          return caches.match('/').then((response) => response || new Response(
            'Offline',
            { status: 503, headers: { 'Content-Type': 'text/plain' } },
          ));
        }
        return caches.match(event.request);
      });
      return preferNetwork ? fetchPromise : cachedResponse || fetchPromise;
    })
  );
});
