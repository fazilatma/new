import { Window } from 'happy-dom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const dir = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(dir, '..');
for (const width of [390, 1280]) {
  const w = new Window({ url:'https://example.test/', width, height:844 });
  w.document.write('<!doctype html><html dir="rtl"><body><div id="amphp-storefront-root"></div></body></html>');
  w.matchMedia = () => ({matches:false,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){}});
  w.requestAnimationFrame = cb => setTimeout(cb, 0); w.scrollTo = () => {}; w.fetch = async () => ({ok:true,json:async()=>({})});
  w.eval(fs.readFileSync(path.join(dir,'boot-sample.js'),'utf8'));
  w.AMPHP_STOREFRONT.settings.enable_ai_product_images=false;
  w.eval(fs.readFileSync(path.join(root,'asset/js/storefront/storefront.js'),'utf8'));
  const wait = () => new Promise(r => setTimeout(r, 90)); await wait();
  const menu = width < 600 ? w.document.querySelector('.sf-mob-menu') : w.document.querySelector('.sf-burger-btn');
  assert.ok(menu,'menu button'); menu.click(); await wait();
  const btn = [...w.document.querySelectorAll('.sf-menu-actions button')].find(n=>n.textContent.includes('محاسبه گر غرفه داران')); assert.ok(btn); btn.click(); await wait();
  const modal = w.document.querySelector('.sf-vendor-card[role="dialog"]'); assert.ok(modal && modal.getAttribute('aria-modal')==='true');
  const inputs=modal.querySelectorAll('.sf-vendor-grid input'); assert.equal(inputs.length,4); assert.equal(inputs[3].value,'5');
  function input(i,v) {const el=inputs[i];Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(el,v);if(el._valueTracker)el._valueTracker.setValue('');el.dispatchEvent(new w.Event('input',{bubbles:true}));el.dispatchEvent(new w.Event('change',{bubbles:true}));}
  input(0,'۱۲۰٬۰۰۰');input(1,'١٠٠٬٠٠٠');input(2,'۲۰');await wait();
  const final=()=>modal.querySelector('[data-testid="vendor-final"]')?.textContent;
  assert.match(final(),/۱۱۶,۰۰۰/,'cash keeps vendor share and has no fee');
  modal.querySelector('input[value="sample"]').click();await wait();assert.match(final(),/۱۲۲,۱۰۶/,'sample grosses up then rounds up');
  input(3,'۰');await wait();assert.match(final(),/۱۱۶,۰۰۰/,'zero fee');
  input(3,'۱۰۰');await wait();assert.equal(final(),undefined);assert.match(modal.textContent,/کمتر از ۱۰۰/);
  modal.querySelector('input[value="cash"]').click();await wait();assert.match(final(),/۱۱۶,۰۰۰/,'cash independent of sample fee');
  input(1,'۱۳۰۰۰۰');await wait();assert.equal(final(),undefined);assert.match(modal.textContent,/قیمت پایه نمی‌تواند/);
  input(1,'۱۰۰۰۰۰');input(2,'۱۰۱');await wait();assert.match(modal.textContent,/صفر تا ۱۰۰/);
  input(2,'-1');await wait();assert.equal(final(),undefined);
  input(2,'۲۰');input(3,'۹۹٫۹۹۹۹۹۹۹۹۹۹');modal.querySelector('input[value="sample"]').click();await wait();assert.equal(final(),undefined);assert.match(modal.textContent,/محدوده قابل محاسبه/);
  w.document.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await wait();assert.equal(w.document.querySelector('.sf-vendor-card'),null);assert.ok(w.document.querySelector('.sf-drawer[aria-label="منو"]'),'menu restored');assert.ok(w.document.activeElement.hasAttribute('data-vendor-open'),'focus restored to calculator menu item');
  w.happyDOM.abort();
}
console.log('Vendor calculator smoke tests passed');
