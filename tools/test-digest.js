/* ============================================================
 * 销冠助手 · 会话情报（规则版）回归测试（node tools/test-digest.js）
 *
 * 守住 2026-11-04 审计 m2：
 *   - asks（等客户反馈）分支走不到，我请客户做的事被记成「客户承诺」
 *   - 「时间：下周五」「总结：…」这类字段标签被当成说话人（「总结」带「总」字还被当成客户方的人）
 *   - 「来公司签字」「合同已签字」触发「还没到决策人」误报
 *   - 「3月」「2026年」被计入数量
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
['js/features/playbook.js', 'js/core/store.js', 'js/features/quicklog.js', 'js/features/digest.js']
  .forEach(f => (0, eval)(fs.readFileSync(path.join(root, f), 'utf8')));
Store.load();

const ctx = { me: ['我'], them: ['王总'], now: new Date(2026, 10, 4, 10) };
const A = t => Digest.analyze(t, ctx);
const texts = arr => arr.map(x => x.text);

console.log('— 等客户反馈');
let r = A('我：您那边能不能先安排一下试用环境，明天给我个答复');
check('我请客户做的事进 asks', texts(r.asks).some(x => x.includes('试用环境')), texts(r.asks));
check('…不算客户承诺', !texts(r.theirs).some(x => x.includes('试用环境')), texts(r.theirs));
check('摘要提到等客户反馈', /等客户反馈/.test(r.summary), r.summary);
r = A('王总：我下周三把预算发您');
check('客户自己说要做的仍是客户承诺', texts(r.theirs).some(x => x.includes('预算')), texts(r.theirs));
r = A('我：方案我明天发您');
check('我的承诺仍是我的', texts(r.mine).some(x => x.includes('方案')), texts(r.mine));

console.log('— 字段标签不是说话人');
r = A('总结：下周三我们发报价\n王总：好的');
check('「总结」不被当成客户方的人', r.people.indexOf('总结') < 0, r.people);
r = A('时间：下周五 10:00\n地点：恒力会议室');
check('「时间」「地点」不进人员', r.people.length === 0, r.people);

console.log('— 签字');
r = A('王总：合同已签字，下周五来公司拿');
check('「合同已签字」不报决策人风险', !r.risks.some(x => x.k === 'boss'), r.risks.map(x => x.k));
check('…也不算决策流程异议', !r.objections.some(o => (o.keys || []).indexOf('boss') >= 0), r.objections);
r = A('王总：下周五 10:00 来公司签字');
check('「来公司签字」不报决策人风险', !r.risks.some(x => x.k === 'boss'), r.risks.map(x => x.k));
r = A('王总：我得跟老板汇报一下');
check('「跟老板汇报」仍报决策人风险', r.risks.some(x => x.k === 'boss'));
r = A('王总：还要等董事长签字');
check('「等董事长签字」仍报决策人风险', r.risks.some(x => x.k === 'boss'));

console.log('— 数量');
r = A('王总：我们3月上线，2026年预算50万，签3年合同，需要20个账号，周期6个月');
const cs = r.counts.map(c => c.num + c.unit);
check('「3月」不算数量', cs.indexOf('3月') < 0, cs);
check('「2026年」不算数量', cs.indexOf('2026年') < 0, cs);
check('「3年」「20个」「6个月」仍算', cs.indexOf('3年') >= 0 && cs.indexOf('20个') >= 0 && cs.indexOf('6个月') >= 0, cs);

console.log('\n' + (fail === 0 ? 'ALL DIGEST TESTS PASSED' : 'FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
