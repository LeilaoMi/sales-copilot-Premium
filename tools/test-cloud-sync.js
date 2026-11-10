/* ============================================================
 * 销冠助手 · 账号模式同步回归测试（node tools/test-cloud-sync.js）
 *
 * 守住 2026-11-04 审计里账号同步的两条前端问题：
 *   M6  增量拉取 updated_at > 游标 + limit 2000，同一时间戳的一批行
 *       跨过分页边界后，剩下的永远拉不到；
 *   M7  推送游标记的是推完的时间，推送期间改的记录永远不会再被推。
 * 用内存里的假 records 表模拟 PostgREST 的过滤、排序和分页。
 * 服务端那一侧（team_id、LWW、时间戳）见 PGlite 的 RLS 回归。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) fail++;
}
function section(name) { console.log('\n== ' + name + ' =='); }

const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.window = global; global.self = global;
global.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  createElement() { return { style: {}, setAttribute() {}, remove() {}, appendChild() {} }; }, body: { appendChild() {} }, hidden: false };
global.navigator = { onLine: true };
global.location = { protocol: 'https:' };
global.addEventListener = () => {};
global.fetch = async () => { throw new Error('不应直接 fetch'); };

/* ---------- 假的 PostgREST records 表 ---------- */
let table = [];          // { kind, id, data, deleted, updated_at }
let onPush = null;       // 推送进行中的回调，用来模拟「推送期间用户还在改」
const iso = n => new Date(Date.UTC(2026, 0, 1) + n * 1000).toISOString();
global.Auth = {
  userId: () => 'u1', teamId: () => '', isOn: () => true,
  async api(url, opt) {
    opt = opt || {};
    const u = new URL('http://x' + url);
    if (u.pathname.endsWith('/user_settings')) return opt.method === 'POST' ? null : [];
    if (opt.method === 'POST') {
      if (onPush) await onPush();
      JSON.parse(opt.body).forEach(r => {
        const i = table.findIndex(x => x.kind === r.kind && x.id === r.id);
        const row = { kind: r.kind, id: r.id, data: r.data, deleted: r.deleted, updated_at: iso(10000 + table.length) };
        if (i < 0) table.push(row); else table[i] = row;
      });
      return null;
    }
    let rows = table.slice();
    const gte = u.searchParams.get('updated_at');
    if (gte) {
      const [op, v] = [gte.slice(0, gte.indexOf('.')), gte.slice(gte.indexOf('.') + 1)];
      rows = rows.filter(r => (op === 'gte' ? r.updated_at >= v : r.updated_at > v));
    }
    const order = (u.searchParams.get('order') || 'updated_at.asc').split(',').map(o => o.split('.')[0]);
    rows.sort((a, b) => { for (const k of order) { if (a[k] < b[k]) return -1; if (a[k] > b[k]) return 1; } return 0; });
    const off = Number(u.searchParams.get('offset') || 0), lim = Number(u.searchParams.get('limit') || 1e9);
    return rows.slice(off, off + lim);
  }
};

// biome-ignore lint/security/noGlobalEval: 测试脚本用 eval 加载浏览器端源码
['js/core/store.js', 'js/core/sync.js'].forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));

(async () => {
  /* ========== M6：同时间戳的批次跨分页边界 ========== */
  section('M6 增量拉取不漏行');
  Store.load();
  Store.state.customers = []; Store.state.deals = []; Store.state.followups = []; Store.state.scripts = [];
  Store.save();
  /* 2600 行：前 1800 行各自时间戳，后 800 行共用一个时间戳（一次 upsert 的批），
   * 这批正好压在 2000 行的旧分页边界上 */
  for (let i = 0; i < 2600; i++) {
    table.push({ kind: 'customers', id: 'c' + String(i).padStart(5, '0'), data: { id: 'c' + i, name: 'n' + i, updatedAt: 1000 + i }, deleted: false,
      updated_at: i < 1800 ? iso(i) : iso(1800) });
  }
  Sync.saveCfg({ mode: 'cloud', pullCursor: '', pushCursor: Date.now() + 1e9 });
  await Sync.cloudSync(Sync.cfg());
  check('一次同步拉齐全部 2600 行（实得 ' + Store.state.customers.length + '）', Store.state.customers.length === 2600);
  check('拉游标停在最后一个时间戳', Sync.cfg().pullCursor === iso(1800));

  /* 再次同步：边界行重复拉到不会产生重复记录 */
  await Sync.cloudSync(Sync.cfg());
  check('再次同步后仍是 2600 行（不漏、不重复）', Store.state.customers.length === 2600);

  /* ========== M7：推送期间的修改 ========== */
  section('M7 推送期间的改动不丢');
  table = [];
  Store.state.customers = [{ id: 'a1', name: 'A', updatedAt: Date.now() }];
  Store.save();
  Sync.saveCfg({ mode: 'cloud', pullCursor: '', pushCursor: 0 });
  /* 第一次推送耗时 8 秒：期间用户改了另一条客户 */
  onPush = async () => {
    onPush = null;
    const realNow = Date.now;
    Store.state.customers.push({ id: 'b1', name: 'B（推送期间新增）', updatedAt: realNow() + 1 });
    Date.now = () => realNow() + 8000;   // 推完时已过去 8 秒
    setTimeout(() => { Date.now = realNow; }, 0);
  };
  await Sync.cloudSync(Sync.cfg());
  await new Promise(r => setTimeout(r, 5));
  await Sync.cloudSync(Sync.cfg());
  check('推送期间新增的记录在下一次同步被推上去', table.some(r => r.id === 'b1'));

  console.log('\n' + (fail === 0 ? 'ALL CLOUD SYNC TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
