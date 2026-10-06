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
