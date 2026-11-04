-- ============================================================
-- 2026-11-04 审计 M17 生产迁移：团队看板改走只返回统计字段的函数，管理员不再能直接读成员记录。幂等。
-- 先部署新前端（看板调用 rpc/team_record_facts）再执行；顺序反了，旧前端的团队看板会显示为空，不影响数据。
-- 内容与 db/supabase.sql 对应段落一致。
-- ============================================================
-- 管理员：**不能直接读**成员的记录（审计 M17）。
-- 以前这里有一条 records_admin_read：同团队管理员可 select 成员的整行，
-- 客户名、电话、备注都在 data 里，看板虽然只显示统计，打开开发者工具就能翻全队客户。
-- 现在看板只能走下面的 team_record_facts()：它只吐统计要用的五个字段，拿不到客户内容。
drop policy if exists "records_admin_read" on records;

-- 团队看板的唯一数据源：同团队、未删除记录的统计字段。
-- security definer 绕过 RLS，所以权限判断全写在 where 里：调用者必须是本队 owner/admin。
-- 不在这里做汇总：「本月」要按用户本地时区算（审计 M12），汇总留给前端 Team.aggregate。
-- 分页：Supabase 默认单次最多返回 1000 行，前端按 p_offset 逐页拉。
create or replace function team_record_facts(p_offset int default 0, p_limit int default 1000)
returns table (user_id uuid, kind text, id text, stage text, amount text,
               closed_at text, next_follow_at text, at text)
language sql
stable
security definer
set search_path = public
as $$
  select r.user_id, r.kind, r.id,
         r.data->>'stage', r.data->>'amount', r.data->>'closedAt',
         r.data->>'nextFollowAt', r.data->>'at'
  from public.records r
  where public.my_role() in ('owner', 'admin')
    and r.team_id is not null
    and r.team_id = public.my_team_id()
    and not r.deleted
  order by r.user_id, r.kind, r.id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 1000), 1), 1000);
$$;
revoke all on function team_record_facts(int, int) from public, anon;
grant execute on function team_record_facts(int, int) to authenticated;
