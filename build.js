/* Build: تزریق فرانت‌اند داخل ورکر → dist/worker.js */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'src', 'frontend.html'), 'utf8');
let worker = fs.readFileSync(path.join(root, 'src', 'worker.js'), 'utf8');

if (!worker.includes('"__FRONTEND_HTML__"')) {
  console.error('❌ placeholder "__FRONTEND_HTML__" در src/worker.js پیدا نشد.');
  process.exit(1);
}

worker = worker.replace('"__FRONTEND_HTML__"', () => JSON.stringify(html));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'worker.js'), worker);
console.log('✅ Built dist/worker.js  (' + (worker.length / 1024).toFixed(1) + ' KB)');
