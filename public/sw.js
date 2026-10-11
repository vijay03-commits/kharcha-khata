const CACHE_NAME = 'kharcha-khata-shell-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png'];
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
    try {
      const response = await fetch('/index.html', { cache: 'reload' });
      if (response.ok) {
        const html = await response.clone().text();
        await cache.put('/index.html', response);
        const assets = [...html.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g)].map((match) => match[1]).filter((asset) => asset.startsWith('/'));
        await Promise.allSettled(assets.map((asset) => cache.add(asset)));
      }
    } catch { /* first install still succeeds if optional asset pre-caching fails */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', response.clone()));
      return response;
    }).catch(async () => (await caches.match('/index.html')) || (await caches.match('/'))));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => {
    if (cached) return cached;
    return fetch(request).then((response) => {
      if (response.ok && (url.pathname.startsWith('/assets/') || /\.(svg|png|webmanifest)$/.test(url.pathname))) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
      }
      return response;
    });
  }));
});
