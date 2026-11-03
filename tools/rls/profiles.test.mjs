/* RLS 回归：profiles 权限：成员不能自提角色/换队，owner/admin 边界（审计 C1） */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/* 用法：node tools/rls/profiles.test.mjs [sql 文件...]
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
const U={owner:'00000000-0000-0000-0000-000000000001', mem:'00000000-0000-0000-0000-000000000002', adm:'00000000-0000-0000-0000-000000000003', out:'00000000-0000-0000-0000-000000000004', other:'00000000-0000-0000-0000-000000000005'};
for (const [k,id] of Object.entries(U)) await db.query(`insert into auth.users(id,email) values ($1,$2)`,[id,k+'@x.com']);
const tA=(await db.query(`select team_id from profiles where id=$1`,[U.owner])).rows[0].team_id;
// 把 adm 设为 A 队 admin、mem 为 A 队 member（以属主身份准备数据）
await db.query(`update profiles set team_id=$1, role='admin' where id=$2`,[tA,U.adm]);
await db.query(`update profiles set team_id=$1 where id=$2`,[tA,U.mem]);
// other 建 B 队
const tB=(await db.query(`insert into teams(name,owner_id,invite_code) values('B',$1,'BBBBBBBB') returning id`,[U.other])).rows[0].id;
await db.query(`update profiles set team_id=$1, role='owner' where id=$2`,[tB,U.other]);
async function as(uid, q, p=[]) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${uid}',false);`);
  try { const r = await db.query(q,p); return 'OK rows=' + (r.affectedRows ?? r.rows.length); }
  catch(e){ return 'ERR ' + e.message; }
  finally { await db.exec('reset role'); }
}
const cases = [
 ['成员自提 owner', U.mem, `update profiles set role='owner' where id=$1`, [U.mem], 'ERR'],
 ['成员自改 team_id 到 B 队', U.mem, `update profiles set team_id=$1 where id=$2`, [tB,U.mem], 'ERR'],
 ['成员改自己 display_name', U.mem, `update profiles set display_name='新名字' where id=$1`, [U.mem], 'OK rows=1'],
 ['admin 授 owner 给成员', U.adm, `update profiles set role='owner' where id=$1`, [U.mem], 'ERR'],
 ['admin 把成员挪到 B 队', U.adm, `update profiles set team_id=$1 where id=$2`, [tB,U.mem], 'ERR'],
 ['admin 降级 owner', U.adm, `update profiles set role='member' where id=$1`, [U.owner], 'ERR'],
 ['owner 把成员升 admin', U.owner, `update profiles set role='admin' where id=$1`, [U.mem], 'OK rows=1'],
 ['owner 把 admin 降为 member', U.owner, `update profiles set role='member' where id=$1`, [U.mem], 'OK rows=1'],
 ['admin 移出成员（admin_remove_member）', U.adm, `select admin_remove_member($1)`, [U.mem], 'OK'],
 ['成员用邀请码换到 B 队（join_team）', U.mem, `select join_team('BBBBBBBB')`, [], 'OK'],
 ['成员 leave_team', U.mem, `select leave_team()`, [], 'OK'],
 // 审计 m12 / m25
 ['admin 移出 owner', U.adm, `select admin_remove_member($1)`, [U.owner], 'ERR'],
 ['admin 把未入队的人拉进本队', U.adm, `update profiles set team_id=$1 where id=$2`, [tA,U.out], 'OK rows=0'],
];
let fail=0;
for (const [name,uid,q,p,exp] of cases){ const r=await as(uid,q,p); const ok=r.startsWith(exp); if(!ok) fail++; console.log((ok?'PASS ':'FAIL ')+name+' → '+r); }
// 邀请码：新码 12 位；输错 10 次后，正确的码也要等 15 分钟（审计 m12）
{
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U.owner}',false);`);
  let code = '';
  try { code = (await db.query(`select reset_invite_code() c`)).rows[0].c; } catch (e) { code = 'ERR ' + e.message; }
  await db.exec('reset role');
  const ok1 = /^[0-9A-F]{12}$/.test(code); if (!ok1) fail++;
  console.log((ok1 ? 'PASS ' : 'FAIL ') + '重置后的邀请码是 12 位 → ' + code.length);
  let last = '';
  for (let i = 0; i < 10; i++) last = await as(U.out, `select join_team('ZZZZZZZZ${i}')`, []);
  const blocked = await as(U.out, `select join_team($1)`, [code]);
  const ok2 = blocked.startsWith('ERR') && /太多次/.test(blocked); if (!ok2) fail++;
  console.log((ok2 ? 'PASS ' : 'FAIL ') + '输错 10 次后正确码也被限流 → ' + blocked);
  const team = (await db.query(`select team_id from profiles where id=$1`, [U.out])).rows[0].team_id;
  const ok3 = team === null; if (!ok3) fail++;
  console.log((ok3 ? 'PASS ' : 'FAIL ') + '限流期间没有入队');
}
console.log(fail? `${fail} FAILED`:'ALL PASS'); process.exit(fail?1:0);
