# 销冠助手 · 上线说明

写给"懂一点技术但不想折腾"的人。照着做就行，不用理解原理；
但每一处"为什么"我都写在旁边了 —— 尤其是缓存那部分，踩过坑的地方会标红。

---

## 0. 先花一分钟弄清一件事：部署到哪儿，决定同步怎么配

这个项目是**纯静态**的：一堆 HTML / CSS / JS 文件，没有常驻后端。

你可能注意到仓库里有个 `server/server.js`，它能同时提供网页和 `/api/sync` 同步接口。
但 **Cloudflare Pages 和 Vercel 都跑不了它** —— 这两个平台只负责把文件发给浏览器，
不会给你跑常驻 Node 进程。（EdgeOne Pages 是个例外：它的**云函数**可以接管 `/api/sync`，
见 §4b。）

所以：

| 部署到 | 网页 | `/api/sync` 自建同步 | 该怎么配同步 |
|---|---|---|---|
| Cloudflare Pages | ✅ | ❌ 接口不存在 | 必须走 **Supabase** |
| Vercel | ✅ | ❌ 接口不存在 | 必须走 **Supabase** |
| 腾讯云 EdgeOne Pages | ✅ | ✅ 云函数提供 | 用平台自带接口，不配 Supabase 也行 |
| 自己跑 `node server/server.js` | ✅ | ✅ | 两条都行 |

**最容易犯的错**：部署到 Pages / Vercel 之后，同步方式还留在
「自建 / 兼容服务器」。表现是同步胶囊一直灰着不动，
而页面本身看起来完全正常。先记住这条，排查表最后还会提。

> 走 Supabase 不需要你在任何平台后台配环境变量。
> 地址和 key 是在**应用的「设置」页面里填**的，存在浏览器本地。

---

## 1. 四条路线怎么选

| | Cloudflare Pages | Vercel | 腾讯云 EdgeOne Pages | 继续用 `node server/server.js` |
|---|---|---|---|---|
| 要注册 GitHub 吗 | 不用，可以直接传文件夹 | 建议有（也可以命令行传） | 要，走 Git 推送部署 | 不用 |
| 免费吗 | 免费，带宽不限量 | 免费，有额度（个人够用） | 有免费额度，需腾讯云实名账号 | 免费，但电脑要一直开着 |
| 手机能访问吗 | 能，有公网地址 | 能，有公网地址 | 能，国内节点、访问最快 | 只能在同一个 WiFi 里 |
| 同步怎么走 | Supabase | Supabase | **平台云函数自带 `/api/sync`** | 自建 `/api/sync` 或 Supabase |
| 适合谁 | **大多数人** | 已经有 GitHub / 习惯 Vercel 的人 | 在意国内访问速度、又不想依赖 Supabase 的人 | 只在家里或办公室局域网用 |

### 我的推荐：Cloudflare Pages

三个理由，按分量排：

1. **不用碰 Git。** 注册账号 → 拖个文件夹 → 完事。
   对"不想折腾"这件事来说，少一个 GitHub 环节是实打实的省事。
2. **缓存规则写在哪儿最清楚。** 就一个 `deploy/_headers` 文本文件（构建时由
   `tools/build.js --pages` 复制进 `public/`，所以**只改 `deploy/` 那份**，
   改 `public/` 里那份下次构建就没了），哪天你想调缓存，打开改数字就行。Vercel 的规则在 JSON 里，
   而 JSON 不能写注释 —— 三个月后你完全想不起来当初为什么这么写。
   （所以 Vercel 那份的"为什么"我写在下面第 7 节了。）
3. **免费版不限带宽。** 这个工具每天要同步很多次，
   虽然每次就几十 KB，但不限量总归省心。

Vercel 也不是不行，功能上完全够用。如果你已经在用 Vercel 部署别的东西，
那就继续用 Vercel，没必要为了它再注册一个 Cloudflare。

**继续用 `server/server.js` 的唯一理由**：你只想在公司 / 家里的 WiFi 里用，
且不想把数据放到任何第三方云上。代价是电脑一关，手机就打不开了。

---

## 2. 不管走哪条路：先把 Supabase 准备好

Supabase 是同步数据的"存放地"。免费版对个人完全够用。
**只有一台设备用的话，这一步可以跳过**——不同步也能用，数据存在浏览器里。
但浏览器数据清缓存就没了，所以建议还是配一个，就当备份。

### 2.1 建项目

1. 打开 [supabase.com](https://supabase.com) 注册（可以用 GitHub 账号直接登）
2. 右上角 **New project**
3. Name 随便填，比如 `sales-copilot`
4. Database Password 自己起一个，**记下来**（后面基本不用，但丢了没法找回）
5. Region 选 **Singapore（新加坡）** 或 **Tokyo（东京）** —— 离国内近，同步快
6. 点 Create，等大概两分钟

### 2.2 拿两个值

项目建好后，左侧 **Project Settings**（齿轮） → **API**，复制这两个：

- **Project URL**：长得像 `https://abcdefgh.supabase.co`
- **anon public**：一长串 `eyJhbGci...` 开头的字符

> **anon key 是公开的，泄露了也没事。** 这不是安慰话。
> 真正的权限闸门在数据库的 RLS（行级安全）策略上，
> `db/supabase.sql` 里已经配好了：每条记录只能被它自己的主人读写。
> 就算有人拿到你的 anon key 去直接查库，也只能查到他自己的东西。
>
> 反过来，**service_role 那个 key 打死都不能贴进网页**。
> 它绕过所有权限检查。看到 `service_role` 字样就别复制。

### 2.3 建表（执行 SQL）

左侧 **SQL Editor** → **New query**，把项目根目录的 **`db/supabase.sql`**
整个文件的内容粘贴进去，点 **Run**。

看到 Success 就成了。它会建 **6 张表**和对应的权限策略（每张表都是
`drop policy if exists` 再重建，可重复执行，幂等）：

| 表 | 装什么 |
|---|---|
| `profiles` | 用户与角色（owner / admin / member）、所属团队、显示名 |
| `teams` | 团队本身与 8 位邀请码 |
| `records` | 你的客户 / 商机 / 跟进 / 话术，一条记录一行，按 `user_id` 隔离 |
| `team_scripts` | 团队共享话术 |
| `user_settings` | 你的个人设置（含 AI Key），只有你自己读得到 |
| `sales_sync` | 整包快照模式（同步方式选「Supabase 空间」时）用的那一张表 |

### 2.4 建议关掉邮箱验证（重要）

左侧 **Authentication** → **Providers** → **Email**，
把 **Confirm email** 关掉，保存。

**为什么要关**：开着的话，注册完不会直接登录，而是发一封验证邮件，
你得去邮箱点链接。这个工具注册完是希望能立刻开始用的，
中间插一步收邮件，十个人有八个会卡在这儿以为注册失败了。

如果你就是想要邮箱验证，那也行 —— 注册完记得去邮箱点一下链接再回来登录。

---

## 3. 路线 A：Cloudflare Pages

### 先做一次：把站点文件归拢到 `public/`

这一步看着多余，其实是为了**防止客户数据被传上公网**。

项目根目录里有个 `data/` 文件夹，里面是真实的客户姓名、电话、微信。
而静态托管的意思是：你传上去的每一个文件，任何人都能下载。
要是直接把整个项目目录传上去，等于把客户名单挂在公网上任人扒。

所以固定只传 `public/` 这一个文件夹，里面只有网页本身的文件。

在项目目录下执行（macOS / Linux 终端，Windows 用 Git Bash）：

```bash
node tools/build.js --pages
```

执行完 `public/` 里应该有：所有 `.js`、`styles.css`、`index.html`、
三个图标、`manifest.json`、`_headers`，以及 `kb/knowledge.json`
（实战军火库的数据文件，话术库页点「加载军火库」时才会下载）。

> 军火库数据想换成自己的：改 `kb/knowledge.json`（或改
> `tools/kb-extra-*.json` 后跑 `python tools/gen-kb-seed.py` 重新生成），
> 再执行一次上面的构建命令。不想要军火库：删掉 `kb/` 目录即可，
> 页面上会明说加载失败，不影响其他功能。

> 这一步**每次改完代码要重新执行一遍**，再部署。
> 忘了的话，线上还是上一版 —— 而且不会有任何报错。

### 方式一：直接上传文件夹（最省事，推荐）

1. 注册 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 左侧 **Workers & Pages** → **Create** → **Pages** → **Upload assets**
3. 给项目起个名，比如 `sales-copilot`
4. 把 **`public` 这个文件夹整个拖进去**（不是拖里面的文件，是拖文件夹本身）
5. 点 **Deploy site**，等一分钟
6. 拿到一个 `https://xxx.pages.dev` 的地址，打开看看

以后要更新：回到这个项目 → **Create deployment** → 再拖一次文件夹。

### 方式二：连接 Git 仓库（改完代码自动上线）

如果你把代码放在了 GitHub / GitLab 上：

1. **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
2. 选仓库
3. 构建配置**照抄这两行**，一个字都别改：

   | 框 | 填什么 |
   |---|---|
   | Build command | `node tools/build.js --pages` |
   | Build output directory | `public` |

4. 保存并部署

以后 `git push` 一次，它就自动重新上线一次。**推荐用这种方式**，
因为它把上面那个"手动 cp"的步骤固化了，你不会忘。

### 方式三：命令行（`wrangler.toml` 就是给它用的）

```bash
node tools/build.js --pages
npx wrangler pages deploy public
```

`wrangler.toml` 里已经写好了项目名和输出目录，不用加参数。

### 最后：把 Supabase 填进应用

打开你的 `https://xxx.pages.dev` → **设置** → 找到「同步」那块：

1. **同步方式** 选 **Supabase / 云开发 REST**
2. **Project URL** 粘贴 2.2 里复制的那个
3. **anon key** 粘贴 2.2 里复制的那个
4. **表名** 保持 `sales_sync`（整包快照模式）
5. **空间名** 保持 `default`
   > 想要多个人各自独立？每个人填**不同的空间名**就行。
   > 填一样的会互相看到 —— 整包快照不认账号，只认空间名。
6. 点 **保存并连接**，再点 **立即同步**

同步胶囊变绿，就通了。

---

## 4. 路线 B：Vercel

1. 注册 [vercel.com](https://vercel.com)，用 GitHub 登录最省事
2. **Add New** → **Project** → 导入你的仓库
3. 关键：把 **Framework Preset** 改成 **Other**
   （仓库里的 `vercel.json` 已经写了 `"framework": null`，
   正常情况下它会自动帮你选对；如果发现它在问你要不要 build command，
   那就是没生效，手动改一下）
4. **Build Command 留空**，不用填 —— 这个项目零构建
5. 点 **Deploy**，等一分钟

> Vercel 会遵守 `.gitignore`，所以 `data/` 不会被传上去。
> 但保险起见，第一次部署完请照着第 5.5 条确认一下 `data/` 没泄露。

拿到 `https://xxx.vercel.app` 之后，填 Supabase 的步骤跟第 3 节最后那段一模一样。

---

## 4b. 路线 C：腾讯云 EdgeOne Pages（同步接口自带）

**什么时候选它**：在意国内访问速度，又不想把数据放到 Supabase 上。
它的**云函数**能给站点直接提供 `/api/sync`，等于把上面那个「静态托管跑不了 Node」的死结绕开了。

细节全在 [`deploy/edgeone/README.md`](../deploy/edgeone/README.md)，这里只给主干和最容易错的点：

1. 把 `deploy/edgeone/` 整个目录复制成你的站点仓库（它是个独立的小项目）
2. `node prepare.js` —— **每次升级都要跑**，理由见下
3. `npm install`（全仓库唯一有 npm 依赖的地方：`@edgeone/pages-blob`，需 Node ≥ 18）
4. 推到 Git → EdgeOne 控制台建 Pages 项目：框架选「其他 / 无」，安装命令 `npm install`，构建命令留空
5. 函数环境变量：`BLOB_STORE`（存储桶名，默认 `sales-copilot`）、`SYNC_TOKEN`（留空 = 多人模式，令牌即空间）、`MAX_DEVICES`（默认 20，超了返回 413）。改完要重新部署一次才生效
6. 验：浏览器开 `https://你的域名/api/health`，看到 `"ok":true` 且 `blobReady` 为真
7. 回应用「设置 → 云同步」，同步方式选 **自建 / 兼容服务器**，地址填 `https://你的域名/api/sync`

> **为什么必须有 `prepare.js`**：合并算法、令牌校验、空间映射这些「协议」在仓库里只写了一份，
> 就是 `js/core/sync-core.js`。EdgeOne 云函数是 ESM，用不了那份 CJS，所以脚本按
> `SYNC-CORE-BEGIN/END` 标记把它抽出来生成 ESM 副本。你改了主项目的 sync-core 却忘了重跑
> `prepare.js`，两边算法就开始漂移 —— 表现是同一份数据在设备和云端各算出不同结果，极难查。
> CI 里用 `node prepare.js --check` 当闸门，不一致直接红。

---

## 4c. 路线 D：自托管（`server/server.js` / Docker / systemd）

零依赖单文件，同时给静态站点和同步接口：

| 接口 | 作用 |
|---|---|
| `GET /api/health` | 免鉴权。看 `mode`（专属 / 多人）、`storage`（**必须是 `file`**，`memory` 说明写不进磁盘、重启即丢）、`spaces` |
| `GET /api/sync` | 拉本空间快照（需令牌）。云端还没数据时返回 404，属正常 |
| `PUT /api/sync` | 上传快照，服务端做 LWW 合并后返回合并结果。单次请求体上限 **8 MB** |
| `GET /api/backups` | 列出本空间的历史快照（文件名 / 时间 / 大小） |

**环境变量**（全部可选）：

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | 8080 | 监听端口，绑 `0.0.0.0` |
| `SYNC_TOKEN` | 空 | 设了 = 专属模式（只认这一个令牌）；不设 = 多人模式（任意 ≥8 位令牌各自开一个空间） |
| `BACKUP_KEEP` | 10 | 每个空间保留的近期快照份数 |
| `BACKUP_MIN_GAP` | 60000 | 两次近期快照的最小间隔（毫秒） |
| `MAX_SPACES` | 200 | 空间数上限，超出 503。没有频率限制，这条是公开部署唯一的护栏 |

数据落在 `data/`：每个空间一个 `store-<令牌哈希>.json`（tmp + rename 原子写），
多人模式下首次启动会把建议令牌写到 `data/token.txt`。备份在 `data/backups/`，
近期快照留 `BACKUP_KEEP` 份、每日快照留 7 天。**恢复**：停服 → 把选中的快照复制成
`data/store-<同一个哈希>.json` → 再起服务。

```bash
# 裸跑
SYNC_TOKEN=一串长随机字符 PORT=8080 node server/server.js

# Docker（在仓库根执行；模板在 deploy/ 下，必须用 -f 指过来）
docker build -t sales-copilot -f deploy/Dockerfile .
docker run -d --name sales-copilot -p 8080:8080 \
  -e SYNC_TOKEN=你自己的长令牌 -v $(pwd)/sync-data:/app/data \
  --restart unless-stopped sales-copilot

# systemd：照 deploy/sales-copilot.service 顶部的安装步骤走
```

> **三件必须注意的事**：
> 1. 镜像/发布包只带源码。仓库根的 `.dockerignore` 已经排除 `data/`、`public/`、`.env*`、`.git/`
>    —— 别为了"图省事"把它删了：`data/` 里是真实客户姓名电话，一旦进了镜像 layer，
>    后面删掉文件也还在历史层里，跟着 push 上去就是永久泄露。
> 2. 这个服务只讲 HTTP，**同步令牌等同数据访问凭证**。挂到公网必须前置 HTTPS 反代，
>    并且建议固定 `SYNC_TOKEN`（多人模式下任何人猜到一个 ≥8 位令牌就能看到那个空间）。
>    静态服务内置了一道闸：`data/`、`server/`、`node_modules/` 和任何以点开头的路径一律 403，
>    否则等于把令牌和客户名单挂在公网让人下载。**部署完照 §5.5 那三条 curl 验一遍**（要 403）。
> 3. 容器里 `data/` 一定要挂卷（`-v ...:/app/data`），systemd 下 `data/` 的属主要给服务用户，
>    否则写不进盘会静默退化成内存存储 —— 用 `curl localhost:8080/api/health` 看 `storage` 确认。

---

## 5. 部署后必做的验证清单

**本地能跑 ≠ 线上能跑。** 下面这几条请真的做一遍，每条都不超过两分钟。
前两条是这次踩过坑的地方，务必做。

### 5.1 确认 Service Worker 拿到的是新代码 ⚠️ 最重要

**为什么必须验**：这个项目的 Service Worker 以前是 cache-first，
导致修复发上线之后，用户刷新拿到的还是缓存里的旧 JS ——
bug 原样复现，看着像没修，其实是修复压根没送到。
本地和无痕窗口怎么测都是绿的（那两个环境没旧缓存），只有真机会中招。

**怎么验**：

1. 用 Chrome 打开你的线上地址，按 **F12** 打开开发者工具
2. 切到 **Application**（应用）标签 → 左侧 **Cache Storage**
3. 看里面那个缓存桶的名字：
   - 看到 **`sales-copilot-v3`** → ✅ 新的 SW 在管事
   - 看到 **`sales-copilot-v2`** → ❌ 还是旧的在管事，往下看"怎么修"
4. 再切到 **Network**（网络）标签，**刷新页面**（普通 F5 就行，**不要**勾 Disable cache，
   那样测不出真实情况）
5. 在请求列表里点 **`sw.js`**，看右侧 **Response Headers**：
   - 有 `cache-control: no-cache, no-store, must-revalidate` → ✅ 配置生效了
   - 没有这一行，或者写着 `max-age=31536000` 之类的大数字 → ❌ `_headers` 没生效

**如果没生效，按这个顺序查**：

1. `public/_headers` 是不是真的在**部署出去的那个目录的根**上？
   放错位置 Cloudflare 不报错，只是静默忽略 —— 这是最常见的原因。
   验证办法：浏览器直接访问 `https://你的域名/_headers`。
   - 返回 404 → ✅ 对了（这个文件不会被当作静态资源提供，说明被正确解析了）
   - 返回文件内容 → ❌ 它被当成普通文件上传了，位置错了
2. 部署之前有没有执行 `node tools/build.js --pages`？（`_headers` 和补齐的 `sw.js` 清单都由它生成，手动 cp 已经作废）
3. 缓存桶还是 v2 的话：在 **Application → Service Workers** 点 **Unregister**，
   然后**关掉整个标签页重开**（光刷新不行）。

### 5.2 确认清空数据后刷新不会再长出来 ⚠️

**为什么必须验**：以前有个 bug —— 用户清空数据想从头开始，
一刷新示例数据又自己长回来了。因为程序靠"库里是不是空的"
判断"这是不是新用户"，而"用户主动清空的库"也是空的，被误判了。

**怎么验**：

1. **设置** → 数据管理 → **清空全部业务数据** → 确认
2. 右上角同步胶囊变绿（说明"清空"这个动作已经传到云端了）
   —— **这一步别跳过**，只在本机清空的话，别的设备还会把它同步回来
3. 按 **F5** 刷新，再按 **Ctrl+Shift+R**（Mac 是 Cmd+Shift+R）硬刷新一次
4. 切到**客户库**：
   - 显示 0 条，没有示例客户 → ✅
   - 又冒出"示例客户" → ❌ 往下看

**如果又长出来了**：最可能的原因是 `settings.onboarded` 这个标记没跟着同步走，
两台设备互相灌。去 Supabase 后台 **Table Editor** → `records` 表，
搜一下有没有 `demo` 字段为 true 的记录。有的话删掉，然后两台设备都重新清空一次。

### 5.3 确认两个账号互相看不见

**⚠️ 必须用两个不同的浏览器来做这个测试。**
用同一个浏览器的两个标签页、或者退出再登录，都是**测不出来**的：

数据存在浏览器的 localStorage 里，而 localStorage 是按"网站"分的，
不是按"账号"分的。而且**退出登录只清登录状态，不清业务数据**
（这是刻意的：本地永远是你的数据，不会因为登出就没了）。
所以同一个浏览器里换账号，看到的还是上一个人的本地数据。

**正确做法**：用一个正常窗口 + 一个**无痕窗口**（Ctrl+Shift+N），
或者干脆用 Chrome 和 Edge 各一个。

1. **A 窗口**：注册 `a@test.com`，随便建一个客户，名字叫 **"测试-甲方"**
2. 等同步胶囊变绿
3. **B 窗口（无痕）**：注册 `b@test.com`，同步
4. 看 B 的客户库：
   - **搜不到"测试-甲方"** → ✅ RLS 生效了，隔离是对的
   - **能搜到** → ❌ 权限没配好，别用了，先看第 6 节的 403

**想再确认一层**：去 Supabase **Table Editor** → `records` 表，
两条记录的 `user_id` 应该是两个不同的 UUID。
一样的话说明两个账号被当成同一个人了。

### 5.4 确认离线能用

1. 打开线上地址，等页面完全加载
2. F12 → **Network** → 把 **Offline** 勾上（或者手机开飞行模式）
3. **F5 刷新**
4. 页面应该还能正常打开，数据还在

这个验的是 Service Worker 的离线缓存。如果白屏，
说明预缓存清单和实际文件对不上（`sw.js` 里的 `FILES` 数组）。

### 5.5 确认客户数据没泄露 ⚠️ 安全

**静态托管（Pages / Vercel）**：浏览器访问这两个地址，都应该是 404：

- `https://你的域名/data/`
- `https://你的域名/data/store-1c1ce8583d9a.json`（换成你 `data/` 里任意真实文件名）

**任何一个能打开、能看到客户姓名电话 → 立刻去平台后台把这个部署删掉**，
然后再回来按第 3 节重做（一定是输出目录填成了项目根）。

**自托管（`server/server.js` / Docker / systemd）**：这条更要紧，因为服务的站点根**就是仓库根**，
`data/` 就在里面。逐条访问，全部必须是 **403**：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://IP:8080/data/token.txt
curl -s -o /dev/null -w "%{http_code}\n" http://IP:8080/data/store-<你的哈希>.json
curl -s -o /dev/null -w "%{http_code}\n" http://IP:8080/data/backups/
```

- 403 → ✅ 拦截生效（`server/server.js` 的 `isPrivatePath`）
- **200 → ⚠️ 你跑的是修复前的版本**：`token.txt` 是同步令牌，`store-*.json` 是整份客户名单，
  谁都能下。先升级到含这道闸的版本，然后**换掉令牌**重新同步一遍
  —— 空间数据按令牌哈希寻址，旧令牌泄露过就一直有效，升级本身不会让它失效。

### 5.6 添加到手机主屏幕

手机浏览器打开线上地址 → 菜单 → **添加到主屏幕**。
之后它就像个 App 一样有个图标，点开是全屏的。

> iOS 上必须是 **Safari** 才有这个选项，Chrome 不行。
> 设置 → 检查安装状态，会告诉你当前是不是已经就绪。

---

## 6. 常见问题排查表

### 401 Unauthorized

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 设置页点「测试连接」报 401 | **这是好事**，说明地址和 key 都对 | 不用管。代码里判断"没登录时返回 401 就算通" |
| 登录时报 401 | 邮箱或密码错了 | 重新输。密码至少 6 位 |
| 同步时报 401，之前还好好的 | 登录过期了，自动续期也没续上 | 退出重新登录一次 |
| 所有请求都 401 | Project URL 或 anon key 粘错了 | 常见三种错：① 复制时多了空格 ② URL 末尾多了个 `/` ③ URL 里多带了 `/rest/v1`（只要 `https://xxx.supabase.co` 这一段） |

### 403 Forbidden

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 刚建完表就 403 | `db/supabase.sql` 没执行成功，或者只执行了一半 | 回 SQL Editor 重新跑一遍，看有没有红字报错 |
| 403 且确认表建好了 | 把 **service_role** key 当成 anon key 填进去了 | 换成 `anon public`。service_role 走的是另一套判定，不该出现在浏览器里 |
| 只有某一张表 403 | RLS 策略被改动过 | SQL Editor 重跑 `db/supabase.sql`，它里面对每张表都是 `drop policy if exists` 再重建，可以安全重复执行 |
| B 能看到 A 的数据 | 同上，RLS 没生效 | 同上。这条同时也是 5.3 那条验证失败的处理办法 |

### 404 Not Found

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 「测试连接」报 **"地址对得上，但表还没建"** | Project URL 是对的，但 `db/supabase.sql` 没跑 | 去 SQL Editor 执行 `db/supabase.sql` |
| 整个页面 404 | 部署时输出目录填错了 | Cloudflare 的输出目录必须是 `public`；Vercel 留空 |
| `sw.js` 或某个 `.js` 404 | 忘了执行 `node tools/build.js --pages`，或部署的不是 `public/` | 重新构建再部署 |
| 页面能开但功能缺失 | 同上，缺了几个模块文件 | 同上。这个项目的脚本有加载顺序依赖，缺一个就会连带坏掉好几个页面 |

### 其他

| 现象 | 原因 | 怎么办 |
|---|---|---|
| **同步胶囊一直灰着不动** | 同步方式还停在「自建 / 兼容服务器」，而 Pages / Vercel 上没有 `/api/sync` | 改成 **Supabase / 云开发 REST**（回到第 0 节） |
| 页面白屏，控制台一堆红字 | 缓存了旧代码 | 按 5.1 处理：Unregister SW → 关标签页重开 |
| 刷新看不到刚改的代码 | 同上 | 同上。另外确认部署前跑过 `node tools/build.js --pages` |
| 注册完提示去邮箱确认 | 邮箱验证没关 | 按 2.4 关掉；或者去邮箱点链接 |
| 换了个浏览器，Supabase 配置要重填 | 正常的。配置存在浏览器 localStorage 里 | 重填一次。或者用「数据码」把数据整个搬过去（设置 → 数据管理 → 复制数据码） |
| 清了浏览器缓存，数据没了 | localStorage 被清了 | 如果配了 Supabase，在新浏览器里填一遍配置，同步一次就回来了。**这也是为什么强烈建议开同步** |
| iOS 上找不到「添加到主屏幕」 | 用的不是 Safari | iOS 只有 Safari 能装 PWA |

---

## 7. 附：Vercel 那份配置为什么这么写

`vercel.json` 是 JSON，**里面不能写注释**，所以"为什么"记在这里。
（这也是我推荐 Cloudflare Pages 的原因之一 —— 它的 `_headers` 能写注释。）

```jsonc
"framework": null,        // 选「Other」。别让 Vercel 自作聪明去猜这是什么框架，
                          // 猜错了会给你加一个不存在的 build 步骤，直接部署失败

"cleanUrls": false,       // 不要自动去掉 .html 后缀。这个工具只有一个 index.html，
                          // 开这个只会凭空多出 308 跳转，没有任何好处

// 没有 rewrites、没有 redirects —— 是故意的。
// 单页应用常见的 `/* → /index.html` 那条重写在这里不需要：
// 站点只有一个页面，加了反而会把真实存在的 .js / .css 请求也劫持掉。
```

缓存部分（`headers` 数组）的逻辑和 `public/_headers` 完全一样：

- `sw.js`、`index.html`、根路径 `/` → `no-cache`
  理由见第 5.1 节，那是"更新通道"本身，缓存住了修复就送不出去
- 其余 `.js` / `.css` / `.json` → 5 分钟
  本项目文件名不带 hash，内容换了名字不换，所以**不能给长缓存**
- `.png` 图标 → 1 天（真不会变的东西）

一个实现上的细节：Vercel 命中多条规则时**所有规则都会应用**，
而 `sw.js` 本身也是个 `.js` 文件。所以匹配普通 JS 的那条特意写成了
`"/((?!sw\\.js).*).js"` —— 用负向前瞻把 `sw.js` 排除掉，
让每条规则各管各的，谁也不会覆盖谁。
以后如果你加了别的 Service Worker 文件，记得也排进这个排除列表。

---

## 8. 附：部署相关文件清单

| 文件 | 作用 |
|---|---|
| `deploy/_headers` | Cloudflare Pages 缓存规则的**源文件**，构建时复制成 `public/_headers`。**改缓存改这份** |
| `wrangler.toml` | Cloudflare Pages 项目配置（`name=sales-copilot`、`pages_build_output_dir=public`），命令行部署时用 |
| `vercel.json` | Vercel 的项目与缓存配置（理由见第 7 节） |
| `tools/build.js` | 两个产物的唯一入口：单文件 HTML、`public/` 部署目录（顺带复制 `_headers`、重写 `sw.js` 清单、做 `data/` 泄漏检查） |
| `sw.js` | Service Worker，缓存桶 `sales-copilot-v3`，`html/js/css/根路径` 走网络优先 |
| `deploy/Dockerfile` | 自托管容器模板（**在仓库根**用 `-f deploy/Dockerfile` 构建） |
| `.dockerignore` | 挡 `data/`、`public/`、`.env*`、`.git/` 不进镜像层 |
| `deploy/sales-copilot.service` | systemd 守护模板（含 `ProtectSystem=strict` 加固与 data 属主步骤） |
| `deploy/edgeone/` | 腾讯云 EdgeOne Pages 适配器（云函数提供 `/api/sync` + `/api/health`），自带 README |
| `db/supabase.sql` | Supabase 6 张表 + RLS 策略 + security definer 函数，幂等可重跑 |
| `.github/workflows/supabase-keepalive.yml` | 每 3 天 ping 一次免费 Supabase 项目防休眠；检测到暂停会标红提醒 |
| `docs/DEPLOY.md` | 你正在看的这份 |
