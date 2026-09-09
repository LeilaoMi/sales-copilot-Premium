# 销冠助手 · 个人销售作战台

> 零依赖 · 本地优先 · 断网可用 · PWA 可安装 · Supabase 可选同步
>
> 一个跑在浏览器里的个人销售作战台。没有账号体系也能用，没有服务器也能记，没有月费。
> 打开网页就能用，关掉网页数据还在。

- 仓库：https://github.com/LeilaoMi/sales-copilot-Premium
- 技术栈：原生 HTML / CSS / JavaScript，无框架、无 npm 运行时依赖、无 CDN
- 代码规模：`js/` 下 18 个模块（17 个由 `index.html` 按序加载）+ 1 个零依赖 Node 同步服务，全仓库约 1.45 万行

---

## 目录

- [1. 为什么是它](#1-为什么是它)
- [2. 功能总览](#2-功能总览)
- [3. 环境要求](#3-环境要求)
- [4. 安装与运行](#4-安装与运行)
- [5. 使用方法](#5-使用方法)
- [6. 部署到线上](#6-部署到线上)
- [7. 数据与隐私](#7-数据与隐私)
- [8. 项目结构](#8-项目结构)
- [9. 常见配置项](#9-常见配置项)
- [10. 本地开发](#10-本地开发)
- [11. 常见问题 FAQ](#11-常见问题-faq)

---

## 1. 为什么是它

销售工具的通病是：**记起来太麻烦，所以用两天就废了。**

传统 CRM 填十几个字段才存得进一条跟进，结果就是晚上补记、凭印象填、数据全是假的。
本工具只围绕一件事：**让你在客户楼下等电梯的 30 秒里，把刚发生的事记完。**

| 对比项 | 常见 CRM | 销冠助手 |
|---|---|---|
| 记一条跟进 | 打开表单 → 选客户 → 选类型 → 填内容 → 提交 | 一句话，回车，确认即存 |
| 安装 | 公司服务器 / SaaS 账号 | 一个 HTML 文件，或一个网址 |
| 断网 | 用不了 | 照常用，联网后自动补同步 |
| 数据归属 | 厂商的库 | 你浏览器的 localStorage |
| 成本 | 按人头按月 | 0 |

**三条定位：**

1. 先是一个人的本地工具，后才是团队工具，没登录也能完整用。
2. 规则优先，AI 兜底，电梯口地铁里没网也能记。
3. 先出结果再确认入库，脏数据比不记更糟。

---

## 2. 功能总览

共 9 个模块，底部页签切换。`团队` 只对管理员显示（普通成员看到它只会是一片空白）。

| 模块 | 一句话 | 关键点 |
|---|---|---|
| 战情台 | 打开即作战面板 | 顶栏三个实时指标（本月业绩 / 目标完成 / 待跟进）+ 本月目标环形图、核心指标、在谈商机加权预测、今日作战清单、近 6 个月业绩折线、销售漏斗、客户分级、本月冲刺提示 |
| 客户库 | 分级管理 + 详情时间线 | A 重点 / B 常规 / C 观察；状态潜在 / 跟进中 / 已成交 / 已流失；详情含跟进线、关联商机、该盯什么话术（`coach.js` 主动推，不等你搜） |
| 商机看板 | 七列拖拽推进 | 线索 10% / 接触 25% / 方案 45% / 报价 65% / 谈判 80% / 赢单 100% / 输单 0%，输赢单都在板上：拖到赢单自动计入业绩，拖到输单会提醒补输单原因（商机表单里的字段）并当场弹一次复盘；业绩统计与销售漏斗不计输单 |
| 跟进日志 | 全部跟进倒序 | 按客户、类型筛选；聊天记录粘贴即提取双方承诺 / 异议 / 下一步 / 风险（纯规则，离线可用）；可改用 AI 深度解析，多出摘要与建议回复 |
| 话术库 | 48 条内置 + 78 条军火库 | 内置 9 大类语义检索；一键加载「实战军火库」15 类知识型条目，看中哪条存入自己的话术库；赢单输单当场沉淀 |
| 周报 | 自动归拢一段时间动作 | 本周 / 上周 / 近 7 天 / 本月 / 上月 / 近 30 天六个口径，四段式文本可直接复制发出 |
| AI 助手 | 可选增强 | 6 个场景：跟进纪要、周报润色、输单复盘、作战建议、客户作战简报、话术军火。需配 Key，不配不影响其他功能 |
| 团队看板 | 只管理员可见 | 全队 in-flight 金额 / 商机数 / 本月赢单 / 逾期 / 沉默天数，按人汇总，不显示客户具体名字 |
| 设置 | 个人 + 系统配置 | 目标、提成、AI、同步、健康度、提醒、导入导出、PWA，详见 [第 9 节](#9-常见配置项) |

**跨模块能力**：顶栏全局搜索（回车跳到客户库并带上关键词）、`+ 记跟进` / `+ 新客户` 快捷按钮、同步胶囊（状态一目了然，点击立即同步）、浏览器桌面通知（到点主动提醒）、PWA 安装到主屏幕、`Esc` 关闭弹窗。

---

## 3. 环境要求

| 用途 | 需要什么 | 说明 |
|---|---|---|
| 只是用（网页版 / 单文件版） | 任一现代浏览器（Chrome / Edge / Safari / Firefox） | 不需要 Node，不需要装任何东西 |
| 构建单文件版 / `public/` | Node.js（本机 `node tools/build.js` 实测 Node 22 可用） | 构建脚本只用 Node 内置模块，**无需 `npm install`**（仓库根本没有根 `package.json`） |
| 跑源码 | 任一静态 HTTP 服务 | `python3 -m http.server` 或 `node server/server.js` 都行 |
| 自托管同步服务 | Node.js（仓库不声明 engines） | 只用内置模块，实测 Node 22 通过；官方镜像用 `node:20-alpine`，照它选最稳 |
| 云端同步 | 一个免费 Supabase 项目 | 只在前端配置，无需服务端部署 |
| EdgeOne 同步后端 | Node ≥ 18 + `@edgeone/pages-blob` | 全仓库唯一有 npm 依赖的地方，在 `deploy/edgeone/` |
| 重新生成军火库数据 | Python 3 | 只有改 `kb/` 才需要，日常用不到 |

> 通知和 PWA 安装都要求 HTTPS（或 localhost）：`file://` 打开单文件版时这两项会静默跳过，其余功能不受影响。

---

## 4. 安装与运行

### 方式一：单文件版（推荐先试两天）

```bash
node tools/build.js
```

生成 `销冠助手-单文件版.html`（约 519 KB），**落在仓库的上一级目录**（构建脚本刻意不把产物写进仓库）。双击即用，可丢网盘发微信存手机。

单文件版的取舍：没有实战军火库（`file://` 拉不到 `kb/knowledge.json`），不注册 Service Worker（因而无离线缓存与 PWA 安装），不发系统通知。**其余功能与网页版完全一致。**

### 方式二：本地跑源码

```bash
git clone https://github.com/LeilaoMi/sales-copilot-Premium.git
cd sales-copilot-Premium
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

任何静态服务器都行。**不能直接双击 `index.html`** —— 浏览器不允许 `file://` 加载多文件 JS。

### 方式三：自带同步后端（局域网 / 自托管）

```bash
node server/server.js                      # 默认 http://localhost:8080
PORT=3000 node server/server.js            # 换端口
SYNC_TOKEN=你的长令牌 node server/server.js # 固定令牌，多人共享一份数据
```

一个文件同时提供静态站点 + `GET/PUT /api/sync` + `GET /api/health` + `GET /api/backups`。
不配 `SYNC_TOKEN` 时是「令牌即空间」模式：**任何 ≥8 位的令牌都会自动开一个独立空间**，各设备填同一令牌即可，控制台首次启动会把建议令牌写到 `data/token.txt`。

所有同步数据落到 `data/store-<令牌哈希>.json`，写入是 tmp + rename 原子替换；另自动保留近期快照（默认 10 份）与每日快照（默认 7 天），在 `data/backups/`。完整的自托管参数见 [第 9 节的服务端环境变量](#9-常见配置项)。

> **自托管必看的两条**：① 这个服务的站点根就是仓库根，而 `data/` 就在里面——同步令牌（`data/token.txt`）和全量客户快照一旦公网可读，等于名单外泄。静态层已把 `data/`、`server/`、`node_modules/` 与点开头目录一律挡成 403，部署后照 `docs/DEPLOY.md` 5.5 验一遍。② 只讲 HTTP，挂公网必须前置 HTTPS 反代，并建议固定 `SYNC_TOKEN`（令牌等同数据访问凭证）。

> 首次打开带示例数据（10 家客户、19 商机、13 跟进），设置里清空即可，不会再自动出现。

---

## 5. 使用方法

### 5.1 一句话录入

战情台顶部输入框，一句话回车自动拆字段，确认即存，原文保留不动。

```
今天去了王总那儿，聊了报价，他说下周三再联系
```

| 字段 | 结果 | 说明 |
|---|---|---|
| 客户 | 恒力精工制造（王建国） | `王总` 按姓加职务命中 |
| 类型 | 拜访 | `去了` 命中拜访 |
| 下次跟进 | 下周三 | 意图词 `再联系` 附近的时间 |

客户匹配三轮：全名最长命中 → 简称 4 到 2 字（多人判歧义，弹候选让你挑）→ 姓加职务（王总 / 陈经理 / 马主任，15 个职务词 + 16 个复姓单独处理，同姓用公司简称消歧）。

时间听懂今天 / 明天 / 后天 / 大后天 / 周X / 下周X / 下下周X / N 天后 / N 周后 / N 个月后 / 9 月 5 日（已过日期自动滚到明年），周一为周首。

> 克制：只有 `下次 / 回头 / 再联系 / 再跟进 / 改天 / 到时候` 等意图词出现才设下次跟进，而且只在意图词附近找时间。
> `他说下周三报价` 是对方时间，不等你要联系，宁可不设。句首 `今天去了` 是行动时间，不误取今天。

### 5.2 聊天记录提取（`digest.js`，不依赖 AI）

跟进日志页粘贴一段微信记录，规则版立刻给出：我承诺 / 客户承诺（带日期）/ 异议（13 类槽位）/ 下一步 / 金额与数量 / 6 组风险信号。全部是草稿，勾一下才入库。配了 AI Key 可切「AI 深度解析」，结构一致，多一段摘要和建议回复。

### 5.3 商机健康度

在谈商机 0–100 分（起点 100），四个信号各自独立扣分，并给一句话动作。

| 信号 | 最多扣 | 判定 |
|---|---|---|
| 沉默 | 35 | 对比你自己的跟进节奏（超 1.6 倍算异常，按 1→2.5 倍线性扣分） |
| 阶段停滞 | 30 | 对比你走完该阶段的历史耗时（中位数，需 ≥3 样本） |
| 临期 / 过期 | 35 | 过期 >14 天扣 35，过期 14 天内扣 25，剩 ≤3 天扣 12，≤7 天扣 6 |
| 无实质推进 | 10 | 近 30 天没换阶段也没记跟进 |

基准自学习：你自己的节奏要 ≥3 条跟进才采信（中位数限制在 3–90 天），样本不足退回 A/B/C 分级兜底（12 / 18 / 30 天）并在页面上明说是估算。新建 3 天内不评级，点「知道了」后默认 7 天不再提，提醒松紧三档 0.7 严格 / 1 标准 / 1.5 宽松（代码支持 0.4–2.5，越小越敏感）。低于 50 分为风险，低于 75 为提醒。

### 5.4 回款预测与目标倒推

```
保守 = Σ(金额 × 本月内成交概率 × 阶段赢率)   时间与赢率都打折
乐观 = Σ(金额 × 本月内成交概率)             只赌时间，假设谈得成
```

阶段赢率优先用你自己的历史成交算（需 ≥3 单且有输有赢），样本不够用默认档。没填预计成交日的按最低估并提醒补。倒推给还差多少、差几单、来不来得及——月末最后 10 天才警告缺口，月初不刷屏。

### 5.5 话术库与实战军火库

**内置 48 条，9 大类**（`js/features/playbook.js` 种子，可直接改）：

| 分类 | 条数 | 分类 | 条数 |
|---|---|---|---|
| 异议处理 | 16 | 谈判博弈 | 4 |
| 催单推进 | 6 | 方案报价 | 3 |
| 开场破冰 | 5 | 复盘沉淀 | 2 |
| 需求挖掘 | 5 | 交付履约 | 2 |
| 售后维护 | 5 | | |

检索不是关键词匹配：意图标签 0.40 + 分词余弦 0.30 + 全文 0.15 + 标签字面 0.15 四路加权，`嫌贵` 能命中标题里没有「贵」字的话术，结果会回显「命中场景：…」告诉你为什么匹配上。

**实战军火库 78 条，15 类**（`kb/knowledge.json`，随站点部署、点「加载军火库」才下载、复用同一套检索）：异议应对 18、开场破冰 10、催单推进 6、谈判博弈 6、方案报价 5、行业知识 5、需求挖掘 5、复盘沉淀 4、标准话术 4、流程方法 4、售后维护 3、交付履约 2、客户关系 2、成交案例 2、竞品对比 2。数据由 AI 辅助整理（`tools/gen-kb-seed.py`），**用前自行核实**。看中哪条一键存入自己的话术库后即归你所有、可编辑。

赢单输单当场会弹窗让你把这次真正起效的话沉淀成自己的话术。

### 5.6 AI 助手（32 家服务商）

不配 Key 不影响任何其他功能。设置里选服务商、填 Key、保存并测试，各家都兼容 OpenAI 协议；地址填错会自动试 6 种常见写法。

| 分组 | 数量 | 名单 |
|---|---|---|
| 国内直连 | 12 | DeepSeek、智谱 GLM、通义千问、硅基流动、Kimi、豆包、百度千帆、讯飞星火、腾讯混元、阶跃星辰、零一万物、MiniMax |
| 海外 | 16 | OpenAI、Azure OpenAI、Claude、Gemini、Groq、Mistral、Grok、OpenRouter、Together、Fireworks、Perplexity、Cerebras、SambaNova、Nebius、Novita、DeepInfra |
| 本机 / 自建 | 3 | Ollama、LM Studio、vLLM |
| 自定义 | 1 | 任意 OpenAI 兼容地址 |

> 实测口径（`ai.js` 注释里记着）：国内 12 家端点已实测有效（2026-09-01 全部返回 401/403，说明地址对、只差 Key）；海外 OpenAI、Claude、Gemini、Mistral、Grok、Perplexity 6 家因环境连不上**未实测**，地址按各家官方文档预设；本机 3 家要额外开跨域才能被浏览器直连（Ollama 设 `OLLAMA_ORIGINS=*`，LM Studio 勾选允许 CORS，vLLM 由网关放行），下拉里都有提示。

> 5 家浏览器直连被 CORS 拦死：豆包、讯飞星火、Groq、Cerebras、SambaNova。下拉里有标记，别反复试 Key，换 DeepSeek / 智谱 / 通义 / 硅基。

**联网增强（Tavily，选填）**：设置 → AI 助手里另填一个 Tavily Key（tavily.com 免费注册，每月 1000 次）。「客户作战简报」生成时会并行发两条查询（公司最新动态 + 行业趋势痛点），单条失败不影响另一条，情报来源随简报列出。不填则维持纯模型生成并标注「待核实」。

### 5.7 周报与陪练

周报纯本地算术归拢，数字只从台账来，不经 AI 也不会漏单；四段式（进展 / 重点客户 / 下一步 / 风险）可直接复制发老板，配了 Key 可让 AI 润色。

陪练是 AI 扮演客户跟你过招，三种难度（客气 / 正常 / 刁钻），每 3 轮自动点评一次，结束给 0–100 分——**价值在点评不在聊天**。场景从话术库现挑，只认「客户说」「对方」开头的标题，所以 48 条里 23 条适合对练属正常；你自建的同格式话术会自动进来。没配 Key 时退化为背书练习（对着库里的参考答案练）。打完可一键存成自己的话术。

### 5.8 跟进提醒

系统桌面通知只看两件事：已逾期，以及 48 小时内到期。每 30 分钟检查一次，一天最多提醒一轮（按客户 + 到期日去重），正文列前 3 家加「等 N 家」，点击直接跳到客户库。不给通知权限或环境不支持时，退化成页面上的红色角标计数。需 HTTPS。

### 5.9 换机与备份

设置 → 数据管理：导出 / 导入备份 JSON、导出客户 CSV（带 UTF-8 BOM，Excel 直接打开不乱码）、**数据码**（把全量数据压成一段 base64 文本，微信发给自己，另一台设备粘贴导入即可，30 秒搞定，零配置；导入会覆盖当前数据）、载入示例、清空全部业务数据、压缩数据（清掉本地删除墓碑）。

### 5.10 多人、团队与同步

**四种同步模式**（设置 → 云同步，随时可切）：

| 模式 | 界面文案 | 粒度 | 适合 |
|---|---|---|---|
| `off` | 关闭（仅存本机） | — | 一台设备，或先试试 |
| `http` | 自建 / 兼容服务器 | 整包快照 | 自己跑 `server/server.js`，或任何提供 `GET`/`PUT` 快照的接口 |
| `supabase` | Supabase 空间 | 整包快照 | 一个人多台设备，共用一张 `sales_sync` 表，靠「空间名」隔离 |
| `cloud` | Supabase 账号 | **逐条记录 + RLS** | 多人 / 团队，数据按账号隔离，管理员能看全队进度 |

规则：本地优先，先写 localStorage 再上云；逐条按 `updatedAt` 最后修改者赢，删除走墓碑标记，所以换设备也能同步「已删掉」。本地改动 4 秒后自动推送，每 60 秒拉一次云端（标签页在后台时不拉），断网重连立刻补一次。`settings.sync` 这段配置永远以本机为准，远端推不动它。

**登录门**：Supabase 地址与 key 出厂内置（`auth.js` 的 `DEFAULT_CLOUD`，用的是 publishable key，本来就会随前端 JS 公开）。新设备首次打开自动弹全屏登录页——登录即自动切到 `cloud` 模式并拉取数据，手机电脑同一份；想纯本地用点「先逛逛」，此后不再自动弹（下次登录成功会清掉该标记）。本机残留的示例数据在首次同步后自动清理（`Store.purgeDemo`），不会混进真实数据。

**搭团队**：建 Supabase 项目 → SQL Editor 执行 `db/supabase.sql`（幂等，可重复跑）→ 设置里填 URL + anon key → 首个注册者自动成为拥有者并建队 → 生成 8 位邀请码发给同事，对方在「账号与团队」里自助加入。角色三级 `owner` / `admin` / `member`，隔离做在 Postgres RLS 层：管理员只读得到同团队成员的数据，改不动别人的客户和报价，也看不到成员的 API Key。共享话术走 `team_scripts` 表。六张表：`profiles`、`teams`、`records`、`team_scripts`、`user_settings`、`sales_sync`。

---

## 6. 部署到线上

> **只部署 `public/`。** 仓库根里的 `data/` 是真实客户资料，静态托管上传的每个文件都公开可下载，整目录上传等于把名单挂公网。构建脚本自带泄漏检查：`public/` 里出现 `data/` 或业务 JSON 会直接报错拦下。

| 目标 | 命令 / 配置 | 同步怎么走 |
|---|---|---|
| Cloudflare Pages（推荐） | `node tools/build.js --pages` → `npx wrangler pages deploy public`；后台接 Git 时构建命令填 `node tools/build.js --pages`、输出目录填 `public` | Supabase（跑不了 Node） |
| Vercel | 导入仓库，Framework 选 Other，Build Command 留空（零构建，`vercel.json` 已配好缓存与 `framework: null`） | Supabase（跑不了 Node） |
| 自有服务器 / 树莓派 | `node server/server.js`（模板 `deploy/Dockerfile`、`deploy/sales-copilot.service`） | 两条都行 |
| 腾讯云 EdgeOne Pages | 见 `deploy/edgeone/README.md`，用 Pages Blob 提供 `/api/sync`，免持久文件系统 | 自建接口 |

构建脚本 `node tools/build.js --pages` 做四件事，别用手敲 `cp` 替代：清仓重建 `public/`、按 `index.html` 的实际引用复制资源、把 `deploy/_headers` 复制过去（缺了就报错拦停）、**重写 `public/sw.js` 的预缓存清单**（离线漏模块这个坑踩过两次，靠人记注释靠不住）。

`deploy/Dockerfile` 与 `deploy/sales-copilot.service` 里的启动命令目前写的是 `node server.js`，按仓库实际布局应为 `server/server.js`（用这两个模板前先改一行）。

**Supabase 免费项目保活**：`.github/workflows/supabase-keepalive.yml` 每 3 天 ping 一次 `/auth/v1/health`，防止免费项目 7 天不活跃被暂停；检测到休眠会把任务标红提醒去 Dashboard 手动 Restore。注意 GitHub 会在仓库 60 天无提交后自动停用定时任务。

上线后必做的 6 条验证（SW 是否拿到新代码、清空数据会不会长回来、两账号互相看不见、离线可用、`data/` 未泄露、PWA 安装）逐条写在 **[`docs/DEPLOY.md`](docs/DEPLOY.md)**，其中缓存与排错部分尤其是踩过坑的，别跳过。

手机浏览器「添加到主屏幕」即得全屏离线 App（iOS 只有 Safari 有这个选项）。

---

## 7. 数据与隐私

| 问题 | 答案 |
|---|---|
| 数据存哪 | 浏览器 localStorage，键名 `sales_copilot_v1`；开了同步才在云端有一份 |
| 作者服务器 | 没有。除非你自己部署，否则你的数据不经过任何第三方 |
| API Key | 只存本机浏览器，直连你填的服务商，不转发不落第三方日志 |
| `data/` | `server/server.js` 的本地快照目录（含令牌与全量客户快照），已 gitignore，永不进库；自托管服务的静态层已把 `/data/*` 一律挡成 403。**跑的是旧版本的话它公网可下载，照 `docs/DEPLOY.md` 5.5 升级并换令牌** |
| `public/` | 构建产物，已 gitignore，每次构建先清空 |
| 换浏览器 / 清缓存 | 会没。开同步，或定期导出 JSON / 复制数据码 |
| Supabase anon key | 公开无妨，真正的闸门是 RLS 行级安全；**service_role key 打死不能贴进网页** |

---

## 8. 项目结构

```
sales-copilot-Premium/
├── index.html              唯一页面 + 页签 + 脚本加载顺序（顺序有依赖，注释写明了为什么）
├── manifest.json           PWA 清单
├── sw.js                   Service Worker，缓存桶 sales-copilot-v3
├── vercel.json             Vercel 缓存与项目配置（理由见 DEPLOY.md 第 7 节）
├── wrangler.toml           Cloudflare Pages 项目配置（name=sales-copilot-premium，输出 public）
├── assets/
│   ├── css/styles.css      全部样式（约 700 行，CSS 变量驱动）
│   └── icons/              192 / 512 / apple-touch 三张图标
├── js/
│   ├── core/               store.js 数据层 · sync.js 四种同步模式与本地合并 · auth.js 登录与账号通道
│   │                       team.js 团队聚合（只读，内存快照）
│   │                       sync-core.js 协议层（server 与 EdgeOne 共用，不由页面加载）
│   ├── features/           quicklog 一句话录入 · health 健康度 · playbook 话术与检索
│   │                       armory 军火库 · digest 记录提取 · report 周报 · coach 话术推送
│   │                       sparring 陪练 · ai AI 接入 · charts 手写 SVG 图表 · notify 提醒
│   └── ui/                 views.js 渲染 · ui.js 事件与动作
├── server/server.js        零依赖同步服务 + 静态站点 + 快照备份
├── db/supabase.sql         6 张表 + RLS 策略 + security definer 函数（幂等）
├── kb/knowledge.json       军火库 78 条（tools/gen-kb-seed.py 生成）
├── tools/                  build.js 构建 · test.js 回归 · gen-kb-seed.py 军火库生成
│                           kb-extra-1/2/3.json 人工补充条目
├── deploy/                 Dockerfile · systemd unit · _headers · edgeone/
├── docs/DEPLOY.md          上线手册（含验证清单与排错表）
├── .github/workflows/      supabase-keepalive.yml
├── public/                 构建产物，已忽略
└── data/                   server 本地快照，已忽略
```

**没有框架、没有 CDN、没有 npm 运行时依赖**（唯一例外是 `deploy/edgeone/` 那个可选适配器）。`js/` 下 18 个文件，其中 17 个由 `index.html` 按顺序加载（`sync-core.js` 不在其中，见下），几处顺序是硬依赖并已在文件里注明原因（`playbook.js` 必须排在 `store.js` 前，`digest.js` 依赖 `quicklog.js` 的日期解析，`sparring.js` 依赖 `ai.js`，`team.js` 依赖 `auth.js`）。

---

## 9. 常见配置项

### 9.1 应用内（设置页，存 localStorage，随同步走）

| 卡片 | 配置项 | 默认值 | 说明 |
|---|---|---|---|
| 个人与目标 | `owner` 姓名 | 张伟 | 顶栏副标题与团队看板的归属显示 |
| | `monthlyTarget` 月度回款目标 | 300000 | 完成率、冲刺提示、预测基准 |
| | `commissionRate` 提成比例 % | 3 | 周报与回款测算 |
| AI 助手 | `ai.provider/base/model/key` | DeepSeek / `https://api.deepseek.com/v1` / `deepseek-chat` / 空 | Key 只存本机，直连服务商 |
| | `tavily.key` | 空 | 选填，作战简报联网增强 |
| 商机健康度 | `health.enabled / sensitivity / snoozeDays` | 开 / 1 / 7 天 | 灵敏度 UI 三档 0.7–1.5，代码支持 0.4–2.5 |
| 云同步 | `sync.mode` | `off` | `off` / `http` / `supabase` / `cloud` |
| | `sync.endpoint / token` | 空 | 自建后端地址与令牌 |
| | `sync.url / key / table / space` | 表 `sales_sync`，空间 `default` | 整包快照模式参数；多人靠不同 `space` 隔离 |
| 账号与团队 | `cloud.url / key` | 出厂内置 | 换成你自己的 Supabase 项目；清空即回到内置默认 |
| 跟进提醒 | `notify.enabled` | 开 | 关掉后只保留页面角标 |
| 数据管理 | 导出 / 导入 / CSV / 数据码 / 示例 / 清空 | — | 配置与数据分开：清空、重置不会动设置 |

### 9.2 服务端环境变量（`server/server.js`）

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | 8080 | 监听端口，绑定 `0.0.0.0` |
| `SYNC_TOKEN` | 空 | 设了就是专属模式（只认这一个令牌）；不设是令牌即空间模式，≥8 位令牌各自开空间 |
| `BACKUP_KEEP` | 10 | 每个空间保留的近期快照份数（最小间隔 `BACKUP_MIN_GAP`） |
| `BACKUP_MIN_GAP` | 60000 | 两次近期快照的最小间隔（毫秒），防被刷 |
| `MAX_SPACES` | 200 | 空间数上限，超出返回 503（公开部署的护栏） |

单次 `PUT` 请求体上限 8 MB；无频率限制，只有上面的空间数护栏。EdgeOne 适配器另有 `BLOB_STORE`（默认 `sales-copilot`）、`SYNC_TOKEN`、`MAX_DEVICES`（默认 20）。

---

## 10. 本地开发

```bash
# 1. 全量语法检查（当前 22 个 JS 文件）
for f in js/*/*.js server/*.js tools/*.js sw.js; do node --check "$f"; done

# 2. 回归测试：17 项断言，覆盖 buildPrompt 双态 / advise 签名 /
#    parseSession / digest 桶对齐 / 军火库联合检索
node tools/test.js

# 3. 构建两个产物，并起本地服务
node tools/build.js
node tools/build.js --pages
PORT=8080 node server/server.js
```

改东西的落点：

| 要改的 | 改哪儿 |
|---|---|
| 加一个页面 | `views.js` 加渲染 → `ui.js` 加 action → `index.html` 加页签（构建会自动补进 sw 清单） |
| 加一个数据字段 | `store.js` 的 `emptyState()` + `migrate()`（迁移按内容判断，不认版本号） |
| 改话术种子 | `playbook.js` 顶部 `SEED`（改了才会被 `migrate` 补进老库） |
| 改军火库 | 编辑 `tools/kb-extra-*.json` → `python tools/gen-kb-seed.py` 重新生成 `kb/knowledge.json`（输入还包括仓库外的旧 SQL 与可选聊天记录，缺的输入会静默跳过）→ 重新构建 |
| 改 AI 服务商 | `ai.js` 顶部 `PROVIDERS`（`cors:false` 标记浏览器直连被拦的那几家） |
| 改健康度 | `health.js`，四个信号彼此独立扣分，别合并 |
| 改同步协议 | 服务端与 EdgeOne 共用一份协议层 `js/core/sync-core.js`（合并算法、令牌校验、空间映射）：改完到 `deploy/edgeone/` 跑 `node prepare.js` 同步适配器，`--check` 可在 CI 里校验一致性。浏览器侧的合并与四种模式在 `js/core/sync.js`，**两侧语义必须保持一致**，否则同一份数据在设备上和服务端上会算出不同结果 |
| 改缓存 | `deploy/_headers` 或 `vercel.json`，**别手改 `sw.js` 的 FILES**（构建会重写） |

提交前：`node tools/test.js` 全绿，改功能同步改这份 README 和 `docs/DEPLOY.md`。

---

## 11. 常见问题 FAQ

| 现象 | 结论 |
|---|---|
| 双击 `index.html` 白屏 | 正常，`file://` 加载不了多文件 JS。用 http 服务，或用单文件版 |
| 单文件版没有军火库 | 是的，`file://` 拉不到 `kb/knowledge.json`。内置 48 条照常可用，离线够用 |
| 同步胶囊一直灰着 | 多半是同步方式停在「自建 / 兼容服务器」，而 Pages / Vercel 上没有 `/api/sync`。切 Supabase |
| 修复发上线了但刷新还是旧的 | SW 缓存。按 `docs/DEPLOY.md` 5.1 查 `_headers` 有没有生效 |
| `王总` 认不出客户 | 已支持，姓加职务是第三轮匹配。同名会弹候选让你选 |
| `他说下周三报价` 被设成我的下次跟进 | 已修。没有意图词就不设，宁可不设 |
| 陪练显示「48 条其中 23 个适合对练」 | 正常。只有「客户说」「对方」开头的话术才是对练场景 |
| 豆包 / 星火 一直失败 | 别试 Key，浏览器直连被 CORS 拦。换 DeepSeek / 智谱 / 通义 / 硅基 |
| 清空数据后示例又长回来 | 已修（`onboarded` 标记跟同步走）。若复现，按 `docs/DEPLOY.md` 5.2 处理 |
| 月初回款预测显示 0 | 已修。没填预计成交日的单按最低估并提醒补 |
| 同一浏览器换账号看到上一个人的数据 | 设计如此。localStorage 按网站分不按账号分，退出登录不清业务数据。要验证隔离请用两个浏览器或无痕窗口 |
| 通知不响 | 需 HTTPS 且要授予通知权限；被拒时退化为页面角标。只提醒逾期和 48 小时内到期 |

---

*README 反映现状，不写未来。改代码同步改 README，跑 `node tools/build.js --pages` + `node tools/test.js` 验证。*
