/* 版本号一致性：package.json、js/core/store.js 的 VERSION、CHANGELOG.md 最新一节必须相同（审计 m18） */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let fail = 0;
const check = (n, c) => { console.log((c ? 'PASS  ' : 'FAIL  ') + n); if (!c) fail++; };

const pkg = JSON.parse(read('package.json')).version;
const m = read('js/core/store.js').match(/const VERSION = '([^']+)'/);
const store = m && m[1];
const c = read('CHANGELOG.md').match(/^## \[(\d+\.\d+\.\d+)\]/m);
const log = c && c[1];

check('package.json 版本号符合语义化版本（' + pkg + '）', /^\d+\.\d+\.\d+$/.test(pkg || ''));
check('store.js VERSION 与 package.json 一致（' + store + '）', store === pkg);
check('CHANGELOG 最新一节与 package.json 一致（' + log + '）', log === pkg);
check('LICENSE 存在', fs.existsSync(path.join(root, 'LICENSE')));
check('package.json 声明 UNLICENSED', JSON.parse(read('package.json')).license === 'UNLICENSED');
check('设置页显示版本号', /v\$\{S\.VERSION\}/.test(read('js/ui/views.js')));

console.log('\n' + (fail === 0 ? 'ALL VERSION TESTS PASSED' : 'FAILURES: ' + fail));
process.exit(fail === 0 ? 0 : 1);
