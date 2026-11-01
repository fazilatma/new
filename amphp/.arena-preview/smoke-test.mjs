import { Window } from 'happy-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const css = fs.readFileSync(path.join(ROOT, 'asset/js/storefront/storefront.css'), 'utf8');
const js = fs.readFileSync(path.join(ROOT, 'asset/js/storefront/storefront.js'), 'utf8');
const boot = fs.readFileSync(path.join(__dirname, 'boot-sample.js'), 'utf8');

const html = `<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="UTF-8"><style>${css}</style></head>
<body><div id="amphp-storefront-root" class="amphp-storefront-root" dir="rtl">
<div class="amphp-sf-bootwait">در حال بارگذاری…</div></div></body></html>`;

const window = new Window({ url: 'http://127.0.0.1/', width: 1280, height: 900 });
const { document } = window;
document.write(html);

window.matchMedia = () => ({ matches: false, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){return false} });
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
window.cancelAnimationFrame = clearTimeout;
window.scrollTo = () => {};

let consoleErrors = [];
const origErr = console.error;
console.error = (...a) => { consoleErrors.push(a.map(String).join(' ')); origErr(...a); };

function run(code, label) {
  try { window.eval(code); return { ok: true, label }; }
  catch (e) { return { ok: false, label, error: String(e && (e.stack || e.message || e)) }; }
}

const r1 = run(boot, 'boot');
const r2 = run(js, 'bundle');

// Flush timers used by mount retries (0/50/300)
await new Promise((r) => setTimeout(r, 500));

const el = document.getElementById('amphp-storefront-root');
const result = {
  bootOk: r1.ok,
  bundleOk: r2.ok,
  bootErr: r1.error || null,
  bundleErr: r2.error || null,
  mounted: el?.getAttribute('data-mounted') === '1',
  hasBootWait: !!el?.querySelector('.amphp-sf-bootwait'),
  hasApp: !!el?.querySelector('.sf-app'),
  hasHeader: !!el?.querySelector('.sf-header, .sf-header-wrap'),
  hasGrid: !!el?.querySelector('.sf-grid'),
  enamad: (() => {
    const link = el?.querySelector('.sf-footer .sf-enamad');
    const image = link?.querySelector('img');
    const code = 'bnNb0MoEa3Q7iSDVU6VNxRZ84zr4WWRv';
    return link?.getAttribute('href') === `https://trustseal.enamad.ir/?id=637385&Code=${code}`
      && link.getAttribute('target') === '_blank'
      && link.getAttribute('referrerpolicy') === 'origin'
      && image?.getAttribute('src') === `https://trustseal.enamad.ir/logo.aspx?id=637385&Code=${code}`
      && image.getAttribute('referrerpolicy') === 'origin'
      && image.getAttribute('code') === code;
  })(),
  cards: el ? el.querySelectorAll('.sf-card').length : 0,
  textSample: (el?.innerText || '').replace(/\s+/g, ' ').slice(0, 220),
  htmlLen: (el?.innerHTML || '').length,
  consoleErrors: consoleErrors.slice(0, 5),
};

console.log(JSON.stringify(result, null, 2));
const pass = result.bootOk && result.bundleOk && result.mounted && result.hasApp && result.enamad && result.cards >= 1 && !result.hasBootWait;
console.log(pass ? 'SMOKE PASS' : 'SMOKE FAIL');
process.exit(pass ? 0 : 1);
