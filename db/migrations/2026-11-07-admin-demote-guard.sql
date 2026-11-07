-- 2026-11-07 CodeRabbit PR #21：admin 不能降级另一个 admin
-- 问题：guard_profile_update 只拦 owner 相关的角色变化，admin 可以先把另一个 admin
--       PATCH 成 member，再调 admin_remove_member 移出，绕过「只有 owner 能移出管理员」。
-- 只替换触发器函数体，触发器本身不变。可重复执行。
begin;

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
  -- admin 不能动另一个 admin 的角色：否则可先降为 member 再 admin_remove_member，
  -- 绕过「只有 owner 能移出管理员」（CodeRabbit PR #21）
  if op_role = 'admin' and old.role = 'admin' then
    raise exception '只有 owner 能调整管理员' using errcode = '42501';
  end if;
  if new.role = 'owner' then
    raise exception '不能直接授予 owner' using errcode = '42501';
  end if;
  return new;
end;
$$;

commit;
