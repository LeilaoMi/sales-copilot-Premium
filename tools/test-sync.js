/* ============================================================
 * 销冠助手 · 快照同步回归测试（node tools/test-sync.js）
 *
 * 守住 2026-11-04 审计 M1（Supabase 快照表）在前端这一侧的约定：
 *   · 每个请求都带 x-sync-space，RLS 只放行这个空间；
 *   · 空间名不足 16 位直接报错、不发请求；
 *   · 推上去的整包里没有 AI/Tavily Key 和同步配置；
 *   · 采纳云端设置时，本机已有的 Key 不会被云端空值冲掉。
 * 数据库那一侧见 db/ 的 RLS 回归（PGlite）。
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

const calls = [];
let remoteRow = null;
global.fetch = async (url, opt) => {
  opt = opt || {};
  calls.push({ url: String(url), method: opt.method || 'GET', headers: opt.headers || {}, body: opt.body });
  if ((opt.method || 'GET') === 'GET') return { ok: true, status: 200, json: async () => (remoteRow ? [{ data: remoteRow }] : []) };
  return { ok: true, status: 201, json: async () => null };
};

['js/core/store.js', 'js/core/sync.js'].forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));

(async () => {
  Store.load(); Store.seed();
  Store.state.settings.ai = { provider: 'deepseek', key: 'sk-local-secret' };
  Store.state.settings.tavily = { key: 'tvly-local-secret' };
  Store.state.customers.push({ id: 'realcust1', name: '真实客户', updatedAt: Date.now() });
  Store.save();

  section('空间名长度');
  Sync.saveCfg({ mode: 'supabase', url: 'https://x.supabase.co', key: 'anon', table: 'sales_sync', space: 'default' });
  calls.length = 0;
  const r1 = await Sync.sync(true);
  check('空间名 default 同步失败', r1.ok === false && /16/.test(r1.msg || ''));
  check('失败时没有发出任何请求', calls.length === 0);

  section('请求头与整包内容');
  const SPACE = 'sp-0123456789abcdef0123';
  Sync.saveCfg({ space: SPACE });
  calls.length = 0;
  const r2 = await Sync.sync(true);
  check('合规空间名同步成功', r2.ok === true);
  check('拉取与推送都带 x-sync-space', calls.length >= 2 && calls.every(c => c.headers['x-sync-space'] === SPACE));
  const push = calls.find(c => c.method === 'POST');
  const body = push ? JSON.parse(push.body) : {};
  const txt = push ? push.body : '';
  check('推送行 id 等于空间名', body.id === SPACE);
  check('整包不含 AI Key', !/sk-local-secret/.test(txt));
  check('整包不含 Tavily Key', !/tvly-local-secret/.test(txt));
  check('整包不含同步配置（anon key/空间名）', !(body.data && body.data.settings && body.data.settings.sync));
  check('业务数据照常上传', /真实客户/.test(txt));
  check('本机 Key 没被剔除逻辑改动', Store.state.settings.ai.key === 'sk-local-secret');

  section('采纳云端设置时保留本机 Key');
  remoteRow = JSON.parse(JSON.stringify(body.data));
  remoteRow.settings.updatedAt = Date.now() + 60000;
  remoteRow.settings.monthlyTarget = 123456;
  await Sync.sync(true);
  check('云端较新的设置被采纳', Number(Store.state.settings.monthlyTarget) === 123456);
  check('本机 AI Key 保留', Store.state.settings.ai.key === 'sk-local-secret');
  check('本机 Tavily Key 保留', Store.state.settings.tavily.key === 'tvly-local-secret');
  check('本机同步配置保留', Store.state.settings.sync && Store.state.settings.sync.space === SPACE);

  Sync.stop && Sync.stop();
  /* CodeRabbit PR #21/#22：弱空间名 */
if (typeof Sync !== 'undefined' && Sync.weakSpace) {
  check('aaaaaaaaaaaaaaaa 判为弱', Sync.weakSpace('aaaaaaaaaaaaaaaa'));
  check('1234567812345678 判为弱（重复序列）', Sync.weakSpace('1234567812345678'));
  check('末尾不完整的重复序列判为弱（abcdabcdabcdabcdab）', Sync.weakSpace('abcdefghabcdefghabc'));
  check('随机生成的空间名不弱', !Sync.weakSpace('sp-3f9a1c7e5b2d8a4f6e0c9b1d'));
}
console.log('\n' + (fail === 0 ? 'ALL SYNC TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
