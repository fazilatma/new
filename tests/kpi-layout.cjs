const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('src/frontend.html', 'utf8');
const source = html.match(/function kpiCard\([^]*?\n\}/)[0];
const card = new Function(source + '\nreturn kpiCard;')();
for (const value of ['۱۲۳٬۴۵۶٬۷۸۹٬۰۰۰ تومان', '−۹۸۷٬۶۵۴٬۳۲۱ تومان', '۱۰۰٪', '۰ تومان']) {
  const rendered = card('فروش کل', value, 'توضیحات', 'grad-bg', '💵', '');
  assert(rendered.includes(value));
  assert(!/truncate|overflow-hidden|whitespace-nowrap/.test(rendered));
  assert.match(rendered, /<\/div>\s*<div class="kpi-value/);
}
assert.match(html, /#kpis, #r-kpis, #orders-summary \{ grid-template-columns: repeat\(auto-fit, minmax\(min\(100%, 15rem\), 1fr\)\);/);
assert.match(html, /\.kpi-value \{ white-space: normal; overflow-wrap: anywhere; line-height: 1.7;/);
console.log('KPI layout regression checks passed');
