<<<<<<< HEAD
const CACHE_NAME = 'cox-pos-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Install Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch dari Cache
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jika ada di cache, gunakan itu. Jika tidak, ambil dari network
        return response || fetch(event.request);
      })
  );
=======
const CACHE_NAME = 'cox-pos-v1';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json'
];

// Install Service Worker
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch dari Cache
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Jika ada di cache, gunakan itu. Jika tidak, ambil dari network
        return response || fetch(event.request);
      })
  );
>>>>>>> f2600f1362997388c97a5b59960e10652e7ff3fe
});