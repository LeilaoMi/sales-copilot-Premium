/* ============================================================
 * 销冠助手 · 同步后端（零依赖 Node.js）
 *
 * 一个文件同时提供：静态站点 + /api/sync 同步接口。
 * 启动：node server/server.js          （默认 8080）
 *      PORT=3000 node server/server.js
 *      SYNC_TOKEN=你的令牌 node server/server.js
 *
 * 接口：
 *   GET  /api/sync  → { revision, data }      拉取云端快照
 *   PUT  /api/sync  → { revision, data }      推送本地快照（服务端做 LWW 合并后返回）
 *   GET  /api/health → { ok, revision, size }
 *
 * 存储：./data/sync-store.json（不可写时退化为内存，并打印警告）
 * ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
/* 合并算法、令牌校验这些「协议层」的东西放在 sync-core.js，
 * 和 EdgeOne 云函数适配器共用一份 —— 两边各自实现一份的话，
 * 改了一处忘了另一处，同步出来的数据就会对不上，而且极难排查。 */
const CORE = require('../js/core/sync-core');

const PORT = process.env.PORT || 8080;
const ROOT = require('path').join(__dirname, '..'); // server/ -> 项目根，前端静态文件都在那
const DATA_DIR = path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sync-store.json');
const TOKEN_FILE = path.join(DATA_DIR, 'token.txt');
const KEYS = CORE.KEYS;
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 10);   // 每个空间保留的历史版本份数
const MAX_SPACES = Number(process.env.MAX_SPACES || 200);    // 空间数上限：公开部署时防止被刷

/* ---------- 令牌与两种运行模式 ----------
 *
 *  模式一「专属模式」：启动时带 SYNC_TOKEN=xxx
 *      → 只认这一个令牌，其余一律 401。个人自用推荐，最省心也最安全。
 *
 *  模式二「多人模式」：不设 SYNC_TOKEN
 *      → 令牌即空间，任意 ≥8 位的令牌都可接入，各占一个数据文件互不干扰。
 *        一台服务器就能给整个团队用，每人自己起一个长一点的令牌即可。
 *        注意：令牌就是唯一的钥匙，请让每个人用足够长且不易猜的字符串。
 */
const FIXED_TOKEN = process.env.SYNC_TOKEN || '';
/* 固定令牌把关（2026-11-04 审计 M16）：systemd / Docker 模板里带着示例令牌，
 * 忘改就等于把数据交给所有读过 README 的人。太短或像占位符就拒绝启动，比带病上线强。 */
const PLACEHOLDER_RE = /change-?me|your-?token|你的|你自己|示例|example|placeholder/i;
if (FIXED_TOKEN && (FIXED_TOKEN.length < 16 || PLACEHOLDER_RE.test(FIXED_TOKEN))) {
  console.error('SYNC_TOKEN 不安全：' + (FIXED_TOKEN.length < 16 ? '少于 16 位' : '还是模板里的占位符') +
    '。请换成随机长串（例：openssl rand -hex 16），或去掉 SYNC_TOKEN 改用多人模式。');
  process.exit(1);
}
let SUGGESTED = '';
/* 启动时真写一次（2026-11-04 审计 M15）。以前只看 mkdir 有没有抛错：目录已存在但属主是 root
 * （Docker 绑定挂载的典型情况）时 mkdir 照样成功，于是每次落盘都失败、只打日志，
 * /api/health 却一直报 storage:file，重启即丢。REQUIRE_DISK=1 时不可写直接退出（容器模板默认开）。 */
function probeWritable() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const f = path.join(DATA_DIR, '.write-probe-' + process.pid);
    fs.writeFileSync(f, 'ok');
    fs.unlinkSync(f);
    return true;
  } catch (e) {
    console.error('数据目录不可写：' + DATA_DIR + '（' + (e.code || e.message) + '）');
    return false;
  }
}
let writable = probeWritable();
if (!writable && /^(1|true|yes)$/i.test(process.env.REQUIRE_DISK || '')) {
  console.error('REQUIRE_DISK 已开启，数据目录不可写时拒绝启动。容器部署请检查卷的属主（见 deploy/Dockerfile 顶部说明）。');
  process.exit(1);
}
try { SUGGESTED = fs.readFileSync(TOKEN_FILE, 'utf8').trim(); } catch (e) {}
if (!SUGGESTED) {
  SUGGESTED = crypto.randomBytes(12).toString('hex');
  try { fs.writeFileSync(TOKEN_FILE, SUGGESTED); } catch (e) {}
}
const MODE = FIXED_TOKEN ? '专属模式（单令牌）' : '多人模式（令牌即空间）';
console.log('============================================');
console.log('  销冠助手同步服务已启动');
console.log('  端口:   ' + PORT);
console.log('  模式:   ' + MODE);
if (FIXED_TOKEN) console.log('  令牌:   已设置（' + FIXED_TOKEN.length + ' 位，不在日志里显示）');
else console.log('  令牌:   自定义，≥8 位即可（建议用：' + SUGGESTED + '）');
console.log('  存储:   ' + (writable ? DATA_DIR + '（按令牌分文件）' : '内存（目录不可写，重启即丢）'));
console.log('  备份:   ' + (writable ? '每次覆盖前自动留档，保留最近 ' + BACKUP_KEEP + ' 份（BACKUP_KEEP 可调）' : '不可用'));
console.log('============================================');

/* ---------- 存储：按令牌隔离 ----------
 * 一台服务器可以给多个业务员各发一个令牌，数据文件彼此独立，互不干扰。
 * 令牌 → 文件名用 sha256 前 12 位，避免令牌本身落盘。
 */
const spaces = new Map();   // tokenHash -> { revision, data }
const hash = CORE.spaceKey;   // 令牌 → 12 位空间名，令牌本身不落盘

function spaceFile(h) { return path.join(DATA_DIR, 'store-' + h + '.json'); }

function getSpace(token) {
  const h = hash(token);
  if (spaces.has(h)) return spaces.get(h);
  let sp = { revision: 0, data: null };
  let existed = false;
  try {
    const raw = fs.readFileSync(spaceFile(h), 'utf8');
    const p = JSON.parse(raw);
    if (p && typeof p === 'object') { sp = p; existed = true; console.log('[' + h + '] 已加载历史数据，revision=' + sp.revision); }
  } catch (e) { /* 首次使用，正常 */ }
  // 新空间要占位，先查是否超额（公开部署时防止被无限刷空间）
  if (!existed && spaces.size >= MAX_SPACES) return null;
  spaces.set(h, sp);
  return sp;
}
/* ---------- 轮转备份 ----------
 * 为什么需要：同步策略是「最后写入者赢」，一次误删、一次错误导入会同步到所有设备，
 * 且没有任何撤销入口。所以每次覆盖前先留一份历史版本，出事了能手动捞回来。
 * 保留最近 KEEP 份，按时间倒序，超出自动删最旧的。
 */
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MIN_GAP = Number(process.env.BACKUP_MIN_GAP || 60 * 1000);   // 近期快照最小间隔
const DAILY_KEEP = 7;                  // 每日快照保留天数
const lastBackupAt = new Map();

function rotateBackup(h) {
  if (!writable) return;
  const f = spaceFile(h);
  try {
    if (!fs.existsSync(f)) return;
    const now = Date.now();

    /* 每日快照：一天一份，保留 7 天。
     * 这一层很关键——误操作常常是好几天后才发现，光靠近期快照早就被冲掉了。 */
    const day = new Date(now).toISOString().slice(0, 10);
    const dailyName = `store-${h}-daily-${day}.json`;
    if (!fs.existsSync(path.join(BACKUP_DIR, dailyName))) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.copyFileSync(f, path.join(BACKUP_DIR, dailyName));
      const cutoff = new Date(now - DAILY_KEEP * 86400000).toISOString().slice(0, 10);
      fs.readdirSync(BACKUP_DIR)
        .filter(n => n.startsWith(`store-${h}-daily-`) && n.slice(-15, -5) < cutoff)
        .forEach(n => fs.unlinkSync(path.join(BACKUP_DIR, n)));
    }

    /* 近期快照：滚动保留最近 BACKUP_KEEP 份 */
    if (now - (lastBackupAt.get(h) || 0) < MIN_GAP) return;
    lastBackupAt.set(h, now);
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    // 保留毫秒：只截到秒的话，同一秒内的多次备份会同名互相覆盖，历史就丢了
    const stamp = new Date(now).toISOString().replace(/[:.]/g, '-').slice(0, 23);
    fs.copyFileSync(f, path.join(BACKUP_DIR, `store-${h}-${stamp}.json`));

    const files = fs.readdirSync(BACKUP_DIR)
      .filter(n => n.startsWith(`store-${h}-`) && !n.includes('-daily-'))
      .sort();                                  // 时间戳字典序 = 时间序
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) { console.error('备份失败:', e.message); }
}

/* 返回 true 表示已落盘（或本来就是内存模式，无盘可落）；false 表示写盘失败。
 * 以前写失败只打一行日志、照样回 200（2026-11-04 审计 M25）：客户端以为同步成功，
 * 重启后这段数据就没了。现在调用方据此回 500，并且不把这次推送留在内存里。 */
function persist(h, sp) {
  if (!writable) return true;
  try {
    rotateBackup(h);                            // 先留后路，再覆盖
    const f = spaceFile(h), tmp = f + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(sp));
    fs.renameSync(tmp, f);   // 原子写，避免写一半断电损坏
    return true;
  } catch (e) {
    console.error('写入失败:', e.message);
    return false;
  }
}

/* ---------- 合并：逐条 LWW + 墓碑 ---------- */
const merge = CORE.merge;
const calcRevision = CORE.calcRevision;
const validate = CORE.validate;

/* ---------- HTTP ---------- */
/* 页面安全头（2026-11-04 审计 M3）。
 * 重点是 script-src 'self'：即使哪里漏了转义、被塞进 onmouseover=… 之类的内联处理器，
 * 浏览器也不会执行。connect-src 放得很宽是有意的——AI 接口、自建同步、Supabase
 * 地址都允许用户自填（含本机 http://localhost），收窄会直接弄坏这些功能。
 * style 需要 'unsafe-inline'：页面大量使用 style="" 属性。
 * 与 deploy/_headers、vercel.json 保持同一份内容。 */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https: http: wss:; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const PAGE_HEADERS = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

function send(res, code, obj, headers) {
  const body = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    /* 与 EdgeOne 适配器一致（审计 M13）：前端每次同步都带 X-Sync-Token / X-Device-Id，
     * 不放行的话「Pages 前端 + 自建后端」跨域预检必失败。服务端没有 POST 接口，不再声明。 */
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Sync-Token,X-Device-Id',
    'Access-Control-Max-Age': '86400'
  }, headers || {}));
  res.end(body);
}

/* 取令牌，按顺序尝试三种携带方式：
 *   1. Authorization: Bearer xxx        标准方式，首选
 *   2. X-Sync-Token: xxx                备用头（有些反向代理会吃掉 Authorization）
 *   3. ?token=xxx                       查询参数，兼容性最好
 * 为什么需要后两种：实测部分云平台网关（如 CloudStudio Gateway）会剥离 Authorization 头，
 * 表现为本地联调一切正常、一上线就全部 401，且很难排查。
 */
function tokenOf(req) { return CORE.tokenOf(req); }
function authOk(req) { return CORE.authOk(req, FIXED_TOKEN); }

/* 静态服务绝不许碰的路径。
 *
 * 为什么必须有这道闸：站点根就是仓库根（ROOT = server/ 的上一级），
 * 而 `data/` 恰恰也躺在仓库根里 ——
 *   data/token.txt            多人模式下自动生成的建议令牌
 *   data/store-<哈希>.json     某个空间的全量快照：真实客户姓名 / 电话 / 微信
 *   data/backups/*.json        上面那份的历史版本，内容一样敏感
 * 不加拦截的话，任何能访问到这个端口的人，先 GET /data/token.txt 拿到令牌，
 * 再 GET /data/store-xxxx.json 就能把客户名单整份下载走。
 * 同步令牌本身就等同于数据访问凭证 —— 它不像密码可以「改一下」了事，
 * 空间数据是按它的哈希寻址的，泄露了只能换令牌重新同步一遍。
 *
 * 服务端自己的源码（server/）和依赖（node_modules/）也没必要公网可读。
 * 以点开头的段（.env / .git / .vercel …）历史上就是凭证和机器路径的藏身处。
 *
 * 前端真正要加载的只有 index.html / js/ / assets/ / kb/ / manifest.json /
 * sw.js / _headers，没有一个落在这几条里，所以这道闸不影响正常使用。 */
function isPrivatePath(pathname) {
  const segs = pathname.split('/').filter(Boolean);
  if (!segs.length) return false;
  const top = segs[0].toLowerCase();
  if (top === 'data' || top === 'server' || top === 'node_modules') return true;
  return segs.some(s => s.charCodeAt(0) === 46);   // 46 = '.'，覆盖 .env / .git / .vercel 等
}

const server = http.createServer((req, res) => {
  /* 畸形百分号编码（如 /%E0%A4%A）会让 decodeURIComponent 抛 URIError。
   * 以前没接住，未鉴权的一个 GET 就能把整个进程打挂（2026-11-04 审计 C2）。 */
  let u, pathname;
  try {
    u = new URL(req.url, 'http://x');
    pathname = decodeURIComponent(u.pathname);
  } catch (e) {
    return send(res, 400, { error: '请求路径编码不合法' });
  }

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // 健康检查：不带令牌，只返回服务状态，不暴露任何数据。
  // 带 authSeen/authVia 是为了排查「本地好使、上线就 401」——
  // 有些网关会剥离 Authorization 头，这里能一眼看出来。
  if (pathname === '/api/health') {
    const tk = tokenOf(req);
    return send(res, 200, {
      ok: true,
      mode: MODE,
      storage: writable ? 'file' : 'memory',
      spaces: spaces.size,
      authSeen: !!tk,
      authVia: tk ? (req.headers['x-sync-token'] ? 'header'
        : (req.headers.authorization ? 'authorization'
          : (new URL(req.url, 'http://x').searchParams.get('token') ? 'query' : '?')))
        : 'none',
      accepts: ['Authorization: Bearer', 'X-Sync-Token', '?token='],
      time: new Date().toISOString()
    });
  }

  // 历史版本列表（需令牌）：误同步后可找回上一个版本
  if (pathname === '/api/backups') {
    if (!authOk(req)) return send(res, 401, { error: '令牌无效' });
    if (req.method !== 'GET') return send(res, 405, { error: '不支持的方法' });
    const h = hash(tokenOf(req));
    let files = [];
    try {
      files = fs.readdirSync(BACKUP_DIR)
        .filter(n => n.startsWith('store-' + h + '-'))
        .sort().reverse()
        .map(n => {
          const s = fs.statSync(path.join(BACKUP_DIR, n));
          return { name: n, time: s.mtime.toISOString(), size: s.size };
        });
    } catch (e) { /* 还没有备份 */ }
    return send(res, 200, {
      keep: BACKUP_KEEP, backups: files,
      tip: '恢复办法：把想要的历史文件复制回 data/ 目录并改名为 store-' + h + '.json，然后重启服务'
    });
  }

  // 同步接口
  if (pathname === '/api/sync') {
    if (!authOk(req)) return send(res, 401, { error: '令牌无效' });
    const tk = tokenOf(req);
    const h = hash(tk);
    const store = getSpace(tk);
    if (!store) return send(res, 503, { error: '服务端空间数已达上限，请联系管理员或自行部署' });

    if (req.method === 'GET') {
      if (!store.data) return send(res, 404, { error: '云端暂无数据，等待第一次推送' });
      return send(res, 200, { revision: store.revision, data: store.data });
    }
    if (req.method === 'PUT') {
      /* 先收原始字节、最后整体按 UTF-8 解码（2026-11-04 审计 C3）。
       * 以前 body += chunk 是逐块转字符串，一个汉字的 3 个字节被网络分包切开时
       * 两半各自解码成 U+FFFD，坏数据落盘后再经 LWW 同步到所有设备。 */
      const MAX = 8 * 1024 * 1024;   // 8MB 上限，按字节算
      const chunks = [];
      let size = 0, tooBig = false;
      req.on('data', c => {
        if (tooBig) return;
        size += c.length;
        if (size > MAX) {
          tooBig = true;
          chunks.length = 0;
          // 先回 413 再断开，客户端能拿到明确错误，而不是一直挂着
          send(res, 413, { error: '数据超过 8MB 上限' });
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on('end', () => {
        if (tooBig) return;
        let incoming;
        try { incoming = JSON.parse(Buffer.concat(chunks, size).toString('utf8')).data; }
        catch (e) { return send(res, 400, { error: 'JSON 解析失败' }); }
        // 结构不对直接 400，不让它进 merge（审计 C4：以前会抛错打挂进程）
        const bad = validate(incoming);
        if (bad) return send(res, 400, { error: '数据格式不对：' + bad });
        const merged = merge(store.data || {}, incoming);
        const revision = calcRevision(merged);
        /* 先落盘、成功了才更新内存：写失败时内存和磁盘保持一致，客户端拿到 500 会重试 */
        if (!persist(h, Object.assign({}, store, { data: merged, revision: revision }))) {
          return send(res, 500, { error: '服务端写盘失败，本次推送未保存，请稍后重试' });
        }
        store.data = merged;
        store.revision = revision;
        console.log('[' + h + '] 收到推送，revision=' + store.revision +
          ' 客户=' + (merged.customers || []).filter(x => !x.deleted).length +
          ' 商机=' + (merged.deals || []).filter(x => !x.deleted).length +
          ' 跟进=' + (merged.followups || []).filter(x => !x.deleted).length);
        send(res, 200, { revision: store.revision, data: merged });
      });
      return;
    }
    return send(res, 405, { error: '不支持的方法' });
  }

  // 静态文件
  let file = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(ROOT)) return send(res, 403, { error: '禁止访问' });
  if (isPrivatePath(pathname)) return send(res, 403, { error: '禁止访问' });
  fs.stat(file, (err, st) => {
    if (err || st.isDirectory()) {
      file = path.join(ROOT, 'index.html');
    }
    fs.readFile(file, (e2, buf) => {
      if (e2) return send(res, 404, { error: '文件不存在' });
      /* sw.js 和 index.html 一律 no-cache。
       *
       * sw.js 尤其关键：浏览器每次导航都会去比对它变没变，
       * 一旦被缓存住，Service Worker 就不再重新安装，
       * 用户机器上那份旧的缓存清单也就永远换不掉 ——
       * 部署了新代码，刷新拿到的还是旧文件，修好的 bug 等于没修。 */
      const extra = (pathname === '/sw.js' || pathname === '/' || pathname === '/index.html')
        ? { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
        : {};
      send(res, 200, buf, Object.assign({
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
      }, PAGE_HEADERS, extra));
    });
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('\n启动失败：端口 ' + PORT + ' 已被占用。');
    console.error('  换个端口：PORT=3000 node server/server.js');
    console.error('  或查是谁占用：ss -ltnp | grep ' + PORT);
    process.exit(1);
  }
  console.error('服务异常：', e.message);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('监听 http://0.0.0.0:' + PORT);
});
