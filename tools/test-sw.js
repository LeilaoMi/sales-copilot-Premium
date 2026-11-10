/* ============================================================
 * 销冠助手 · Service Worker 与系统通知回归测试（node tools/test-sw.js）
 *
 * 守住 2026-11-04 审计：
 *   M22 sw.js：预缓存一个 404 就全部不缓存；弱网无超时；知识库首次缓存后永不更新
 *   M14 notify.js：安卓 Chrome 禁止 new Notification()，必须走 registration.showNotification
 * 浏览器 API 全用 Node 模拟，只验证逻辑，不代替真机。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
let fail = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; }
function section(t) { console.log('\n== ' + t + ' =='); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- 模拟 SW 环境 ---------- */
function makeSW(fetchImpl) {
  const store = {};                               // cacheName -> Map(url -> body)
  const keyOf = r => (typeof r === 'string' ? r : r.url);
  const cacheObj = name => {
    store[name] = store[name] || new Map();
    const m = store[name];
    return {
      async add(u) { const r = await fetchImpl({ url: u }); if (!r.ok) throw new Error('404 ' + u); m.set(u, r.body); },
      async addAll(us) { const rs = await Promise.all(us.map(u => fetchImpl({ url: u }))); if (rs.some(r => !r.ok)) throw new Error('addAll'); us.forEach((u, i) => m.set(u, rs[i].body)); },
      async put(req, res) { m.set(keyOf(req), res.body); },
      async match(req) { return m.has(keyOf(req)) ? resp(m.get(keyOf(req))) : undefined; }
    };
  };
  const listeners = {};
  const env = {
    store,
    self: { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting() {}, location: { origin: 'https://app.test' } },
    caches: {
      open: async n => cacheObj(n),
      keys: async () => Object.keys(store),
      delete: async n => { delete store[n]; return true; },
      match: async req => { for (const n of Object.keys(store)) { const m = store[n]; if (m.has(keyOf(req))) return resp(m.get(keyOf(req))); } }
    },
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    listeners
  };
  return env;
}
function resp(body, ok = true) { return { ok, status: ok ? 200 : 404, body, clone() { return resp(body, ok); } }; }

function loadSW(env, fetchImpl) {
  const src = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const fn = new Function('self', 'caches', 'clients', 'fetch', 'Response', 'URL', src + '\n;return { networkFirst: typeof networkFirst==="function"?networkFirst:null, staleWhileRevalidate: typeof staleWhileRevalidate==="function"?staleWhileRevalidate:null, cacheFirst: typeof cacheFirst==="function"?cacheFirst:null, CACHE };');
  class R { constructor(b, o) { this.body = b; this.status = (o && o.status) || 200; this.ok = this.status < 400; } clone() { return this; } }
  return fn(env.self, env.caches, env.clients, fetchImpl, R, URL);
}
function fireFetch(env, url) {
  let p = null; const waits = [];
  env.listeners.fetch({ request: { url, method: 'GET' }, respondWith: x => { p = x; }, waitUntil: x => waits.push(x) });
  return { p, waits };
}

(async () => {
  section('M22 预缓存：单个 404 不影响其它文件');
  {
    const f = async r => (/charts\.js$/.test(r.url) ? resp('', false) : resp('body:' + r.url));
    const env = makeSW(f); const api = loadSW(env, f);
    let w; env.listeners.install({ waitUntil: x => { w = x; } }); await w;
    const c = env.store[api.CACHE];
    check('index.html 已缓存', !!c && c.has('./index.html'));
    check('其余文件都缓存了（缺 1 个）', !!c && c.size >= 20);
  }

  section('M22 弱网：网络 3 秒不回就先用缓存');
  {
    const f = () => new Promise(() => {});               // 永不返回
    const env = makeSW(f); const api = loadSW(env, f);
    (await env.caches.open(api.CACHE)).put({ url: 'https://app.test/js/core/store.js' }, resp('old-js'));
    const t0 = Date.now();
    const { p } = fireFetch(env, 'https://app.test/js/core/store.js');
    const r = await Promise.race([p, sleep(6000).then(() => 'hang')]);
    const dt = Date.now() - t0;
    check('拿到缓存（实得 ' + (r && r.body || r) + '）', r && r.body === 'old-js');
    check('不超过 4 秒（实际 ' + dt + 'ms）', dt < 4000);
  }

  section('M22 有网时仍然网络优先');
  {
    const f = async r => resp('new-js');
    const env = makeSW(f); const api = loadSW(env, f);
    (await env.caches.open(api.CACHE)).put({ url: 'https://app.test/js/ui/ui.js' }, resp('old-js'));
    const { p, waits } = fireFetch(env, 'https://app.test/js/ui/ui.js');
    const r = await p; await Promise.all(waits); await sleep(10);
    check('返回网络的新版本', r.body === 'new-js');
    check('缓存同步更新', env.store[api.CACHE].get('https://app.test/js/ui/ui.js') === 'new-js');
  }

  section('M22 知识库：先用缓存，后台更新');
  {
    const f = async r => resp('kb-v2');
    const env = makeSW(f); const api = loadSW(env, f);
    (await env.caches.open(api.CACHE)).put({ url: 'https://app.test/kb/knowledge.json' }, resp('kb-v1'));
    const { p, waits } = fireFetch(env, 'https://app.test/kb/knowledge.json');
    const r = await p; await Promise.all(waits); await sleep(10);
    check('这次先给缓存（不卡加载）', r.body === 'kb-v1');
    check('后台已把缓存更新成新版', env.store[api.CACHE].get('https://app.test/kb/knowledge.json') === 'kb-v2');
  }

  section('M14 安卓：页面 new Notification 抛异常时走 SW');
  {
    const mem = {};
    global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
    global.window = global; global.self = global;
    global.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
    global.addEventListener = () => {};
    global.dispatchEvent = () => {};
    let shown = null;
    global.Notification = class { constructor() { throw new TypeError('Illegal constructor'); } };
    global.Notification.permission = 'granted';
    Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true, serviceWorker: {
      controller: {}, ready: Promise.resolve({ showNotification: async (t, o) => { shown = { t, o }; } }), addEventListener() {}
    } } });
    // biome-ignore lint/security/noGlobalEval: 测试脚本用 eval 加载浏览器端源码
    ['js/features/playbook.js', 'js/core/store.js', 'js/features/notify.js'].forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));
    Store.load();
    Store.state.customers = [{ id: 'c1', name: '甲公司', nextFollowAt: Store.todayStr(), updatedAt: 1 }];
    const n = Notify.check(true);
    await sleep(20);
    check('经 registration.showNotification 弹出', !!shown && /跟进/.test(shown.t));
    check('通知带跳转信息 view=customers', !!shown && shown.o && shown.o.data && shown.o.data.view === 'customers');
    check('check 返回提醒条数 1（实得 ' + n + '）', n === 1);
  }

  section('CodeRabbit PR #21：SW 弹不出且页面通知也失败时不记「已提醒」');
    localStorage.removeItem('sc.notify.sent'); localStorage.removeItem('sc.notify.last');
    Object.defineProperty(global, 'navigator', { configurable: true, value: { onLine: true, serviceWorker: {
      controller: {}, ready: Promise.resolve({ showNotification: async () => { throw new Error('denied'); } }), addEventListener() {}
    } } });
    Store.state.customers = [{ id: 'c2', name: '乙公司', nextFollowAt: Store.todayStr(), updatedAt: 2 }];
    Notify.check(false);
    await sleep(20);
    check('已提醒记录被撤销（下次还会再提醒）', localStorage.getItem('sc.notify.last') === null && localStorage.getItem('sc.notify.sent') === null);

  section('M14 sw.js 处理通知点击');
  {
    const f = async () => resp('');
    const env = makeSW(f); loadSW(env, f);
    check('注册了 notificationclick', typeof env.listeners.notificationclick === 'function');
    if (env.listeners.notificationclick) {
      let msg = null, focused = false, closed = false, w;
      env.clients.matchAll = async () => [{ focus: async () => { focused = true; }, postMessage: m => { msg = m; } }];
      env.listeners.notificationclick({ notification: { data: { view: 'customers' }, close: () => { closed = true; } }, waitUntil: x => { w = x; } });
      await w;
      check('关掉通知、切到已有窗口', closed && focused);
      check('通知页面跳到客户库', !!msg && msg.type === 'sc-go' && msg.view === 'customers');
      let opened = null, w2;
      env.clients.matchAll = async () => [];
      env.clients.openWindow = async u => { opened = u; };
      env.listeners.notificationclick({ notification: { data: { view: 'customers' }, close() {} }, waitUntil: x => { w2 = x; } });
      await w2;
      check('没有窗口时新开的地址带 view（实得 ' + opened + '）', opened === './?view=customers');
    }
  }

  console.log('\n' + (fail === 0 ? 'ALL SW TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
