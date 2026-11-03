/* ============================================================
 * 销冠助手 · 一句话录入回归测试（node tools/test-quicklog.js）
 *
 * 守住 2026-11-04 审计 m1 复现的误判：
 *   - 「方案发过去了」里的「去了」被判成拜访
 *   - 「三天后」「两周后」这类中文数字不识别
 *   - 裸「跟进了一下…客户说下周五给答复」把客户的时间点设成了我的下次跟进
 *   - 「今天去了趟上海」命中「上海华通物流」（地名前缀当简称）
 *   - 「月底」「下周再联系」不解析
 * 基准时间固定为 2026-11-04（周三）上午，与系统时钟无关。
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
['js/features/playbook.js', 'js/core/store.js', 'js/features/quicklog.js']
  .forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));
Store.load();
Store.seed();
Store.insert('customers', { name: '上海华通物流', contact: '李强', level: 'B' });

const now = new Date(2026, 10, 4, 10, 0, 0);   // 本地 2026-11-04 周三
const P = s => QuickLog.parse(s, now);
const D = s => QuickLog.parseDate(s, now);

console.log('— 跟进方式');
check('「方案发过去了」不是拜访', P('方案发过去了，陈总说不错').type !== '拜访', P('方案发过去了，陈总说不错').type);
check('「资料寄回去了」不是拜访', P('资料寄回去了').type !== '拜访');
check('「今天去了恒力」仍是拜访', P('今天去了恒力，聊了排产').type === '拜访');
check('「去了一趟优鲜」仍是拜访', P('去了一趟优鲜').type === '拜访');

console.log('— 中文数字');
check('三天后 = 11-07', D('三天后') === '2026-11-07', D('三天后'));
check('两周后 = 11-18', D('两周后') === '2026-11-18', D('两周后'));
check('十五天内 = 11-19', D('十五天内') === '2026-11-19', D('十五天内'));
check('二十天后 = 11-24', D('二十天后') === '2026-11-24', D('二十天后'));
check('「三天后再联系恒力王总」设下次跟进', P('三天后再联系恒力王总').nextAt === '2026-11-07', P('三天后再联系恒力王总').nextAt);
check('阿拉伯数字照旧：2周后 = 11-18', D('2周后') === '2026-11-18');

console.log('— 意图词');
const p1 = P('跟进了一下优鲜的报价，客户说下周五给答复');
check('「跟进了一下…客户说下周五」不设我的下次跟进', p1.nextAt === '', p1.nextAt);
check('「下周三跟进」仍设下次跟进', P('优鲜下周三跟进').nextAt === '2026-11-11', P('优鲜下周三跟进').nextAt);
check('「后续再约」仍是意图', P('后续再约王总，下下周二').nextAt === '2026-11-17', P('后续再约王总，下下周二').nextAt);
check('「下次周一再联系」不回退到今天', P('今天跟恒力王总聊了，下次周一再联系').nextAt === '2026-11-09');

console.log('— 客户匹配');
const p2 = P('今天去了趟上海，见了个新客户');
check('「去了趟上海」不命中上海华通物流', p2.customerId === '', p2.customerName);
check('「华通」仍能命中上海华通物流', P('华通李强那边打了电话').customerName === '上海华通物流', P('华通李强那边打了电话').customerName);
check('「上海华通」仍能命中', P('上海华通开会').customerName === '上海华通物流');
check('简称照旧：「恒力」命中恒力精工制造', P('恒力打了电话').customerName === '恒力精工制造');

console.log('— 月底 / 下周 / 下个月');
check('月底 = 11-30', D('月底') === '2026-11-30', D('月底'));
check('下个月底 = 12-31', D('下个月底') === '2026-12-31', D('下个月底'));
check('下月初 = 12-01', D('下月初') === '2026-12-01', D('下月初'));
check('下周（没说周几）= 下周一 11-09', D('下周') === '2026-11-09', D('下周'));
check('下周三照旧 = 11-11', D('下周三') === '2026-11-11');
check('下下周二照旧 = 11-17', D('下下周二') === '2026-11-17');
check('下个月 = 12-04', D('下个月') === '2026-12-04', D('下个月'));
check('1 月 31 日 +1 个月夹到 2 月底', QuickLog.parseDate('1个月后', new Date(2027, 0, 31, 9)) === '2027-02-28', QuickLog.parseDate('1个月后', new Date(2027, 0, 31, 9)));
check('「下周再联系顺达吴总」设下次跟进 11-09', P('下周再联系顺达吴总').nextAt === '2026-11-09', P('下周再联系顺达吴总').nextAt);
check('「月底再联系」设下次跟进 11-30', P('给马主任打了电话，月底再联系').nextAt === '2026-11-30');

console.log('\n' + (fail === 0 ? 'ALL QUICKLOG TESTS PASSED' : 'FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
