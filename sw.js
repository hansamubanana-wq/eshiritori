const CACHE = 'eshiritori-v1';
const ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/portal.js",
  "/sync.js",
  "/pwa.js",
  "/pwa.css",
  "/corner-mode.js",
  "/favicon.svg",
  "/manifest.webmanifest",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png",
  "/assets/ogp.png",
  "/eshiritori/index.html",
  "/eshiritori/style.css",
  "/eshiritori/app.js",
  "/drawing-quiz/index.html",
  "/drawing-quiz/style.css",
  "/drawing-quiz/app.js",
  "/drawing-telephone/index.html",
  "/drawing-telephone/style.css",
  "/drawing-telephone/app.js",
  "/word-wolf/index.html",
  "/word-wolf/style.css",
  "/word-wolf/app.js",
  "/typing-race/index.html",
  "/typing-race/style.css",
  "/typing-race/app.js",
  "/quiz-battle/index.html",
  "/quiz-battle/style.css",
  "/quiz-battle/app.js",
  "/memory-cards/index.html",
  "/memory-cards/style.css",
  "/memory-cards/app.js"
];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    const path = url.pathname.endsWith('/') && url.pathname !== '/' ? url.pathname + 'index.html' : url.pathname;
    if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname === '/ws' || !['http:', 'https:'].includes(url.protocol) || !ASSETS.includes(path)) return;
    event.respondWith(fetch(event.request).then(response => {
        if (response.ok) { const copy = response.clone(); event.waitUntil(caches.open(CACHE).then(cache => cache.put(path, copy))); }
        return response;
    }).catch(() => caches.match(path)));
});
