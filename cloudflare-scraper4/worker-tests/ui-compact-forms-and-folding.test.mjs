// «Put the text box next to its label, by default, everywhere in the site» and «make every explanation
// collapsible everywhere». Both are UI settings the request asked for, so they are tested where they
// actually work: the shared dashboard bundle (one implementation for Worker and Node) and the deployer
// page, against a real parsed DOM — not by grepping for a class name that could exist while doing nothing.
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { parseHTML } from 'linkedom';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const temporary = await mkdtemp(join(ROOT, 'node_modules', '.cache', 'scraper4-lab', 'compact-ui-'));
await build({
  entryPoints: { dashboard: join(ROOT, 'worker-src', 'dashboard.ts') },
  bundle: true, format: 'esm', platform: 'node', target: 'node18', outdir: temporary, entryNames: '[name]', outExtension: { '.js': '.mjs' }
});
const { DASHBOARD, DASHBOARD_JS } = await import(pathToFileURL(join(temporary, 'dashboard.mjs')).href);

/** Brace-balanced slice of one function out of the served bundle, so the test runs the shipped code. */
function sourceOf(name, code) {
  const start = code.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in the served dashboard bundle`);
  let depth = 0;
  for (let i = code.indexOf('{', start); i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (!depth) return code.slice(start, i + 1); }
  }
  throw new Error(`${name} is unbalanced`);
}

const domState = {};
function installDom(html, keepStore) {
  const { window, document } = parseHTML(html);
  const store = keepStore || new Map();
  const localStorage = {
    getItem: key => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key),
    clear: () => store.clear()
  };
  for (const [key, value] of Object.entries({ window, document, localStorage, CustomEvent: window.CustomEvent, Event: window.Event, navigator: window.navigator, location: window.location || { pathname: '/' } })) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  domState.store = store;
  return { window, document, localStorage, store };
}

function loadFolder() {
  const names = ['foldTitleFor', 'foldOpenKeys', 'rememberFoldOpen', 'foldDescriptions', 'applyInlineFields'];
  const constants = `const FOLD_SELECTOR=${/const FOLD_SELECTOR=([^;]+);/.exec(DASHBOARD_JS)[1]};const FOLD_OPEN_KEY=${/const FOLD_OPEN_KEY=([^;]+);/.exec(DASHBOARD_JS)[1]};`;
  const body = constants + '\n' + names.map(name => sourceOf(name, DASHBOARD_JS)).join('\n');
  return new Function(`return (function(){${body}\nreturn {foldDescriptions,applyInlineFields};})()`)();
}

const longText = 'این توضیح آن‌قدر بلند است که در یک فرم طولانی دو سطر کامل می‌گیرد و فقط مسیر اسکرول را زیاد می‌کند. ';
const LONG = longText.repeat(3);
const SHORT = 'ذخیره شد';

test('the compact form layout is the default, before any script has run', () => {
  assert.match(DASHBOARD, /<html lang="fa" dir="rtl" data-fields="inline">/,
    'the served html must already say inline, otherwise every reload reflows the whole form once JS lands');
});

test('inline mode puts the control beside its label, and only where there is room', () => {
  assert.match(DASHBOARD, /@media\(min-width:640px\)\{html\[data-fields="inline"\] \.field:has\(>label:first-child\)\{display:grid;grid-template-columns:max\(26%,7\.5rem\) minmax\(0,1fr\)/,
    'the label column is a grid track, so a long label never squeezes the input away');
  assert.match(DASHBOARD, /\.field:has\(>label:first-child\)>\.field-hint\{grid-column:2\}/, 'the hint stays under the input it explains, not under the label');
  assert.match(DASHBOARD, /\.field:has\(>label:first-child\)>label\{margin-bottom:0/, 'and only a field that really starts with a label goes two-column');
  assert.doesNotMatch(DASHBOARD, /html\[data-fields="inline"\] \.field\{display:grid/,
    'a bare .field rule would give the paragraph boxes and button rows (25 of the 89 .field sites) an empty label column');
  assert.match(DASHBOARD, /html\[data-fields="inline"\] \.crow>label:first-child\{min-width:0;flex:0 0 32%/, 'every menu form (drawer rows) goes inline too');
  // Nothing outside that guard may introduce a two-column field, or small phones would lose their layout.
  const fieldLines = DASHBOARD.split('\n').filter(line => /html\[data-fields="inline"\] \.field[>{:]/.test(line));
  assert.ok(fieldLines.length >= 3, 'the field rules exist: ' + fieldLines.length);
  assert.ok(fieldLines.every(line => line.includes('.field:has(>label:first-child)')), 'every one of them is guarded by both the width and the label');
  assert.ok(fieldLines[0].startsWith('@media(min-width:640px){'), 'the first sits inside the 640px guard');
});

test('applyInlineFields is the switch, and an unset preference means inline', () => {
  installDom('<html lang="fa" dir="rtl"><body></body></html>');
  const { applyInlineFields } = loadFolder();
  applyInlineFields(true);
  assert.equal(document.documentElement.getAttribute('data-fields'), 'inline');
  applyInlineFields(false);
  assert.equal(document.documentElement.getAttribute('data-fields'), 'stacked');
  applyInlineFields(undefined);
  assert.equal(document.documentElement.getAttribute('data-fields'), 'inline', 'a fresh install gets the compact form, as asked');
});

test('the switch is a real setting: in the general section, bound, persisted and applied on load', async () => {
  const source = await readFile(join(ROOT, 'worker-src', 'dashboard.ts'), 'utf8');
  assert.match(source, /mCheck\('تکست‌باکس کنار برچسب \(فرم فشرده\)','inlineFieldsOn',BSET\('appearance\.inlineFields'\),true\)/,
    'it sits with the other appearance switches and defaults to checked');
  assert.match(source, /else if\(input\.id==='inlineFieldsOn'\)applyInlineFields\(input\.checked\)/, 'it applies immediately, without pressing save');
  assert.match(source, /applyInlineFields\(nestedGet\(state\.settings,'appearance\.inlineFields'\)!==false\)/, 'and the stored choice is restored on load');
  assert.match(source, /querySelectorAll\('\[data-setting\]'\)\.forEach\(input=>\{let value=input\.type==='checkbox'\?input\.checked/,
    'the existing auto-save collector reads checkboxes, so no second persistence path was invented');
  assert.match(source, /initUnifiedTabs\(\);initFields\(\);initDescriptionFolding\(\);/,
    'and the folding starts on boot, then keeps up with panes the app re-renders later');
  assert.match(source, /const Observer=typeof MutationObserver==='function'\?MutationObserver:/, 'the observer is checked as a constructor, so a stub on window cannot break boot');
  assert.match(source, /if\(!Observer\|\|!document\.body\)return;/, 'and boot continues untouched when the platform has none');
  assert.match(source, /new Observer\(records=>\{\nif\(queued\)return;/, 'the observer coalesces: a burst of mutations is one pass, not fifty');
  assert.match(source, /const interesting=records\.some\(record=>Array\.from\(record\.addedNodes\|\|\[\]\)\.some\(node=>node&&node\.nodeType===1&&\(\(node\.matches&&node\.matches\(FOLD_SELECTOR\)\)/,
    'it looks only for nodes this pass could fold, so chatty log updates do not rescan the page');
  assert.match(source, /\}\)\.observe\(document\.body,\{childList:true,subtree:true\}\)/, 'and it watches the live document, not just the first paint');
});

test('explanations are foldable everywhere on the site, and only explanations', () => {
  installDom('<html lang="fa" dir="rtl"><body><div class="card"><h3>پروفایل</h3>'
    + `<div class="help-box">${LONG}</div>`
    + `<div class="menu-text">${SHORT}</div>`
    + `<p class="menu-text">${LONG}</p>`
    + `<details class="note"><summary>راهنما</summary><div class="help-box">${LONG}</div></details>`
    + `<div id="depNotifyState" class="menu-text">${LONG}</div>`
    + '</div></body></html>');
  const { foldDescriptions } = loadFolder();
  foldDescriptions(document);

  const folded = document.querySelectorAll('details.fold-desc');
  assert.equal(folded.length, 2, 'the help box and the paragraph-form description fold; nothing else does');
  assert.match(folded[0].querySelector('summary').textContent, /^ℹ️ پروفایل$/, 'each one says what it explains, not just “info”');
  assert.equal(document.querySelector('div.menu-text[data-folded]'), null, 'a short status line is never hidden');
  assert.equal(document.getElementById('depNotifyState').closest('details'), null, 'a live readout styled as text stays visible');
  const nested = document.querySelector('.note .help-box');
  assert.equal(nested.closest('.fold-desc'), null, 'a block already inside a collapsible is not wrapped twice');
  assert.equal(nested.parentElement.tagName, 'DETAILS', 'and it stays exactly where its own fold put it');

  const before = document.body.innerHTML;
  foldDescriptions(document);
  assert.equal(document.body.innerHTML, before, 'running it again must not nest details inside details');
});

test('an explanation the reader opened stays open, and one they closed stays closed', () => {
  installDom('<html lang="fa" dir="rtl"><body><div class="card"><h3>ارسال</h3>' + `<div class="help-box">${LONG}</div>` + '</div></body></html>');
  const { foldDescriptions } = loadFolder();
  foldDescriptions(document);
  const box = document.querySelector('details.fold-desc');
  assert.equal(box.hasAttribute('open'), false, 'the default is collapsed — that is what the request asked for');
  box.setAttribute('open','');
  box.dispatchEvent(new window.Event('toggle'));
  assert.ok(domState.store.size, 'the choice is remembered');

  installDom('<html lang="fa" dir="rtl"><body><div class="card"><h3>ارسال</h3>' + `<div class="help-box">${LONG}</div>` + '</div></body></html>', domState.store);
  loadFolder().foldDescriptions(document);
  assert.ok(document.querySelector('details.fold-desc').hasAttribute('open'), 'a re-render hands back what the reader had opened');
});

test('the deployer page folds its guides too, and puts labels beside their fields', async () => {
  const deployer = await readFile(join(ROOT, 'scripts', 'local-deployer-ui.mjs'), 'utf8');
  assert.match(deployer, /@media\(min-width:44rem\)\{label\[for\]\{display:inline-block;width:12rem/, 'no px: the deployer sheet stays rem-based');
  assert.match(deployer, /label\[for\]\+input,label\[for\]\+select\{width:calc\(100% - 13rem\)/, 'the field takes the rest of the row');
  assert.match(deployer, /function foldLongHelp\(\) \{[\s\S]*?className = 'note'/, 'its long guides reuse the existing .note fold instead of a second style');
  assert.match(deployer, /^foldLongHelp\(\);$/m, 'and it runs once at boot');

  const start = deployer.indexOf('function foldLongHelp() {');
  let depth = 0, i = deployer.indexOf('{', start);
  for (; i < deployer.length; i++) {
    if (deployer[i] === '{') depth++;
    else if (deployer[i] === '}') { depth--; if (!depth) break; }
  }
  const body = deployer.slice(start, i + 1);
  installDom('<html lang="en"><body><div class="card"><p>' + 'This guide explains a long sequence of steps that nobody reads twice. '.repeat(4)
    + '</p><p>Short label line.</p></div></body></html>');
  new Function(body + '\nfoldLongHelp();')();
  assert.equal(document.querySelector('details.note p').parentElement.tagName, 'DETAILS', 'the long paragraph sits behind a fold');
  assert.match(document.querySelector('details.note summary').textContent, /Why this is here/, 'with an honest summary');
  assert.equal(document.querySelectorAll('details.note').length, 1, 'the short line is left alone');
});

test('one implementation for both runtimes: the dashboard is not copied for Node', async () => {
  const reexport = await readFile(join(ROOT, 'render-src', 'dashboard.ts'), 'utf8');
  assert.match(reexport, /export \{ DASHBOARD, DASHBOARD_JS \} from '\.\.\/worker-src\/dashboard\.js';/,
    'styles, folding and the switch stay shared, so Worker and Node cannot drift apart');
});
