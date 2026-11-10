/* ============================================================
 * 销冠助手 · 时区回归测试（node tools/test-tz.js）
 *
 * 守住 2026-11-04 审计 M12：日期处理混用 UTC 与本地时间。
 *   - new Date('YYYY-MM-DD') 按 UTC 解析 → UTC− 时区「明天」= 今天、今天算逾期
 *   - ISO 时刻字符串 slice(0,10/7) 取的是 UTC 日期 → 北京 0–8 点的跟进 / 成交
 *     被算进前一天、上周、上个月
 * 同一组断言在三个时区各跑一遍（子进程设 TZ），哪个时区错了一目了然。
 * 顺带守住：界面新建记录时 updatedAt 必须是数字（以前是 ISO 字符串，合并时被当成 0）。
 * ============================================================ */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');

if (!process.env.__TZ_CHILD) {
  let fail = 0;
  for (const tz of ['America/Los_Angeles', 'Asia/Shanghai', 'Pacific/Kiritimati']) {
    const r = spawnSync(process.execPath, [__filename], { env: Object.assign({}, process.env, { TZ: tz, __TZ_CHILD: '1' }), encoding: 'utf8' });
    console.log('\n== TZ=' + tz + ' ==\n' + r.stdout.trim() + (r.stderr ? '\n' + r.stderr : ''));
    if (r.status !== 0) fail++;
  }
  console.log('\n' + (fail === 0 ? 'ALL TZ TESTS PASSED' : 'FAILURES IN ' + fail + ' TIMEZONE(S)'));
  process.exit(fail === 0 ? 0 : 1);
}

let fail = 0;
function check(name, cond) { console.log((cond ? 'PASS' : 'FAIL') + '  ' + name); if (!cond) fail++; }

const mem = {};
global.localStorage = { getItem: k => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
global.window = global; global.self = global;
global.document = { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } };
global.addEventListener = () => {};
['js/features/playbook.js', 'js/core/store.js', 'js/features/quicklog.js', 'js/features/report.js', 'js/core/team.js']
  // biome-ignore lint/security/noGlobalEval: 测试脚本用 eval 加载浏览器端源码
  .forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));
Store.load();

const S = Store;
check("addDays('2026-11-04', 1) = 2026-11-05", S.addDays('2026-11-04', 1) === '2026-11-05');
check("fmtDate('2026-11-04') 原样", S.fmtDate('2026-11-04') === '2026-11-04');
check("monthKey('2026-11-01') = 2026-11", S.monthKey('2026-11-01') === '2026-11');
check('diffDays(今天) = 0', S.diffDays(S.todayStr()) === 0);
check('diffDays(明天) = 1', S.diffDays(S.addDays(S.todayStr(), 1)) === 1);
check("daysBetween('2026-11-01','2026-11-04') = 3", S.daysBetween('2026-11-01', '2026-11-04') === 3);
check('速记「明天」解析为本地明天', QuickLog.parseDate('明天', new Date(2026, 10, 4, 12)) === '2026-11-05');

/* 本地 2026-11-04 00:30 发生的跟进：存的是 UTC ISO 串 */
const localEarly = new Date(2026, 10, 4, 0, 30).toISOString();
check('周报 dayOf 取本地日期（本地 0:30 的跟进算 11-04）', Report.dayOf(localEarly) === '2026-11-04');

/* 本地 11 月 1 日 00:30 成交：应算进 11 月，不是 10 月 */
const wonAt = new Date(2026, 10, 1, 0, 30).toISOString();
const agg = (() => {
  /* 团队看板按「本月」统计：把本月钉在 2026-11 */
  const orig = Date.now; const fixed = new Date(2026, 10, 15, 12).getTime();
  const RD = Date; global.Date = class extends RD { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } };
  try {
    return Team.aggregate([
      { user_id: 'u1', kind: 'deals', id: 'd1', data: { stage: 'won', amount: 100, closedAt: wonAt } },
      { user_id: 'u1', kind: 'followups', id: 'f1', data: { at: localEarly } }
    ], [{ id: 'u1', role: 'member', display_name: 'A' }]);
  } finally { global.Date = RD; }
})();
const u = (agg && agg.rows && agg.rows[0]) || {};
check('团队看板：本地 11/1 凌晨的成交算进 11 月', u.wonThisMonth === 1);
check('团队看板：最近跟进日是本地日期', u.lastFollowAt === '2026-11-04');

/* updatedAt 必须是数字 */
const d = S.insert('deals', { title: 't', customerId: '', updatedAt: new Date().toISOString() });
check('insert 传入 ISO 字符串 updatedAt 被改成数字', typeof d.updatedAt === 'number');
S.state.deals.push({ id: 'legacy1', title: 'x', updatedAt: '2026-11-01T00:00:00.000Z' });
S.migrate();
check('migrate 把旧的 ISO 字符串 updatedAt 换算成毫秒', S.state.deals.find(x => x.id === 'legacy1').updatedAt === Date.parse('2026-11-01T00:00:00.000Z'));

process.exit(fail === 0 ? 0 : 1);
