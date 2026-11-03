-- 已部署的库在 SQL Editor 里单独执行这一段即可（幂等，可重复跑）。
-- 2026-11-04 审计 M4（team_id 服务端决定）、M5（记录级 LWW）、M6（时间戳逐行递增）。
-- 依赖 db/supabase.sql 里已有的 records、profiles 表。

-- ---------- records 的服务端守卫（2026-11-04 审计 M4 / M5 / M6）----------
-- 触发器按名字顺序执行：records_10_lww → records_20_team → records_touch。

-- M5 记录级「最后修改者赢」：
--   以前 upsert 是无条件覆盖，离线设备推上来的旧版本会盖掉云端的新版本，
--   而持有新版本的设备因为本地更新、又低于推送游标，不会再推——两边永久分叉。
--   现在按 data.updatedAt（毫秒数字）比较，推上来的更旧就整行跳过（return null）。
--   相等时放行，保证同一版本重复推送是幂等的。
create or replace function records_ts(d jsonb)
returns numeric
language sql
immutable
as $$
  select case
    when jsonb_typeof(d -> 'updatedAt') = 'number' then (d ->> 'updatedAt')::numeric
    when (d ->> 'updatedAt') ~ '^[0-9]+(\.[0-9]+)?$' then (d ->> 'updatedAt')::numeric
    else 0
  end
$$;

create or replace function records_lww()
returns trigger
language plpgsql
as $$
begin
  if records_ts(new.data) < records_ts(old.data) then
    return null;   -- 更旧的版本：本行不更新，其余行照常
  end if;
  return new;
end;
$$;

drop trigger if exists records_10_lww on records;
create trigger records_10_lww before update on records
  for each row execute function records_lww();

-- M4 team_id 由服务端决定：
--   以前 team_id 是前端随记录一起传的，成员能把记录写进任何已知团队；
--   退队后旧记录 team_id 不变，原团队管理员还能一直读；
--   入队前的记录 team_id 为空，要等被改动才进团队看板。
--   现在：写入时一律取作者当前所在团队，前端传什么都不算；
--   成员换队 / 退队 / 被移出时，他的全部记录跟着改。
--   管理员只读策略 records_admin_read 不变（team_id = my_team_id()），
--   但这一列从此可信。
create or replace function records_set_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.team_id := (select team_id from profiles where id = new.user_id);
  return new;
end;
$$;

drop trigger if exists records_20_team on records;
create trigger records_20_team before insert or update on records
  for each row execute function records_set_team();

create or replace function profiles_follow_team()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update records set team_id = new.team_id
   where user_id = new.id and team_id is distinct from new.team_id;
  return null;
end;
$$;

drop trigger if exists profiles_follow_team on profiles;
create trigger profiles_follow_team after update of team_id on profiles
  for each row when (old.team_id is distinct from new.team_id)
  execute function profiles_follow_team();

-- M6 updated_at 用 clock_timestamp()，且内容没变就不动：
--   now() 是事务开始时间，一次 upsert 500 条全部同一个时间戳；
--   增量拉取按 updated_at 翻页时，第 2000 行落在这批中间，剩下的就永远拉不到。
--   clock_timestamp() 逐行取真实时间，大幅减少并列（微秒级仍可能撞，
--   所以前端改为 updated_at >= 游标翻页、重复行按 LWW 幂等处理）。只改 team_id（上面的跟队）不算内容变化，
--   不刷新时间戳，免得成员换一次队，他所有设备把全部记录重新拉一遍。
create or replace function records_touch()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.data is not distinct from old.data
     and new.deleted is not distinct from old.deleted then
    new.updated_at := old.updated_at;
  else
    new.updated_at := clock_timestamp();
  end if;
  return new;
end;
$$;

drop trigger if exists records_touch on records;
create trigger records_touch before insert or update on records
  for each row execute function records_touch();

-- 存量数据：按作者当前团队校正一次 team_id（幂等）。
update records r set team_id = p.team_id
  from profiles p
 where p.id = r.user_id and r.team_id is distinct from p.team_id;
