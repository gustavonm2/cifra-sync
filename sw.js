// Service worker: guarda o app inteiro para uso offline (exceto o vídeo do YouTube).
const CACHE = 'cifra-sync-v4';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest', 'styles/app.css',
  'src/app.js', 'src/chords.js', 'src/parser.js', 'src/tap-tempo.js', 'src/timeline.js', 'src/markers.js',
  'src/metronome.js', 'src/storage.js', 'src/youtube.js', 'src/demo.js',
  'fonts/jetbrains-mono-latin-400-normal.woff2', 'fonts/jetbrains-mono-latin-700-normal.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return; // YouTube, /api etc. vão direto à rede
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      });
      return hit || fresh.catch(() => caches.match('index.html'));
    }),
  );
});
