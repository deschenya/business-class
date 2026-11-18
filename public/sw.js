// Service Worker «Бизнес-Класс!!!»: игра скачивается один раз (экран загрузки кладёт файлы
// в кеш bk-<версия>) и дальше открывается из кеша. Страница и манифест — сначала из сети,
// чтобы новая версия после деплоя подхватывалась сразу.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

const FONT_CACHE = 'bk-fonts';
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // шрифты Google — из кеша, если уже были
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONT_CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((r) => { c.put(req, r.clone()); return r; })));
    return;
  }
  if (url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.endsWith('/ws')) return;
  const fresh = req.mode === 'navigate' || url.pathname.endsWith('/precache.json') || url.pathname.endsWith('/');
  if (fresh) {
    e.respondWith(fetch(req).catch(async () => (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./')) || Response.error()));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
});
