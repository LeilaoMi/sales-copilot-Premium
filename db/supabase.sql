-- ============================================================
-- 销冠助手 · Supabase 建库脚本（多人版 v2）
-- 在 Supabase 控制台 → SQL Editor 里**整段**执行即可，可重复执行（幂等）
--
-- 这一版解决的是上一版做不到的事：
--   上版是「一行 = 一个空间，整包 JSON，anon 全开」，
--   谁拿到 URL + anon key + 空间名，谁就能读写全部数据，
--   更做不到「同一个团队里，销售之间互相看不见」。
--
-- 这版的核心思路：
--   1) 业务记录**按条**存，不再整包覆盖 —— 两个人改不同的客户不会互相抹掉
--   2) 隔离交给数据库（RLS），不交给前端 —— 前端代码写错也漏不出去
--   3) 团队内「成员只见自己的，管理员可见全队的」—— 但管理员只读，不能改别人的单
-- ============================================================

-- ---------- 0. 工具函数 ----------
create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;


-- ============================================================
-- 1. 团队
-- ============================================================
create table if not exists teams (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid references auth.users(id) on delete cascade,
  /* 邀请码：没有它这个功能根本转不起来，原因见文件末尾的 FAQ */
  invite_code text unique,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- 2. 成员档案：角色写在这里
--    role: owner 拥有者 / admin 管理员 / member 使用员
-- ============================================================
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  team_id       uuid references teams(id) on delete set null,
  role          text not null default 'member'
                  check (role in ('owner', 'admin', 'member')),
  display_name  text,
  created_at    timestamptz not null default now()
);

-- 新用户注册时自动建档案，否则第一次同步会因为查不到 profile 卡住。
-- 首个注册的人自动成为 owner，并顺手建一个同名团队——
-- 一个人用的时候也得有个团队，否则后面所有「团队」逻辑都要写空判断。
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- ============================================================
-- 3. 业务记录：统一宽表
--
-- 为什么不每种实体建一张表（customers / deals / followups ...）：
--   这个工具是**本地优先**的，所有查询都发生在浏览器内存里，
--   云端只干两件事——跨设备同步、以及当隔离边界。
--   既然云端不承担查询，一张宽表就够了，
--   以后加了新实体（比如「报价单」）一行代码都不用改库。
--
-- 主键用 (user_id, kind, id) 复合：id 是本地生成的，
--   不同用户可能撞 id，所以必须带上 user_id 才唯一。
-- 删除是软删（deleted=true）：硬删的话「删除」这个动作没法同步给别人。
-- ============================================================
create table if not exists records (
  user_id     uuid not null references auth.users(id) on delete cascade,
  kind        text not null,              -- customers / deals / followups / scripts / ...
  id          text not null,              -- 本地生成的记录 id
  team_id     uuid references teams(id) on delete set null,
  data        jsonb not null,             -- 整条记录原样存，前端自己解析
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  primary key (user_id, kind, id)
);

create index if not exists records_sync_idx on records (user_id, updated_at);
create index if not exists records_team_idx on records (team_id);

-- ============================================================
-- 4. 团队共享话术库
--
-- 和借鉴项目的「全局 10k 知识库」的关键区别：**按团队隔离**，不是全局可读。
-- 全局可读意味着别家公司的人也能翻你的话术，这在真实团队里是不能接受的。
-- 自己团队内部共享才有意义：老人踩过的坑，新人直接拿来用。
-- ============================================================
create table if not exists team_scripts (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references teams(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  title       text not null,
  content     text not null,
  scene       text,
  tags        text[],
  used_count  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists team_scripts_team_idx on team_scripts (team_id, updated_at);

-- ============================================================
-- 5. 个人设置（目标金额、AI 配置、同步配置等）
--   单独一张表而不是塞进 records：设置是整份读写的，没有按条合并的必要。
-- ============================================================
create table if not exists user_settings (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);


-- ============================================================
-- 6. RLS：隔离在这一层落地，不在前端
-- ============================================================
alter table teams         enable row level security;
alter table profiles      enable row level security;
alter table records       enable row level security;
alter table team_scripts  enable row level security;
alter table user_settings enable row level security;

-- 取「我所在的团队」和「我是不是管理员」。
-- 必须加 security definer：普通写法会在查 profiles 时又触发 profiles 的 RLS，
-- 形成无限递归，表现为所有查询都返回空——这个坑很隐蔽，报错信息也不提示。
create or replace function my_team_id()
returns uuid as $$
  select team_id from profiles where id = auth.uid();
$$ language sql security definer stable set search_path = public;

create or replace function my_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable set search_path = public;

-- ---------- profiles ----------
drop policy if exists "profile_self" on profiles;
create policy "profile_self" on profiles
  for select to authenticated
  using (id = auth.uid() or team_id = my_team_id());

drop policy if exists "profile_self_update" on profiles;
create policy "profile_self_update" on profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- 管理员管理成员档案：拉人进队（team_id null → 团队）、移出（→ null）、改角色。
-- 没有这条策略时，PostgREST 对 update 的 RLS 过滤是「0 行更新、204 空响应」——
-- 前端不报错、还提示成功，实际什么都没发生（静默失败，比报错更坑）。
-- with check 只查操作者角色：移出成员时新行 team_id 是 null，
-- 若条件里带 team_id = my_team_id() 会把自己挡住。
drop policy if exists "profile_admin_update" on profiles;
create policy "profile_admin_update" on profiles
  for update to authenticated
  using (
    my_role() in ('owner', 'admin')
    and team_id = my_team_id()
  )
  with check (my_role() in ('owner', 'admin'));
-- 审计 m25：以前 using 里还有「or team_id is null」，管理员知道 uid 就能把任何还没入队的人
-- 拉进自己团队，进而读到对方之后写的全部记录。入队只走邀请码（join_team）。

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

drop trigger if exists profiles_guard on profiles;
create trigger profiles_guard before update on profiles
  for each row execute function guard_profile_update();

-- 移出团队成员走 security definer RPC（admin_remove_member）。
-- 原因：2026-09-09 实测，即便上面这条策略定义完全正确，
-- 「UPDATE ... SET team_id = null」仍可能被 42501 拒绝（数据库内可复现，
-- using/with_check/角色上下文全部验证正常，原因未明）。
-- 函数内自校验（owner/admin、非本人、只动同队成员），以表属主身份
-- 执行 update，绕开 RLS 判定。前端 removeFromTeam 调 rpc/admin_remove_member。
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
revoke all on function admin_remove_member(uuid) from anon;
grant execute on function admin_remove_member(uuid) to authenticated;

-- ---------- teams ----------
drop policy if exists "team_member_read" on teams;
create policy "team_member_read" on teams
  for select to authenticated
  using (id = my_team_id() or owner_id = auth.uid());

drop policy if exists "team_owner_write" on teams;
create policy "team_owner_write" on teams
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "team_owner_insert" on teams;
create policy "team_owner_insert" on teams
  for insert to authenticated
  with check (owner_id = auth.uid());

-- ---------- records：这是「数据各自独立」的主战场 ----------
-- 成员：自己的记录，读写都行
drop policy if exists "records_self" on records;
create policy "records_self" on records
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

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

-- ---------- team_scripts ----------
-- 同团队可读；作者本人或管理员可改可删
drop policy if exists "scripts_team_read" on team_scripts;
create policy "scripts_team_read" on team_scripts
  for select to authenticated
  using (team_id = my_team_id());

drop policy if exists "scripts_own_write" on team_scripts;
create policy "scripts_own_write" on team_scripts
  for all to authenticated
  using (author_id = auth.uid())
  with check (
    author_id = auth.uid()
    and team_id = my_team_id()
  );

drop policy if exists "scripts_admin_write" on team_scripts;
create policy "scripts_admin_write" on team_scripts
  for all to authenticated
  using (my_role() in ('owner', 'admin') and team_id = my_team_id())
  with check (team_id = my_team_id());

-- ---------- user_settings ----------
-- 设置里存着 AI Key，除了本人谁都不能看，管理员也不行
drop policy if exists "settings_self" on user_settings;
create policy "settings_self" on user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());


-- ---------- 邀请码：加入团队的唯一入口 ----------
/* 为什么非得有这个东西：
 *   新注册的成员 team_id 是空的，而管理员的 RLS 只看得到**同团队**的人。
 *   于是管理员看不见新人 → 没法把他拉进来 → 他永远是空的 → 还是看不见。
 *   这是个死循环，光靠 RLS 解不开。
 *
 *   所以改成「管理员亮出邀请码，成员自己输入加入」：
 *   成员改的是**自己那一行**的 team_id，这本来就在他的权限内；
 *   但改成哪个队由 security definer 函数按邀请码决定，
 *   这样他没法凭空填一个 team_id 混进别人的团队。 */
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

create or replace function my_invite_code()
returns text as $$
  select invite_code from teams where id = my_team_id();
$$ language sql security definer stable set search_path = public;

/* 输错邀请码的记录（审计 m12：以前不限次数，8 位码可穷举）。
 * 只有 join_team（security definer）读写，API 角色无权直接访问。 */
create table if not exists join_attempts (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists join_attempts_user_at on join_attempts (user_id, at);
alter table join_attempts enable row level security;
revoke all on join_attempts from anon, authenticated;

/* 输错不抛异常而是返回 null：抛异常会把这次失败记录一起回滚，限流就失效了。
 * 前端（auth.js joinTeam）收到 null 时提示「邀请码不对」。 */
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

/* 退出团队：成员自己可以退，管理员也能把人移出去（后者走 profiles 的 admin 策略） */
create or replace function leave_team()
returns void as $$
begin
  update profiles set team_id = null where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function reset_invite_code() to authenticated;
grant execute on function my_invite_code() to authenticated;
grant execute on function join_team(text) to authenticated;
grant execute on function leave_team() to authenticated;

-- ---------- 表权限（审计 M26） ----------
-- 2026-05-30 起新建的 Supabase 项目不再给 public 下的新表自动授权，
-- 不写这几行，按文档新建的项目一登录就是 42501 permission denied。
-- 只授给 authenticated：哪一行能读写由上面的 RLS 决定；anon 一张业务表都不需要。
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on profiles, teams, records, team_scripts, user_settings to authenticated;


-- ---------- updated_at 自动维护 ----------
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
--   管理员看板走 team_record_facts()（按 team_id = my_team_id() 过滤），
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

drop trigger if exists team_scripts_touch on team_scripts;
create trigger team_scripts_touch before insert or update on team_scripts
  for each row execute function touch_updated_at();

drop trigger if exists user_settings_touch on user_settings;
create trigger user_settings_touch before insert or update on user_settings
  for each row execute function touch_updated_at();


-- ============================================================
-- 7. 快照模式整包表（单人多设备的「Supabase 快照」用）
--
--    sync.js 的 supabaseAdapter 读写这张表：一行 = 一个「空间」（id = 空间名）。
--    注意与上面的 records 体系无关：多人协作请用「Supabase 账号」模式（records），
--    快照模式的隔离只有「空间名」，空间名就是密码。
--
--    2026-11-04 审计 M1：原策略是 using (true)，拿到公开 anon key 的人
--    select=* 就能列出所有空间并读写删整包，根本不需要知道空间名。现在改为：
--      · 每个请求必须带 x-sync-space 请求头，只能看到/写入 id 等于它的那一行，
--        不带头的 select=* 一行也拿不到，无法枚举；
--      · 空间名至少 16 位，'default' 这类能猜的名字不再被接受；
--      · 前端推送前会剔除 AI / Tavily Key 和同步配置，整包里不再带凭据。
-- ============================================================
create table if not exists sales_sync (
  id         text primary key,             -- 空间名，默认 'default'
  data       jsonb not null,               -- 整份本地快照
  updated_at timestamptz not null default now()
);

alter table sales_sync enable row level security;

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

drop trigger if exists sales_sync_touch on sales_sync;
create trigger sales_sync_touch before insert or update on sales_sync
  for each row execute function touch_updated_at();


-- ============================================================
-- 常见问题
-- ============================================================
-- Q: 快照模式同步报 404（或「拉取失败 HTTP 404」）
--    A: sales_sync 表没建。用「Supabase 快照」模式需要本文件第 7 节的表，
--       早期版本建过库的可能没有它——重跑一遍本文件即可（幂等）。
--
-- Q: 前端报 401
--    A: 没登录，或者 token 过期了。重新登录即可。
--
-- Q: 前端报 403 / 一直返回空数组
--    A: 十有八九是 profiles 表里没有你这条档案。
--       老项目（v1 建过库的）不会自动补，手动执行：
--         insert into profiles (id, role, display_name)
--         select id, 'owner', split_part(email, '@', 1) from auth.users
--         where id not in (select id from profiles);
--
-- Q: 管理员看不到成员的数据
--    A: 成员的 team_id 是空的。让管理员在「团队」页把人加进来，
--       或者手动：update profiles set team_id = '<团队ID>' where id = '<成员ID>';
--
-- Q: 管理员在团队页看不到新注册的人
--    A: 这是设计如此，不是 bug——管理员的 RLS 只看得到**同团队**的人，
--       而新人注册后 team_id 是空的。让管理员看见所有注册用户，
--       等于把「谁在用这个系统」暴露给所有管理员，不划算。
--       正路是邀请码：管理员在团队页点「重置邀请码」拿到 8 位码，
--       新人在自己的设置页填这个码加入。
--
-- Q: 成员能不能自己填个 team_id 混进别人的团队
--    A: 不能。加入必须走 join_team(code)，team_id 由邀请码在数据库里查出来，
--       成员改的是自己那一行，但改成哪个队他说了不算。
--
-- Q: 我想让管理员也能改成员的数据
--    A: 可以，但不建议。真要开：
--       create policy "records_admin_write" on records
--         for update to authenticated
--         using (my_role() in ('owner','admin') and team_id = my_team_id())
--         with check (team_id = my_team_id());
--
-- Q: 老库（sales_sync）要删吗
--    A: 留着不影响。想清掉：drop table if exists sales_sync;
