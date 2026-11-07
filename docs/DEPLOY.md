# 销冠助手 · 部署手册

适用版本 1.0.2。照步骤操作即可，每处关键设置都写了原因。

> 本软件保留所有权利，以下内容供作者及获授权者部署使用，见仓库根目录 `LICENSE`。

---

## 0. 先决定部署到哪儿

前端是纯静态文件。`server/server.js` 能同时提供网页和 `/api/sync` 同步接口，但静态托管平台不运行常驻 Node 进程，所以部署位置决定了同步方式：

| 部署到 | 网页 | `/api/sync` | 同步方式 |
|---|---|---|---|
| Cloudflare Pages（线上在用） | ✅ | ❌ | Supabase 空间 / Supabase 账号 |
| Vercel | ✅ | ❌ | Supabase 空间 / Supabase 账号 |
| 腾讯云 EdgeOne Pages | ✅ | ✅ 云函数提供 | 自建 / 兼容服务器 |
| 自有服务器 `node server/server.js` | ✅ | ✅ | 任意 |

**最常见的错误**：部署到静态托管后，同步方式还停在「自建 / 兼容服务器」。页面正常，但同步胶囊一直灰色。

Supabase 的地址和 key 在应用的设置页填写，存在浏览器本地，任何平台都不需要配置环境变量。

| | Cloudflare Pages | Vercel | EdgeOne Pages | 自托管 |
|---|---|---|---|---|
| 需要 Git | 推荐（也可上传文件夹） | 推荐 | 需要 | 不需要 |
| 费用 | 免费，不限带宽 | 免费额度 | 免费额度，需腾讯云实名 | 自有机器 |
| 访问 | 公网 | 公网 | 公网，国内节点 | 取决于网络与反代 |
| 适合 | 大多数情况 | 已在用 Vercel | 在意国内速度、不想用 Supabase | 数据只放自己机器 |

---

## 1. 准备 Supabase

只用一台设备、不开同步可以跳过。浏览器数据被清除就会丢失，建议至少开一种同步。

用内置的默认项目登录也能同步（数据存放在作者的项目里）；要用自己的项目，按下面操作。

### 1.1 建项目

1. 在 [supabase.com](https://supabase.com) 注册，点 **New project**。
2. Region 选 Singapore 或 Tokyo，离国内较近。
3. Database Password 自行保存，创建后等两分钟左右。

### 1.2 取两个值

**Project Settings → API**：

- **Project URL**：形如 `https://abcdefgh.supabase.co`
- **anon / publishable key**

anon key 可以公开，权限由数据库的 RLS 策略控制。**service_role key 会绕过全部权限检查，绝不能填进网页。**

### 1.3 建表

**SQL Editor → New query**，粘贴 `db/supabase.sql` 全文并运行。脚本幂等，可重复执行。它会创建：

| 表 | 内容 |
|---|---|
| `profiles` | 用户、角色（owner / admin / member）、所属团队、显示名 |
| `teams` | 团队与邀请码（新码 12 位，旧的 8 位码仍有效） |
| `records` | 客户、商机、跟进、话术，每条一行，按 `user_id` 隔离 |
| `team_scripts` | 团队共享话术（前端尚未接入） |
| `user_settings` | 个人设置（含 AI Key），只有本人可读 |
| `sales_sync` | 「Supabase 空间」模式的整包快照，按空间名隔离 |
| `join_attempts` | 邀请码输入限流记录，客户端不可访问 |

以及权限策略、触发器和函数：用户不能改自己的角色与团队、记录的 `team_id` 由数据库决定、团队看板函数 `team_record_facts()`、加入团队 `join_team()` 等。

需要保活时再执行 `db/keepalive.sql`（见 1.6）。

### 1.4 已有数据库的升级

新建的库只需 1.3。已在用旧版脚本的库，按文件名日期顺序执行 `db/migrations/` 下尚未执行过的迁移，均为幂等：

| 迁移 | 内容 |
|---|---|
| `2026-11-04-profiles-guard.sql` | 禁止用户修改自己的角色和团队 |
| `2026-11-04-sales-sync-space.sql` | 快照表按 `x-sync-space` 请求头隔离 |
| `2026-11-04-records-guards.sql` | 记录级后写覆盖、`team_id` 由数据库决定、逐行时间戳 |
| `2026-11-04-minor-hardening.sql` | 显式授权、邀请码限流、保活表策略、注册并发 |
| `2026-11-04-team-stats.sql` | 团队看板改用 `team_record_facts()`，管理员不能直接读成员记录 |
| `2026-11-07-admin-demote-guard.sql` | 管理员不能修改另一位管理员的角色（只有 owner 能调整管理员） |

涉及前端行为的迁移，先部署新前端再执行。

### 1.5 邮箱验证（可选）

**Authentication → Providers → Email** 中关闭 **Confirm email**，注册后可直接登录；开着则需先去邮箱点验证链接。

### 1.6 免费项目保活

免费项目 7 天不活跃会被暂停。`.github/workflows/supabase-keepalive.yml` 每 3 天向 `keepalive_logs` 写入一行，需要：

1. 在目标项目执行 `db/keepalive.sql`；
2. 在 workflow 的 `matrix` 中填项目地址和 publishable key（当前覆盖生产项目和一个测试项目）。

保活表 10 分钟内只允许写一次。检测到项目已暂停时任务会失败，到 Supabase 控制台手动恢复。GitHub 会在仓库 60 天无活动后停用定时任务，workflow 中的 `stay-enabled` 任务每次运行都会重新启用它；万一仍被停用，在 Actions 页面手动 Enable。

---

## 2. Cloudflare Pages

### 2.1 构建产物只有 `public/`

```bash
node tools/build.js --pages      # 或 npm run build
```

它会清空并重建 `public/`：按 `index.html` 的实际引用复制脚本、样式、图标、`manifest.json` 和 `kb/knowledge.json`，复制 `deploy/_headers`，重写 `sw.js` 预缓存清单；`public/` 中出现 `data/` 或业务 JSON 会报错中止。不要手动复制文件替代这一步。

### 2.2 方式一：连接 GitHub（线上在用，推荐）

1. **Workers & Pages → Create → Pages → Connect to Git**，选择仓库。
2. 构建配置：

   | 项 | 值 |
   |---|---|
   | Production branch | `main` |
   | Build command | `node tools/build.js --pages` |
   | Build output directory | `public` |

3. 保存并部署。之后每次合并到 `main` 自动构建上线，约 1 分钟。

### 2.3 方式二：上传文件夹

**Create → Pages → Upload assets**，先本地执行 2.1，再把 `public` 文件夹整个拖入。每次更新都要重新构建并上传。

### 2.4 方式三：命令行

```bash
node tools/build.js --pages
npx wrangler pages deploy public
```

`wrangler.toml` 已写好项目名 `sales-copilot-premium` 和输出目录。报 `Project not found [code: 8000007]` 时，用 `npx wrangler pages project list` 核对后修改 `wrangler.toml` 的 `name`。

### 2.5 自定义域名

**Custom domains** 中添加域名。`*.pages.dev` 子域由项目名决定且无法修改，只作预览用。线上域名为 `https://sales.leilaomi.cc.cd`。

接入 Cloudflare 的域名，以下功能会向页面注入内联脚本，与 `deploy/_headers` 的 CSP（`script-src 'self'`）冲突，需关闭：

- **Security → Bots**：JavaScript Detections（或 Bot Fight Mode）
- **Speed → Optimization**：Rocket Loader
- **Scrape Shield**：Email Address Obfuscation（页面没有邮箱地址时不会注入，可保持）

这些是整个区域（zone）的设置，会影响同一区域下的其他站点。验证：查看页面源代码，搜不到 `cdn-cgi/challenge-platform`。线上区域 `leilaomi.cc.cd` 已关闭 JavaScript Detections，Rocket Loader 为关闭状态。

---

## 3. Vercel

1. [vercel.com](https://vercel.com) 中 **Add New → Project**，导入仓库。
2. **Framework Preset** 选 **Other**（`vercel.json` 已设 `"framework": null`）。
3. **Build Command** 留空，直接发布仓库根目录。
4. 部署。

Vercel 只上传 Git 中的文件，`data/` 已被 `.gitignore` 排除。首次部署后仍按 5.5 检查一次。

---

## 4. 腾讯云 EdgeOne Pages

云函数 + Blob 存储提供 `/api/sync` 和 `/api/health`，详细步骤见 [`deploy/edgeone/README.md`](../deploy/edgeone/README.md)。要点：

1. 在本仓库内运行 `node deploy/edgeone/prepare.js`，从 `js/core/sync-core.js` 生成云函数用的协议副本；**每次升级都要重新运行**。
2. 把 `deploy/edgeone/` 复制为独立项目，`npm install`，推到 Git。
3. EdgeOne 控制台新建 Pages 项目：框架选「其他 / 无」，安装命令 `npm install`，构建命令留空。
4. 环境变量：`SYNC_TOKEN`（留空为多人模式）、`BLOB_STORE`（默认 `sales-copilot`）、`MAX_DEVICES`（默认 20）、`MAX_SPACES`（默认 200），修改后需重新部署。
5. 访问 `https://你的域名/api/health`，应返回 `"ok": true` 且 `blobReady` 为真。
6. 应用中同步方式选「自建 / 兼容服务器」，地址填 `https://你的域名/api/sync`。

CI 用 `node deploy/edgeone/prepare.js --check` 确认仓库中的副本与 `sync-core.js` 一致。

---

## 5. 自托管

### 5.1 启动

```bash
# 直接运行
SYNC_TOKEN=$(openssl rand -hex 16) PORT=8080 node server/server.js

# Docker（在仓库根执行）
docker build -t sales-copilot -f deploy/Dockerfile .
docker run -d --name sales-copilot -p 8080:8080 \
  -e SYNC_TOKEN=$(openssl rand -hex 16) -v sales-copilot-data:/app/data \
  --restart unless-stopped sales-copilot

# systemd：按 deploy/sales-copilot.service 顶部的步骤安装
```

### 5.2 接口

| 接口 | 作用 |
|---|---|
| `GET /api/health` | 免鉴权；`storage` 必须为 `file`，`memory` 表示写不进磁盘、重启即丢 |
| `GET /api/sync` | 拉取本空间快照（需令牌）；尚无数据时返回 404 属正常 |
| `PUT /api/sync` | 上传快照，服务端合并后返回；请求体上限 8 MB |
| `GET /api/backups` | 列出本空间历史快照 |

令牌放在 `Authorization: Bearer` 或 `X-Sync-Token` 请求头，不接受 URL 参数。未实现的 `/api/*` 返回 404；只放行站点文件，`data/`、`server/`、`node_modules/` 和点开头的路径返回 403。

### 5.3 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | 8080 | 监听端口 |
| `SYNC_TOKEN` | 空 | 专属模式令牌；须至少 16 位且不能是模板占位符，否则拒绝启动。不设为多人模式，任意至少 8 位的令牌各开一个空间 |
| `BACKUP_KEEP` | 10 | 近期快照份数 |
| `BACKUP_MIN_GAP` | 60000 | 近期快照最小间隔（毫秒） |
| `MAX_SPACES` | 200 | 空间数上限，超出返回 503 |
| `REQUIRE_DISK` | 空（镜像内为 `1`） | 为 `1` 时数据目录不可写即拒绝启动 |

### 5.4 数据与恢复

每个空间存为 `data/store-<令牌哈希>.json`（原子替换写入）；多人模式首次启动在 `data/token.txt` 写入建议令牌。备份在 `data/backups/`：近期快照 `BACKUP_KEEP` 份，每日快照 7 天。

恢复：停服 → 将选中的快照复制为 `data/store-<同一哈希>.json` → 启动。

### 5.5 安全要求

1. 服务只提供 HTTP，公网部署必须前置 HTTPS 反向代理；令牌等同数据访问凭证，建议固定 `SYNC_TOKEN`。
2. `.dockerignore` 排除了 `data/`、`public/`、`.env*`、`.git/`，不要删除，否则客户数据会进入镜像层。
3. Docker 必须给 `/app/data` 挂卷；镜像以 UID 10001 运行，卷的属主需匹配。systemd 下 `data/` 属主需为服务用户。

---

## 6. 在应用里配置同步

设置 → 云同步 → 同步方式：

| 选项 | 填写 |
|---|---|
| Supabase 空间（一个人多台设备） | Project URL、anon key、表名 `sales_sync`、空间名（至少 16 位，点「随机生成」，其他设备填同一个） |
| Supabase 账号（多人 / 团队） | 在「账号与团队」登录即可；用自己的项目时先填 Project URL 和 anon key |
| 自建 / 兼容服务器 | 地址（如 `https://你的域名/api/sync`）和令牌 |

点「保存并连接」，再点「立即同步」，同步胶囊变绿即连通。

空间名相当于密码：数据库只返回请求头 `x-sync-space` 与之相同的那一行。多人各自独立就各自生成空间名；团队协作用「Supabase 账号」。

---

## 7. 部署后验证

### 7.1 Service Worker 已是新版本

1. Chrome 打开线上地址，F12 → **Application → Cache Storage**，缓存名应为 **`sales-copilot-v8`**（随版本递增，以仓库 `sw.js` 的 `CACHE` 为准）。
2. **Network** 中刷新（不勾 Disable cache），查看 `sw.js` 的响应头应有 `cache-control: no-cache, no-store, must-revalidate`。

不符合时：

- 确认部署前执行了 `node tools/build.js --pages`。
- 访问 `https://你的域名/_headers` 应为 404（说明被平台解析而非当作文件发布）。
- **Application → Service Workers** 点 Unregister，关闭所有标签页后重开。

手机上关掉应用（或所有标签页）重新打开即可拿到新版本。

### 7.2 清空数据后不会再出现示例

设置 → 数据管理 → 清空全部业务数据，等同步胶囊变绿，刷新并硬刷新（Ctrl+Shift+R），客户库应为 0 条。

### 7.3 两个账号互相看不见

用一个普通窗口和一个无痕窗口（同一浏览器换账号测不出来：localStorage 按网站而非账号隔离）。A 注册并建客户「测试-甲方」，同步；B 注册并同步，B 的客户库搜不到它即正确。

### 7.4 团队看板只有统计

管理员登录后团队页应显示成员的统计数字。用管理员的登录令牌直接请求 `/rest/v1/records?user_id=neq.<自己的用户 ID>`，应返回空数组：管理员只能通过 `team_record_facts()` 拿统计字段。仓库的 `tools/rls/records.test.mjs` 覆盖了这项检查。

### 7.5 离线可用

F12 → Network 勾选 Offline（或手机飞行模式）后刷新，页面和数据应正常显示。

### 7.6 客户数据没有泄露

静态托管：`https://你的域名/data/` 不应返回任何客户数据。

自托管：以下请求都应返回 **403**：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://IP:8080/data/token.txt
curl -s -o /dev/null -w "%{http_code}\n" http://IP:8080/data/backups/
```

返回 200 说明运行的版本过旧：升级后**更换令牌**，因为数据按令牌哈希寻址，泄露过的令牌升级后仍然有效。

### 7.7 添加到主屏幕

手机浏览器菜单 → 添加到主屏幕（iOS 只有 Safari 有此选项）。设置页「查看安装状态」会显示是否就绪。

---

## 8. 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 「测试连接」返回 401 | 正常，说明地址和 key 正确 | 无需处理 |
| 登录报错 | 邮箱或密码错误；密码至少 6 位 | 重新输入 |
| 同步时 401，之前正常 | 登录过期且续期失败 | 退出后重新登录 |
| 所有请求 401 | URL 或 key 粘贴有误 | 检查多余空格、末尾 `/`、多带的 `/rest/v1` |
| 「表还没建」 | 未执行 `db/supabase.sql` | 执行 1.3 |
| 建表后仍 403 | 脚本未完整执行，或填了 service_role key | 重新执行脚本；改用 anon key |
| B 能看到 A 的数据 | RLS 策略被改动 | 重新执行 `db/supabase.sql` 和 1.4 的迁移 |
| 整站 404 | 输出目录错误 | Cloudflare 填 `public`；Vercel 留空 |
| 某个 `.js` 404 或功能缺失 | 未构建或未部署 `public/` | 重新构建部署；脚本有加载顺序依赖，缺一个会连带出错 |
| 同步胶囊一直灰色 | 静态托管上选了「自建 / 兼容服务器」 | 改为 Supabase 空间或 Supabase 账号 |
| 刷新仍是旧版 / 白屏 | Service Worker 缓存 | 按 7.1 处理 |
| 团队看板为空 | 不是 owner / admin，未入队，或数据库未执行 `team-stats` 迁移 | 检查角色；执行 1.4 |
| 邀请码一直失败 | 输错过多被限流 | 15 分钟后再试 |
| 控制台报 CSP 错误、页面转圈 | 域名开启了注入脚本的功能 | 按 2.5 关闭 |
| 换浏览器要重填配置 | 配置存在 localStorage | 重新填写，或用数据码迁移 |
| iOS 找不到「添加到主屏幕」 | 不是 Safari | 用 Safari |

---

## 9. 附：缓存与安全头

Cloudflare Pages 用 `deploy/_headers`（构建时复制到 `public/_headers`，只改 `deploy/` 那份），Vercel 用 `vercel.json`。两者的安全头相同：

- `Content-Security-Policy`：脚本只允许本站（`script-src 'self'`），样式允许内联，连接允许任意 HTTPS（用于 Supabase 和 AI 服务商）
- `X-Frame-Options: DENY`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`

缓存：

| 资源 | `_headers` | `vercel.json` |
|---|---|---|
| `sw.js` | 不缓存 | 不缓存 |
| `index.html`、`/` | 不缓存 | `no-cache` |
| `manifest.json` | `no-cache` | 5 分钟 |
| 其余 `.js` / `.css` / `.json` | 5 分钟 | 5 分钟 |
| `.png` | 5 分钟 | 1 天 |

文件名不带哈希，所以脚本和样式不能长缓存；`sw.js` 与 `index.html` 是更新通道，必须每次回源。`vercel.json` 中普通 JS 规则用 `/((?!sw\.js).*).js` 排除 `sw.js`，因为 Vercel 会同时应用所有匹配的规则。`vercel.json` 不能写注释，`framework: null` 防止 Vercel 猜测框架，`cleanUrls: false` 避免多余跳转。

---

## 10. 附：部署相关文件

| 文件 | 作用 |
|---|---|
| `tools/build.js` | 构建入口：`--pages` 生成 `public/`，不带参数生成单文件版 |
| `deploy/_headers` | Cloudflare Pages 安全头与缓存规则的源文件 |
| `wrangler.toml` | Cloudflare Pages 项目配置（命令行部署时读取） |
| `vercel.json` | Vercel 项目、安全头与缓存配置 |
| `sw.js` | Service Worker：页面与脚本网络优先（3 秒超时回退缓存），知识库后台更新 |
| `deploy/Dockerfile` | 容器模板（`node:22-alpine`、非 root、健康检查） |
| `.dockerignore` | 阻止 `data/`、`public/`、`.env*`、`.git/` 进入镜像 |
| `deploy/sales-copilot.service` | systemd 单元（`ProtectSystem=strict`） |
| `deploy/edgeone/` | EdgeOne 同步后端适配器 |
| `db/supabase.sql` | 全部表、RLS 策略、触发器与函数（幂等） |
| `db/migrations/` | 已有库的增量迁移 |
| `db/keepalive.sql` | 保活表 |
| `.github/workflows/ci.yml` | 测试、构建、Docker、数据库权限回归 |
| `.github/workflows/supabase-keepalive.yml` | Supabase 保活 |
