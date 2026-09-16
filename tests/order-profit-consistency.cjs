const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('src/frontend.html', 'utf8');
const nodes = {};
const el = id => nodes[id.replace(/^#/, '')] ||= { value: '', dataset: {}, style: {}, textContent: '', innerHTML: '' };
const state = { orders: [], suppliers: [], booths: [{id: 1, comm_pct: 10, ship_single: 200, ship_multi: 300}], settings: {} };
const ctx = vm.createContext({state, document: {getElementById: el}, $: el,
  PK: {date: {get: () => '2026-09-16', set() {}}}, isoToJ: () => ({jy:1405,jm:6,jd:25}),
  isoToday: () => '2026-09-16', nextOrderCode: () => 'TEST', go() {},
});
const grab = name => html.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0];
const money = html.slice(html.indexOf("const FA_D ="), html.indexOf('const esc ='));
vm.runInContext(money + '\nconst N = v => Number(v) || 0;\nconst AUTO = {comm:null,ship:null,commT:false,shipT:false};\n' +
  ['costMode','calc','refreshAuto','onSourceChange','formData','liveCalc','editOrder'].map(grab).join('\n') +
  "\nfunction resetForm() { for (const id of ['o-id','o-sup']) $( '#'+id).value = ''; }", ctx);
for (const mode of ['unit', 'total']) {
  state.settings.cost_mode = mode;
  for (const status of ['confirmed', 'returned', 'cancelled']) {
    for (const fee of [0, 45.25]) {
      const order = { id: 1, order_code:'TEST', source:'basalam', booth_id:1, quantity:3,
        unit_sale:1000/3, unit_cost:500/3, commission:fee, shipping_rev:fee,
        shipping_cost:21.5, packaging_cost:7.5, ads_cost:0, other_cost:0, discount:10, status };
      state.orders = [order];
      vm.runInContext('editOrder(1)', ctx);
      const result = vm.runInContext('({saved:calc(state.orders[0],true), form:calc(formData(),true), data:formData()})',ctx);
      assert(Math.abs(result.saved.profit - result.form.profit) < 1e-8, `${mode}/${status}/${fee}`);
      assert.equal(result.data.commission, fee);
      assert.equal(result.data.shipping_rev, fee);
      if (status === 'cancelled') assert(el('calc-panel').innerHTML.includes('خارج از محاسبات'));
    }
  }
}
// New orders still receive automatic suggestions.
el('o-id').value = ''; el('o-source').value = 'basalam'; el('o-booth').value = 1; el('o-qty').value = 1;
vm.runInContext("setMoney('o-usale',1000); setMoney('o-comm',0); setMoney('o-shiprev',0); refreshAuto()", ctx);
assert.equal(vm.runInContext("M('o-comm')", ctx),100);
assert.equal(vm.runInContext("M('o-shiprev')", ctx),200);
vm.runInContext("setMoney('o-ucost', 500/3)", ctx);
el('o-ucost').value = '250';
vm.runInContext("fmtInp(document.getElementById('o-ucost'))",ctx);
assert.equal(vm.runInContext("M('o-ucost')",ctx),250);
assert(html.includes('id="o-status" class="inp" onchange="liveCalc()"'));
console.log('Profit parity passed: 12 edit cases, new-order suggestions, manual amount edits, and status wiring');
