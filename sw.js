const CACHE_NAME = 'cox-pos-v10'; // Naikkan versi setiap kali ada perubahan file

// Aset inti (wajib ada agar app shell tetap tampil saat offline)
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js'
];

// Install Service Worker & simpan cache awal
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .catch(err => console.log('Gagal cache awal:', err))
  );
});

// Hapus cache versi lama saat activate
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Strategi: Network dulu (data selalu segar), fallback ke Cache saat offline.
// Response sukses dari CDN/aset statis ikut disimpan ke cache agar mode
// offline berikutnya tetap punya font/ikon/style, bukan cuma HTML kosong.
self.addEventListener('fetch', event => {
  const req = event.request;

  event.respondWith(
    fetch(req)
      .then(res => {
        // Jangan cache request ke Google Apps Script (data transaksi harus selalu real-time)
        if (req.method === 'GET' && res && res.status === 200 && !req.url.includes('script.google.com')) {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, resClone));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});