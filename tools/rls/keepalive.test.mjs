/* RLS 回归：保活表 keepalive_logs：公开 key 只能按保活流程用，不能灌爆、不能删光（审计 m11） */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const SQL_FILES = process.argv.slice(2).length ? process.argv.slice(2)
  : [path.join(path.dirname(fileURLToPath(import.meta.url)), '../../db/keepalive.sql')];
const db = new PGlite();
await db.exec(`create role anon nologin; create role service_role nologin; grant usage on schema public to anon;`);
for (const f of SQL_FILES) await db.exec(fs.readFileSync(f, 'utf8'));
// 先以属主身份放两条：一条 40 天前，一条 20 天前
await db.exec(`set session_replication_role = replica;
insert into keepalive_logs(pinged_at) values (now() - interval '40 days'), (now() - interval '20 days');
set session_replication_role = origin;`);
async function anon(q) {
  await db.exec('set role anon');
  try { const r = await db.query(q); return 'OK rows=' + (/^\s*select/i.test(q) ? r.rows.length : r.affectedRows); }
  catch (e) { return 'ERR ' + e.message; }
  finally { await db.exec('reset role'); }
}
const cases = [
  ['伪造未来时间被拒', `insert into keepalive_logs(pinged_at) values (now() + interval '1 day')`, 'ERR'],
  ['保活写入（默认时间）', `insert into keepalive_logs default values`, 'OK rows=1'],
  ['10 分钟内再写被拒', `insert into keepalive_logs default values`, 'ERR'],
  ['读回验证', `select id from keepalive_logs order by pinged_at desc limit 1`, 'OK rows=1'],
  ['删 30 天前旧行', `delete from keepalive_logs where pinged_at < now() - interval '30 days'`, 'OK rows=1'],
  ['一把删光只删得掉 30 天前的（这时已没有）', `delete from keepalive_logs`, 'OK rows=0'],
  ['改数据被拒或无效', `update keepalive_logs set pinged_at = now()`, 'ERR'],
];
let fail = 0;
for (const [name, q, exp] of cases) { const r = await anon(q); const ok = r.startsWith(exp); if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + ' → ' + r); }
const left = (await db.query('select count(*)::int n from keepalive_logs')).rows[0].n;
const ok = left === 2; if (!ok) fail++;
console.log((ok ? 'PASS ' : 'FAIL ') + '最后剩 20 天前那条 + 新写的那条 → ' + left);
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
