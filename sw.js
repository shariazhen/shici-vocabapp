/* 拾词 Service Worker
   缓存策略分两类：
     · 代码和页面（html / js / json / webmanifest）→ 网络优先
       推了新版本，手机一打开就是新的；没网时回落到缓存，照样能用。
     · 字体和图标 → 缓存优先（这些永远不变，没必要每次走网络）
   所以更新 App 不需要改这里的 CACHE 名字。*/
var VERSION = '2.1';
var CACHE = 'shici-' + VERSION;
var SHELL = [
  './', './index.html', './app.js', './seed.js', './config.js',
  './manifest.webmanifest', './icon-192.png', './icon-512.png',
  './fonts/fraunces.woff2', './fonts/plex-sans-400.woff2', './fonts/plex-sans-600.woff2',
  './fonts/plex-mono-400.woff2', './fonts/plex-mono-600.woff2', './fonts/plex-mono-400-ext.woff2'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'VERSION' && e.source) e.source.postMessage({ type: 'VERSION', version: VERSION });
});

/* 代码和页面走网络优先，字体图标走缓存优先 */
function isCode(url) {
  return /\.(html|js|json|webmanifest|css)$/i.test(url.pathname) || url.pathname.endsWith('/');
}
self.addEventListener('fetch', function (e) {
  var r = e.request;
  if (r.method !== 'GET') return;
  var url = new URL(r.url);
  if (url.origin !== self.location.origin) return;          // 后端请求不经手

  if (r.mode === 'navigate' || isCode(url)) {
    e.respondWith(
      // no-store 是为了绕开浏览器自己的 HTTP 缓存
      // （GitHub Pages 给静态资源发 max-age=600，不绕会拿到十分钟前的旧文件）
      fetch(r, { cache: 'no-store' }).then(function (res) {
        if (res && res.ok) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); }
        return res;
      }).catch(function () {
        return caches.match(r).then(function (hit) { return hit || caches.match('./index.html'); });
      })
    );
    return;
  }

  e.respondWith(caches.match(r).then(function (hit) {
    return hit || fetch(r).then(function (res) {
      if (res && res.ok) { var cp = res.clone(); caches.open(CACHE).then(function (c) { c.put(r, cp); }); }
      return res;
    });
  }));
});

/* ── 推送：后端只负责「叫醒」，推哪个词由这里当场从本地词库挑 ── */
function pickWord() {
  return new Promise(function (res) {
    var rq = indexedDB.open('shici');
    rq.onerror = function () { res(null); };
    rq.onsuccess = function () {
      var db = rq.result;
      if (!db.objectStoreNames.contains('words')) { res(null); return; }
      var g = db.transaction('words').objectStore('words').getAll();
      g.onerror = function () { res(null); };
      g.onsuccess = function () {
        var all = g.result || [];
        if (!all.length) { res(null); return; }
        var now = Date.now();
        var due = all.filter(function (w) { return w.status && w.status !== 'new' && (w.due || 0) <= now; });
        var pool = due.length ? due : all.filter(function (w) { return w.status !== 'new'; });
        if (!pool.length) pool = all;
        res(pool[Math.floor(Math.random() * pool.length)]);
      };
    };
  });
}

self.addEventListener('push', function (e) {
  e.waitUntil(pickWord().then(function (w) {
    var title = '拾词', body = '打开看看今天该复习的词';
    if (w) { title = w.w + (w.p ? '　' + w.p : ''); body = (w.d || '') + (w.ex ? '\n' + w.ex : ''); }
    return self.registration.showNotification(title, {
      body: body, icon: './icon-192.png', badge: './icon-192.png',
      tag: 'shici-word', renotify: true, data: { w: w ? w.w : '' }
    });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (ls) {
    for (var i = 0; i < ls.length; i++) { if ('focus' in ls[i]) return ls[i].focus(); }
    return clients.openWindow('./');
  }));
});
