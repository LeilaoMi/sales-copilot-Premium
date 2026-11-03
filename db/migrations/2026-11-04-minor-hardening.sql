-- ============================================================
-- 2026-11-04 审计 Minor 批（m11、m12、m25，附 M26 显式授权）生产迁移。幂等，可重复执行。
-- 内容与 db/supabase.sql、db/keepalive.sql 中对应段落逐字一致（由脚本抽取）。
--   m12 handle_new_user 加咨询锁，首个用户判定不再竞态；新邀请码 12 位
--   m12 join_team 输错 10 次锁 15 分钟（join_attempts 表）；输错返回 null（需配合新前端）
--   m12/m25 admin_remove_member 不能移出 owner；admin 不能移出 admin
--   m25 profile_admin_update 去掉「或 team_id 为空」
--   m11 keepalive_logs 公开 key 只能限流写入、只读、只删 30 天前
-- 注意：join_team 输错时改为返回 null，旧前端会把它当成功（只是不会真的入队）。先部署前端再执行本迁移。
-- ============================================================
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public   -- 必须固定：触发器由 GoTrue 内部角色（supabase_auth_admin）触发，
                           -- 其 search_path 不含 public，不 pin 会导致 insert 找不到表、注册报
                           -- "Database error saving new user"（表名同时全部显式限定 public.）
as $$
declare
  new_team_id uuid;
  member_count int;
begin
  /* 首个用户判定要串行（审计 m12）：两人几乎同时注册时，两个事务都数到 0，
   * 会各建一个团队、各当 owner。事务级咨询锁让并发注册在这里排队。 */
  perform pg_advisory_xact_lock(hashtext('sales_copilot.handle_new_user'));
  select count(*) into member_count from public.profiles;

  if member_count = 0 then
    /* 顺手把邀请码生成好：不然第一个人想加同事进来看不到码，
     * 会以为这个功能坏了 */
    insert into public.teams (name, owner_id, invite_code)
      values (
        coalesce(new.raw_user_meta_data->>'name', '我的团队'),
        new.id,
        upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
      )
      returning id into new_team_id;

    insert into public.profiles (id, team_id, role, display_name)
      values (new.id, new_team_id, 'owner',
              coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  else
    insert into public.profiles (id, team_id, role, display_name)
      values (new.id, null, 'member',
              coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)));
  end if;

  return new;
end;
$$;

drop policy if exists "profile_admin_update" on profiles;
create policy "profile_admin_update" on profiles
  for update to authenticated
  using (
    my_role() in ('owner', 'admin')
    and team_id = my_team_id()
  )
  with check (my_role() in ('owner', 'admin'));

create or replace function admin_remove_member(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  op_role text;
  op_team uuid;
begin
  select role, team_id into op_role, op_team from profiles where id = auth.uid();
  if op_role not in ('owner', 'admin') then
    raise exception '只有 owner/admin 能移出成员';
  end if;
  if target = auth.uid() then
    raise exception '不能把自己移出团队';
  end if;
  /* 审计 m12/m25：admin 不能移出 owner，也不能移出别的 admin；只有 owner 能移出 admin */
  if exists (select 1 from profiles where id = target and role = 'owner') then
    raise exception '不能移出 owner';
  end if;
  if op_role = 'admin' and exists (select 1 from profiles where id = target and role = 'admin') then
    raise exception '只有 owner 能移出管理员';
  end if;
  update profiles set team_id = null where id = target and team_id = op_team;
  if not found then
    raise exception '目标成员不存在或不在你的团队';
  end if;
end;
$$;

create or replace function reset_invite_code()
returns text as $$
declare c text;
begin
  if my_role() not in ('owner', 'admin') then
    raise exception '只有管理员能重置邀请码';
  end if;
  if my_team_id() is null then
    raise exception '你还没有团队';
  end if;
  -- 12 位十六进制（48 位）。以前 8 位只有 32 位，配合不限次数的 join_team 可以穷举（审计 m12）
  c := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  update teams set invite_code = c where id = my_team_id();
  return c;
end;
$$ language plpgsql security definer set search_path = public;

create table if not exists join_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user_at on join_attempts (user_id, at);
alter table join_attempts enable row level security;
revoke all on join_attempts from anon, authenticated;

create or replace function join_team(code text)
returns uuid as $$
declare tid uuid;
begin
  if code is null or length(trim(code)) = 0 then
    raise exception '请填邀请码';
  end if;
  if (select count(*) from join_attempts
      where user_id = auth.uid() and at > now() - interval '15 minutes') >= 10 then
    raise exception '邀请码输错太多次，15 分钟后再试';
  end if;
  select id into tid from teams where invite_code = upper(trim(code));
  if tid is null then
    delete from join_attempts where at < now() - interval '1 day';
    insert into join_attempts(user_id) values (auth.uid());
    return null;
  end if;
  update profiles set team_id = tid where id = auth.uid();
  if not found then
    raise exception '没找到你的档案，试试重新登录';
  end if;
  return tid;
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function join_team(text) to authenticated;

-- M26：显式表授权（老库已有默认授权，重复执行无副作用）
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on profiles, teams, records, team_scripts, user_settings to authenticated;

-- ---------- 保活表（需要 keepalive_logs 已建；没建过的项目请改为执行 db/keepalive.sql） ----------
drop policy if exists "anon keepalive" on keepalive_logs;
drop policy if exists "keepalive insert" on keepalive_logs;
drop policy if exists "keepalive select" on keepalive_logs;
drop policy if exists "keepalive delete old" on keepalive_logs;
create policy "keepalive insert" on keepalive_logs
  for insert to anon
  with check (pinged_at between now() - interval '5 minutes' and now() + interval '5 minutes');
create policy "keepalive select" on keepalive_logs
  for select to anon
  using (true);
create policy "keepalive delete old" on keepalive_logs
  for delete to anon
  using (pinged_at < now() - interval '30 days');

create or replace function keepalive_rate_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from keepalive_logs where pinged_at > now() - interval '10 minutes') then
    raise exception 'keepalive: 10 分钟内只能写一次' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists keepalive_rate_limit on keepalive_logs;
create trigger keepalive_rate_limit before insert on keepalive_logs
  for each row execute function keepalive_rate_limit();
