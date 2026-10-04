const CACHE_NAME = 'palate-v10';
const ASSETS = [
  '/',
  '/index.html',
  '/css/styles.css',
  '/js/app.js',
  '/js/store.js',
  '/js/sync.js',
  '/js/search.js',
  '/js/markdown.js',
  '/js/zip.js',
  '/js/theme.js',
  '/js/db.js',
  '/js/tokenizer.js',
  '/js/predictor.js',
  '/js/morph.js',
  '/js/keyboard/keyboard.js',
  '/js/keyboard/language.js',
  '/js/keyboard/layouts.js',
  '/js/keyboard/haptics.js',
  '/js/organize/organizer.js',
  '/js/organize/heuristics.js',
  '/js/organize/prompt.js',
  '/js/organize/llm.js',
  '/js/organize/llm-worker.js',
  '/data/words-en.txt',
  '/icons/icon.svg',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network first (so updates land immediately), cache as the offline fallback.
// The API is never cached.
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await Promise.race([
        fetch(request),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000))
      ]);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      const cached = await cache.match(request, { ignoreSearch: true });
      if (cached) return cached;
      if (request.mode === 'navigate') return cache.match('/index.html');
      return Response.error();
    }
  })());
});
