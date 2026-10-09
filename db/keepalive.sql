-- ============================================================
-- Supabase 保活表（基础设施，非业务数据）
-- 在 Supabase 控制台 → SQL Editor 里整段执行一次即可，可重复执行（幂等）
--
-- 背景：Supabase 免费项目 7 天无"有效活跃"会被自动暂停。
-- 2026 年起，单纯的只读 ping（健康检查 / SELECT）不再被稳定计入活跃，
-- 必须有真实的数据库写入。GitHub Actions（.github/workflows/
-- supabase-keepalive.yml）每 3 天往这张表 INSERT 一条，即为有效活跃。
--
-- 这张表与所有业务表完全独立：独立表名、独立 RLS 策略，
-- 不会影响任何真实数据。workflow 还会自动清理 30 天前的旧记录，
-- 表里永远只有几十行。
-- ============================================================

create table if not exists keepalive_logs (
  id        bigint generated always as identity primary key,
  pinged_at timestamptz not null default now()
);

alter table keepalive_logs enable row level security;

drop policy if exists "anon keepalive" on keepalive_logs;
create policy "anon keepalive" on keepalive_logs
  for all to anon
  using (true)
  with check (true);

-- ============================================================
-- 以下为 2026-10-09 并入的授权补丁（原文 db/keepalive_grants_patch.sql）
-- ============================================================

-- keepalive_logs 授权补丁（幂等，可重复执行）
-- 隐患：仓库 db/keepalive.sql 建表后靠的是 2026-10-30 之前的默认自动授权。
-- 若把该 SQL 重放到新项目 / 预览分支 / db reset（新项目 2026-05-30 起已默认
-- 不自动授权），anon 角色拿不到表权限，保活工作流的 INSERT 会直接 42501、
-- 保活失败且项目可能再次被暂停。已有生产表不受影响，此补丁只为重放安全。
-- 保活工作流实际动作（据 2026-10-06 run #12 日志）：INSERT 一行、读回验证、
-- 删除 30 天前旧行，全部走 anon/publishable key，因此给 anon 三个权限即可，
-- 不要给 update，更不要 GRANT ALL。

grant insert, select, delete on public.keepalive_logs to anon;
grant select, insert, update, delete on public.keepalive_logs to service_role;

-- 验证（三个都应返回 t）：
-- select has_table_privilege('anon', 'public.keepalive_logs', 'insert');
-- select has_table_privilege('anon', 'public.keepalive_logs', 'select');
-- select has_table_privilege('anon', 'public.keepalive_logs', 'delete');
