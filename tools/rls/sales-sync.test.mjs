/* RLS 回归：快照表 sales_sync：必须带 x-sync-space 请求头、空间名 ≥16 位（审计 M1） */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
/* 用法：node tools/rls/sales-sync.test.mjs [sql 文件...]
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
grant usage on schema public to anon, authenticated;
`);
for (const f of SQL_FILES) await db.exec(fs.readFileSync(f, 'utf8'));
// 模拟 2026-10-30 之前建的库：表默认对 anon/authenticated 开放（生产库就是这样）
await db.exec(`grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;`);
const S1='space-aaaaaaaaaaaaaaaa', S2='space-bbbbbbbbbbbbbbbb';
// 以属主身份放两个空间 + 一个旧的短名空间
await db.exec(`insert into sales_sync(id,data) values ('${S1}','{"v":1}'),('${S2}','{"v":2}'),('default','{"v":0}') on conflict do nothing`);
async function anon(space, q) {
  const hdr = space === null ? '' : JSON.stringify({ 'x-sync-space': space });
  await db.exec(`set role anon; select set_config('request.headers', '${hdr}', false);`);
  try { const r = await db.query(q); return 'OK rows=' + (/^\s*select/i.test(q) ? r.rows.length : r.affectedRows); }
  catch (e) { return 'ERR ' + e.message; }
  finally { await db.exec('reset role'); }
}
const cases = [
  ['不带头 select=* 枚举', null, `select id from sales_sync`, 'OK rows=0'],
  ['带 S1 头 select=* 只看到自己', S1, `select id from sales_sync`, 'OK rows=1'],
  ['带 S1 头读 S2', S1, `select id from sales_sync where id='${S2}'`, 'OK rows=0'],
  ['带 S1 头改 S2', S1, `update sales_sync set data='{"x":1}' where id='${S2}'`, 'OK rows=0'],
  ['带 S1 头删全部', S1, `delete from sales_sync`, 'OK rows=1'],
  ['带 S1 头插入 S2 行', S1, `insert into sales_sync(id,data) values ('${S2}x','{}')`, 'ERR'],
  ['带 S1 头 upsert 自己', S1, `insert into sales_sync(id,data) values ('${S1}','{"v":9}') on conflict (id) do update set data=excluded.data`, 'OK'],
  ['短空间名 default 读', 'default', `select id from sales_sync`, 'OK rows=0'],
  ['短空间名 default 写', 'default', `insert into sales_sync(id,data) values ('default','{}') on conflict (id) do update set data=excluded.data`, 'ERR'],
];
let fail = 0;
for (const [name, sp, q, exp] of cases) { const r = await anon(sp, q); const ok = r.startsWith(exp); if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' → ' + r); }
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
