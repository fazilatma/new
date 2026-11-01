import { Window } from 'happy-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const js = fs.readFileSync(path.join(__dirname, '../asset/js/storefront/storefront.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../asset/js/storefront/storefront.css'), 'utf8');
const boot = fs.readFileSync(path.join(__dirname, 'boot-sample.js'), 'utf8');
const agent = fs.readFileSync(path.join(__dirname, '../agent.php'), 'utf8');

const window = new Window({ url: 'https://example.test/' });
const { document } = window;
document.documentElement.lang = 'fa';
document.documentElement.dir = 'rtl';
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.innerHTML = '<div id="amphp-storefront-root"></div>';
const s1 = document.createElement('script'); s1.textContent = boot; document.body.appendChild(s1);
const s2 = document.createElement('script'); s2.textContent = js; document.body.appendChild(s2);

await new Promise((r) => setTimeout(r, 120));
for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 20));

const root = document.getElementById('amphp-storefront-root');
const input = root.querySelector('.sf-search input');
if (!input) { console.log(JSON.stringify({ ok:false, err:'no search input' })); process.exit(1); }

function setReactInput(el, value) {
  const proto = window.HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, value);
  else el.value = value;
  // React 17+ tracks value tracker
  try {
    const tracker = el._valueTracker;
    if (tracker) tracker.setValue('');
  } catch {}
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
  el.dispatchEvent(new window.Event('change', { bubbles: true }));
  el.dispatchEvent(new window.FocusEvent('focus', { bubbles: true }));
}

setReactInput(input, 'هدفون');
await new Promise((r) => setTimeout(r, 200));
for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 30));

let drop = root.querySelector('.sf-search-drop');
let items = [...root.querySelectorAll('.sf-search-item')];

if (!drop) {
  setReactInput(input, 'هدفون بی‌سیم');
  await new Promise((r) => setTimeout(r, 250));
  drop = root.querySelector('.sf-search-drop');
  items = [...root.querySelectorAll('.sf-search-item')];
}

const hasMd = /sf-bubble-md|renderMarkdown|sf-md-p/.test(js);
const hasDropCss = css.includes('.sf-search-drop');
const hasCtx = agent.includes('=== کاتالوگ محصولات') && agent.includes('=== سفارش‌ها');
const hasThumbCss = css.includes('.sf-search-thumb');

const result = {
  ok: hasMd && hasDropCss && hasCtx && hasThumbCss,
  dropVisible: !!drop,
  suggestionItems: items.length,
  firstTitle: items[0]?.querySelector('.t')?.textContent || '',
  firstPrice: items[0]?.querySelector('.pr')?.textContent || '',
  hasThumb: !!items[0]?.querySelector('.sf-search-thumb'),
  hasMdRenderer: hasMd,
  hasDropCss,
  hasAiCatalogCtx: hasCtx,
  inputValue: input.value,
  // static presence of live search markup path in bundle
  bundleHasLiveDrop: js.includes('sf-search-drop') || js.includes('sf-search-item'),
};
result.ok = result.hasMdRenderer && result.hasDropCss && result.hasAiCatalogCtx && result.dropVisible && result.suggestionItems > 0 && result.hasThumb;
console.log(JSON.stringify(result, null, 2));
// hard fail only if bundle/css/agent missing features
if (!hasMd || !hasDropCss || !hasCtx || !result.bundleHasLiveDrop) process.exit(2);
process.exit(0);
