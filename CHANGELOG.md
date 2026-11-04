# 更新日志

格式参照 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。
发版时同时修改 `package.json`、`js/core/store.js` 的 `VERSION` 和本文件，`node tools/test-version.js` 会校验三处一致。

## [1.0.1] - 2026-11-04

### 文档
- README、部署手册、EdgeOne 说明按当前代码与线上部署重写，删除过时内容（表数量、邀请码位数、缓存版本、管理员权限、Node 版本等）。
- `package.json` 新增 `build:single` 脚本。

### 修复
- 设置页同步说明里的模式名称与实际选项不一致（「Supabase / 云开发 REST」改为「Supabase 空间」/「Supabase 账号」）。

## [1.0.0] - 2026-11-04

首个正式版本，基于全仓审计（audit/REPORT.md 的 4 Critical / 27 Major / 32 Minor）完成修复。

### 安全
- 用户不能再改自己的角色和团队（profiles 列级守卫，C1）。
- 同步空间按请求头隔离，推送不再带出 AI / 搜索密钥（M1）。
- 全站 XSS 转义与 CSP（M2、M3）；自托管服务 CORS 收紧、固定令牌校验、静态白名单（M13、M16、M27）。
- 团队看板只能经 `team_record_facts()` 取统计字段，管理员读不到成员的客户内容（M17）。
- 数据表显式授权、加入团队限流、保活日志策略（M26、m11、m12、m25）。

### 修复
- 畸形 URL、UTF-8 分包、快照结构校验（C2–C4）。
- 云同步：team_id 由服务端决定、记录级后写覆盖、逐行时间戳、翻页不丢（M4–M7）。
- 本地存储损坏另存、写入失败不再静默、多标签页同步（M8–M11）。
- 时区：纯日期与本月按本地时间计算（M12）。
- Service Worker 通知、预缓存超时、离线更新（M14、M22）；Docker 落盘与健康检查（M15）。
- 一句话录入、会话情报、健康度缓存等 Minor 问题（m1–m32，m19 未处理）。

### 新增
- GitHub Actions CI：语法检查、各模块测试、构建、Docker、RLS 回归（M19）。
- 版本号与本更新日志；设置页底部显示版本。

### 许可
- 新增 LICENSE：保留所有权利，公开仅供查阅。
