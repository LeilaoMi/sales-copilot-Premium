/* RLS 回归：新建项目没有默认表授权时，按 db/supabase.sql 建库后登录用户能正常读写（审计 M26）。
 * 与其他用例不同：这里**不**模拟 2026-10-30 之前的默认授权。 */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
const U = '00000000-0000-0000-0000-0000000000a1';
await db.query(`insert into auth.users(id,email) values ($1,'g@x.com')`, [U]);
async function as(q, p = []) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${U}',false);`);
  try { const r = await db.query(q, p); return 'OK rows=' + (r.affectedRows ?? r.rows.length); }
  catch (e) { return 'ERR ' + e.message; }
  finally { await db.exec('reset role'); }
}
const cases = [
  ['读自己的档案', `select id from profiles`, 'OK'],
  ['读团队', `select id from teams`, 'OK'],
  ['读记录', `select id from records`, 'OK'],
  ['写自己的记录', `insert into records(user_id,kind,id,data) values ('${U}','customers','c1','{}')`, 'OK'],
  ['读团队话术', `select id from team_scripts`, 'OK'],
  ['读写自己的设置', `select user_id from user_settings`, 'OK'],
  ['拿邀请码', `select my_invite_code()`, 'OK'],
];
let fail = 0;
for (const [name, q, exp] of cases) { const r = await as(q); const ok = r.startsWith(exp); if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' → ' + r); }
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
