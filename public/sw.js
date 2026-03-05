const CACHE_NAME = 'ggss-security-v2';
const OFFLINE_URL = '/offline.html';

const ASSETS_TO_CACHE = [
    '/logo.png',
    OFFLINE_URL
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.filter((cacheName) => {
                    return cacheName !== CACHE_NAME;
                }).map((cacheName) => {
                    return caches.delete(cacheName);
                })
            );
        })
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;

    // Ignorar llamadas a APIs externas y Firebase Storage para evitar problemas de CORS/SW
    if (event.request.url.includes('firebasestorage.googleapis.com') ||
        event.request.url.includes('api.ipify.org')) {
        return;
    }

    // Estrategia: Network-First para el HTML y root, Cache-First para el resto
    const isNavigation = event.request.mode === 'navigate' ||
        event.request.url.endsWith('/') ||
        event.request.url.endsWith('index.html');

    if (isNavigation) {
        event.respondWith(
            fetch(event.request)
                .catch(() => caches.match(OFFLINE_URL))
        );
    } else {
        event.respondWith(
            caches.match(event.request).then((response) => {
                return response || fetch(event.request);
            })
        );
    }
});
