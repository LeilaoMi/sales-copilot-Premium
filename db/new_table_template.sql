-- 新建业务表模板（Supabase Data API，2026-10-30 变更后适用）
-- 背景：2026-10-30 起，所有现有项目的 public 新表不再自动给
-- anon / authenticated / service_role 授权；没有显式 GRANT 时，
-- PostgREST / GraphQL / supabase-js 访问直接报 42501 permission denied，
-- 连 service_role 也不例外（直连 Postgres 不受影响）。已有表不受影响。
-- 用法：把 your_table 换成真实表名，按最小权限保留需要的 GRANT 行。

create table public.your_table (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  title text not null,
  created_at timestamptz not null default now()
);

alter table public.your_table enable row level security;

create policy "read own rows"
  on public.your_table
  for select
  to authenticated
  using (auth.uid() = user_id);

-- ★ 2026-10-30 后新增的部分：显式授权（RLS 管行，GRANT 管表能不能碰）
-- service_role 给全量 CRUD（服务端/保活类脚本常用）：
grant select, insert, update, delete on public.your_table to service_role;
-- 登录用户按 RLS 读写时取消下一行注释：
-- grant select, insert, update, delete on public.your_table to authenticated;
-- 匿名只读时才取消下一行注释（不要图省事 GRANT ALL 给 anon）：
-- grant select on public.your_table to anon;

-- 若用 serial/identity 自增列，API 角色还需要 sequence 权限，取消注释：
-- grant usage, select on all sequences in schema public to authenticated, service_role;

-- 验证（应返回 t；f 说明授权没生效）：
-- select has_table_privilege('authenticated', 'public.your_table', 'select');
-- select grantee, privilege_type from information_schema.role_table_grants
--  where table_schema = 'public' and table_name = 'your_table'
--    and grantee in ('anon', 'authenticated', 'service_role');
