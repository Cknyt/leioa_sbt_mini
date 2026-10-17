// Service worker: permite instalar la web y abrirla sin conexión con los últimos datos vistos.
// Datos (data/*.json): primero red, si falla, caché. Resto de archivos propios: caché y se refresca en segundo plano.
// Las peticiones a otros dominios (API de la federación en directo, Google Maps) no se tocan.
const CACHE = 'leioa-mini-v1';
const SHELL = ['./', 'index.html', 'css/style.css', 'js/app.js', 'js/live.js', 'js/theme.js', 'img/icon.svg', 'manifest.webmanifest'];

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

  if (url.pathname.includes('/data/')) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => caches.match(e.request)),
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
          return res;
        })
        .catch(() => cached);
      return cached ?? fresh;
    }),
  );
});
