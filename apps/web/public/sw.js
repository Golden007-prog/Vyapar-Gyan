// VyaparGyan Service Worker
// Cache-first for static assets, network-first for API, pre-cached offline fallback

const STATIC_CACHE = 'vyapargyan-static-v1';
const API_CACHE = 'vyapargyan-api-v1';
const OFFLINE_URL = '/offline';

const STATIC_EXTENSIONS = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.woff', '.woff2'];

// Install: pre-cache offline fallback page
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.add(OFFLINE_URL))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  const currentCaches = [STATIC_CACHE, API_CACHE];
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => !currentCaches.includes(name))
          .map((name) => caches.delete(name))
      )
    )
  );
  self.clients.claim();
});

// Fetch: route requests to appropriate strategy
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  // API requests: network-first
  if (url.pathname.includes('/api/')) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  // Static assets: cache-first
  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // Navigation requests: network-first with offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(navigationFetch(request));
    return;
  }
});

// --- Strategies ---

function isStaticAsset(pathname) {
  return STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext)) ||
    pathname.startsWith('/_next/static/');
}

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
  } catch {
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
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
  } catch {
    const cached = await caches.match(request);
    return cached || new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function navigationFetch(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // Serve offline fallback for uncached navigation requests
    const offlinePage = await caches.match(OFFLINE_URL);
    return offlinePage || new Response('Offline', { status: 503 });
  }
}
