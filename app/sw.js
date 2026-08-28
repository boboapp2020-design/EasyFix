/* Easy Fix — service worker (app shell cache) */
const CACHE = 'easyfix-v30';
const SHELL = ['index.html', 'rights.js', 'manifest.webmanifest', 'hero-banner.jpg', 'profile-banner.jpg', 'admin-banner.jpg', 'house.png', 'icon-192.png', 'icon-512.png',
  'cat/01.png','cat/02.png','cat/03.png','cat/04.png','cat/05.png','cat/06.png','cat/07.png','cat/08.png','cat/09.png','cat/10.png','cat/11.png','cat/12.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // อย่า cache การเรียก API (Apps Script) — ให้ผ่านเน็ตเวิร์กเสมอ
  if (e.request.method !== 'GET' || url.pathname.includes('/exec')) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
