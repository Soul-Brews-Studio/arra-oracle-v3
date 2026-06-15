const CACHE_PREFIX = 'arra-oracle-frontend';
const STATIC_CACHE = `${CACHE_PREFIX}-static-v1`;
const RUNTIME_CACHE = `${CACHE_PREFIX}-runtime-v1`;
const PRECACHE_URLS = ['/', '/index.html', '/manifest.json', '/icons/arra-oracle.svg'];

async function putIfOk(cacheName, request, response) {
  if (!response || !response.ok) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function networkFirst(request) {
  try {
    return await putIfOk(STATIC_CACHE, request, await fetch(request));
  } catch {
    const cached = await caches.match(request);
    return cached || caches.match('/index.html');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return putIfOk(RUNTIME_CACHE, request, await fetch(request));
}

function isStaticRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/')) return false;
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) return true;
  return ['font', 'image', 'manifest', 'script', 'style', 'worker'].includes(request.destination);
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  const keep = new Set([STATIC_CACHE, RUNTIME_CACHE]);
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && !keep.has(key)).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  if (isStaticRequest(request)) event.respondWith(cacheFirst(request));
});
