/* 依次跑三套 RLS 回归：先对 db/supabase.sql 跑一遍，再对「同一脚本执行两次」跑一遍（验证幂等）。 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const schema = path.join(here, '../../db/supabase.sql');
let fail = 0;
for (const t of ['profiles', 'sales-sync', 'records']) {
  for (const files of [[schema], [schema, schema]]) {
    const label = t + (files.length > 1 ? '（建库脚本执行两次）' : '');
    const r = spawnSync(process.execPath, [path.join(here, t + '.test.mjs'), ...files], { encoding: 'utf8' });
    const ok = r.status === 0;
    console.log((ok ? 'PASS ' : 'FAIL ') + label);
    if (!ok) { fail++; console.log(r.stdout + r.stderr); }
  }
}
/* 保活表是独立脚本 db/keepalive.sql（审计 m11），同样跑一次 + 两次 */
const ka = path.join(here, '../../db/keepalive.sql');
for (const files of [[ka], [ka, ka]]) {
  const label = 'keepalive' + (files.length > 1 ? '（脚本执行两次）' : '');
  const r = spawnSync(process.execPath, [path.join(here, 'keepalive.test.mjs'), ...files], { encoding: 'utf8' });
  const ok = r.status === 0;
  console.log((ok ? 'PASS ' : 'FAIL ') + label);
  if (!ok) { fail++; console.log(r.stdout + r.stderr); }
}
console.log(fail ? `RLS FAILURES: ${fail}` : 'ALL RLS TESTS PASSED');
process.exit(fail ? 1 : 0);
