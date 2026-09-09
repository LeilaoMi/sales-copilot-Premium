/* ============================================================
 * 销冠助手 · 固化测试（node tools/test.js 一键全跑）
 *
 * 为什么要有这个文件：armory/parseSession/intel 上线前用的是
 * 一次性临时脚本，跑完就删——同样的「Playbook.search 签名用错」
 * 在测试脚本里发现并修了，生产代码里的同款错误却漏掉了，
 * 直到交叉审查才被抓出来。教训：测试必须固化、可重复，
 * 并且要把「生产调用点」本身也测进去。
 *
 * 无框架零依赖：全是 stub 环境 + 断言，node 直接跑。
 * 覆盖：ai.js（intel/parseSession/advise）、armory.js×playbook.js
 * 联合检索、digest 桶对齐（toNote 消费 AI 版结构）。
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

/* ---------- 公共 stub 环境 ---------- */
global.window = {};
global.document = {
  addEventListener: () => {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, setAttribute: () => {}, remove: () => {} }),
  body: { appendChild: () => {} }
};
let scriptRows = [];   // 模拟 scripts 表
global.Store = {
  state: { settings: {} },
  save() {},
  get: () => null,
  list: (t) => (t === 'scripts' ? scriptRows : []),
  insert: (t, o) => { const r = { id: 'n' + scriptRows.length, ...o }; scriptRows.push(r); return r; },
  customerMeta: () => ({ dealCount: 0, openAmount: 0, wonAmount: 0 }),
  fmtDateTime: () => '2026-09-09 12:00', fmtDate: () => '2026-09-09',
  moneyFull: v => String(v), stageOf: () => ({ name: '' }),
  stats: () => ({ rate: 0 }), sum: () => 0, customerName: () => '',
  escapeHtml: s => String(s == null ? '' : s),
  addDays: (d, n) => d, isPersistent: () => true,
};
global.navigator = {};
global.window.UI = { toast: () => {} };

/* fetch mock：kb 数据读本地文件，其余拒绝 */
global.fetch = (url) => new Promise((res, rej) => {
  if (url === 'kb/knowledge.json') {
    res({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, 'kb', 'knowledge.json'), 'utf8')) });
  } else rej(new Error('unexpected fetch: ' + url));
});

/* LLM fetch mock：返回预设内容 */
let llmReply = '';
function mockLLM() {
  global.fetch = (url) => {
    if (url === 'kb/knowledge.json') {
      return Promise.resolve({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(root, 'kb', 'knowledge.json'), 'utf8')) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { content: llmReply } }] }) });
  };
}

/* ---------- 加载被测模块（顺序同 index.html）---------- */
require(path.join(root, 'js/features/playbook.js'));
require(path.join(root, 'js/features/armory.js'));
require(path.join(root, 'js/features/digest.js'));
require(path.join(root, 'js/features/ai.js'));
const Playbook = global.window.Playbook;
const Armory = global.window.Armory;
const Digest = global.window.Digest;
const AI = global.window.AI;
/* ai.js 里的裸 Playbook 在浏览器是全局变量（window 即全局），
 * node 里必须显式挂到 global 才能被解析到——否则 typeof 检查
 * 恒为 false，advise 分支静默拿不到话术，测了个寂寞 */
global.Playbook = Playbook;

(async () => {
  /* ========== 1. buildPrompt：intel 场景 webCtx 双态 ========== */
  section('buildPrompt / intel');
  const p1 = AI.buildPrompt('intel', null, '', '【联网情报】测试ABC');
  check('webCtx 注入搜索结果', p1.includes('【联网情报】测试ABC'));
  check('有情报时用联网版规则', p1.includes('优先引用它') && !p1.includes('你没有联网'));
  const p2 = AI.buildPrompt('intel', null, '', '');
  check('无情报时保留降级模式', p2.includes('你没有联网') && p2.includes('待核实'));
  check('followup 不受 webCtx 影响', !AI.buildPrompt('followup', null, '', '【不应出现】').includes('【不应出现】'));

  /* ========== 2. advise 场景（P0 回归：search 签名+字段） ========== */
  section('buildPrompt / advise（P0 回归）');
  scriptRows = Playbook.defaultScripts();
  const pa = AI.buildPrompt('advise', null, '客户嫌贵还想砍价', '');
  check('advise 不抛异常且含话术素材标题', pa.includes('本地话术库') && /太贵了|砍价/.test(pa));
  check('advise 引用到 s.content 正文', /\[1\]/.test(pa) && pa.length > 600);
  scriptRows = [];

  /* ========== 3. parseSession ========== */
  section('parseSession');
  AI.saveCfg({ key: 'sk-test', provider: 'deepseek' });
  mockLLM();
  llmReply = JSON.stringify({
    summary: '聊了报价，客户嫌贵', mine: ['周三前发参数表'],
    theirs: [{ text: '下周三给答复', at: '2026-09-16' }],
    objections: [{ kind: '价格', text: '比XX贵20%' }],
    nextSteps: [{ text: '发参数表', at: '' }],
    asks: ['等客户内部报价'], replySuggestion: '理解您的顾虑。'
  });
  const r = await AI.parseSession('我：报价发您了\n客户：比XX贵20%');
  check('标准解析：桶结构齐全', r.mine.length === 1 && r.theirs[0].at === '2026-09-16' && r.objections[0].kind === '价格');
  check('标准解析：asks 与建议回复', r.asks.length === 1 && r.replySuggestion.includes('顾虑'));
  llmReply = '```json\n{"summary":"s","mine":["a"],"theirs":[],"objections":["嫌贵"],"nextSteps":[],"asks":[],"replySuggestion":"r"}\n```';
  check('剥壳：```json 包装', (await AI.parseSession('x')).summary === 's');
  llmReply = '我不会回答这个问题';
  let threw = '';
  try { await AI.parseSession('x'); } catch (e) { threw = e.message; }
  check('非 JSON 报中文错', /没有返回 JSON/.test(threw));

  /* ========== 4. digest 桶对齐（AI 结构 → toNote 消费） ========== */
  section('digest 桶对齐');
  const note = Digest.toNote(r);
  check('toNote 消费 AI 版结构：摘要', note.includes('嫌贵'));
  check('toNote：等客户反馈段', note.includes('等客户反馈') && note.includes('内部报价'));
  check('toNote：客户承诺段带时间', note.includes('下周三给答复') && note.includes('2026-09-16'));

  /* ========== 5. armory × playbook 联合检索 ========== */
  section('armory 联合检索');
  check('初始未加载', Armory.ready() === false);
  await new Promise(rs => { Armory.load(); setTimeout(rs, 300); });
  check('加载后就绪', Armory.ready() === true);
  const hits = Armory.search('客户嫌贵还想砍价');
  check('搜索有结果且 why 为字符串', hits.length > 0 && typeof hits[0].why === 'string');
  scriptRows = Playbook.defaultScripts();
  check('Playbook 主话术库检索正常', Playbook.search(scriptRows, '太贵了', { limit: 3 }).length > 0);

  /* ========== 6. 汇总 ========== */
  console.log('\n' + (fail === 0 ? 'ALL TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
