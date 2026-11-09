const fs = require('node:fs');
const assert = require('node:assert/strict');
const {JSDOM} = require('jsdom');
const html = fs.readFileSync('src/frontend.html','utf8');
const dom = new JSDOM(html, {url:'https://test.example',runScripts:'outside-only'});
const w = dom.window;
w.scrollTo = () => {};
const script = html.slice(html.indexOf("<script>\n'use strict';")+8, html.lastIndexOf('</script>')).replace("document.addEventListener('DOMContentLoaded', init);",'');
w.eval(script + `
  const testCharts = {};
  mkChart = (id,cfg) => { testCharts[id] = cfg; };
  PK.date = {get:()=> '2026-09-08',set() {}};
  window.app = {state, calc, ownerFinance, companyReportOrders, summarize, renderOrders, renderOwners, renderBooths,
    renderDashboard, renderReports, fillSelects, editOrder, formData, liveCalc, newOwnerOrder, resetForm, buildNav, go,
    charts: testCharts, setIncludeOwners, ownerBoothModal, ownerTokenModal, Store, submitOrder};
`);
const a=w.app, $=s=>w.document.querySelector(s);
a.state.booths=[{id:1,name:'Owned',is_independent:0},{id:2,name:'Partner',owner_name:'Owner',is_independent:1,owner_share_pct:20}];
a.state.suppliers=[{id:1,name:'Supplier'}];
a.state.settings={owner_credit_fee_pct:5,cost_mode:'unit'};
const base={id:10,order_code:'B10',booth_id:2,is_independent:1,source:'basalam',customer_name:'Buyer',product_name:'Item',quantity:1,unit_sale:150000,unit_cost:100000,commission:10000,order_date:'2026-09-08',status:'delivered',owner_share_pct:20,credit_fee_pct:5,owner_payment_mode:'cash',supplier_id:1};
a.state.orders=[base,{...base,id:11,order_code:'B11',is_independent:0,booth_id:1}];
let f=a.ownerFinance(base);
assert.equal(f.retail.profit,40000);assert.equal(f.companyProfit,8000);assert.equal(f.ownerProfit,32000);assert.equal(f.payable,108000);
f=a.ownerFinance({...base,owner_payment_mode:'credit',owner_paid_amount:50000});
assert.equal(f.creditFee,5400);assert.equal(f.ownerProfit,26600);assert.equal(f.companyProfit+f.ownerProfit+f.creditFee,f.retail.profit);assert.equal(f.payable,113400);assert.equal(f.balance,63400);
assert.equal(a.ownerFinance({...base,unit_sale:110000,owner_payment_mode:'credit'}).payable,105000);
assert.equal(a.ownerFinance({...base,status:'cancelled',owner_paid_amount:1000}).balance,-1000);
assert.equal(a.ownerFinance({...base,status:'cancelled'}).companyProfit,0);
assert.equal(a.ownerFinance({...base,unit_cost:0}).ready,false);
assert.equal(a.ownerFinance({...base,unit_cost:0}).payable,0);
assert.equal(a.ownerFinance({...base,status:'returned'}).companyProfit,-22000);
a.state.includeOwners=false;assert.equal(a.companyReportOrders().length,1);
a.state.includeOwners=true;assert.equal(a.summarize(a.companyReportOrders()).profit,48000);
assert.equal(a.summarize(a.companyReportOrders()).revenue,258000);
a.buildNav();assert($('#mobile-nav [data-v="owners"]'));
a.fillSelects();a.renderOrders();assert.equal($('#orders-tbl tbody').rows.length,1);assert($('#orders-tbl').textContent.includes('B11'));assert(!$('#orders-tbl').textContent.includes('B10'));
a.renderOwners();assert.equal($('#owner-orders-table thead tr').cells.length,19);assert.equal($('#owner-orders-table tbody tr').cells.length,19);assert($('#owner-orders-table').textContent.includes('B10'));assert(!$('#owner-orders-table').textContent.includes('B11'));
for(const group of ['daily','weekly','monthly']){$('#ow-group').value=group;a.renderOwners();assert.equal(a.charts['owner-trend'].data.datasets[1].data[0],8000);}
a.renderBooths();assert($('#owner-managers').textContent.includes('Owner'));assert(!$('#booths-grid').textContent.includes('Partner'));
a.editOrder(10);assert(!$('#owner-order-fields').classList.contains('hidden'));assert($('#o-booth').disabled);assert.equal(a.formData().owner_share_pct,20);
a.state.settings.owner_credit_fee_pct=10;a.state.booths[1].owner_share_pct=50;
$('#o-owner-mode').value='credit';a.liveCalc();assert.equal(a.formData().credit_fee_pct,5);assert.equal(a.formData().owner_share_pct,20);
assert($('#owner-order-calculation').textContent.includes('۱۱۳,۴۰۰'));
a.editOrder(11);assert($('#owner-order-fields').classList.contains('hidden'));assert(!$('#o-booth').disabled);
a.newOwnerOrder();assert.equal(a.formData().credit_fee_pct,10);assert.equal(a.formData().owner_share_pct,50);
a.state.range='all';a.state.trendRange='all';a.renderDashboard();assert(a.charts['ch-pft'].data.datasets.some(d=>d.label.includes('خودفرما')&&d.data[0]===8000));
a.renderReports();assert(a.charts['ch-pnl'].data.datasets.some(d=>d.label.includes('خودفرما')&&d.data[0]===8000));
a.setIncludeOwners(false);a.renderReports();assert(a.charts['ch-pnl'].data.datasets.find(d=>d.label.includes('خودفرما')).data.every(n=>n===0));
// Multiple pages and no-result state are valid tables.
a.state.orders=Array.from({length:105},(_,i)=>({...base,id:100+i}));a.renderOwners();assert.equal($('#owner-orders-table tbody').rows.length,100);
a.state.ownerPage=2;a.renderOwners();assert.equal($('#owner-orders-table tbody').rows.length,5);
$('#ow-q').value='no-such-order';a.renderOwners();assert.equal($('#owner-orders-table tbody tr td').colSpan,19);
// Verify shared edit save routes back to the independent tab and preserves snapshot values.
(async()=>{
  $('#ow-q').value='';a.state.orders=[base];a.editOrder(10);$('#o-owner-mode').value='credit';
  a.Store.saveOrder=async o=>({...o,owner_share_pct:20,credit_fee_pct:5});
  await a.submitOrder({preventDefault(){}});
  assert($('#view-owners').classList.contains('active'));assert.equal(a.state.orders[0].owner_payment_mode,'credit');
  console.log('Owner UI/finance passed: split, cash/credit, losses, missing cost, preserved rates, tables, filters, pagination, edit/save, charts, inclusion toggle');
  dom.window.close();
})().catch(e=>{dom.window.close();console.error(e);process.exitCode=1;});
