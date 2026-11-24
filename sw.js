/* Service worker : garde une copie du code de l'application pour qu'elle
   fonctionne hors ligne. Les parties ne passent jamais par ici : elles sont
   dans la base locale (IndexedDB) de l'iPad.
   À CHAQUE NOUVELLE VERSION : changer le numéro dans CACHE ci-dessous. */
const CACHE = 'compagnon-hq-v0.41.0';
const FICHIERS = ['./', './index.html', './styles.css', './stockage.js', './regles.js', './ambiance.js', './sorts.js', './icones.js', './symboles.js', './theme-plateau.js', './portraits.js', './quete-demo.js', './plateau.js', './inventaire.js', './vue-plateau.js', './ecran-heros.js', './app.js', './manifest.webmanifest'];
// Icônes facultatives : leur absence ne doit pas empêcher le mode hors ligne.
const ICONES = ['./icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    // cache: 'reload' : ignore le cache HTTP, pour ne jamais garder d'anciens fichiers.
    await c.addAll(FICHIERS.map(f => new Request(f, { cache: 'reload' })));
    await Promise.all(ICONES.map(i => c.add(new Request(i, { cache: 'reload' })).catch(() => {})));
  }));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// L'application demande d'activer la nouvelle version quand vous touchez « Mettre à jour ».
self.addEventListener('message', e => {
  if (e.data === 'activer') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true })
      .then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
