/* ============================================================
 * 销冠助手 · 本地存储与登录态回归测试（node tools/test-storage.js）
 *
 * 守住 2026-11-04 审计的四条：
 *   M8  离线时刷新令牌失败就被登出
 *   M9  本地数据损坏时被空库直接覆盖；写满时静默丢失
 *   M10 多标签页整份写回，互相覆盖
 *   M11 没申请持久化存储
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; }
function section(name) { console.log('\n== ' + name + ' =='); }

/* 每个用例一套全新的「浏览器」：内存 localStorage + 可挂的 storage 事件 + 可选的配额 */
function boot(opts) {
  opts = opts || {};
  const mem = Object.assign({}, opts.mem || {});
  let quota = opts.quota || Infinity;
  const winListeners = {};
  const ctx = {
    mem,
    setQuota(q) { quota = q; },
    fire(type, ev) { (winListeners[type] || []).forEach(fn => fn(ev)); },
    persistCalls: 0
  };
  const used = () => Object.keys(mem).reduce((n, k) => n + k.length + mem[k].length, 0);
  global.localStorage = {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => {
      v = String(v);
      const next = used() - (k in mem ? k.length + mem[k].length : 0) + k.length + v.length;
      if (next > quota) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      mem[k] = v;
    },
    removeItem: k => { delete mem[k]; }
  };
  global.window = global;
  global.addEventListener = (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); };
  Object.defineProperty(global, 'navigator', { configurable: true, writable: true, value: {
    onLine: true,
    storage: opts.noStorageApi ? undefined : {
      persisted: () => Promise.resolve(false),
      persist: () => { ctx.persistCalls++; return Promise.resolve(opts.grant !== false); }
    }
  } });
  global.document = { addEventListener() {} };
  (0, eval)(fs.readFileSync(path.join(root, 'js/core/store.js'), 'utf8'));
  ctx.events = [];
  if (Store.on) Store.on((t, i) => ctx.events.push({ t, i }));
  return ctx;
}
const tick = () => new Promise(r => setTimeout(r, 5));

(async () => {
  /* ========== M9 ========== */
  section('M9 本地数据损坏');
  const broken = '{"customers":[{"id":"c1","name":"真实客户"}],"deals":[';   // 截断的 JSON
  let b = boot({ mem: { sales_copilot_v1: broken } });
  Store.load();
  const bk = Object.keys(b.mem).find(k => k.indexOf('sales_copilot_v1.corrupt.') === 0);
  check('损坏原文另存了一份', !!bk && b.mem[bk] === broken);
  check('不被当成新安装灌示例', Store.shouldSeedDemo() === false);
  check('界面收到 corrupt 事件', b.events.some(e => e.t === 'corrupt' && e.i.backupKey === bk));

  b = boot({ mem: { sales_copilot_v1: broken }, quota: broken.length + 40 });
  Store.load();
  Store.insert && Store.insert('customers', { name: '新客户' });
  check('另存不下时不覆盖原文', b.mem.sales_copilot_v1 === broken);
  check('另存不下时 corrupt 事件没有 backupKey', b.events.some(e => e.t === 'corrupt' && !e.i.backupKey));
  b.setQuota(Infinity);
  Store.reset();
  check('用户主动清空后允许覆盖', b.mem.sales_copilot_v1 !== broken);

  section('M9 写满');
  b = boot();
  Store.load();
  b.setQuota(Object.keys(b.mem).reduce((n, k) => n + k.length + b.mem[k].length, 0) + 10);
  Store.insert('customers', { name: 'x'.repeat(500) });
  check('写入失败发出 save-error', b.events.some(e => e.t === 'save-error'));
  check('isPersistent 变为 false', Store.isPersistent() === false);
  b.setQuota(Infinity);
  Store.save();
  check('恢复后发出 save-ok', b.events.some(e => e.t === 'save-ok'));

  /* ========== M10 ========== */
  section('M10 多标签页');
  b = boot();
  Store.load();
  const other = JSON.parse(b.mem.sales_copilot_v1);
  other.customers = [{ id: 'fromTabB', name: '另一个标签页加的', updatedAt: Date.now() }];
  const nv = JSON.stringify(other);
  b.mem.sales_copilot_v1 = nv;
  b.fire('storage', { key: 'sales_copilot_v1', newValue: nv });
  check('别的标签页写入后本页 state 已重载', (Store.state.customers || []).some(c => c.id === 'fromTabB'));
  check('界面收到 external 事件', b.events.some(e => e.t === 'external'));
  Store.insert('customers', { name: '本页再加一条' });
  const after = JSON.parse(b.mem.sales_copilot_v1);
  check('本页随后的写入不再抹掉另一个标签页的记录', after.customers.some(c => c.id === 'fromTabB'));

  /* ========== M11 ========== */
  section('M11 持久化存储');
  b = boot();
  Store.load();
  await tick();
  check('启动时申请了 navigator.storage.persist()', b.persistCalls === 1);
  check('结果可供设置页显示', Store.storageInfo && Store.storageInfo().persistGranted === true);
  b = boot({ noStorageApi: true });
  let threw = false;
  try { Store.load(); await tick(); } catch (e) { threw = true; }
  check('不支持 storage API 的浏览器不报错', !threw);

  /* ========== M8 ========== */
  section('M8 离线不登出');
  function bootAuth(fetchImpl) {
    boot();
    Store.load();
    global.fetch = fetchImpl;
    localStorage.setItem('sc.auth.session', JSON.stringify({
      access_token: 'old', refresh_token: 'r', expires_at: Date.now() - 1000, user_id: 'u1', email: 'a@b.c'
    }));
    (0, eval)(fs.readFileSync(path.join(root, 'js/core/auth.js'), 'utf8'));
    Auth.init && (() => { try { Auth.init(); } catch (e) {} })();
  }
  bootAuth(async () => { throw new TypeError('Failed to fetch'); });
  let err = null;
  try { await Auth.api('/rest/v1/records?select=id', { method: 'GET' }); } catch (e) { err = e; }
  check('断网时刷新失败，会话保留', Auth.isOn() === true && !!localStorage.getItem('sc.auth.session'));
  check('报错说明是网络问题', !!err && /网络/.test(err.message));

  bootAuth(async () => ({ ok: false, status: 503, text: async () => '{"message":"upstream"}' }));
  try { await Auth.api('/rest/v1/records?select=id', { method: 'GET' }); } catch (e) {}
  check('服务端 5xx 时会话保留', Auth.isOn() === true);

  bootAuth(async () => ({ ok: false, status: 400, text: async () => '{"error":"invalid_grant"}' }));
  err = null;
  try { await Auth.api('/rest/v1/records?select=id', { method: 'GET' }); } catch (e) { err = e; }
  check('refresh_token 被拒（400）时才清会话', Auth.isOn() === false && !!err && /过期/.test(err.message));

  /* ========== M21 数据码与导入 ========== */
  section('M21 数据码不带凭据、导入以导入为准');
  boot();
  Store.load();
  Store.state.settings.ai = { enabled: true, base: 'x', key: 'sk-SECRET-AI', model: 'm' };
  Store.state.settings.tavily = { key: 'tvly-SECRET' };
  Store.state.settings.sync = { provider: 'supabase', url: 'u', key: 'k', space: 'SECRET-SPACE-NAME-1234' };
  Store.state.settings.cloud = { url: 'https://mine.supabase.co', key: 'sb_publishable_mine' };
  Store.state.customers = [{ id: 'c1', name: '甲', updatedAt: 1000 }];
  Store.save();
  const code = Store.exportJSON();
  check('数据码不含 AI Key', !code.includes('sk-SECRET-AI'));
  check('数据码不含 Tavily Key', !code.includes('tvly-SECRET'));
  check('数据码不含同步空间 / 令牌', !code.includes('SECRET-SPACE-NAME-1234'));
  check('备份 JSON（secrets:true）仍保留凭据', Store.exportJSON({ secrets: true }).includes('sk-SECRET-AI'));

  /* 另一台设备：有自己的设备 ID 和 Key，导入一份旧数据 */
  const srcDevice = Store.state.deviceId;
  boot();
  Store.load();
  const myDevice = Store.state.deviceId;
  Store.state.settings.ai = { enabled: true, base: 'x', key: 'sk-MINE', model: 'm' };
  Store.state.settings.sync = { provider: 'supabase', space: 'MY-OWN-SPACE-NAME-99' };
  Store.save();
  const t0 = Date.now();
  Store.importJSON(code);
  check('导入后保留本机设备 ID（不复制源设备 ' + srcDevice + '）', Store.state.deviceId === myDevice && myDevice !== srcDevice);
  check('导入内容没带 Key 时保留本机的 Key', Store.state.settings.ai.key === 'sk-MINE');
  check('导入内容没带同步配置时保留本机的', !!Store.state.settings.sync && Store.state.settings.sync.space === 'MY-OWN-SPACE-NAME-99');
  const c1 = Store.state.customers.find(c => c.id === 'c1');
  check('导入记录的 updatedAt 刷成现在', !!c1 && c1.updatedAt >= t0);
  /* 云端有一份比导入文件新、但比导入动作旧的版本：合并后应以导入为准 */
  const CORE = require(path.join(root, 'js/core/sync-core.js'));
  if (CORE && CORE.merge) {
    const cloud = { customers: [{ id: 'c1', name: '云端改过', updatedAt: t0 - 5000 }], deals: [], followups: [], scripts: [] };
    const m = CORE.merge(cloud, Store.state);
    check('与较新的云端合并后仍以导入为准', m.customers.find(c => c.id === 'c1').name === '甲');
  } else {
    check('找到 sync-core 的 merge', false);
  }

  /* ========== M17 团队看板 ========== */
  section('M17 团队看板只拉统计字段、分页拉全');
  const urls = [];
  const TOTAL = 2600;
  boot();
  Store.load();
  localStorage.setItem('sc.auth.session', JSON.stringify({
    access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600e3, user_id: 'u1', email: 'a@b.c'
  }));
  global.fetch = async (url, opts) => {
    urls.push(url);
    let body = [];
    if (url.includes('/rest/v1/profiles')) body = [{ id: 'u1', team_id: 't1', role: 'owner', display_name: 'A' }];
    else if (url.includes('/rest/v1/rpc/team_record_facts')) {
      /* 模拟数据库函数：只返回统计字段 */
      const a = JSON.parse((opts && opts.body) || '{}');
      const all = Array.from({ length: TOTAL }, (_, i) => ({ user_id: 'u1', kind: 'customers', id: 'r' + String(i).padStart(5, '0'),
        stage: null, amount: null, closed_at: null, next_follow_at: '2026-11-01', at: null }));
      body = all.slice(a.p_offset || 0, (a.p_offset || 0) + (a.p_limit || 1000));
    } else if (url.includes('/rest/v1/records')) {
      body = Array.from({ length: 5 }, (_, i) => ({ user_id: 'u1', kind: 'customers', id: 'x' + i, data: { name: '客户' + i, phone: '138' + i } }));
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  (0, eval)(fs.readFileSync(path.join(root, 'js/core/auth.js'), 'utf8'));
  try { Auth.init && Auth.init(); } catch (e) {}
  await Auth.loadProfile(true);
  const rows = await Auth.teamRecords();
  check('拉全 ' + TOTAL + ' 条（实得 ' + rows.length + '）', rows.length === TOTAL);
  check('M17 看板只走 rpc/team_record_facts，不再直接读 records 表', urls.some(u => u.includes('/rpc/team_record_facts')) && !urls.some(u => u.includes('/rest/v1/records')));
  check('拿到的记录不含客户名和电话', rows.length > 0 && !JSON.stringify(rows.slice(0, 5)).includes('138'));
  check('看板需要的字段还在', rows.length > 0 && rows[0].data && rows[0].data.nextFollowAt === '2026-11-01');

  /* CodeRabbit PR #21：第 2 页失败时不能把第 1 页当全量返回 */
  const okFetch = global.fetch;
  global.fetch = async (url, opts) => {
    const a = JSON.parse((opts && opts.body) || '{}');
    if (url.includes('/rpc/team_record_facts') && (a.p_offset || 0) >= 1000) return { ok: false, status: 503, text: async () => '{"message":"down"}' };
    return okFetch(url, opts);
  };
  let partialErr = null, partialRows = null;
  try { partialRows = await Auth.teamRecords(); } catch (e) { partialErr = e; }
  check('中途失败时报错而不是返回半截（实得 ' + (partialErr ? '报错' : (partialRows || []).length + ' 条') + '）', !!partialErr);
  global.fetch = okFetch;

  console.log('\n' + (fail === 0 ? 'ALL STORAGE TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
