/* ============================================================
 * 销冠助手 · EdgeOne 同步适配器回归测试（node tools/test-edgeone.mjs）
 *
 * 守住 2026-11-04 审计 M23：设备文件超过 MAX_DEVICES 后 GET/PUT 永远 413、无法自救；
 * 多人模式没有空间数上限。Blob 存储用内存模拟（接口按 @edgeone/pages-blob 0.0.18 的类型声明）。
 * ============================================================ */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let fail = 0;
const check = (n, c) => { console.log((c ? 'PASS' : 'FAIL') + '  ' + n); if (!c) fail++; };

/* 复制一份适配器，配上假的 @edgeone/pages-blob */
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sc-eo-'));
fs.cpSync(path.join(root, 'deploy/edgeone/cloud-functions'), path.join(tmp, 'cloud-functions'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
const mod = path.join(tmp, 'node_modules/@edgeone/pages-blob');
fs.mkdirSync(mod, { recursive: true });
fs.writeFileSync(path.join(mod, 'package.json'), '{"name":"@edgeone/pages-blob","type":"module","main":"index.js"}');
fs.writeFileSync(path.join(mod, 'index.js'), `
export function getStore() {
  const M = globalThis.__BLOBS;   // 每次取当前的，测试之间会换新 Map
  return {
    async list(o) {
      const p = (o && o.prefix) || '';
      const keys = [...M.keys()].filter(k => k.startsWith(p));
      if (o && o.directories) {
        const dirs = new Set(), blobs = [];
        keys.forEach(k => { const rest = k.slice(p.length); const i = rest.indexOf('/'); if (i >= 0) dirs.add(p + rest.slice(0, i)); else blobs.push({ key: k, etag: '' }); });
        return { blobs, directories: [...dirs] };
      }
      return { blobs: keys.map(k => ({ key: k, etag: '' })), directories: [] };
    },
    async get(k) { return M.has(k) ? JSON.parse(M.get(k)) : null; },
    async setJSON(k, v) { M.set(k, JSON.stringify(v)); },
    async delete(k) { M.delete(k); }
  };
}`);

async function load(env) {
  Object.assign(process.env, env);
  const u = pathToFileURL(path.join(tmp, 'cloud-functions/api/sync.js')).href + '?v=' + Math.random();
  return (await import(u)).onRequest;
}
function req(method, token, device, body) {
  const h = new Headers({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' });
  if (device) h.set('X-Device-Id', device);
  return { request: new Request('https://eo.test/api/sync', { method, headers: h, body: body ? JSON.stringify(body) : undefined }) };
}
const snap = (id, t) => ({ data: { customers: [{ id, name: id, updatedAt: t }], deals: [], followups: [], scripts: [] } });

try {
  /* ---------- 设备上限 ---------- */
  globalThis.__BLOBS = new Map();
  let on = await load({ SYNC_TOKEN: '', MAX_DEVICES: '3', MAX_SPACES: '2' });
  const T = 'space-token-aaaa-1111';
  for (let i = 1; i <= 3; i++) await on(req('PUT', T, 'dev' + i, snap('c' + i, i)));
  const r4 = await on(req('PUT', T, 'dev4', snap('c4', 4)));
  check('第 4 台设备推送成功（实得 ' + r4.status + '）', r4.status === 200);
  const g = await on(req('GET', T));
  const gj = g.status === 200 ? await g.json() : {};
  check('满了之后 GET 仍然可读（实得 ' + g.status + '）', g.status === 200);
  const ids = ((gj.data && gj.data.customers) || []).map(c => c.id).sort().join(',');
  check('收拢后 4 台设备的数据一条不丢（' + ids + '）', ids === 'c1,c2,c3,c4');
  const files = [...globalThis.__BLOBS.keys()].filter(k => k.includes('/'));
  check('设备文件数不超过上限（实得 ' + files.length + '）', files.length <= 3);
  check('被收拢的是最旧的 dev1', !files.some(k => k.endsWith('/dev1.json')));

  /* 旧数据已经超限（升级前留下的）：也不能锁死 */
  globalThis.__BLOBS = new Map();
  on = await load({ SYNC_TOKEN: '', MAX_DEVICES: '2', MAX_SPACES: '50' });
  const sp = (await import(pathToFileURL(path.join(tmp, 'cloud-functions/_shared/sync-core.js')).href)).default.spaceKey(T);
  for (let i = 1; i <= 4; i++) globalThis.__BLOBS.set('sync/' + sp + '/old' + i + '.json', JSON.stringify(Object.assign({ updatedAt: i }, snap('o' + i, i))));
  const g2 = await on(req('GET', T));
  check('历史超限的空间 GET 不再 413（实得 ' + g2.status + '）', g2.status === 200);
  const p2 = await on(req('PUT', T, 'old4', snap('o4', 9)));
  check('历史超限的空间老设备 PUT 不再 413（实得 ' + p2.status + '）', p2.status === 200);

  /* ---------- 空间数上限（多人模式） ---------- */
  globalThis.__BLOBS = new Map();
  on = await load({ SYNC_TOKEN: '', MAX_DEVICES: '20', MAX_SPACES: '2' });
  const a = await on(req('PUT', 'space-token-1-xxxxxx', 'd', snap('a', 1)));
  const b = await on(req('PUT', 'space-token-2-xxxxxx', 'd', snap('b', 1)));
  const c = await on(req('PUT', 'space-token-3-xxxxxx', 'd', snap('c', 1)));
  check('前两个空间正常（' + a.status + ',' + b.status + '）', a.status === 200 && b.status === 200);
  check('第三个新空间被挡（实得 ' + c.status + '）', c.status === 503);
  const a2 = await on(req('PUT', 'space-token-1-xxxxxx', 'd2', snap('a2', 2)));
  check('已有空间加新设备不受空间上限影响（实得 ' + a2.status + '）', a2.status === 200);

  /* ---------- 依赖版本 ---------- */
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'deploy/edgeone/package.json'), 'utf8'));
  const v = pkg.dependencies['@edgeone/pages-blob'];
  check('依赖版本是已发布的 0.0.x（实得 ' + v + '；npm 上没有 1.x）', /^\^?0\.0\.\d+$/.test(v));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('\n' + (fail === 0 ? 'ALL EDGEONE TESTS PASSED' : 'FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
