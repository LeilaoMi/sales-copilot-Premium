/* 销冠助手 · Service Worker：离线缓存静态资源，PWA 可添加到主屏幕
 *
 * 重要：只缓存本站静态资源。
 *   - /api/ 开头的请求绝不缓存（否则云同步会一直读到旧快照）
 *   - 跨域请求（AI 接口、Supabase、自建同步服务）不拦截，直接走网络
 *
 * ────────────────────────────────────────────────────────────
 * 这里踩过一个很痛的坑，改之前务必先读完
 * ────────────────────────────────────────────────────────────
 * 旧版本是 cache-first（命中缓存直接返回，完全不问服务器），
 * 而且 CACHE 版本号写死成 'sales-copilot-v2'。
 *
 * 后果：部署了修复之后，用户刷新拿到的**还是缓存里的旧 JS**——
 * 界面看起来一切正常，但 bug 原样复现。修的人在本地和 CI 上怎么测都是绿的
 * （那些环境没有旧缓存），只有真实用户的机器上旧代码阴魂不散。
 * 排查时极容易误判成"我修错了"，其实是"修复压根没送达"。
 *
 * 所以现在的策略是 **网络优先（network-first）**：
 *   - 有网 → 走网络，顺手把新的一份写进缓存
 *   - 断网 → 回退到缓存，离线可用的目标没丢
 * 代价是每次多一次网络往返（本地/公网都是毫秒级），
 * 换来的是"改完代码刷新就生效"。这笔账对个人工具来说怎么算都值。
 *
 * 另外 CACHE 版本号提到 v3：用户机器上那份陈旧的 v2 缓存，
 * 会在 activate 时被清理掉（下面那段 caches.delete）。
 */
/* v4（2026-11-04 审计 M22）：知识库和 manifest 改成「先用缓存、后台更新」，
 * 旧 v3 里那份永不更新的 knowledge.json 借这次换版本清掉。 */
const CACHE = 'sales-copilot-v8';
const NET_TIMEOUT = 3000;   // 弱网（有信号没数据）时最多等 3 秒就先用缓存

/* 预缓存清单：只在首次安装时用，目的是让「第一次离线打开」也有完整页面。
 * 必须和 index.html 里实际引用的文件保持一致 —— 旧版漏了 6 个模块，
 * 结果离线一打开就是残缺页面，比不缓存还糟。
 * 新增脚本文件时记得同步这里。 */
const FILES = [
  './',
  './index.html',
  './assets/css/styles.css',
  './js/core/store.js',
  './js/features/charts.js',
  './js/ui/views.js',
  './js/ui/ui.js',
  './js/features/ai.js',
  './js/core/sync.js',
  './js/features/coach.js',
  './js/features/playbook.js',
  './js/features/armory.js',
  './js/features/health.js',
  './js/features/quicklog.js',
  './js/features/report.js',
  './js/features/digest.js',
  './js/core/auth.js',
  './js/features/notify.js',
  './js/core/team.js',
  './js/features/sparring.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/icon-maskable-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  /* 逐个缓存（审计 M22）：cache.addAll 是原子的，任一文件 404 就一个都不存，
   * 和「宁可缓存不完整，也要能离线打开」的本意相反。 */
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => {})))));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => clients.claim())
  );
});

/* 代码类资源：网络优先，断网回退缓存。
 * 网络超过 NET_TIMEOUT 还没回来、而缓存里有，就先给缓存（审计 M22：以前弱网下要等浏览器自己超时，
 * 往往几十秒白屏）；网络那一份照样在后台写进缓存，下次打开就是新的。 */
function putCache(req, res) {
  if (res && res.ok) {
    const copy = res.clone();
    return caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return Promise.resolve();
}
/* 页面导航忽略查询串：通知新开的 ./?view=customers 离线时也能命中预缓存的 ./，
 * 地址栏仍保留 view 给 ui.js 读（CodeRabbit PR #22） */
const matchCache = req => caches.match(req, req.mode === 'navigate' ? { ignoreSearch: true } : undefined);
async function networkFirst(req, event) {
  const net = fetch(req).then(res => { const w = putCache(req, res); if (event && event.waitUntil) event.waitUntil(w); return res; });
  net.catch(() => {});
  let timer;
  const slow = new Promise(rs => { timer = setTimeout(() => rs('timeout'), NET_TIMEOUT); });
  try {
    const first = await Promise.race([net, slow]);
    if (first !== 'timeout') { clearTimeout(timer); return first; }
    const cached = await matchCache(req);
    if (cached) return cached;
    return await net;                       // 没缓存可用，只能继续等网络
  } catch (e) {
    clearTimeout(timer);
    const cached = await matchCache(req);
    if (cached) return cached;
    return new Response('离线且无缓存', { status: 503, statusText: 'offline' });
  }
}

/* 会更新但不急的数据（知识库、manifest）：先给缓存，后台拉新的写回缓存。
 * 以前走 cacheFirst，第一次缓存后永远不更新。 */
async function staleWhileRevalidate(req, event) {
  const cached = await caches.match(req);
  const net = fetch(req).then(res => putCache(req, res).then(() => res));
  if (cached) {
    const bg = net.catch(() => {});
    if (event && event.waitUntil) event.waitUntil(bg);
    return cached;
  }
  try { return await net; } catch (e) { return new Response('', { status: 504 }); }
}

/* 图标这类不会变的东西：缓存优先，省一次请求 */
async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const copy = fresh.clone();
      caches.open(CACHE).then(c => c.put(req, copy).catch(() => {}));
    }
    return fresh;
  } catch (e) {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                        // PUT 同步请求不拦

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;         // 跨域：AI / 同步接口直接放行
  if (url.pathname.indexOf('/api/') === 0) return;         // 同步接口永不缓存

  /* 代码和页面必须拿最新的，否则修好的 bug 到不了用户机器上 */
  if (/\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith('/')) {
    e.respondWith(networkFirst(req, e));
    return;
  }
  if (/\.(json|webmanifest)$/.test(url.pathname)) {
    e.respondWith(staleWhileRevalidate(req, e));
    return;
  }
  e.respondWith(cacheFirst(req));
});

/* 点击跟进提醒（notify.js 经 registration.showNotification 弹出，审计 M14）：
 * 有打开的窗口就切过去并让它跳到客户库，没有就新开一个。 */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const view = (e.notification.data && e.notification.data.view) || '';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const c = list.find(x => 'focus' in x);
    if (c) {
      if (view) c.postMessage({ type: 'sc-go', view: view });
      return c.focus();
    }
    return clients.openWindow ? clients.openWindow(view ? './?view=' + encodeURIComponent(view) : './') : null;
  }));
});
