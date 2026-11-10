/* ============================================================
 * 销冠助手 · 健康度回归测试（node tools/test-health.js）
 *
 * 守住 2026-11-04 审计 m3：健康度缓存以前只认「全库最大 updatedAt」，
 * 同步拉下一条比本地都旧的记录、或 purge 清掉墓碑后最大值不变，缓存不失效，
 * 看板继续显示过期的沉默天数和风险等级。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

let fail = 0;
function check(name, cond, got) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond || got === undefined ? '' : '  → ' + JSON.stringify(got))); if (!cond) fail++; }

const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.window = global; global.self = global;
global.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
global.addEventListener = () => {};
['js/features/playbook.js', 'js/core/store.js', 'js/features/health.js']
  // biome-ignore lint/security/noGlobalEval: 测试脚本用 eval 加载浏览器端源码
  .forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));
Store.load();

const DAY = 864e5, now = Date.now();
const c = Store.insert('customers', { name: '测试客户', level: 'A' });
const d = Store.insert('deals', {
  customerId: c.id, title: '单', amount: 1e5, stage: 'contact',
  createdAt: new Date(now - 60 * DAY).toISOString(),
  stageHistory: [{ stage: 'contact', at: now - 60 * DAY }]
});
const sig = h => [h.level, h.score, (h.reasons || []).map(r => r.text || r).join('|')].join('#');

console.log('— m3 缓存失效');
const h1 = sig(Health.of(Store.get('deals', d.id)));
/* 同步拉下另一台设备的一条跟进：updatedAt 比本地都旧，但 at 是昨天 */
Store.state.followups.push({ id: 'f-remote', customerId: c.id, type: '电话', at: new Date(now - DAY).toISOString(), content: '聊了', updatedAt: 1 });
Store.save();
const h2 = sig(Health.of(Store.get('deals', d.id)));
check('拉下较旧的跟进后健康度重新计算', h1 !== h2, [h1, h2]);

/* purge：删掉跟进（墓碑）后再压缩，最大 updatedAt 可能不变 */
Store.remove ? Store.remove('followups', 'f-remote') : (Store.state.followups[0].deleted = true);
Store.save();
const h3 = sig(Health.of(Store.get('deals', d.id)));
check('删除跟进后健康度回到原状', h3 === h1, [h1, h3]);

check('Store.generation() 随保存递增', (() => { const g = Store.generation(); Store.save(); return Store.generation() > g; })());

console.log('\n' + (fail === 0 ? 'ALL HEALTH TESTS PASSED' : 'FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
