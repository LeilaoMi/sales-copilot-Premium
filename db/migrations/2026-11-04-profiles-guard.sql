-- 已部署的库在 SQL Editor 里单独执行这一段即可（幂等，可重复跑）。
-- 档案字段守卫（2026-11-04 审计 C1）：
-- 两条 update 策略只能约束「哪一行能改」，管不到「改了哪些列」。
-- 没有这道守卫时，成员可以 PATCH 自己的 role=owner / team_id=任意团队，
-- 拿到管理员读权限后读走整队客户记录；admin 也能把人挪到别的团队、
-- 给自己或他人授 owner。这里用 before update 触发器逐列把关：
--   1. 自己只能改 display_name；换队走 join_team()/leave_team()，
--      它们是 security definer，以表属主身份执行，不受这里限制；
--   2. 管理员改别人：只能在自己团队内操作（旧值是本队或无队，新值必须是本队），
--      不能修改 owner 的角色，也不能授出 owner；
--   3. owner 转让请走专门流程（当前前端未提供）。
create or replace function guard_profile_update()
returns trigger
language plpgsql
-- 注意：这里故意不用 security definer。definer 会让 current_user 恒为表属主，
-- 下面「只拦 API 角色」的判断就失效了。查操作者身份用 my_role()/my_team_id()。
security invoker
set search_path = public
as $$
declare
  op_role text := my_role();
  op_team uuid := my_team_id();
begin
  -- 只拦 API 角色。security definer 函数（join_team / leave_team /
  -- admin_remove_member / handle_new_user）里的 update 以表属主身份执行，放行。
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.id is distinct from old.id then
    raise exception '不能修改档案 id' using errcode = '42501';
  end if;
  if new.role is not distinct from old.role and new.team_id is not distinct from old.team_id then
    return new;   -- 只改了 display_name 等普通字段
  end if;
  if old.id = auth.uid() then
    raise exception '不能修改自己的角色或团队；换队请用邀请码' using errcode = '42501';
  end if;

  if op_role is null or op_role not in ('owner', 'admin') or op_team is null then
    raise exception '只有团队 owner/admin 能调整成员' using errcode = '42501';
  end if;
  if old.team_id is not null and old.team_id is distinct from op_team then
    raise exception '只能调整本团队成员' using errcode = '42501';
  end if;
  if new.team_id is distinct from op_team then
    raise exception '只能把成员放进本团队；移出请用 admin_remove_member' using errcode = '42501';
  end if;
  if old.role = 'owner' then
    raise exception '不能修改 owner 的角色' using errcode = '42501';
  end if;
  if new.role = 'owner' then
    raise exception '不能直接授予 owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_update();
