import { Window } from 'happy-dom';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const dir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dir, '..');
const js = fs.readFileSync(path.join(rootDir, 'asset/js/storefront/storefront.js'), 'utf8');
const css = fs.readFileSync(path.join(rootDir, 'asset/js/storefront/storefront.css'), 'utf8');
const boot = fs.readFileSync(path.join(dir, 'boot-sample.js'), 'utf8');
const wait = () => new Promise(r => setTimeout(r, 160));
for (const width of [375, 1280]) {
  const window = new Window({ url: 'https://example.test/', width, height: 800 });
  window.document.body.innerHTML = '<div id="amphp-storefront-root" class="amphp-storefront-root" dir="rtl"></div>';
  const style = window.document.createElement('style'); style.textContent = css; window.document.head.append(style);
  const script = t => { const el = window.document.createElement('script'); el.textContent = t; window.document.body.append(el); };
  script(boot); script(js); await wait();
  const fab = window.document.querySelector('.sf-chat-fab');
  if (!fab || !fab.textContent.includes('دستیار هوشمند') || !fab.querySelector('svg') || fab.getAttribute('aria-expanded') !== 'false') throw new Error(`Missing visible assistant at ${width}`);
  if (window.getComputedStyle(fab.querySelector('.lbl')).display === 'none') throw new Error(`Hidden mobile label at ${width}`);
  fab.click(); await wait();
  if (fab.getAttribute('aria-expanded') !== 'true' || !window.document.querySelector('#sf-support-chat')) throw new Error(`Chat did not open at ${width}`);
  fab.click(); await wait();
  if (fab.getAttribute('aria-expanded') !== 'false' || window.document.querySelector('#sf-support-chat')) throw new Error(`Chat did not close at ${width}`);
  window.happyDOM.abort();
}
console.log('Assistant button smoke tests passed');
