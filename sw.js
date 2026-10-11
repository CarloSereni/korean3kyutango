// 蔵書ライブラリ用 Service Worker
// - Chromeの「インストール」条件を満たすため、fetchハンドラを必ず持たせる
// - 画面本体(HTML)はネットワーク優先(失敗時はキャッシュ)、表紙画像はキャッシュ優先
// - GASへの通信(script.google.com / googleusercontent)やPOSTは一切横取りしない
const CACHE_NAME = 'booklib-v1';
const IMG_CACHE = 'booklib-img-v1';

self.addEventListener('install', function (event) {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME && k !== IMG_CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // GAS(データ取得・更新)は常にそのままネットワークへ
  if (url.hostname === 'script.google.com' || url.hostname.endsWith('script.googleusercontent.com')) return;

  // 表紙画像: キャッシュ優先(オフラインでも表示できるように)
  if (req.destination === 'image') {
    event.respondWith(
      caches.open(IMG_CACHE).then(function (cache) {
        return cache.match(req).then(function (hit) {
          if (hit) return hit;
          return fetch(req).then(function (res) {
            // cross-originの画像は opaque(status 0)でも保存してよい
            if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
            return res;
          }).catch(function () { return hit; });
        });
      })
    );
    return;
  }

  // 同一オリジンのページ・ファイル: ネットワーク優先、失敗したらキャッシュ
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(req).then(function (res) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match(self.registration.scope);
        });
      })
    );
  }
});
