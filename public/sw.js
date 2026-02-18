/**
 * World Tutor — Service Worker
 *
 * Provides offline caching and background sync for the PWA.
 * Designed for low-bandwidth / intermittent connections.
 */

const CACHE_NAME = 'world-tutor-v1';
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/favicon.svg',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API requests: network-first with offline queue
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache GET responses for offline access
          if (request.method === 'GET' && response.ok) {
            const cloned = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, cloned);
            });
          }
          return response;
        })
        .catch(() => {
          // Offline: return cached API responses for GET
          if (request.method === 'GET') {
            return caches.match(request).then((cached) => {
              return cached || new Response(
                JSON.stringify({ error: 'You are offline.' }),
                { headers: { 'Content-Type': 'application/json' }, status: 503 }
              );
            });
          }
          // POST requests when offline: return error
          return new Response(
            JSON.stringify({ error: 'You are offline. Message saved and will be sent when reconnected.' }),
            { headers: { 'Content-Type': 'application/json' }, status: 503 }
          );
        })
    );
    return;
  }

  // Static assets: cache-first, then network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request).then((response) => {
        // Cache successful responses for static assets
        if (response.ok && (
          url.pathname.endsWith('.js') ||
          url.pathname.endsWith('.css') ||
          url.pathname.endsWith('.svg') ||
          url.pathname.endsWith('.html') ||
          url.pathname === '/'
        )) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, cloned);
          });
        }
        return response;
      }).catch(() => {
        // Offline fallback for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Background sync: retry queued messages when back online
self.addEventListener('sync', (event) => {
  if (event.tag === 'send-messages') {
    event.waitUntil(retrySavedMessages());
  }
});

async function retrySavedMessages() {
  // This is handled by the frontend's localStorage queue
  // The service worker just triggers the sync event
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage({ type: 'SYNC_MESSAGES' });
  });
}

// Listen for messages from the main app
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
