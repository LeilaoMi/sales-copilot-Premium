/* ============================================================
 * 销冠助手 · 自托管同步服务回归测试（node tools/test-server.js）
 *
 * 守住 2026-11-04 审计里实测复现过的三个服务端问题：
 *   C2  畸形百分号编码的 URL 让 decodeURIComponent 抛错，进程退出；
 *   C3  请求体逐块转字符串，汉字被分包切开后落盘成 U+FFFD；
 *   C4  集合字段不是数组时 merge 抛错，进程退出；
 *   M3  页面响应缺少 CSP / 防嵌套头。
 *
 * 零依赖：把 server.js 和 sync-core.js 复制到临时目录里起服务，
 * 不会往仓库的 data/ 写任何东西。
 * ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const CORE = require(path.join(root, 'js/core/sync-core.js'));

let fail = 0;
function check(name, cond) {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + name);
  if (!cond) fail++;
}
function section(name) { console.log('\n== ' + name + ' =='); }

function request(port, method, p, body, headers) {
  return new Promise(resolve => {
    const req = http.request({ host: '127.0.0.1', port: port, method: method, path: p, headers: headers || {}, agent: false }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message }));
    if (body) {
      /* 故意按 1 字节一块发出去，保证每个汉字都被切开 —— 正是 C3 的触发条件 */
      const buf = Buffer.from(body, 'utf8');
      let i = 0;
      (function next() {
        if (i >= buf.length) return req.end();
        const n = Math.min(4096, buf.length - i);
        for (let j = 0; j < n; j++) req.write(buf.subarray(i + j, i + j + 1));
        i += n;
        setImmediate(next);
      })();
    } else {
      req.end();
    }
  });
}

(async () => {
  /* ========== 1. sync-core.validate 单元测试 ========== */
  section('sync-core.validate');
  check('正常快照通过', CORE.validate({ customers: [{ id: 'abc123', updatedAt: 1 }], settings: {} }) === null);
  check('集合缺省视为空', CORE.validate({}) === null);
  check('customers 为字符串被拒', !!CORE.validate({ customers: 'x' }));
  check('记录不是对象被拒', !!CORE.validate({ deals: [1] }));
  check('id 含引号被拒（防属性注入）', !!CORE.validate({ followups: [{ id: 'a" onmouseover="x' }] }));
  check('updatedAt 非数字被拒', !!CORE.validate({ scripts: [{ id: 'a', updatedAt: 'abc' }] }));
  check('settings 为数组被拒', !!CORE.validate({ settings: [] }));
  check('merge 遇到坏的历史数据不抛错', (() => {
    try { CORE.merge({ customers: 'x' }, { customers: [{ id: 'a', updatedAt: 1 }] }); return true; }
    catch (e) { return false; }
  })());

  /* M24：settings 按 updatedAt 取新，不再「推送方一律胜出」 */
  check('M24 陈旧设备推送的旧 settings 不覆盖云端新 settings', (() => {
    const m = CORE.merge({ settings: { goal: 'new', updatedAt: 200 } }, { settings: { goal: 'old', updatedAt: 100 } });
    return m.settings && m.settings.goal === 'new';
  })());
  check('M24 推送方 settings 更新时正常采纳', (() => {
    const m = CORE.merge({ settings: { goal: 'old', updatedAt: 100 } }, { settings: { goal: 'new', updatedAt: 200 } });
    return m.settings && m.settings.goal === 'new';
  })());
  check('M24 云端没有 settings 时采纳推送方的', (() => {
    const m = CORE.merge({}, { settings: { goal: 'x' } });
    return m.settings && m.settings.goal === 'x';
  })());

  /* ========== 2. 起服务 ========== */
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-server-'));
  fs.mkdirSync(path.join(tmp, 'server'));
  fs.mkdirSync(path.join(tmp, 'js/core'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/server.js'), path.join(tmp, 'server/server.js'));
  fs.copyFileSync(path.join(root, 'js/core/sync-core.js'), path.join(tmp, 'js/core/sync-core.js'));
  fs.writeFileSync(path.join(tmp, 'index.html'), '<!doctype html>ok');

  const port = 18000 + Math.floor(Math.random() * 1000);
  const token = 'regression-token-123456';
  const child = spawn(process.execPath, [path.join(tmp, 'server/server.js')], {
    env: Object.assign({}, process.env, { PORT: String(port), SYNC_TOKEN: token }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let exited = false, stderr = '', stdout = '';
  child.on('exit', () => { exited = true; });
  child.stderr.on('data', c => { stderr += c; });
  child.stdout.on('data', c => { stdout += c; });
  for (let i = 0; i < 50; i++) {
    const r = await request(port, 'GET', '/api/health');
    if (r.status === 200) break;
    await new Promise(rs => setTimeout(rs, 100));
  }
  const alive = async () => !exited && (await request(port, 'GET', '/api/health')).status === 200;
  const auth = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  try {
    /* ========== 3. C2 畸形 URL ========== */
    section('C2 畸形 URL');
    const r1 = await request(port, 'GET', '/%E0%A4%A');
    check('返回 400', r1.status === 400);
    check('进程仍存活', await alive());

    /* ========== 4. C4 畸形快照 ========== */
    section('C4 畸形快照');
    const r2 = await request(port, 'PUT', '/api/sync', JSON.stringify({ data: { customers: 'x' } }), auth);
    check('返回 400', r2.status === 400);
    check('进程仍存活', await alive());

    /* ========== 5. C3 中文分包 ========== */
    section('C3 中文分包');
    const customers = [];
    for (let i = 0; i < 3000; i++) {
      customers.push({ id: 'c' + i, name: '上海某某科技有限公司' + i, note: '客户说下周三再联系，预算大概八十万', updatedAt: 1000 + i });
    }
    const r3 = await request(port, 'PUT', '/api/sync', JSON.stringify({ data: { customers: customers } }), auth);
    check('推送成功', r3.status === 200);
    const got = await request(port, 'GET', '/api/sync', null, auth);
    const data = got.status === 200 ? JSON.parse(got.body).data : { customers: [] };
    const broken = (data.customers || []).filter(c => /\uFFFD/.test(JSON.stringify(c))).length;
    check('3000 条全部取回', (data.customers || []).length === 3000);
    check('没有一条出现 U+FFFD', broken === 0);
    const onDisk = fs.readdirSync(path.join(tmp, 'data')).filter(f => /^store-.*\.json$/.test(f))
      .map(f => fs.readFileSync(path.join(tmp, 'data', f), 'utf8')).join('');
    check('落盘文件里也没有 U+FFFD', onDisk.length > 0 && !/\uFFFD/.test(onDisk));

    /* ========== 5b. 页面安全头（审计 M3） ========== */
    section('页面安全头');
    const page = await new Promise(resolve => {
      http.get({ host: '127.0.0.1', port: port, path: '/', agent: false }, res => { res.resume(); resolve(res.headers); })
        .on('error', () => resolve({}));
    });
    const csp = page['content-security-policy'] || '';
    check('首页带 CSP', !!csp);
    check("CSP 禁止内联脚本（script-src 'self'，无 unsafe-inline）", /script-src 'self'(;|$)/.test(csp));
    check("CSP 禁止被嵌套（frame-ancestors 'none'）", /frame-ancestors 'none'/.test(csp));
    check('X-Frame-Options: DENY', page['x-frame-options'] === 'DENY');

    /* ========== 6. 超大请求体 ========== */
    section('8MB 上限');
    const big = JSON.stringify({ data: { customers: [{ id: 'x', note: 'a'.repeat(9 * 1024 * 1024) }] } });
    const r4 = await new Promise(resolve => {
      const req = http.request({ host: '127.0.0.1', port: port, method: 'PUT', path: '/api/sync', headers: auth, agent: false }, res => {
        res.resume(); res.on('end', () => resolve(res.statusCode));
      });
      req.on('error', () => resolve(-1));   // 服务端回完 413 后断开，写端报错是正常的
      req.end(big);
    });
    check('超限返回 413 或被断开，不再挂起', r4 === 413 || r4 === -1);
    check('进程仍存活', await alive());

    /* ========== 7. 落盘失败不能回 200（审计 M25） ========== */
    section('落盘失败');
    /* 服务以专属令牌模式启动，只有一个空间：用它的文件 */
    const f2 = path.join(tmp, 'data', 'store-' + CORE.spaceKey(token) + '.json');
    const before = fs.readFileSync(f2, 'utf8');
    fs.mkdirSync(f2 + '.tmp', { recursive: true });   // 临时文件位置被目录占住 → writeFileSync 必然失败
    const body2 = JSON.stringify({ data: { customers: [{ id: 'pf1', updatedAt: 1 }] } });
    const r5 = await request(port, 'PUT', '/api/sync', body2, auth);
    check('写盘失败返回 5xx（实得 ' + r5.status + '）', r5.status >= 500);
    const r6 = await request(port, 'GET', '/api/sync', null, auth);
    check('写盘失败后内存里也不留这次推送', r6.status === 200 && !r6.body.includes('"pf1"'));
    check('磁盘上的旧文件没被动', fs.readFileSync(f2, 'utf8') === before);
    fs.rmSync(f2 + '.tmp', { recursive: true, force: true });
    const r7 = await request(port, 'PUT', '/api/sync', body2, auth);
    check('磁盘恢复后推送成功并落盘', r7.status === 200 && fs.readFileSync(f2, 'utf8').includes('"pf1"'));
    check('进程仍存活', await alive());

    /* ========== M13 跨域预检放行前端必带的头 ========== */
    section('M13 CORS');
    const pre = await request(port, 'OPTIONS', '/api/sync', null, {
      'Origin': 'https://example.pages.dev', 'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'content-type,x-sync-token,x-device-id'
    });
    const allowH = String(pre.headers && pre.headers['access-control-allow-headers'] || '').toLowerCase();
    const allowM = String(pre.headers && pre.headers['access-control-allow-methods'] || '').toUpperCase();
    check('预检 204', pre.status === 204);
    check('放行 X-Sync-Token', allowH.includes('x-sync-token'));
    check('放行 X-Device-Id', allowH.includes('x-device-id'));
    check('不声明未实现的 POST', !/\bPOST\b/.test(allowM));

    /* ========== M16 固定令牌不进日志 ========== */
    section('M16 令牌');
    check('启动日志不打印固定令牌', !stdout.includes(token));
  } finally {
    child.kill();
  }

  /* ========== M16 占位符 / 过短令牌拒绝启动 ========== */
  async function exitCodeWith(tok) {
    const c = spawn(process.execPath, [path.join(tmp, 'server/server.js')], {
      env: Object.assign({}, process.env, { PORT: String(port + 1), SYNC_TOKEN: tok }), stdio: 'ignore'
    });
    return new Promise(rs => {
      const t = setTimeout(() => { c.kill(); rs('running'); }, 1500);
      c.on('exit', code => { clearTimeout(t); rs(code); });
    });
  }
  check('模板占位符令牌拒绝启动', (await exitCodeWith('change-me-to-a-long-random-string')) === 1);
  check('少于 16 位的令牌拒绝启动', (await exitCodeWith('short-token')) === 1);
  check('合格令牌正常启动', (await exitCodeWith('9f2c41d7ab03e6c58d1e')) === 'running');

  /* ========== M15 数据目录不可写时如实上报 ========== */
  section('M15 数据目录不可写');
  const ro = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-ro-'));
  fs.mkdirSync(path.join(ro, 'server')); fs.mkdirSync(path.join(ro, 'js/core'), { recursive: true });
  fs.copyFileSync(path.join(root, 'server/server.js'), path.join(ro, 'server/server.js'));
  fs.copyFileSync(path.join(root, 'js/core/sync-core.js'), path.join(ro, 'js/core/sync-core.js'));
  fs.mkdirSync(path.join(ro, 'data'));
  fs.chmodSync(path.join(ro, 'data'), 0o555);   // 目录存在但不可写：mkdir 不会报错
  const asRoot = process.getuid && process.getuid() === 0;
  if (asRoot) {
    console.log('SKIP  以 root 运行，目录权限不生效，跳过本节');
  } else {
    const p2 = port + 2;
    const c2 = spawn(process.execPath, [path.join(ro, 'server/server.js')], {
      env: Object.assign({}, process.env, { PORT: String(p2), SYNC_TOKEN: token, REQUIRE_DISK: '' }), stdio: 'ignore'
    });
    let h = null;
    for (let i = 0; i < 50 && !h; i++) {
      const r = await request(p2, 'GET', '/api/health');
      if (r.status === 200) h = JSON.parse(r.body); else await new Promise(rs => setTimeout(rs, 100));
    }
    c2.kill();
    check('健康检查如实报 storage:memory（实得 ' + (h && h.storage) + '）', !!h && h.storage === 'memory');
    const code = await new Promise(rs => {
      const c3 = spawn(process.execPath, [path.join(ro, 'server/server.js')], {
        env: Object.assign({}, process.env, { PORT: String(p2 + 1), SYNC_TOKEN: token, REQUIRE_DISK: '1' }), stdio: 'ignore'
      });
      const t = setTimeout(() => { c3.kill(); rs('running'); }, 1500);
      c3.on('exit', c => { clearTimeout(t); rs(c); });
    });
    check('REQUIRE_DISK=1 时拒绝启动', code === 1);
  }
  fs.chmodSync(path.join(ro, 'data'), 0o755);
  fs.rmSync(ro, { recursive: true, force: true });

  /* ========== m8 多人模式：GET 不占空间名额；不再接受 ?token= ========== */
  section('m8 空间名额与令牌');
  {
    const p4 = port + 5;
    const c4 = spawn(process.execPath, [path.join(tmp, 'server/server.js')], {
      env: Object.assign({}, process.env, { PORT: String(p4), SYNC_TOKEN: '', MAX_SPACES: '2' }), stdio: 'ignore'
    });
    for (let i = 0; i < 50; i++) { const r = await request(p4, 'GET', '/api/health'); if (r.status === 200) break; await new Promise(rs => setTimeout(rs, 100)); }
    for (let i = 0; i < 5; i++) await request(p4, 'GET', '/api/sync', null, { 'X-Sync-Token': 'probe-token-' + i + '-xxxxxxxx' });
    const h4 = JSON.parse((await request(p4, 'GET', '/api/health')).body);
    check('5 次 GET 陌生令牌不占名额（spaces=' + h4.spaces + '）', h4.spaces === 0);
    const put = await request(p4, 'PUT', '/api/sync', JSON.stringify({ data: { customers: [] } }), { 'X-Sync-Token': 'real-token-aaaaaaaaaaaa', 'Content-Type': 'application/json' });
    check('名额没被刷满，真实推送成功', put.status === 200);
    const q = await request(p4, 'GET', '/api/sync?token=real-token-aaaaaaaaaaaa');
    check('?token= 不再被接受', q.status === 401);
    /* M27 静态白名单 */
    fs.mkdirSync(path.join(tmp, 'db'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'db/supabase.sql'), '-- secret schema');
    fs.mkdirSync(path.join(tmp, 'docs'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'docs/DEPLOY.md'), '# doc');
    check('M27 db/ 不再公网可下载', (await request(p4, 'GET', '/db/supabase.sql')).status === 404);
    check('M27 docs/ 不再公网可下载', (await request(p4, 'GET', '/docs/DEPLOY.md')).status === 404);
    check('M27 未知 /api/* 返回 404 而不是首页', (await request(p4, 'GET', '/api/nope')).status === 404);
    check('M27 前端脚本照常', (await request(p4, 'GET', '/js/core/sync-core.js')).status === 200);
    check('M27 前端路由回首页', (await request(p4, 'GET', '/some/route')).status === 200);
    c4.kill();
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  if (fail && stderr) console.log('\n--- server stderr ---\n' + stderr);
  console.log('\n' + (fail === 0 ? 'ALL SERVER TESTS PASSED' : 'FAILURES: ' + fail));
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL:', e); process.exit(1); });
