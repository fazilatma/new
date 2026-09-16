const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('src/frontend.html', 'utf8');
const source = html.match(/function dashboardSummaryRow\([^]*?\n\}/)[0];
const row = new Function(source + '\nreturn dashboardSummaryRow;')();
const value = '۱۲۳٬۴۵۶٬۷۸۹٬۰۰۰ تومان';
assert(row('سود', value, 'توضیحات', 'grad-green').includes(value));
assert(row('سود', value, '', 'grad-green').includes('text-emerald-600'));
assert(row('زیان', value, '', 'grad-rose').includes('text-rose-600'));
assert(row('فروش', value, '', 'grad-bg').includes('scope="row"'));
assert.equal((html.match(/dashboardSummaryRow\('/g) || []).length, 6);
assert(html.includes('<tbody id="kpis"></tbody>'));
assert.match(html, /#dashboard-range \{ position: sticky; top: var\(--app-header-height, 76px\)/);
assert(html.includes('new ResizeObserver(syncHeaderHeight).observe(header)'));
// The sticky element's containing section ends before the first chart grid.
assert.match(html, /<tbody id="kpis"><\/tbody>\s*<\/table>\s*<\/div>\s*<\/div>\s*<div class="grid lg:grid-cols-3/);
console.log('Dashboard summary and bounded sticky structure checks passed');
