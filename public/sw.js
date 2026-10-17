// Service worker: permite instalar la web y abrirla sin conexión con los últimos datos vistos.
// Siempre primero la red (así se ve la última versión publicada); la caché solo se usa sin conexión.
// Las peticiones a otros dominios (API de la federación en directo, Google Maps) no se tocan.
const CACHE = 'leioa-mini-v3';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/live.js', 'js/theme.js', 'img/icon-192.png', 'manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
        return res;
      })
      .catch(() => caches.match(e.request)),
  );
});
