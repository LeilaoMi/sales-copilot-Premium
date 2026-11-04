/* RLS 回归：records：team_id 服务端决定、记录级 LWW、逐行时间戳（审计 M4–M6） */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/* 用法：node tools/rls/records.test.mjs [sql 文件...]
 * 不带参数时跑 db/supabase.sql。传多个文件按顺序执行（可用来测「旧库 + 迁移」）。
 * 依赖 @electric-sql/pglite（内存里的真 Postgres）：cd tools/rls && npm install */
const SQL_FILES = process.argv.slice(2).length ? process.argv.slice(2)
  : [path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/supabase.sql')];
const db = new PGlite();
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
`);
for (const f of SQL_FILES) await db.exec(fs.readFileSync(f, 'utf8'));
await db.exec(`grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;`);
const U = { owner: '00000000-0000-0000-0000-000000000001', mem: '00000000-0000-0000-0000-000000000002', other: '00000000-0000-0000-0000-000000000005', solo: '00000000-0000-0000-0000-000000000006' };
for (const [k, id] of Object.entries(U)) await db.query(`insert into auth.users(id,email) values ($1,$2)`, [id, k + '@x.com']);
const tA = (await db.query(`select team_id from profiles where id=$1`, [U.owner])).rows[0].team_id;
await db.query(`update profiles set team_id=null, role='member' where id=$1`, [U.mem]);   // 先不在队
const tB = (await db.query(`insert into teams(name,owner_id,invite_code) values('B',$1,'BBBBBBBB') returning id`, [U.other])).rows[0].id;
await db.query(`update profiles set team_id=$1, role='owner' where id=$2`, [tB, U.other]);
const codeA = (await db.query(`select invite_code from teams where id=$1`, [tA])).rows[0].invite_code;

async function as(uid, q, p = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { return await db.query(q, p); } finally { await db.exec('reset role'); }
}
const up = (uid, id, ts, extra = {}) => as(uid,
  `insert into records(user_id,kind,id,team_id,data) values ($1,'customers',$2,$3,$4)
   on conflict (user_id,kind,id) do update set data=excluded.data, team_id=excluded.team_id, deleted=excluded.deleted`,
  [uid, id, extra.team || null, JSON.stringify({ id, updatedAt: ts, name: extra.name || 'n' + ts })]);
const row = async id => (await db.query(`select team_id, data, updated_at from records where id=$1`, [id])).rows[0];
const ownerSees = async () => (await as(U.owner, `select id from team_record_facts(0, 1000) where kind='customers'`)).rows.map(r => r.id).sort().join(',');

let fail = 0;
const check = (n, c) => { console.log((c ? 'PASS ' : 'FAIL ') + n); if (!c) fail++; };

// M4
await up(U.mem, 'm1', 100, { team: tB });
check('M4 无队成员写入时传 B 队 team_id 被忽略', (await row('m1')).team_id === null);
await as(U.mem, `select join_team($1)`, [codeA]);
check('M4 加入 A 队后旧记录自动归入 A 队', (await row('m1')).team_id === tA);
check('M4 A 队 owner 立即能在看板读到入队前的记录', (await ownerSees()).includes('m1'));
await up(U.mem, 'm2', 100, { team: tB });
check('M4 队员写入时伪造 B 队 team_id 无效', (await row('m2')).team_id === tA);
check('M4 B 队 owner 读不到', (await as(U.other, `select id from records where id in ('m1','m2')`)).rows.length === 0);
await as(U.mem, `select leave_team()`);
check('M4 退队后记录 team_id 清空', (await row('m1')).team_id === null && (await row('m2')).team_id === null);
check('M4 原团队 owner 退队后读不到', !(await ownerSees()).includes('m1'));

// M5
await up(U.solo, 's1', 200, { name: 'new' });
await up(U.solo, 's1', 150, { name: 'old' });
check('M5 旧版本推送不覆盖新版本', (await row('s1')).data.name === 'new');
await up(U.solo, 's1', 300, { name: 'newer' });
check('M5 新版本正常覆盖', (await row('s1')).data.name === 'newer');
const t1 = (await row('s1')).updated_at;
await up(U.solo, 's1', 300, { name: 'newer' });
check('M5 同版本重复推送幂等、时间戳不变', +(await row('s1')).updated_at === +t1);

// M6
await as(U.solo, `insert into records(user_id,kind,id,data) select $1,'deals','d'||g, jsonb_build_object('updatedAt',g) from generate_series(1,500) g`, [U.solo]);
const distinct = (await db.query(`select count(distinct updated_at) n from records where kind='deals'`)).rows[0].n;
check('M6 一次插入 500 条不再共用同一时间戳（实得 ' + distinct + ' 个不同值；并列由前端 gte 翻页兜底）', Number(distinct) > 1);

// M17：管理员不能直接读成员记录，只能通过 team_record_facts 拿统计字段
await db.query(`update profiles set team_id=null, role='member' where id=$1`, [U.mem]);
await as(U.mem, `select join_team($1)`, [codeA]);
await as(U.mem, `insert into records(user_id,kind,id,data) values ($1,'customers','priv1',$2)`, [U.mem, JSON.stringify({ id: 'priv1', updatedAt: 1, name: '机密客户', phone: '13800000000', nextFollowAt: '2026-11-01' })]);
const direct = (await as(U.owner, `select data from records where id='priv1'`)).rows;
check('M17 owner 直接 select 成员记录拿不到', direct.length === 0);
const facts = (await as(U.owner, `select * from team_record_facts(0, 1000) where id='priv1'`)).rows;
check('M17 看板函数能拿到这条的统计字段', facts.length === 1 && facts[0].next_follow_at === '2026-11-01');
check('M17 看板函数不返回客户名和电话', !JSON.stringify(facts).includes('机密') && !JSON.stringify(facts).includes('138'));
check('M17 普通成员调看板函数拿不到别人的', (await as(U.mem, `select * from team_record_facts(0, 1000)`)).rows.length === 0);
check('M17 别队 owner 调看板函数拿不到', (await as(U.other, `select * from team_record_facts(0, 1000) where id='priv1'`)).rows.length === 0);
check('M17 单页最多 1000 行', (await as(U.owner, `select count(*)::int n from team_record_facts(0, 999999)`)).rows[0].n <= 1000);

console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
