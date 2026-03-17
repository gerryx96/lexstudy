// ════════════════════════════════════════════════════
// LexStudy — Service Worker
// Strategia: Cache First per asset statici,
//            Network First per chiamate API Anthropic
// ════════════════════════════════════════════════════

const VERSION   = 'lexstudy-v1';
const CACHE_APP = `${VERSION}-app`;
const CACHE_CDN = `${VERSION}-cdn`;

// File da cachare al primo avvio (app shell)
const APP_SHELL = [
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// CDN fonts da cachare
const CDN_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800;900&family=Syne:wght@700;800&display=swap',
];

// ── INSTALL ───────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_APP).then(cache => {
        return cache.addAll(APP_SHELL).catch(err => {
          console.warn('[SW] Alcuni file non trovati durante install:', err);
        });
      }),
      caches.open(CACHE_CDN).then(cache => {
        return cache.addAll(CDN_ASSETS).catch(() => {
          // Font fallback: se offline non ci saranno font custom, va bene
        });
      }),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('lexstudy-') && key !== CACHE_APP && key !== CACHE_CDN)
          .map(key => {
            console.log('[SW] Elimino vecchia cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ─────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Anthropic API → sempre Network, mai cache (dati dinamici)
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Google Fonts CSS → Cache First con fallback network
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_CDN).then(async cache => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          cache.put(event.request, response.clone());
          return response;
        } catch {
          return new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // App shell (HTML, manifest, icone) → Cache First + aggiornamento background
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_APP).then(async cache => {
        const cached = await cache.match(event.request);

        // Fetch in background per aggiornare la cache
        const networkFetch = fetch(event.request).then(response => {
          if (response && response.status === 200) {
            cache.put(event.request, response.clone());
          }
          return response;
        }).catch(() => null);

        // Ritorna subito dal cache se disponibile, altrimenti aspetta network
        return cached || networkFetch;
      })
    );
    return;
  }

  // Tutto il resto → network con fallback cache
  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request)
    )
  );
});

// ── BACKGROUND SYNC (aggiornamenti silenziosi) ────────
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});

// ── NOTIFICA NUOVA VERSIONE ───────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CHECK_UPDATE') {
    // Comunica ai client che c'è un aggiornamento
    self.clients.matchAll().then(clients => {
      clients.forEach(client => {
        client.postMessage({ type: 'UPDATE_AVAILABLE' });
      });
    });
  }
});
