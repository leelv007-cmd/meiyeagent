const CACHE_PREFIX = 'meiye-pwa-proof';
const CACHE_VERSION = '__PWA_CACHE_VERSION__';
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;
const PROOF_PATH = '/pwa-proof';
const APP_SHELL = [PROOF_PATH, '/manifest.json', '/favicon.svg'];
const CACHEABLE_DESTINATIONS = new Set([
  'font',
  'image',
  'manifest',
  'script',
  'style',
  'video',
]);

function isCacheableResponse(response) {
  return response.ok && response.type === 'basic';
}

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(
    APP_SHELL.map(async (path) => {
      const response = await fetch(path, { cache: 'reload' });
      if (isCacheableResponse(response)) {
        await cache.put(path, response);
      }
    })
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    if (isCacheableResponse(response)) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedResponse =
      (await cache.match(request)) ?? (await cache.match(PROOF_PATH));
    if (cachedResponse) {
      return cachedResponse;
    }

    return new Response(
      '<!doctype html><title>Offline</title><h1>Offline</h1><p>Reconnect and retry.</p>',
      {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }
    );
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  if (isCacheableResponse(response)) {
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter(
              (cacheName) =>
                cacheName.startsWith(CACHE_PREFIX) && cacheName !== CACHE_NAME
            )
            .map((cacheName) => caches.delete(cacheName))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/')
  ) {
    return;
  }

  if (request.mode === 'navigate') {
    if (url.pathname === PROOF_PATH || url.pathname.endsWith(PROOF_PATH)) {
      event.respondWith(networkFirst(request));
    }
    return;
  }

  if (CACHEABLE_DESTINATIONS.has(request.destination)) {
    event.respondWith(cacheFirst(request));
  }
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
