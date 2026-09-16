const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('src/frontend.html', 'utf8');
const worker = fs.readFileSync('src/worker.js', 'utf8');
const rowClass = new Function(html.match(/function orderRowClass\(o\) \{[\s\S]*?\n\}/)[0] + '\nreturn orderRowClass;')();
for (const status of ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'returned']) {
  assert.equal(rowClass({status, supplier_order_status: 'placed'}), 'row-supplier-placed');
}
assert.equal(rowClass({status: 'confirmed', unit_cost: 10}), 'row-ok');
assert.equal(rowClass({status: 'pending', supplier_order_status: 'not_placed'}), 'row-pending');
assert.equal(rowClass({status: 'cancelled'}), 'row-cancelled');
assert(html.indexOf('id="o-sup"') < html.indexOf('id="o-supplier-order-status"'));
assert(html.indexOf('id="o-supplier-order-status"') < html.indexOf('id="o-ptype"'));
assert(html.includes("supplier_order_status: $('#o-supplier-order-status').value"));
assert(html.includes("o.supplier_order_status === 'placed' ? 'placed' : 'not_placed'"));
assert(worker.match(/const ORDER_FIELDS = \[[\s\S]*?\];/)[0].includes("'supplier_order_status'"));
assert(!worker.match(/const SYNC_UPDATE_FIELDS = \[[\s\S]*?\];/)[0].includes('supplier_order_status'));
assert(worker.includes("['orders', 'supplier_order_status', \"TEXT DEFAULT 'not_placed'\"]"));
fs.writeFileSync('/tmp/hesabdar-frontend.js', html.slice(html.indexOf("<script>\n'use strict';") + 8, html.lastIndexOf('</script>')));
console.log('Supplier purchase status checks passed');
