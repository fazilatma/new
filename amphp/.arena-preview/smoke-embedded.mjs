import { Window } from 'happy-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const emb = path.join(__dirname, 'embedded-only');
const js = fs.readFileSync(path.join(emb, 'storefront.js'), 'utf8');
const css = fs.readFileSync(path.join(emb, 'storefront.css'), 'utf8');
const boot = fs.readFileSync(path.join(__dirname, 'boot-sample.js'), 'utf8');

const window = new Window({ url: 'https://example.test/?amphp_sf=storefront.js' });
const document = window.document;
document.documentElement.lang = 'fa';
document.documentElement.dir = 'rtl';
const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);
document.body.innerHTML = '<div id="amphp-storefront-root" data-amphp-root="1"></div>';
// inject boot config like WP
const s1 = document.createElement('script');
s1.textContent = boot;
document.body.appendChild(s1);
const s2 = document.createElement('script');
s2.textContent = js;
document.body.appendChild(s2);

// allow microtasks / rAF
await new Promise((r) => setTimeout(r, 50));
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 25));
  const root = document.getElementById('amphp-storefront-root');
  const mounted = root && (root.getAttribute('data-mounted') === '1' || root.querySelector('[data-amphp-app], header, .sf-grid, .sf-product'));
  if (mounted) {
    const cards = root.querySelectorAll('.sf-product, [data-product], article, .product-card').length
      || root.querySelectorAll('img').length;
    console.log(JSON.stringify({
      ok: true,
      mode: 'embedded-only',
      mounted: true,
      hasHeader: !!root.querySelector('header'),
      cards,
      htmlLen: root.innerHTML.length,
    }));
    process.exit(0);
  }
}
const root = document.getElementById('amphp-storefront-root');
console.log(JSON.stringify({
  ok: false,
  mode: 'embedded-only',
  html: (root && root.innerHTML || '').slice(0, 500),
}));
process.exit(1);
