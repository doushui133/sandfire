/* eslint-disable no-restricted-globals */
// Bump CACHE_VERSION when shipping changes to js/ or other cached assets (see README).
const CACHE_VERSION = 'sandfire-v7';
const CACHE = CACHE_VERSION;

const INDEX = /\/(?:index\.html)?$/;

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw e;
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  // code and pages: network first (fresh after every deploy, cached copy when offline);
  // large assets (models, textures, lightmap, three.js): cache first
  const isCode = path === '/' || INDEX.test(path) || (/\.(?:js|css|html|webmanifest)$/.test(path) && path.indexOf('/vendor/') < 0);
  event.respondWith((isCode ? networkFirst : cacheFirst)(event.request));
});