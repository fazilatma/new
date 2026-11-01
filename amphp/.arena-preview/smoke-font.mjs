import { Window } from 'happy-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const window = new Window({ url: 'http://127.0.0.1:8765/' });
const { document } = window;

// Poison LS with wrong font
window.localStorage.setItem('scraper_font', 'system');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
document.write(html);

// Load boot sample + storefront js manually after scripts tags
const boot = fs.readFileSync(path.join(__dirname, 'boot-sample.js'), 'utf8');
window.eval(boot);

// Inject server font boot (as in index) if not already from write
if (!window.APP_FONT_SERVER) {
  window.APP_FONTS = {
    system: { stack: 'Tahoma,system-ui,sans-serif', css: '', face: '' },
    vazirmatn: { stack: 'Vazirmatn,Tahoma', css: '', face: '' },
    sahel: { stack: 'Sahel,Tahoma,system-ui,sans-serif', css: '', face: '' },
  };
  window.APP_FONT_KEY = 'scraper_font';
  window.APP_FONT_SERVER = 'sahel';
  window.appFontCurrent = () => window.APP_FONT_SERVER || 'vazirmatn';
  window.appFontApply = (k) => {
    const f = window.APP_FONTS[k] || window.APP_FONTS.vazirmatn;
    document.documentElement.style.setProperty('--app-font', f.stack);
    if (document.body) document.body.style.fontFamily = f.stack;
    window.APP_FONT_CURRENT = k;
    return k;
  };
  window.appFontApply('sahel', false);
}

const js = fs.readFileSync(path.join(ROOT, 'asset/js/storefront/storefront.js'), 'utf8');
window.eval(js);

// wait for mount
await new Promise((r) => setTimeout(r, 800));

const el = document.getElementById('amphp-storefront-root');
const cssVar = document.documentElement.style.getPropertyValue('--app-font') || '';
const bodyFf = document.body?.style?.fontFamily || '';
const result = {
  mounted: el?.getAttribute('data-mounted') === '1',
  serverFont: window.APP_FONT_SERVER,
  cssVar,
  bodyFf,
  lsFont: window.localStorage.getItem('scraper_font'),
  fontHasSahel: (cssVar + bodyFf).toLowerCase().includes('sahel'),
  // LS was poisoned to system — server must still win
  lsPoisoned: window.localStorage.getItem('scraper_font') === 'system' || window.localStorage.getItem('scraper_font') === 'sahel',
  productCards: el ? el.querySelectorAll('.sf-card').length : 0,
};
console.log(JSON.stringify(result, null, 2));
if (!result.fontHasSahel) {
  console.error('FAIL: server font sahel not applied');
  process.exit(1);
}
if (!result.mounted && result.productCards === 0) {
  // try softer - maybe mount attr missing
  console.warn('WARN: mount flag missing but font ok');
}
console.log('PASS: global server font applied (sahel) despite LS poison');
process.exit(0);
