/* ============================================================
 * 销冠助手 · 渲染层注入回归测试（node tools/test-xss.js）
 *
 * 守住 2026-11-04 审计 M2：记录 id 原样拼进 data-id="…"、value="…"，
 * 一条 id 为  x" onmouseover="PWN" y="  的记录（来自导入文件、数据码、
 * 被控的同步服务）就能在 6 个页面逃逸出属性、挂上事件处理器。
 *
 * 做法：加载真实的 store/views 等模块，把示例数据的所有文本字段和
 * 一位客户的 id 都换成攻击载荷，逐个页面渲染，检查载荷有没有逃出来；
 * 再测入口白名单：导入与云端拉取都必须拒收这种 id。
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

/* ---------- 浏览器 stub ---------- */
const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.window = global; global.self = global;
global.document = {
  addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
  createElement() { return { style: {}, setAttribute() {}, remove() {}, appendChild() {} }; }, body: { appendChild() {} }, hidden: false
};
global.navigator = { onLine: true };
global.location = { protocol: 'https:' };
global.addEventListener = () => {};

['js/features/playbook.js', 'js/features/armory.js', 'js/core/store.js', 'js/core/auth.js', 'js/features/health.js',
  'js/features/quicklog.js', 'js/features/digest.js', 'js/features/report.js', 'js/features/coach.js', 'js/features/charts.js',
  'js/ui/views.js', 'js/features/ai.js', 'js/features/sparring.js', 'js/core/sync.js', 'js/features/notify.js', 'js/core/team.js'
].forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));

const TAG = '<img src=x onerror=PWN>';
const ATTR = 'x" onmouseover="PWN" y="';
const SKIP = ['id', 'customerId', 'dealId', 'stage', 'level', 'createdAt', 'closedAt', 'at', 'expectedClose', 'nextFollowAt', 'nextAt', 'updatedAt'];

/* ========== 1. 渲染层：载荷不能逃出属性或标签 ========== */
section('渲染层转义');
Store.load(); Store.seed();
const st = Store.state;
['customers', 'deals', 'followups', 'scripts'].forEach(k => st[k].forEach(r => {
  Object.keys(r).forEach(f => { if (typeof r[f] === 'string' && SKIP.indexOf(f) < 0) r[f] += TAG; });
}));
/* 绕过入口白名单，直接在内存里放一条坏 id —— 测的是渲染层自己这一道 */
const c0 = st.customers[0], oldId = c0.id;
c0.id = oldId + ATTR;
st.deals.forEach(d => { if (d.customerId === oldId) d.customerId = c0.id; });
st.followups.forEach(f => { if (f.customerId === oldId) f.customerId = c0.id; });
st.customers.forEach(c => { c.nextFollowAt = Store.todayStr(); });
st.settings.owner = 'boss' + TAG;
Health.invalidate();

const views = {
  dash: [], customers: [{}], deals: [], followups: [{}], scripts: [{}], report: [{}], ai: [{}], settings: [],
  customerDetail: [c0],
  team: [Team.aggregate([{ user_id: 'u1', kind: 'customers', data: { name: TAG } }], [{ id: 'u1', display_name: TAG, role: 'member' }])]
};
Object.keys(views).forEach(k => {
  let html = '';
  try { html = Views[k].apply(null, views[k]); } catch (e) { check(k + ' 渲染不报错', false); return; }
  const raw = (html.match(/<img src=x onerror=PWN>/g) || []).length;
  const attr = (html.match(/" onmouseover="PWN"/g) || []).length;
  check(k + '：无标签注入、无属性逃逸', raw === 0 && attr === 0);
});

/* ========== 2. 入口白名单 ========== */
section('入口白名单');
check('isSafeId 接受内置 uid', Store.isSafeId(Store.uid()));
check('isSafeId 拒绝引号', !Store.isSafeId(ATTR));
check('safeRecord 拒绝坏的 customerId', !Store.safeRecord({ id: 'a1', customerId: ATTR }));
check('safeRecord 允许空关联', Store.safeRecord({ id: 'a1', customerId: '' }));

Store.load(); Store.seed(); Store.save();
const before = JSON.stringify(Store.state.customers);
const evil = JSON.parse(Store.exportJSON());
evil.customers.push({ id: ATTR, name: 'evil', updatedAt: Date.now() });
let threw = false;
try { Store.importJSON(JSON.stringify(evil)); } catch (e) { threw = /非法/.test(e.message); }
check('导入含坏 id 的文件会被拒绝', threw);
check('拒绝后本地数据保持原样', JSON.stringify(Store.state.customers) === before);
const good = JSON.parse(Store.exportJSON());
let ok = true;
try { Store.importJSON(JSON.stringify(good)); } catch (e) { ok = false; }
check('正常导出文件仍可导入', ok);

console.log('\n' + (fail === 0 ? 'ALL XSS TESTS PASSED' : 'FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
