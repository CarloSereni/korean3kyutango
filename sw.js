// ハングル3級単語帳 用 Service Worker
// - インストール時に必要なファイルを全部キャッシュ → 完全オフラインで起動できる
// - ネットワークがあれば最新版を取得してキャッシュを更新（GitHubで更新すれば自動で反映）
// - ネットワークが遅い／無いときはキャッシュから即表示
// - 同じ github.io 上の他アプリのキャッシュには触れない（このアプリ専用の接頭辞だけ管理）
const PREFIX = 'hangul3-tango-';
const CACHE = PREFIX + 'v2';   // 下記 PRECACHE の中身を増減したときだけ数字を上げる
const INDEX = new URL('index.html', self.registration.scope).href;
const REQUIRED = ['index.html'];
const OPTIONAL = ['./', 'manifest.json', 'icon-192.png', 'icon-512.png'];
const NET_TIMEOUT = 3000;      // この時間(ms)返事が無ければキャッシュを先に出す

function abs(u, base) { return new URL(u, base || self.registration.scope).href; }

function fetchFresh(url) {
  return fetch(new Request(url, { cache: 'reload' })).then(function (res) {
    if (!res.ok || res.redirected) throw new Error('bad response ' + url);
    return res;
  });
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      const must = REQUIRED.map(function (u) {
        return fetchFresh(abs(u)).then(function (res) { return cache.put(abs(u), res); });
      });
      const nice = OPTIONAL.map(function (u) {
        return fetchFresh(abs(u)).then(function (res) { return cache.put(abs(u), res); }).catch(function () {});
      });
      // manifest.json に書かれたアイコン類・start_url も追加で保存する
      const fromManifest = fetchFresh(abs('manifest.json')).then(function (res) {
        return res.json();
      }).then(function (m) {
        const urls = (m.icons || []).map(function (i) { return abs(i.src, abs('manifest.json')); });
        if (m.start_url) urls.push(abs(m.start_url, abs('manifest.json')));
        return Promise.all(urls.map(function (u) {
          return fetchFresh(u).then(function (res) { return cache.put(u, res); }).catch(function () {});
        }));
      }).catch(function () {});
      return Promise.all(must.concat(nice, [fromManifest]));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        // このアプリの古い版だけ削除（他アプリのキャッシュは消さない）
        if (k.indexOf(PREFIX) === 0 && k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (hit) {
    if (hit) return hit;
    if (req.mode === 'navigate') return caches.match(INDEX);
  });
}

function networkFirst(req) {
  return new Promise(function (resolve) {
    let settled = false;
    function done(res) { if (!settled && res) { settled = true; resolve(res); } }
    const timer = setTimeout(function () { fromCache(req).then(done); }, NET_TIMEOUT);

    fetch(req, { cache: 'no-cache' }).then(function (res) {
      clearTimeout(timer);
      if (res && res.ok && !res.redirected) {
        const a = res.clone(), b = res.clone();
        caches.open(CACHE).then(function (cache) {
          cache.put(req, a);
          if (req.mode === 'navigate') cache.put(INDEX, b);
        });
      }
      done(res);
    }).catch(function () {
      clearTimeout(timer);
      fromCache(req).then(function (hit) { done(hit || Response.error()); });
    });
  });
}

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 外部サイトには一切介入しない
  event.respondWith(networkFirst(req));
});
