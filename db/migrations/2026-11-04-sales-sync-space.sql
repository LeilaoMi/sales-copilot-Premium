-- 已部署的库在 SQL Editor 里单独执行这一段即可（幂等，可重复跑）。
-- 快照表按空间隔离（2026-11-04 审计 M1）：
--   原策略 using (true) 让任何持有公开 anon key 的人都能 select=* 列出全部空间、
--   读写删整包。现在每个请求必须带 x-sync-space 请求头，只能碰 id 等于它的那一行，
--   且空间名至少 16 位。旧版前端（不带请求头）执行后将无法再读写快照，需同时更新前端。
-- 没建过 sales_sync 的库（没用快照模式）跳过本文件即可。
-- PostgREST 把请求头放进 request.headers（JSON，头名小写）。
-- 不是经 PostgREST 来的连接（SQL Editor、psql）这里返回 null，策略自然不放行。
create or replace function sales_sync_space()
returns text
language sql
stable
as $$
  select nullif(current_setting('request.headers', true), '')::json ->> 'x-sync-space'
$$;

drop policy if exists "sales_sync_anon_all" on sales_sync;
drop policy if exists "sales_sync_by_space" on sales_sync;
create policy "sales_sync_by_space" on sales_sync
  for all to anon, authenticated
  using (id = sales_sync_space() and length(id) >= 16)
  with check (id = sales_sync_space() and length(id) >= 16);
-- 显式授权：2026-10-30 之后新建的 Supabase 项目不再默认给 anon/authenticated 授权，
-- 不写这两行快照模式在新库上直接 401/403。行级隔离仍由上面的策略负责。
grant execute on function sales_sync_space() to anon, authenticated;
grant select, insert, update, delete on sales_sync to anon, authenticated;

-- 名字过短、以后再也读写不到的旧空间（例如 'default'）。确认里面没有要留的数据后可删：
--   delete from sales_sync where length(id) < 16;
