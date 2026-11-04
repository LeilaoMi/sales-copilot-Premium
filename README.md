# 销冠助手 · 个人销售作战台

[![CI](https://github.com/LeilaoMi/sales-copilot-Premium/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/LeilaoMi/sales-copilot-Premium/actions/workflows/ci.yml)
[![版本](https://img.shields.io/github/v/release/LeilaoMi/sales-copilot-Premium?label=版本)](https://github.com/LeilaoMi/sales-copilot-Premium/releases)
[![许可](https://img.shields.io/badge/许可-保留所有权利-lightgrey)](LICENSE)

> 跑在浏览器里的个人销售作战台：本地优先、断网可用、可安装到主屏幕，按需开启 Supabase 云同步和团队看板。

- 线上地址：<https://sales.leilaomi.cc.cd>（Cloudflare Pages，`main` 分支合并后自动部署）
- 当前版本：**1.0.1**，变更见 [CHANGELOG.md](CHANGELOG.md)
- 技术栈：原生 HTML / CSS / JavaScript，无框架、无 CDN、无运行时 npm 依赖
- 规模：`js/` 下 18 个模块（17 个由 `index.html` 按顺序加载），另有零依赖 Node 同步服务；代码约 1.56 万行

> **许可**：版权所有 © 2026 LeilaoMi，保留所有权利。仓库公开仅供查阅，未经书面许可不得复制、修改、分发或部署。下文的安装与部署说明供作者及获授权者使用，详见 [LICENSE](LICENSE)。

---

## 目录

1. [定位](#1-定位)
2. [功能](#2-功能)
3. [快速开始](#3-快速开始)
4. [使用指南](#4-使用指南)
5. [同步与团队](#5-同步与团队)
6. [部署](#6-部署)
7. [数据与隐私](#7-数据与隐私)
8. [项目结构](#8-项目结构)
9. [配置项](#9-配置项)
10. [开发与测试](#10-开发与测试)
11. [常见问题](#11-常见问题)
12. [版本与许可](#12-版本与许可)

---

## 1. 定位

传统 CRM 填十几个字段才能存一条跟进，结果是晚上凭印象补记。销冠助手只围绕一件事：**在客户楼下等电梯的 30 秒里，把刚发生的事记完。**

| 对比项 | 常见 CRM | 销冠助手 |
|---|---|---|
| 记一条跟进 | 打开表单 → 选客户 → 选类型 → 填内容 → 提交 | 一句话，回车，确认即存 |
| 安装 | 公司服务器 / SaaS 账号 | 一个网址，或一个 HTML 文件 |
| 断网 | 用不了 | 照常用，联网后自动补同步 |
| 数据归属 | 厂商的库 | 你浏览器的 localStorage，开同步才上云 |

三条原则：

1. 先是一个人的本地工具，再是团队工具；不登录也能完整使用。
2. 规则优先，AI 兜底；没网也能记。
3. 先出结果再确认入库；脏数据比不记更糟。

---

## 2. 功能

底部共 9 个页签，`团队` 只对管理员显示。

| 模块 | 说明 |
|---|---|
| 战情台 | 顶栏三项实时指标（本月业绩、目标完成、待跟进），目标环形图、在谈商机加权预测、今日作战清单、近 6 个月业绩、销售漏斗、客户分级、冲刺提示 |
| 客户库 | A 重点 / B 常规 / C 观察三级；状态潜在 / 跟进中 / 已成交 / 已流失；详情含跟进时间线、关联商机和推荐话术 |
| 商机看板 | 七列拖拽：线索 10%、接触 25%、方案 45%、报价 65%、谈判 80%、赢单 100%、输单 0%。拖到赢单计入业绩，拖到输单提醒补原因并弹复盘 |
| 跟进日志 | 全部跟进倒序，按客户和类型筛选；粘贴聊天记录即提取承诺、异议、下一步、风险（纯规则，离线可用），可选 AI 深度解析 |
| 话术库 | 内置 48 条（9 类）+ 可加载的实战军火库 78 条（15 类），语义检索；赢单、输单当场沉淀 |
| 周报 | 本周 / 上周 / 近 7 天 / 本月 / 上月 / 近 30 天六个口径，四段式文本可直接复制 |
| AI 助手 | 跟进纪要、周报润色、输单复盘、作战建议、客户作战简报、话术军火 6 个场景；不配 Key 不影响其他功能 |
| 团队 | 管理员可见的进度看板：按人汇总在谈金额、商机数、本月赢单、逾期、沉默天数。只拿统计字段，看不到成员的客户内容 |
| 设置 | 目标、提成、AI、同步、账号与团队、健康度、提醒、数据管理、安装状态；底部显示版本号 |

跨模块：顶栏全局搜索、`+ 记跟进` / `+ 新客户` 快捷按钮、同步胶囊（显示状态，点击立即同步）、到期桌面通知、PWA 安装、`Esc` 关闭弹窗。

---

## 3. 快速开始

### 3.1 环境要求

| 用途 | 需要 |
|---|---|
| 使用 | 任一现代浏览器（Chrome、Edge、Safari、Firefox） |
| 构建、自托管同步服务 | Node.js ≥ 18（`package.json` 的 `engines`；CI 与 Docker 镜像用 Node 22）。只用内置模块，**无需 `npm install`** |
| 云同步 / 团队 | 一个 Supabase 项目 |
| EdgeOne 同步后端 | Node ≥ 18 + `@edgeone/pages-blob`（仅 `deploy/edgeone/` 需要安装依赖） |
| 数据库权限测试 | `tools/rls/` 下 `npm install`（PGlite） |
| 重新生成军火库 | Python 3 |

通知和 PWA 安装要求 HTTPS 或 localhost。

### 3.2 本地运行源码

```bash
git clone https://github.com/LeilaoMi/sales-copilot-Premium.git
cd sales-copilot-Premium
python3 -m http.server 8000      # 或 node server/server.js
# 浏览器打开 http://localhost:8000
```

不能直接双击 `index.html`：浏览器不允许 `file://` 加载多个脚本文件。

### 3.3 单文件版

```bash
npm run build:single             # 等同 node tools/build.js
```

生成 `销冠助手-单文件版.html`（约 540 KB），**写在仓库的上一级目录**，双击即可使用。取舍：没有实战军火库（`file://` 读不到 `kb/knowledge.json`），不注册 Service Worker（无离线缓存与安装），不发系统通知；其余功能与网页版一致。

### 3.4 自带同步服务

```bash
node server/server.js                         # http://localhost:8080
SYNC_TOKEN=至少16位的随机串 node server/server.js  # 专属模式
```

同一进程提供静态站点和同步接口，详见 [第 6.3 节](#63-自托管)。

首次打开会载入示例数据（10 家客户、19 个商机、13 条跟进），在设置里清空后不会再出现。

---

## 4. 使用指南

### 4.1 一句话录入

战情台顶部输入框，一句话回车自动拆字段，确认后入库，原文保留。

```
今天去了王总那儿，聊了报价，他说下周三再联系
```

| 字段 | 结果 | 依据 |
|---|---|---|
| 客户 | 恒力精工制造（王建国） | `王总` 按姓加职务命中 |
| 类型 | 拜访 | `去了` |
| 下次跟进 | 下周三 | 意图词 `再联系` 附近的时间 |

- 客户匹配三轮：全名最长命中 → 4 到 2 字简称（重名弹候选）→ 姓加职务（15 个职务词，复姓单独处理，同姓用公司简称消歧）。
- 时间支持今天 / 明天 / 后天 / 大后天 / 周X / 下周X / 下下周X / N 天后 / N 周后 / N 个月后 / 月底 / 具体日期（已过的日期滚到明年），中文数字可用。
- 只有出现 `下次 / 回头 / 再联系 / 再跟进 / 改天 / 到时候` 等意图词才设下次跟进，且只取意图词附近的时间。`他说下周三报价` 是对方的时间，不会设成你的跟进。

### 4.2 聊天记录提取

跟进日志页粘贴一段聊天记录，规则版立刻给出：我方承诺、客户承诺（带日期）、异议（13 类）、下一步、金额与数量、6 组风险信号。全部是草稿，勾选后才入库。配了 AI Key 可切换「AI 深度解析」，结构相同，多出摘要和建议回复。

### 4.3 商机健康度

在谈商机从 100 分起扣，四个信号独立计算，并给出一句话动作建议：

| 信号 | 最多扣 | 判定 |
|---|---|---|
| 沉默 | 35 | 对比你自己的跟进节奏，超过 1.6 倍算异常，1 到 2.5 倍线性扣分 |
| 阶段停滞 | 30 | 对比你走完该阶段的历史中位耗时（需至少 3 个样本） |
| 临期 / 过期 | 35 | 过期超 14 天扣 35，14 天内扣 25，剩 3 天内扣 12，剩 7 天内扣 6 |
| 无实质推进 | 10 | 近 30 天没换阶段也没跟进 |

节奏基准需要至少 3 条跟进才采信（中位数限制在 3 到 90 天），不足时按客户分级估算（A 12 天、B 18 天、C 30 天）并在页面注明。新建 3 天内不评级；点「知道了」后默认 7 天不再提示；灵敏度三档 0.7 / 1 / 1.5（代码支持 0.4 到 2.5）。低于 50 分为风险，低于 75 分为提醒。

### 4.4 回款预测与目标倒推

```
保守 = Σ(金额 × 本月内成交概率 × 阶段赢率)
乐观 = Σ(金额 × 本月内成交概率)
```

阶段赢率优先用你的历史成交计算（至少 3 单且有输有赢），否则用默认档。没填预计成交日的商机按最低估并提醒补填。倒推给出差额、差几单、是否来得及，月末最后 10 天才提示缺口。

### 4.5 话术库与实战军火库

内置 48 条（`js/features/playbook.js` 的 `SEED`）：异议处理 16、催单推进 6、开场破冰 5、需求挖掘 5、售后维护 5、谈判博弈 4、方案报价 3、复盘沉淀 2、交付履约 2。

检索为四路加权：意图标签 0.40、分词余弦 0.30、全文 0.15、标签字面 0.15。`嫌贵` 能命中标题里没有「贵」字的话术，结果会显示命中的场景。

实战军火库 78 条（`kb/knowledge.json`，点「加载军火库」时才下载）：异议应对 18、开场破冰 10、催单推进 6、谈判博弈 6、方案报价 5、行业知识 5、需求挖掘 5、复盘沉淀 4、标准话术 4、流程方法 4、售后维护 3、交付履约 2、客户关系 2、成交案例 2、竞品对比 2。内容由 AI 辅助整理，使用前请自行核实；存入自己的话术库后可编辑。

### 4.6 AI 助手

设置里选服务商、填 Key、保存并测试。共 32 个选项，均走 OpenAI 兼容协议，地址写法不对时会自动尝试常见变体。

| 分组 | 服务商 |
|---|---|
| 国内（12） | DeepSeek、智谱 GLM、通义千问、硅基流动、Kimi、豆包、百度千帆、讯飞星火、腾讯混元、阶跃星辰、零一万物、MiniMax |
| 海外（16） | OpenAI、Azure OpenAI、Claude、Gemini、Groq、Mistral、Grok、OpenRouter、Together、Fireworks、Perplexity、Cerebras、SambaNova、Nebius、Novita、DeepInfra |
| 本机 / 自建（3） | Ollama、LM Studio、vLLM（需开启跨域） |
| 自定义（1） | 任意 OpenAI 兼容地址 |

豆包、讯飞星火、Groq、Cerebras、SambaNova 五家的接口不允许浏览器直连（CORS），下拉里有标记。

**联网增强（选填）**：另填一个 Tavily Key，「客户作战简报」会并行查询公司动态和行业趋势，来源随简报列出；不填则纯模型生成并标注「待核实」。

### 4.7 周报与陪练

周报由本地台账直接计算，四段式（进展 / 重点客户 / 下一步 / 风险），可让 AI 润色。

陪练由 AI 扮演客户，三种难度，每 3 轮点评一次，结束打 0 到 100 分。场景取自话术库中以「客户说」「对方」开头的条目（内置 48 条中有 23 条），你新建的同格式话术会自动加入。没配 Key 时改为对照参考答案练习。

### 4.8 跟进提醒

只提醒两类：已逾期，以及 48 小时内到期。每 30 分钟检查一次，每天最多一轮（按客户和到期日去重），点击跳到客户库。没有通知权限时改为页面角标。提醒靠页面内定时检查，**页面或已安装的应用需要开着**；安卓 Chrome 经 Service Worker 弹出通知。

### 4.9 备份与换机

设置 → 数据管理：

- **导出备份 JSON**：默认不含 API Key 和同步凭据；勾选后才包含。
- **导入备份**：保留本机设备 ID 和凭据。
- **导出客户 CSV**：带 UTF-8 BOM，Excel 直接打开。
- **数据码**：全量数据压成一段文本，发给自己后在另一台设备粘贴导入；不含 Key 和凭据。
- **载入示例 / 清空业务数据 / 压缩数据**（清除 30 天前的删除记录）。

存储写入失败或数据损坏时会弹出提示，损坏的原文另存一份，不会被覆盖。iPhone / Mac 的 Safari 对未添加到主屏幕的网站可能在 7 天未访问后清除本地数据，设置页会显示浏览器是否授予了长期保存。

---

## 5. 同步与团队

### 5.1 四种同步模式

设置 → 云同步，可随时切换：

| 模式 | 界面名称 | 粒度 | 适合 |
|---|---|---|---|
| `off` | 关闭（仅存本机） | — | 单台设备 |
| `http` | 自建 / 兼容服务器 | 整包快照 | `server/server.js` 或 EdgeOne 适配器 |
| `supabase` | Supabase 空间 | 整包快照 | 一个人多台设备，共用 `sales_sync` 表，按「空间名」隔离 |
| `cloud` | Supabase 账号 | 逐条记录 + RLS | 多人 / 团队，按账号隔离 |

- 本地优先：先写 localStorage 再上云。逐条按 `updatedAt` 后写覆盖，删除用墓碑标记同步。
- 本地改动 4 秒后推送，每 60 秒拉取一次（标签页在后台时暂停），断网重连后立即补同步。
- `supabase` 模式的空间名至少 16 位，相当于密码：数据库只返回请求头 `x-sync-space` 与之相同的那一行。推送内容不含 AI / 搜索 Key 和同步配置。
- `settings.sync` 始终以本机为准，不会被远端覆盖。

### 5.2 账号登录

Supabase 地址与 publishable key 内置在 `js/core/auth.js` 的 `DEFAULT_CLOUD`，指向作者的项目。新设备首次打开会弹出登录页，登录后自动切到 `cloud` 模式并拉取数据；点「先逛逛」则保持纯本地，之后不再自动弹出。首次同步后会清理本机的示例数据。可在设置「账号与团队」里换成自己的 Supabase 项目。

### 5.3 团队

1. 在 Supabase SQL Editor 执行 `db/supabase.sql`（幂等）。
2. 设置里填 Project URL 和 anon key（用内置项目可跳过）。
3. 首个注册者自动成为拥有者并建队，可生成 12 位邀请码（旧的 8 位码仍有效）；同一账号 15 分钟内输错 10 次会被限流。
4. 同事在「账号与团队」里输入邀请码加入。

角色分 `owner` / `admin` / `member`，隔离做在 Postgres RLS：

- 成员只能读写自己的记录；记录的 `team_id` 由数据库按当前所在团队决定，退队后自动清空。
- 用户不能修改自己的角色和所属团队（列级守卫触发器）。
- 管理员**不能直接读取**成员记录，团队看板只能通过 `team_record_facts()` 拿到阶段、金额、成交日、下次跟进日、跟进时间五个字段；看不到客户名、电话、备注，也看不到成员的 API Key。
- `team_scripts`（团队共享话术）表已建好，前端尚未接入，话术库目前仍是个人的。

数据表：`profiles`、`teams`、`records`、`team_scripts`、`user_settings`、`sales_sync`、`join_attempts`（邀请码限流），保活表 `keepalive_logs` 在 `db/keepalive.sql`。

---

## 6. 部署

完整步骤、验证清单和排错表见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

| 目标 | 方式 | 同步 |
|---|---|---|
| Cloudflare Pages（线上在用） | 连接 GitHub：构建命令 `node tools/build.js --pages`，输出目录 `public` | Supabase |
| Vercel | 导入仓库，Framework 选 Other，Build Command 留空（`vercel.json` 已配好） | Supabase |
| 腾讯云 EdgeOne Pages | 见 [deploy/edgeone/README.md](deploy/edgeone/README.md)，云函数 + Blob 提供 `/api/sync` | 自建接口 |
| 自有服务器 | `node server/server.js`，或 `deploy/Dockerfile`、`deploy/sales-copilot.service` | 两种都行 |

### 6.1 静态托管只发布 `public/`

`node tools/build.js --pages` 会清空并重建 `public/`：按 `index.html` 的实际引用复制资源、复制 `deploy/_headers`、重写 `sw.js` 的预缓存清单，并在 `public/` 中出现 `data/` 或业务 JSON 时报错中止。不要手动复制文件替代。

### 6.2 线上站点

- 地址 <https://sales.leilaomi.cc.cd>，合并到 `main` 后由 Cloudflare Pages 自动构建部署，约 1 分钟生效。`*.pages.dev` 地址只作预览。
- 安全头（CSP、`X-Frame-Options` 等）和缓存规则在 `deploy/_headers`；`sw.js`、`index.html`、根路径不缓存。
- 该域名已关闭会向页面注入脚本的 JavaScript Detections，否则会与 CSP 冲突（设置作用于整个 `leilaomi.cc.cd` 区域）。
- 已有数据库升级时，按日期顺序执行 `db/migrations/` 下的迁移；新建库只需执行 `db/supabase.sql`。

### 6.3 自托管

`server/server.js` 同时提供静态站点与以下接口：

| 接口 | 作用 |
|---|---|
| `GET /api/health` | 免鉴权，返回模式、存储类型（应为 `file`）、空间数 |
| `GET /api/sync` | 拉取本空间快照（需令牌） |
| `PUT /api/sync` | 上传快照，服务端合并后返回；请求体上限 8 MB |
| `GET /api/backups` | 列出本空间历史快照 |

其他 `/api/*` 返回 404；`data/`、`server/`、`node_modules/` 和点开头的路径返回 403。

- 不设 `SYNC_TOKEN` 时为多人模式：任意至少 8 位的令牌各开一个独立空间，首次启动会把建议令牌写入 `data/token.txt`。
- 数据写入 `data/store-<令牌哈希>.json`（临时文件 + 重命名，原子替换），近期快照保留 10 份、每日快照保留 7 天，在 `data/backups/`。
- 只提供 HTTP，公网部署必须前置 HTTPS 反向代理，并建议设置固定 `SYNC_TOKEN`。
- Docker：在仓库根执行 `docker build -t sales-copilot -f deploy/Dockerfile .`，镜像为 `node:22-alpine`、非 root 用户运行、带健康检查，容器内默认 `REQUIRE_DISK=1`（数据目录不可写时拒绝启动）。

### 6.4 Supabase 保活

`.github/workflows/supabase-keepalive.yml` 每 3 天向 `keepalive_logs` 写入一行（当前覆盖生产项目和一个测试项目），防止免费项目因 7 天不活跃被暂停；检测到项目休眠时任务会失败提醒。GitHub 会在仓库 60 天无活动后停用定时任务，workflow 每次运行会重新启用它。

---

## 7. 数据与隐私

| 问题 | 说明 |
|---|---|
| 数据存哪 | 浏览器 localStorage，键名 `sales_copilot_v1`；开启同步后云端另有一份 |
| 默认云端 | 登录页默认连接作者的 Supabase 项目。用它登录并同步，数据就存放在该项目中。不希望如此，可换成自己的 Supabase，或只在本机使用 |
| 团队管理员 | 只能看到统计数字，读不到成员的客户名、电话、备注 |
| API Key | 只存本机浏览器，直连你配置的服务商；同步、数据码、默认导出都不包含 |
| AI 与联网 | 使用 AI 功能时，相关客户名称、备注、跟进内容会发送给你配置的 AI 服务商；作战简报会把公司名发给 Tavily |
| Supabase anon key | 可以公开，权限由 RLS 控制；**service_role key 绝不能放进网页** |
| `data/` | 自托管服务的快照目录，含令牌和全量客户数据，已加入 `.gitignore` 和 `.dockerignore`，服务对外返回 403 |
| 清浏览器数据 | 本地数据会丢失。请开启同步，或定期导出备份 |

---

## 8. 项目结构

```
sales-copilot-Premium/
├── index.html              唯一页面，脚本按依赖顺序加载
├── manifest.json           PWA 清单
├── sw.js                   Service Worker（缓存 sales-copilot-v7，预缓存清单由构建重写）
├── package.json            版本号与 npm 脚本（无依赖）
├── CHANGELOG.md · LICENSE
├── vercel.json             Vercel 安全头与缓存配置
├── wrangler.toml           Cloudflare Pages 配置（项目 sales-copilot-premium，输出 public）
├── assets/                 styles.css（约 700 行）与 4 个图标
├── js/
│   ├── core/               store 数据层 · sync 四种同步模式 · auth 登录与团队接口
│   │                       team 团队看板聚合 · sync-core 同步协议（服务端与 EdgeOne 共用，页面不加载）
│   ├── features/           quicklog 一句话录入 · digest 聊天提取 · health 健康度 · playbook 话术检索
│   │                       armory 军火库 · coach 话术推荐 · report 周报 · sparring 陪练
│   │                       ai AI 接入 · charts SVG 图表 · notify 提醒
│   └── ui/                 views 渲染 · ui 事件与动作
├── server/server.js        零依赖同步服务 + 静态站点 + 快照备份
├── db/
│   ├── supabase.sql        全部业务表、RLS 策略、函数（幂等）
│   ├── keepalive.sql       保活表
│   ├── new_table_template.sql  新增表的 RLS 模板
│   └── migrations/         已有库的增量迁移（按日期命名，幂等）
├── kb/knowledge.json       军火库数据
├── tools/                  build.js 构建 · test*.js 回归测试 · rls/ 数据库权限测试
│                           gen-kb-seed.py 与 kb-extra-*.json 军火库生成
├── deploy/                 _headers · Dockerfile · systemd 单元 · edgeone/ 适配器
├── docs/DEPLOY.md          部署手册
└── .github/workflows/      ci.yml · supabase-keepalive.yml
```

构建产物 `public/` 与自托管数据 `data/` 均不入库。几处脚本顺序是硬依赖并已在 `index.html` 注明：`playbook.js` 在 `store.js` 之前，`digest.js` 依赖 `quicklog.js`，`sparring.js` 依赖 `ai.js`，`team.js` 依赖 `auth.js`。

---

## 9. 配置项

### 9.1 应用内（设置页，存 localStorage）

| 卡片 | 配置项 | 默认值 | 说明 |
|---|---|---|---|
| 个人与目标 | `owner` | 张伟 | 顶栏与团队看板显示名 |
| | `monthlyTarget` | 300000 | 月度回款目标 |
| | `commissionRate` | 3 | 提成比例 % |
| AI 助手 | `ai.provider / base / model / key` | DeepSeek / `https://api.deepseek.com/v1` / `deepseek-chat` / 空 | Key 只存本机 |
| | `tavily.key` | 空 | 作战简报联网增强 |
| 商机健康度 | `health.enabled / sensitivity / snoozeDays` | 开 / 1 / 7 | |
| 云同步 | `sync.mode` | `off` | `off` / `http` / `supabase` / `cloud` |
| | `sync.endpoint / token` | 空 | 自建服务地址与令牌 |
| | `sync.url / key / table / space` | 表 `sales_sync` | 空间名至少 16 位，可随机生成 |
| 账号与团队 | `cloud.url / key` | 内置 | 清空即恢复内置默认 |
| 跟进提醒 | `notify.enabled` | 开 | 关闭后只保留页面角标 |

### 9.2 服务端环境变量（`server/server.js`）

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | 8080 | 监听端口（`0.0.0.0`） |
| `SYNC_TOKEN` | 空 | 设置后为专属模式；须至少 16 位且不能是模板占位符，否则拒绝启动 |
| `BACKUP_KEEP` | 10 | 每个空间保留的近期快照份数 |
| `BACKUP_MIN_GAP` | 60000 | 两次近期快照的最小间隔（毫秒） |
| `MAX_SPACES` | 200 | 空间数上限，超出返回 503 |
| `REQUIRE_DISK` | 空 | 设为 `1` 时数据目录不可写即拒绝启动（Docker 镜像默认开启） |

EdgeOne 适配器的变量（`SYNC_TOKEN`、`BLOB_STORE`、`MAX_DEVICES`、`MAX_SPACES`）见其 README。

---

## 10. 开发与测试

```bash
npm test                          # 核心测试 + 版本一致性
npm run build                     # 生成 public/

# 全部回归（CI 在每次推送和 PR 时运行同一套）
node tools/test.js            # AI 提示词、复盘、周报、军火库检索
node tools/test-server.js     # 自建同步服务：畸形请求、UTF-8 分包、413、CSP、写盘失败、静态白名单
node tools/test-xss.js        # 页面渲染转义
node tools/test-sync.js       # 快照同步：空间名、请求头、凭据不上云
node tools/test-cloud-sync.js # 账号同步：分页不漏行、推送游标
node tools/test-storage.js    # 本地存储损坏 / 写满 / 多标签页、离线不登出、团队看板
node tools/test-tz.js         # 日期在 UTC−、UTC+8、UTC+14 下都按本地计算
node tools/test-quicklog.js   # 一句话录入
node tools/test-digest.js     # 聊天记录提取
node tools/test-health.js     # 健康度缓存
node tools/test-minor.js      # 其余细节修复
node tools/test-version.js    # 版本号三处一致、LICENSE 存在
node tools/test-sw.js         # 离线缓存与安卓通知
node tools/test-edgeone.mjs   # EdgeOne 适配器
node deploy/edgeone/prepare.js --check       # EdgeOne 同步协议副本是否最新
(cd tools/rls && npm install && npm test)    # 数据库权限（PGlite 内存 Postgres）
```

CI 另外构建并实测 Docker 镜像。

| 要改的 | 位置 |
|---|---|
| 加页面 | `views.js` 渲染 → `ui.js` 动作 → `index.html` 页签（构建会自动补进 SW 清单） |
| 加数据字段 | `store.js` 的 `emptyState()` 与 `migrate()` |
| 改话术种子 | `playbook.js` 的 `SEED` |
| 改军火库 | 编辑 `tools/kb-extra-*.json` → `python tools/gen-kb-seed.py` → 重新构建 |
| 改 AI 服务商 | `ai.js` 的 `PROVIDERS`（`cors:false` 标记不能直连的服务商） |
| 改同步协议 | `js/core/sync-core.js` 改完运行 `node deploy/edgeone/prepare.js`；浏览器侧在 `js/core/sync.js`，两侧语义必须一致 |
| 改数据库 | 同时改 `db/supabase.sql` 和新建 `db/migrations/<日期>-<名称>.sql`，并在 `tools/rls/` 补测试 |
| 改缓存与安全头 | `deploy/_headers` 和 `vercel.json`；不要手改 `sw.js` 的预缓存清单 |
| 新增测试文件 | 同步加入 `.github/workflows/ci.yml` 和本节 |

**发版**：同时修改 `package.json`、`js/core/store.js` 的 `VERSION`、`CHANGELOG.md`，改动前端文件时把 `sw.js` 的缓存名加一，合并后打 `vX.Y.Z` 标签并发布 Release。

---

## 11. 常见问题

| 现象 | 处理 |
|---|---|
| 双击 `index.html` 白屏 | `file://` 无法加载多个脚本。用本地 HTTP 服务，或用单文件版 |
| 单文件版没有军火库 | `file://` 读不到 `kb/knowledge.json`，内置 48 条话术照常可用 |
| 同步胶囊一直灰色 | 静态托管上没有 `/api/sync`，同步方式选了「自建 / 兼容服务器」。改选「Supabase 空间」或「Supabase 账号」 |
| 上线后刷新仍是旧版 | Service Worker 缓存。关掉所有标签页重开；仍不行按 `docs/DEPLOY.md` 第 7.1 节检查 |
| 豆包、讯飞星火等一直失败 | 这些接口不允许浏览器直连，换 DeepSeek、智谱、通义或硅基流动 |
| 同一浏览器换账号仍看到上一个人的数据 | localStorage 按网站隔离而非按账号，退出登录不清业务数据。验证隔离请用两个浏览器或无痕窗口 |
| 团队看板为空 | 只有 owner / admin 可见，且需已加入团队、成员已同步过数据 |
| 通知不响 | 需要 HTTPS 和通知权限；只提醒逾期和 48 小时内到期；页面需开着 |
| 输入邀请码提示失败 | 检查邀请码是否正确；短时间多次输错会被限流 15 分钟 |

---

## 12. 版本与许可

- 版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)，变更记录见 [CHANGELOG.md](CHANGELOG.md)，发布见 [Releases](https://github.com/LeilaoMi/sales-copilot-Premium/releases)。
- 版权所有 © 2026 LeilaoMi，保留所有权利。仓库公开仅供查阅，未经书面许可不得复制、修改、分发或部署，详见 [LICENSE](LICENSE)。
