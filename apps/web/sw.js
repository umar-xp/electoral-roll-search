/**
 * Service Worker — Offline-first caching for Electoral Roll Search
 *
 * Strategy:
 * - Static assets (JS, CSS, fonts): Cache-first with versioned cache
 * - Data index files (master_index, AC_index): Stale-while-revalidate (1hr)
 * - Part data files: Cache-first (immutable once generated)
 * - HTML: Network-first with cache fallback
 */

const CACHE_VERSION = 'v5';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const DATA_CACHE = `data-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './search-utils.js',
  './indexed-search.js',
  './search-engine.js',
  './state.js',
  './data-fetcher.js',
  './ui-renderer.js',
  './search-worker.js',
  './monitor.js',
  './app.js',
];

// Install: pre-cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== DATA_CACHE)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: route-based caching strategy
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GET requests
  if (event.request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  if (
    path.endsWith('/request-admin.html') ||
    path.endsWith('/request-assisted.html') ||
    path.endsWith('/request-status.html') ||
    path.endsWith('/about.html')
  ) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Part data files — cache-first (immutable data)
  if (path.includes('/part_') && path.endsWith('.json')) {
    event.respondWith(cacheFirst(event.request, DATA_CACHE));
    return;
  }

  // Index files — stale-while-revalidate
  if (path.endsWith('_index.json') || path.endsWith('master_index.json')) {
    event.respondWith(staleWhileRevalidate(event.request, DATA_CACHE));
    return;
  }

  // Static assets — cache-first
  if (path.endsWith('.js') || path.endsWith('.css')) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  // HTML — network-first
  if (path.endsWith('.html') || path.endsWith('/')) {
    event.respondWith(networkFirst(event.request, STATIC_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return new Response('Offline', { status: 503 });
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  // Always revalidate in background
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => cached);

  // Return cached immediately if available, else wait for fetch
  return cached || fetchPromise;
}
