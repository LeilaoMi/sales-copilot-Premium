/* ============================================================
 * 销冠助手 · Minor 批回归测试（node tools/test-minor.js）
 *
 * 2026-11-04 审计 Minor 批，一处一组：
 *   m4  内置话术与「载入示例」「清空」都留墓碑，不被同步拉回
 *   m6  赢单缺成交日期不计入本月
 *   m7  压缩数据只清 30 天前的墓碑；两份合并实现都不再拉回过期墓碑
 *   m8  令牌不再走 ?token=；固定令牌恒定时间比较
 *   m9  浏览器 sync.js 与 sync-core.js 两份合并对同一组用例结果一致
 *   m13 Azure OpenAI 用 api-key 头并带 api-version；请求有超时
 *   m24 健康度按商机算接触，不被同客户的其他商机带热
 *   m26 temperature 0 不被吞；陪练历史有上限；会话情报认「亿」并按元比大小；intentLabel 认 delivery
 *   CodeRabbit PR #21（2026-11-07）：非法日期不打挂看板、成交周期不从 1970 算、100euro、剩余天数含今天
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function section(t) { console.log('\n— ' + t); }
function check(name, cond, got) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond || got === undefined ? '' : '  → ' + JSON.stringify(got))); if (!cond) fail++; }

const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.window = global; global.self = global;
global.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
global.addEventListener = () => {};
// biome-ignore lint/security/noGlobalEval: 测试脚本用 eval 加载浏览器端源码
const load = f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8'));
['js/features/playbook.js', 'js/core/store.js', 'js/features/health.js', 'js/features/quicklog.js', 'js/features/digest.js'].forEach(load);
const S = Store;
S.load();
const DAY = 864e5;

(async () => {
  section('m4 墓碑');
  S.state.scripts.push({ id: 'old-builtin', title: '这是一条早就下架的旧版内置话术', builtin: true, content: 'x', updatedAt: 1 });
  S.migrate();
  const ob = S.state.scripts.find(x => x.id === 'old-builtin');
  check('旧版内置话术留墓碑而不是直接消失', !!ob && ob.deleted === true && ob.updatedAt > 1, ob);
  const real = S.insert('customers', { name: '真实客户甲' });
  S.seed(true);
  const t = S.state.customers.find(c => c.id === real.id);
  check('载入示例时真实客户留墓碑', !!t && t.deleted === true, t);
  check('示例客户已载入', S.list('customers').some(c => c.demo));
  S.reset(true);
  const mine = S.insert('scripts', { title: '我自己写的话术', content: 'y' });
  S.reset(false);
  const ms = S.state.scripts.find(x => x.id === mine.id);
  check('不保留话术清空时，自建话术留墓碑', !!ms && ms.deleted === true, ms);

  section('m6 赢单缺成交日期');
  S.reset(true);
  S.insert('deals', { customerId: 'c-x', title: '老数据赢单', amount: 50000, stage: 'won' });
  const st = S.stats();
  check('不计入本月成交额', (st.revenue || 0) === 0, st.revenue);

  section('m7 压缩数据');
  S.reset(true);
  S.state.customers.push({ id: 'tomb-old', deleted: true, updatedAt: Date.now() - 40 * DAY });
  S.state.customers.push({ id: 'tomb-new', deleted: true, updatedAt: Date.now() - 2 * DAY });
  S.purge();
  check('30 天前的墓碑清掉', !S.state.customers.some(c => c.id === 'tomb-old'));
  check('近期墓碑保留（还要同步给别的设备）', S.state.customers.some(c => c.id === 'tomb-new'));
  const CORE = require(path.join(root, 'js/core/sync-core.js'));
  const remote = { customers: [{ id: 'tomb-old', deleted: true, updatedAt: Date.now() - 40 * DAY }, { id: 'live', name: 'L', updatedAt: 5 }], deals: [], followups: [], scripts: [] };
  const local = { customers: S.state.customers.slice(), deals: [], followups: [], scripts: [] };
  const m1 = CORE.merge(local, remote);
  check('sync-core：本地没有的过期墓碑不拉回', !m1.customers.some(c => c.id === 'tomb-old'));
  check('sync-core：正常记录照常合并', m1.customers.some(c => c.id === 'live'));
  load('js/core/sync.js');
  const m2 = Sync.merge(local, remote);
  check('浏览器 sync.js：同样不拉回', !m2.customers.some(c => c.id === 'tomb-old'));
  const localLive = { customers: [{ id: 'tomb-old', name: '离线设备上还活着', updatedAt: 1 }], deals: [], followups: [], scripts: [] };
  check('本地还活着时，旧墓碑照样生效（不复活）', CORE.merge(localLive, remote).customers.find(c => c.id === 'tomb-old').deleted === true);

  section('m9 两份合并实现一致');
  const cases = [
    [{ customers: [{ id: 'a', v: 1, updatedAt: 1 }] }, { customers: [{ id: 'a', v: 2, updatedAt: 2 }] }],
    [{ customers: [{ id: 'a', v: 1, updatedAt: 3 }] }, { customers: [{ id: 'a', v: 2, updatedAt: 2 }] }],
    [{ customers: [{ id: 'a', v: 1, updatedAt: 2 }] }, { customers: [{ id: 'a', v: 2, updatedAt: 2 }] }],
    [{ customers: [] }, { customers: [{ id: 'b', deleted: true, updatedAt: 10 }] }],
    [{ customers: [{ id: 'b', v: 1, updatedAt: 1 }] }, { customers: [{ id: 'b', deleted: true, updatedAt: 10 }] }]
  ].map(([a, b]) => [Object.assign({ deals: [], followups: [], scripts: [] }, a), Object.assign({ deals: [], followups: [], scripts: [] }, b)]);
  const norm = o => JSON.stringify(['customers', 'deals', 'followups', 'scripts'].map(k => (o[k] || []).slice().sort((x, y) => (x.id < y.id ? -1 : 1))));
  check('同一组用例结果一致', cases.every(([a, b]) => norm(CORE.merge(a, b)) === norm(Sync.merge(a, b))));

  section('m8 令牌');
  check('不再从 ?token= 取令牌', CORE.tokenOf({ headers: {}, url: '/api/sync?token=abcdefghijklmnopqrst' }) === '');
  check('请求头照常', CORE.tokenOf({ headers: { 'x-sync-token': 'abcdefghijklmnop' }, url: '/' }) === 'abcdefghijklmnop');
  check('固定令牌：相同通过', CORE.authOk({ headers: { 'x-sync-token': 'fixed-token-1234567' } }, 'fixed-token-1234567') === true);
  check('固定令牌：前缀不通过', CORE.authOk({ headers: { 'x-sync-token': 'fixed-token-123456' } }, 'fixed-token-1234567') === false);
  check('固定令牌：同长不同不通过', CORE.authOk({ headers: { 'x-sync-token': 'fixed-token-1234568' } }, 'fixed-token-1234567') === false);

  section('m13 / m26 AI 请求');
  global.Playbook = window.Playbook;
  load('js/features/ai.js');
  let last = null;
  global.fetch = async (url, opts) => { last = { url, opts, body: JSON.parse(opts.body || '{}') }; return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }; };
  S.state.settings.ai = { provider: 'azure', base: 'https://res1.openai.azure.com/openai/deployments/gpt4o', key: 'k-azure', model: 'gpt-4o' };
  await AI.ask('hi', { temperature: 0 });
  check('Azure 用 api-key 头', last.opts.headers['api-key'] === 'k-azure' && !last.opts.headers.Authorization, last.opts.headers);
  check('Azure 地址带 api-version', /\/chat\/completions\?api-version=/.test(last.url), last.url);
  check('temperature 0 不被吞成 0.7', last.body.temperature === 0, last.body.temperature);
  check('请求带超时信号', !!last.opts.signal);
  S.state.settings.ai = { provider: 'deepseek', key: 'k-ds', model: 'deepseek-chat' };
  await AI.ask('hi');
  check('其他服务商仍用 Bearer', last.opts.headers.Authorization === 'Bearer k-ds');
  const hist = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: '第' + i + '轮 ' + 'x'.repeat(300) }));
  await AI.chat(hist, {});
  check('陪练历史有上限（200 轮只发最近的）', last.body.messages.length <= 25, last.body.messages.length);
  check('最近一轮一定在', last.body.messages[last.body.messages.length - 1].content.startsWith('第199轮'));
  global.fetch = (url, opts) => new Promise((res, rej) => { opts.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); });
  const realST = global.setTimeout;
  global.setTimeout = (fn, ms) => realST(fn, Math.min(ms, 20));
  let msg = '';
  try { await AI.ask('hi'); } catch (e) { msg = e.message; }
  global.setTimeout = realST;
  check('卡住的请求会超时并报中文', /超时/.test(msg), msg);

  section('m26 会话情报金额 / 意图名');
  const r = Digest.analyze('王总：首期 3000 元，整体预算 1.2亿，二期 50万', { me: ['我'], them: ['王总'], now: new Date(2026, 10, 4) });
  check('识别「亿」', r.money.some(m => m.unit === '亿'), r.money.map(m => m.num + m.unit));
  check('摘要按折算后的金额取最大（1.2亿）', /1\.2亿/.test(r.summary), r.summary);
  check('intentLabel 认 delivery', Playbook.intentLabel(['delivery']) !== 'delivery', Playbook.intentLabel(['delivery']));

  section('m24 健康度按商机算');
  S.reset(true);
  const c = S.insert('customers', { name: '双单客户', level: 'A' });
  const old = Date.now() - 60 * DAY;
  const dHot = S.insert('deals', { customerId: c.id, title: '热单', amount: 1, stage: 'contact', createdAt: new Date(old).toISOString(), stageHistory: [{ stage: 'contact', at: old }] });
  const dCold = S.insert('deals', { customerId: c.id, title: '冷单', amount: 1, stage: 'contact', createdAt: new Date(old).toISOString(), stageHistory: [{ stage: 'contact', at: old }] });
  S.insert('followups', { customerId: c.id, dealId: dHot.id, type: '电话', at: new Date(Date.now() - DAY).toISOString(), content: '聊热单' });
  const hHot = Health.of(S.get('deals', dHot.id)), hCold = Health.of(S.get('deals', dCold.id));
  check('只给热单记的跟进，不让冷单也「刚联系过」', hCold.score < hHot.score, [hHot.level, hHot.score, hCold.level, hCold.score]);

  section('CodeRabbit PR #21');
  check('diffDays 对非法日期返回 null 而不是抛错', (() => { try { return S.diffDays('abc') === null; } catch (e) { return false; } })());
  check('daysBetween 任一端非法返回 null', S.daysBetween('abc', '2026-11-01') === null);
  S.reset(true);
  const bc = S.insert('customers', { name: '坏日期客户', nextFollowAt: 'not-a-date' });
  S.insert('deals', { customerId: bc.id, title: '坏日期单', amount: 100, stage: 'quote', expectedClose: '明天吧' });
  S.insert('deals', { customerId: bc.id, title: '坏创建日赢单', amount: 100, stage: 'won', createdAt: 'garbage', closedAt: new Date().toISOString() });
  S.insert('deals', { customerId: bc.id, title: '正常赢单', amount: 100, stage: 'won', createdAt: new Date(Date.now() - 10 * DAY).toISOString(), closedAt: new Date().toISOString() });
  let st2 = null, e2 = null;
  try { st2 = S.stats(); } catch (e) { e2 = e; }
  check('有非法日期时 stats() 照常出结果', !e2 && !!st2, e2 && e2.message);
  const cyc = st2 && (st2.avgCycle != null ? st2.avgCycle : null);
  check('成交周期跳过非法 createdAt（只算正常那单约 10 天）', cyc >= 9 && cyc <= 11, cyc);
  const eu = Digest.analyze('王总：首期 100euro', { me: ['我'], them: ['王总'], now: new Date(2026, 10, 4) });
  check('识别「100euro」（无空格）', eu.money.some(m => m.num === 100 && /euro/.test(m.unit)), eu.money.map(m => m.num + m.unit));
  const viewsSrc = fs.readFileSync(path.join(root, 'js/ui/views.js'), 'utf8');
  const storeSrc = fs.readFileSync(path.join(root, 'js/core/store.js'), 'utf8');
  check('晨报「本月剩 N 天」含今天', /本月剩 \$\{f\.left \+ 1\} 天/.test(viewsSrc));
  check('目标建议两档都按含今天说', (storeSrc.match(/本月剩 \$\{left \+ 1\} 天（含今天）/g) || []).length === 2);

  console.log('\n' + (fail === 0 ? 'ALL MINOR TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})();
