/**
 * Minimal production Service Worker for PWA installability.
 * Scope: registration + network-first passthrough only.
 * No offline data cache, no push, no background sync.
 */
/* eslint-disable no-restricted-globals */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first pass-through: never invent offline shells for product data.
  event.respondWith(
    fetch(event.request).catch(
      () =>
        new Response('Network unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
    )
  );
});
